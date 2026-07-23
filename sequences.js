/* ================================================================
   PITCHLY — sequences.js
   Page sequences.html : l'utilisateur décrit son objectif, Claude
   génère une SÉQUENCE complète de prospection écrite (premier contact
   + relances + clôture) via /api/sequence, affichée en timeline. La
   séquence entière peut être sauvegardée (table "saved_sequences",
   étapes stockées en JSON).

   Réutilise le moteur de personnalisation partagé : exemples "a
   marché", contexte prospect, profil de style appris (auth.js).
   Partage le quota mensuel (une séquence = 1 génération, même si elle
   produit plusieurs messages d'un coup).

   Même gate d'accès que app.html / objections.html : session + profil
   complet, sinon retour vers dashboard.html.
   ================================================================ */

let currentProfile = null;
let currentTone = 'direct';
let currentAddress = 'vous';
let lastProspectsForSelect = [];
let lastGeneratedSequence = null; // { canal, objectif, prospectId, etapes }

const OBJECTIF_LABELS = {
  premier_contact: 'premier contact',
  relance: 'relance',
  closing: 'closing',
};

async function populateProspectSelect() {
  lastProspectsForSelect = await getProspects();
  const select = document.getElementById('prospectSelect');
  select.innerHTML = '<option value="">— aucun prospect —</option>' +
    lastProspectsForSelect.map(p => `<option value="${p.id}">${p.nom}${p.entreprise ? ' · ' + p.entreprise : ''}</option>`).join('');
}

// Bloc structuré du prospect sélectionné (fiche CRM + historique récent),
// identique à app.js/objections.js — sans ça la séquence ignore le prospect.
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
    accroche: prospect.accroche,
    historique: historique.map(h => ({ type: h.type, outcome: h.outcome, texte: h.text })),
  };
}

// Deux meilleurs messages "a marché" (mêmes que le générateur de script),
// pour caler le ton de la séquence sur ce qui marche déjà pour ce vendeur.
async function getWorkedExamples(canal) {
  const { data } = await supabaseClient
    .from('saved_scripts')
    .select('canal, texte')
    .eq('outcome', 'worked')
    .order('created_at', { ascending: false })
    .limit(10);

  const list = data || [];
  const sameCanal = list.filter(s => s.canal === canal);
  const rest = list.filter(s => s.canal !== canal);
  return [...sameCanal, ...rest].slice(0, 2);
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
  document.getElementById('mainSequences').classList.remove('hidden');
  await startApp(profile);
}

function renderProfilePill(profile) {
  renderNavAccount(profile);
}

function updateQuotaDisplay() {
  const limite = limiteGenerations(currentProfile);
  const btn = document.getElementById('generateBtn');

  if (limite === null) {
    document.getElementById('quotaDisplay').textContent = 'générations illimitées';
    return;
  }

  const restant = Math.max(0, limite - getQuotaUsed(currentProfile));
  document.getElementById('quotaDisplay').textContent =
    `${restant} génération${restant > 1 ? 's' : ''} restante${restant > 1 ? 's' : ''}`;

  if (restant === 0) {
    btn.disabled = true;
    btn.textContent = 'quota mensuel épuisé';
  }
}

