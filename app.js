/* ================================================================
   PITCHLY — app.js
   Vue d'ensemble du fichier (4 blocs) :
   1. PROFIL      → accès + lire/écrire le profil métier
                    (Supabase, table "profiles" — voir aussi auth.js)
   2. GÉNÉRATEUR  → construire un script à partir de templates
                    (⚠️ à remplacer plus tard par un vrai appel à l'API Claude)
   3. SAUVEGARDE  → gérer la liste des scripts favoris (table "saved_scripts")
   4. COPIER      → copier le script dans le presse-papier

   L'auth (connexion Google/email, session, déconnexion), les fonctions
   getProfile()/saveProfile() et les constantes/quota partagés (QUOTA_GRATUIT,
   LABELS_SECTEUR, getQuotaUsed, incrementQuotaUsed) vivent dans auth.js,
   chargé avant ce fichier.

   La réponse aux objections vit sur sa propre page (objections.html /
   objections.js), séparée du générateur de script.

   La gate complète (connexion, infos de compte, profil métier manquants)
   vit sur dashboard.html — cette page suppose que tout est déjà en place
   et redirige vers le dashboard si ce n'est pas le cas.
   ================================================================ */


/* ================================================================
   BLOC 1 — ACCÈS
   Vérifie session + profil complet ; sinon renvoie vers dashboard.html
   qui gère la complétion (connexion, infos de compte, profil métier).
   ================================================================ */

async function checkAccess() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'dashboard.html';
    return;
  }

  const profile = await getProfile();
  if (!profile || !profile.nom || !profile.secteur) {
    window.location.href = 'dashboard.html';
    return;
  }

  document.getElementById('logoutBtn').classList.remove('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  await startApp(profile);
}

function renderProfilePill(profile) {
  const pill = document.getElementById('profilePill');
  pill.textContent = LABELS_SECTEUR[profile.secteur] || profile.secteur;
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
let currentAddress = 'vous';
let currentProfile = null;
let lastProspectsForSelect = [];

async function populateProspectSelect() {
  lastProspectsForSelect = await getProspects();
  const select = document.getElementById('prospectSelect');
  select.innerHTML = '<option value="">— aucun prospect —</option>' +
    lastProspectsForSelect.map(p => `<option value="${p.id}">${p.nom}${p.entreprise ? ' · ' + p.entreprise : ''}</option>`).join('');
}

// Construit le bloc structuré envoyé à /api/generate pour le prospect
// sélectionné (fiche CRM + historique récent des échanges déjà eus avec
// lui) — contrairement au champ "contexte" libre, ça marche même si
// l'utilisateur n'a rien tapé, et ça inclut plus que les notes.
async function buildProspectContext(prospectId) {
  if (!prospectId) return null;
  const prospect = lastProspectsForSelect.find(p => p.id === prospectId);
  if (!prospect) return null;

  const historique = await getCombinedSaved({ prospectId, limit: 3 });

  return {
    nom: prospect.nom,
    entreprise: prospect.entreprise,
    secteur: prospect.secteur,
    statut: prospect.statut,
    notes: prospect.notes,
    historique: historique.map(h => ({ type: h.type, outcome: h.outcome, texte: h.text })),
  };
}

function updateQuotaDisplay() {
  const restant = Math.max(0, QUOTA_GRATUIT - getQuotaUsed(currentProfile));
  document.getElementById('quotaDisplay').textContent = `${restant} générations restantes`;
}

async function getWorkedScriptExamples(canal) {
  const { data } = await supabaseClient
    .from('saved_scripts')
    .select('canal, situation, texte')
    .eq('outcome', 'worked')
    .order('created_at', { ascending: false })
    .limit(10);

  const list = data || [];
  // on privilégie les exemples du même canal, complétés par les plus récents sinon
  const sameCanal = list.filter(s => s.canal === canal);
  const rest = list.filter(s => s.canal !== canal);
  return [...sameCanal, ...rest].slice(0, 2);
}

async function handleGenerate() {
  if (getQuotaUsed(currentProfile) >= QUOTA_GRATUIT) {
    alert('Quota gratuit atteint pour ce mois-ci. (ici on brancherait la modale "passer pro")');
    return;
  }

  const canal = document.getElementById('canalSelect').value;
  const situation = document.getElementById('situationSelect').value;
  const contexte = document.getElementById('contexteInput').value.trim();
  const prospectId = document.getElementById('prospectSelect').value;
  const btn = document.getElementById('generateBtn');

  // petit état de chargement le temps que Claude réponde
  btn.disabled = true;
  btn.textContent = 'génération en cours…';

  try {
    const [exemples, prospect] = await Promise.all([
      getWorkedScriptExamples(canal),
      buildProspectContext(prospectId),
    ]);

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secteur: LABELS_SECTEUR[currentProfile.secteur] || currentProfile.secteur,
        offre: currentProfile.offre,
        panier: currentProfile.panier,
        canal,
        situation,
        ton: currentTone,
        adresse: currentAddress,
        contexte,
        exemples,
        styleProfile: currentProfile.style_profile || null,
        prospect,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert('Erreur : ' + (data.error || 'impossible de générer le script'));
      return;
    }

    // Affichage du résultat
    document.getElementById('outputText').textContent = data.texte;
    document.getElementById('outputMeta').innerHTML = `${situation.replace('_', ' ')} · ${canal}` +
      (exemples.length > 0
        ? `<span class="exemples-note">✨ enrichi par ${exemples.length} exemple${exemples.length > 1 ? 's' : ''} qui ${exemples.length > 1 ? 'ont' : 'a'} déjà marché</span>`
        : '') +
      (currentProfile.style_profile
        ? `<span class="exemples-note">🧠 affiné par ton profil de style personnel</span>`
        : '');
    document.getElementById('outputCard').classList.add('visible');
    document.getElementById('saveBtn').classList.remove('active'); // reset l'état favori

    currentProfile = await incrementQuotaUsed(currentProfile);
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

// Gestion de la pastille tu / vous
document.getElementById('adressePills').addEventListener('click', (e) => {
  if (!e.target.classList.contains('pill')) return;
  document.querySelectorAll('#adressePills .pill').forEach(p => p.classList.remove('active'));
  e.target.classList.add('active');
  currentAddress = e.target.dataset.adresse;
});

// Ctrl/Cmd + Entrée dans le contexte = générer sans quitter le clavier
document.getElementById('contexteInput').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !document.getElementById('generateBtn').disabled) {
    handleGenerate();
  }
});


