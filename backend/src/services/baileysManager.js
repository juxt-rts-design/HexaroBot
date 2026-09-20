const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  Browsers,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const pino = require('pino');
const { supabase } = require('../config/supabase');
const { handleViewOnce } = require('./persona/viewOnceBaileys');
const { logMessage } = require('./messageLog');
const { tryHandleMediaLink } = require('./mediaLinkHandler');
const { handleStickerCommand, getMessageText } = require('./stickerCommand');
const {
  handleStatusUpsert,
  handleStatusReaction,
  handleStatusReactionMessage,
  clearStatusCache,
} = require('./statusStealth');
const {
  storeIncomingMessage,
  handleRevokeUpsert,
  handleRevokeUpdates,
  clearBotCache,
} = require('./antiDelete');
const { handleProfileKeyword } = require('./profilePictureHandler');
const { persistChatMedia } = require('./mediaStorage');

const CHAT_MEDIA_DIR = path.join(__dirname, '..', '..', 'uploads', 'chat');
const DOWNLOAD_TYPE_BY_MEDIA = { image: 'image', video: 'video', audio: 'audio', voice: 'audio', sticker: 'sticker', document: 'document' };
const EXT_BY_MEDIA = { image: 'jpg', video: 'mp4', audio: 'ogg', voice: 'ogg', sticker: 'webp', document: 'bin' };

// Télécharge le média d'un message "normal" (pas vue-unique) pour l'historique
// de conversation façon WhatsApp Web côté admin. Best-effort : un média expiré
// ou introuvable ne doit pas empêcher la journalisation du message lui-même.
function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension?.message) return unwrapMessage(message.viewOnceMessageV2Extension.message);
  if (message.documentWithCaptionMessage?.message) return unwrapMessage(message.documentWithCaptionMessage.message);
  if (message.editedMessage?.message) return unwrapMessage(message.editedMessage.message);
  return message;
}

async function downloadChatMedia(message, mediaType, botId) {
  if (!persistChatMedia()) return null;
  const unwrapped = unwrapMessage(message) || message;
  const dlType = DOWNLOAD_TYPE_BY_MEDIA[mediaType];
  const content = dlType && unwrapped[`${dlType}Message`];
  if (!content) return null;
  try {
    const stream = await downloadContentFromMessage(content, dlType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) return null;
    const dir = path.join(CHAT_MEDIA_DIR, String(botId));
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${Date.now()}-${crypto.randomUUID()}.${EXT_BY_MEDIA[mediaType] || 'bin'}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    console.error(`Échec téléchargement média conversation (bot ${botId}):`, err.message);
    return null;
  }
}

const IGNORED_KEYS = new Set(['senderKeyDistributionMessage', 'messageContextInfo', 'protocolMessage', 'pollUpdateMessage']);

function describeMessage(message) {
  const msg = unwrapMessage(message);
  if (!msg) return null;
  if (msg.conversation) return { body: msg.conversation, mediaType: null };
  if (msg.extendedTextMessage?.text) return { body: msg.extendedTextMessage.text, mediaType: null };
  if (msg.imageMessage) return { body: msg.imageMessage.caption || null, mediaType: 'image' };
  if (msg.videoMessage) return { body: msg.videoMessage.caption || null, mediaType: 'video' };
  if (msg.audioMessage) return { body: null, mediaType: msg.audioMessage.ptt ? 'voice' : 'audio' };
  if (msg.stickerMessage) return { body: null, mediaType: 'sticker' };
  if (msg.documentMessage) return { body: msg.documentMessage.fileName || null, mediaType: 'document' };
  if (msg.reactionMessage) return { body: msg.reactionMessage.text || null, mediaType: 'reaction' };
  if (msg.contactMessage) return { body: msg.contactMessage.displayName || null, mediaType: 'contact' };
  if (msg.contactsArrayMessage) return { body: `${msg.contactsArrayMessage.contacts?.length || 0} contacts`, mediaType: 'contact' };
  if (msg.locationMessage || msg.liveLocationMessage) {
    const loc = msg.locationMessage || msg.liveLocationMessage;
    return { body: `📍 ${loc.degreesLatitude}, ${loc.degreesLongitude}`, mediaType: 'location' };
  }
  if (msg.pollCreationMessage || msg.pollCreationMessageV3) {
    const poll = msg.pollCreationMessage || msg.pollCreationMessageV3;
    return { body: poll.name || null, mediaType: 'poll' };
  }
  if (msg.buttonsResponseMessage) return { body: msg.buttonsResponseMessage.selectedDisplayText || null, mediaType: null };
  if (msg.listResponseMessage) return { body: msg.listResponseMessage.title || null, mediaType: null };
  if (msg.templateButtonReplyMessage) return { body: msg.templateButtonReplyMessage.selectedDisplayText || null, mediaType: null };
  if (msg.groupInviteMessage) return { body: msg.groupInviteMessage.groupName || null, mediaType: 'group_invite' };

  const unknownKey = Object.keys(msg).find((k) => !IGNORED_KEYS.has(k));
  if (!unknownKey) return null;
  return { body: null, mediaType: `type: ${unknownKey.replace('Message', '')}` };
}

// Moteur dédié au plan "vue_unique" — voir viewOnceBaileys.js : la capture se
// fait via une commande ".save" en réponse au message cité, WhatsApp ne
// livrant jamais le contenu d'une vue-unique en direct à un appareil lié.
const SESSIONS_DIR = path.join(__dirname, '..', '..', 'sessions-baileys');
const VERSION_CACHE = path.join(SESSIONS_DIR, '.wa-version.json');

