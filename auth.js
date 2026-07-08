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
    .upsert({ id: currentUser.id, ...fields })
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
