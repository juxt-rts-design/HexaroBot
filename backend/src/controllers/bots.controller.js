const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const botManager = require('../services/botManager');
const baileysManager = require('../services/baileysManager');
const botSettings = require('../services/botSettings');

const EDITABLE_FIELDS = {
  vue_unique: ['command_word', 'reactions_enabled', 'success_emoji', 'error_emoji'],
  compagnon: ['reactions_enabled'],
  auto_reply: [],
};

function managerFor(planCode) {
  return planCode === 'vue_unique' ? baileysManager : botManager;
}

exports.listMine = async (req, res) => {
  const { data: rows, error } = await supabase
    .from('bots')
    .select('id, plan_code, label, phone_number, status, created_at, connected_at, subscription_id')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ bots: rows || [] });
};

async function subscriptionForFreeUser(userId, planCode) {
  const { data: plan } = await supabase
    .from('plans')
    .select('*')
    .eq('code', planCode)
    .eq('active', true)
    .maybeSingle();
  if (!plan) return null;

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_id', plan.id)
    .eq('status', 'active')
    .order('id', { ascending: false })
    .limit(1);
  if (existing?.length) return { ...existing[0], plan_code: planCode };

  const endsAt = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString();
  const { data: sub, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_id: plan.id,
      period: 'month',
      amount: 0,
      status: 'active',
      starts_at: new Date().toISOString(),
      ends_at: endsAt,
    })
    .select('*')
    .single();
  if (error) throw error;
  return { ...sub, plan_code: planCode };
}

exports.create = async (req, res) => {
  try {
    const { subscriptionId, planCode, label } = req.body;
    const isExempt = Boolean(req.user.exempt);

    let sub;
    if (planCode) {
      if (!isExempt) {
        const { count, error: countErr } = await supabase
          .from('bots')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', req.user.id);
        if (countErr) return res.status(500).json({ error: countErr.message });
        if ((count || 0) >= 1) {
          return res.status(403).json({
            error: "Tu as déjà créé ton chatbot gratuit. Contacte l'administrateur pour en avoir plus.",
          });
        }
      }
      sub = await subscriptionForFreeUser(req.user.id, planCode);
      if (!sub) return res.status(404).json({ error: 'Offre introuvable.' });
    } else {
      const { data: rows } = await supabase
        .from('subscriptions')
        .select('*, plans(code)')
        .eq('id', subscriptionId)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (!rows) return res.status(404).json({ error: 'Abonnement introuvable.' });
      sub = { ...rows, plan_code: rows.plans?.code };
      if (sub.status !== 'active') {
        return res.status(403).json({ error: "Cet abonnement n'est pas encore actif. Il doit être validé après paiement." });
      }
      const { data: existing } = await supabase.from('bots').select('id').eq('subscription_id', subscriptionId).limit(1);
      if (existing?.length) return res.status(409).json({ error: 'Un bot existe déjà pour cet abonnement.' });
    }

    const sessionKey = crypto.randomUUID();
    const { data: bot, error } = await supabase
      .from('bots')
      .insert({
        user_id: req.user.id,
        subscription_id: sub.id,
        plan_code: sub.plan_code,
        session_key: sessionKey,
        label: label || (sub.plan_code === 'vue_unique' ? 'HexaroBot' : sub.plan_code),
        status: 'created',
      })
      .select('id, plan_code, label, status')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    managerFor(sub.plan_code)
      .startBot({ botId: bot.id, sessionKey, planCode: sub.plan_code })
      .catch((err) => console.error(`Échec démarrage bot ${bot.id}:`, err.message));

    res.status(201).json({ bot });
  } catch (err) {
    console.error('bots.create:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.disconnect = async (req, res) => {
  const { data: bot, error } = await supabase
    .from('bots')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  await managerFor(bot.plan_code).disconnectBot(bot.id, bot.session_key);
  res.json({ ok: true });
};

exports.getSettings = async (req, res) => {
  const { data: bot, error } = await supabase
    .from('bots')
    .select('id, plan_code')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  const settings = await botSettings.getSettings(bot.id, bot.plan_code);
  res.json({ settings });
};

exports.updateSettings = async (req, res) => {
  const { data: bot, error } = await supabase
    .from('bots')
    .select('id, plan_code')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  const allowed = EDITABLE_FIELDS[bot.plan_code] || [];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.command_word !== undefined) {
    const word = String(updates.command_word).trim().toLowerCase();
    if (!word || /\s/.test(word) || word.length > 30) {
      return res.status(400).json({ error: 'Le mot-clé doit être un seul mot, sans espace, 30 caractères max.' });
    }
    updates.command_word = word;
  }
  const settings = await botSettings.updateSettings(bot.id, updates);
  res.json({ settings });
};

exports.reconnect = async (req, res) => {
  const { data: bot, error } = await supabase
    .from('bots')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!bot) return res.status(404).json({ error: 'Bot introuvable.' });
  const manager = managerFor(bot.plan_code);
  if (bot.status !== 'connected') manager.wipeSession(bot.session_key);
  manager
    .startBot({ botId: bot.id, sessionKey: bot.session_key, planCode: bot.plan_code, force: true })
    .catch((err) => console.error(`Échec reconnexion bot ${bot.id}:`, err.message));
  res.json({ ok: true });
};
