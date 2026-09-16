const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { supabase } = require('../config/supabase');
const botManager = require('../services/botManager');
const baileysManager = require('../services/baileysManager');
const { transcodeToOggOpus } = require('../services/audioTranscoder');
const { pickBestChatName } = require('../utils/chatNames');

exports.uploadMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }).single('file');

exports.listUsers = async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, name, role, exempt, blocked, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data || [] });
};

exports.setBlocked = async (req, res) => {
  const { id } = req.params;
  const { blocked } = req.body;
  const { data: user, error: findErr } = await supabase.from('profiles').select('id').eq('id', id).maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const { error } = await supabase.from('profiles').update({ blocked: !!blocked }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  if (blocked) {
    const { data: bots } = await supabase.from('bots').select('id, plan_code, session_key').eq('user_id', id);
    for (const bot of bots || []) {
      const manager = bot.plan_code === 'vue_unique' ? baileysManager : botManager;
      await manager.disconnectBot(bot.id, bot.session_key).catch(() => {});
    }
  }

  res.json({ ok: true });
};

exports.setExempt = async (req, res) => {
  const { id } = req.params;
  const { exempt } = req.body;
  const { data: user, error: findErr } = await supabase.from('profiles').select('id').eq('id', id).maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const { error } = await supabase.from('profiles').update({ exempt: !!exempt }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  if (exempt) {
    const { data: plans } = await supabase.from('plans').select('id').eq('active', true);
    for (const plan of plans || []) {
      const { data: existing } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', id)
        .eq('plan_id', plan.id)
        .eq('status', 'active')
        .limit(1);
      if (existing?.length) continue;
      const endsAt = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString();
      await supabase.from('subscriptions').insert({
        user_id: id,
        plan_id: plan.id,
        period: 'month',
        amount: 0,
        status: 'active',
        starts_at: new Date().toISOString(),
        ends_at: endsAt,
      });
    }
  }

  res.json({ ok: true });
};

exports.listPayments = async (req, res) => {
  const { data, error } = await supabase
    .from('payments')
    .select('id, reference, operator_code, msisdn, amount, currency, status, transaction_id, created_at, updated_at, user_id, profiles(email, name)')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return res.status(500).json({ error: error.message });

  const rows = data || [];
  const success = rows.filter((p) => p.status === 'SUCCESS');
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthSuccess = success.filter((p) => new Date(p.created_at) >= monthStart);

  const sum = (list) => list.reduce((acc, p) => acc + Number(p.amount || 0), 0);

  const payments = rows.map((p) => ({
    ...p,
    user_email: p.profiles?.email,
    user_name: p.profiles?.name,
    profiles: undefined,
  }));

  res.json({
    payments,
    stats: {
      price_xaf: Number(process.env.SUBSCRIPTION_PRICE_XAF || 2100),
      count_success: success.length,
      total_success: sum(success),
      month_success: sum(monthSuccess),
      month_count: monthSuccess.length,
      count_pending: rows.filter((p) => p.status === 'PENDING').length,
      count_failed: rows.filter((p) => p.status === 'FAILED').length,
    },
  });
};

exports.listSubscriptions = async (req, res) => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, profiles(email, name), plans(name, code)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const subscriptions = (data || []).map((s) => ({
    ...s,
    user_email: s.profiles?.email,
    user_name: s.profiles?.name,
    plan_name: s.plans?.name,
    plan_code: s.plans?.code,
    profiles: undefined,
    plans: undefined,
  }));
  res.json({ subscriptions });
};

exports.activateSubscription = async (req, res) => {
  const { id } = req.params;
  const { data: sub, error: findErr } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!sub) return res.status(404).json({ error: 'Abonnement introuvable.' });
  const durationMs = sub.period === 'week' ? 7 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
  const endsAt = new Date(Date.now() + durationMs).toISOString();
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'active', starts_at: new Date().toISOString(), ends_at: endsAt })
    .eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, ends_at: endsAt });
};

