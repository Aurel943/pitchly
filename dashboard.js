/* ================================================================
   PITCHLY — dashboard.js
   Page dashboard.html : point d'entrée après connexion. Possède la
   gate complète (session → infos de compte → profil métier), puis
   affiche un aperçu (quota) et des raccourcis vers l'app, les scripts
   sauvegardés et le compte.
   ================================================================ */

function showOnly(overlayId) {
  const loader = document.getElementById('pageLoader');
  if (loader) loader.remove(); // la gate a tranché : on sait quoi afficher
  document.getElementById('accountInfoModal').classList.toggle('hidden', overlayId !== 'accountInfoModal');
  document.getElementById('onboardingModal').classList.toggle('hidden', overlayId !== 'onboardingModal');
  document.getElementById('mainDashboard').classList.toggle('hidden', overlayId !== 'mainDashboard');
}

// Vrai quand l'URL porte encore les jetons déposés par le lien de
// connexion (#access_token=… en implicite, ?code=… en PKCE). Dans ce
// cas la session n'est pas encore posée mais elle arrive : rediriger
// maintenant renverrait vers la page de connexion quelqu'un qui vient
// précisément de cliquer son lien. On laisse onAuthStateChange finir.
function retourDeLienEmail() {
  return /[#&]access_token=/.test(window.location.hash)
    || /[?&]code=/.test(window.location.search);
}

async function initAuthGate() {
  const session = await getSession();

  // Pas de session : la connexion a sa propre page. Une modale d'auth
  // ici obligeait à dupliquer le formulaire, et laissait le dashboard
  // vide derrière un fond flou pendant qu'on tapait son email.
  // replace() plutôt que href : le retour arrière depuis la page de
  // connexion doit ramener d'où l'on venait, pas sur une page inutile.
  if (!session) {
    if (!retourDeLienEmail()) window.location.replace('connexion.html');
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

// Le lien de connexion par email dépose la session de façon asynchrone
// au retour sur la page : sans ce réveil, l'utilisateur qui arrive depuis
// son email verrait la gate le renvoyer vers connexion.html avant même
// que la session soit posée.
supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session && !currentUser) {
    initAuthGate();
  }
});

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
    showToast('Erreur lors de la sauvegarde du compte : ' + err.message, 'failed');
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
    showToast('Erreur lors de la sauvegarde du profil : ' + err.message, 'failed');
  }
}

async function renderDashboard(profile) {
  document.getElementById('welcomeMessage').textContent = `bonjour ${profile.nom}`;
  document.getElementById('navAvatarInitial').textContent = profile.nom ? profile.nom[0].toUpperCase() : '?';
  document.getElementById('navAvatarName').textContent = profile.nom || 'mon compte';

  renderPlanBadge(profile);

  const [etat, recent, progress] = await Promise.all([
    getEtatProspection(),
    getRecentActivity(),
    getProgressData(),
  ]);

  renderHeadline(etat);
  renderInbox(etat);
  renderNextStep(etat);
  renderMetrics(etat);
  renderRecentActivity(recent);
  renderProgress(progress);
}

/* ================================================================
   PLAN ET QUOTA
   Le badge ne devient voyant qu'au moment où le quota devient un vrai
   frein. Un appel à l'upgrade permanent se transforme en décor qu'on
   ne voit plus au bout de trois jours.
   ================================================================ */

function renderPlanBadge(profile) {
  const el = document.getElementById('planBadge');
  const plan = planDe(profile);
  const limite = limiteGenerations(profile);

  if (limite === null) {
    el.textContent = `plan ${PLANS_AFFICHAGE[plan].label}`;
    return;
  }

  const restant = Math.max(0, limite - getQuotaUsed(profile));
  const bientotVide = restant <= 2;

  el.classList.toggle('warn', bientotVide);
  el.textContent = bientotVide
    ? `${restant} génération${restant > 1 ? 's' : ''} restante${restant > 1 ? 's' : ''} — voir les formules`
    : `plan ${PLANS_AFFICHAGE[plan].label} · ${restant} générations`;
}

/* ================================================================
   ÉTAT RÉEL DE LA PROSPECTION

   Une seule lecture, partagée par tous les blocs de la page : le
   bandeau de chiffres, les réponses à traiter et la prochaine étape
   racontent la même situation, ils ne doivent pas se contredire pour
   avoir interrogé la base à trois moments différents.
   ================================================================ */

