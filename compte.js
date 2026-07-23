/* ================================================================
   PITCHLY — compte.js
   Page compte.html : consultation/modification des infos de compte
   et du profil métier. La session/le profil sont gérés via auth.js.

   Chaque carte a deux états : lecture (grille d'infos) et édition
   (les champs de formulaire) — un bouton "modifier" bascule de l'une
   à l'autre, "annuler"/"enregistrer" ramène en lecture.
   ================================================================ */

const SECTEURS_CONNUS = ['coaching', 'artisanat', 'conseil', 'creatif', 'commerce'];
const LABELS_OFFRE = { abonnement: 'abonnement', ponctuelle: 'prestation ponctuelle' };

let currentSession = null;
let currentProfile = null;

function formatDateOnly(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function setAccountEditing(editing) {
  document.getElementById('accountView').classList.toggle('hidden', editing);
  document.getElementById('accountEdit').classList.toggle('hidden', !editing);
  document.getElementById('accountEditBtn').classList.toggle('hidden', editing);
}

function setBusinessEditing(editing) {
  document.getElementById('businessView').classList.toggle('hidden', editing);
  document.getElementById('businessEdit').classList.toggle('hidden', !editing);
  document.getElementById('businessEditBtn').classList.toggle('hidden', editing);
}

function renderProfileHeader(profile) {
  const nom = profile.nom || '';
  document.getElementById('profileAvatar').textContent = nom ? nom[0].toUpperCase() : '?';
  document.getElementById('profileHeaderName').textContent = nom || 'ton profil';
  document.getElementById('profileHeaderSector').textContent = profile.secteur
    ? (LABELS_SECTEUR[profile.secteur] || profile.secteur)
    : 'secteur non renseigné';
  document.getElementById('profileHeaderEmail').textContent = currentSession.user.email || '';
}

function renderAccountView(profile) {
  document.getElementById('viewNom').textContent = profile.nom || '—';
  document.getElementById('viewEmail').textContent = currentSession.user.email || '—';
  document.getElementById('viewDateNaissance').textContent = formatDateOnly(profile.date_naissance);
  document.getElementById('viewTelephone').textContent = profile.telephone || '—';
}

function renderBusinessView(profile) {
  document.getElementById('viewSecteur').textContent = profile.secteur
    ? (LABELS_SECTEUR[profile.secteur] || profile.secteur)
    : '—';
  document.getElementById('viewOffre').textContent = profile.offre ? (LABELS_OFFRE[profile.offre] || profile.offre) : '—';
  document.getElementById('viewPanier').textContent = profile.panier || '—';
}

// Affiche le profil de style ET ce qu'il représente. Le texte seul ne
// disait pas à quoi il sert : l'utilisateur voyait un pavé descriptif
// sans comprendre qu'il est réinjecté dans chaque génération, ni qu'il
// ne se reconstitue nulle part ailleurs.
function renderStyleProfile(profile) {
  const empty = document.getElementById('styleProfileEmpty');
  const text = document.getElementById('styleProfileText');
  const count = document.getElementById('styleProfileCount');
  const note = document.getElementById('styleProfileNote');

  const retours = profile.style_profile_rated_count || 0;

  if (profile.style_profile) {
    empty.classList.add('hidden');
    text.textContent = profile.style_profile;
    text.classList.remove('hidden');
    count.textContent = `construit sur ${retours} retours`;
    note.textContent = "Ces patterns sont réinjectés dans chaque message que Pitchly écrit pour toi, et ils s'affinent à chaque 👍/👎. Ils n'existent que sur ce compte : c'est la partie du produit qu'un chatbot ne peut pas te redonner, parce qu'il repart de zéro à chaque conversation.";
  } else {
    empty.classList.remove('hidden');
    text.classList.add('hidden');
    count.textContent = retours ? `${retours} retours notés` : '';
    note.textContent = "Chaque 👍/👎 posé sur un message nourrit ce profil. Plus tu en poses, plus ce que Pitchly écrit ressemble à ce qui te fait signer — et cette mémoire-là s'accumule ici, nulle part ailleurs.";
  }
}

/* ================================================================
   PAUSE DU COMPTE

   La prospection d'un indépendant va par à-coups : trois semaines à
   fond, puis six mois de rien dès qu'il a signé. Sans pause, la seule
   sortie pendant le creux est la résiliation.
   ================================================================ */

function renderPause(profile) {
  const etat = document.getElementById('pauseState');
  const btn = document.getElementById('pauseBtn');
  const enPause = !!profile.paused_at;

  etat.classList.toggle('paused', enPause);

  if (enPause) {
    etat.textContent = `Compte en pause depuis le ${formatDateTime(profile.paused_at)}. Aucun message ne part et aucune relance n'est envoyée. Tes prospects, tes séquences et tes campagnes sont conservés tels quels.`;
    btn.textContent = 'reprendre la prospection';
  } else {
    etat.textContent = "Tes campagnes tournent normalement. Si tu arrêtes de prospecter un moment, mets ton compte en pause plutôt que de supprimer tes campagnes : les envois s'arrêtent, et tout repart où tu l'avais laissé.";
    btn.textContent = 'mettre en pause';
  }
}

// Le message de confirmation reprend ce que le serveur dit avoir fait.
// Annoncer « c'est reparti » alors que des campagnes viennent d'être
// arrêtées (pause trop longue) serait le meilleur moyen de laisser
// quelqu'un attendre des relances qui ne partiront jamais.
function messagePause(data, etaitEnPause) {
  if (!etaitEnPause) {
    return data.etapesSuspendues
      ? `Compte en pause. Messages programmés mis en attente : ${data.etapesSuspendues}.`
      : 'Compte en pause. Aucun message ne partira.';
  }
  if (data.campagnesArretees) {
    return `Compte réactivé. Campagnes trop anciennes arrêtées : ${data.campagnesArretees}. Relance une séquence neuve.`;
  }
  if (data.etapesDecalees) {
    return `Compte réactivé. Messages replanifiés : ${data.etapesDecalees}, espacement d'origine conservé.`;
  }
  return 'Compte réactivé.';
}

async function handleTogglePause(ev) {
  const enPause = !!currentProfile.paused_at;

  // La mise en pause suspend des envois déjà programmés : elle passe par
  // la confirmation en deux taps. La reprise ne casse rien, elle part
  // directement.
  if (!enPause && !confirmTap(ev)) return;

  const btn = document.getElementById('pauseBtn');
  btn.disabled = true;

  try {
    const response = await fetch('/api/account/pause', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ action: enPause ? 'reprendre' : 'pause' }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erreur inconnue');

    currentProfile.paused_at = data.paused_at;
    renderPause(currentProfile);
    showToast(messagePause(data, enPause), 'info');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'failed');
  } finally {
    btn.disabled = false;
  }
}

