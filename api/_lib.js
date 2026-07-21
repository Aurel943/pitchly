/* ================================================================
   api/_lib.js
   Briques partagées par les routes qui ENVOIENT des emails.

   Les fichiers préfixés par "_" ne sont pas exposés comme routes par
   Vercel : c'est un module interne, jamais appelable depuis le web.

   Trois responsabilités, volontairement séparées :
     1. requireUser()  — vérifier qui parle, côté serveur
     2. sbFetch()      — parler à Supabase en service_role (hors RLS)
     3. sendEmail()    — parler à Resend

   Pourquoi une vraie vérif d'identité ici, alors que /api/generate
   n'en a pas : générer du texte coûte des tokens, envoyer un email
   engage la réputation d'un domaine et peut spammer de vrais gens.
   Une route d'envoi non authentifiée est un relais ouvert.
   ================================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://evygjcmaxmnfusrvbjkk.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_u7T90UhMnJsLSTK9yErA8w_VpT7NfGk';

// Clé service_role : contourne toutes les policies RLS. Elle ne doit
// exister que dans les variables d'environnement Vercel, jamais dans
// le front, jamais dans le repo.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Domaine mutualisé d'expédition tant que l'utilisateur n'a pas vérifié
// le sien (mode 'shared' de sending_identities).
const SHARED_SENDING_DOMAIN = process.env.SHARED_SENDING_DOMAIN || 'envois.pitchly.app';

// Domaine qui reçoit les réponses des prospects (MX pointés vers Resend
// inbound). Chaque campagne y a son adresse reply+<token>@…
const INBOUND_DOMAIN = process.env.INBOUND_DOMAIN || 'reponses.pitchly.app';

/* ---------------------------------------------------------------
   Identité de l'appelant
   --------------------------------------------------------------- */

// Vérifie le JWT Supabase envoyé par le front dans "Authorization:
// Bearer <access_token>". On ne décode pas le token nous-mêmes (il
// faudrait vérifier la signature) : on demande à Supabase qui il est,
// ce qui valide signature ET expiration ET révocation d'un coup.
// Renvoie l'objet user, ou null si le token est absent/invalide.
export async function requireUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (!header.startsWith('Bearer ')) return null;

  const token = header.slice(7);

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
  return `${nom} <u${String(userId).slice(0, 8)}@${SHARED_SENDING_DOMAIN}>`;
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
  const jour = d.getUTCDay();          // 0 = dimanche, 6 = samedi
  const heure = d.getUTCHours();

  if (jour === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (jour === 0) d.setUTCDate(d.getUTCDate() + 1);

  if (heure < 7) {
    d.setUTCHours(7, 30, 0, 0);        // 9h30 en heure de Paris (UTC+2)
  } else if (heure >= 15) {
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(7, 30, 0, 0);
    const nouveauJour = d.getUTCDay();
    if (nouveauJour === 6) d.setUTCDate(d.getUTCDate() + 2);
    if (nouveauJour === 0) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

export { SUPABASE_URL, INBOUND_DOMAIN, SHARED_SENDING_DOMAIN };
