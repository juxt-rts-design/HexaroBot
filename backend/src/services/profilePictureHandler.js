/**
 * Récupération photo de profil — comme Juxt -pp.
 * Déclenché si le message (fromMe) contient « profil », « profile » ou « profiles ».
 * Envoi en privé.
 */
const axios = require('axios');

function selfJid(sock) {
  return `${sock.user.id.split(':')[0]}@s.whatsapp.net`;
}

function getMessageText(msg) {
  return (
    msg.message?.extendedTextMessage?.text ||
    msg.message?.conversation ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''
  );
}

function mentionsProfileKeyword(text) {
  return /\b(profils?|profiles?)\b/i.test(String(text || ''));
}

function getProfileJidCandidates(targetJid, phoneJid = null) {
  const candidates = [];
  if (targetJid) candidates.push(targetJid);
  if (phoneJid) candidates.push(phoneJid);
  if (targetJid?.endsWith('@lid')) {
    candidates.push(targetJid.replace('@lid', '@s.whatsapp.net'));
  }
  return [...new Set(candidates.filter(Boolean))];
}

function resolveTargetJid(msg, chatJid) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo;

  // Mention @quelqu'un
  const mentioned = ctx?.mentionedJid;
  if (Array.isArray(mentioned) && mentioned.length) return mentioned[0];

  // Réponse à un message → participant (groupe) ou chat (inbox)
  if (ctx?.participant) return ctx.participant;
  if (ctx?.quotedMessage) {
    // inbox : la personne citée est le contact du chat
    if (chatJid && !chatJid.endsWith('@g.us')) return chatJid;
  }

  // Pas de citation : photo du contact de la conversation (inbox)
  if (chatJid && !chatJid.endsWith('@g.us') && !chatJid.endsWith('@broadcast')) {
    return chatJid;
  }

  return null;
}

async function fetchProfileUrl(sock, candidates) {
  for (const candidate of candidates) {
    try {
      const url = await sock.profilePictureUrl(candidate, 'image');
      if (url) return url;
    } catch {
      // essai suivant
    }
  }
  return null;
}

/**
 * @returns {Promise<boolean>} true si le mot-clé était présent (traité ou tenté)
 */
async function handleProfileKeyword(sock, msg, { resolvePhoneJid } = {}) {
  if (!msg?.key?.fromMe) return false;
  const text = getMessageText(msg);
  if (!mentionsProfileKeyword(text)) return false;

  const chatJid = msg.key.remoteJid;
  if (chatJid === 'status@broadcast') return true;

  const targetJid = resolveTargetJid(msg, chatJid);
  if (!targetJid) return true;

  let phoneJid = null;
  if (typeof resolvePhoneJid === 'function') {
    try {
      const resolved = await resolvePhoneJid(sock, targetJid);
      phoneJid = resolved?.phoneJid || null;
    } catch { /* ignore */ }
  }

  const candidates = getProfileJidCandidates(targetJid, phoneJid);
  const me = selfJid(sock);

  try {
    const profileUrl = await fetchProfileUrl(sock, candidates);
    if (!profileUrl) return true;

    const { data } = await axios.get(profileUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    const buffer = Buffer.from(data);
    if (!buffer.length) return true;

    await sock.sendMessage(me, { image: buffer });
  } catch (err) {
    console.error('Photo de profil:', err.message);
  }

  return true;
}

module.exports = { handleProfileKeyword, mentionsProfileKeyword };
