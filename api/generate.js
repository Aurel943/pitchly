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

// Un email et un message LinkedIn n'ont ni la même longueur naturelle ni
// la même structure — leur donner le même budget de tokens gaspille des
// tokens sur les formats courts et peut tronquer les formats longs.
// max_tokens sert aussi de garde-fou dur en plus de la consigne de
// longueur dans le prompt.
const CANAL_GUIDANCE = {
  email: {
    maxTokens: 300,
    format: "C'est un email : objet court + corps de 5 à 8 lignes maximum, formulé à l'écrit, sans tournure orale.",
  },
  linkedin: {
    maxTokens: 180,
    format: "C'est un message LinkedIn lu sur mobile : 3-4 phrases maximum, une seule idée, pas d'objet, ton direct et personnel.",
  },
};

// Retire le markdown que Claude ajoute parfois (**gras**, *italique*,
// titres #) même quand on le lui interdit — ces textes sont lus à l'oral
// ou copiés tels quels dans un email, les astérisques n'ont rien à y faire.
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

export default async function handler(req, res) {
  // On n'accepte que les requêtes POST (le formulaire envoie les données)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { secteur, offre, panier, canal, situation, ton, adresse, contexte, exemples, styleProfile, prospect } = req.body;
  const canalInfo = CANAL_GUIDANCE[canal] || { maxTokens: 400, format: '' };

  const adresseInstruction = adresse === 'tu' ? 'Tutoie le prospect ("tu").' : 'Vouvoie le prospect ("vous").';

  const blocExemples = Array.isArray(exemples) && exemples.length > 0
    ? `\n\nVoici des exemples de scripts qui ont déjà bien fonctionné pour ce client. Inspire-toi de leur ton et de leur structure, sans les recopier mot pour mot :\n` +
      exemples.map(e => `- (${e.canal} · ${e.situation.replace('_', ' ')}) : "${e.texte.slice(0, 300)}"`).join('\n')
    : '';

  // Patterns appris de l'historique noté 👍/👎 de CE vendeur (voir
  // /api/refresh-style) — à respecter en priorité sur les exemples bruts
  // ci-dessus, qui ne sont que des illustrations ponctuelles.
  const blocStyleProfile = styleProfile
    ? `\n\nProfil de style appris de ce vendeur à partir de ses retours terrain, à respecter en priorité :\n${styleProfile}`
    : '';

  // Contexte du prospect précis sélectionné (fiche CRM + historique des
  // échanges déjà eus avec lui) — sans ça, le générateur ignore tout du
  // prospect en dehors du champ "contexte" libre.
  const blocProspect = prospect
    ? `\n\nInfos sur CE prospect précis, à prendre en compte pour adapter le script à sa situation :\n` +
      `- nom : ${prospect.nom}${prospect.entreprise ? `, entreprise : ${prospect.entreprise}` : ''}${prospect.secteur ? `, secteur : ${prospect.secteur}` : ''}\n` +
      `- statut actuel de la relation : ${prospect.statut.replace('_', ' ')}` +
      (prospect.notes ? `\n- notes prises par le vendeur sur ce prospect : ${prospect.notes}` : '') +
      (Array.isArray(prospect.historique) && prospect.historique.length > 0
        ? `\n- échanges précédents avec ce prospect (du plus récent) :\n` +
          prospect.historique.map(h => `  · [${h.outcome === 'worked' ? 'a fonctionné' : h.outcome === 'failed' ? "n'a pas fonctionné" : 'pas encore évalué'}] (${h.type === 'script' ? 'script' : 'réponse à objection'}) : "${h.texte.slice(0, 200)}"`).join('\n')
        : '')
    : '';

  // Construction du prompt envoyé à Claude, avec toutes les infos
  // du profil et du formulaire injectées dedans
  const prompt = `Tu es un copywriter commercial senior qui écrit pour des indépendants du secteur ${secteur}.
Ton client vend une offre de type "${offre}" à un panier moyen de ${panier}.
Génère un script de vente pour un ${canal}, dans une situation de "${situation.replace('_', ' ')}".
${canalInfo.format}
Ton souhaité : ${ton}. ${adresseInstruction}
${contexte ? `Contexte supplémentaire donné par l'utilisateur : ${contexte}` : ''}${blocProspect}${blocExemples}${blocStyleProfile}

Évite tout jargon commercial générique ("offre exceptionnelle", "n'hésitez pas à", "je me permets de vous contacter", "saisissez cette opportunité", "n'attendez plus") — écris comme un vrai indépendant parlerait, pas comme une publicité.
Rédige un premier brouillon, relis-le silencieusement, corrige-le si besoin pour respecter strictement toutes les consignes ci-dessus, puis ne renvoie que cette version finale.
Réponds uniquement avec le texte du script, sans introduction, sans commentaire, sans aucun markdown (pas d'astérisques, pas de titres, pas de tirets de mise en forme) — texte brut prêt à être lu ou envoyé tel quel.`;

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
        max_tokens: canalInfo.maxTokens,
        // Sonnet 5 active le raisonnement adaptatif par défaut, et max_tokens
        // plafonne raisonnement + texte cumulés : sur nos petits budgets, le
        // raisonnement mangeait tout et la réponse revenait vide. On le coupe :
        // ces générations sont du copywriting court, pas du raisonnement.
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API Claude' });
    }

    // On cherche le premier bloc de type "text" plutôt que content[0] : si un
    // bloc de raisonnement se glissait en tête, content[0].text serait vide.
    const brut = (data.content || []).find(b => b.type === 'text')?.text || '';
    const texte = stripMarkdown(brut);
    return res.status(200).json({ texte });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
