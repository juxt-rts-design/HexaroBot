const { CohereClient } = require('cohere-ai');

// Porté de aquila V7 components/gemini.js (askCohereFallback + getSystemPrompt),
// mais utilisé ici comme moteur principal — Gemini est bloqué en France et le
// serveur est hébergé en France.
const conversationHistory = new Map(); // sender -> [{role, text}]
const MAX_HISTORY = 10;

const SLANG_KEYWORDS = ['wsh', 'mani', 'frr', 'go', 'nga', 'miang', 'tchop', 'mougou', 'wanda', 'nkama', 'vouga', 'guette', 'drap', 'bangando', 'mbolo'];

const SLANG_KNOWLEDGE = `
CONNAISSANCE DU LANGAGE ARGOTIQUE GABONAIS (Toli Bangando) :
Vous comprenez et pouvez parler le langage argotique gabonais. Voici quelques expressions clés :
- Wsh = salut / Mani = mec, pote / Frr = frère, ami proche / Go = fille, meuf / Nga = femme, fille
- Le miang / La moula / Le dos = l'argent / Tchop = nourriture, manger / Mougou = draguer
- Wanda = être choqué / Nkama = maison, quartier / Vouga = sortir, bouger / Guette = regarder
- Drap = problème (y'a pas drap = pas de souci) / Bangando = jeune du quartier style street
- Mbolo = salut respect traditionnel / Kolo = 1000 fcfa / Djo = gars, type / Faya = ambiance, énergie
- Sape = vêtements, style / Charbonner = travailler dur / Être clean = correct, sans problème
- Être piqué = amoureux / Être blindé = riche / Être fauché = sans argent / Bail = affaire, situation
Utilisez ces expressions naturellement quand l'utilisateur parle en argot ou quand le contexte s'y prête.
`;

const BASE_IDENTITY = `Vous êtes le compagnon personnel WhatsApp de votre interlocuteur : amical, chaleureux,
naturel, jamais robotique. Répondez en français, de façon concise (1 à 3 phrases sauf si on vous
demande plus de détails). Ne répétez jamais mot pour mot ce que dit l'utilisateur.`;

function buildSystemPrompt(userText) {
  const usesSlang = SLANG_KEYWORDS.some((k) => userText.toLowerCase().includes(k));
  return `${BASE_IDENTITY}${usesSlang ? `\n${SLANG_KNOWLEDGE}` : ''}`;
}

function appendHistory(sender, role, text) {
  const history = conversationHistory.get(sender) || [];
  history.push({ role, text });
  while (history.length > MAX_HISTORY) history.shift();
  conversationHistory.set(sender, history);
}

async function askCohere(sender, userText) {
  if (!process.env.COHERE_API_KEY) {
    return "Désolé, mon cerveau IA n'est pas encore configuré (clé Cohere manquante).";
  }

  const history = conversationHistory.get(sender) || [];
  const chatHistory = history.map((h) => ({ role: h.role === 'user' ? 'USER' : 'CHATBOT', message: h.text }));

  try {
    const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
    const response = await cohere.chat({
      model: 'command-a-03-2025',
      preamble: buildSystemPrompt(userText),
      chatHistory,
      message: userText,
    });

    const reply = (response.text || "Désolé, je n'ai pas compris.").trim();
    appendHistory(sender, 'user', userText);
    appendHistory(sender, 'chatbot', reply);
    return reply;
  } catch (err) {
    console.error('Cohere erreur:', err.message);
    return "Désolé, je n'arrive pas à répondre pour le moment, réessaie dans un instant.";
  }
}

module.exports = { askCohere };