async function getEtatProspection() {
  const [prospects, sequences, campagnes] = await Promise.all([
    supabaseClient.from('prospects').select('id', { count: 'exact', head: true }),
    supabaseClient.from('saved_sequences').select('id', { count: 'exact', head: true }),
    supabaseClient
      .from('campaigns')
      .select('id, nom, statut, destinataire, replied_at, started_at, prospects(nom, entreprise), campaign_steps(statut, send_at)')
      .order('started_at', { ascending: false }),
  ]);

  const liste = campagnes.data || [];
  const etapes = liste.flatMap(c => c.campaign_steps || []);

  return {
    prospects: prospects.count || 0,
    sequences: sequences.count || 0,
    campagnes: liste,
    actives: liste.filter(c => c.statut === 'active'),
    repondues: liste.filter(c => c.statut === 'replied'),
    envoyes: etapes.filter(e => e.statut === 'sent').length,
    aVenir: etapes.filter(e => e.statut === 'pending').length,
  };
}

// Le titre dit la situation plutôt que de poser une question creuse
// ("Qu'est-ce qu'on vend aujourd'hui ?" n'informait de rien).
function renderHeadline(etat) {
  const h1 = document.getElementById('dashboardHeadline');
  const sous = document.getElementById('dashboardStats');

  if (etat.campagnes.length === 0) {
    h1.innerHTML = 'Ta prospection <em>commence ici.</em>';
    sous.textContent = etat.prospects > 0
      ? `${etat.prospects} prospect${etat.prospects > 1 ? 's' : ''} en fiche · aucune séquence lancée`
      : 'aucun prospect enregistré pour l\'instant';
    return;
  }

  if (etat.repondues.length > 0) {
    h1.innerHTML = `${etat.repondues.length} prospect${etat.repondues.length > 1 ? 's t\'ont' : ' t\'a'} <em>répondu.</em>`;
  } else if (etat.actives.length > 0) {
    h1.innerHTML = `${etat.actives.length} séquence${etat.actives.length > 1 ? 's tournent' : ' tourne'} <em>en ce moment.</em>`;
  } else {
    h1.innerHTML = 'Où en est <em>ta prospection ?</em>';
  }

  sous.textContent = `${etat.envoyes} email${etat.envoyes > 1 ? 's' : ''} envoyé${etat.envoyes > 1 ? 's' : ''} · ${etat.aVenir} programmé${etat.aVenir > 1 ? 's' : ''} · ${etat.prospects} prospect${etat.prospects > 1 ? 's' : ''}`;
}

/* ================================================================
   RÉPONSES À TRAITER
   ================================================================ */

function renderInbox(etat) {
  const section = document.getElementById('inboxSection');
  if (etat.repondues.length === 0) {
    section.classList.add('hidden');
    return;
  }

  document.getElementById('inboxList').innerHTML = etat.repondues.map(c => {
    const nom = c.prospects?.nom || c.destinataire;
    const ou = c.prospects?.entreprise ? ` · ${c.prospects.entreprise}` : '';
    return `
      <div class="inbox-item" onclick="window.location.href='campagnes.html'">
        <div class="ib-who">
          <strong>${nom}${ou}</strong>
          <span>a répondu à « ${c.nom || 'ta séquence'} » — les relances sont arrêtées</span>
        </div>
        <span class="ib-when">${c.replied_at ? formatDateTime(c.replied_at) : ''}</span>
      </div>`;
  }).join('');

  section.classList.remove('hidden');
}

/* ================================================================
   PROCHAINE ÉTAPE

   Le parcours d'activation va de "aucun prospect" à "une campagne
   lancée". Tant qu'il n'est pas terminé, la page ne propose qu'une
   action : celle qui fait avancer d'un cran. Un utilisateur qui génère
   dix textes sans jamais lancer d'envoi n'a rien activé du tout, et
   c'est exactement ce que les quatre raccourcis d'avant encourageaient.
   ================================================================ */

const ETAPES_ACTIVATION = [
  { cle: 'prospect', label: 'un prospect' },
  { cle: 'sequence', label: 'une séquence' },
  { cle: 'campagne', label: 'un envoi lancé' },
  { cle: 'reponse', label: 'une réponse' },
];

