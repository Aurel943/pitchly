/* ================================================================
   PITCHLY — app.js
   Vue d'ensemble du fichier (4 blocs) :
   1. PROFIL      → lire/écrire le profil métier (localStorage)
   2. GÉNÉRATEUR  → construire un script à partir de templates
                    (⚠️ à remplacer plus tard par un vrai appel à l'API Claude)
   3. SAUVEGARDE  → gérer la liste des scripts favoris
   4. OBJECTIONS  → afficher/masquer les réponses au clic
   ================================================================ */


/* ================================================================
   BLOC 1 — PROFIL UTILISATEUR
   Stocké en localStorage sous la clé "pitchly_profile".
   Tant qu'il n'existe pas, on affiche la modale d'onboarding.
   ================================================================ */

const QUOTA_GRATUIT = 5;

function getProfile() {
  const raw = localStorage.getItem('pitchly_profile');
  return raw ? JSON.parse(raw) : null;
}

function saveProfile(profile) {
  localStorage.setItem('pitchly_profile', JSON.stringify(profile));
}

function openOnboarding() {
  document.getElementById('onboardingModal').classList.remove('hidden');
}

function closeOnboarding() {
  document.getElementById('onboardingModal').classList.add('hidden');
}

function handleOnboardingSubmit() {
  const profile = {
    secteur: document.getElementById('secteurInput').value,
    offre: document.getElementById('offreInput').value,
    panier: document.getElementById('panierInput').value || 'non précisé',
  };
  saveProfile(profile);
  closeOnboarding();
  renderProfilePill();
}

// Libellés lisibles pour l'affichage (les <select> stockent des codes courts)
const LABELS_SECTEUR = {
  coaching: 'coaching et bien-être',
  artisanat: 'artisanat / BTP',
  conseil: 'conseil et services intellectuels',
  creatif: 'freelance créatif',
  commerce: 'commerce et produit physique',
};

function renderProfilePill() {
  const profile = getProfile();
  const pill = document.getElementById('profilePill');
  pill.textContent = profile ? LABELS_SECTEUR[profile.secteur] : 'configurer mon profil';
}


/* ================================================================
   BLOC 2 — GÉNÉRATEUR DE SCRIPT
   generateScript() construit le texte à partir de templates simples.
   C'est un PLACEHOLDER : la vraie version enverra ces mêmes
   paramètres (secteur, canal, situation, ton, contexte) à l'API
   Claude et affichera sa réponse à la place.
   ================================================================ */

let currentTone = 'direct';

// Un petit mot de politesse selon le ton choisi, pour varier le rendu
const TONE_INTRO = {
  direct: "Bonjour {nom}, j'irai droit au but.",
  chaleureux: "Bonjour {nom}, j'espère que vous allez bien !",
  expert: "Bonjour {nom}, en tant que professionnel du secteur,",
};

function buildTemplateText(profile, canal, situation, ton, contexte) {
  const secteurLabel = LABELS_SECTEUR[profile.secteur];
  const intro = TONE_INTRO[ton].replace('{nom}', 'Julie');

  const corps = {
    premier_contact: `Je vous contacte parce que j'accompagne des personnes dans le secteur "${secteurLabel}" avec une offre à ${profile.panier}. ${contexte ? contexte + '. ' : ''}Auriez-vous 2 minutes pour voir si cela peut vous être utile ?`,
    relance: `Je reviens vers vous suite à notre dernier échange. ${contexte ? contexte + '. ' : ''}Où en êtes-vous dans votre réflexion ?`,
    closing: `Nous avons fait le tour de votre besoin. ${contexte ? contexte + '. ' : ''}Voulez-vous qu'on démarre dès cette semaine ?`,
  };

  const canalNote = {
    appel: '',
    email: '\n\nObjet : proposition adaptée à votre situation',
    linkedin: '\n\n(message court, ton plus informel qu\'un email)',
  };

  return intro + ' ' + corps[situation] + canalNote[canal];
}

function handleGenerate() {
  const profile = getProfile();
  if (!profile) {
    openOnboarding();
    return;
  }

  const usedThisMonth = getQuotaUsed();
  if (usedThisMonth >= QUOTA_GRATUIT) {
    alert('Quota gratuit atteint pour ce mois-ci. (ici on brancherait la modale "passer pro")');
    return;
  }

  const canal = document.getElementById('canalSelect').value;
  const situation = document.getElementById('situationSelect').value;
  const contexte = document.getElementById('contexteInput').value.trim();

  const texte = buildTemplateText(profile, canal, situation, currentTone, contexte);

  // Affichage du résultat
  document.getElementById('outputText').textContent = texte;
  document.getElementById('outputMeta').textContent = `${situation.replace('_', ' ')} · ${canal}`;
  document.getElementById('outputCard').classList.add('visible');
  document.getElementById('saveBtn').classList.remove('active'); // reset l'état favori

  incrementQuotaUsed();
  updateQuotaDisplay();
}

