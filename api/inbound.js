/* ================================================================
   api/inbound.js  →  POST /api/inbound   (webhook Resend)

   C'est ici que Pitchly cesse d'être un générateur de texte.

   Chaque campagne envoie ses messages avec un Reply-To unique
   (reply+<token>@…). Quand le prospect répond, Resend nous pousse le
   message ici, le token nous dit de quelle campagne il s'agit, et on
   en tire les trois seules choses qui comptent vraiment :

     1. on ARRÊTE les relances programmées (personne ne doit relancer
        quelqu'un qui vient de répondre) ;
     2. on ENREGISTRE la réponse comme un fait daté — c'est la matière
        première des statistiques "qu'est-ce qui fait répondre" ;
     3. on RELAIE le message dans la vraie boîte du vendeur, pour qu'il
        continue la conversation normalement.

   Une réponse "STOP" est traitée comme une désinscription définitive.

   Cette route est publique (aucun navigateur connecté ne l'appelle) :
   sa protection est la signature du webhook, vérifiée ci-dessous.
   ================================================================ */

import crypto from 'node:crypto';
import { sbFetch, sendEmail, fromAddress, INBOUND_DOMAIN } from './_lib.js';

// Le corps brut est nécessaire tel quel : la signature porte sur les
// octets reçus, pas sur le JSON re-sérialisé (l'ordre des clés et les
// espaces changeraient le hash).
export const config = { api: { bodyParser: false } };

async function lireCorpsBrut(req) {
  const morceaux = [];
  for await (const morceau of req) morceaux.push(morceau);
  return Buffer.concat(morceaux).toString('utf8');
}

// Vérification de signature façon Svix (le service que Resend utilise
// pour ses webhooks) : HMAC-SHA256 de "<id>.<timestamp>.<corps>" avec
// la partie base64 du secret whsec_…
// Sans ça, n'importe qui peut nous faire croire qu'un prospect a
// répondu — et donc stopper les relances d'un concurrent.
function signatureValide(corps, headers) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;

  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatures = headers['svix-signature'];
  if (!id || !timestamp || !signatures) return false;

  // Fenêtre de tolérance de 5 minutes : au-delà, c'est un rejeu.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const cle = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const attendue = crypto
    .createHmac('sha256', cle)
    .update(`${id}.${timestamp}.${corps}`)
    .digest('base64');

  // L'en-tête peut contenir plusieurs signatures (rotation de secret),
  // séparées par des espaces, chacune préfixée de sa version.
  return String(signatures)
    .split(' ')
    .some(partie => {
      const valeur = partie.split(',')[1];
      if (!valeur || valeur.length !== attendue.length) return false;
      return crypto.timingSafeEqual(Buffer.from(valeur), Buffer.from(attendue));
    });
}

// Retrouve le token de campagne dans les destinataires du message.
// Le prospect peut répondre à plusieurs adresses à la fois ; on cherche
// celle qui porte notre motif reply+<token>@<domaine inbound>.
function extraireToken(destinataires) {
  const liste = Array.isArray(destinataires) ? destinataires : [destinataires];
  const motif = new RegExp(`reply\\+([a-z0-9]+)@${INBOUND_DOMAIN.replace(/\./g, '\\.')}`, 'i');

  for (const brut of liste) {
    const trouve = String(brut || '').match(motif);
    if (trouve) return trouve[1];
  }
  return null;
}