function renderNextStep(etat) {
  const faits = {
    prospect: etat.prospects > 0,
    sequence: etat.sequences > 0,
    campagne: etat.campagnes.length > 0,
    reponse: etat.repondues.length > 0,
  };

  let etape;
  if (!faits.prospect) {
    etape = {
      href: 'prospects.html', icone: '👤', bouton: 'ajouter un prospect →',
      titre: 'Ajoute ton premier prospect',
      texte: "Un nom, un email, et le contexte que tu as en tête. C'est ce contexte qui rendra tous les messages écrits pour lui personnels.",
    };
  } else if (!faits.sequence) {
    etape = {
      href: 'sequences.html', icone: '⇶', bouton: 'écrire une séquence →',
      titre: 'Écris ta première séquence',
      texte: 'Premier contact et relances, générés d\'un coup et cohérents entre eux. C\'est ce qui sera envoyé, pas un brouillon à recopier.',
    };
  } else if (!faits.campagne) {
    etape = {
      href: 'sequences.html', icone: '▶', bouton: 'lancer l\'envoi →',
      titre: 'Lance ta première séquence',
      texte: "Ouvre une séquence sauvegardée et clique « lancer l'envoi ». Tu verras le calendrier complet avant que quoi que ce soit ne parte.",
    };
  } else if (faits.reponse) {
    etape = {
      href: 'campagnes.html', icone: '✉', bouton: 'voir les réponses →',
      titre: 'Réponds à tes prospects',
      texte: 'Les relances sont déjà arrêtées de leur côté. À toi de reprendre la conversation.',
    };
  } else {
    etape = {
      href: 'prospects.html', icone: '+', bouton: 'ajouter un prospect →',
      titre: 'Ajoute un prospect de plus',
      texte: `${etat.aVenir} message${etat.aVenir > 1 ? 's partiront' : ' partira'} tout seul${etat.aVenir > 1 ? 's' : ''} dans les prochains jours. Le meilleur usage de ton temps maintenant, c'est d'alimenter le haut du tunnel.`,
    };
  }

  const carte = document.getElementById('nextStepCard');
  carte.setAttribute('href', etape.href);
  document.getElementById('nextStepIcon').textContent = etape.icone;
  document.getElementById('nextStepTitle').textContent = etape.titre;
  document.getElementById('nextStepText').textContent = etape.texte;
  carte.querySelector('.next-step-go').textContent = etape.bouton;

  // Les jalons ne s'affichent que pendant le parcours : une fois les
  // quatre franchis, ils n'apprennent plus rien et encombrent la page.
  const jalons = document.getElementById('onboardingSteps');
  if (ETAPES_ACTIVATION.every(e => faits[e.cle])) {
    jalons.innerHTML = '';
    return;
  }
  jalons.innerHTML = ETAPES_ACTIVATION.map(e => `
    <span class="ob-step ${faits[e.cle] ? 'done' : ''}">
      <i>${faits[e.cle] ? '✓' : ''}</i>${e.label}
    </span>`).join('');
}

/* ================================================================
   CHIFFRES
   ================================================================ */

function renderMetrics(etat) {
  const section = document.getElementById('metricsSection');

  // Rien d'envoyé : quatre zéros n'informent de rien et donnent
  // l'impression d'un outil vide. La prochaine étape suffit.
  if (etat.campagnes.length === 0) {
    section.classList.add('hidden');
    return;
  }

  const taux = Math.round((etat.repondues.length / etat.campagnes.length) * 100);
  // Sous 5 campagnes, un pourcentage ment : une réponse sur deux
  // s'afficherait "50 % de réponse". On montre le brut à la place.
  const fiable = etat.campagnes.length >= 5;

  const cases = [
    {
      num: fiable ? `${taux}%` : `${etat.repondues.length}/${etat.campagnes.length}`,
      label: fiable ? 'de tes séquences obtiennent une réponse' : 'séquences ont obtenu une réponse',
      hint: fiable ? null : `taux calculé à partir de 5 campagnes`,
      highlight: true,
    },
    { num: etat.actives.length, label: `séquence${etat.actives.length > 1 ? 's' : ''} en cours` },
    { num: etat.envoyes, label: `email${etat.envoyes > 1 ? 's' : ''} réellement envoyé${etat.envoyes > 1 ? 's' : ''}` },
    { num: etat.aVenir, label: `message${etat.aVenir > 1 ? 's' : ''} programmé${etat.aVenir > 1 ? 's' : ''}` },
  ];

  document.getElementById('metricsGrid').innerHTML = cases.map(c => `
    <div class="metric ${c.highlight ? 'highlight' : ''}">
      <div class="m-num">${c.num}</div>
      <div class="m-label">${c.label}</div>
      ${c.hint ? `<span class="m-hint">${c.hint}</span>` : ''}
    </div>`).join('');

  section.classList.remove('hidden');
}

/* ================================================================
   ACTIVITÉ RÉCENTE
   ================================================================ */

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
