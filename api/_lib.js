/* ================================================================
   api/_lib.js
   Briques partagées par les routes qui ENVOIENT des emails.

   Les fichiers préfixés par "_" ne sont pas exposés comme routes par
   Vercel : c'est un module interne, jamais appelable depuis le web.

   Quatre responsabilités, volontairement séparées :
     1. requireUser()  — vérifier qui parle, côté serveur
     2. sbFetch()      — parler à Supabase en service_role (hors RLS)
     3. sendEmail()    — parler à Resend
     4. exigerGeneration() — identité + quota du plan, avant tout appel Claude

   Toutes les routes sont authentifiées, sans exception. Une route de
   génération ouverte est un proxy Claude gratuit que n'importe qui peut
   vider ; une route d'envoi ouverte est un relais à spam. Le site n'a
   plus de mot de passe global (le middleware Basic Auth a été supprimé
   le 22/07/2026 pour ouvrir les inscriptions) : ces vérifications sont
   désormais la seule protection du budget d'API.
   ================================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://evygjcmaxmnfusrvbjkk.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_u7T90UhMnJsLSTK9yErA8w_VpT7NfGk';

// Clé service_role : contourne toutes les policies RLS. Elle ne doit
// exister que dans les variables d'environnement Vercel, jamais dans
// le front, jamais dans le repo.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// MODE TEST — pour valider le circuit complet sans posséder de domaine.
//
// Resend autorise l'envoi depuis onboarding@resend.dev sans aucune
// vérification DNS, mais uniquement vers l'adresse du titulaire du
// compte. C'est suffisant pour éprouver toute la chaîne (planification,
// cron, réponse, arrêt des relances) en s'envoyant des messages à
// soi-même.
//
// Le mode s'active tant qu'aucun domaine d'expédition n'est configuré :
// impossible d'oublier de le désactiver, il disparaît de lui-même le
// jour où SHARED_SENDING_DOMAIN est renseigné.
const SHARED_SENDING_DOMAIN = process.env.SHARED_SENDING_DOMAIN || null;
const MODE_TEST = !SHARED_SENDING_DOMAIN;
const EXPEDITEUR_TEST = 'onboarding@resend.dev';

// Domaine qui reçoit les réponses des prospects. En production ce sera
// un sous-domaine à nous (MX pointés vers Resend) ; en test c'est le
// domaine managé fourni par Resend, qui ne demande aucun DNS et accepte
// n'importe quelle adresse (catch-all) — d'où le token en partie locale.
//
// Le repli n'est pas un exemple mais le vrai domaine de réception du
// compte : une variable oubliée ferait fabriquer des adresses de
// réponse inexistantes, et les réponses des prospects partiraient dans
// le vide sans qu'aucune erreur ne le signale.
const INBOUND_DOMAIN = process.env.INBOUND_DOMAIN || 'estiejoraa.resend.app';

/* ---------------------------------------------------------------
   Identité de l'appelant
   --------------------------------------------------------------- */

// Vérifie le JWT Supabase envoyé par le front.
//
// Le jeton voyage dans "X-Pitchly-Token", et "Authorization: Bearer"
// n'est qu'un repli pour les appels hors navigateur (curl, tests).
// Cet en-tête maison est un héritage du Basic Auth qui protégeait tout
// le site : le navigateur y rejouait ses identifiants, et un fetch()
// posant "Authorization" les écrasait, ce qui redemandait le mot de
// passe en boucle. Le Basic Auth a disparu, mais la convention reste —
// elle ne coûte rien et évite d'aller retoucher chaque appel du front.
//
// On ne décode pas le jeton nous-mêmes (il faudrait vérifier la
// signature) : on demande à Supabase qui il est, ce qui valide
// signature ET expiration ET révocation d'un coup.
// Renvoie l'objet user, ou null si le jeton est absent/invalide.
export async function requireUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = req.headers['x-pitchly-token']
    || (header.startsWith('Bearer ') ? header.slice(7) : null);

  if (!token) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------
   Accès base en service_role
   --------------------------------------------------------------- */

// Appel PostgREST avec la clé service_role. RLS est contournée, donc
// TOUTE requête écrite ici doit filtrer explicitement sur user_id :
// c'est le code qui porte l'isolation entre comptes, plus la base.
export async function sbFetch(path, { method = 'GET', body, prefer } = {}) {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante');

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} sur ${path} : ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/* ---------------------------------------------------------------
   Plans et quotas
   --------------------------------------------------------------- */

