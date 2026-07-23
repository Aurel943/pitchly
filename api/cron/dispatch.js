/* ================================================================
   api/cron/dispatch.js  →  GET /api/cron/dispatch  (cron Vercel)

   Le cœur de la promesse "ça tourne tout seul" : toutes les heures,
   envoie les messages dont la date est arrivée, pour les campagnes
   encore actives.

   Deux invariants qui expliquent la forme du code :

   1. Une campagne passée en 'replied' ne doit PLUS rien envoyer. Le
      filtre se fait dans la requête (campagne active uniquement), pas
      après coup — relancer quelqu'un qui vient de répondre est la
      faute la plus visible que ce produit puisse commettre.

   2. Le cron peut se déclencher deux fois, ou repasser après un
      timeout. Chaque étape est donc marquée 'sent' AVANT l'appel
      réseau à Resend : on préfère rater un envoi (visible, réparable)
      qu'en faire deux (le prospect reçoit deux fois le même email).

   Protégée par CRON_SECRET : sans ça, n'importe qui peut déclencher
   la vidange de la file d'envoi à volonté.

   FRÉQUENCE — vercel.json programme "35 7 * * *", soit une fois par
   jour à 7h35 UTC (9h35 à Paris en été), et non toutes les heures.
   Deux raisons :
     - le plan Hobby de Vercel n'autorise qu'un déclenchement quotidien,
       et un cron plus fréquent fait ÉCHOUER le déploiement entier (il
       ne se dégrade pas silencieusement) ;
     - l'heure n'est pas arbitraire : prochainCreneauOuvre() cale toutes
       les étapes à 7h30 UTC, ce passage juste après les ramasse donc
       toutes en un seul tour.
   Conséquence à connaître : une étape programmée après 7h35 attend le
   lendemain. Passer en plan Pro et revenir à un cron horaire lisse ça.
   En attendant, l'envoi se déclenche aussi à la main :
     curl -H "Authorization: Bearer <CRON_SECRET>" https://<site>/api/cron/dispatch
   ================================================================ */

import {
  sbFetch,
  sendEmail,
  fromAddress,
  replyAddress,
  destinataireInterditEnTest,
  mentionLegale,
} from '../_lib.js';

// Nombre d'étapes traitées par exécution — borne le temps d'exécution
// de la fonction serverless. Le cron repasse à l'heure suivante pour
// le reste, ce qui lisse aussi les envois.
const MAX_PAR_RUN = 50;

// Plafond quotidien par utilisateur. C'est une protection de
// délivrabilité (un compte neuf qui envoie 200 emails d'un coup est
// grillé) autant qu'un garde-fou contre l'usage en spam de masse.
const MAX_PAR_JOUR_PAR_USER = 40;

// La mention légale ajoutée en bas de chaque message est construite par
// mentionLegale() dans _lib.js : elle dépend du vendeur (responsable de
// traitement) et du prospect (source de ses coordonnées), elle ne peut
// donc pas être une constante. Répondre STOP suffit à se désinscrire :
// la réponse arrive sur l'adresse aliasée et /api/inbound la traite.