const activeSockets = new Map(); // botId -> socket
const lastQr = new Map();
const lastStatus = new Map();
const lastPairing = new Map(); // botId -> { code, raw, phone }
const pairingInFlight = new Map(); // botId -> Promise
const reconnectAttempts = new Map(); // botId -> nombre de tentatives depuis la dernière connexion réussie
const startLocks = new Map(); // botId -> Promise start en cours
let ioRef = null;

/** Même logique que Juxt : chiffres seuls + indicatif pays (ex. 24165255707). */
function normalizePairingPhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('2410') && digits.length >= 11) {
    digits = `241${digits.slice(4)}`;
  }
  const trunkDrop = digits.match(/^(33|32|34|39|44|49|237|225|221|226)0(\d{8,})$/);
  if (trunkDrop) digits = trunkDrop[1] + trunkDrop[2];
  return digits;
}

function formatPairingCode(code) {
  const raw = String(code || '').replace(/\s+/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

function init(io) {
  ioRef = io;
}

function room(botId) {
  return `bot:${botId}`;
}

function emit(botId, event, payload) {
  if (ioRef) ioRef.to(room(botId)).emit(event, payload);
}

function sendSnapshot(socket, botId) {
  if (lastQr.has(botId)) socket.emit('qr', { qr: lastQr.get(botId) });
  if (lastPairing.has(botId)) socket.emit('pairing-code', lastPairing.get(botId));
  const st = lastStatus.get(botId);
  if (st && !(st.status === 'connected' && lastQr.has(botId))) {
    socket.emit('status', st);
  }
}

function getConnectSnapshot(botId) {
  const id = Number(botId);
  const st = lastStatus.get(id) || lastStatus.get(botId);
  return {
    status: st?.status || null,
    phone_number: st?.phone_number || null,
    qr: lastQr.get(id) || lastQr.get(botId) || null,
    pairing: lastPairing.get(id) || lastPairing.get(botId) || null,
    ready: activeSockets.has(id) || activeSockets.has(botId),
  };
}

function getSock(botId) {
  const id = Number(botId);
  return activeSockets.get(id) || activeSockets.get(botId) || null;
}

function isLiveConnected(botId) {
  return Boolean(getSock(botId)?.user?.id);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resetSession(botId, sessionKey) {
  await killSocket(botId);
  clearLiveState(botId);
  wipeSession(sessionKey);
}

/** Session disque « registered » mais WhatsApp pas vraiment ouvert → on repart sur un QR. */
async function prepareForPairing(botId, sessionKey) {
  if (isLiveConnected(botId)) {
    const err = new Error('Ce bot est déjà lié à WhatsApp.');
    err.status = 409;
    throw err;
  }
  const sock = getSock(botId);
  const stale = Boolean(sock?.authState?.creds?.registered || sessionHasCreds(sessionKey));
  if (stale) {
    console.warn(`[baileys bot ${botId}] session périmée (fichier lié, pas de connexion) → nouveau QR`);
    await resetSession(botId, sessionKey);
  }
  if (!getSock(botId)) {
    await startBot({ botId, sessionKey, force: stale });
  }
}

async function waitForUnregisteredSock(botId, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (isLiveConnected(botId)) {
      return { sock: getSock(botId), registered: true, live: true };
    }
    const sock = getSock(botId);
    if (sock && !sock.authState?.creds?.registered) {
      return { sock, registered: false, live: false };
    }
    await sleep(300);
  }
  const sock = getSock(botId);
  return {
    sock: sock || null,
    registered: Boolean(sock?.authState?.creds?.registered),
    live: isLiveConnected(botId),
  };
}

async function resolveWaVersion() {
  try {
    const result = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout version WA')), 25000)),
    ]);
    if (result?.version) {
      try {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        fs.writeFileSync(VERSION_CACHE, JSON.stringify({ version: result.version, at: Date.now() }));
      } catch { /* cache optionnel */ }
      console.log(`[baileys] version WA ${result.version.join('.')}`);
    }
    return result;
  } catch (err) {
    try {
      const cached = JSON.parse(fs.readFileSync(VERSION_CACHE, 'utf8'));
      if (Array.isArray(cached?.version) && cached.version.length >= 3) {
        console.warn(`[baileys] version cache ${cached.version.join('.')} (${err.message})`);
        return { version: cached.version, isLatest: false };
      }
    } catch { /* pas de cache */ }
    // Ne pas forcer une vieille version : WhatsApp affiche alors « Couldn't link device ».
    console.warn('[baileys] version distante indisponible, défaut du paquet Baileys :', err.message);
    return { version: null, isLatest: false };
  }
}

function disconnectLabel(statusCode, message) {
  const map = {
    [DisconnectReason.loggedOut]: 'WhatsApp a retiré l’appareil lié (401) — il faut re-scanner',
    [DisconnectReason.timedOut]: 'Timeout socket/QR (408)',
    [DisconnectReason.connectionClosed]: 'Connexion fermée (428)',
    [DisconnectReason.connectionLost]: 'Connexion perdue',
    [DisconnectReason.connectionReplaced]: 'Session remplacée sur un autre appareil (440)',
    [DisconnectReason.badSession]: 'Session corrompue (500)',
    [DisconnectReason.restartRequired]: 'Redémarrage WhatsApp (515, normal après scan)',
    [DisconnectReason.unavailableService]: 'Service WhatsApp indisponible (503)',
  };
  return map[statusCode] || `code=${statusCode} ${message || ''}`.trim();
}

