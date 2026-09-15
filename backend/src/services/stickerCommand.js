/**
 * Commande -sticker : répondre à une image/vidéo pour obtenir un sticker.
 * Silencieux côté progression (pas de « création en cours… »).
 */
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { bufferToStickerWebp } = require('./stickerConverter');

function getMessageText(msg) {
  return (
    msg.message?.extendedTextMessage?.text ||
    msg.message?.conversation ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''
  ).trim();
}

async function downloadQuotedMedia(quoted) {
  if (quoted.imageMessage) {
    const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return { buffer: Buffer.concat(chunks), isVideo: false };
  }
  if (quoted.videoMessage) {
    const stream = await downloadContentFromMessage(quoted.videoMessage, 'video');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return { buffer: Buffer.concat(chunks), isVideo: true };
  }
  const once =
    quoted.viewOnceMessage?.message ||
    quoted.viewOnceMessageV2?.message ||
    quoted.viewOnceMessageV2Extension?.message;
  if (once?.imageMessage) {
    const stream = await downloadContentFromMessage(once.imageMessage, 'image');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return { buffer: Buffer.concat(chunks), isVideo: false };
  }
  if (once?.videoMessage) {
    const stream = await downloadContentFromMessage(once.videoMessage, 'video');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return { buffer: Buffer.concat(chunks), isVideo: true };
  }
  return null;
}

async function handleStickerCommand(sock, msg) {
  const text = getMessageText(msg).toLowerCase();
  if (text !== '-sticker' && text !== 'sticker') return false;

  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return false;

  if (quoted.stickerMessage) return false;

  const jid = msg.key.remoteJid;
  try {
    const media = await downloadQuotedMedia(quoted);
    if (!media?.buffer?.length) return true;

    const stickerBuffer = await bufferToStickerWebp(media.buffer, media.isVideo);
    if (!stickerBuffer?.length) return true;

    await sock.sendMessage(jid, { sticker: stickerBuffer });
  } catch (err) {
    console.error('Commande -sticker:', err.message);
  }
  return true;
}

module.exports = { handleStickerCommand, getMessageText };
