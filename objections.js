/* ================================================================
   PITCHLY — objections.js
   Page objections.html : l'utilisateur saisit l'objection reçue d'un
   prospect, Claude génère une réponse à la demande (/api/objections),
   et le couple objection/réponse peut être sauvegardé (table
   "saved_objections").

   Partage le même quota mensuel que le générateur de script
   (QUOTA_GRATUIT, getQuotaUsed, incrementQuotaUsed — définis dans
   auth.js) pour ne pas multiplier les coûts d'API.

   Même gate d'accès que app.html : session + profil complet, sinon
   retour vers dashboard.html qui gère la complétion.
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
  document.getElementById('mainObjections').classList.remove('hidden');
  await startApp(profile);
}

function renderProfilePill(profile) {
  const pill = document.getElementById('profilePill');
  pill.textContent = LABELS_SECTEUR[profile.secteur] || profile.secteur;
}

function updateQuotaDisplay() {
  const restant = Math.max(0, QUOTA_GRATUIT - getQuotaUsed(currentProfile));
  document.getElementById('quotaDisplay').textContent = `${restant} générations restantes`;
}

async function handleGenerateObjection() {
  if (getQuotaUsed(currentProfile) >= QUOTA_GRATUIT) {
    alert('Quota gratuit atteint pour ce mois-ci. (ici on brancherait la modale "passer pro")');
    return;
  }

  const objection = document.getElementById('objectionInput').value.trim();
  if (!objection) return;

  const btn = document.getElementById('generateObjectionBtn');
  btn.disabled = true;
  btn.textContent = 'génération en cours…';

  try {
    const response = await fetch('/api/objections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secteur: LABELS_SECTEUR[currentProfile.secteur] || currentProfile.secteur,
        offre: currentProfile.offre,
        objection,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert('Erreur : ' + (data.error || 'impossible de générer la réponse'));
      return;
    }

    document.getElementById('objectionOutputText').textContent = data.reponse;
    document.getElementById('objectionOutputMeta').textContent = objection.slice(0, 60);
    document.getElementById('objectionOutputCard').classList.add('visible');
    document.getElementById('saveObjectionBtn').classList.remove('active');

    currentProfile = await incrementQuotaUsed(currentProfile);
    updateQuotaDisplay();

  } catch (err) {
    alert('Erreur réseau, réessaie dans un instant.');
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ générer la réponse';
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

  await supabaseClient
    .from('saved_objections')
    .insert({ user_id: currentUser.id, objection, reponse });

  document.getElementById('saveObjectionBtn').classList.add('active');
  await renderSavedObjectionsList();
}

async function handleDeleteObjection(id) {
  if (!confirm('Supprimer cette objection sauvegardée ?')) return;

  await supabaseClient
    .from('saved_objections')
    .delete()
    .eq('id', id);

  await renderSavedObjectionsList();
}

async function renderSavedObjectionsList() {
  const container = document.getElementById('savedObjectionsList');
  const list = await getSavedObjections();

  if (list.length === 0) {
    container.innerHTML = '<p class="empty-state">aucune objection traitée pour l\'instant.</p>';
    return;
  }

  container.innerHTML = list.map(o => `
    <div class="saved-item">
      <div class="saved-item-head">
        <span class="name">${o.objection.slice(0, 60)}</span>
        <div class="saved-item-actions">
          <button class="icon-btn" onclick="handleDeleteObjection('${o.id}')" title="supprimer">🗑</button>
        </div>
      </div>
      <p>${o.reponse.slice(0, 140)}${o.reponse.length > 140 ? '…' : ''}</p>
    </div>
  `).join('');
}

async function startApp(profile) {
  currentProfile = profile;
  renderProfilePill(profile);
  updateQuotaDisplay();
  await renderSavedObjectionsList();
}

document.addEventListener('DOMContentLoaded', () => {
  checkAccess();
});