/**
 * Demande un code d’auth WhatsApp (8 chiffres) pour lier sans scanner le QR.
 * À appeler quand le bot est en qr_pending — même flux que Juxt requestPairingCode.
 */
async function requestPairingCode(botId, phoneRaw) {
  const phone = normalizePairingPhone(phoneRaw);
  if (!phone || phone.length < 8 || phone.length > 15) {
    const err = new Error('Numéro invalide. Mets l’indicatif pays, ex. 24165255707');
    err.status = 400;
    throw err;
  }

  const { sock, registered, live } = await waitForUnregisteredSock(botId, 25000);
  if (live) {
    const err = new Error('Ce bot est déjà lié à WhatsApp.');
    err.status = 409;
    throw err;
  }
  if (registered) {
    const err = new Error('Ancienne session WhatsApp encore en mémoire. Clique Relancer, puis réessaie.');
    err.status = 409;
    throw err;
  }
  if (!sock) {
    const err = new Error('WhatsApp n’est pas encore prêt. Clique Relancer, puis réessaie.');
    err.status = 409;
    throw err;
  }

  if (pairingInFlight.has(Number(botId)) || pairingInFlight.has(botId)) {
    return pairingInFlight.get(Number(botId)) || pairingInFlight.get(botId);
  }

  const id = Number(botId);
  const job = (async () => {
    await sleep(1500);
    const current = activeSockets.get(id) || activeSockets.get(botId);
    if (!current) {
      const err = new Error('Connexion interrompue. Clique Relancer, puis réessaie.');
      err.status = 409;
      throw err;
    }
    const waitQrUntil = Date.now() + 20000;
    while (!lastQr.has(id) && !lastQr.has(botId) && Date.now() < waitQrUntil) {
      if (isLiveConnected(id)) break;
      await sleep(400);
    }
    if (isLiveConnected(id)) {
      const err = new Error('Ce bot est déjà lié à WhatsApp.');
      err.status = 409;
      throw err;
    }
    const code = await current.requestPairingCode(phone);
    const payload = {
      code: formatPairingCode(code),
      raw: String(code || '').replace(/\s+/g, ''),
      phone,
    };
    lastPairing.set(id, payload);
    emit(id, 'pairing-code', payload);
    return payload;
  })().finally(() => {
    pairingInFlight.delete(id);
    pairingInFlight.delete(botId);
  });

  pairingInFlight.set(id, job);
  return job;
}

const {
  looksLikeJid,
  formatJidLabel,
  formatPhoneDisplay,
  phoneFromJid,
  isBrandName,
  foldName,
  isUsableName,
} = require('../utils/chatNames');

function contactBookName(sock, jid) {
  try {
    const book = sock.contacts || sock.store?.contacts || {};
    const c = book[jid];
    return c?.name || c?.notify || c?.verifiedName || null;
  } catch {
    return null;
  }
}

/** Noms du compte connecté (owner) — à ne jamais utiliser comme nom de conversation. */
function ownerNames(sock) {
  const names = new Set();
  const u = sock?.user;
  if (!u) return names;
  for (const key of ['name', 'notify', 'verifiedName']) {
    if (u[key] && typeof u[key] === 'string') names.add(u[key].trim().toLowerCase());
  }
  return names;
}

function isOwnerName(sock, name) {
  if (!name || looksLikeJid(name)) return false;
  if (isBrandName(name)) return true;
  const owners = ownerNames(sock);
  if (owners.has(String(name).trim().toLowerCase())) return true;
  const normalized = foldName(name);
  if (!normalized) return false;
  for (const o of owners) {
    const on = foldName(o);
    if (on && (normalized.includes(on) || on.includes(normalized))) return true;
  }
  return false;
}

function isUsableChatName(sock, name) {
  return Boolean(name && isUsableName(name) && !isOwnerName(sock, name));
}

async function resolveChatName(sock, botId, jid, pushName, fromMe = false) {
  if (jid?.endsWith('@g.us')) {
    try {
      const meta = await sock.groupMetadata(jid);
      if (meta?.subject) return meta.subject;
    } catch { /* ignore */ }
  }

  const book = contactBookName(sock, jid);
  if (isUsableChatName(sock, book)) return book;

  // pushName = expéditeur. Utile seulement en réception (interlocuteur), jamais en envoi.
  if (!fromMe && isUsableChatName(sock, pushName) && !jid?.endsWith('@g.us')) {
    return pushName;
  }

  const { data } = await supabase
    .from('messages_log')
    .select('chat_name')
    .eq('bot_id', botId)
    .eq('chat_id', jid)
    .order('created_at', { ascending: false })
    .limit(40);
  const known = (data || []).find((r) => isUsableChatName(sock, r.chat_name));
  if (known) return known.chat_name;

  return formatJidLabel(jid);
}

async function resolveSenderName(sock, jid, participant, pushName, fromMe) {
  if (fromMe) return 'Vous';
  if (isUsableChatName(sock, pushName)) return pushName;
  const who = participant || jid;
  const book = contactBookName(sock, who);
  if (isUsableChatName(sock, book)) return book;
  return formatJidLabel(who);
}

async function setStatus(botId, status, extra = {}) {
  const patch = { status };
  if (extra.phone_number !== undefined) patch.phone_number = extra.phone_number;
  if (status === 'connected') patch.connected_at = new Date().toISOString();
  const { error } = await supabase.from('bots').update(patch).eq('id', botId);
  if (error) console.error(`setStatus bot ${botId}:`, error.message);
  const payload = { status, ...extra };
  lastStatus.set(botId, payload);
  emit(botId, 'status', payload);
}

