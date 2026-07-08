/* ================================================================
   PITCHLY — dashboard.js
   Page dashboard.html : point d'entrée après connexion. Possède la
   gate complète (session → infos de compte → profil métier), puis
   affiche un aperçu (quota) et des raccourcis vers l'app, les scripts
   sauvegardés et le compte.
   ================================================================ */

const QUOTA_GRATUIT = 5;

function showOnly(overlayId) {
  document.getElementById('authModal').classList.toggle('hidden', overlayId !== 'authModal');
  document.getElementById('accountInfoModal').classList.toggle('hidden', overlayId !== 'accountInfoModal');
  document.getElementById('onboardingModal').classList.toggle('hidden', overlayId !== 'onboardingModal');
  document.getElementById('mainDashboard').classList.toggle('hidden', overlayId !== 'mainDashboard');
}

async function initAuthGate() {
  const session = await getSession();

  if (!session) {
    showOnly('authModal');
    return;
  }

  document.getElementById('logoutBtn').classList.remove('hidden');

  const profile = await getProfile();

  if (!profile || !profile.nom) {
    showOnly('accountInfoModal');
    return;
  }

  if (!profile.secteur) {
    showOnly('onboardingModal');
    return;
  }

  showOnly('mainDashboard');
  renderDashboard(profile);
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session && !currentUser) {
    initAuthGate();
  }
});

async function handleEmailLinkClick() {
  const email = document.getElementById('authEmailInput').value.trim();
  const status = document.getElementById('authStatus');
  if (!email) return;

  const btn = document.getElementById('authEmailBtn');
  btn.disabled = true;

  const { error } = await signInWithEmailLink(email);

  btn.disabled = false;
  status.textContent = error
    ? 'erreur : ' + error.message
    : `lien envoyé à ${email}, vérifie ta boîte mail.`;
}

async function handleAccountInfoSubmit() {
  try {
    const profile = await saveProfile({
      nom: document.getElementById('accountNomInput').value.trim(),
      date_naissance: document.getElementById('accountDateNaissanceInput').value || null,
      telephone: document.getElementById('accountTelephoneInput').value.trim(),
    });
    if (!profile.secteur) {
      showOnly('onboardingModal');
      return;
    }
    showOnly('mainDashboard');
    renderDashboard(profile);
  } catch (err) {
    alert('Erreur lors de la sauvegarde du compte : ' + err.message);
  }
}

function openOnboarding() {
  showOnly('onboardingModal');
}

async function handleOnboardingSubmit() {
  try {
    const secteurValue = document.getElementById('secteurInput').value;
    const secteurAutre = document.getElementById('secteurAutreInput').value.trim();

    const profile = await saveProfile({
      secteur: secteurValue === 'autre' && secteurAutre ? secteurAutre : secteurValue,
      offre: document.getElementById('offreInput').value,
      panier: document.getElementById('panierInput').value || 'non précisé',
    });
    showOnly('mainDashboard');
    renderDashboard(profile);
  } catch (err) {
    alert('Erreur lors de la sauvegarde du profil : ' + err.message);
  }
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Libellés lisibles pour l'affichage (les <select> stockent des codes courts)
const LABELS_SECTEUR = {
  coaching: 'coaching et bien-être',
  artisanat: 'artisanat / BTP',
  conseil: 'conseil et services intellectuels',
  creatif: 'freelance créatif',
  commerce: 'commerce et produit physique',
};

function renderDashboard(profile) {
  document.getElementById('welcomeMessage').textContent = `bonjour ${profile.nom}`;

  const quotaUsed = profile.quota_month === currentMonthKey() ? profile.quota_used : 0;
  const restant = Math.max(0, QUOTA_GRATUIT - quotaUsed);
  document.getElementById('quotaDisplay').textContent = `${restant} générations restantes`;

  const pill = document.getElementById('profilePill');
  pill.textContent = LABELS_SECTEUR[profile.secteur] || profile.secteur;
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthGate();
});