exports.deleteSubscription = async (req, res) => {
  const { id } = req.params;
  const { data: bots } = await supabase.from('bots').select('id, plan_code, session_key').eq('subscription_id', id);
  for (const bot of bots || []) {
    const manager = bot.plan_code === 'vue_unique' ? baileysManager : botManager;
    await manager.disconnectBot(bot.id, bot.session_key).catch(() => {});
  }
  const { error, count } = await supabase.from('subscriptions').delete({ count: 'exact' }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  if (!count) return res.status(404).json({ error: 'Abonnement introuvable.' });
  res.json({ ok: true });
};

exports.listBots = async (req, res) => {
  const { data, error } = await supabase
    .from('bots')
    .select('*, profiles(email)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const bots = (data || []).map((b) => ({
    ...b,
    user_email: b.profiles?.email,
    profiles: undefined,
  }));
  res.json({ bots });
};

exports.deleteBot = async (req, res) => {
  const { id } = req.params;
  const { data: bot, error: findErr } = await supabase
    .from('bots')
    .select('id, plan_code, session_key')
    .eq('id', id)
    .maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  const manager = bot.plan_code === 'vue_unique' ? baileysManager : botManager;
  await manager.disconnectBot(bot.id, bot.session_key).catch(() => {});
  const { error } = await supabase.from('bots').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
};

exports.listBotChats = async (req, res) => {
  const { data, error } = await supabase
    .from('messages_log')
    .select('chat_id, chat_name, body, media_type, direction, created_at')
    .eq('bot_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) return res.status(500).json({ error: error.message });

  const byChat = new Map();
  for (const row of data || []) {
    if (!row.chat_id) continue;
    const entry = byChat.get(row.chat_id);
    if (!entry) {
      byChat.set(row.chat_id, {
        chat_id: row.chat_id,
        body: row.body,
        media_type: row.media_type,
        direction: row.direction,
        created_at: row.created_at,
        names: row.chat_name ? [row.chat_name] : [],
      });
    } else if (row.chat_name) {
      entry.names.push(row.chat_name);
    }
  }

  let chats = [...byChat.values()]
    .filter((c) => c.chat_id && c.chat_id !== 'status@broadcast')
    .map((c) => ({
      chat_id: c.chat_id,
      chat_name: pickBestChatName(c.names, c.chat_id),
      body: c.body,
      media_type: c.media_type,
      direction: c.direction,
      created_at: c.created_at,
      is_group: Boolean(c.chat_id.endsWith('@g.us')),
      phone: null,
    }));

  try {
    const { data: bot } = await supabase.from('bots').select('plan_code').eq('id', req.params.id).maybeSingle();
    if (bot?.plan_code === 'vue_unique') {
      // Noms / numéros rapides — pas de photos (sinon ça bloque la liste)
      chats = await baileysManager.enrichChats(req.params.id, chats, { withPictures: false });
    }
  } catch (err) {
    console.error('enrichChats:', err.message);
  }

  res.json({ chats });
};

exports.searchBotMessages = async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ hits: [] });

  const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const chatId = req.params.chatId || req.query.chatId || null;

  let query = supabase
    .from('messages_log')
    .select('id, chat_id, chat_name, sender_name, direction, body, media_type, created_at')
    .eq('bot_id', req.params.id)
    .neq('chat_id', 'status@broadcast')
    .ilike('body', `%${escaped}%`)
    .order('created_at', { ascending: false })
    .limit(chatId ? 80 : 60);

  if (chatId) query = query.eq('chat_id', chatId);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const hits = (data || []).map((r) => ({
    id: r.id,
    chat_id: r.chat_id,
    chat_name: r.chat_name,
    sender_name: r.sender_name,
    direction: r.direction,
    body: r.body,
    media_type: r.media_type,
    created_at: r.created_at,
  }));

  res.json({ hits });
};