async function killSocket(botId) {
  const sock = activeSockets.get(botId);
  if (!sock) return;
  activeSockets.delete(botId);
  try {
    sock.ev.removeAllListeners();
    sock.end(undefined);
  } catch { /* déjà fermé */ }
}

function wipeSession(sessionKey) {
  fs.rmSync(path.join(SESSIONS_DIR, sessionKey), { recursive: true, force: true });
}

function sessionHasCreds(sessionKey) {
  try {
    const file = path.join(SESSIONS_DIR, sessionKey, 'creds.json');
    if (!fs.existsSync(file)) return false;
    const creds = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Boolean(creds?.me?.id || creds?.registered === true);
  } catch {
    return false;
  }
}

function clearLiveState(botId) {
  lastQr.delete(botId);
  lastPairing.delete(botId);
  pairingInFlight.delete(botId);
  lastStatus.delete(botId);
  reconnectAttempts.delete(botId);
}

async function startBot({ botId, sessionKey, force = false }) {
  if (!force && activeSockets.has(botId)) {
    return activeSockets.get(botId);
  }

  const prev = startLocks.get(botId);
  if (prev) {
    if (!force) return prev;
    try { await prev; } catch { /* relance forcée */ }
  }

  const job = runStartBot({ botId, sessionKey, force }).finally(() => {
    if (startLocks.get(botId) === job) startLocks.delete(botId);
  });
  startLocks.set(botId, job);
  return job;
}

async function runStartBot({ botId, sessionKey, force = false }) {
  if (force) {
    await killSocket(botId);
    clearLiveState(botId);
  } else if (activeSockets.has(botId)) {
    return activeSockets.get(botId);
  }

  const authDir = path.join(SESSIONS_DIR, sessionKey);
  fs.mkdirSync(authDir, { recursive: true });
  let sock;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await resolveWaVersion();

    sock = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      // syncFullHistory + markOnline font rater le scan (« Couldn't link device »)
      // et font ressembler le bot à un client non officiel → déconnexion 401.
      syncFullHistory: false,
      markOnlineOnConnect: false,
      shouldSyncHistoryMessage: () => false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
    });
    activeSockets.set(botId, sock);
    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    console.error(`[baileys bot ${botId}] démarrage :`, err.message);
    await setStatus(botId, 'disconnected');
    throw err;
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      const qrDataUrl = await qrcode.toDataURL(qr);
      lastQr.set(botId, qrDataUrl);
      await setStatus(botId, 'qr_pending');
      emit(botId, 'qr', { qr: qrDataUrl });
    }

    if (connection === 'open') {
      lastQr.delete(botId);
      lastPairing.delete(botId);
      pairingInFlight.delete(botId);
      reconnectAttempts.delete(botId);
      const phone = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0] || null;
      await setStatus(botId, 'connected', { phone_number: phone });
    }

    if (connection === 'close') {
      activeSockets.delete(botId);
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const why = disconnectLabel(statusCode, lastDisconnect?.error?.message);
      console.error(`[baileys bot ${botId}] déconnecté : ${why}`);

      const wasConnected = lastStatus.get(botId)?.status === 'connected';
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isBadSession = statusCode === DisconnectReason.badSession;
      const isReplaced = statusCode === DisconnectReason.connectionReplaced;
      const attempt = (reconnectAttempts.get(botId) || 0) + 1;
      reconnectAttempts.set(botId, attempt);

      const qrPhase = lastStatus.get(botId)?.status === 'qr_pending' || lastQr.has(botId);
      const qrRetriesLeft = qrPhase && attempt <= 6;
      const liveRetriesLeft = wasConnected && attempt <= 30;
      const shouldRetry =
        !isLoggedOut &&
        !isBadSession &&
        !isReplaced &&
        (statusCode === DisconnectReason.restartRequired || liveRetriesLeft || qrRetriesLeft);

      if (shouldRetry) {
        const delay = statusCode === DisconnectReason.restartRequired
          ? 1200
          : qrPhase
            ? 4000
            : Math.min(attempt * 2000, 15000);
        console.log(`[baileys bot ${botId}] relance dans ${delay}ms (essai ${attempt})`);
        setTimeout(() => {
          startBot({ botId, sessionKey }).catch((err) =>
            console.error(`Échec reconnexion auto bot ${botId}:`, err.message)
          );
        }, delay);
        return;
      }

      lastQr.delete(botId);
      lastPairing.delete(botId);
      pairingInFlight.delete(botId);
      await setStatus(botId, 'disconnected', isLoggedOut || isBadSession ? { phone_number: null } : {});
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (process.env.DEBUG_VIEWONCE === 'true') {
      console.log(`[baileys bot ${botId}] messages.upsert type=${type} count=${messages.length}`);
    }
    // notify = messages chat ; append = souvent les statuts / sync
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      const isStatus = msg.key.remoteJid === 'status@broadcast';

      if (isStatus) {
        (async () => {
          await handleStatusUpsert(sock, botId, msg);
          await logStatusUpdate(sock, botId, msg);
        })().catch((err) => console.error(`Échec log statut bot ${botId}:`, err.message));
        continue;
      }

      // Like manuel d’un statut → envoi privé uniquement
      try {
        if (await handleStatusReactionMessage(sock, botId, msg)) continue;
      } catch (err) {
        console.error(`Erreur like statut bot ${botId}:`, err.message);
      }

      // Suppression « pour tout le monde » → renvoi privé du contenu mis en cache
      try {
        if (await handleRevokeUpsert(sock, botId, msg)) continue;
      } catch (err) {
        console.error(`Erreur anti-delete bot ${botId}:`, err.message);
      }

      // Cache des messages reçus (texte / photo / vidéo…) pour anti-delete
      if (type === 'notify' && !msg.key.fromMe) {
        storeIncomingMessage(botId, msg);
      }

      // Comme Juxt : les réponses fromMe (ex. -send) arrivent souvent en type "append".
      // Sans ça, la citation de vue unique n'est jamais traitée.
      const fromMe = Boolean(msg.key.fromMe);
      if (type !== 'notify' && !(type === 'append' && fromMe)) continue;

      const messageText = getMessageText(msg);
      let stickerHandled = false;
      try {
        stickerHandled = await handleStickerCommand(sock, msg);
        if (!stickerHandled) {
          tryHandleMediaLink(sock, msg, messageText);
        }
      } catch (err) {
        console.error(`Erreur médias/sticker bot ${botId}:`, err.message);
      }

      try {
        await handleProfileKeyword(sock, msg, { resolvePhoneJid });
      } catch (err) {
        console.error(`Erreur profil bot ${botId}:`, err.message);
      }

      // Journalisation chat : notify uniquement (évite le bruit sync append)
      if (type === 'notify') {
        const described = msg.message
          ? describeMessage(msg.message)
          : msg.key.isViewOnce
          ? { body: null, mediaType: 'view_once' }
          : null;
        if (described) {
          (async () => {
            const filePath = described.mediaType && msg.message
              ? await downloadChatMedia(msg.message, described.mediaType, botId)
              : null;
            const chatId = msg.key.remoteJid;
            const [chatName, senderName] = await Promise.all([
              resolveChatName(sock, botId, chatId, msg.pushName, fromMe),
              resolveSenderName(sock, chatId, msg.key.participant, msg.pushName, fromMe),
            ]);
            const row = await logMessage({
              botId,
              chatId,
              chatName,
              senderId: fromMe ? 'me' : msg.key.participant || chatId,
              senderName,
              direction: fromMe ? 'out' : 'in',
              body: described.body,
              mediaType: described.mediaType,
              filePath,
            });
            if (row) emit(botId, 'chat-message', row);

            if (!fromMe && isUsableChatName(sock, chatName)) {
              supabase
                .from('messages_log')
                .update({ chat_name: chatName })
                .eq('bot_id', botId)
                .eq('chat_id', chatId)
                .then(({ error }) => {
                  if (error) console.error(`Maj chat_name bot ${botId}:`, error.message);
                });
            }
          })().catch((err) => console.error(`Échec log message bot ${botId}:`, err.message));
        }
      }

      try {
        if (!stickerHandled) {
          await handleViewOnce(sock, msg, { botId });
        }
      } catch (err) {
        console.error(`Erreur handler vue_unique bot ${botId}:`, err.message);
      }
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    try {
      await handleRevokeUpdates(sock, botId, updates);
    } catch (err) {
      console.error(`Erreur messages.update anti-delete bot ${botId}:`, err.message);
    }
  });

  sock.ev.on('messages.reaction', async (reactions) => {
    try {
      for (const item of reactions || []) {
        await handleStatusReaction(sock, botId, item);
      }
    } catch (err) {
      console.error(`Erreur messages.reaction bot ${botId}:`, err.message);
    }
  });

  return sock;
}

