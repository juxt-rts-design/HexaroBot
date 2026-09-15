const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { supabase } = require('../config/supabase');

const SESSIONS_DIR = path.join(__dirname, '..', '..', 'sessions');

// vue_unique tourne désormais sur baileysManager.js (voir persona/viewOnceBaileys.js).
const personas = {
  compagnon: require('./persona/companion'),
  auto_reply: require('./persona/autoReply'),
};

const activeClients = new Map(); // botId -> Client
const lastQr = new Map(); // botId -> qr data URL (pour les sockets qui rejoignent en retard)
const lastStatus = new Map(); // botId -> dernier statut connu
let ioRef = null;

function init(io) {
  ioRef = io;
}

function room(botId) {
  return `bot:${botId}`;
}

function emit(botId, event, payload) {
  if (ioRef) ioRef.to(room(botId)).emit(event, payload);
}

// Permet à un socket qui rejoint après coup (modale QR rouverte, page rechargée)
// de recevoir immédiatement le dernier état connu au lieu d'attendre un événement
// qui a peut-être déjà eu lieu.
function sendSnapshot(socket, botId) {
  if (lastQr.has(botId)) socket.emit('qr', { qr: lastQr.get(botId) });
  if (lastStatus.has(botId)) socket.emit('status', lastStatus.get(botId));
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

async function killClient(botId) {
  const client = activeClients.get(botId);
  if (!client) return;
  activeClients.delete(botId);
  try {
    await client.destroy();
  } catch { /* déjà mort */ }
}

// `force` détruit un éventuel client existant (zombie ou en attente de scan)
// avant d'en recréer un — utilisé quand l'utilisateur demande explicitement un
// nouveau QR ("Connecter un numéro").
async function startBot({ botId, sessionKey, planCode, force = false }) {
  if (force) {
    await killClient(botId);
    lastQr.delete(botId);
  } else if (activeClients.has(botId)) {
    return activeClients.get(botId);
  }

  const persona = personas[planCode];
  if (!persona) throw new Error(`Plan inconnu: ${planCode}`);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sessionKey, dataPath: SESSIONS_DIR }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  client.on('qr', async (qr) => {
    await setStatus(botId, 'qr_pending');
    const qrDataUrl = await qrcode.toDataURL(qr);
    lastQr.set(botId, qrDataUrl);
    emit(botId, 'qr', { qr: qrDataUrl });
  });

  client.on('ready', async () => {
    lastQr.delete(botId);
    const phone = client.info?.wid?.user || null;
    await setStatus(botId, 'connected', { phone_number: phone });
  });

  client.on('disconnected', async (reason) => {
    console.log(`Bot ${botId} déconnecté (${reason})`);
    lastQr.delete(botId);
    await setStatus(botId, 'disconnected');
    activeClients.delete(botId);
  });

  // Le navigateur headless peut planter (mémoire, timeout) sans déclencher
  // 'disconnected' : sans ça le bot restait zombie indéfiniment dans la Map.
  client.on('change_state', (state) => console.log(`Bot ${botId} state: ${state}`));

  client.on('message', async (msg) => {
    try {
      await persona.handleMessage(client, msg, { botId });
    } catch (err) {
      console.error(`Erreur handler bot ${botId} (${planCode}):`, err.message);
    }
  });

  activeClients.set(botId, client);

  try {
    await client.initialize();
  } catch (err) {
    activeClients.delete(botId);
    console.error(`Échec initialize() bot ${botId}:`, err.message);
    throw err;
  }

  client.pupBrowser?.on('disconnected', async () => {
    console.error(`Chromium du bot ${botId} a crashé/fermé de façon inattendue.`);
    activeClients.delete(botId);
    lastQr.delete(botId);
    await setStatus(botId, 'disconnected');
  });

  return client;
}

async function disconnectBot(botId, sessionKey) {
  const client = activeClients.get(botId);
  if (client) {
    try {
      await client.logout();
    } catch { /* déjà déconnecté */ }
    try {
      await client.destroy();
    } catch { /* ignore */ }
    activeClients.delete(botId);
  }
  lastQr.delete(botId);
  const sessionPath = path.join(SESSIONS_DIR, `session-${sessionKey}`);
  fs.rmSync(sessionPath, { recursive: true, force: true });
  await setStatus(botId, 'disconnected', { phone_number: null });
}

// Relance les bots qui étaient connectés avant un redémarrage du process.
async function restoreActiveSessions() {
  const { data: rows, error } = await supabase
    .from('bots')
    .select('id, session_key, plan_code')
    .neq('plan_code', 'vue_unique')
    .in('status', ['connected', 'qr_pending']);
  if (error) {
    console.error('restoreActiveSessions wweb:', error.message);
    return;
  }
  for (const bot of rows || []) {
    startBot({ botId: bot.id, sessionKey: bot.session_key, planCode: bot.plan_code }).catch((err) =>
      console.error(`Échec restauration bot ${bot.id}:`, err.message)
    );
  }
}

function wipeSession(sessionKey) {
  const sessionPath = path.join(SESSIONS_DIR, `session-${sessionKey}`);
  fs.rmSync(sessionPath, { recursive: true, force: true });
}

// Envoie un message texte au propriétaire du bot (sur son propre chat), pour
// les diffusions admin ou toute notification système.
async function sendToSelf(botId, text) {
  const client = activeClients.get(botId);
  if (!client) throw new Error(`Bot ${botId} non connecté.`);
  await client.sendMessage(client.info.wid._serialized, text);
}

module.exports = { init, startBot, disconnectBot, restoreActiveSessions, room, sendSnapshot, wipeSession, sendToSelf };