// Une désinscription doit être reconnue sur la forme réelle des
// réponses : "STOP", "stop.", "Stop merci" — mais pas un email de
// trois paragraphes qui contient le mot stop au milieu.
function estDesinscription(texte) {
  const debut = String(texte || '').trim().slice(0, 30).toUpperCase();
  return /^(STOP|DESABONNE|DÉSABONNE|UNSUBSCRIBE)\b/.test(debut);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  let corps;
  try {
    corps = await lireCorpsBrut(req);
  } catch {
    return res.status(400).json({ error: 'Corps illisible' });
  }

  if (!signatureValide(corps, req.headers)) {
    return res.status(401).json({ error: 'Signature invalide' });
  }

  let evenement;
  try {
    evenement = JSON.parse(corps);
  } catch {
    return res.status(400).json({ error: 'JSON invalide' });
  }

  // On ne traite que la réception d'email ; les autres événements
  // (delivered, bounced…) sont acquittés sans rien faire pour l'instant.
  if (evenement?.type !== 'email.received') {
    return res.status(200).json({ ok: true, ignore: evenement?.type || 'inconnu' });
  }

  const donnees = evenement.data || {};
  const token = extraireToken(donnees.to);
  if (!token) {
    // Rien à rattacher : on acquitte quand même, sinon Resend réessaiera
    // indéfiniment un message qui ne nous concerne pas.
    return res.status(200).json({ ok: true, ignore: 'token absent' });
  }

  try {
    const campagnes = await sbFetch(
      `campaigns?reply_token=eq.${token}&select=id,user_id,prospect_id,statut,destinataire,nom`
    );
    const campagne = campagnes?.[0];
    if (!campagne) {
      return res.status(200).json({ ok: true, ignore: 'campagne introuvable' });
    }

    const texte = donnees.text || donnees.html || '';
    const desinscription = estDesinscription(texte);
    const maintenant = new Date().toISOString();

    // Resend réessaie un webhook tant qu'il n'a pas reçu un 2xx, et le
    // prospect peut aussi répondre plusieurs fois. Seule la PREMIÈRE
    // réponse doit produire un événement : sinon un prospect bavard
    // gonflerait artificiellement le taux de réponse de l'accroche.
    if (campagne.statut !== 'active') {
      return res.status(200).json({ ok: true, ignore: 'campagne déjà close' });
    }

    // 1. Couper les relances à venir. En premier, avant tout le reste :
    // si la suite échoue, au moins on n'aura pas relancé quelqu'un qui
    // a répondu.
    await sbFetch(
      `campaign_steps?campaign_id=eq.${campagne.id}&statut=eq.pending`,
      { method: 'PATCH', body: { statut: 'cancelled' } }
    );

    await sbFetch(`campaigns?id=eq.${campagne.id}`, {
      method: 'PATCH',
      body: {
        statut: desinscription ? 'stopped' : 'replied',
        replied_at: maintenant,
      },
    });

    // 2. Enregistrer le fait. C'est cette ligne qui, agrégée, permettra
    // de dire "cette accroche obtient 14 % de réponse".
    await sbFetch('email_events', {
      method: 'POST',
      body: {
        user_id: campagne.user_id,
        campaign_id: campagne.id,
        type: desinscription ? 'complaint' : 'replied',
        payload: {
          from: donnees.from || null,
          subject: donnees.subject || null,
          extrait: String(texte).slice(0, 500),
        },
      },
    });

    // Le pipeline du prospect suit automatiquement : une réponse le fait
    // passer en discussion, un STOP le sort définitivement.
    if (campagne.prospect_id) {
      await sbFetch(`prospects?id=eq.${campagne.prospect_id}`, {
        method: 'PATCH',
        body: desinscription
          ? { opted_out_at: maintenant, statut: 'perdu', updated_at: maintenant }
          : { statut: 'en_discussion', updated_at: maintenant },
      });
    }

    // 3. Relayer dans la vraie boîte du vendeur, sauf pour un STOP
    // (inutile de lui transférer une désinscription : elle est déjà
    // visible dans l'app, et le prospect n'attend pas de réponse).
    if (!desinscription) {
      const identites = await sbFetch(
        `sending_identities?user_id=eq.${campagne.user_id}&select=*`
      );
      const identite = identites?.[0];

      if (identite?.reply_to_real) {
        await sendEmail({
          from: fromAddress(identite, campagne.user_id),
          to: identite.reply_to_real,
          // Le vendeur répond directement au prospect depuis sa boîte :
          // la conversation sort de Pitchly, ce qui est le but.
          replyTo: donnees.from,
          subject: `Réponse de ${donnees.from || 'votre prospect'} — ${campagne.nom || 'campagne'}`,
          text:
            `${donnees.from || 'Un prospect'} vient de répondre à ta séquence.\n` +
            `Les relances programmées ont été annulées automatiquement.\n\n` +
            `--- son message ---\n\n${texte}`,
        });
      }
    }

    return res.status(200).json({ ok: true, statut: desinscription ? 'stopped' : 'replied' });

  } catch (err) {
    // On renvoie 500 pour que Resend réessaie : les traitements
    // ci-dessus sont idempotents (annuler des étapes déjà annulées ne
    // fait rien), un rejeu est sans danger.
    return res.status(500).json({ error: 'Erreur inbound : ' + err.message });
  }
}
