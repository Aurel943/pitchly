/* ================================================================
   PITCHLY — prospects.js
   Page prospects.html : mini-CRM. L'utilisateur crée une fiche par
   prospect (nom, entreprise, secteur, statut, notes) — table Supabase
   "prospects". Les scripts (saved_scripts) et réponses aux objections
   (saved_objections) générés pour ce prospect s'y rattachent via
   prospect_id (choisi sur app.html / objections.html), formant
   automatiquement son historique d'échanges, affiché dans la modale
   de détail.

   Même gate d'accès que app.html/objections.html : session + profil
   complet, sinon retour vers dashboard.html qui gère la complétion.
   ================================================================ */

let currentProfile = null;

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
  document.getElementById('mainProspects').classList.remove('hidden');
  await startApp(profile);
}

function renderProfilePill(profile) {
  const pill = document.getElementById('profilePill');
  pill.textContent = LABELS_SECTEUR[profile.secteur] || profile.secteur;
}


/* ================================================================
   CRÉATION D'UN PROSPECT
   ================================================================ */

function readSecteur(selectId, autreInputId) {
  const select = document.getElementById(selectId);
  if (select.value === 'autre') {
    return document.getElementById(autreInputId).value.trim();
  }
  return select.value;
}

async function handleCreateProspect() {
  const nom = document.getElementById('prospectNomInput').value.trim();
  if (!nom) return;

  const entreprise = document.getElementById('prospectEntrepriseInput').value.trim();
  const statut = document.getElementById('prospectStatutInput').value;
  const secteur = readSecteur('prospectSecteurInput', 'prospectSecteurAutreInput');
  const notes = document.getElementById('prospectNotesInput').value.trim();

  const { error } = await supabaseClient
    .from('prospects')
    .insert({ user_id: currentUser.id, nom, entreprise: entreprise || null, secteur: secteur || null, statut, notes: notes || null });

  if (error) {
    alert('Erreur lors de la création : ' + error.message);
    return;
  }

  document.getElementById('prospectNomInput').value = '';
  document.getElementById('prospectEntrepriseInput').value = '';
  document.getElementById('prospectNotesInput').value = '';
  document.getElementById('prospectStatutInput').value = 'nouveau';

  await renderProspectsList();
}


/* ================================================================
   LISTE DES PROSPECTS
   ================================================================ */

let currentProspectFilter = 'tous';
let currentProspectSearch = '';
let currentProspectSort = 'recent';
let lastProspects = [];
let currentProspectId = null;

