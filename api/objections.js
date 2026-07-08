/* ================================================================
   api/objections.js
   Fonction serverless (Vercel). Génère 3 objections fréquentes et
   leurs réponses, adaptées au secteur/offre du profil, via Claude.

   La clé API vient de process.env.ANTHROPIC_API_KEY (même variable
   que /api/generate).
   ================================================================ */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { secteur, offre } = req.body;

  const prompt = `Tu es un expert en vente pour les indépendants du secteur ${secteur}.
Ton client vend une offre de type "${offre}".
Liste les 3 objections les plus fréquentes que ses prospects lui opposent, avec pour chacune une réponse courte et efficace à donner à l'oral.
Réponds uniquement avec un tableau JSON, sans texte autour, au format :
[{"q": "objection 1", "r": "réponse 1"}, {"q": "objection 2", "r": "réponse 2"}, {"q": "objection 3", "r": "réponse 3"}]`;

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
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API Claude' });
    }

    const raw = data.content?.[0]?.text || '[]';
    // Claude répond parfois avec un bloc ```json ... ``` autour du tableau
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    const objections = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

    return res.status(200).json({ objections });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
