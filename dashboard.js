/* ================================================================
   PITCHLY — dashboard.js
   Page dashboard.html : point d'entrée après connexion. Possède la
   gate complète (session → infos de compte → profil métier), puis
   affiche un aperçu (quota) et des raccourcis vers l'app, les scripts
   sauvegardés et le compte.
   ================================================================ */

function showOnly(overlayId) {
  document.getElementById('authModal').classList.toggle('hidden', overlayId !== 'authModal');
  document.getElementById('accountInfoModal').classList.toggle('hidden', overlayId !== 'accountInfoModal');
  document.getElementById('onboardingModal').classList.toggle('hidden', overlayId !== 'onboardingModal');
  document.getElementById('mainDashboard').classList.toggle('hidden', overlayId !== 'mainDashboard');
}

async function initAuthGate() {
  const session = await getSession();

  if (!session) {
    showOnly('authModal');
    return;
  }

  document.getElementById('logoutBtn').classList.remove('hidden');

  const profile = await getProfile();

  if (!profile || !profile.nom) {
    showOnly('accountInfoModal');
    return;
  }

  if (!profile.secteur) {
    showOnly('onboardingModal');
    return;
  }

  showOnly('mainDashboard');
  renderDashboard(profile);
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session && !currentUser) {
    initAuthGate();
  }
});

async function handleEmailLinkClick() {
  const email = document.getElementById('authEmailInput').value.trim();
  const status = document.getElementById('authStatus');
  if (!email) return;

  const btn = document.getElementById('authEmailBtn');
  btn.disabled = true;

  const { error } = await signInWithEmailLink(email);

  btn.disabled = false;
  status.textContent = error
    ? 'erreur : ' + error.message
    : `lien envoyé à ${email}, vérifie ta boîte mail.`;
}

async function handleAccountInfoSubmit() {
  try {
    const profile = await saveProfile({
      nom: document.getElementById('accountNomInput').value.trim(),
      date_naissance: document.getElementById('accountDateNaissanceInput').value || null,
      telephone: document.getElementById('accountTelephoneInput').value.trim(),
    });
    if (!profile.secteur) {
      showOnly('onboardingModal');
      return;
    }
    showOnly('mainDashboard');
    renderDashboard(profile);
  } catch (err) {
    alert('Erreur lors de la sauvegarde du compte : ' + err.message);
  }
}

async function handleOnboardingSubmit() {
  try {
    const secteurValue = document.getElementById('secteurInput').value;
    const secteurAutre = document.getElementById('secteurAutreInput').value.trim();

    const profile = await saveProfile({
      secteur: secteurValue === 'autre' && secteurAutre ? secteurAutre : secteurValue,
      offre: document.getElementById('offreInput').value,
      panier: document.getElementById('panierInput').value || 'non précisé',
    });
    showOnly('mainDashboard');
    renderDashboard(profile);
  } catch (err) {
    alert('Erreur lors de la sauvegarde du profil : ' + err.message);
  }
}

async function renderDashboard(profile) {
  document.getElementById('welcomeMessage').textContent = `bonjour ${profile.nom}`;

  const restant = Math.max(0, QUOTA_GRATUIT - getQuotaUsed(profile));
  document.getElementById('quotaDisplay').textContent = `${restant} générations restantes`;

  document.getElementById('navAvatarInitial').textContent = profile.nom ? profile.nom[0].toUpperCase() : '?';
  document.getElementById('navAvatarName').textContent = profile.nom || 'mon compte';

  const [stats, recent, progress] = await Promise.all([getDashboardStats(), getRecentActivity(), getProgressData()]);
  renderDashboardStats(stats);
  renderRecentActivity(recent);
  renderProgress(progress);
}

/* ================================================================
   STATS RÉELLES + ACTIVITÉ RÉCENTE
   Donne du contenu vivant au dashboard (au lieu d'un simple menu de
   raccourcis) : volumes sauvegardés, derniers éléments traités, et
   plus bas la progression du taux de réussite (voir getProgressData).
   ================================================================ */

async function getDashboardStats() {
  const [scripts, objections] = await Promise.all([
    supabaseClient.from('saved_scripts').select('id', { count: 'exact', head: true }),
    supabaseClient.from('saved_objections').select('id', { count: 'exact', head: true }),
  ]);

  return {
    scripts: scripts.count || 0,
    objections: objections.count || 0,
  };
}