async function logStatusUpdate(sock, botId, msg) {
  if (!msg?.message) return null;
  const described = describeMessage(msg.message);
  if (!described) return null;

  // Pas de readMessages ici : la copie privée ne se fait que si tu likes (statusStealth).

  const participant = msg.key.participant || msg.participant || null;
  const fromMe = Boolean(msg.key.fromMe);
  let filePath = null;
  if (described.mediaType && ['image', 'video', 'audio', 'voice', 'sticker'].includes(described.mediaType)) {
    filePath = await downloadChatMedia(msg.message, described.mediaType, botId);
  }

  // Identifiant stable du publieur (pas le brand local)
  let senderId = fromMe ? 'me' : participant;
  if (!fromMe && participant) {
    try {
      const { phoneJid } = await resolvePhoneJid(sock, participant);
      if (phoneJid) senderId = phoneJid;
    } catch { /* keep lid */ }
  }

  const mediaType = described.mediaType
    ? `status_${described.mediaType}`
    : 'status_text';

  const row = await logMessage({
    botId,
    chatId: 'status@broadcast',
    chatName: fromMe ? 'Moi' : (msg.pushName || 'Statut'),
    senderId,
    senderName: fromMe
      ? 'Vous'
      : (isBrandName(msg.pushName) ? formatJidLabel(senderId) : (msg.pushName || formatJidLabel(senderId))),
    direction: fromMe ? 'out' : 'in',
    body: described.body,
    mediaType,
    filePath,
  });
  if (row) emit(botId, 'status-update', row);
  return row;
}