export default async function handler(req, res) {
  const attendu = process.env.CRON_SECRET;
  const recu = (req.headers.authorization || '').replace('Bearer ', '');
  if (!attendu || recu !== attendu) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const maintenant = new Date().toISOString();
  const resultats = { envoyes: 0, echecs: 0, ignores: 0 };

  try {
    // Étapes dues, jointes à leur campagne. Le "!inner" + le filtre
    // campaign.statut garantissent qu'on ne récupère que des étapes de
    // campagnes encore actives (invariant n°1).
    const etapes = await sbFetch(
      `campaign_steps?statut=eq.pending&send_at=lte.${maintenant}` +
      `&select=*,campaign:campaigns!inner(id,statut,destinataire,reply_token,user_id,prospect_id)` +
      `&campaign.statut=eq.active&order=send_at.asc&limit=${MAX_PAR_RUN}`
    );

    if (!etapes || etapes.length === 0) {
      return res.status(200).json({ ok: true, ...resultats });
    }

    // Identités d'envoi, profils et compteurs du jour, récupérés une
    // fois par utilisateur concerné plutôt qu'une fois par étape.
    const userIds = [...new Set(etapes.map(e => e.user_id))];
    const identites = await sbFetch(
      `sending_identities?user_id=in.(${userIds.join(',')})&select=*`
    );
    const identiteParUser = Object.fromEntries((identites || []).map(i => [i.user_id, i]));

    // Le profil sert à deux choses ici : le nom de repli du responsable
    // de traitement dans la mention légale, et l'état de pause du compte.
    const profils = await sbFetch(
      `profiles?id=in.(${userIds.join(',')})&select=id,nom,paused_at`
    );
    const profilParUser = Object.fromEntries((profils || []).map(p => [p.id, p]));

    // Les fiches prospects, pour citer la source des coordonnées dans la
    // mention légale. Une campagne peut ne pas être rattachée à un
    // prospect (adresse saisie au lancement) : la mention retombe alors
    // sur une formulation générale.
    const prospectIds = [...new Set(
      etapes.map(e => e.campaign?.prospect_id).filter(Boolean)
    )];
    const prospects = prospectIds.length
      ? await sbFetch(`prospects?id=in.(${prospectIds.join(',')})&select=id,site_url`)
      : [];
    const prospectParId = Object.fromEntries((prospects || []).map(p => [p.id, p]));

    const debutJour = new Date();
    debutJour.setUTCHours(0, 0, 0, 0);
    const envoyesAujourdhui = await sbFetch(
      `campaign_steps?user_id=in.(${userIds.join(',')})&statut=eq.sent` +
      `&sent_at=gte.${debutJour.toISOString()}&select=user_id`
    );
    const compteurs = {};
    for (const ligne of envoyesAujourdhui || []) {
      compteurs[ligne.user_id] = (compteurs[ligne.user_id] || 0) + 1;
    }

    for (const etape of etapes) {
      const campagne = etape.campaign;
      const profil = profilParUser[etape.user_id];

      // Compte en pause : on ne touche à rien. Les étapes restent
      // 'pending' et seront décalées de la durée de la pause au retour
      // (voir /api/account/pause), pour que l'espacement J+3 / J+7 de la
      // séquence reste celui que l'utilisateur a validé au lancement.
      if (profil?.paused_at) {
        resultats.ignores++;
        continue;
      }

      if ((compteurs[etape.user_id] || 0) >= MAX_PAR_JOUR_PAR_USER) {
        // On ne touche pas à l'étape : elle reste 'pending' et repartira
        // demain, dans l'ordre.
        resultats.ignores++;
        continue;
      }

      const identite = identiteParUser[etape.user_id];

      // Deuxième barrière du mode test : une campagne a pu être lancée
      // avant que le mode ne s'active, ou l'adresse de repli avoir changé
      // depuis. On annule l'étape plutôt que de la laisser échouer en
      // boucle à chaque passage du cron.
      const refusTest = destinataireInterditEnTest(campagne.destinataire, identite);
      if (refusTest) {
        await sbFetch(`campaign_steps?id=eq.${etape.id}&statut=eq.pending`, {
          method: 'PATCH',
          body: { statut: 'cancelled', erreur: refusTest },
        });
        resultats.ignores++;
        continue;
      }

      // Réservation optimiste : on passe l'étape à 'sent' en exigeant
      // qu'elle soit encore 'pending'. Si une exécution concurrente est
      // passée avant, le PATCH ne renvoie aucune ligne et on saute
      // l'étape sans l'envoyer une deuxième fois (invariant n°2).
      const reservee = await sbFetch(
        `campaign_steps?id=eq.${etape.id}&statut=eq.pending`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: { statut: 'sent', sent_at: new Date().toISOString() },
        }
      );
      if (!reservee || reservee.length === 0) {
        resultats.ignores++;
        continue;
      }

      const replyTo = replyAddress(campagne.reply_token);

      try {
        const envoi = await sendEmail({
          from: fromAddress(identite, etape.user_id),
          to: campagne.destinataire,
          replyTo,
          subject: etape.objet || etape.titre || 'Bonjour',
          text: etape.message + mentionLegale({
            identite,
            profil,
            prospect: prospectParId[campagne.prospect_id],
          }),
          headers: {
            // Permet aux messageries d'afficher un bouton de
            // désinscription natif : bon pour la conformité, et
            // excellent pour la réputation d'expéditeur.
            'List-Unsubscribe': `<mailto:${replyTo}?subject=STOP>`,
          },
        });

        await sbFetch(`campaign_steps?id=eq.${etape.id}`, {
          method: 'PATCH',
          body: { provider_message_id: envoi?.id || null },
        });

        await sbFetch('email_events', {
          method: 'POST',
          body: {
            user_id: etape.user_id,
            campaign_id: campagne.id,
            step_id: etape.id,
            type: 'sent',
            payload: { position: etape.position, objet: etape.objet, provider_id: envoi?.id || null },
          },
        });

        compteurs[etape.user_id] = (compteurs[etape.user_id] || 0) + 1;
        resultats.envoyes++;

      } catch (err) {
        // L'envoi a échoué après la réservation : on repasse l'étape en
        // 'failed' (et pas en 'pending', pour ne pas boucler sur une
        // adresse définitivement invalide) et on trace la raison.
        await sbFetch(`campaign_steps?id=eq.${etape.id}`, {
          method: 'PATCH',
          body: { statut: 'failed', erreur: String(err.message).slice(0, 300) },
        });
        await sbFetch('email_events', {
          method: 'POST',
          body: {
            user_id: etape.user_id,
            campaign_id: campagne.id,
            step_id: etape.id,
            type: 'failed',
            payload: { erreur: String(err.message).slice(0, 300) },
          },
        });
        resultats.echecs++;
      }
    }

    // Campagnes dont toutes les étapes sont traitées : on les sort de
    // 'active' pour qu'elles cessent d'être requêtées à chaque tour.
    const campagnesTouchees = [...new Set(etapes.map(e => e.campaign.id))];
    for (const id of campagnesTouchees) {
      const restantes = await sbFetch(
        `campaign_steps?campaign_id=eq.${id}&statut=eq.pending&select=id&limit=1`
      );
      if (!restantes || restantes.length === 0) {
        await sbFetch(`campaigns?id=eq.${id}&statut=eq.active`, {
          method: 'PATCH',
          body: { statut: 'done' },
        });
      }
    }

    return res.status(200).json({ ok: true, ...resultats });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur cron : ' + err.message });
  }
}