async function handleSetProspectStatut(id, statut) {
  const { error } = await supabaseClient
    .from('prospects')
    .update({ statut, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    alert('Erreur lors de la mise à jour : ' + error.message);
    return;
  }

  await renderProspectsList();
}

async function renderProspectsList() {
  const container = document.getElementById('prospectsList');
  lastProspects = await getProspects();

  let list = currentProspectFilter === 'tous' ? lastProspects : lastProspects.filter(p => p.statut === currentProspectFilter);

  if (currentProspectSearch) {
    const q = currentProspectSearch.toLowerCase();
    list = list.filter(p =>
      p.nom.toLowerCase().includes(q) ||
      (p.entreprise || '').toLowerCase().includes(q) ||
      (p.notes || '').toLowerCase().includes(q)
    );
  }

  list = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (currentProspectSort === 'oldest') {
    list = list.reverse();
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="empty-state">aucun prospect pour l\'instant.</p>';
    return;
  }

  container.innerHTML = list.map(p => `
    <div class="saved-item" onclick="openProspectDetail('${p.id}')">
      <div class="saved-item-head">
        <span class="name">${p.nom}</span>
        <div class="saved-item-actions">
          <select class="statut-select-inline" onclick="event.stopPropagation()" onchange="event.stopPropagation(); handleSetProspectStatut('${p.id}', this.value)">
            ${Object.entries(LABELS_STATUT).map(([code, label]) => `<option value="${code}" ${p.statut === code ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
          <button class="icon-btn" onclick="event.stopPropagation(); handleDeleteProspect('${p.id}')" title="supprimer">🗑</button>
        </div>
      </div>
      <span class="tag">${p.entreprise ? p.entreprise + ' · ' : ''}${formatDateTime(p.created_at)}</span>
      ${p.notes ? `<p>${p.notes.slice(0, 140)}${p.notes.length > 140 ? '…' : ''}</p>` : ''}
    </div>
  `).join('');
}

document.getElementById('prospectsFilters').addEventListener('click', (e) => {
  if (!e.target.classList.contains('filter')) return;
  document.querySelectorAll('#prospectsFilters .filter').forEach(f => f.classList.remove('active'));
  e.target.classList.add('active');
  currentProspectFilter = e.target.dataset.filter;
  renderProspectsList();
});

document.getElementById('prospectsSearchInput').addEventListener('input', (e) => {
  currentProspectSearch = e.target.value.trim();
  renderProspectsList();
});

document.getElementById('prospectsSortSelect').addEventListener('change', (e) => {
  currentProspectSort = e.target.value;
  renderProspectsList();
});


/* ================================================================
   MODALE DÉTAIL D'UN PROSPECT — édition, historique, suppression
   ================================================================ */

function renderProspectTimelineItem(item) {
  const typeLabel = item.type === 'script' ? 'script' : 'objection';
  const outcomeTag = item.outcome === 'worked' ? '<span class="outcome-tag worked">✓ a fonctionné</span>' :
    item.outcome === 'failed' ? '<span class="outcome-tag failed">✕ n\'a pas fonctionné</span>' : '';
  return `
    <div class="saved-item">
      <div class="saved-item-head">
        <span class="name">${typeLabel} · ${formatDateTime(item.created_at)}</span>
      </div>
      ${outcomeTag}
      <p>${item.text.slice(0, 140)}${item.text.length > 140 ? '…' : ''}</p>
    </div>
  `;
}

async function renderProspectTimeline(prospectId) {
  const container = document.getElementById('prospectTimeline');
  const items = await getCombinedSaved({ prospectId });

  if (items.length === 0) {
    container.innerHTML = '<p class="empty-state">aucun script ni réponse à objection rattaché à ce prospect pour l\'instant.</p>';
    return;
  }

  container.innerHTML = items.map(renderProspectTimelineItem).join('');
}

async function openProspectDetail(id) {
  const p = lastProspects.find(x => x.id === id);
  if (!p) return;

  currentProspectId = id;
  document.getElementById('prospectModalNom').value = p.nom;
  document.getElementById('prospectModalEntreprise').value = p.entreprise || '';
  document.getElementById('prospectModalStatut').value = p.statut;

  const secteurSelect = document.getElementById('prospectModalSecteur');
  const secteurAutreInput = document.getElementById('prospectModalSecteurAutre');
  const knownSecteurs = Array.from(secteurSelect.options).map(o => o.value).filter(v => v !== 'autre');
  if (p.secteur && !knownSecteurs.includes(p.secteur)) {
    secteurSelect.value = 'autre';
    secteurAutreInput.value = p.secteur;
    secteurAutreInput.classList.remove('hidden');
  } else {
    secteurSelect.value = p.secteur || 'coaching';
    secteurAutreInput.value = '';
    secteurAutreInput.classList.add('hidden');
  }

  document.getElementById('prospectModalNotes').value = p.notes || '';

  document.getElementById('prospectModal').classList.remove('hidden');
  await renderProspectTimeline(id);
}

function closeProspectModal() {
  document.getElementById('prospectModal').classList.add('hidden');
  currentProspectId = null;
}

async function handleSaveProspectEdits() {
  if (!currentProspectId) return;

  const nom = document.getElementById('prospectModalNom').value.trim();
  if (!nom) return;

  const entreprise = document.getElementById('prospectModalEntreprise').value.trim();
  const statut = document.getElementById('prospectModalStatut').value;
  const secteur = readSecteur('prospectModalSecteur', 'prospectModalSecteurAutre');
  const notes = document.getElementById('prospectModalNotes').value.trim();

  const { error } = await supabaseClient
    .from('prospects')
    .update({
      nom,
      entreprise: entreprise || null,
      statut,
      secteur: secteur || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', currentProspectId);

  if (error) {
    alert('Erreur lors de la mise à jour : ' + error.message);
    return;
  }

  showToast('Fiche prospect enregistrée.', 'info');
  await renderProspectsList();
}

async function handleDeleteProspect(id) {
  if (!confirm('Supprimer cette fiche prospect ? Les scripts et objections déjà rattachés seront conservés mais détachés.')) return;

  const { error } = await supabaseClient
    .from('prospects')
    .delete()
    .eq('id', id);

  if (error) {
    alert('Erreur lors de la suppression : ' + error.message);
    return;
  }

  if (currentProspectId === id) closeProspectModal();
  await renderProspectsList();
}


/* ================================================================
   DÉMARRAGE DE L'APP UNE FOIS AUTH + PROFIL RÉSOLUS
   ================================================================ */

async function startApp(profile) {
  currentProfile = profile;
  renderProfilePill(profile);
  await renderProspectsList();
}

document.addEventListener('DOMContentLoaded', () => {
  checkAccess();
});