async function listContactStatuses(botId, jid) {
  const sock = activeSockets.get(Number(botId));
  const ids = new Set([jid].filter(Boolean));
  if (sock && jid) {
    try {
      const { phoneJid } = await resolvePhoneJid(sock, jid);
      if (phoneJid) ids.add(phoneJid);
      for (const id of [...ids]) {
        const bare = String(id).split(':')[0];
        ids.add(bare);
        if (bare.includes('@')) ids.add(bare.split('@')[0]);
        if (id.includes('@s.whatsapp.net')) {
          ids.add(`${bare.split('@')[0]}@s.whatsapp.net`);
        }
        if (id.includes('@lid')) ids.add(id);
      }
      // LID ↔ PN inverse si possible
      try {
        const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(jid);
        if (lid) ids.add(lid);
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  const { data, error } = await supabase
    .from('messages_log')
    .select('id, sender_id, sender_name, body, media_type, file_path, created_at, direction')
    .eq('bot_id', botId)
    .eq('chat_id', 'status@broadcast')
    .neq('sender_id', 'me')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;

  const idList = [...ids].map(String);
  const numSet = new Set(idList.map((id) => String(id).split('@')[0].split(':')[0]).filter(Boolean));

  const rows = (data || []).filter((r) => {
    if (!r.sender_id || r.sender_id === 'me') return false;
    if (idList.includes(r.sender_id)) return true;
    const senderNum = String(r.sender_id).split('@')[0].split(':')[0];
    return senderNum && numSet.has(senderNum);
  });

  return rows
    .filter((r) => String(r.media_type || '').startsWith('status_') || r.media_type === 'status_text')
    .slice(0, 40)
    .map((r) => ({
      id: r.id,
      sender_id: r.sender_id,
      sender_name: r.sender_name,
      body: r.body,
      media_type: String(r.media_type || '').replace(/^status_/, '') || 'text',
      has_media: Boolean(r.file_path),
      created_at: r.created_at,
      direction: r.direction,
    }));
}

async function disconnectBot(botId, sessionKey) {
  const sock = activeSockets.get(botId);
  if (sock) {
    try {
      await sock.logout();
    } catch { /* déjà déconnecté */ }
    await killSocket(botId);
  }
  lastQr.delete(botId);
  lastPairing.delete(botId);
  pairingInFlight.delete(botId);
  reconnectAttempts.delete(botId);
  clearBotCache(botId);
  clearStatusCache(botId);
  wipeSession(sessionKey);
  await setStatus(botId, 'disconnected', { phone_number: null });
}

/** Coupe le socket sans logout WhatsApp ni wipe session (abonnement expiré). */
async function pauseBot(botId) {
  await killSocket(botId);
  clearLiveState(botId);
  reconnectAttempts.delete(botId);
}

async function restoreActiveSessions() {
  const { data: rows, error } = await supabase
    .from('bots')
    .select('id, session_key, status, phone_number')
    .eq('plan_code', 'vue_unique')
    .neq('status', 'suspended');
  if (error) {
    console.error('restoreActiveSessions baileys:', error.message);
    return;
  }
  for (const bot of rows || []) {
    const live = bot.status === 'connected' || bot.status === 'qr_pending';
    const restorable = bot.status === 'disconnected' && bot.phone_number && sessionHasCreds(bot.session_key);
    if (!live && !restorable) continue;
    console.log(`[baileys] restore bot ${bot.id} status=${bot.status} phone=${bot.phone_number || '-'}`);
    startBot({ botId: bot.id, sessionKey: bot.session_key }).catch((err) =>
      console.error(`Échec restauration bot ${bot.id}:`, err.message)
    );
  }
}

// Envoie un message texte au propriétaire du bot (sur son propre chat), pour
// les diffusions admin ou toute notification système.
async function sendToSelf(botId, text) {
  const sock = activeSockets.get(botId);
  if (!sock) throw new Error(`Bot ${botId} non connecté.`);
  const selfId = `${sock.user.id.split(':')[0]}@s.whatsapp.net`;
  await sock.sendMessage(selfId, { text });
}

async function resolvePhoneJid(sock, jid) {
  if (!jid || !sock) return { phoneJid: null, phone: null };
  const direct = phoneFromJid(jid);
  if (direct) return { phoneJid: jid, phone: direct };
  if (jid.endsWith('@lid') || jid.endsWith('@hosted')) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) return { phoneJid: pn, phone: phoneFromJid(pn) || formatPhoneDisplay(pn.split('@')[0]) };
    } catch { /* mapping inconnu */ }
  }
  return { phoneJid: null, phone: null };
}

function withTimeout(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

async function fetchPictureUrl(sock, jid, phoneJid = null) {
  if (!sock || !jid) return null;
  for (const target of [jid, phoneJid].filter(Boolean)) {
    try {
      const url = await withTimeout(sock.profilePictureUrl(target, 'preview'), 1500, null);
      if (url) return url;
    } catch { /* privée / introuvable */ }
  }
  return null;
}

/** Cache mémoire : évite de re-requêter WA à chaque refresh de liste */
const pictureCache = new Map(); // `${botId}:${jid}` -> { url, at }

function pictureCacheKey(botId, jid) {
  return `${botId}:${jid}`;
}

function readPictureCache(botId, jid) {
  const hit = pictureCache.get(pictureCacheKey(botId, jid));
  if (!hit) return undefined;
  const ttl = hit.url ? 30 * 60_000 : 5 * 60_000;
  if (Date.now() - hit.at > ttl) {
    pictureCache.delete(pictureCacheKey(botId, jid));
    return undefined;
  }
  return hit.url;
}

function writePictureCache(botId, jid, url) {
  pictureCache.set(pictureCacheKey(botId, jid), { url: url || null, at: Date.now() });
}

/** Photos de profil pour la liste (non bloquant côté client via lots) */
async function listChatPictures(botId, chatIds) {
  const sock = activeSockets.get(Number(botId));
  const ids = [...new Set((Array.isArray(chatIds) ? chatIds : []).filter(Boolean))].slice(0, 100);
  const pictures = {};
  if (!ids.length) return pictures;
  if (!sock) {
    for (const id of ids) pictures[id] = readPictureCache(botId, id) ?? null;
    return pictures;
  }

  const pending = [];
  for (const jid of ids) {
    const cached = readPictureCache(botId, jid);
    if (cached !== undefined) pictures[jid] = cached;
    else pending.push(jid);
  }

  const concurrency = 6;
  let idx = 0;
  async function worker() {
    while (idx < pending.length) {
      const i = idx++;
      const jid = pending[i];
      try {
        const { phoneJid } = await withTimeout(resolvePhoneJid(sock, jid), 1000, { phoneJid: null });
        const url = await fetchPictureUrl(sock, jid, phoneJid);
        writePictureCache(botId, jid, url);
        pictures[jid] = url;
      } catch {
        writePictureCache(botId, jid, null);
        pictures[jid] = null;
      }
    }
  }

  if (pending.length) {
    await withTimeout(
      Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker())),
      14000,
      null
    );
  }

  for (const jid of pending) {
    if (!(jid in pictures)) pictures[jid] = readPictureCache(botId, jid) ?? null;
  }
  return pictures;
}

