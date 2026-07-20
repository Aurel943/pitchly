/* ================================================================
   PITCHLY — auth.js
   Client Supabase + fonctions d'auth et de profil, partagés par
   index.html, app.html et compte.html.
   ================================================================ */

const SUPABASE_URL = 'https://evygjcmaxmnfusrvbjkk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_u7T90UhMnJsLSTK9yErA8w_VpT7NfGk';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;

// Quota mensuel gratuit — partagé entre le générateur de script et le
// générateur de réponses aux objections (une seule et même colonne
// quota_used/quota_month sur "profiles", pour borner le coût total d'API).
const QUOTA_GRATUIT = 5;

// Libellés lisibles pour l'affichage (les <select> stockent des codes courts)
const LABELS_SECTEUR = {
  coaching: 'coaching et bien-être',
  artisanat: 'artisanat / BTP',
  conseil: 'conseil et services intellectuels',
  creatif: 'freelance créatif',
  commerce: 'commerce et produit physique',
};

// Pipeline de statut des fiches prospects (prospects.html)
const LABELS_STATUT = {
  nouveau: 'nouveau',
  contacte: 'contacté',
  en_discussion: 'en discussion',
  gagne: 'gagné',
  perdu: 'perdu',
};

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getQuotaUsed(profile) {
  return profile.quota_month === currentMonthKey() ? profile.quota_used : 0;
}

async function incrementQuotaUsed(profile) {
  const usedThisMonth = getQuotaUsed(profile);
  return saveProfile({
    quota_used: usedThisMonth + 1,
    quota_month: currentMonthKey(),
  });
}

// Formate une date Supabase (ISO) en "8 juil. 2026 · 20:34"
function formatDateTime(isoString) {
  const d = new Date(isoString);
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

async function getSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) currentUser = session.user;
  return session;
}

async function signInWithGoogle(redirectTo) {
  await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo || window.location.href },
  });
}

async function signInWithEmailLink(email, redirectTo) {
  return supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo || window.location.href },
  });
}

async function handleLogout(afterHref) {
  await supabaseClient.auth.signOut();
  currentUser = null;
  window.location.href = afterHref || 'index.html';
}

async function getProfile() {
  const { data } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle();
  return data;
}

async function saveProfile(fields) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert({ id: currentUser.id, email: currentUser.email, ...fields })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Affiche/masque le champ texte libre à côté d'un <select> secteur
// quand l'option "autre" est choisie.
function toggleSecteurAutre(selectId, inputId) {
  const isAutre = document.getElementById(selectId).value === 'autre';
  document.getElementById(inputId).classList.toggle('hidden', !isAutre);
}

