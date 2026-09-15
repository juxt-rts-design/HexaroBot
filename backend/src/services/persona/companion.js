const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { detectIntent } = require('../witai');
const { askCohere } = require('../cohere');
const { mediaToStickerMedia } = require('../stickerConverter');

const STICKERS_DIR = path.join(__dirname, '..', '..', 'assets', 'stickers');
const stickerCache = new Map(); // emotion -> [filenames]
const fs = require('fs');

function pickSticker(emotion) {
  if (!stickerCache.has(emotion)) {
    const dir = path.join(STICKERS_DIR, emotion);
    if (!fs.existsSync(dir)) return null;
    stickerCache.set(emotion, fs.readdirSync(dir).filter((f) => f.endsWith('.webp')));
  }
  const files = stickerCache.get(emotion);
  if (!files || !files.length) return null;
  const file = files[Math.floor(Math.random() * files.length)];
  return path.join(STICKERS_DIR, emotion, file);
}

// Plan "compagnon" : discute comme une vraie personne (Gemini) + envoie un
// sticker d'ambiance choisi par wit.ai, et sait convertir un média en sticker
// sur la commande ".sticker" — porté de aquila V7 components/messageHandler.js.
async function handleMessage(client, msg) {
  if (msg.body === '.sticker' && msg.hasQuotedMsg) {
    const quoted = await msg.getQuotedMessage();
    if (quoted.hasMedia) {
      const media = await quoted.downloadMedia();
      const sticker = await mediaToStickerMedia(media);
      await client.sendMessage(msg.from, sticker, { sendAsSticker: true });
    }
    return;
  }

  if (msg.hasMedia || !msg.body) return;

  const { emotion } = await detectIntent(msg.body);
  const stickerPath = pickSticker(emotion);
  if (stickerPath) {
    const sticker = MessageMedia.fromFilePath(stickerPath);
    await client.sendMessage(msg.from, sticker, { sendAsSticker: true });
  }

  const reply = await askCohere(msg.from, msg.body);
  await client.sendMessage(msg.from, reply);
}

module.exports = { handleMessage };