// La grille tarifaire, définie une seule fois et faisant autorité.
// Le front en a une copie d'affichage (PLANS_AFFICHAGE dans auth.js),
// mais c'est bien celle-ci qui décide : un quota appliqué uniquement
// dans le navigateur se contourne avec la console.
//
// generations : appels Claude par mois (null = illimité)
// campagnes   : campagnes lancées par mois — l'axe qui porte le prix,
//               parce que c'est lui qui porte à la fois notre coût
//               d'envoi et la valeur perçue par le vendeur.
export const PLANS = {
  free: { label: 'Découverte', generations: 5, campagnes: 1 },
  solo: { label: 'Solo', generations: 100, campagnes: 50 },
  pro: { label: 'Pro', generations: null, campagnes: 300 },
};

export function planDe(profile) {
  return PLANS[profile?.plan] ? profile.plan : 'free';
}

export function moisCourant() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Consomme une génération sur le quota du mois, ou refuse.
//
// Le compteur se remet à zéro par comparaison de "quota_month" plutôt
// que par une tâche planifiée : il n'y a rien à déclencher le 1er du
// mois, et un compte inactif pendant six mois repart juste à zéro.
//
// Lecture puis écriture, sans verrou : deux générations lancées dans la
// même seconde peuvent n'en décompter qu'une. C'est un dépassement d'une
// unité sur un quota mensuel, pas la peine d'une transaction pour ça.
async function consommerGeneration(user) {
  // On récupère aussi le profil métier au passage : la requête est déjà
  // faite, et une route qui le lit ici n'a pas à croire le secteur et le
  // panier que le navigateur lui envoie.
  const rows = await sbFetch(`profiles?id=eq.${user.id}&select=plan,quota_used,quota_month,secteur,offre,panier,style_profile`);
  const profile = rows?.[0];
  if (!profile) {
    return { ok: false, status: 403, error: "Profil introuvable — complète ton profil avant de générer." };
  }

  const plan = planDe(profile);
  const limite = PLANS[plan].generations;
  const mois = moisCourant();
  const used = profile.quota_month === mois ? (profile.quota_used || 0) : 0;

  if (limite !== null && used >= limite) {
    return {
      ok: false,
      status: 402,
      error: `Tu as utilisé tes ${limite} générations du mois sur le plan ${PLANS[plan].label}.`,
      upgrade: true,
    };
  }

  await sbFetch(`profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    body: { quota_used: used + 1, quota_month: mois },
  });

  return { ok: true, plan, limite, used: used + 1, profile };
}

// Vérifie le quota de campagnes du mois avant d'en lancer une nouvelle.
//
// Contrairement aux générations, on ne tient pas de compteur : on compte
// les campagnes réellement créées depuis le 1er du mois. Une campagne est
// une ligne durable, donc la source de vérité est déjà en base — un
// compteur séparé ne pourrait que diverger d'elle.
export async function verifierQuotaCampagnes(user) {
  const profils = await sbFetch(`profiles?id=eq.${user.id}&select=plan`);
  const plan = planDe(profils?.[0]);
  const limite = PLANS[plan].campagnes;

  const debutDuMois = `${moisCourant()}-01T00:00:00Z`;
  const lancees = await sbFetch(
    `campaigns?user_id=eq.${user.id}&created_at=gte.${debutDuMois}&select=id`
  );

  if ((lancees?.length || 0) >= limite) {
    return {
      ok: false,
      error: plan === 'free'
        ? "Le plan Découverte permet une campagne d'essai. Passe au plan Solo pour lancer tes vraies séquences."
        : `Tu as lancé tes ${limite} campagnes du mois sur le plan ${PLANS[plan].label}.`,
    };
  }
  return { ok: true };
}

// Portier commun aux trois routes de génération : identité, puis quota.
// Renvoie le verdict, ou null après avoir déjà répondu à la requête —
// l'appelant n'a qu'à sortir si c'est null.
export async function exigerGeneration(req, res) {
  const user = await requireUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session expirée — reconnecte-toi pour générer.' });
    return null;
  }

  const verdict = await consommerGeneration(user);
  if (!verdict.ok) {
    res.status(verdict.status).json({ error: verdict.error, upgrade: !!verdict.upgrade });
    return null;
  }

  return {
    user,
    profil: verdict.profile,
    quota: { used: verdict.used, limite: verdict.limite, plan: verdict.plan },
  };
}

/* ---------------------------------------------------------------
   Envoi d'email
   --------------------------------------------------------------- */

// Adresse de réponse d'une campagne. C'est la pièce centrale du
// dispositif : le prospect répond à cette adresse, Resend nous pousse
// le message en webhook, et le token nous dit de quelle campagne il
// s'agit — sans jamais accéder à la boîte mail du vendeur.
//
// Le token occupe TOUTE la partie locale (préfixée d'un "r" pour ne pas
// commencer par un chiffre) au lieu d'un sous-adressage "reply+token@" :
// le plus-addressing dépend du routage du domaine de réception et n'est
// pas garanti, alors qu'une adresse pleine fonctionne partout où le
// domaine accepte le courrier.
export function replyAddress(token) {
  return `r${token}@${INBOUND_DOMAIN}`;
}

// Récupère le contenu complet d'un email reçu.
//
// Indispensable : le webhook email.received ne transporte QUE des
// métadonnées (expéditeur, destinataires, sujet, pièces jointes) — le
// corps du message n'y est pas. Sans cet appel, la détection du STOP
// s'exécuterait sur une chaîne vide et le relais au vendeur arriverait
// sans le message du prospect.
export async function fetchReceivedEmail(id) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY manquante');

  const res = await fetch(`https://api.resend.com/emails/receiving/${id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Resend receiving ${res.status}`);
  }
  return res.json();
}

