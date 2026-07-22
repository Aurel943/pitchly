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
  const loader = document.getElementById('pageLoader');
  if (loader) loader.remove();
  document.getElementById('mainProspects').classList.remove('hidden');
  await startApp(profile);
}

function renderProfilePill(profile) {
  const pill = document.getElementById('profilePill');
  pill.textContent = LABELS_SECTEUR[profile.secteur] || profile.secteur;
}


/* ================================================================
   PAR OÙ COMMENCER — analyser un site, puis créer la fiche

   Le parcours part de la seule question que se pose vraiment quelqu'un
   qui ne sait pas prospecter : « j'ai cette entreprise en tête,
   qu'est-ce que je peux bien lui dire ? ». La fiche prospect n'est
   créée qu'à la fin, une fois l'angle trouvé — lui demander d'abord de
   remplir un formulaire pour un prospect dont il ne sait pas encore
   quoi faire, c'était lui faire payer le prix avant la valeur.
   ================================================================ */

let anglesTrouves = [];
let angleRetenu = null;
let entrepriseDevinee = '';
let siteAnalyse = '';

// Rendu partagé entre le bloc d'accueil et la fiche prospect — deux
// copies du même gabarit finiraient par diverger.
function renderAccrocheCards(accroches, handler) {
  return accroches.map((a, i) => `
    <div class="accroche-card">
      <p class="acc-fait">${escapeHtml(a.fait)}</p>
      <p class="acc-angle">${escapeHtml(a.angle)}</p>
      ${a.ouverture ? `<p class="acc-ouverture">« ${escapeHtml(a.ouverture)} »</p>` : ''}
      ${a.pourquoi ? `<p class="acc-pourquoi">${escapeHtml(a.pourquoi)}</p>` : ''}
      <button class="btn-text acc-choose" onclick="${handler}(${i})">retenir cet angle →</button>
    </div>`).join('');
}

// Le fait ET l'angle sont conservés ensemble : le fait seul ne dit pas
// au générateur quoi en faire, l'angle seul perd la preuve vérifiable
// qui rend le message crédible.
function texteAccroche(a) {
  return `${a.fait} — ${a.angle}`;
}

async function appelerAccroches({ url, prospect }) {
  const response = await fetch('/api/accroches', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ url, prospect }),
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

async function handleAnalyseSite() {
  const site = document.getElementById('starterSiteInput').value.trim();
  if (!site) {
    showToast("Colle l'adresse du site de l'entreprise que tu veux contacter.", 'failed');
    return;
  }

  const btn = document.getElementById('starterBtn');
  const zone = document.getElementById('starterResults');
  document.getElementById('starterCreate').classList.add('hidden');

  btn.disabled = true;
  btn.textContent = 'lecture du site…';
  zone.innerHTML = '<p class="empty-state">Pitchly lit le site, ça prend quelques secondes…</p>';

  try {
    const { ok, data } = await appelerAccroches({ url: site, prospect: null });

    if (!ok) {
      if (data.upgrade) showQuotaExhausted(data.error);
      zone.innerHTML = `<p class="empty-state">${escapeHtml(data.error || 'Analyse impossible.')}</p>`;
      return;
    }

    currentProfile = applyQuotaFromServer(currentProfile, data.quota);
    anglesTrouves = data.accroches;
    entrepriseDevinee = data.entreprise || '';
    siteAnalyse = site;

    zone.innerHTML = renderAccrocheCards(data.accroches, 'handleRetenirAngle');

  } catch {
    zone.innerHTML = '<p class="empty-state">Erreur réseau, réessaie dans un instant.</p>';
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ trouver des angles';
  }
}

function handleRetenirAngle(index) {
  const choix = anglesTrouves[index];
  if (!choix) return;

  angleRetenu = choix;
  document.getElementById('starterChosen').textContent = texteAccroche(choix);
  document.getElementById('starterEntrepriseInput').value = entrepriseDevinee;

  const bloc = document.getElementById('starterCreate');
  bloc.classList.remove('hidden');
  bloc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('starterNomInput').focus();
}

function annulerCreationDepuisAngle() {
  angleRetenu = null;
  document.getElementById('starterCreate').classList.add('hidden');
}