/* ================================================================
   BLOC 3 — SCRIPTS SAUVEGARDÉS
   Table Supabase "saved_scripts", filtrée par utilisateur (RLS).
   ================================================================ */

let currentFilter = 'tous';
let currentSearch = '';
let currentSort = 'recent';
let lastSavedScripts = [];
let currentScriptId = null;

function defaultScriptName(texte) {
  const firstLine = texte.split('\n').find(l => l.trim().length > 0) || '';
  return firstLine.replace(/^#+\s*/, '').slice(0, 60) || 'script sans nom';
}

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
  const prospectId = document.getElementById('prospectSelect').value || null;

  await supabaseClient
    .from('saved_scripts')
    .insert({ user_id: currentUser.id, canal, situation, texte, nom: defaultScriptName(texte), prospect_id: prospectId });

  document.getElementById('saveBtn').classList.add('active');
  await renderSavedList();
}

async function renderSavedList() {
  const container = document.getElementById('savedList');
  lastSavedScripts = await getSavedScripts();

  let list = currentFilter === 'tous' ? lastSavedScripts : lastSavedScripts.filter(s => s.canal === currentFilter);

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(s => (s.nom || '').toLowerCase().includes(q) || s.texte.toLowerCase().includes(q));
  }

  if (currentSort === 'oldest') {
    list = [...list].reverse();
  }

  if (list.length === 0) {
    container.innerHTML = lastSavedScripts.length === 0
      ? '<p class="empty-state">aucun script sauvegardé pour l\'instant — génère ton premier ci-dessus, puis clique sur ★ pour le garder.</p>'
      : '<p class="empty-state">aucun script ne correspond à cette recherche ou ce filtre.</p>';
    return;
  }

  container.innerHTML = list.map(s => `
    <div class="saved-item" onclick="openScriptDetail('${s.id}')">
      <div class="saved-item-head">
        <span class="name">${s.nom || `${s.situation.replace('_', ' ')} · ${s.canal}`}</span>
        <div class="saved-item-actions">
          <button class="icon-btn ${s.outcome === 'worked' ? 'fb-on-worked' : ''}" onclick="event.stopPropagation(); handleSetScriptOutcome('${s.id}', 'worked')" title="a fonctionné">👍</button>
          <button class="icon-btn ${s.outcome === 'failed' ? 'fb-on-failed' : ''}" onclick="event.stopPropagation(); handleSetScriptOutcome('${s.id}', 'failed')" title="n'a pas fonctionné">👎</button>
          <button class="icon-btn" onclick="event.stopPropagation(); handleDeleteScript('${s.id}')" title="supprimer">🗑</button>
        </div>
      </div>
      <span class="tag">${s.situation.replace('_', ' ')} · ${s.canal} · ${formatDateTime(s.created_at)}</span>
      ${s.outcome === 'worked' ? '<span class="outcome-tag worked">✓ a fonctionné — utilisé comme exemple</span>' : ''}
      ${s.outcome === 'failed' ? '<span class="outcome-tag failed">✕ n\'a pas fonctionné</span>' : ''}
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

document.getElementById('savedSearchInput').addEventListener('input', (e) => {
  currentSearch = e.target.value.trim();
  renderSavedList();
});

document.getElementById('savedSortSelect').addEventListener('change', (e) => {
  currentSort = e.target.value;
  renderSavedList();
});


/* ================================================================
   MODALE DÉTAIL D'UN SCRIPT SAUVEGARDÉ
   ================================================================ */

function renderScriptOutcomeButtons(script) {
  document.getElementById('scriptModalWorkedBtn').classList.toggle('fb-on-worked', script.outcome === 'worked');
  document.getElementById('scriptModalFailedBtn').classList.toggle('fb-on-failed', script.outcome === 'failed');
}

function openScriptDetail(id) {
  const script = lastSavedScripts.find(s => s.id === id);
  if (!script) return;

  currentScriptId = id;
  document.getElementById('scriptModalName').value = script.nom || '';
  document.getElementById('scriptModalMeta').textContent = `${script.situation.replace('_', ' ')} · ${script.canal} · ${formatDateTime(script.created_at)}`;
  document.getElementById('scriptModalText').textContent = script.texte;
  renderScriptOutcomeButtons(script);
  document.getElementById('scriptModal').classList.remove('hidden');
}

function closeScriptModal() {
  document.getElementById('scriptModal').classList.add('hidden');
  currentScriptId = null;
}

async function handleRenameScriptSubmit() {
  if (!currentScriptId) return;
  const nom = document.getElementById('scriptModalName').value.trim();

  await supabaseClient
    .from('saved_scripts')
    .update({ nom })
    .eq('id', currentScriptId);

  await renderSavedList();
}

async function handleSetScriptOutcome(id, value) {
  const current = lastSavedScripts.find(s => s.id === id);
  const next = current && current.outcome === value ? null : value;

  const { error } = await supabaseClient
    .from('saved_scripts')
    .update({ outcome: next })
    .eq('id', id);

  if (error) {
    alert('Erreur lors de la mise à jour : ' + error.message);
    return;
  }

  if (next === 'worked') {
    showToast('👍 Noté — ce script sera proposé comme exemple dans tes prochaines générations.', 'worked');
  } else if (next === 'failed') {
    showToast('👎 Noté — il ne sera plus utilisé comme modèle.', 'failed');
  } else {
    showToast('Retour retiré.', 'info');
  }

  currentProfile = await maybeRefreshStyleProfile(currentProfile);
  await renderSavedList();
  if (currentScriptId === id) {
    const updated = lastSavedScripts.find(s => s.id === id);
    if (updated) renderScriptOutcomeButtons(updated);
  }
}

async function handleDeleteScript(id) {
  if (!confirm('Supprimer ce script sauvegardé ?')) return;

  await supabaseClient
    .from('saved_scripts')
    .delete()
    .eq('id', id);

  if (currentScriptId === id) closeScriptModal();
  await renderSavedList();
}

function handleCopyScriptModal() {
  const texte = document.getElementById('scriptModalText').textContent;
  navigator.clipboard.writeText(texte);
}


/* ================================================================
   BLOC 4 — COPIER LE SCRIPT DANS LE PRESSE-PAPIER
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
   DÉMARRAGE DE L'APP UNE FOIS AUTH + PROFIL RÉSOLUS
   ================================================================ */

async function startApp(profile) {
  currentProfile = profile;
  renderProfilePill(profile);
  updateQuotaDisplay();
  await populateProspectSelect();
  await renderSavedList();
  // filet de sécurité : si des retours notés existent déjà sans profil de
  // style à jour (ex. généré avant que les colonnes existent en base),
  // on rattrape ici plutôt que de dépendre du prochain clic 👍/👎
  currentProfile = await maybeRefreshStyleProfile(currentProfile);
}


/* ================================================================
   INITIALISATION AU CHARGEMENT DE LA PAGE
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  checkAccess();
});
