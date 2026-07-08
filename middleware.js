/* ================================================================
   middleware.js
   Verrou HTTP Basic Auth sur tout le site — évite les 150€/mois de
   l'option "Password Protection" de Vercel. Le mot de passe vient de
   la variable d'environnement SITE_PASSWORD (à définir sur Vercel :
   Project Settings → Environment Variables, et en local dans .env).
   Le nom d'utilisateur n'est pas vérifié, seul le mot de passe compte.
   ================================================================ */

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

export const config = {
  matcher: '/:path*',
};
