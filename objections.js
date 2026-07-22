/* ================================================================
   PITCHLY — objections.js
   Page objections.html : l'utilisateur saisit l'objection reçue d'un
   prospect, Claude génère une réponse à la demande (/api/objections),
   et le couple objection/réponse peut être sauvegardé (table
   "saved_objections").

   Partage le même quota mensuel que le générateur de script (une seule
   colonne quota_used sur "profiles") pour ne pas multiplier les coûts
   d'API. Le décompte est fait par le serveur, qui le renvoie dans la
   réponse — ici on ne fait que l'afficher.

   Même gate d'accès que app.html : session + profil complet, sinon
   retour vers dashboard.html qui gère la complétion.
   ================================================================ */

let currentProfile = null;
let currentAddress = 'vous';
let lastProspectsForSelect = [];

async function populateProspectSelect() {
  lastProspectsForSelect = await getProspects();
  const select = document.getElementById('prospectSelect');
  select.innerHTML = '<option value="">— aucun prospect —</option>' +
    lastProspectsForSelect.map(p => `<option value="${p.id}">${p.nom}${p.entreprise ? ' · ' + p.entreprise : ''}</option>`).join('');
}

// Construit le bloc structuré envoyé à /api/objections pour le prospect
// sélectionné (fiche CRM + historique récent des échanges déjà eus avec
// lui) — sans ça, la réponse générée ignore tout du prospect.
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

// Gestion de la pastille tu / vous
document.getElementById('adressePills').addEventListener('click', (e) => {
  if (!e.target.classList.contains('pill')) return;
  document.querySelectorAll('#adressePills .pill').forEach(p => p.classList.remove('active'));
  e.target.classList.add('active');
  currentAddress = e.target.dataset.adresse;
});

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
  const loader = document.getElementById('pageLoader');
  if (loader) loader.remove();
  document.getElementById('mainObjections').classList.remove('hidden');
  await startApp(profile);
}

function renderProfilePill(profile) {
  const pill = document.getElementById('profilePill');
  pill.textContent = LABELS_SECTEUR[profile.secteur] || profile.secteur;
}

function updateQuotaDisplay() {
  const limite = limiteGenerations(currentProfile);
  const btn = document.getElementById('generateObjectionBtn');

  if (limite === null) {
    document.getElementById('quotaDisplay').textContent = 'générations illimitées';
    return;
  }

  const restant = Math.max(0, limite - getQuotaUsed(currentProfile));
  document.getElementById('quotaDisplay').textContent =
    `${restant} génération${restant > 1 ? 's' : ''} restante${restant > 1 ? 's' : ''}`;

  // Quota épuisé : le bouton le dit clairement au lieu de laisser cliquer
  // dans le vide (l'état est levé au changement de mois, côté getQuotaUsed).
  if (restant === 0) {
    btn.disabled = true;
    btn.textContent = 'quota mensuel épuisé';
  }
}

async function getWorkedObjectionExamples() {
  const { data } = await supabaseClient
    .from('saved_objections')
    .select('objection, reponse')
    .eq('outcome', 'worked')
    .order('created_at', { ascending: false })
    .limit(2);

  const personal = (data || []).map(o => ({ ...o, source: 'personal' }));
  if (personal.length >= 2) return personal;

  // Complète avec la bibliothèque du secteur tant que l'utilisateur n'a
  // pas encore assez de réponses personnelles marquées "a marché".
  const library = (STARTER_OBJECTIONS[currentProfile.secteur] || [])
    .slice(0, 2 - personal.length)
    .map(o => ({ ...o, source: 'library' }));

  return [...personal, ...library];
}

function buildExemplesNote(exemples, secteurLabel) {
  if (exemples.length === 0) return '';

  const personalCount = exemples.filter(e => e.source === 'personal').length;
  const libraryCount = exemples.filter(e => e.source === 'library').length;

  let text;
  if (libraryCount === 0) {
    text = `✨ enrichi par ${personalCount} exemple${personalCount > 1 ? 's' : ''} qui ${personalCount > 1 ? 'ont' : 'a'} déjà marché`;
  } else if (personalCount === 0) {
    text = `✨ enrichi par ${libraryCount} exemple${libraryCount > 1 ? 's' : ''} de la bibliothèque ${secteurLabel}`;
  } else {
    text = `✨ enrichi par ${personalCount} exemple${personalCount > 1 ? 's' : ''} qui ${personalCount > 1 ? 'ont' : 'a'} déjà marché + ${libraryCount} de la bibliothèque ${secteurLabel}`;
  }

  return `<span class="exemples-note">${text}</span>`;
}

