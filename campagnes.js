/* ================================================================
   PITCHLY — campagnes.js
   Page campagnes.html : le suivi des séquences réellement envoyées.

   C'est la page qui justifie l'abonnement. Les autres pages produisent
   du texte — ce qu'un chatbot fait aussi. Celle-ci affiche des faits
   que seul Pitchly possède : qui a reçu quoi, quand, et surtout qui a
   répondu. Ces chiffres viennent de la table email_events, écrite
   uniquement par le serveur au moment des envois et des réponses :
   jamais d'un ressenti déclaré par l'utilisateur.

   Lecture seule pour l'essentiel, sauf l'arrêt d'une campagne en cours.
   ================================================================ */

let currentProfile = null;
let lastCampagnes = [];
let currentCampagneId = null;
let currentStatutFilter = 'tous';

const STATUT_CAMPAGNE = {
  active:  { label: 'en cours',    classe: 'statut-active' },
  replied: { label: 'a répondu',   classe: 'statut-replied' },
  done:    { label: 'terminée',    classe: 'statut-done' },
  stopped: { label: 'arrêtée',     classe: 'statut-stopped' },
};

const STATUT_ETAPE = {
  pending:   'à venir',
  sent:      'envoyé',
  cancelled: 'annulé',
  failed:    'échec',
};

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Date courte et lisible ("mar. 23 juil.") — les campagnes se lisent en
// calendrier, l'heure exacte n'apporte rien dans la liste.
function formatJour(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

async function getCampagnes() {
  const { data, error } = await supabaseClient
    .from('campaigns')
    .select('*, prospects(nom, entreprise), saved_sequences(nom, objectif), campaign_steps(*)')
    .order('started_at', { ascending: false });

  if (error) {
    showToast('Erreur au chargement des campagnes : ' + error.message, 'failed');
    return [];
  }
  return data || [];
}

/* ================================================================
   STATISTIQUES

   Le taux de réponse se calcule par SÉQUENCE : c'est le niveau où la
   comparaison a du sens ("cette accroche marche mieux que l'autre").
   On refuse volontairement de conclure sous 5 envois — annoncer
   "100 % de réponse" sur un seul email serait faux et ferait prendre
   de mauvaises décisions à l'utilisateur.
   ================================================================ */

const SEUIL_FIABILITE = 5;

function renderStats(campagnes) {
  const container = document.getElementById('statsList');

  const envoyes = campagnes.reduce(
    (n, c) => n + (c.campaign_steps || []).filter(e => e.statut === 'sent').length, 0
  );
  const reponses = campagnes.filter(c => c.statut === 'replied').length;
  const actives = campagnes.filter(c => c.statut === 'active').length;
  const taux = campagnes.length > 0 ? Math.round((reponses / campagnes.length) * 100) : 0;

  document.getElementById('headStats').textContent =
    `${campagnes.length} campagne${campagnes.length > 1 ? 's' : ''} · ${envoyes} email${envoyes > 1 ? 's' : ''} envoyé${envoyes > 1 ? 's' : ''} · ${reponses} réponse${reponses > 1 ? 's' : ''} · ${actives} en cours`;

  if (campagnes.length === 0) {
    container.innerHTML = '<p class="empty-state">aucun envoi pour l\'instant — lance une séquence email depuis « séquences » et les taux de réponse apparaîtront ici.</p>';
    return;
  }

  // Regroupement par séquence d'origine.
  const parSequence = {};
  for (const c of campagnes) {
    const cle = c.sequence_id || 'sans-sequence';
    if (!parSequence[cle]) {
      parSequence[cle] = {
        nom: c.saved_sequences?.nom || c.nom || 'séquence supprimée',
        total: 0,
        reponses: 0,
      };
    }
    parSequence[cle].total++;
    if (c.statut === 'replied') parSequence[cle].reponses++;
  }

  const lignes = Object.values(parSequence)
    .sort((a, b) => (b.reponses / b.total) - (a.reponses / a.total));

  container.innerHTML = `
    <div class="stat-global">
      <span class="stat-global-chiffre">${taux}%</span>
      <span class="stat-global-label">de tes séquences obtiennent une réponse</span>
    </div>
    ${lignes.map(l => {
      const pourcent = Math.round((l.reponses / l.total) * 100);
      const fiable = l.total >= SEUIL_FIABILITE;
      return `
      <div class="stat-row">
        <div class="stat-row-head">
          <span class="stat-row-nom">${esc(l.nom)}</span>
          <span class="stat-row-chiffre ${fiable ? '' : 'incertain'}">${pourcent}%</span>
        </div>
        <div class="stat-bar"><span style="width:${pourcent}%"></span></div>
        <span class="stat-row-detail">
          ${l.reponses} réponse${l.reponses > 1 ? 's' : ''} sur ${l.total} envoi${l.total > 1 ? 's' : ''}
          ${fiable ? '' : ' · trop peu d\'envois pour conclure'}
        </span>
      </div>`;
    }).join('')}`;
}

/* ================================================================
   LISTE DES CAMPAGNES
   ================================================================ */

function renderCampagnes() {
  const container = document.getElementById('campagnesList');
  const liste = currentStatutFilter === 'tous'
    ? lastCampagnes
    : lastCampagnes.filter(c => c.statut === currentStatutFilter);

  if (liste.length === 0) {
    container.innerHTML = lastCampagnes.length === 0
      ? '<p class="empty-state">aucune campagne — ouvre une séquence email sauvegardée et clique sur ▶ pour la lancer.</p>'
      : '<p class="empty-state">aucune campagne avec ce statut.</p>';
    return;
  }

  container.innerHTML = liste.map(c => {
    const etapes = c.campaign_steps || [];
    const envoyees = etapes.filter(e => e.statut === 'sent').length;
    const prochaine = etapes
      .filter(e => e.statut === 'pending')
      .sort((a, b) => new Date(a.send_at) - new Date(b.send_at))[0];

    const statut = STATUT_CAMPAGNE[c.statut] || { label: c.statut, classe: '' };
    const qui = c.prospects?.nom || c.destinataire;

    return `
    <div class="saved-item" onclick="openCampagneDetail('${c.id}')">
      <div class="saved-item-head">
        <span class="name">${esc(qui)}</span>
        <span class="statut-tag ${statut.classe}">${statut.label}</span>
      </div>
      <span class="tag">${esc(c.saved_sequences?.nom || c.nom || 'séquence')} · ${envoyees}/${etapes.length} envoyés · lancée le ${formatJour(c.started_at)}</span>
      <p>
        ${c.statut === 'replied'
          ? `✓ a répondu le ${formatJour(c.replied_at)} — relances arrêtées automatiquement`
          : prochaine
            ? `prochain envoi ${formatJour(prochaine.send_at)}`
            : 'plus aucun envoi programmé'}
      </p>
    </div>`;
  }).join('');
}

document.getElementById('campagneFilters').addEventListener('click', (e) => {
  if (!e.target.classList.contains('filter')) return;
  document.querySelectorAll('#campagneFilters .filter').forEach(f => f.classList.remove('active'));
  e.target.classList.add('active');
  currentStatutFilter = e.target.dataset.filter;
  renderCampagnes();
});

/* ================================================================
   DÉTAIL D'UNE CAMPAGNE
   ================================================================ */

function openCampagneDetail(id) {
  const c = lastCampagnes.find(x => x.id === id);
  if (!c) return;

  currentCampagneId = id;
  const statut = STATUT_CAMPAGNE[c.statut] || { label: c.statut };

  document.getElementById('campagneModalName').textContent =
    c.prospects?.nom || c.destinataire;
  document.getElementById('campagneModalMeta').textContent =
    `${c.destinataire} · ${statut.label} · lancée le ${formatJour(c.started_at)}`;

  const etapes = [...(c.campaign_steps || [])].sort((a, b) => a.position - b.position);

  document.getElementById('campagneModalTimeline').innerHTML = etapes.map((e, i) => `
    <div class="seq-step">
      <div class="seq-step-rail">
        <div class="seq-step-dot ${e.statut === 'sent' ? '' : 'etape-inactive'}">${i + 1}</div>
      </div>
      <div class="seq-step-body">
        <div class="seq-step-head">
          <span class="seq-step-title">${esc(e.titre || `message ${i + 1}`)}</span>
          <span class="seq-step-delay">${STATUT_ETAPE[e.statut] || e.statut} · ${formatJour(e.sent_at || e.send_at)}</span>
        </div>
        ${e.objet ? `<div class="seq-step-objet"><strong>${esc(e.objet)}</strong></div>` : ''}
        <div class="output-text">${esc(e.message)}</div>
        ${e.erreur ? `<span class="exemples-note">échec : ${esc(e.erreur)}</span>` : ''}
      </div>
    </div>`).join('');

  // Arrêter n'a de sens que s'il reste quelque chose à envoyer.
  const resteAEnvoyer = etapes.some(e => e.statut === 'pending');
  document.getElementById('campagneStopBtn').classList.toggle('hidden', !resteAEnvoyer);

  document.getElementById('campagneModal').classList.remove('hidden');
}

function closeCampagneModal() {
  document.getElementById('campagneModal').classList.add('hidden');
  currentCampagneId = null;
}

// Arrêt manuel : annule les étapes restantes. Confirmation en deux taps
// comme les autres actions irréversibles de l'app — une campagne arrêtée
// ne se relance pas, il faut en créer une nouvelle.
async function handleStopCampagne(id, ev) {
  if (!id) return;
  if (!confirmTap(ev)) return;

  const { error: err1 } = await supabaseClient
    .from('campaign_steps')
    .update({ statut: 'cancelled' })
    .eq('campaign_id', id)
    .eq('statut', 'pending');

  const { error: err2 } = await supabaseClient
    .from('campaigns')
    .update({ statut: 'stopped' })
    .eq('id', id);

  if (err1 || err2) {
    showToast('Erreur lors de l\'arrêt : ' + (err1 || err2).message, 'failed');
    return;
  }

  closeCampagneModal();
  showToast('Campagne arrêtée — aucun autre email ne partira.', 'info');
  await refresh();
}

/* ================================================================
   DÉMARRAGE
   ================================================================ */

async function refresh() {
  lastCampagnes = await getCampagnes();
  renderStats(lastCampagnes);
  renderCampagnes();
}

function renderProfilePill(profile) {
  document.getElementById('profilePill').textContent = LABELS_SECTEUR[profile.secteur] || profile.secteur;
}

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

  currentProfile = profile;
  document.getElementById('logoutBtn').classList.remove('hidden');
  const loader = document.getElementById('pageLoader');
  if (loader) loader.remove();
  document.getElementById('mainCampagnes').classList.remove('hidden');

  renderProfilePill(profile);
  await refresh();
}

document.addEventListener('DOMContentLoaded', () => {
  checkAccess();
});
