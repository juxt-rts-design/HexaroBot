const axios = require('axios');

// Porté de aquila V7 components/witai.js — wit.ai ne sert qu'à choisir un sticker
// d'ambiance, jamais à générer la réponse textuelle (c'est Gemini qui répond).
const intentToEmotion = {
  greeting: 'salutation',
  bye: 'au-revoir',
  thanks: 'merci',
  compliment: 'compliment',
  complaint: 'plainte',
  agree: 'accord',
  disagree: 'desacord',
  question: 'question',
  affection: 'affection',
  support: 'soutien',
  joke: 'humour',
};

async function detectIntent(text) {
  const key = process.env.WITAI_API_KEY;
  if (!key) return { emotion: 'default', confidence: 0 };
  try {
    const { data } = await axios.get('https://api.wit.ai/message', {
      params: { q: text, v: '20241001' },
      headers: { Authorization: `Bearer ${key}` },
      timeout: 5000,
    });
    const intent = data.intents && data.intents[0];
    if (intent && intentToEmotion[intent.name]) {
      return { emotion: intentToEmotion[intent.name], confidence: intent.confidence };
    }
    return { emotion: 'default', confidence: intent ? intent.confidence : 0 };
  } catch (err) {
    console.error('wit.ai erreur:', err.message);
    return { emotion: 'default', confidence: 0 };
  }
}

module.exports = { detectIntent, intentToEmotion };