// Ctrl/Cmd + Entrée dans l'objection = générer sans quitter le clavier
document.getElementById('objectionInput').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !document.getElementById('generateObjectionBtn').disabled) {
    handleGenerateObjection();
  }
});

async function handleGenerateObjection() {
  // Pré-contrôle de confort seulement : le vrai refus vient du serveur (402).
  const limite = limiteGenerations(currentProfile);
  if (limite !== null && getQuotaUsed(currentProfile) >= limite) {
    showQuotaExhausted('Quota épuisé pour ce mois-ci.');
    return;
  }

  const objection = document.getElementById('objectionInput').value.trim();
  if (!objection) return;

  const prospectId = document.getElementById('prospectSelect').value;
  const btn = document.getElementById('generateObjectionBtn');
  btn.disabled = true;
  btn.textContent = 'génération en cours…';

  try {
    const [exemples, prospect] = await Promise.all([
      getWorkedObjectionExamples(),
      buildProspectContext(prospectId),
    ]);

    const response = await fetch('/api/objections', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        secteur: LABELS_SECTEUR[currentProfile.secteur] || currentProfile.secteur,
        offre: currentProfile.offre,
        objection,
        exemples,
        styleProfile: currentProfile.style_profile || null,
        adresse: currentAddress,
        prospect,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.upgrade) showQuotaExhausted(data.error);
      else showToast('Erreur : ' + (data.error || 'impossible de générer la réponse'), 'failed');
      return;
    }

    currentProfile = applyQuotaFromServer(currentProfile, data.quota);

    document.getElementById('objectionOutputText').textContent = data.reponse;
    document.getElementById('objectionOutputMeta').innerHTML = objection.slice(0, 60) +
      buildExemplesNote(exemples, LABELS_SECTEUR[currentProfile.secteur] || currentProfile.secteur) +
      (currentProfile.style_profile
        ? `<span class="exemples-note">🧠 affiné par ton profil de style personnel</span>`
        : '');
    const outputCard = document.getElementById('objectionOutputCard');
    outputCard.classList.add('visible');
    // amène le résultat dans le viewport (sur mobile il naît sous le fold)
    outputCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('saveObjectionBtn').classList.remove('active');

  } catch (err) {
    showToast('Erreur réseau, réessaie dans un instant.', 'failed');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ générer la réponse';
    updateQuotaDisplay(); // re-désactive le bouton si ce coup a épuisé le quota
  }
}

function handleCopyObjection() {
  const texte = document.getElementById('objectionOutputText').textContent;
  navigator.clipboard.writeText(texte);

  const btn = document.getElementById('copyObjectionBtn');
  const original = btn.textContent;
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = original; }, 1200);
}

let currentObjectionSearch = '';
let currentObjectionSort = 'recent';
let lastSavedObjections = [];
let currentObjectionId = null;

async function getSavedObjections() {
  const { data } = await supabaseClient
    .from('saved_objections')
    .select('*')
    .order('created_at', { ascending: false });
  return data || [];
}

async function handleSaveObjection() {
  const objection = document.getElementById('objectionInput').value.trim();
  const reponse = document.getElementById('objectionOutputText').textContent;
  if (!objection || !reponse) return;

  const prospectId = document.getElementById('prospectSelect').value || null;

  const { error } = await supabaseClient
    .from('saved_objections')
    .insert({ user_id: currentUser.id, objection, reponse, prospect_id: prospectId });

  if (error) {
    showToast('Erreur lors de la sauvegarde : ' + error.message, 'failed');
    return;
  }

  document.getElementById('saveObjectionBtn').classList.add('active');
  showToast('★ Objection sauvegardée.', 'info');
  await renderSavedObjectionsList();
}

async function handleSetObjectionOutcome(id, value) {
  const current = lastSavedObjections.find(o => o.id === id);
  const next = current && current.outcome === value ? null : value;

  const { error } = await supabaseClient
    .from('saved_objections')
    .update({ outcome: next })
    .eq('id', id);

  if (error) {
    showToast('Erreur lors de la mise à jour : ' + error.message, 'failed');
    return;
  }

  if (next === 'worked') {
    showToast('👍 Noté — cette réponse sera proposée comme exemple dans tes prochaines générations.', 'worked');
  } else if (next === 'failed') {
    showToast('👎 Noté — elle ne sera plus utilisée comme modèle.', 'failed');
  } else {
    showToast('Retour retiré.', 'info');
  }

  currentProfile = await maybeRefreshStyleProfile(currentProfile);
  await renderSavedObjectionsList();
  if (currentObjectionId === id) {
    const updated = lastSavedObjections.find(o => o.id === id);
    if (updated) renderObjectionOutcomeButtons(updated);
  }
}

