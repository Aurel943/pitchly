/* ================================================================
   PITCHLY — compte.js
   Page compte.html : consultation/modification des infos de compte
   et du profil métier. La session/le profil sont gérés via auth.js.
   ================================================================ */

async function initAccountPage() {
  const session = await getSession();

  if (!session) {
    window.location.href = 'dashboard.html';
    return;
  }

  const profile = await getProfile();

  document.getElementById('accountEmailDisplay').value = session.user.email || '';
  if (profile) {
    document.getElementById('accountNomInput').value = profile.nom || '';
    document.getElementById('accountDateNaissanceInput').value = profile.date_naissance || '';
    document.getElementById('accountTelephoneInput').value = profile.telephone || '';
    document.getElementById('secteurInput').value = profile.secteur || 'coaching';
    document.getElementById('offreInput').value = profile.offre || 'abonnement';
    document.getElementById('panierInput').value = profile.panier || '';
  }

  document.getElementById('mainAccount').classList.remove('hidden');
}

async function handleSaveAccountInfo() {
  try {
    await saveProfile({
      nom: document.getElementById('accountNomInput').value.trim(),
      date_naissance: document.getElementById('accountDateNaissanceInput').value || null,
      telephone: document.getElementById('accountTelephoneInput').value.trim(),
    });
    alert('Informations de compte enregistrées.');
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

async function handleSaveBusinessProfile() {
  try {
    await saveProfile({
      secteur: document.getElementById('secteurInput').value,
      offre: document.getElementById('offreInput').value,
      panier: document.getElementById('panierInput').value || 'non précisé',
    });
    alert('Profil métier enregistré.');
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initAccountPage();
});
