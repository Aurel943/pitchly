/* ================================================================
   PITCHLY — compte.js
   Page compte.html : consultation/modification des infos de compte
   et du profil métier. La session/le profil sont gérés via auth.js.

   Chaque carte a deux états : lecture (grille d'infos) et édition
   (les champs de formulaire) — un bouton "modifier" bascule de l'une
   à l'autre, "annuler"/"enregistrer" ramène en lecture.
   ================================================================ */

const SECTEURS_CONNUS = ['coaching', 'artisanat', 'conseil', 'creatif', 'commerce'];
const LABELS_OFFRE = { abonnement: 'abonnement', ponctuelle: 'prestation ponctuelle' };

let currentSession = null;
let currentProfile = null;

function formatDateOnly(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function setAccountEditing(editing) {
  document.getElementById('accountView').classList.toggle('hidden', editing);
  document.getElementById('accountEdit').classList.toggle('hidden', !editing);
  document.getElementById('accountEditBtn').classList.toggle('hidden', editing);
}

function setBusinessEditing(editing) {
  document.getElementById('businessView').classList.toggle('hidden', editing);
  document.getElementById('businessEdit').classList.toggle('hidden', !editing);
  document.getElementById('businessEditBtn').classList.toggle('hidden', editing);
}

function renderProfileHeader(profile) {
  const nom = profile.nom || '';
  document.getElementById('profileAvatar').textContent = nom ? nom[0].toUpperCase() : '?';
  document.getElementById('profileHeaderName').textContent = nom || 'ton profil';
  document.getElementById('profileHeaderSector').textContent = profile.secteur
    ? (LABELS_SECTEUR[profile.secteur] || profile.secteur)
    : 'secteur non renseigné';
  document.getElementById('profileHeaderEmail').textContent = currentSession.user.email || '';
}

function renderAccountView(profile) {
  document.getElementById('viewNom').textContent = profile.nom || '—';
  document.getElementById('viewEmail').textContent = currentSession.user.email || '—';
  document.getElementById('viewDateNaissance').textContent = formatDateOnly(profile.date_naissance);
  document.getElementById('viewTelephone').textContent = profile.telephone || '—';
}

function renderBusinessView(profile) {
  document.getElementById('viewSecteur').textContent = profile.secteur
    ? (LABELS_SECTEUR[profile.secteur] || profile.secteur)
    : '—';
  document.getElementById('viewOffre').textContent = profile.offre ? (LABELS_OFFRE[profile.offre] || profile.offre) : '—';
  document.getElementById('viewPanier').textContent = profile.panier || '—';
}

function renderStyleProfile(profile) {
  const empty = document.getElementById('styleProfileEmpty');
  const text = document.getElementById('styleProfileText');

  if (profile.style_profile) {
    empty.classList.add('hidden');
    text.textContent = profile.style_profile;
    text.classList.remove('hidden');
  } else {
    empty.classList.remove('hidden');
    text.classList.add('hidden');
  }
}

function fillAccountEditFields(profile) {
  document.getElementById('accountEmailDisplay').value = currentSession.user.email || '';
  document.getElementById('accountNomInput').value = profile.nom || '';
  document.getElementById('accountDateNaissanceInput').value = profile.date_naissance || '';
  document.getElementById('accountTelephoneInput').value = profile.telephone || '';
}

function fillBusinessEditFields(profile) {
  const secteurConnu = profile.secteur && SECTEURS_CONNUS.includes(profile.secteur);
  document.getElementById('secteurInput').value = secteurConnu ? profile.secteur : (profile.secteur ? 'autre' : 'coaching');
  if (!secteurConnu && profile.secteur) {
    document.getElementById('secteurAutreInput').value = profile.secteur;
  }
  toggleSecteurAutre('secteurInput', 'secteurAutreInput');
  document.getElementById('offreInput').value = profile.offre || 'abonnement';
  document.getElementById('panierInput').value = profile.panier || '';
}

async function initAccountPage() {
  currentSession = await getSession();

  if (!currentSession) {
    window.location.href = 'dashboard.html';
    return;
  }

  currentProfile = (await getProfile()) || {};

  renderProfileHeader(currentProfile);
  renderAccountView(currentProfile);
  renderBusinessView(currentProfile);
  renderStyleProfile(currentProfile);
  fillAccountEditFields(currentProfile);
  fillBusinessEditFields(currentProfile);

  document.getElementById('mainAccount').classList.remove('hidden');
}

async function handleSaveAccountInfo() {
  try {
    currentProfile = await saveProfile({
      nom: document.getElementById('accountNomInput').value.trim(),
      date_naissance: document.getElementById('accountDateNaissanceInput').value || null,
      telephone: document.getElementById('accountTelephoneInput').value.trim(),
    });
    renderProfileHeader(currentProfile);
    renderAccountView(currentProfile);
    setAccountEditing(false);
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

async function handleSaveBusinessProfile() {
  try {
    const secteurValue = document.getElementById('secteurInput').value;
    const secteurAutre = document.getElementById('secteurAutreInput').value.trim();

    currentProfile = await saveProfile({
      secteur: secteurValue === 'autre' && secteurAutre ? secteurAutre : secteurValue,
      offre: document.getElementById('offreInput').value,
      panier: document.getElementById('panierInput').value || 'non précisé',
    });
    renderProfileHeader(currentProfile);
    renderBusinessView(currentProfile);
    setBusinessEditing(false);
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initAccountPage();
});
