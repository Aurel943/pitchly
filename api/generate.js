/* ================================================================
   api/generate.js
   Fonction serverless (tourne sur les serveurs de Vercel, jamais
   dans le navigateur de l'utilisateur).

   Rôle : recevoir les infos du formulaire (profil + choix du
   générateur), construire un prompt, l'envoyer à l'API Claude,
   renvoyer le texte généré au front-end.

   La clé API vient de process.env.ANTHROPIC_API_KEY — une variable
   d'environnement configurée sur Vercel, jamais écrite dans le code.
   ================================================================ */

export default async function handler(req, res) {
  // On n'accepte que les requêtes POST (le formulaire envoie les données)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { secteur, offre, panier, canal, situation, ton, contexte, exemples } = req.body;

  const blocExemples = Array.isArray(exemples) && exemples.length > 0
    ? `\n\nVoici des exemples de scripts qui ont déjà bien fonctionné pour ce client. Inspire-toi de leur ton et de leur structure, sans les recopier mot pour mot :\n` +
      exemples.map(e => `- (${e.canal} · ${e.situation.replace('_', ' ')}) : "${e.texte}"`).join('\n')
    : '';

  // Construction du prompt envoyé à Claude, avec toutes les infos
  // du profil et du formulaire injectées dedans
  const prompt = `Tu es un expert en vente pour les indépendants du secteur ${secteur}.
Ton client vend une offre de type "${offre}" à un panier moyen de ${panier}.
Génère un script de vente pour un ${canal}, dans une situation de "${situation.replace('_', ' ')}".
Ton souhaité : ${ton}.
${contexte ? `Contexte supplémentaire donné par l'utilisateur : ${contexte}` : ''}${blocExemples}
Réponds uniquement avec le texte du script, sans introduction ni explication autour.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Haiku : rapide et peu coûteux, largement suffisant pour ce
        // type de génération courte. Tu pourras passer à un modèle
        // plus puissant plus tard si besoin de plus de finesse.
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API Claude' });
    }

    const texte = data.content?.[0]?.text || '';
    return res.status(200).json({ texte });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}