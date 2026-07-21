/* ================================================================
   middleware.js
   Verrou HTTP Basic Auth sur tout le site — évite les 150€/mois de
   l'option "Password Protection" de Vercel. Le mot de passe vient de
   la variable d'environnement SITE_PASSWORD (à définir sur Vercel :
   Project Settings → Environment Variables, et en local dans .env).
   Le nom d'utilisateur n'est pas vérifié, seul le mot de passe compte (mdp : aurel943).
   ================================================================ */

// ATTENTION — cet en-tête "authorization" est une ressource partagée :
// tout fetch() du front qui le remplit (par ex. avec un jeton Supabase)
// écrase les identifiants Basic rejoués par le navigateur, et l'utilisateur
// se voit redemander le mot de passe en boucle. Les appels authentifiés de
// l'app passent donc par "X-Pitchly-Token" (voir requireUser dans api/_lib.js).
export default function middleware(request) {
  const auth = request.headers.get('authorization');

  if (auth?.startsWith('Basic ')) {
    const [, pass] = atob(auth.slice(6)).split(':');
    if (pass === process.env.SITE_PASSWORD) {
      return;
    }
  }

  return new Response('Authentification requise.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="pitchly"' },
  });
}

// Tout le site est derrière le mot de passe, SAUF les deux routes
// appelées par des machines et non par un navigateur :
//   /api/inbound     — webhook de Resend quand un prospect répond
//   /api/cron/*      — déclencheur horaire de Vercel
// Elles ne peuvent pas présenter d'identifiants Basic ; sans cette
// exclusion elles recevraient un 401 et rien ne partirait jamais.
// Chacune a sa propre protection : signature du webhook pour l'une,
// CRON_SECRET pour l'autre.
export const config = {
  matcher: '/((?!api/inbound|api/cron/).*)',
};
