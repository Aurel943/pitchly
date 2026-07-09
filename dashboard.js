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

  const [stats, recent] = await Promise.all([getDashboardStats(), getRecentActivity()]);
  renderDashboardStats(stats);
  renderRecentActivity(recent);
}

/* ================================================================
   STATS RÉELLES + ACTIVITÉ RÉCENTE
   Donne du contenu vivant au dashboard (au lieu d'un simple menu de
   raccourcis) et met en avant le feedback loop : combien de scripts/
   objections ont déjà fait leurs preuves.
   ================================================================ */

async function getDashboardStats() {
  const [scripts, objections, workedScripts, workedObjections] = await Promise.all([
    supabaseClient.from('saved_scripts').select('id', { count: 'exact', head: true }),
    supabaseClient.from('saved_objections').select('id', { count: 'exact', head: true }),
    supabaseClient.from('saved_scripts').select('id', { count: 'exact', head: true }).eq('outcome', 'worked'),
    supabaseClient.from('saved_objections').select('id', { count: 'exact', head: true }).eq('outcome', 'worked'),
  ]);

  return {
    scripts: scripts.count || 0,
    objections: objections.count || 0,
    worked: (workedScripts.count || 0) + (workedObjections.count || 0),
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
  if (stats.worked > 0) {
    parts.push(`${stats.worked} qui ${stats.worked > 1 ? 'ont' : 'a'} fait ses preuves`);
  }

  el.textContent = parts.join(' · ');
  el.classList.remove('hidden');
}

async function getRecentActivity() {
  const [{ data: scripts }, { data: objections }] = await Promise.all([
    supabaseClient.from('saved_scripts').select('id, texte, outcome, created_at').order('created_at', { ascending: false }).limit(4),
    supabaseClient.from('saved_objections').select('id, reponse, outcome, created_at').order('created_at', { ascending: false }).limit(4),
  ]);

  const merged = [
    ...(scripts || []).map(s => ({ type: 'script', text: s.texte, outcome: s.outcome, created_at: s.created_at })),
    ...(objections || []).map(o => ({ type: 'objection', text: o.reponse, outcome: o.outcome, created_at: o.created_at })),
  ];

  merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return merged.slice(0, 4);
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

document.addEventListener('DOMContentLoaded', () => {
  initAuthGate();
});