// Construit l'expéditeur à partir de l'identité d'envoi de l'utilisateur.
// En mode 'shared', on part du domaine mutualisé avec une adresse dédiée
// par utilisateur (pas une adresse unique pour tout le monde : la
// réputation d'un vendeur ne doit pas polluer celle des autres).
export function fromAddress(identity, userId) {
  const nom = identity?.from_name?.trim() || 'Pitchly';

  if (identity?.mode === 'domain' && identity.domain_status === 'verified' && identity.from_email) {
    return `${nom} <${identity.from_email}>`;
  }
  if (MODE_TEST) {
    return `${nom} <${EXPEDITEUR_TEST}>`;
  }
  return `${nom} <u${String(userId).slice(0, 8)}@${SHARED_SENDING_DOMAIN}>`;
}

// Garde-fou du mode test : Resend refuserait de toute façon un envoi
// vers un tiers depuis onboarding@resend.dev, mais l'échec surviendrait
// APRÈS la programmation de la séquence — l'utilisateur croirait avoir
// lancé une campagne qui ne partira jamais. On refuse donc en amont,
// avec un message qui explique pourquoi.
export function destinataireInterditEnTest(destinataire, identity) {
  if (!MODE_TEST) return null;

  const autorisee = (identity?.reply_to_real || '').trim().toLowerCase();
  if (autorisee && destinataire.trim().toLowerCase() === autorisee) return null;

  return `Mode test : tant qu'aucun domaine d'envoi n'est configuré, Pitchly ne peut écrire qu'à ta propre adresse${autorisee ? ` (${autorisee})` : ''}. Configure un domaine d'expédition pour contacter de vrais prospects.`;
}

// Envoi via l'API REST de Resend (pas de SDK : le projet n'a aucune
// dépendance npm et fetch suffit).
// Renvoie { id } en cas de succès, lève sinon.
export async function sendEmail({ from, to, replyTo, subject, text, headers }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY manquante');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: replyTo,
      subject,
      text,
      headers,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `Resend ${res.status}`);
  }
  return data;
}

/* ---------------------------------------------------------------
   Petits utilitaires
   --------------------------------------------------------------- */

// Les délais de séquence sont générés en texte libre par Claude
// ("J+0", "J+3", "J + 7"…). On en extrait le nombre de jours depuis le
// LANCEMENT de la campagne (c'est ainsi que la progression J+0/J+3/J+7
// est produite par /api/sequence). En cas de délai illisible, on
// retombe sur un espacement de 3 jours par étape plutôt que d'envoyer
// tout le monde immédiatement.
export function joursDepuisLancement(delai, position) {
  const match = String(delai || '').match(/\d+/);
  if (match) return parseInt(match[0], 10);
  return position * 3;
}

// Les emails de prospection partent aux heures ouvrées : un premier
// contact reçu un dimanche à 3h du matin se fait supprimer sans être lu.
// On décale au prochain créneau lundi-vendredi 9h-17h.
export function prochainCreneauOuvre(date) {
  const d = new Date(date);

  // 1. L'heure d'abord. Trop tôt : on cale à l'ouverture du jour même.
  //    Trop tard : on bascule à l'ouverture du lendemain.
  //    (7h30 UTC = 9h30 à Paris en été.)
  const heure = d.getUTCHours();
  if (heure < 7) {
    d.setUTCHours(7, 30, 0, 0);
  } else if (heure >= 15) {
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(7, 30, 0, 0);
  }

  // 2. Le week-end ensuite, sur la date éventuellement décalée ci-dessus.
  //    Traiter les jours avant les heures ferait perdre un jour ouvré :
  //    un samedi soir sautait le lundi pour atterrir le mardi.
  while (d.getUTCDay() === 6 || d.getUTCDay() === 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(7, 30, 0, 0);
  }

  return d;
}

export { SUPABASE_URL, INBOUND_DOMAIN, SHARED_SENDING_DOMAIN, MODE_TEST };
