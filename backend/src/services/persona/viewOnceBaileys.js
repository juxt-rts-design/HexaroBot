/**
 * Capture vue unique — même logique que Juxt_Rts_Bot processSendCommand / -send,
 * mais déclenchée par n'importe quelle réponse citée (pas seulement "-send"),
 * et envoi en privé (self) sans légende.
 */
const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { supabase } = require('../../config/supabase');

const UPLOADS_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'viewonce');
const EXT_BY_TYPE = { image: 'jpg', video: 'mp4', audio: 'ogg' };

function selfJid(sock) {
  return `${sock.user.id.split(':')[0]}@s.whatsapp.net`;
}

function getQuotedMessage(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.audioMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage ||
    m.stickerMessage?.contextInfo?.quotedMessage ||
    null
  );
}

function getQuotedParticipant(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo?.participant ||
    m.imageMessage?.contextInfo?.participant ||
    m.videoMessage?.contextInfo?.participant ||
    m.audioMessage?.contextInfo?.participant ||
    m.documentMessage?.contextInfo?.participant ||
    m.stickerMessage?.contextInfo?.participant ||
    null
  );
}

/**
 * Résolution média identique à Juxt (-send) :
 * - viewOnceMessage.imageMessage / .videoMessage (direct, sans .message) → citation non ouverte
 * - viewOnceMessageV2.message.imageMessage / .videoMessage
 * - imageMessage / videoMessage / audioMessage normaux
 */
function resolveQuotedMedia(quotedMsg) {
  if (!quotedMsg) return null;

  if (quotedMsg.viewOnceMessage) {
    const v1 = quotedMsg.viewOnceMessage;
    if (v1.imageMessage) return { type: 'image', content: v1.imageMessage };
    if (v1.videoMessage) return { type: 'video', content: v1.videoMessage };
    if (v1.audioMessage) return { type: 'audio', content: v1.audioMessage };
    // Variante parfois imbriquée
    const inner = v1.message;
    if (inner?.imageMessage) return { type: 'image', content: inner.imageMessage };
    if (inner?.videoMessage) return { type: 'video', content: inner.videoMessage };
    if (inner?.audioMessage) return { type: 'audio', content: inner.audioMessage };
  }

  if (quotedMsg.viewOnceMessageV2) {
    const v2 = quotedMsg.viewOnceMessageV2.message || quotedMsg.viewOnceMessageV2;
    if (v2.imageMessage) return { type: 'image', content: v2.imageMessage };
    if (v2.videoMessage) return { type: 'video', content: v2.videoMessage };
    if (v2.audioMessage) return { type: 'audio', content: v2.audioMessage };
  }

  if (quotedMsg.viewOnceMessageV2Extension) {
    const v2e = quotedMsg.viewOnceMessageV2Extension.message || quotedMsg.viewOnceMessageV2Extension;
    if (v2e.imageMessage) return { type: 'image', content: v2e.imageMessage };
    if (v2e.videoMessage) return { type: 'video', content: v2e.videoMessage };
    if (v2e.audioMessage) return { type: 'audio', content: v2e.audioMessage };
  }

  if (quotedMsg.imageMessage) return { type: 'image', content: quotedMsg.imageMessage };
  if (quotedMsg.videoMessage) return { type: 'video', content: quotedMsg.videoMessage };
  if (quotedMsg.audioMessage) return { type: 'audio', content: quotedMsg.audioMessage };

  return null;
}

async function downloadBuffer(content, type) {
  const stream = await downloadContentFromMessage(content, type);
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

async function isBotOwnerExempt(botId) {
  const { data } = await supabase
    .from('bots')
    .select('profiles(exempt)')
    .eq('id', botId)
    .maybeSingle();
  return Boolean(data?.profiles?.exempt);
}

async function saveAndForward(sock, ctx, jid, senderJid, senderName, type, content) {
  const buffer = await downloadBuffer(content, type);
  if (!buffer?.length) throw new Error('Média vide');

  const forwardMessage =
    type === 'audio'
      ? { audio: buffer, mimetype: content.mimetype || 'audio/ogg; codecs=opus', ptt: true }
      : { [type]: buffer };

  // Privé (différence vs Juxt qui renvoie dans le même chat)
  await sock.sendMessage(selfJid(sock), forwardMessage);

  if (await isBotOwnerExempt(ctx.botId)) return;

  const botDir = path.join(UPLOADS_DIR, String(ctx.botId));
  fs.mkdirSync(botDir, { recursive: true });
  const filePath = path.join(botDir, `${Date.now()}.${EXT_BY_TYPE[type] || 'bin'}`);
  fs.writeFileSync(filePath, buffer);

  const { error } = await supabase.from('view_once_logs').insert({
    bot_id: ctx.botId,
    chat_id: jid,
    sender_id: senderJid,
    sender_name: senderName,
    media_type: content.mimetype || type,
    file_path: filePath,
    caption: content.caption || null,
    forwarded_to_self: true,
  });
  if (error) console.error(`[vue_unique bot ${ctx.botId}] log view_once:`, error.message);
}

/**
 * Comme -send Juxt : n'importe quel message fromMe qui cite une VU / média.
 */
async function handleViewOnce(sock, msg, ctx) {
  const jid = msg.key.remoteJid;
  if (jid === 'status@broadcast') return;
  if (!msg.message) return;

  // Capture auto si le payload arrive complet (rare sur appareil lié)
  if (!msg.key.fromMe) {
    const hasVu =
      msg.message.viewOnceMessage ||
      msg.message.viewOnceMessageV2 ||
      msg.message.viewOnceMessageV2Extension;
    if (!hasVu) return;
    const direct = resolveQuotedMedia(msg.message);
    if (direct) {
      try {
        await saveAndForward(
          sock,
          ctx,
          jid,
          msg.key.participant || jid,
          msg.pushName || jid,
          direct.type,
          direct.content
        );
      } catch (err) {
        console.error(`[vue_unique bot ${ctx.botId}] échec auto:`, err.message);
      }
    }
    return;
  }

  // fromMe + citation = équivalent -send Juxt, n'importe quel texte
  const quotedMsg = getQuotedMessage(msg);
  if (!quotedMsg) return;

  const isVuQuote = Boolean(
    quotedMsg.viewOnceMessage ||
      quotedMsg.viewOnceMessageV2 ||
      quotedMsg.viewOnceMessageV2Extension ||
      quotedMsg.imageMessage?.viewOnce ||
      quotedMsg.videoMessage?.viewOnce ||
      quotedMsg.audioMessage?.viewOnce
  );
  // Uniquement les vues uniques (ouvertes ou non) — pas chaque réponse à une photo normale
  if (!isVuQuote) return;

  const media = resolveQuotedMedia(quotedMsg);
  if (!media) {
    if (process.env.DEBUG_VIEWONCE === 'true') {
      console.log(
        `[vue_unique] quote keys:`,
        Object.keys(quotedMsg).filter((k) => k.includes('Message') || k.includes('view'))
      );
    }
    return;
  }

  try {
    const quotedSender = getQuotedParticipant(msg) || jid;
    await saveAndForward(sock, ctx, jid, quotedSender, quotedSender, media.type, media.content);
  } catch (err) {
    console.error(`[vue_unique bot ${ctx.botId}] échec -send-like:`, err.message);
  }
}

module.exports = { handleViewOnce, resolveQuotedMedia };