exports.listChatPictures = async (req, res) => {
  const { data: bot, error } = await supabase.from('bots').select('plan_code').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  if (bot.plan_code !== 'vue_unique') return res.status(501).json({ error: 'Non disponible pour ce type de bot.' });

  const chatIds = Array.isArray(req.body?.chatIds) ? req.body.chatIds : [];
  try {
    const pictures = await baileysManager.listChatPictures(req.params.id, chatIds);
    res.json({ pictures });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
};

exports.listChatMessages = async (req, res) => {
  const { before } = req.query;
  let query = supabase
    .from('messages_log')
    .select('id, sender_id, sender_name, direction, body, media_type, file_path, created_at')
    .eq('bot_id', req.params.id)
    .eq('chat_id', req.params.chatId)
    .order('created_at', { ascending: false })
    .limit(60);
  if (before) query = query.lt('id', before);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map((r) => ({
    ...r,
    has_media: Boolean(r.file_path),
    file_path: undefined,
  }));
  res.json({ messages: rows.reverse(), hasMore: rows.length === 60 });
};

exports.deleteMessage = async (req, res) => {
  const { data: row, error: findErr } = await supabase
    .from('messages_log')
    .select('file_path')
    .eq('id', req.params.id)
    .maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!row) return res.status(404).json({ error: 'Message introuvable.' });
  if (row.file_path) fs.unlink(row.file_path, () => {});
  const { error } = await supabase.from('messages_log').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
};

exports.sendChatMessage = async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Message vide.' });

  const { data: bot, error: findErr } = await supabase
    .from('bots')
    .select('id, plan_code')
    .eq('id', req.params.id)
    .maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  const manager = bot.plan_code === 'vue_unique' ? baileysManager : botManager;
  if (!manager.sendToChat) return res.status(501).json({ error: 'Envoi non disponible pour ce type de bot.' });

  try {
    const row = await manager.sendToChat(bot.id, req.params.chatId, text);
    res.json({ ok: true, message: row });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
};

exports.sendChatMedia = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant.' });

  const { data: bot, error: findErr } = await supabase
    .from('bots')
    .select('id, plan_code')
    .eq('id', req.params.id)
    .maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  const manager = bot.plan_code === 'vue_unique' ? baileysManager : botManager;
  if (!manager.sendMediaToChat) return res.status(501).json({ error: 'Envoi de média non disponible pour ce type de bot.' });

  const isVoiceNote = req.body.voiceNote === 'true';

  try {
    const buffer = isVoiceNote ? await transcodeToOggOpus(req.file.buffer) : req.file.buffer;
    const mediaType = isVoiceNote
      ? 'voice'
      : req.file.mimetype.startsWith('image/')
      ? 'image'
      : req.file.mimetype.startsWith('video/')
      ? 'video'
      : req.file.mimetype.startsWith('audio/')
      ? 'audio'
      : 'document';

    const row = await manager.sendMediaToChat(bot.id, req.params.chatId, {
      buffer,
      mediaType,
      mimetype: req.file.mimetype,
      caption: req.body.caption,
      fileName: req.file.originalname,
      isVoiceNote,
    });
    res.json({ ok: true, message: row });
  } catch (err) {
    console.error('Échec envoi média admin:', err.message);
    res.status(409).json({ error: err.message });
  }
};

exports.viewChatMedia = async (req, res) => {
  const { data: row, error } = await supabase
    .from('messages_log')
    .select('file_path, media_type')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row?.file_path) return res.status(404).json({ error: 'Fichier introuvable.' });
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const ext = path.extname(row.file_path).toLowerCase();
  if (ext === '.webp' || row.media_type === 'sticker' || row.media_type === 'status_sticker') res.type('image/webp');
  else if (ext === '.png') res.type('image/png');
  else if (ext === '.gif') res.type('image/gif');
  else if (ext === '.mp4' || row.media_type === 'video' || row.media_type === 'status_video') res.type('video/mp4');
  else if (ext === '.ogg' || row.media_type === 'voice' || row.media_type === 'audio') res.type('audio/ogg');
  else if (row.media_type === 'image' || row.media_type === 'status_image') res.type('image/jpeg');

  res.sendFile(row.file_path);
};

exports.listChatMedia = async (req, res) => {
  const type = String(req.query.type || 'all');
  const allowed = type === 'all' ? ['image', 'video', 'sticker'] : [type];
  if (!allowed.every((t) => ['image', 'video', 'sticker'].includes(t))) {
    return res.status(400).json({ error: 'Type invalide.' });
  }

  const { data, error } = await supabase
    .from('messages_log')
    .select('id, media_type, body, direction, created_at, file_path')
    .eq('bot_id', req.params.id)
    .eq('chat_id', req.params.chatId)
    .eq('direction', 'in')
    .in('media_type', allowed)
    .order('created_at', { ascending: false })
    .limit(120);
  if (error) return res.status(500).json({ error: error.message });

  const media = (data || [])
    .filter((r) => r.file_path)
    .map((r) => ({
      id: r.id,
      media_type: r.media_type,
      body: r.body,
      created_at: r.created_at,
      has_media: true,
    }));
  res.json({ media });
};