async function handleCreateFromAngle() {
  if (!angleRetenu) return;

  const nom = document.getElementById('starterNomInput').value.trim();
  const entreprise = document.getElementById('starterEntrepriseInput').value.trim();
  const email = document.getElementById('starterEmailInput').value.trim();

  // Le nom du contact est le seul champ vraiment obligatoire : sans lui
  // la fiche n'est identifiable ni dans la liste ni dans un message.
  if (!nom) {
    showToast('Donne au moins le nom de la personne à contacter.', 'failed');
    document.getElementById('starterNomInput').focus();
    return;
  }

  const { error } = await supabaseClient.from('prospects').insert({
    user_id: currentUser.id,
    nom,
    entreprise: entreprise || null,
    email: email || null,
    site_url: siteAnalyse || null,
    accroche: texteAccroche(angleRetenu),
    statut: 'nouveau',
  });

  if (error) {
    showToast('Erreur lors de la création : ' + error.message, 'failed');
    return;
  }

  document.getElementById('starterSiteInput').value = '';
  document.getElementById('starterNomInput').value = '';
  document.getElementById('starterEntrepriseInput').value = '';
  document.getElementById('starterEmailInput').value = '';
  document.getElementById('starterResults').innerHTML = '';
  annulerCreationDepuisAngle();
  anglesTrouves = [];

  showToast(`Fiche "${nom}" créée avec son accroche. Tu peux lui écrire.`, 'info');
  await renderProspectsList();
}


/* ================================================================
   CRÉATION D'UN PROSPECT À LA MAIN
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
  const siteUrl = document.getElementById('prospectSiteInput').value.trim();

  const { error } = await supabaseClient
    .from('prospects')
    .insert({ user_id: currentUser.id, nom, entreprise: entreprise || null, secteur: secteur || null, statut, notes: notes || null, site_url: siteUrl || null });

  if (error) {
    showToast('Erreur lors de la création : ' + error.message, 'failed');
    return;
  }

  document.getElementById('prospectNomInput').value = '';
  document.getElementById('prospectEntrepriseInput').value = '';
  document.getElementById('prospectNotesInput').value = '';
  document.getElementById('prospectSiteInput').value = '';
  document.getElementById('prospectStatutInput').value = 'nouveau';

  showToast(`Fiche "${nom}" créée.`, 'info');
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
    showToast('Erreur lors de la mise à jour : ' + error.message, 'failed');
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
    container.innerHTML = lastProspects.length === 0
      ? '<p class="empty-state">aucun prospect pour l\'instant — ajoute ta première fiche ci-dessus, elle pré-remplira tes prochains scripts.</p>'
      : '<p class="empty-state">aucun prospect ne correspond à cette recherche ou ce filtre.</p>';
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
          <button class="icon-btn" onclick="event.stopPropagation(); handleDeleteProspect('${p.id}', event)" title="supprimer (les scripts liés seront détachés)">🗑</button>
        </div>
      </div>
      <span class="tag">${escapeHtml(p.entreprise ? p.entreprise + ' · ' : '')}${formatDateTime(p.created_at)}</span>
      ${p.accroche
        ? `<span class="accroche-tag">✦ accroche trouvée</span><p>${escapeHtml(p.accroche.slice(0, 140))}${p.accroche.length > 140 ? '…' : ''}</p>`
        : `<span class="accroche-tag missing">aucune raison de le contacter — ouvre la fiche</span>
           ${p.notes ? `<p>${escapeHtml(p.notes.slice(0, 140))}${p.notes.length > 140 ? '…' : ''}</p>` : ''}`}
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
  document.getElementById('prospectModalSite').value = p.site_url || '';

  renderAccroche(p.accroche);
  document.getElementById('accrocheResults').innerHTML = '';

  document.getElementById('prospectModal').classList.remove('hidden');
  await renderProspectTimeline(id);
}

function closeProspectModal() {
  document.getElementById('prospectModal').classList.add('hidden');
  currentProspectId = null;
}

/* ================================================================
   ACCROCHES — pourquoi écrire à ce prospect aujourd'hui

   Le reste de la page gère des informations que l'utilisateur possède
   déjà (nom, entreprise, notes). Ce bloc-là produit celle qui lui
   manque, et qui décide si son premier message sera lu : un fait
   concret observé sur le site du prospect.
   ================================================================ */