// Échappe le HTML — les messages générés sont insérés via innerHTML dans
// la timeline, on ne veut pas qu'un "<" du texte casse le rendu.
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Rend une séquence (tableau d'étapes) en timeline dans le conteneur donné.
// Chaque étape : badge délai, titre, objet (email), message, bouton copier.
function renderTimeline(container, etapes, canal) {
  container.innerHTML = etapes.map((e, i) => `
    <div class="seq-step">
      <div class="seq-step-rail">
        <span class="seq-step-dot">${i + 1}</span>
      </div>
      <div class="seq-step-body">
        <div class="seq-step-head">
          <span class="seq-step-title">${esc(e.titre)}</span>
          ${e.delai ? `<span class="seq-step-delay">${esc(e.delai)}</span>` : ''}
          <button class="icon-btn seq-step-copy" onclick="handleCopyStep(this, ${i})" title="copier ce message">⧉</button>
        </div>
        ${canal === 'email' && e.objet ? `<p class="seq-step-objet"><span>objet</span>${esc(e.objet)}</p>` : ''}
        <p class="seq-step-message">${esc(e.message)}</p>
      </div>
    </div>
  `).join('');
}

// Texte plein d'une séquence, pour le presse-papier (tout copier).
function sequenceToPlainText(etapes, canal) {
  return etapes.map((e, i) => {
    const head = `— ${e.titre}${e.delai ? ` (${e.delai})` : ''} —`;
    const objet = canal === 'email' && e.objet ? `Objet : ${e.objet}\n` : '';
    return `${head}\n${objet}${e.message}`;
  }).join('\n\n');
}

async function handleGenerateSequence() {
  // Pré-contrôle de confort seulement : le vrai refus vient du serveur (402).
  const limite = limiteGenerations(currentProfile);
  if (limite !== null && getQuotaUsed(currentProfile) >= limite) {
    showQuotaExhausted('Quota épuisé pour ce mois-ci.');
    return;
  }

  const canal = document.getElementById('canalSelect').value;
  const objectif = document.getElementById('objectifSelect').value;
  const etapesCount = document.getElementById('etapesSelect').value;
  const contexte = document.getElementById('contexteInput').value.trim();
  const prospectId = document.getElementById('prospectSelect').value;
  const btn = document.getElementById('generateBtn');

  btn.disabled = true;
  btn.textContent = 'génération en cours…';

  try {
    const [exemples, prospect] = await Promise.all([
      getWorkedExamples(canal),
      buildProspectContext(prospectId),
    ]);

    const response = await fetch('/api/sequence', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        secteur: LABELS_SECTEUR[currentProfile.secteur] || currentProfile.secteur,
        offre: currentProfile.offre,
        panier: currentProfile.panier,
        canal,
        objectif,
        etapes: etapesCount,
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
      if (data.upgrade) showQuotaExhausted(data.error);
      else showToast('Erreur : ' + (data.error || 'impossible de générer la séquence'), 'failed');
      return;
    }

    currentProfile = applyQuotaFromServer(currentProfile, data.quota);

    lastGeneratedSequence = { canal, objectif, prospectId: prospectId || null, etapes: data.etapes };

    renderTimeline(document.getElementById('seqTimeline'), data.etapes, canal);
    document.getElementById('outputMeta').innerHTML =
      `${OBJECTIF_LABELS[objectif] || objectif} · ${canal} · ${data.etapes.length} messages` +
      (exemples.length > 0
        ? `<span class="exemples-note">✨ calée sur ${exemples.length} message${exemples.length > 1 ? 's' : ''} qui ${exemples.length > 1 ? 'ont' : 'a'} déjà marché</span>`
        : '') +
      (currentProfile.style_profile
        ? `<span class="exemples-note">🧠 affinée par ton profil de style personnel</span>`
        : '');

    const outputCard = document.getElementById('outputCard');
    outputCard.classList.add('visible');
    outputCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('saveBtn').classList.remove('active');

  } catch (err) {
    showToast('Erreur réseau, réessaie dans un instant.', 'failed');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ générer la séquence';
    updateQuotaDisplay();
  }
}

// Copier un seul message de la séquence courante (bouton dans la timeline).
function handleCopyStep(btn, index) {
  const etape = lastGeneratedSequence && lastGeneratedSequence.etapes[index];
  if (!etape) return;
  const objet = lastGeneratedSequence.canal === 'email' && etape.objet ? `Objet : ${etape.objet}\n` : '';
  navigator.clipboard.writeText(objet + etape.message);
  const original = btn.textContent;
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = original; }, 1200);
}

function handleCopyAll() {
  if (!lastGeneratedSequence) return;
  navigator.clipboard.writeText(sequenceToPlainText(lastGeneratedSequence.etapes, lastGeneratedSequence.canal));
  const btn = document.getElementById('copyAllBtn');
  const original = btn.textContent;
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = original; }, 1200);
}

// Nom par défaut : rôle du 1er message, tronqué.
function defaultSequenceName(seq) {
  const first = seq.etapes[0];
  const base = (first && first.objet) || (first && first.titre) || 'séquence';
  return `${OBJECTIF_LABELS[seq.objectif] || seq.objectif} — ${base}`.slice(0, 70);
}

async function handleSaveSequence() {
  if (!lastGeneratedSequence) return;

  const { canal, objectif, prospectId, etapes } = lastGeneratedSequence;

  const { error } = await supabaseClient
    .from('saved_sequences')
    .insert({
      user_id: currentUser.id,
      canal,
      objectif,
      etapes,
      nom: defaultSequenceName(lastGeneratedSequence),
      prospect_id: prospectId,
    });

  if (error) {
    showToast('Erreur lors de la sauvegarde : ' + error.message, 'failed');
    return;
  }

  document.getElementById('saveBtn').classList.add('active');
  showToast('★ Séquence sauvegardée.', 'info');
  await renderSavedList();
}