async function handleDeleteObjection(id, ev) {
  if (!confirmTap(ev)) return; // premier tap : arme le bouton ("sûr ?")

  const { error } = await supabaseClient
    .from('saved_objections')
    .delete()
    .eq('id', id);

  if (error) {
    showToast('Erreur lors de la suppression : ' + error.message, 'failed');
    return;
  }

  if (currentObjectionId === id) closeObjectionModal();
  showToast('Objection supprimée.', 'info');
  await renderSavedObjectionsList();
}

async function renderSavedObjectionsList() {
  const container = document.getElementById('savedObjectionsList');
  lastSavedObjections = await getSavedObjections();

  let list = lastSavedObjections;

  if (currentObjectionSearch) {
    const q = currentObjectionSearch.toLowerCase();
    list = list.filter(o => o.objection.toLowerCase().includes(q) || o.reponse.toLowerCase().includes(q));
  }

  if (currentObjectionSort === 'oldest') {
    list = [...list].reverse();
  }

  if (list.length === 0) {
    container.innerHTML = lastSavedObjections.length === 0
      ? '<p class="empty-state">aucune objection traitée pour l\'instant — saisis ci-dessus la dernière que tu as reçue.</p>'
      : '<p class="empty-state">aucune objection ne correspond à cette recherche.</p>';
    return;
  }

  container.innerHTML = list.map(o => `
    <div class="saved-item" onclick="openObjectionDetail('${o.id}')">
      <div class="saved-item-head">
        <span class="name">${o.objection.slice(0, 60)}</span>
        <div class="saved-item-actions">
          <button class="icon-btn ${o.outcome === 'worked' ? 'fb-on-worked' : ''}" onclick="event.stopPropagation(); handleSetObjectionOutcome('${o.id}', 'worked')" title="a fonctionné">👍</button>
          <button class="icon-btn ${o.outcome === 'failed' ? 'fb-on-failed' : ''}" onclick="event.stopPropagation(); handleSetObjectionOutcome('${o.id}', 'failed')" title="n'a pas fonctionné">👎</button>
          <button class="icon-btn" onclick="event.stopPropagation(); handleDeleteObjection('${o.id}', event)" title="supprimer">🗑</button>
        </div>
      </div>
      <span class="tag">${formatDateTime(o.created_at)}</span>
      ${o.outcome === 'worked' ? '<span class="outcome-tag worked">✓ a fonctionné — utilisée comme exemple</span>' : ''}
      ${o.outcome === 'failed' ? '<span class="outcome-tag failed">✕ n\'a pas fonctionné</span>' : ''}
      <p>${o.reponse.slice(0, 140)}${o.reponse.length > 140 ? '…' : ''}</p>
    </div>
  `).join('');
}

document.getElementById('savedObjectionsSearchInput').addEventListener('input', (e) => {
  currentObjectionSearch = e.target.value.trim();
  renderSavedObjectionsList();
});

document.getElementById('savedObjectionsSortSelect').addEventListener('change', (e) => {
  currentObjectionSort = e.target.value;
  renderSavedObjectionsList();
});


/* ================================================================
   MODALE DÉTAIL D'UNE OBJECTION SAUVEGARDÉE
   ================================================================ */

function renderObjectionOutcomeButtons(o) {
  document.getElementById('objectionModalWorkedBtn').classList.toggle('fb-on-worked', o.outcome === 'worked');
  document.getElementById('objectionModalFailedBtn').classList.toggle('fb-on-failed', o.outcome === 'failed');
}

function openObjectionDetail(id) {
  const o = lastSavedObjections.find(x => x.id === id);
  if (!o) return;

  currentObjectionId = id;
  document.getElementById('objectionModalQuestion').textContent = o.objection;
  document.getElementById('objectionModalMeta').textContent = formatDateTime(o.created_at);
  document.getElementById('objectionModalText').textContent = o.reponse;
  renderObjectionOutcomeButtons(o);
  document.getElementById('objectionModal').classList.remove('hidden');
}

function closeObjectionModal() {
  document.getElementById('objectionModal').classList.add('hidden');
  currentObjectionId = null;
}

function handleCopyObjectionModal() {
  copyWithToast(document.getElementById('objectionModalText').textContent);
}

async function startApp(profile) {
  currentProfile = profile;
  renderProfilePill(profile);
  updateQuotaDisplay();
  await populateProspectSelect();
  await renderSavedObjectionsList();
  // filet de sécurité : si des retours notés existent déjà sans profil de
  // style à jour (ex. généré avant que les colonnes existent en base),
  // on rattrape ici plutôt que de dépendre du prochain clic 👍/👎
  currentProfile = await maybeRefreshStyleProfile(currentProfile);
}

document.addEventListener('DOMContentLoaded', () => {
  checkAccess();
});