// Gestion des pastilles de ton (direct / chaleureux / expert)
document.getElementById('tonePills').addEventListener('click', (e) => {
  if (!e.target.classList.contains('pill')) return;
  document.querySelectorAll('#tonePills .pill').forEach(p => p.classList.remove('active'));
  e.target.classList.add('active');
  currentTone = e.target.dataset.tone;
});


/* ================================================================
   QUOTA — compteur simple stocké en localStorage.
   (En vrai produit, ce compteur vivrait côté serveur, lié au compte.)
   ================================================================ */

function getQuotaUsed() {
  return parseInt(localStorage.getItem('pitchly_quota_used') || '0', 10);
}

function incrementQuotaUsed() {
  localStorage.setItem('pitchly_quota_used', getQuotaUsed() + 1);
}

function updateQuotaDisplay() {
  const restant = Math.max(0, QUOTA_GRATUIT - getQuotaUsed());
  document.getElementById('quotaDisplay').textContent = `${restant} générations restantes`;
}


/* ================================================================
   BLOC 3 — SCRIPTS SAUVEGARDÉS
   Liste stockée en localStorage sous "pitchly_saved" (tableau JSON).
   ================================================================ */

let currentFilter = 'tous';

function getSavedScripts() {
  const raw = localStorage.getItem('pitchly_saved');
  return raw ? JSON.parse(raw) : [];
}

function setSavedScripts(list) {
  localStorage.setItem('pitchly_saved', JSON.stringify(list));
}

function handleSave() {
  const texte = document.getElementById('outputText').textContent;
  if (!texte) return;

  const canal = document.getElementById('canalSelect').value;
  const situation = document.getElementById('situationSelect').value;

  const saved = getSavedScripts();
  saved.unshift({ id: Date.now(), canal, situation, texte });
  setSavedScripts(saved);

  document.getElementById('saveBtn').classList.add('active');
  renderSavedList();
}

function renderSavedList() {
  const container = document.getElementById('savedList');
  const all = getSavedScripts();
  const filtered = currentFilter === 'tous' ? all : all.filter(s => s.canal === currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = '<p class="empty-state">aucun script sauvegardé pour l\'instant.</p>';
    return;
  }

  container.innerHTML = filtered.map(s => `
    <div class="saved-item">
      <div class="saved-item-head">
        <span class="tag">${s.situation.replace('_', ' ')} · ${s.canal}</span>
      </div>
      <p>${s.texte.slice(0, 90)}${s.texte.length > 90 ? '…' : ''}</p>
    </div>
  `).join('');
}

document.getElementById('savedFilters').addEventListener('click', (e) => {
  if (!e.target.classList.contains('filter')) return;
  document.querySelectorAll('#savedFilters .filter').forEach(f => f.classList.remove('active'));
  e.target.classList.add('active');
  currentFilter = e.target.dataset.filter;
  renderSavedList();
});


/* ================================================================
   COPIER LE SCRIPT DANS LE PRESSE-PAPIER
   ================================================================ */

function handleCopy() {
  const texte = document.getElementById('outputText').textContent;
  navigator.clipboard.writeText(texte);

  const btn = document.getElementById('copyBtn');
  const original = btn.textContent;
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = original; }, 1200);
}


/* ================================================================
   BLOC 4 — BIBLIOTHÈQUE D'OBJECTIONS
   Liste statique pour l'instant (à terme, adaptée au secteur du
   profil, comme le générateur).
   ================================================================ */

const OBJECTIONS = [
  { q: "C'est trop cher pour moi.", r: "Je comprends. Beaucoup de mes clients pensaient ça au début — on regarde ensemble ce que ça change concrètement pour eux ?" },
  { q: "Je dois réfléchir.", r: "Bien sûr. Qu'est-ce qui te ferait hésiter précisément — le prix, le timing, ou autre chose ?" },
  { q: "J'ai déjà quelqu'un.", r: "Tant mieux, ça veut dire que tu connais déjà la valeur de ce type d'accompagnement. Qu'est-ce qui te ferait changer, si l'occasion se présentait ?" },
];

function renderObjections() {
  const container = document.getElementById('objectionsList');
  container.innerHTML = OBJECTIONS.map((o, i) => `
    <div class="obj-item" onclick="this.classList.toggle('open')">
      <p class="q">« ${o.q} »</p>
      <p class="r">${o.r}</p>
    </div>
  `).join('');
}


/* ================================================================
   INITIALISATION AU CHARGEMENT DE LA PAGE
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  renderProfilePill();
  updateQuotaDisplay();
  renderSavedList();
  renderObjections();

  if (!getProfile()) {
    openOnboarding();
  }
});