/* ================================================================
   SÉQUENCES SAUVEGARDÉES — table "saved_sequences" (RLS)
   ================================================================ */

let currentFilter = 'tous';
let currentSearch = '';
let currentSort = 'recent';
let lastSavedSequences = [];
let currentSequenceId = null;

async function getSavedSequences() {
  const { data } = await supabaseClient
    .from('saved_sequences')
    .select('*')
    .order('created_at', { ascending: false });
  return data || [];
}

async function renderSavedList() {
  const container = document.getElementById('savedList');
  lastSavedSequences = await getSavedSequences();

  let list = currentFilter === 'tous' ? lastSavedSequences : lastSavedSequences.filter(s => s.canal === currentFilter);

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(s =>
      (s.nom || '').toLowerCase().includes(q) ||
      (Array.isArray(s.etapes) && s.etapes.some(e => (e.message || '').toLowerCase().includes(q))));
  }

  if (currentSort === 'oldest') list = [...list].reverse();

  if (list.length === 0) {
    container.innerHTML = lastSavedSequences.length === 0
      ? '<p class="empty-state">aucune séquence sauvegardée — génère ta première relance complète ci-dessus, puis clique sur ★.</p>'
      : '<p class="empty-state">aucune séquence ne correspond à cette recherche ou ce filtre.</p>';
    return;
  }

  container.innerHTML = list.map(s => {
    const nbEtapes = Array.isArray(s.etapes) ? s.etapes.length : 0;
    const apercu = nbEtapes > 0 ? (s.etapes[0].message || '') : '';
    return `
    <div class="saved-item" onclick="openSequenceDetail('${s.id}')">
      <div class="saved-item-head">
        <span class="name">${esc(s.nom || (OBJECTIF_LABELS[s.objectif] || s.objectif))}</span>
        <div class="saved-item-actions">
          ${s.canal === 'email' ? `<button class="icon-btn" onclick="event.stopPropagation(); openLaunchModal('${s.id}')" title="lancer l'envoi">▶</button>` : ''}
          <button class="icon-btn ${s.outcome === 'worked' ? 'fb-on-worked' : ''}" onclick="event.stopPropagation(); handleSetSequenceOutcome('${s.id}', 'worked')" title="a fonctionné">👍</button>
          <button class="icon-btn ${s.outcome === 'failed' ? 'fb-on-failed' : ''}" onclick="event.stopPropagation(); handleSetSequenceOutcome('${s.id}', 'failed')" title="n'a pas fonctionné">👎</button>
          <button class="icon-btn" onclick="event.stopPropagation(); handleDeleteSequence('${s.id}', event)" title="supprimer">🗑</button>
        </div>
      </div>
      <span class="tag">${OBJECTIF_LABELS[s.objectif] || s.objectif} · ${s.canal} · ${nbEtapes} messages · ${formatDateTime(s.created_at)}</span>
      ${s.outcome === 'worked' ? '<span class="outcome-tag worked">✓ a fonctionné</span>' : ''}
      ${s.outcome === 'failed' ? '<span class="outcome-tag failed">✕ n\'a pas fonctionné</span>' : ''}
      <p>${esc(apercu.slice(0, 100))}${apercu.length > 100 ? '…' : ''}</p>
    </div>`;
  }).join('');
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
   MODALE DÉTAIL D'UNE SÉQUENCE SAUVEGARDÉE
   ================================================================ */

function renderSequenceOutcomeButtons(seq) {
  document.getElementById('sequenceModalWorkedBtn').classList.toggle('fb-on-worked', seq.outcome === 'worked');
  document.getElementById('sequenceModalFailedBtn').classList.toggle('fb-on-failed', seq.outcome === 'failed');
}

function openSequenceDetail(id) {
  const seq = lastSavedSequences.find(s => s.id === id);
  if (!seq) return;

  currentSequenceId = id;
  document.getElementById('sequenceModalName').value = seq.nom || '';
  document.getElementById('sequenceModalMeta').textContent =
    `${OBJECTIF_LABELS[seq.objectif] || seq.objectif} · ${seq.canal} · ${formatDateTime(seq.created_at)}`;
  renderTimeline(document.getElementById('sequenceModalTimeline'), seq.etapes || [], seq.canal);
  renderSequenceOutcomeButtons(seq);
  // L'envoi automatique n'existe que pour l'email : une séquence
  // LinkedIn se copie à la main, le bouton n'aurait rien à déclencher.
  document.getElementById('sequenceModalLaunchBtn').classList.toggle('hidden', seq.canal !== 'email');
  document.getElementById('sequenceModal').classList.remove('hidden');
}

