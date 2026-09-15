/**
 * Anti-suppression : cache + renvoi privé avec nom + type (photo / vidéo / …).
 */
const {
  downloadContentFromMessage,
  proto,
  WAMessageStubType,
} = require('@whiskeysockets/baileys');

const REVOKE = proto.Message.ProtocolMessage.Type.REVOKE; // 0
const MAX_CACHE = 800;
const TTL_MS = 48 * 60 * 60 * 1000;

/** botId -> Map(cacheKey -> { msg, storedAt }) */
const caches = new Map();

function selfJid(sock) {
  return `${sock.user.id.split(':')[0]}@s.whatsapp.net`;
}

function cacheKey(key) {
  if (!key?.id) return null;
  return `${key.remoteJid || ''}|${key.id}`;
}

function getCache(botId) {
  if (!caches.has(botId)) caches.set(botId, new Map());
  return caches.get(botId);
}

function prune(cache) {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.storedAt > TTL_MS) cache.delete(k);
  }
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension?.message) {
    return unwrapMessage(message.viewOnceMessageV2Extension.message);
  }
  if (message.documentWithCaptionMessage?.message) {
    return unwrapMessage(message.documentWithCaptionMessage.message);
  }
  return message;
}

function isStorableContent(message) {
  const m = unwrapMessage(message);
  if (!m) return false;
  return Boolean(
    m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage ||
      m.videoMessage ||
      m.audioMessage ||
      m.documentMessage ||
      m.stickerMessage
  );
}

function senderLabel(stored) {
  const name = stored.pushName && String(stored.pushName).trim();
  if (name) return name;
  const jid = stored.key?.participant || stored.key?.remoteJid || '';
  return jid.split('@')[0] || 'Inconnu';
}

function mediaKindLabel(m) {
  if (m.imageMessage) return 'photo';
  if (m.videoMessage) return 'vidéo';
  if (m.audioMessage) return m.audioMessage.ptt ? 'audio' : 'audio';
  if (m.stickerMessage) return 'sticker';
  if (m.documentMessage) return 'document';
  if (m.conversation || m.extendedTextMessage?.text) return 'message';
  return 'média';
}

function headerLine(stored, m) {
  return `${senderLabel(stored)} — ${mediaKindLabel(m)}`;
}

/** Enregistre un message reçu pour pouvoir le récupérer après suppression. */
function storeIncomingMessage(botId, msg) {
  if (!msg?.key?.id || msg.key.fromMe) return;
  if (msg.key.remoteJid === 'status@broadcast') return;
  if (!msg.message || msg.message.protocolMessage) return;
  if (!isStorableContent(msg.message)) return;

  const key = cacheKey(msg.key);
  if (!key) return;

  const cache = getCache(botId);
  prune(cache);
  cache.set(key, {
    storedAt: Date.now(),
    msg: {
      key: { ...msg.key },
      pushName: msg.pushName,
      message: msg.message,
      messageTimestamp: msg.messageTimestamp,
    },
  });
}

async function downloadMedia(content, type) {
  const stream = await downloadContentFromMessage(content, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Renvoi privé : « Nom — photo|vidéo|audio|message » + contenu. */
async function forwardDeletedContent(sock, stored) {
  const m = unwrapMessage(stored.message);
  if (!m) return false;

  const me = selfJid(sock);
  const header = headerLine(stored, m);

  if (m.conversation) {
    await sock.sendMessage(me, { text: `${header}\n\n${m.conversation}` });
    return true;
  }
  if (m.extendedTextMessage?.text) {
    await sock.sendMessage(me, { text: `${header}\n\n${m.extendedTextMessage.text}` });
    return true;
  }
  if (m.imageMessage) {
    const buffer = await downloadMedia(m.imageMessage, 'image');
    if (!buffer.length) return false;
    const caption = m.imageMessage.caption
      ? `${header}\n\n${m.imageMessage.caption}`
      : header;
    await sock.sendMessage(me, { image: buffer, caption });
    return true;
  }
  if (m.videoMessage) {
    const buffer = await downloadMedia(m.videoMessage, 'video');
    if (!buffer.length) return false;
    const caption = m.videoMessage.caption
      ? `${header}\n\n${m.videoMessage.caption}`
      : header;
    await sock.sendMessage(me, { video: buffer, caption });
    return true;
  }
  if (m.audioMessage) {
    const buffer = await downloadMedia(m.audioMessage, 'audio');
    if (!buffer.length) return false;
    await sock.sendMessage(me, { text: header });
    await sock.sendMessage(me, {
      audio: buffer,
      mimetype: m.audioMessage.mimetype || 'audio/ogg; codecs=opus',
      ptt: Boolean(m.audioMessage.ptt),
    });
    return true;
  }
  if (m.stickerMessage) {
    const buffer = await downloadMedia(m.stickerMessage, 'sticker');
    if (!buffer.length) return false;
    await sock.sendMessage(me, { text: header });
    await sock.sendMessage(me, { sticker: buffer });
    return true;
  }
  if (m.documentMessage) {
    const buffer = await downloadMedia(m.documentMessage, 'document');
    if (!buffer.length) return false;
    await sock.sendMessage(me, {
      document: buffer,
      mimetype: m.documentMessage.mimetype || 'application/octet-stream',
      fileName: m.documentMessage.fileName || 'fichier',
      caption: header,
    });
    return true;
  }

  return false;
}

async function recoverDeleted(sock, botId, revokedKey) {
  if (!revokedKey?.id) return;
  if (revokedKey.fromMe) return;

  const key = cacheKey(revokedKey);
  const cache = getCache(botId);
  const entry = key && cache.get(key);
  if (!entry) return;

  cache.delete(key);
  try {
    await forwardDeletedContent(sock, entry.msg);
  } catch (err) {
    console.error(`[anti-delete bot ${botId}] échec renvoi:`, err.message);
  }
}

async function handleRevokeUpsert(sock, botId, msg) {
  const protocol = msg.message?.protocolMessage;
  if (!protocol) return false;
  const type = protocol.type;
  if (type !== REVOKE && type !== 'REVOKE' && type !== 0) return false;
  await recoverDeleted(sock, botId, protocol.key);
  return true;
}

async function handleRevokeUpdates(sock, botId, updates) {
  if (!Array.isArray(updates)) return;
  for (const item of updates) {
    const stub = item.update?.messageStubType;
    const isRevoke =
      stub === WAMessageStubType.REVOKE ||
      stub === 'REVOKE' ||
      Number(stub) === Number(WAMessageStubType.REVOKE);
    if (!isRevoke || !item.key) continue;
    await recoverDeleted(sock, botId, item.key);
  }
}

function clearBotCache(botId) {
  caches.delete(botId);
}

module.exports = {
  storeIncomingMessage,
  handleRevokeUpsert,
  handleRevokeUpdates,
  clearBotCache,
};
