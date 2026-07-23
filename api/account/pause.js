/* ================================================================
   api/account/pause.js  →  POST /api/account/pause

   Met le compte en pause, ou le réactive.

   Pourquoi cette route existe : un indépendant ne prospecte pas de
   façon continue. Il a un creux, il prospecte trois semaines, il signe
   deux clients, il arrête six mois. Sans mode pause, la seule action
   disponible pendant le creux est la résiliation — et un compte résilié
   ne revient pas, alors qu'un compte en pause, si.

   Ce que la pause fait vraiment :
     - le cron cesse d'envoyer pour cet utilisateur (dispatch.js lit
       paused_at) ;
     - aucune nouvelle campagne ne peut être lancée ;
     - rien n'est supprimé : prospects, séquences et campagnes restent.

   Ce que la reprise fait, et c'est le point délicat : les étapes encore
   en attente ont une date d'envoi devenue fausse. On ne peut pas les
   envoyer telles quelles (tout partirait d'un coup, le prospect
   recevrait la relance J+7 en même temps que la J+3) ni les laisser en
   place. On les décale donc de la durée exacte de la pause, ce qui
   restitue l'espacement validé au lancement.

   Au-delà de PAUSE_LONGUE_JOURS, on ne décale plus : on arrête les
   campagnes. Relancer une séquence après deux mois de silence, c'est
   écrire « je reviens vers vous » à quelqu'un qui a oublié le premier
   message — mieux vaut repartir d'une séquence neuve.

   Corps attendu : { action: 'pause' | 'reprendre' }
   ================================================================ */

import {
  requireUser,
  sbFetch,
  prochainCreneauOuvre,
  PAUSE_LONGUE_JOURS,
} from '../_lib.js';

const JOUR_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const user = await requireUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Session expirée, reconnecte-toi.' });
  }

  const action = req.body?.action;
  if (action !== 'pause' && action !== 'reprendre') {
    return res.status(400).json({ error: "action attendue : 'pause' ou 'reprendre'" });
  }

  try {
    const profils = await sbFetch(`profiles?id=eq.${user.id}&select=paused_at`);
    const pauseEnCours = profils?.[0]?.paused_at || null;

    /* ---------------- MISE EN PAUSE ---------------- */
    if (action === 'pause') {
      if (pauseEnCours) {
        return res.status(200).json({ paused_at: pauseEnCours, dejaEnPause: true });
      }

      const debut = new Date().toISOString();
      await sbFetch(`profiles?id=eq.${user.id}`, {
        method: 'PATCH',
        body: { paused_at: debut },
      });

      // On compte ce qui est suspendu pour pouvoir le dire à
      // l'utilisateur : « mise en pause » sans indiquer ce qui s'arrête
      // laisse croire que les messages déjà programmés vont partir.
      const enAttente = await sbFetch(
        `campaign_steps?user_id=eq.${user.id}&statut=eq.pending&select=id`
      );

      return res.status(200).json({
        paused_at: debut,
        etapesSuspendues: enAttente?.length || 0,
      });
    }

    /* ---------------- REPRISE ---------------- */
    if (!pauseEnCours) {
      return res.status(200).json({ paused_at: null, dejaActif: true });
    }

    const ecoule = Date.now() - new Date(pauseEnCours).getTime();
    const jours = Math.round(ecoule / JOUR_MS);

    // Pause longue : les séquences en cours sont périmées, on les arrête
    // au lieu de les décaler. Les campagnes passent en 'stopped' et leurs
    // étapes en attente en 'cancelled' — l'historique des envois déjà
    // faits reste intact, seul ce qui n'est pas parti est annulé.
    if (ecoule > PAUSE_LONGUE_JOURS * JOUR_MS) {
      const actives = await sbFetch(
        `campaigns?user_id=eq.${user.id}&statut=eq.active&select=id`
      );

      for (const campagne of actives || []) {
        await sbFetch(
          `campaign_steps?campaign_id=eq.${campagne.id}&user_id=eq.${user.id}&statut=eq.pending`,
          {
            method: 'PATCH',
            body: {
              statut: 'cancelled',
              erreur: `Campagne arrêtée au retour d'une pause de ${jours} jours.`,
            },
          }
        );
        await sbFetch(`campaigns?id=eq.${campagne.id}&user_id=eq.${user.id}`, {
          method: 'PATCH',
          body: { statut: 'stopped' },
        });
      }

      await sbFetch(`profiles?id=eq.${user.id}`, {
        method: 'PATCH',
        body: { paused_at: null },
      });

      return res.status(200).json({
        paused_at: null,
        jours,
        campagnesArretees: actives?.length || 0,
      });
    }

    // Pause courte : on décale chaque étape en attente de la durée exacte
    // de la pause, puis on recale sur un créneau ouvré. Le PATCH est fait
    // ligne par ligne parce que PostgREST ne sait pas écrire une valeur
    // calculée par ligne ; le volume est celui des étapes en attente d'un
    // seul utilisateur, donc quelques dizaines au plus.
    const enAttente = await sbFetch(
      `campaign_steps?user_id=eq.${user.id}&statut=eq.pending` +
      `&select=id,send_at,campaign:campaigns!inner(statut)&campaign.statut=eq.active`
    );

    for (const etape of enAttente || []) {
      const decalee = prochainCreneauOuvre(
        new Date(new Date(etape.send_at).getTime() + ecoule)
      );
      await sbFetch(`campaign_steps?id=eq.${etape.id}&user_id=eq.${user.id}`, {
        method: 'PATCH',
        body: { send_at: decalee.toISOString() },
      });
    }

    await sbFetch(`profiles?id=eq.${user.id}`, {
      method: 'PATCH',
      body: { paused_at: null },
    });

    return res.status(200).json({
      paused_at: null,
      jours,
      etapesDecalees: enAttente?.length || 0,
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