// Récupère et fusionne les scripts + objections sauvegardés d'un coup,
// triés par date décroissante. Partagé par les widgets du dashboard
// (activité récente, progression) qui ont tous besoin de croiser les
// deux tables de la même façon. prospectId (optionnel) restreint le
// résultat à l'historique d'un seul prospect (prospects.html).
async function getCombinedSaved({ filterRatedOnly = false, limit = null, prospectId = null, includeSequences = false } = {}) {
  let scriptsQuery = supabaseClient.from('saved_scripts').select('texte, outcome, created_at, prospect_id').order('created_at', { ascending: false });
  let objectionsQuery = supabaseClient.from('saved_objections').select('reponse, outcome, created_at, prospect_id').order('created_at', { ascending: false });
  // Les séquences ne sont croisées que pour l'apprentissage du style (opt-in) :
  // les widgets du dashboard (activité, progression) gardent leur périmètre
  // scripts+objections en n'activant pas ce drapeau.
  let sequencesQuery = includeSequences
    ? supabaseClient.from('saved_sequences').select('etapes, outcome, created_at, prospect_id').order('created_at', { ascending: false })
    : null;

  if (filterRatedOnly) {
    scriptsQuery = scriptsQuery.not('outcome', 'is', null);
    objectionsQuery = objectionsQuery.not('outcome', 'is', null);
    if (sequencesQuery) sequencesQuery = sequencesQuery.not('outcome', 'is', null);
  }
  if (prospectId) {
    scriptsQuery = scriptsQuery.eq('prospect_id', prospectId);
    objectionsQuery = objectionsQuery.eq('prospect_id', prospectId);
    if (sequencesQuery) sequencesQuery = sequencesQuery.eq('prospect_id', prospectId);
  }
  if (limit) {
    scriptsQuery = scriptsQuery.limit(limit);
    objectionsQuery = objectionsQuery.limit(limit);
    if (sequencesQuery) sequencesQuery = sequencesQuery.limit(limit);
  }

  const [{ data: scripts }, { data: objections }, sequencesRes] = await Promise.all([
    scriptsQuery,
    objectionsQuery,
    sequencesQuery || Promise.resolve({ data: [] }),
  ]);

  const merged = [
    ...(scripts || []).map(s => ({ type: 'script', text: s.texte, outcome: s.outcome, created_at: s.created_at })),
    ...(objections || []).map(o => ({ type: 'objection', text: o.reponse, outcome: o.outcome, created_at: o.created_at })),
    ...((sequencesRes && sequencesRes.data) || []).map(s => ({
      type: 'sequence',
      text: (Array.isArray(s.etapes) ? s.etapes.map(e => e.message).filter(Boolean).join('\n\n') : ''),
      outcome: s.outcome,
      created_at: s.created_at,
    })),
  ];

  return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Seuil minimum de retours notés avant de tenter d'en tirer des patterns —
// en dessous, le signal est trop faible pour que Claude en dégage quoi
// que ce soit d'utile.
const STYLE_PROFILE_MIN_RATED = 3;

// Régénère le "profil de style" de l'utilisateur — des patterns concrets
// (formulations, structure, ton) extraits par Claude de ses scripts et
// réponses aux objections notés 👍/👎 — puis réinjectés dans chaque
// génération future (voir /api/generate et /api/objections). C'est ce
// qui ne peut pas se reproduire en collant le même contexte dans un chat
// generaliste sans historique : la mémoire s'accumule ici, pas là-bas.
//
// Appelée après chaque changement de note. No-op silencieux si pas assez
// de signal ou si rien de neuf n'est arrivé depuis la dernière synthèse.
async function maybeRefreshStyleProfile(profile) {
  const rated = await getCombinedSaved({ filterRatedOnly: true, includeSequences: true });

  if (rated.length < STYLE_PROFILE_MIN_RATED) return profile;
  if (rated.length === profile.style_profile_rated_count) return profile;

  try {
    const response = await fetch('/api/refresh-style', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // les plus récents suffisent à dégager les patterns actuels, et ça
      // borne la taille (et le coût) de l'appel même après des centaines de retours
      body: JSON.stringify({ items: rated.slice(0, 30) }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('Échec de la génération du profil de style :', data.error);
      return profile;
    }

    return await saveProfile({
      style_profile: data.profile,
      style_profile_rated_count: rated.length,
    });
  } catch (err) {
    // non-bloquant pour la génération, mais visible en console pour ne
    // pas répéter le bug du 15/07/2026 (colonnes manquantes en base,
    // échec avalé en silence pendant plusieurs jours sans qu'on le sache)
    console.error('Échec de la mise à jour du profil de style :', err);
    return profile;
  }
}

// Liste des prospects de l'utilisateur, triés alphabétiquement (utilisée
// pour peupler les <select> et pour la liste de prospects.html).
async function getProspects() {
  const { data } = await supabaseClient.from('prospects').select('*').order('nom', { ascending: true });
  return data || [];
}

// Petit toast en bas d'écran — confirme visiblement une action qui n'a
// sinon aucun effet visuel immédiat (ex : marquer un feedback "a marché").
let toastTimeout = null;
function showToast(message, type = 'info') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type}`;
  requestAnimationFrame(() => toast.classList.add('visible'));
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2800);
}

/* ================================================================
   HELPERS UX PARTAGÉS
   ================================================================ */

// Confirmation en deux taps pour les actions destructrices : le premier
// tap "arme" le bouton (il affiche "sûr ?" pendant ~3 s), le second
// exécute. Remplace confirm() natif — bloquant, non stylable, et
// particulièrement laid sur mobile. Retourne true quand l'action est
// confirmée.
function confirmTap(ev) {
  const btn = ev && ev.currentTarget;
  if (!btn) return true; // appel sans bouton identifiable : ne pas bloquer

  if (btn.dataset.armed) {
    clearTimeout(btn._disarmTimer);
    delete btn.dataset.armed;
    // les boutons statiques (modales) survivent à l'action : on restaure
    btn.textContent = btn._origLabel;
    btn.classList.remove('arming');
    return true;
  }

  btn.dataset.armed = '1';
  btn._origLabel = btn.textContent;
  btn.textContent = 'sûr ?';
  btn.classList.add('arming');
  btn._disarmTimer = setTimeout(() => {
    delete btn.dataset.armed;
    btn.textContent = btn._origLabel;
    btn.classList.remove('arming');
  }, 2800);
  return false;
}

// Copie + toast de confirmation — pour les boutons copier qui n'ont pas
// de feedback visuel intégré (ceux des modales).
function copyWithToast(text) {
  navigator.clipboard.writeText(text);
  showToast('Copié dans le presse-papier.', 'info');
}

/* ================================================================
   UX GLOBALE DES MODALES
   Les modales marquées data-dismissable se ferment au clic sur le
   fond ou avec Échap. Les modales bloquantes du dashboard (connexion,
   onboarding) ne portent pas l'attribut : les fermer laisserait une
   page vide.
   ================================================================ */
document.addEventListener('click', (e) => {
  if (e.target.matches('.modal-overlay[data-dismissable]')) {
    e.target.classList.add('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay[data-dismissable]:not(.hidden)')
      .forEach(o => o.classList.add('hidden'));
  }

  // Entrée dans le champ email de connexion = envoyer le lien.
  if (e.key === 'Enter' && e.target.id === 'authEmailInput') {
    const btn = document.getElementById('authEmailBtn');
    if (btn && !btn.disabled) btn.click();
  }

  // Les pastilles (ton, tu/vous, filtres) sont des <span> : Entrée ou
  // Espace déclenche le clic pour rester utilisables au clavier.
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.pill, .filter')) {
    e.preventDefault();
    e.target.click();
  }
});

// Rend les pastilles atteignables au clavier (Tab) — elles sont des
// <span> statiques dans le HTML, plus simple de les équiper ici une fois.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.pill, .filter').forEach(el => {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
  });
});
