/* ================================================================
   api/sequence.js
   Fonction serverless (Vercel). Génère une SÉQUENCE de prospection
   complète — premier contact + relances espacées + message de clôture
   — en un seul appel, cohérente d'un message à l'autre, adaptée au
   profil (secteur/offre/panier), au prospect et au style appris.

   C'est la différence entre "génère-moi un email" (commodité) et
   "génère-moi toute ma campagne de relance" : 80 % des réponses en
   prospection écrite viennent des relances, et c'est le plus pénible
   à écrire à la main.

   Renvoie un JSON structuré : { etapes: [{ titre, delai, objet,
   message }] } — parsé et affiché en timeline côté front.

   La clé API vient de process.env.ANTHROPIC_API_KEY (même variable
   que /api/generate, /api/objections, /api/refresh-style).
   ================================================================ */

// Chaque canal a sa longueur et sa structure naturelles ; on borne
// max_tokens en fonction du canal ET du nombre d'étapes pour ne pas
// tronquer une séquence longue ni gaspiller sur une courte.
const CANAL_SEQUENCE = {
  email: {
    tokensParEtape: 320,
    format: "Chaque étape est un email : objet court (champ \"objet\") + corps de 4 à 7 lignes maximum dans \"message\", formulé à l'écrit, sans tournure orale.",
  },
  linkedin: {
    tokensParEtape: 170,
    format: "Chaque étape est un message LinkedIn lu sur mobile : 2 à 4 phrases maximum dans \"message\", une seule idée, pas d'objet (laisse \"objet\" vide), ton direct et personnel.",
  },
};

// Objectif global de la séquence — oriente l'arc narratif des messages.
const OBJECTIF_GUIDANCE = {
  premier_contact: "Objectif : décrocher un premier échange (appel de découverte ou réponse) avec un prospect qui ne connaît pas encore le vendeur.",
  relance: "Objectif : relancer un prospect déjà contacté qui n'a pas répondu, sans le braquer, en apportant à chaque message un angle ou une valeur nouvelle.",
  closing: "Objectif : faire avancer vers la signature un prospect déjà en discussion, en levant les derniers freins et en créant une raison d'agir maintenant.",
};

// Retire le markdown que Claude ajoute parfois à l'intérieur des champs
// texte (**gras**, *italique*, titres #) — ces messages sont copiés/
// envoyés tels quels, les astérisques n'ont rien à y faire.
function stripMarkdown(text) {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

// Claude renvoie parfois le JSON entouré de texte ou d'une clôture
// ```json. On isole le tableau entre le premier '[' et le dernier ']'
// avant de parser, pour être tolérant sans faire confiance aveuglément.
function parseEtapes(raw) {
  const text = String(raw || '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((e, i) => ({
      titre: stripMarkdown(e.titre) || `étape ${i + 1}`,
      delai: stripMarkdown(e.delai),
      objet: stripMarkdown(e.objet),
      message: stripMarkdown(e.message),
    })).filter(e => e.message);
  } catch (err) {
    return null;
  }
}

