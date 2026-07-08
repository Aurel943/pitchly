/* ================================================================
   PITCHLY — landing.js
   Logique d'inscription/connexion sur la landing page (index.html).
   Ne fait que déclencher l'auth (Google ou lien email) puis redirige
   vers dashboard.html, qui enchaîne lui-même la complétion du compte
   et du profil métier.

   Important : la landing reste toujours consultable, session ou pas —
   pas de redirection automatique au chargement de la page. Seul un
   clic explicite sur Connexion/Inscription déclenche une redirection.
   ================================================================ */

const AUTH_MODAL_TEXT = {
  login: {
    title: 'content de te revoir',
    desc: 'connecte-toi pour retrouver ton espace.',
    switchText: 'toujours pas inscrit ? crée ton compte',
    switchMode: 'signup',
  },
  signup: {
    title: 'crée ton compte',
    desc: 'inscris-toi pour générer tes premiers scripts.',
    switchText: 'déjà inscrit ? connecte-toi',
    switchMode: 'login',
  },
};

let currentAuthMode = 'signup';

function openAuthModal(mode) {
  currentAuthMode = mode;
  const text = AUTH_MODAL_TEXT[mode] || AUTH_MODAL_TEXT.signup;
  document.getElementById('authModalTitle').textContent = text.title;
  document.getElementById('authModalDesc').textContent = text.desc;
  document.getElementById('authSwitchLink').textContent = text.switchText;
  document.getElementById('authStatus').textContent = '';
  document.getElementById('authModal').classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('authModal').classList.add('hidden');
}

function handleAuthSwitchClick() {
  const text = AUTH_MODAL_TEXT[currentAuthMode] || AUTH_MODAL_TEXT.signup;
  openAuthModal(text.switchMode);
}

async function handleCTAClick(mode) {
  const session = await getSession();
  if (session) {
    window.location.href = 'dashboard.html';
    return;
  }
  openAuthModal(mode);
}

async function handleEmailLinkClick() {
  const email = document.getElementById('authEmailInput').value.trim();
  const status = document.getElementById('authStatus');
  if (!email) return;

  const btn = document.getElementById('authEmailBtn');
  btn.disabled = true;

  const { error } = await signInWithEmailLink(email, window.location.origin + '/dashboard.html');

  btn.disabled = false;
  status.textContent = error
    ? 'erreur : ' + error.message
    : `lien envoyé à ${email}, vérifie ta boîte mail.`;
}

// Adapte la nav selon la session (sans jamais rediriger automatiquement) :
// connecté → "Mon dashboard" ; pas connecté → Connexion/Inscription.
document.addEventListener('DOMContentLoaded', async () => {
  const session = await getSession();
  document.querySelectorAll('.auth-link').forEach(el => el.classList.toggle('hidden', !!session));
  document.getElementById('navDashboardLink').classList.toggle('hidden', !session);
});
