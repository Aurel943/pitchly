/* ================================================================
   PITCHLY — app.js
   Vue d'ensemble du fichier (5 blocs) :
   0. AUTH        → connexion Google / email, session, déconnexion
   1. PROFIL      → lire/écrire le profil métier (Supabase, table "profiles")
   2. GÉNÉRATEUR  → construire un script à partir de templates
                    (⚠️ à remplacer plus tard par un vrai appel à l'API Claude)
   3. SAUVEGARDE  → gérer la liste des scripts favoris (table "saved_scripts")
   4. OBJECTIONS  → afficher/masquer les réponses au clic
   ================================================================ */


/* ================================================================
   BLOC 0 — AUTH
   Connexion via Supabase Auth (Google OAuth + lien magique par email).
   currentUser est rempli une fois la session résolue.
   ================================================================ */

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;

function showOnly(overlayId) {
  document.getElementById('authModal').classList.toggle('hidden', overlayId !== 'authModal');
  document.getElementById('onboardingModal').classList.toggle('hidden', overlayId !== 'onboardingModal');
  document.getElementById('mainApp').classList.toggle('hidden', overlayId !== 'mainApp');
}

async function signInWithGoogle() {
  await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
}

async function signInWithEmailLink() {
  const email = document.getElementById('authEmailInput').value.trim();
  const status = document.getElementById('authStatus');
  if (!email) return;

  const btn = document.getElementById('authEmailBtn');
  btn.disabled = true;

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });

  btn.disabled = false;
  status.textContent = error
    ? 'erreur : ' + error.message
    : `lien envoyé à ${email}, vérifie ta boîte mail.`;
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  showOnly('authModal');
}

async function initAuthGate() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    showOnly('authModal');
    return;
  }

  currentUser = session.user;
  document.getElementById('logoutBtn').classList.remove('hidden');

  const profile = await getProfile();
  if (!profile) {
    showOnly('onboardingModal');
    return;
  }

  showOnly('mainApp');
  await startApp(profile);
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session && !currentUser) {
    initAuthGate();
  }
});


/* ================================================================
   BLOC 1 — PROFIL UTILISATEUR
   Stocké dans la table Supabase "profiles", une ligne par utilisateur
   (clé primaire = id du compte). Tant qu'elle n'existe pas, on affiche
   la modale d'onboarding.
   ================================================================ */

const QUOTA_GRATUIT = 5;

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

function openOnboarding() {
  showOnly('onboardingModal');
}

async function handleOnboardingSubmit() {
  try {
    const profile = await saveProfile({
      secteur: document.getElementById('secteurInput').value,
      offre: document.getElementById('offreInput').value,
      panier: document.getElementById('panierInput').value || 'non précisé',
    });
    showOnly('mainApp');
    await startApp(profile);
  } catch (err) {
    alert('Erreur lors de la sauvegarde du profil : ' + err.message);
  }
}

// Libellés lisibles pour l'affichage (les <select> stockent des codes courts)
const LABELS_SECTEUR = {
  coaching: 'coaching et bien-être',
  artisanat: 'artisanat / BTP',
  conseil: 'conseil et services intellectuels',
  creatif: 'freelance créatif',
  commerce: 'commerce et produit physique',
};

function renderProfilePill(profile) {
  const pill = document.getElementById('profilePill');
  pill.textContent = LABELS_SECTEUR[profile.secteur];
}


/* ================================================================
   BLOC 2 — GÉNÉRATEUR DE SCRIPT
   handleGenerate() envoie le profil + les choix du formulaire à
   notre fonction backend (/api/generate), qui elle-même appelle
   l'API Claude et renvoie le texte généré.

   Le quota mensuel est stocké dans la ligne "profiles" de l'utilisateur
   (colonnes quota_used / quota_month) et remis à zéro dès qu'on change
   de mois.
   ================================================================ */

let currentTone = 'direct';
let currentProfile = null;

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getQuotaUsed() {
  return currentProfile.quota_month === currentMonthKey() ? currentProfile.quota_used : 0;
}

async function incrementQuotaUsed() {
  const usedThisMonth = getQuotaUsed();
  currentProfile = await saveProfile({
    quota_used: usedThisMonth + 1,
    quota_month: currentMonthKey(),
  });
}

function updateQuotaDisplay() {
  const restant = Math.max(0, QUOTA_GRATUIT - getQuotaUsed());
  document.getElementById('quotaDisplay').textContent = `${restant} générations restantes`;
}

async function handleGenerate() {
  if (getQuotaUsed() >= QUOTA_GRATUIT) {
    alert('Quota gratuit atteint pour ce mois-ci. (ici on brancherait la modale "passer pro")');
    return;
  }

  const canal = document.getElementById('canalSelect').value;
  const situation = document.getElementById('situationSelect').value;
  const contexte = document.getElementById('contexteInput').value.trim();
  const btn = document.getElementById('generateBtn');

  // petit état de chargement le temps que Claude réponde
  btn.disabled = true;
  btn.textContent = 'génération en cours…';

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secteur: LABELS_SECTEUR[currentProfile.secteur],
        offre: currentProfile.offre,
        panier: currentProfile.panier,
        canal,
        situation,
        ton: currentTone,
        contexte,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert('Erreur : ' + (data.error || 'impossible de générer le script'));
      return;
    }

    // Affichage du résultat
    document.getElementById('outputText').textContent = data.texte;
    document.getElementById('outputMeta').textContent = `${situation.replace('_', ' ')} · ${canal}`;
    document.getElementById('outputCard').classList.add('visible');
    document.getElementById('saveBtn').classList.remove('active'); // reset l'état favori

    await incrementQuotaUsed();
    updateQuotaDisplay();

  } catch (err) {
    alert('Erreur réseau, réessaie dans un instant.');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ générer le script';
  }
}

// Gestion des pastilles de ton (direct / chaleureux / expert)
document.getElementById('tonePills').addEventListener('click', (e) => {
  if (!e.target.classList.contains('pill')) return;
  document.querySelectorAll('#tonePills .pill').forEach(p => p.classList.remove('active'));
  e.target.classList.add('active');
  currentTone = e.target.dataset.tone;
});


/* ================================================================
   BLOC 3 — SCRIPTS SAUVEGARDÉS
   Table Supabase "saved_scripts", filtrée par utilisateur (RLS).
   ================================================================ */

let currentFilter = 'tous';

async function getSavedScripts() {
  const { data } = await supabaseClient
    .from('saved_scripts')
    .select('*')
    .order('created_at', { ascending: false });
  return data || [];
}

async function handleSave() {
  const texte = document.getElementById('outputText').textContent;
  if (!texte) return;

  const canal = document.getElementById('canalSelect').value;
  const situation = document.getElementById('situationSelect').value;

  await supabaseClient
    .from('saved_scripts')
    .insert({ user_id: currentUser.id, canal, situation, texte });

  document.getElementById('saveBtn').classList.add('active');
  await renderSavedList();
}

async function renderSavedList() {
  const container = document.getElementById('savedList');
  const all = await getSavedScripts();
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
   DÉMARRAGE DE L'APP UNE FOIS AUTH + PROFIL RÉSOLUS
   ================================================================ */

async function startApp(profile) {
  currentProfile = profile;
  renderProfilePill(profile);
  updateQuotaDisplay();
  await renderSavedList();
  renderObjections();
}


/* ================================================================
   INITIALISATION AU CHARGEMENT DE LA PAGE
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initAuthGate();
});