exports.listContactStatuses = async (req, res) => {
  const { data: bot, error } = await supabase.from('bots').select('plan_code').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  if (bot.plan_code !== 'vue_unique') return res.status(501).json({ error: 'Non disponible pour ce type de bot.' });
  try {
    const statuses = await baileysManager.listContactStatuses(req.params.id, req.params.chatId);
    res.json({ statuses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getChatProfile = async (req, res) => {
  const { data: bot, error } = await supabase.from('bots').select('plan_code').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  if (bot.plan_code !== 'vue_unique') return res.status(501).json({ error: 'Non disponible pour ce type de bot.' });
  try {
    const profile = await baileysManager.getProfile(req.params.id, req.params.chatId);
    res.json({ profile });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
};

exports.getBotSessionProfile = async (req, res) => {
  const { data: bot, error } = await supabase.from('bots').select('plan_code, phone_number, status').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  if (bot.plan_code !== 'vue_unique') return res.status(501).json({ error: 'Non disponible pour ce type de bot.' });
  try {
    const profile = await baileysManager.getSessionProfile(req.params.id);
    res.json({ profile: { ...profile, phone: profile.phone || bot.phone_number, status: bot.status } });
  } catch (err) {
    res.json({
      profile: {
        jid: null,
        phone: bot.phone_number || null,
        name: bot.phone_number || 'Session',
        about: null,
        pictureUrl: null,
        status: bot.status,
        offline: true,
      },
    });
  }
};

exports.updateBotSessionStatus = async (req, res) => {
  const { status } = req.body || {};
  const { data: bot, error } = await supabase.from('bots').select('plan_code').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  if (bot.plan_code !== 'vue_unique') return res.status(501).json({ error: 'Non disponible pour ce type de bot.' });
  try {
    const result = await baileysManager.updateSessionStatus(req.params.id, status);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
};

exports.listViewOnceLogs = async (req, res) => {
  const { data, error } = await supabase
    .from('view_once_logs')
    .select('*, bots(user_id, profiles(email))')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  const logs = (data || []).map((v) => ({
    ...v,
    user_email: v.bots?.profiles?.email,
    bots: undefined,
  }));
  res.json({ logs });
};

exports.downloadViewOnceFile = async (req, res) => {
  const { data: row, error } = await supabase.from('view_once_logs').select('file_path, media_type').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row?.file_path) return res.status(404).json({ error: 'Fichier introuvable.' });
  if (!fs.existsSync(row.file_path)) return res.status(404).json({ error: 'Fichier absent du disque.' });
  const ext = path.extname(row.file_path) || `.${String(row.media_type || '').split('/')[1] || 'bin'}`;
  res.download(row.file_path, `vue-unique-${req.params.id}${ext}`);
};

exports.viewViewOnceMedia = async (req, res) => {
  const { data: row, error } = await supabase
    .from('view_once_logs')
    .select('file_path, media_type')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row?.file_path) return res.status(404).json({ error: 'Fichier introuvable.' });
  if (!fs.existsSync(row.file_path)) return res.status(404).json({ error: 'Fichier absent du disque.' });
  res.type(row.media_type || 'application/octet-stream');
  res.sendFile(path.resolve(row.file_path));
};

exports.broadcast = async (req, res) => {
  const { message, botId } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message vide.' });

  let query = supabase.from('bots').select('id, plan_code').eq('status', 'connected');
  if (botId) query = query.eq('id', botId);
  const { data: bots, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  if (!bots?.length) return res.status(404).json({ error: 'Aucun bot connecté trouvé.' });

  const results = await Promise.allSettled(
    bots.map((bot) => {
      const manager = bot.plan_code === 'vue_unique' ? baileysManager : botManager;
      return manager.sendToSelf(bot.id, message);
    })
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  res.json({ ok: true, sent, failed, total: bots.length });
};