async function enrichChats(botId, chats, { withPictures = false } = {}) {
  const sock = activeSockets.get(Number(botId));
  const list = (Array.isArray(chats) ? chats : []).filter(
    (c) => c?.chat_id && c.chat_id !== 'status@broadcast'
  );
  if (!sock) {
    return list.map((c) => ({
      ...c,
      phone: c.phone || phoneFromJid(c.chat_id),
      picture_url: c.picture_url || null,
      is_group: Boolean(c.chat_id?.endsWith('@g.us')),
    }));
  }

  const concurrency = 4;
  const out = new Array(list.length);
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const i = idx++;
      const c = list[i];
      try {
        const { phone, phoneJid } = await withTimeout(resolvePhoneJid(sock, c.chat_id), 1200, {
          phone: phoneFromJid(c.chat_id),
          phoneJid: null,
        });
        let name = c.chat_name;
        const book =
          contactBookName(sock, c.chat_id) ||
          (phoneJid ? contactBookName(sock, phoneJid) : null);
        if (isUsableChatName(sock, book)) name = book;
        const pictureUrl = withPictures
          ? await fetchPictureUrl(sock, c.chat_id, phoneJid)
          : null;
        out[i] = {
          ...c,
          chat_name: isUsableChatName(sock, name)
            ? name
            : (isUsableName(c.chat_name) ? c.chat_name : formatJidLabel(c.chat_id)),
          phone: phone || null,
          picture_url: pictureUrl,
          is_group: Boolean(c.chat_id?.endsWith('@g.us')),
        };
      } catch {
        out[i] = {
          ...c,
          phone: phoneFromJid(c.chat_id),
          picture_url: null,
          is_group: Boolean(c.chat_id?.endsWith('@g.us')),
        };
      }
    }
  }

  await withTimeout(
    Promise.all(Array.from({ length: Math.min(concurrency, list.length || 1) }, () => worker())),
    4000,
    null
  );

  // Si timeout global : compléter les trous
  for (let i = 0; i < list.length; i++) {
    if (!out[i]) {
      out[i] = {
        ...list[i],
        phone: phoneFromJid(list[i].chat_id),
        picture_url: null,
        is_group: Boolean(list[i].chat_id?.endsWith('@g.us')),
      };
    }
  }
  return out;
}

// Photo de profil + nom + numéro + statut + méta groupe
async function getProfile(botId, jid) {
  const sock = activeSockets.get(Number(botId));
  if (!sock) throw new Error(`Bot ${botId} non connecté.`);

  const isGroup = Boolean(jid?.endsWith('@g.us'));
  let pictureUrl = null;
  let about = null;
  let groupSubject = null;
  let participantsCount = null;
  let name = null;

  const { phone, phoneJid } = await resolvePhoneJid(sock, jid);

  try {
    pictureUrl = await sock.profilePictureUrl(jid, 'image');
  } catch {
    if (phoneJid && phoneJid !== jid) {
      try { pictureUrl = await sock.profilePictureUrl(phoneJid, 'image'); } catch { /* privée */ }
    }
  }
  writePictureCache(botId, jid, pictureUrl);

  if (isGroup) {
    try {
      const meta = await sock.groupMetadata(jid);
      groupSubject = meta?.subject || null;
      name = groupSubject;
      participantsCount = meta?.participants?.length ?? null;
      about = meta?.desc || null;
    } catch { /* ignore */ }
  } else {
    const book =
      contactBookName(sock, jid) ||
      (phoneJid ? contactBookName(sock, phoneJid) : null);
    if (isUsableChatName(sock, book)) name = book;

    try {
      const statusTarget = phoneJid || jid;
      const st = await sock.fetchStatus(statusTarget);
      const first = Array.isArray(st) ? st[0] : st;
      // USync : first.status peut être string ou { status, setAt }
      const raw = first?.status;
      if (typeof raw === 'string') about = raw;
      else if (raw && typeof raw === 'object') about = raw.status || raw.text || null;
      else about = typeof first?.status === 'string' ? first.status : null;
    } catch { /* ignore */ }
  }

  const { data: logs } = await supabase
    .from('messages_log')
    .select('chat_name, media_type, direction, file_path')
    .eq('bot_id', botId)
    .eq('chat_id', jid)
    .order('created_at', { ascending: false })
    .limit(200);

  const knownNames = (logs || []).map((r) => r.chat_name).filter(Boolean);
  if (!isUsableChatName(sock, name)) {
    const known = knownNames.find((n) => isUsableChatName(sock, n));
    if (known) name = known;
  }

  const mediaTypes = new Set(['image', 'video', 'sticker']);
  const mediaCount = (logs || []).filter((r) => mediaTypes.has(r.media_type) && r.file_path).length;
  const inCount = (logs || []).filter((r) => r.direction === 'in').length;
  const outCount = (logs || []).filter((r) => r.direction === 'out').length;

  return {
    jid,
    phoneJid: phoneJid || null,
    phone: phone || null,
    name: isUsableChatName(sock, name) ? name : (phone || formatJidLabel(jid)),
    about: about || null,
    pictureUrl,
    isGroup,
    groupSubject,
    participantsCount,
    stats: { mediaCount, inCount, outCount, total: (logs || []).length },
  };
}