function renderDashboardStats(stats) {
  const el = document.getElementById('dashboardStats');

  if (stats.scripts === 0 && stats.objections === 0) {
    el.classList.add('hidden');
    return;
  }

  const parts = [
    `${stats.scripts} script${stats.scripts > 1 ? 's' : ''} sauvegardé${stats.scripts > 1 ? 's' : ''}`,
    `${stats.objections} objection${stats.objections > 1 ? 's' : ''} traitée${stats.objections > 1 ? 's' : ''}`,
  ];

  el.textContent = parts.join(' · ');
  el.classList.remove('hidden');
}

async function getRecentActivity() {
  const items = await getCombinedSaved({ limit: 4 });
  return items.slice(0, 4);
}

function renderRecentActivity(items) {
  const section = document.getElementById('recentActivitySection');
  const list = document.getElementById('recentActivityList');

  if (items.length === 0) {
    section.classList.add('hidden');
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="saved-item" onclick="window.location.href='${item.type === 'script' ? 'app.html#saved' : 'objections.html#saved'}'">
      <span class="recent-type">${item.type === 'script' ? 'script' : 'objection'}</span>
      <span class="tag">${formatDateTime(item.created_at)}</span>
      ${item.outcome === 'worked' ? '<span class="outcome-tag worked">✓ a fonctionné</span>' : ''}
      ${item.outcome === 'failed' ? '<span class="outcome-tag failed">✕ n\'a pas fonctionné</span>' : ''}
      <p>${item.text.slice(0, 100)}${item.text.length > 100 ? '…' : ''}</p>
    </div>
  `).join('');

  section.classList.remove('hidden');
}

/* ================================================================
   PROGRESSION — taux de réussite dans le temps
   Réutilise la colonne "outcome" du feedback loop : montre le ROI de
   l'outil (est-ce que ça marche de mieux en mieux ?) plutôt que de
   laisser cette donnée uniquement servir en coulisses aux prompts.
   ================================================================ */

function monthKey(isoString) {
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
}

async function getProgressData() {
  const rated = await getCombinedSaved({ filterRatedOnly: true });
  if (rated.length === 0) return null;

  const byMonth = {};
  rated.forEach(r => {
    const key = monthKey(r.created_at);
    if (!byMonth[key]) byMonth[key] = { worked: 0, total: 0 };
    byMonth[key].total += 1;
    if (r.outcome === 'worked') byMonth[key].worked += 1;
  });

  const months = Object.keys(byMonth).sort();
  const trend = months.slice(-6).map(key => ({
    label: monthLabel(key),
    rate: Math.round((byMonth[key].worked / byMonth[key].total) * 100),
    total: byMonth[key].total,
  }));

  const now = new Date();
  const currentKey = monthKey(now.toISOString());
  const current = byMonth[currentKey] || null;

  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = monthKey(prevDate.toISOString());
  const prev = byMonth[prevKey] || null;

  const overallWorked = rated.filter(r => r.outcome === 'worked').length;

  const headlineWorked = current ? current.worked : overallWorked;
  const headlineTotal = current ? current.total : rated.length;

  return {
    headlineRate: Math.round((headlineWorked / headlineTotal) * 100),
    headlineWorked,
    headlineTotal,
    isCurrentMonth: current !== null,
    delta: (current && prev) ? Math.round((current.worked / current.total) * 100) - Math.round((prev.worked / prev.total) * 100) : null,
    trend,
  };
}

function renderProgress(data) {
  const section = document.getElementById('progressSection');

  if (!data) {
    section.classList.add('hidden');
    return;
  }

  const deltaHtml = data.delta === null ? '' : `
    <span class="progress-delta ${data.delta >= 0 ? 'up' : 'down'}">
      ${data.delta >= 0 ? '▲' : '▼'} ${Math.abs(data.delta)} pt${Math.abs(data.delta) > 1 ? 's' : ''} vs mois dernier
    </span>`;

  document.getElementById('progressHeadline').innerHTML =
    `${data.headlineRate}% de réussite${data.isCurrentMonth ? ' ce mois-ci' : ''}${deltaHtml}`;

  document.getElementById('progressSubtext').textContent =
    `${data.headlineWorked} sur ${data.headlineTotal} retour${data.headlineTotal > 1 ? 's' : ''} noté${data.headlineTotal > 1 ? 's' : ''}`;

  const maxBarHeight = 56;
  document.getElementById('progressTrend').innerHTML = data.trend.map(m => `
    <div class="progress-bar-col">
      <div class="progress-bar" style="height:${Math.max(4, Math.round(m.rate * maxBarHeight / 100))}px" title="${m.rate}% (${m.total} retour${m.total > 1 ? 's' : ''})"></div>
      <span class="progress-bar-label">${m.label}</span>
    </div>
  `).join('');

  section.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthGate();
});