function closeSequenceModal() {
  document.getElementById('sequenceModal').classList.add('hidden');
  currentSequenceId = null;
}

async function handleRenameSequenceSubmit() {
  if (!currentSequenceId) return;
  const nom = document.getElementById('sequenceModalName').value.trim();

  const { error } = await supabaseClient
    .from('saved_sequences')
    .update({ nom })
    .eq('id', currentSequenceId);

  if (error) {
    showToast('Erreur lors du renommage : ' + error.message, 'failed');
    return;
  }
  await renderSavedList();
}

// Copier toute la séquence affichée dans la modale.
function handleCopyAllModal() {
  const seq = lastSavedSequences.find(s => s.id === currentSequenceId);
  if (!seq) return;
  copyWithToast(sequenceToPlainText(seq.etapes || [], seq.canal));
}

async function handleSetSequenceOutcome(id, value) {
  const current = lastSavedSequences.find(s => s.id === id);
  const next = current && current.outcome === value ? null : value;

  const { error } = await supabaseClient
    .from('saved_sequences')
    .update({ outcome: next })
    .eq('id', id);

  if (error) {
    showToast('Erreur lors de la mise à jour : ' + error.message, 'failed');
    return;
  }

  if (next === 'worked') {
    showToast('👍 Noté — cette séquence nourrit ton profil de style.', 'worked');
  } else if (next === 'failed') {
    showToast('👎 Noté — elle ne servira plus de modèle.', 'failed');
  } else {
    showToast('Retour retiré.', 'info');
  }

  currentProfile = await maybeRefreshStyleProfile(currentProfile);
  await renderSavedList();
  if (currentSequenceId === id) {
    const updated = lastSavedSequences.find(s => s.id === id);
    if (updated) renderSequenceOutcomeButtons(updated);
  }
}

async function handleDeleteSequence(id, ev) {
  if (!confirmTap(ev)) return; // premier tap : arme le bouton ("sûr ?")

  const { error } = await supabaseClient
    .from('saved_sequences')
    .delete()
    .eq('id', id);

  if (error) {
    showToast('Erreur lors de la suppression : ' + error.message, 'failed');
    return;
  }

  if (currentSequenceId === id) closeSequenceModal();
  showToast('Séquence supprimée.', 'info');
  await renderSavedList();
}


/* ================================================================
   LANCEMENT D'ENVOI — de la séquence écrite à la séquence programmée

   Jusqu'ici tout se passait dans le navigateur : générer, sauvegarder,
   copier. À partir d'ici, de vrais emails partent chez de vraies
   personnes. D'où deux choix :

   - l'appel passe par /api/campaigns/start (et pas par supabaseClient
     en direct) : la planification et les refus (prospect désinscrit,
     campagne déjà en cours) doivent être décidés côté serveur, où le
     client ne peut pas les contourner ;
   - le calendrier complet est affiché AVANT confirmation. Personne ne
     doit découvrir après coup qu'il a programmé 4 emails.
   ================================================================ */

let currentLaunchSequenceId = null;

// Aperçu du calendrier, calculé côté client à titre indicatif : le
// serveur refait le calcul (et recale sur les créneaux ouvrés), c'est
// lui qui fait foi. Ici on cherche seulement à rendre lisible ce qui
// va se passer.
function renderLaunchRecap(seq, decalageJours) {
  const etapes = Array.isArray(seq.etapes) ? seq.etapes : [];
  const base = new Date();
  base.setDate(base.getDate() + (decalageJours || 0));

  document.getElementById('launchRecap').innerHTML = etapes.map((e, i) => {
    const jours = parseInt(String(e.delai || '').match(/\d+/)?.[0] ?? i * 3, 10);
    const date = new Date(base);
    date.setDate(date.getDate() + jours);
    const libelle = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

    return `
      <div class="launch-recap-row">
        <span class="launch-recap-date">${libelle}</span>
        <span class="launch-recap-obj">${esc(e.objet || e.titre || `message ${i + 1}`)}</span>
      </div>`;
  }).join('');
}

