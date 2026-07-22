/* ================================================================
   api/campaigns/start.js  →  POST /api/campaigns/start

   Transforme une séquence RÉDIGÉE (saved_sequences) en séquence
   PROGRAMMÉE : crée la campagne et planifie chaque message à sa date.
   Rien n'est envoyé ici — c'est le cron (/api/cron/dispatch) qui
   enverra les étapes le moment venu. Cette route ne fait que décider
   du "quoi" et du "quand".

   Le texte des étapes est COPIÉ dans campaign_steps plutôt que lu
   depuis la séquence au moment de l'envoi : l'utilisateur doit pouvoir
   retoucher ou supprimer sa séquence sans modifier à son insu des
   messages déjà programmés chez un prospect.

   Corps attendu : { sequenceId, prospectId?, email?, demarrage? }
   ================================================================ */

import {
  requireUser,
  sbFetch,
  joursDepuisLancement,
  prochainCreneauOuvre,
  destinataireInterditEnTest,
  verifierQuotaCampagnes,
} from '../_lib.js';

// Garde-fou simple : on ne cherche pas à valider parfaitement une
// adresse (impossible), juste à écarter les saisies manifestement
// fausses avant de brûler de la réputation d'envoi dessus.
function emailPlausible(valeur) {
  return typeof valeur === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur.trim());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const user = await requireUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Session expirée, reconnecte-toi.' });
  }

  const { sequenceId, prospectId, email, demarrage } = req.body || {};
  if (!sequenceId) {
    return res.status(400).json({ error: 'sequenceId manquant' });
  }

  try {
    // --- La séquence, en vérifiant qu'elle appartient bien à l'appelant.
    // Le filtre user_id n'est pas décoratif : on est en service_role, RLS
    // ne nous protège plus.
    const sequences = await sbFetch(
      `saved_sequences?id=eq.${sequenceId}&user_id=eq.${user.id}&select=*`
    );
    const sequence = sequences?.[0];
    if (!sequence) {
      return res.status(404).json({ error: 'Séquence introuvable.' });
    }
    if (sequence.canal !== 'email') {
      return res.status(400).json({ error: "Seules les séquences email peuvent être envoyées automatiquement pour l'instant." });
    }

    const etapes = Array.isArray(sequence.etapes) ? sequence.etapes : [];
    if (etapes.length === 0) {
      return res.status(400).json({ error: 'Cette séquence ne contient aucune étape.' });
    }

    // --- Le prospect et son adresse.
    let prospect = null;
    if (prospectId) {
      const prospects = await sbFetch(
        `prospects?id=eq.${prospectId}&user_id=eq.${user.id}&select=*`
      );
      prospect = prospects?.[0] || null;
      if (!prospect) return res.status(404).json({ error: 'Prospect introuvable.' });

      // Un prospect qui s'est désinscrit ne redevient jamais contactable,
      // même via une nouvelle séquence. C'est le seul refus non
      // contournable de cette route.
      if (prospect.opted_out_at) {
        return res.status(403).json({
          error: 'Ce prospect a demandé à ne plus être contacté. Impossible de lui envoyer une séquence.',
        });
      }
    }

    const destinataire = (email || prospect?.email || '').trim();
    if (!emailPlausible(destinataire)) {
      return res.status(400).json({ error: "Adresse email du prospect manquante ou invalide." });
    }

    // Si l'adresse a été saisie au lancement, on la garde sur la fiche
    // prospect : elle resservira pour les campagnes suivantes.
    if (prospect && !prospect.email) {
      await sbFetch(`prospects?id=eq.${prospect.id}&user_id=eq.${user.id}`, {
        method: 'PATCH',
        body: { email: destinataire },
      });
    }

    // --- Une seule campagne active à la fois par prospect : deux séquences
    // qui tournent en parallèle sur la même personne, c'est le meilleur moyen
    // de se faire marquer comme spam.
    if (prospect) {
      const enCours = await sbFetch(
        `campaigns?user_id=eq.${user.id}&prospect_id=eq.${prospect.id}&statut=eq.active&select=id`
      );
      if (enCours?.length > 0) {
        return res.status(409).json({
          error: 'Une séquence est déjà en cours sur ce prospect. Arrête-la avant d\'en lancer une autre.',
        });
      }
    }

    // --- Quota de campagnes du plan. Contrôlé ici, après les validations
    // de fond : refuser d'abord sur le quota ferait croire à une limite de
    // compte alors que la séquence était de toute façon inenvoyable.
    const quota = await verifierQuotaCampagnes(user);
    if (!quota.ok) {
      return res.status(402).json({ error: quota.error, upgrade: true });
    }

    // --- Identité d'envoi : créée à la volée au premier lancement, en
    // mode mutualisé, pour que l'utilisateur puisse partir sans config DNS.
    let identite = (await sbFetch(`sending_identities?user_id=eq.${user.id}&select=*`))?.[0];
    if (!identite) {
      const profils = await sbFetch(`profiles?id=eq.${user.id}&select=nom,email`);
      identite = (await sbFetch('sending_identities', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          user_id: user.id,
          mode: 'shared',
          from_name: profils?.[0]?.nom || null,
          reply_to_real: profils?.[0]?.email || user.email || null,
        },
      }))?.[0];
    }

    // En mode test (aucun domaine d'envoi configuré), on ne peut écrire
    // qu'à soi-même. Le refus intervient ici, avant toute programmation :
    // planifier des messages qui échoueront un par un dans le cron serait
    // le pire des deux mondes.
    const refusTest = destinataireInterditEnTest(destinataire, identite);
    if (refusTest) {
      return res.status(403).json({ error: refusTest });
    }

    // --- La campagne. reply_token est généré par la base (valeur par
    // défaut), on demande la ligne créée en retour pour le récupérer.
    const creees = await sbFetch('campaigns', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: user.id,
        prospect_id: prospect?.id || null,
        sequence_id: sequence.id,
        nom: sequence.nom || sequence.objectif,
        canal: 'email',
        destinataire,
        statut: 'active',
      },
    });
    const campaign = creees?.[0];
    if (!campaign) throw new Error('Création de campagne sans retour');

    // --- Planification. Le point de départ est maintenant (ou la date
    // demandée), recalé sur le prochain créneau ouvré ; chaque étape
    // s'ajoute en jours depuis ce point de départ.
    const depart = prochainCreneauOuvre(demarrage ? new Date(demarrage) : new Date());

    const steps = etapes.map((etape, i) => {
      const jours = joursDepuisLancement(etape.delai, i);
      const date = new Date(depart);
      date.setUTCDate(date.getUTCDate() + jours);

      return {
        campaign_id: campaign.id,
        user_id: user.id,
        position: i,
        titre: etape.titre || null,
        objet: etape.objet || null,
        message: etape.message || '',
        send_at: prochainCreneauOuvre(date).toISOString(),
        statut: 'pending',
      };
    });

    await sbFetch('campaign_steps', { method: 'POST', body: steps });

    return res.status(200).json({
      campaign: { id: campaign.id, statut: campaign.statut, destinataire },
      etapes: steps.map(s => ({ position: s.position, titre: s.titre, send_at: s.send_at })),
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
