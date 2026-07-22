/* ================================================================
   api/objections.js
   Fonction serverless (Vercel). Génère une réponse à une objection
   précise saisie par l'utilisateur, adaptée au secteur/offre de son
   profil, via Claude.

   La clé API vient de process.env.ANTHROPIC_API_KEY (même variable
   que /api/generate).

   Route authentifiée et décomptée sur le quota du plan, comme les deux
   autres générateurs : le site est public, l'URL seule ne doit jamais
   suffire à faire travailler Claude à nos frais.
   ================================================================ */

import { exigerGeneration } from './_lib.js';

// Retire le markdown que Claude ajoute parfois (**gras**, *italique*,
// titres #) même quand on le lui interdit — ces réponses sont envoyées
// telles quelles par écrit, les astérisques n'ont rien à y faire.
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const acces = await exigerGeneration(req, res);
  if (!acces) return; // exigerGeneration a déjà répondu (401 ou 402)

  const { secteur, offre, objection, exemples, styleProfile, adresse, prospect } = req.body;

  const adresseInstruction = adresse === 'tu' ? 'Tutoie le prospect ("tu").' : 'Vouvoie le prospect ("vous").';

  const blocExemples = Array.isArray(exemples) && exemples.length > 0
    ? `\n\nVoici des exemples de réponses efficaces pour ce type de situation. Inspire-toi de leur ton et de leur structure, sans les recopier mot pour mot :\n` +
      exemples.map(e => `- objection : "${e.objection}" → réponse : "${e.reponse.slice(0, 300)}"`).join('\n')
    : '';

  // Patterns appris de l'historique noté 👍/👎 de CE vendeur (voir
  // /api/refresh-style) — à respecter en priorité sur les exemples bruts
  // ci-dessus, qui ne sont que des illustrations ponctuelles.
  const blocStyleProfile = styleProfile
    ? `\n\nProfil de style appris de ce vendeur à partir de ses retours terrain, à respecter en priorité :\n${styleProfile}`
    : '';

  // Contexte du prospect précis sélectionné (fiche CRM + historique des
  // échanges déjà eus avec lui), quand il y en a un.
  const blocProspect = prospect
    ? `\n\nInfos sur CE prospect précis, à prendre en compte pour adapter la réponse à sa situation :\n` +
      `- nom : ${prospect.nom}${prospect.entreprise ? `, entreprise : ${prospect.entreprise}` : ''}${prospect.secteur ? `, secteur : ${prospect.secteur}` : ''}\n` +
      `- statut actuel de la relation : ${prospect.statut.replace('_', ' ')}` +
      (prospect.notes ? `\n- notes prises par le vendeur sur ce prospect : ${prospect.notes}` : '') +
      (Array.isArray(prospect.historique) && prospect.historique.length > 0
        ? `\n- échanges précédents avec ce prospect (du plus récent) :\n` +
          prospect.historique.map(h => `  · [${h.outcome === 'worked' ? 'a fonctionné' : h.outcome === 'failed' ? "n'a pas fonctionné" : 'pas encore évalué'}] (${h.type === 'script' ? 'script' : 'réponse à objection'}) : "${h.texte.slice(0, 200)}"`).join('\n')
        : '')
    : '';

  const prompt = `Tu es un copywriter commercial senior qui écrit pour des indépendants du secteur ${secteur}.
Ton client vend une offre de type "${offre}".
Un prospect lui oppose l'objection suivante : "${objection}"
Génère une réponse à écrire, en réponse à son email ou message LinkedIn, pour lever cette objection, en 2 à 4 phrases maximum. ${adresseInstruction}${blocProspect}${blocExemples}${blocStyleProfile}

Évite tout jargon commercial générique ("offre exceptionnelle", "n'hésitez pas à", "saisissez cette opportunité") — écris comme un vrai indépendant parlerait, pas comme une publicité.
Rédige un premier brouillon, relis-le silencieusement, corrige-le si besoin pour respecter strictement toutes les consignes ci-dessus, puis ne renvoie que cette version finale.
Réponds uniquement avec le texte de la réponse, sans introduction, sans commentaire, sans aucun markdown (pas d'astérisques, pas de titres) — texte brut prêt à être envoyé tel quel.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 220,
        // Sonnet 5 active le raisonnement adaptatif par défaut, et max_tokens
        // plafonne raisonnement + texte cumulés : sur ce petit budget, le
        // raisonnement mangeait tout et la réponse revenait vide. On le coupe.
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API Claude' });
    }

    // Premier bloc "text" plutôt que content[0] : un éventuel bloc de
    // raisonnement en tête donnerait content[0].text vide.
    const brut = (data.content || []).find(b => b.type === 'text')?.text || '';
    const reponse = stripMarkdown(brut);
    return res.status(200).json({ reponse, quota: acces.quota });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