// Exportés pour les tests unitaires (le runtime Vercel n'utilise que le
// export default ci-dessous — ces exports nommés sont sans effet en prod).
export { parseEtapes, stripMarkdown };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { secteur, offre, panier, canal, objectif, etapes, ton, adresse, contexte, exemples, styleProfile, prospect } = req.body;

  const canalInfo = CANAL_SEQUENCE[canal] || CANAL_SEQUENCE.email;
  const objectifInfo = OBJECTIF_GUIDANCE[objectif] || OBJECTIF_GUIDANCE.premier_contact;

  // Nombre d'étapes borné (2 à 5) : en dessous ce n'est pas une séquence,
  // au-dessus les relances deviennent du harcèlement.
  const nbEtapes = Math.min(5, Math.max(2, parseInt(etapes, 10) || 3));

  const adresseInstruction = adresse === 'tu' ? 'Tutoie le prospect ("tu").' : 'Vouvoie le prospect ("vous").';

  const blocExemples = Array.isArray(exemples) && exemples.length > 0
    ? `\n\nVoici des messages qui ont déjà bien fonctionné pour ce vendeur. Inspire-toi de leur ton et de leur structure, sans les recopier :\n` +
      exemples.map(e => `- "${e.texte.slice(0, 300)}"`).join('\n')
    : '';

  // Patterns appris de l'historique noté 👍/👎 de CE vendeur (voir
  // /api/refresh-style) — prioritaires sur les exemples bruts ci-dessus.
  const blocStyleProfile = styleProfile
    ? `\n\nProfil de style appris de ce vendeur à partir de ses retours terrain, à respecter en priorité :\n${styleProfile}`
    : '';

  // Contexte du prospect précis (fiche CRM + historique des échanges).
  const blocProspect = prospect
    ? `\n\nInfos sur CE prospect précis, à prendre en compte pour personnaliser toute la séquence :\n` +
      `- nom : ${prospect.nom}${prospect.entreprise ? `, entreprise : ${prospect.entreprise}` : ''}${prospect.secteur ? `, secteur : ${prospect.secteur}` : ''}\n` +
      `- statut actuel de la relation : ${String(prospect.statut || '').replace('_', ' ')}` +
      (prospect.notes ? `\n- notes prises par le vendeur sur ce prospect : ${prospect.notes}` : '') +
      (Array.isArray(prospect.historique) && prospect.historique.length > 0
        ? `\n- échanges précédents avec ce prospect (du plus récent) :\n` +
          prospect.historique.map(h => `  · [${h.outcome === 'worked' ? 'a fonctionné' : h.outcome === 'failed' ? "n'a pas fonctionné" : 'pas encore évalué'}] "${h.texte.slice(0, 200)}"`).join('\n')
        : '')
    : '';

  const prompt = `Tu es un copywriter commercial senior qui écrit pour des indépendants du secteur ${secteur}.
Ton client vend une offre de type "${offre}"${panier ? ` à un panier moyen de ${panier}` : ''}.
Tu dois écrire une SÉQUENCE de prospection de ${nbEtapes} messages, à envoyer par ${canal === 'linkedin' ? 'message LinkedIn' : 'email'}, espacés dans le temps.
${objectifInfo}
${canalInfo.format}

Règles de la séquence :
- Le message 1 est le premier contact. Les suivants sont des relances : chacune fait implicitement référence à la précédente ("je reviens vers toi", "je me permets un dernier mot") sans jamais répéter le même argument.
- Chaque relance apporte un angle neuf (preuve, cas client, question ouverte, ressource utile), jamais "je relance juste pour savoir".
- Le dernier message est une clôture élégante ("break-up") qui laisse la porte ouverte sans insister.
- Propose pour chaque étape un délai réaliste depuis le message précédent, dans le champ "delai" (ex : "J+0", "J+3", "J+7", "J+14").
- Donne à chaque étape un "titre" court décrivant son rôle (ex : "Premier contact", "Relance valeur", "Dernière relance").
Ton souhaité : ${ton}. ${adresseInstruction}
${contexte ? `Contexte supplémentaire donné par l'utilisateur : ${contexte}` : ''}${blocProspect}${blocExemples}${blocStyleProfile}

Évite tout jargon commercial générique ("offre exceptionnelle", "n'hésitez pas à", "je me permets de vous contacter", "saisissez cette opportunité") — écris comme un vrai indépendant écrirait, pas comme une publicité.
Rédige la séquence, relis-la silencieusement pour vérifier la cohérence d'un message à l'autre et le respect de toutes les consignes, puis ne renvoie que la version finale.
Réponds UNIQUEMENT avec un tableau JSON valide, sans aucun texte autour, sans bloc de code markdown. Format exact :
[{"titre":"...","delai":"J+0","objet":"...","message":"..."}, ...]
Le champ "objet" est une chaîne vide pour LinkedIn. Le champ "message" ne contient aucun markdown (pas d'astérisques, pas de titres). N'échappe pas les apostrophes.`;

  const maxTokens = Math.min(3000, canalInfo.tokensParEtape * nbEtapes + 250);

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
        max_tokens: maxTokens,
        // Sonnet 5 active le raisonnement adaptatif par défaut, et max_tokens
        // plafonne raisonnement + texte cumulés : le raisonnement peut tronquer
        // (voire vider) le JSON de la séquence. On le coupe — la génération se
        // suffit du brouillon/relecture demandés dans le prompt.
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur API Claude' });
    }

    // Premier bloc "text" plutôt que content[0] : un éventuel bloc de
    // raisonnement en tête donnerait content[0].text vide → parse en échec.
    const brut = (data.content || []).find(b => b.type === 'text')?.text || '';
    const etapesParsees = parseEtapes(brut);
    if (!etapesParsees) {
      return res.status(502).json({ error: "La séquence générée n'a pas pu être lue. Réessaie dans un instant." });
    }

    return res.status(200).json({ etapes: etapesParsees });

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}