function fillAccountEditFields(profile) {
  document.getElementById('accountEmailDisplay').value = currentSession.user.email || '';
  document.getElementById('accountNomInput').value = profile.nom || '';
  document.getElementById('accountDateNaissanceInput').value = profile.date_naissance || '';
  document.getElementById('accountTelephoneInput').value = profile.telephone || '';
}

function fillBusinessEditFields(profile) {
  const secteurConnu = profile.secteur && SECTEURS_CONNUS.includes(profile.secteur);
  document.getElementById('secteurInput').value = secteurConnu ? profile.secteur : (profile.secteur ? 'autre' : 'coaching');
  if (!secteurConnu && profile.secteur) {
    document.getElementById('secteurAutreInput').value = profile.secteur;
  }
  toggleSecteurAutre('secteurInput', 'secteurAutreInput');
  document.getElementById('offreInput').value = profile.offre || 'abonnement';
  document.getElementById('panierInput').value = profile.panier || '';
}

async function initAccountPage() {
  currentSession = await getSession();

  if (!currentSession) {
    window.location.href = 'dashboard.html';
    return;
  }

  currentProfile = (await getProfile()) || {};

  renderProfileHeader(currentProfile);
  renderAccountView(currentProfile);
  renderBusinessView(currentProfile);
  renderStyleProfile(currentProfile);
  renderPause(currentProfile);
  fillAccountEditFields(currentProfile);
  fillBusinessEditFields(currentProfile);

  const loader = document.getElementById('pageLoader');
  if (loader) loader.remove();
  document.getElementById('mainAccount').classList.remove('hidden');

  // filet de sécurité : si des retours notés existent déjà sans profil de
  // style à jour (ex. généré avant que les colonnes existent en base),
  // on rattrape ici plutôt que de dépendre du prochain clic 👍/👎
  currentProfile = await maybeRefreshStyleProfile(currentProfile);
  renderStyleProfile(currentProfile);
}

async function handleSaveAccountInfo() {
  try {
    currentProfile = await saveProfile({
      nom: document.getElementById('accountNomInput').value.trim(),
      date_naissance: document.getElementById('accountDateNaissanceInput').value || null,
      telephone: document.getElementById('accountTelephoneInput').value.trim(),
    });
    renderProfileHeader(currentProfile);
    renderAccountView(currentProfile);
    setAccountEditing(false);
    showToast('Informations enregistrées.', 'info');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'failed');
  }
}

async function handleSaveBusinessProfile() {
  try {
    const secteurValue = document.getElementById('secteurInput').value;
    const secteurAutre = document.getElementById('secteurAutreInput').value.trim();

    currentProfile = await saveProfile({
      secteur: secteurValue === 'autre' && secteurAutre ? secteurAutre : secteurValue,
      offre: document.getElementById('offreInput').value,
      panier: document.getElementById('panierInput').value || 'non précisé',
    });
    renderProfileHeader(currentProfile);
    renderBusinessView(currentProfile);
    setBusinessEditing(false);
    showToast('Profil métier enregistré.', 'info');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'failed');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initAccountPage();
});