function openLaunchModal(id) {
  const seq = lastSavedSequences.find(s => s.id === id);
  if (!seq) return;

  if (seq.canal !== 'email') {
    showToast("Seules les séquences email peuvent être envoyées automatiquement. Une séquence LinkedIn se copie à la main.", 'failed');
    return;
  }

  currentLaunchSequenceId = id;
  const nbEtapes = Array.isArray(seq.etapes) ? seq.etapes.length : 0;
  document.getElementById('launchModalMeta').textContent =
    `${seq.nom || OBJECTIF_LABELS[seq.objectif] || seq.objectif} · ${nbEtapes} messages`;

  // Les prospects désinscrits ne sont pas proposés : le serveur les
  // refuserait de toute façon, autant ne pas les montrer.
  const select = document.getElementById('launchProspectSelect');
  select.innerHTML = '<option value="">— choisir un prospect —</option>' +
    lastProspectsForSelect
      .filter(p => !p.opted_out_at)
      .map(p => `<option value="${p.id}">${esc(p.nom)}${p.entreprise ? ' · ' + esc(p.entreprise) : ''}</option>`)
      .join('');

  document.getElementById('launchEmailInput').value = '';
  document.getElementById('launchStartSelect').value = '';
  renderLaunchRecap(seq, 0);

  document.getElementById('launchConfirmBtn').disabled = false;
  document.getElementById('launchConfirmBtn').textContent = '▶ programmer l\'envoi';
  document.getElementById('launchModal').classList.remove('hidden');
}

function closeLaunchModal() {
  document.getElementById('launchModal').classList.add('hidden');
  currentLaunchSequenceId = null;
}

// Pré-remplit l'adresse quand la fiche prospect en contient déjà une —
// l'utilisateur ne doit ressaisir un email qu'une seule fois.
function handleLaunchProspectChange() {
  const id = document.getElementById('launchProspectSelect').value;
  const prospect = lastProspectsForSelect.find(p => p.id === id);
  const champ = document.getElementById('launchEmailInput');
  if (prospect?.email) champ.value = prospect.email;
}

document.getElementById('launchStartSelect').addEventListener('change', (e) => {
  const seq = lastSavedSequences.find(s => s.id === currentLaunchSequenceId);
  if (seq) renderLaunchRecap(seq, parseInt(e.target.value || '0', 10));
});

async function handleLaunchCampaign() {
  if (!currentLaunchSequenceId) return;

  const prospectId = document.getElementById('launchProspectSelect').value;
  const email = document.getElementById('launchEmailInput').value.trim();
  const decalage = parseInt(document.getElementById('launchStartSelect').value || '0', 10);

  if (!email) {
    showToast("Renseigne l'email du destinataire.", 'failed');
    return;
  }

  const btn = document.getElementById('launchConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'programmation…';

  // Le token de session authentifie l'appel côté serveur : les routes
  // d'envoi n'acceptent rien d'anonyme.
  const session = await getSession();
  if (!session) {
    showToast('Session expirée, reconnecte-toi.', 'failed');
    btn.disabled = false;
    btn.textContent = '▶ programmer l\'envoi';
    return;
  }

  let demarrage = null;
  if (decalage > 0) {
    const d = new Date();
    d.setDate(d.getDate() + decalage);
    demarrage = d.toISOString();
  }

  try {
    const res = await fetch('/api/campaigns/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Surtout pas "Authorization" : le Basic Auth du site occupe déjà
        // cet en-tête, l'écraser fait redemander le mot de passe en boucle.
        'X-Pitchly-Token': session.access_token,
      },
      body: JSON.stringify({
        sequenceId: currentLaunchSequenceId,
        prospectId: prospectId || null,
        email,
        demarrage,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || "Impossible de programmer l'envoi.", 'failed');
      btn.disabled = false;
      btn.textContent = '▶ programmer l\'envoi';
      return;
    }

    closeLaunchModal();
    closeSequenceModal();
    showToast(`✓ Séquence programmée sur ${email} — suis-la dans « campagnes ».`, 'worked');
    await populateProspectSelect();   // l'email vient peut-être d'être enregistré sur la fiche

  } catch {
    showToast('Erreur réseau, réessaie dans un instant.', 'failed');
    btn.disabled = false;
    btn.textContent = '▶ programmer l\'envoi';
  }
}


/* ================================================================
   DÉMARRAGE
   ================================================================ */

async function startApp(profile) {
  currentProfile = profile;
  renderProfilePill(profile);
  updateQuotaDisplay();
  await populateProspectSelect();
  await renderSavedList();
  currentProfile = await maybeRefreshStyleProfile(currentProfile);
}

document.addEventListener('DOMContentLoaded', () => {
  checkAccess();
});
