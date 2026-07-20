/* ================================================================
   api/refresh-style.js
   Fonction serverless (Vercel). Analyse l'historique de scripts et
   réponses aux objections notés 👍/👎 par l'utilisateur et en fait
   dégager par Claude des patterns concrets et actionnables ("profil
   de style") — au lieu de se contenter de recoller 2 exemples bruts
   dans le prompt de génération.

   Le résultat est stocké côté client dans profiles.style_profile (voir
   maybeRefreshStyleProfile dans auth.js) et réinjecté dans chaque
   génération future.

   La clé API vient de process.env.ANTHROPIC_API_KEY (même variable
   que /api/generate et /api/objections).
   ================================================================ */

// Retire le markdown que Claude ajoute parfois (**gras**, *italique*) —
// ce texte est réinjecté brut dans d'autres prompts et affiché tel quel
// sur compte.html, les astérisques n'ont rien à y faire.
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { items } = req.body;

  const TYPE_LABELS = { script: 'message', objection: 'réponse à objection', sequence: 'séquence de relance' };
  const historique = (Array.isArray(items) ? items : [])
    .map(i => `- [${i.outcome === 'worked' ? 'a fonctionné' : "n'a pas fonctionné"}] (${TYPE_LABELS[i.type] || 'message'}) : "${i.text.slice(0, 250)}"`)
    .join('\n');

  const prompt = `Tu vas analyser l'historique de messages de vente d'un vendeur indépendant, notés par lui-même comme ayant fonctionné ou pas auprès de ses prospects.

${historique}

À partir de ces exemples, identifie 3 à 6 patterns concrets qui distinguent ce qui a fonctionné de ce qui n'a pas fonctionné pour ce vendeur en particulier (longueur, structure, formulations précises, ton, présence d'un appel à l'action, etc.).
Réponds uniquement par une liste à puces concise, en français, rédigée comme des instructions à suivre pour les prochaines générations, sans aucun markdown (pas d'astérisques). Aucune introduction ni conclusion.`;

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

    const profile = stripMarkdown(data.content?.[0]?.text || '');
    return res.status(200).json({ profile });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
