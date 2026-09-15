// Plan "auto_reply" : bot conversationnel basique basique, sans IA payante —
// répond avec des réponses toutes faites par mot-clé, sinon un message générique
// disant que le propriétaire n'est pas disponible pour le moment.
const RULES = [
  { keywords: ['bonjour', 'salut', 'coucou', 'bjr'], reply: 'Bonjour ! Je ne suis pas disponible pour le moment, je reviens vers vous dès que possible.' },
  { keywords: ['merci'], reply: 'Avec plaisir ! Je vous répondrai plus en détail dès que je serai disponible.' },
  { keywords: ['urgent', 'important'], reply: "J'ai bien vu que c'est urgent, je reviens vers vous au plus vite." },
  { keywords: ['prix', 'tarif', 'combien'], reply: "Je vous communiquerai les tarifs dès que je serai disponible." },
];

const DEFAULT_REPLY = "Je ne suis pas disponible pour le moment. Votre message a bien été reçu, je vous répondrai dès que possible.";

async function handleMessage(client, msg) {
  if (msg.hasMedia || !msg.body) {
    await client.sendMessage(msg.from, DEFAULT_REPLY);
    return;
  }
  const text = msg.body.toLowerCase();
  const rule = RULES.find((r) => r.keywords.some((k) => text.includes(k)));
  await client.sendMessage(msg.from, rule ? rule.reply : DEFAULT_REPLY);
}

module.exports = { handleMessage };
