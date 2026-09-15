/**
 * Statuts WhatsApp — envoi privé quand tu likes / réponds au statut.
 *
 * WhatsApp n’envoie souvent PAS la réaction « cœur » seule à l’appareil lié.
 * En revanche, like/réponse crée un message sortant avec :
 *   contextInfo.remoteJid === 'status@broadcast'
 *   + quotedMessage (photo/vidéo/texte)
 * → on récupère ce média et on te l’envoie en privé.
 */
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const forwardedIds = new Map(); // botId -> Set
const statusCaches = new Map(); // botId -> Map(id -> { media, at })

const MAX_CACHE = 400;
const TTL_MS = 26 * 60 * 60 * 1000;

function selfJid(sock) {
  return `${sock.user.id.split(':')[0]}@s.whatsapp.net`;
}

function fwd(botId) {
  if (!forwardedIds.has(botId)) forwardedIds.set(botId, new Set());
  return forwardedIds.get(botId);
}

function cache(botId) {
  if (!statusCaches.has(botId)) statusCaches.set(botId, new Map());
  return statusCaches.get(botId);
}

function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension?.message) {
    return unwrapMessage(message.viewOnceMessageV2Extension.message);
  }
  return message;
}

function getContextInfo(msg) {
  const raw = msg.message;
  const m = unwrapMessage(raw) || raw;
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.stickerMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.reactionMessage?.contextInfo ||
    null
  );
}

function isStatusContext(ctx) {
  if (!ctx) return false;
  return (
    ctx.remoteJid === 'status@broadcast' ||
    ctx.remoteJidAlt === 'status@broadcast' ||
    String(ctx.remoteJid || '').includes('status@broadcast')
  );
}

async function extractMedia(node) {
  const unwrapped = unwrapMessage(node) || node;
  if (!unwrapped) return null;

  if (unwrapped.conversation || unwrapped.extendedTextMessage?.text) {
    // Texte de statut seulement si pas de média
    const text = unwrapped.conversation || unwrapped.extendedTextMessage.text;
    if (!unwrapped.imageMessage && !unwrapped.videoMessage && !unwrapped.audioMessage) {
      return { type: 'text', text };
    }
  }

  const kinds = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio'],
  ];
  for (const [field, type] of kinds) {
    if (!unwrapped[field]) continue;
    try {
      const stream = await downloadContentFromMessage(unwrapped[field], type);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) continue;
      return { type, buffer, mimetype: unwrapped[field].mimetype };
    } catch (err) {
      console.error('[status] DL média:', err.message);
    }
  }
  return null;
}

async function sendPrivate(sock, botId, id, media) {
  if (!media) return false;
  const done = fwd(botId);
  if (id && done.has(id)) return true;
  if (id) done.add(id);

  const me = selfJid(sock);
  if (media.type === 'text') {
    await sock.sendMessage(me, { text: media.text || '' });
  } else if (media.type === 'audio') {
    await sock.sendMessage(me, {
      audio: media.buffer,
      mimetype: media.mimetype || 'audio/ogg; codecs=opus',
      ptt: true,
    });
  } else {
    await sock.sendMessage(me, { [media.type]: media.buffer });
  }
  await sock.sendMessage(me, { text: 'Status récupéré avec succès' });
  console.log(`[status] OK privé bot=${botId} id=${id || '?'}`);
  return true;
}

/** Cache les statuts entrants (pour réaction pure si elle arrive). */
async function handleStatusUpsert(sock, botId, msg) {
  const jid = msg.key?.remoteJid;
  console.log(
    `[status] upsert jid=${jid} id=${msg.key?.id} fromMe=${msg.key?.fromMe} keys=${msg.message ? Object.keys(msg.message).join(',') : 'vide'}`
  );

  if (!msg?.key?.id || msg.key.fromMe) return;
  if (jid !== 'status@broadcast') return;
  if (!msg.message) return;

  const media = await extractMedia(msg.message);
  if (!media) return;

  const map = cache(botId);
  // prune léger
  const now = Date.now();
  for (const [k, v] of map) {
    if (now - v.at > TTL_MS) map.delete(k);
  }
  while (map.size > MAX_CACHE) map.delete(map.keys().next().value);

  map.set(msg.key.id, { media, at: now });
  console.log(`[status] mis en cache id=${msg.key.id} type=${media.type}`);
}

/**
 * Chemin principal : ton message sortant lié à un statut
 * (like ❤️ / réponse au statut → contextInfo.remoteJid = status@broadcast).
 */
async function handleStatusOutbound(sock, botId, msg) {
  if (!msg?.key?.fromMe || !msg.message) return false;

  const inner = { ...msg, message: unwrapMessage(msg.message) || msg.message };

  // A) reactionMessage vers un statut
  const reaction = inner.message?.reactionMessage || msg.message.reactionMessage;
  if (reaction?.key?.id && reaction.text !== '') {
    const target = reaction.key;
    const isStatus =
      target.remoteJid === 'status@broadcast' ||
      target.remoteJidAlt === 'status@broadcast';
    console.log(
      `[status] reactionMessage fromMe target=${target.remoteJid} id=${target.id} text=${reaction.text}`
    );
    if (isStatus) {
      const cached = cache(botId).get(target.id);
      if (cached?.media) {
        await sendPrivate(sock, botId, target.id, cached.media);
        return true;
      }
      console.log(`[status] like reçu mais pas encore de média en cache pour ${target.id}`);
    }
  }

  // B) message avec citation de statut
  const ctx = getContextInfo(inner);
  if (ctx && isStatusContext(ctx)) {
    const statusId = ctx.stanzaId || ctx.entryId || `st-${Date.now()}`;
    console.log(
      `[status] outbound quote status@broadcast stanza=${statusId} hasQuoted=${!!ctx.quotedMessage}`
    );

    let media = null;
    if (ctx.quotedMessage) {
      media = await extractMedia(ctx.quotedMessage);
    }
    if (!media && statusId) {
      media = cache(botId).get(statusId)?.media || null;
    }
    if (media) {
      await sendPrivate(sock, botId, statusId, media);
      return true;
    }
    console.log('[status] citation statut sans média exploitable');
    return true;
  }

  return false;
}

async function handleStatusReaction(sock, botId, item) {
  try {
    const statusKey = item?.key;
    const reaction = item?.reaction;
    console.log(
      `[status] event reaction keyJid=${statusKey?.remoteJid} id=${statusKey?.id} fromMe=${reaction?.key?.fromMe} text=${reaction?.text}`
    );
    if (!statusKey?.id) return;
    if (reaction?.key?.fromMe === false) return;
    if (reaction?.text === '') return;
    if (statusKey.remoteJid !== 'status@broadcast' && !cache(botId).has(statusKey.id)) return;

    const cached = cache(botId).get(statusKey.id);
    if (cached?.media) {
      await sendPrivate(sock, botId, statusKey.id, cached.media);
    } else {
      console.log(`[status] event like sans cache pour ${statusKey.id}`);
    }
  } catch (err) {
    console.error('[status] reaction event:', err.message);
  }
}

/** Compat anciens noms */
async function handleStatusReactionMessage(sock, botId, msg) {
  return handleStatusOutbound(sock, botId, msg);
}

function clearStatusCache(botId) {
  statusCaches.delete(botId);
  forwardedIds.delete(botId);
}

module.exports = {
  handleStatusUpsert,
  handleStatusReaction,
  handleStatusReactionMessage,
  handleStatusOutbound,
  clearStatusCache,
};