async function getSessionProfile(botId) {
  const sock = activeSockets.get(Number(botId));
  if (!sock) throw new Error(`Bot ${botId} non connecté.`);
  const jid = sock.user?.id || null;
  let pictureUrl = null;
  let about = null;
  try {
    if (jid) pictureUrl = await sock.profilePictureUrl(jid, 'image');
  } catch { /* ignore */ }
  try {
    if (jid) {
      const st = await sock.fetchStatus(jid);
      const first = Array.isArray(st) ? st[0] : st;
      const raw = first?.status;
      if (typeof raw === 'string') about = raw;
      else if (raw && typeof raw === 'object') about = raw.status || raw.text || null;
    }
  } catch { /* ignore */ }
  const phone = phoneFromJid(jid) || formatPhoneDisplay(String(sock.user?.id || '').split(':')[0]) || null;
  return {
    jid,
    phone,
    name: sock.user?.name || sock.user?.notify || phone || 'Session',
    about,
    pictureUrl,
  };
}

async function updateSessionStatus(botId, statusText) {
  const sock = activeSockets.get(Number(botId));
  if (!sock) throw new Error(`Bot ${botId} non connecté.`);
  const text = String(statusText || '').trim();
  if (!text) throw new Error('Statut vide.');
  if (text.length > 139) throw new Error('Statut trop long (max 139 caractères).');
  await sock.updateProfileStatus(text);
  return { about: text };
}

// Envoie un texte dans une conversation précise (utilisé par l'interface
// "WhatsApp" de l'admin) et journalise l'envoi comme n'importe quel message.
async function logOutgoing(botId, chatId, { body, mediaType, filePath }) {
  const sock = activeSockets.get(botId);
  let chatName = chatId;
  const { data: existing } = await supabase
    .from('messages_log')
    .select('chat_name')
    .eq('bot_id', botId)
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(5);
  const known = (existing || []).find((r) => isUsableName(r.chat_name));
  if (known) chatName = known.chat_name;
  else if (sock) chatName = await resolveChatName(sock, botId, chatId, null, true);

  const row = await logMessage({
    botId,
    chatId,
    chatName,
    senderId: 'me',
    senderName: 'Vous',
    direction: 'out',
    body: body || null,
    mediaType: mediaType || null,
    filePath: filePath || null,
  });
  if (row) emit(botId, 'chat-message', row);
  return row;
}

async function sendToChat(botId, chatId, text) {
  const sock = activeSockets.get(botId);
  if (!sock) throw new Error(`Bot ${botId} non connecté.`);
  await sock.sendMessage(chatId, { text });
  return logOutgoing(botId, chatId, { body: text });
}

// Envoie un média (image/vidéo/audio/document) ou une note vocale dans une
// conversation, et le journalise comme n'importe quel message.
async function sendMediaToChat(botId, chatId, { buffer, mediaType, mimetype, caption, fileName, isVoiceNote }) {
  const sock = activeSockets.get(botId);
  if (!sock) throw new Error(`Bot ${botId} non connecté.`);

  let payload;
  if (isVoiceNote) {
    payload = { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true };
  } else if (mediaType === 'image') {
    payload = { image: buffer, caption: caption || undefined };
  } else if (mediaType === 'video') {
    payload = { video: buffer, caption: caption || undefined };
  } else if (mediaType === 'audio') {
    payload = { audio: buffer, mimetype: mimetype || 'audio/mpeg' };
  } else {
    payload = { document: buffer, mimetype: mimetype || 'application/octet-stream', fileName: fileName || 'fichier' };
  }
  await sock.sendMessage(chatId, payload);

  const effectiveType = isVoiceNote ? 'voice' : mediaType;
  let filePath = null;
  if (persistChatMedia()) {
    const dir = path.join(CHAT_MEDIA_DIR, String(botId));
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, `${Date.now()}-${crypto.randomUUID()}.${EXT_BY_MEDIA[effectiveType] || 'bin'}`);
    fs.writeFileSync(filePath, buffer);
  }

  return logOutgoing(botId, chatId, { body: caption || fileName || null, mediaType: effectiveType, filePath });
}

module.exports = {
  init,
  startBot,
  disconnectBot,
  pauseBot,
  restoreActiveSessions,
  room,
  sendSnapshot,
  getConnectSnapshot,
  wipeSession,
  resetSession,
  sessionHasCreds,
  isLiveConnected,
  prepareForPairing,
  sendToSelf,
  sendToChat,
  sendMediaToChat,
  getProfile,
  getSessionProfile,
  updateSessionStatus,
  enrichChats,
  listChatPictures,
  listContactStatuses,
  requestPairingCode,
};