function renderAccroche(accroche) {
  const bloc = document.getElementById('accrocheCurrent');
  const vide = document.getElementById('accrocheEmpty');

  if (!accroche) {
    bloc.classList.add('hidden');
    vide.classList.remove('hidden');
    return;
  }

  document.getElementById('accrocheCurrentText').textContent = accroche;
  bloc.classList.remove('hidden');
  vide.classList.add('hidden');
}

async function enregistrerAccroche(valeur) {
  const { error } = await supabaseClient
    .from('prospects')
    .update({ accroche: valeur, updated_at: new Date().toISOString() })
    .eq('id', currentProspectId);

  if (error) {
    showToast('Erreur lors de la sauvegarde : ' + error.message, 'failed');
    return false;
  }
  await renderProspectsList();
  return true;
}

async function handleChooseAccroche(index) {
  const choix = dernieresAccroches[index];
  if (!choix || !currentProspectId) return;

  const texte = texteAccroche(choix);

  if (await enregistrerAccroche(texte)) {
    renderAccroche(texte);
    document.getElementById('accrocheResults').innerHTML = '';
    showToast('Accroche retenue. Tous tes messages pour ce prospect partiront de là.', 'info');
  }
}

async function handleClearAccroche() {
  if (!currentProspectId) return;
  if (await enregistrerAccroche(null)) renderAccroche(null);
}

let dernieresAccroches = [];

async function handleFindAccroches() {
  if (!currentProspectId) return;

  const site = document.getElementById('prospectModalSite').value.trim();
  if (!site) {
    showToast("Renseigne l'adresse de son site pour que Pitchly puisse le lire.", 'failed');
    return;
  }

  const btn = document.getElementById('accrocheBtn');
  const resultats = document.getElementById('accrocheResults');
  btn.disabled = true;
  btn.textContent = 'lecture du site…';
  resultats.innerHTML = '<p class="empty-state">Pitchly lit le site, ça prend quelques secondes…</p>';

  const p = lastProspects.find(x => x.id === currentProspectId);

  try {
    const { ok, data } = await appelerAccroches({
      url: site,
      prospect: p ? { nom: p.nom, entreprise: p.entreprise, notes: p.notes } : null,
    });

    if (!ok) {
      if (data.upgrade) showQuotaExhausted(data.error);
      resultats.innerHTML = `<p class="empty-state">${escapeHtml(data.error || 'Analyse impossible.')}</p>`;
      return;
    }

    currentProfile = applyQuotaFromServer(currentProfile, data.quota);
    dernieresAccroches = data.accroches;

    // L'adresse est conservée sur la fiche : elle resservira à chaque
    // fois qu'on voudra rafraîchir les angles sur ce prospect.
    await supabaseClient.from('prospects')
      .update({ site_url: site }).eq('id', currentProspectId);

    resultats.innerHTML = renderAccrocheCards(data.accroches, 'handleChooseAccroche');

  } catch {
    resultats.innerHTML = '<p class="empty-state">Erreur réseau, réessaie dans un instant.</p>';
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ trouver des angles';
  }
}

async function handleSaveProspectEdits() {
  if (!currentProspectId) return;

  const nom = document.getElementById('prospectModalNom').value.trim();
  if (!nom) return;

  const entreprise = document.getElementById('prospectModalEntreprise').value.trim();
  const statut = document.getElementById('prospectModalStatut').value;
  const secteur = readSecteur('prospectModalSecteur', 'prospectModalSecteurAutre');
  const notes = document.getElementById('prospectModalNotes').value.trim();
  const siteUrl = document.getElementById('prospectModalSite').value.trim();

  const { error } = await supabaseClient
    .from('prospects')
    .update({
      nom,
      entreprise: entreprise || null,
      statut,
      secteur: secteur || null,
      notes: notes || null,
      site_url: siteUrl || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', currentProspectId);

  if (error) {
    showToast('Erreur lors de la mise à jour : ' + error.message, 'failed');
    return;
  }

  showToast('Fiche prospect enregistrée.', 'info');
  await renderProspectsList();
}

async function handleDeleteProspect(id, ev) {
  if (!confirmTap(ev)) return; // premier tap : arme le bouton ("sûr ?")

  const { error } = await supabaseClient
    .from('prospects')
    .delete()
    .eq('id', id);

  if (error) {
    showToast('Erreur lors de la suppression : ' + error.message, 'failed');
    return;
  }

  if (currentProspectId === id) closeProspectModal();
  showToast('Fiche supprimée — les scripts liés sont conservés, juste détachés.', 'info');
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
