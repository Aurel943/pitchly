/* ================================================================
   api/diagnostic.js  →  GET /api/diagnostic

   Contrôle de câblage. Le circuit d'envoi dépend de six variables
   d'environnement, d'un domaine vérifié chez Resend et d'un webhook
   correctement branché : quand un maillon manque, le symptôme visible
   est "rien ne part", sans indice sur le maillon fautif.

   Cette route répond à une seule question : qu'est-ce qui manque ?

   Elle ne renvoie JAMAIS la valeur d'un secret — uniquement des
   booléens "présent / absent" et des informations publiques (noms de
   domaines, statut de vérification). Une clé API ne doit pas pouvoir
   fuir par une route de diagnostic.

   Authentifiée : réservée à un utilisateur connecté.
   ================================================================ */

import { requireUser, sbFetch, INBOUND_DOMAIN, SHARED_SENDING_DOMAIN, MODE_TEST } from './_lib.js';

export default async function handler(req, res) {
  const user = await requireUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Session expirée, reconnecte-toi.' });
  }

  // SHARED_SENDING_DOMAIN est volontairement absent des variables
  // requises : son absence n'est pas une erreur, c'est ce qui déclenche
  // le mode test (envoi possible uniquement vers sa propre adresse).
  const variables = {
    RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
    RESEND_WEBHOOK_SECRET: Boolean(process.env.RESEND_WEBHOOK_SECRET),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
    INBOUND_DOMAIN: Boolean(process.env.INBOUND_DOMAIN),
  };

  const rapport = {
    mode: MODE_TEST ? 'test' : 'production',
    modeExplication: MODE_TEST
      ? "Aucun domaine d'envoi configuré : les emails partent de onboarding@resend.dev et ne peuvent aller qu'à ta propre adresse."
      : "Domaine d'envoi configuré : les emails peuvent partir vers de vrais prospects.",
    variables,
    domaines: {
      envoi: SHARED_SENDING_DOMAIN || 'onboarding@resend.dev (mode test)',
      reception: INBOUND_DOMAIN,
    },
    resend: { joignable: false, domainesVerifies: [], erreur: null },
    base: { identiteEnvoi: false, campagnes: null, erreur: null },
    manquant: Object.entries(variables).filter(([, ok]) => !ok).map(([nom]) => nom),
  };

  // Le seul test qui prouve que la clé Resend est valide : s'en servir.
  // /domains est en lecture seule et n'envoie rien.
  if (variables.RESEND_API_KEY) {
    try {
      const reponse = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      if (reponse.ok) {
        const data = await reponse.json();
        rapport.resend.joignable = true;
        rapport.resend.domainesVerifies = (data?.data || [])
          .map(d => ({ nom: d.name, statut: d.status }));
      } else {
        rapport.resend.erreur = `HTTP ${reponse.status} — clé refusée par Resend`;
      }
    } catch (err) {
      rapport.resend.erreur = err.message;
    }
  }

  if (variables.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const identites = await sbFetch(`sending_identities?user_id=eq.${user.id}&select=user_id,mode,domain_status`);
      rapport.base.identiteEnvoi = (identites?.length || 0) > 0;
      const campagnes = await sbFetch(`campaigns?user_id=eq.${user.id}&select=statut`);
      rapport.base.campagnes = {
        total: campagnes?.length || 0,
        actives: (campagnes || []).filter(c => c.statut === 'active').length,
      };
    } catch (err) {
      rapport.base.erreur = err.message;
    }
  }

  // Verdict lisible d'un coup d'œil, pour ne pas avoir à interpréter le
  // détail : soit tout est prêt, soit on sait quoi corriger. En mode
  // test, aucun domaine vérifié n'est attendu — l'exiger afficherait
  // "pas prêt" alors que le circuit fonctionne.
  rapport.pret = rapport.manquant.length === 0
    && rapport.resend.joignable
    && (MODE_TEST || rapport.resend.domainesVerifies.some(d => d.statut === 'verified'));

  return res.status(200).json(rapport);
}
