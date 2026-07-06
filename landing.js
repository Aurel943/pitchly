/* ================================================================
   PITCHLY — landing.js
   Logique d'inscription/connexion sur la landing page (index.html).
   Ne fait que déclencher l'auth (Google ou lien email) puis redirige
   vers app.html, qui enchaîne lui-même la complétion du compte et du
   profil métier.
   ================================================================ */

function openAuthModal() {
  document.getElementById('authModal').classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('authModal').classList.add('hidden');
}

async function handleCTAClick() {
  const session = await getSession();
  if (session) {
    window.location.href = 'app.html';
    return;
  }
  openAuthModal();
}

async function handleEmailLinkClick() {
  const email = document.getElementById('authEmailInput').value.trim();
  const status = document.getElementById('authStatus');
  if (!email) return;

  const btn = document.getElementById('authEmailBtn');
  btn.disabled = true;

  const { error } = await signInWithEmailLink(email, window.location.origin + window.location.pathname);

  btn.disabled = false;
  status.textContent = error
    ? 'erreur : ' + error.message
    : `lien envoyé à ${email}, vérifie ta boîte mail.`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = await getSession();
  if (session) {
    window.location.href = 'app.html';
  }
});
