/* ================================================================
   PITCHLY — landing.js
   Le seul comportement dynamique de index.html : adapter la barre de
   navigation selon qu'une session existe ou non.

   L'authentification elle-même vit sur connexion.html et
   inscription.html — la landing n'y renvoie que par des liens. Elle
   ouvrait auparavant une modale, ce qui interdisait d'ouvrir la page
   dans un nouvel onglet, de la partager, ou d'y arriver directement
   depuis un lien externe.

   La landing reste consultable connecté ou non : aucune redirection
   automatique au chargement.
   ================================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  const session = await getSession();
  document.querySelectorAll('.auth-link').forEach(el => el.classList.toggle('hidden', !!session));
  document.getElementById('navDashboardLink').classList.toggle('hidden', !session);
});
