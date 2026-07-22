/* ================================================================
   PITCHLY — auth-pages.js
   Logique partagée par connexion.html et inscription.html.

   Les deux pages ont le même mécanisme (Google ou lien par email) et
   ne diffèrent que par leur texte : une seule implémentation, le mode
   est lu sur <body data-auth-mode>.

   Chargé après auth.js, dont il utilise getSession / signInWithGoogle /
   signInWithEmailLink.
   ================================================================ */

const AUTH_MODE = document.body.dataset.authMode || 'login';

// Destination après authentification. Absolue et non relative : Supabase
// redirige depuis son propre domaine, une valeur comme "dashboard.html"
// s'y résoudrait par rapport à SON hôte et renverrait l'utilisateur nulle
// part. L'URL doit aussi figurer dans les redirections autorisées du
// projet Supabase, sinon la redirection est refusée silencieusement.
const APRES_CONNEXION = window.location.origin + '/dashboard.html';

/* ---------------------------------------------------------------
   Validation
   --------------------------------------------------------------- */

// Volontairement permissive : elle n'écarte que les saisies
// manifestement fausses (oubli de l'arobase, domaine sans point). Un
// contrôle strict rejetterait des adresses valides, et de toute façon
// seul l'email réellement reçu prouve que l'adresse existe.
function emailPlausible(valeur) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur.trim());
}

function afficherErreur(message) {
  const champ = document.getElementById('emailInput');
  const zone = document.getElementById('emailError');
  zone.textContent = message || '';
  champ.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (message) champ.focus();
}

/* ---------------------------------------------------------------
   États du bouton
   --------------------------------------------------------------- */

function setChargement(actif) {
  const btn = document.getElementById('submitBtn');
  btn.disabled = actif;
  btn.innerHTML = actif
    ? '<span class="spin"></span>envoi en cours…'
    : (AUTH_MODE === 'signup' ? 'Créer mon compte' : 'Recevoir mon lien de connexion');
}

/* ---------------------------------------------------------------
   Envoi du lien
   --------------------------------------------------------------- */

let dernierEmail = '';

async function handleEmailSubmit(event) {
  if (event) event.preventDefault();

  const email = document.getElementById('emailInput').value.trim();

  if (!email) return afficherErreur('Renseigne ton adresse email.');
  if (!emailPlausible(email)) return afficherErreur("Cette adresse ne semble pas valide.");

  afficherErreur('');
  setChargement(true);

  const { error } = await signInWithEmailLink(email, APRES_CONNEXION);

  setChargement(false);

  if (error) {
    afficherErreur(error.message || "L'envoi a échoué. Réessaie dans un instant.");
    return;
  }

  dernierEmail = email;
  afficherEcranEnvoye(email);
}

// Après l'envoi, le formulaire est retiré de l'écran au lieu de recevoir
// une ligne de statut sous le bouton : laisser le champ et le bouton en
// place laisse croire qu'il faut recommencer, et beaucoup d'utilisateurs
// renvoient un second lien qui invalide le premier.
function afficherEcranEnvoye(email) {
  document.getElementById('authFormBlock').classList.add('hidden');
  document.getElementById('sentAddress').textContent = email;
  document.getElementById('authSentBlock').classList.remove('hidden');
  demarrerCompteARebours();
}

function revenirAuFormulaire() {
  document.getElementById('authSentBlock').classList.add('hidden');
  document.getElementById('authFormBlock').classList.remove('hidden');
  document.getElementById('emailInput').focus();
}

// Le renvoi est verrouillé quelques secondes : chaque nouveau lien
// invalide le précédent, donc un double clic empêcherait de se connecter
// avec le mail déjà reçu.
let compteur = null;
function demarrerCompteARebours() {
  const btn = document.getElementById('resendBtn');
  let reste = 30;
  clearInterval(compteur);

  const afficher = () => {
    btn.disabled = reste > 0;
    btn.textContent = reste > 0 ? `renvoyer le lien (${reste} s)` : 'renvoyer le lien';
  };
  afficher();

  compteur = setInterval(() => {
    reste -= 1;
    afficher();
    if (reste <= 0) clearInterval(compteur);
  }, 1000);
}

async function handleResend() {
  if (!dernierEmail) return revenirAuFormulaire();

  const btn = document.getElementById('resendBtn');
  btn.disabled = true;
  btn.textContent = 'envoi…';

  const { error } = await signInWithEmailLink(dernierEmail, APRES_CONNEXION);

  if (error) {
    btn.disabled = false;
    btn.textContent = 'renvoyer le lien';
    return;
  }
  demarrerCompteARebours();
}

function handleGoogle() {
  signInWithGoogle(APRES_CONNEXION);
}

/* ---------------------------------------------------------------
   Amorçage
   --------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', async () => {
  // Déjà connecté : cette page n'a plus rien à demander.
  const session = await getSession();
  if (session) {
    window.location.replace('dashboard.html');
    return;
  }

  document.getElementById('authForm').addEventListener('submit', handleEmailSubmit);
  document.getElementById('emailInput').addEventListener('input', () => afficherErreur(''));
  document.getElementById('emailInput').focus();
});
