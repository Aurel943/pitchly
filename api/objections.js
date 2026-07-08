/* ================================================================
   api/objections.js
   Fonction serverless (Vercel). Génère une réponse à une objection
   précise saisie par l'utilisateur, adaptée au secteur/offre de son
   profil, via Claude.

   La clé API vient de process.env.ANTHROPIC_API_KEY (même variable
   que /api/generate).
   ================================================================ */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { secteur, offre, objection } = req.body;

  const prompt = `Tu es un expert en vente pour les indépendants du secteur ${secteur}.
Ton client vend une offre de type "${offre}".
Un prospect lui oppose l'objection suivante : "${objection}"
Génère une réponse courte et efficace à donner à l'oral pour lever cette objection.
Réponds uniquement avec le texte de la réponse, sans introduction ni explication autour.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API Claude' });
    }

    const reponse = data.content?.[0]?.text || '';
    return res.status(200).json({ reponse });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
