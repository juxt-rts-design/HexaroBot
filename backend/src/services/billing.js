const { randomBytes } = require('crypto');
const { supabase } = require('../config/supabase');
const baileysManager = require('./baileysManager');
const botManager = require('./botManager');

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 3);
const SUBSCRIPTION_PRICE_XAF = Number(process.env.SUBSCRIPTION_PRICE_XAF || 2100);
const BILLING_MONTH_DAYS = 30;
const BILLING_INTERVAL_MS = 15 * 60 * 1000;

function priceXaf() {
  return SUBSCRIPTION_PRICE_XAF;
}

function trialDays() {
  return TRIAL_DAYS;
}

function generateReference() {
  return randomBytes(5).toString('hex').slice(0, 10).toUpperCase();
}

function managerFor(planCode) {
  return planCode === 'vue_unique' ? baileysManager : botManager;
}

function addDays(from, days) {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseAmount(value) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/** Crée ou réutilise un abonnement actif (trial 3j ou illimité si exempt). */
async function ensureSubscriptionForBot(userId, planCode, { exempt = false } = {}) {
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
  if (existing?.length) {
    const sub = await clampLegacyFreeSub(existing[0], exempt);
    if (sub.status === 'active' && sub.ends_at && new Date(sub.ends_at) > new Date()) {
      return { ...sub, plan_code: planCode };
    }
  }

  const now = new Date();
  const endsAt = exempt
    ? addDays(now, 100 * 365)
    : addDays(now, trialDays());

  const { data: sub, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_id: plan.id,
      period: 'month',
      amount: exempt ? 0 : 0,
      status: 'active',
      is_trial: !exempt,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      billing_notices: {},
    })
    .select('*')
    .single();
  if (error) throw error;
  return { ...sub, plan_code: planCode };
}

/** Anciens abos « 100 ans / 0 FCFA » → vrai essai 3 jours depuis starts_at. */
async function clampLegacyFreeSub(sub, exempt) {
  if (!sub || exempt) return sub;
  const ends = sub.ends_at ? new Date(sub.ends_at) : null;
  if (!ends) return sub;
  const remainingDays = (ends.getTime() - Date.now()) / 86400000;
  const unpaid = Number(sub.amount) === 0;
  if (remainingDays <= 90 || !unpaid) return sub;

  const start = new Date(sub.starts_at || sub.created_at || Date.now());
  const trialEnd = addDays(start, trialDays());
  const patch = {
    is_trial: true,
    amount: 0,
    ends_at: trialEnd.toISOString(),
    billing_notices: {},
    status: trialEnd.getTime() <= Date.now() ? 'expired' : 'active',
  };
  await supabase.from('subscriptions').update(patch).eq('id', sub.id);
  return { ...sub, ...patch };
}

function describeAccess(sub) {
  if (!sub?.ends_at) {
    return { days_left: null, hours_left: null, expired: false, progress: 0 };
  }
  const msLeft = new Date(sub.ends_at).getTime() - Date.now();
  const trialSpan = trialDays() * 24 * 60 * 60 * 1000;
  const progress = sub.is_trial
    ? Math.min(100, Math.max(0, (1 - msLeft / trialSpan) * 100))
    : 0;
  return {
    days_left: msLeft > 0 ? Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000))) : 0,
    hours_left: msLeft > 0 ? Math.max(1, Math.ceil(msLeft / (60 * 60 * 1000))) : 0,
    expired: msLeft <= 0 || sub.status === 'expired',
    progress: Math.round(progress),
  };
}

async function getBillingSnapshot(userId) {
  const { data: bots } = await supabase
    .from('bots')
    .select('id, label, status, plan_code, phone_number, subscription_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const { data: profile } = await supabase
    .from('profiles')
    .select('exempt')
    .eq('id', userId)
    .maybeSingle();

  const exempt = Boolean(profile?.exempt);
  const subIds = [...new Set((bots || []).map((b) => b.subscription_id).filter(Boolean))];
  let subsById = {};
  if (subIds.length) {
    const { data: subs } = await supabase.from('subscriptions').select('*').in('id', subIds);
    for (const s of subs || []) {
      subsById[s.id] = await clampLegacyFreeSub(s, exempt);
    }
  }

  const enriched = (bots || []).map((b) => {
    const sub = subsById[b.subscription_id] || null;
    const access = describeAccess(sub);
    return {
      ...b,
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            is_trial: sub.is_trial,
            ends_at: sub.ends_at,
            amount: sub.amount,
            ...access,
          }
        : null,
    };
  });

  return {
    price_xaf: priceXaf(),
    trial_days: trialDays(),
    exempt,
    bots: enriched,
  };
}

async function notifyBot(botId, planCode, text) {
  try {
    await managerFor(planCode).sendToSelf(botId, text);
  } catch (err) {
    console.error(`[billing] notif bot ${botId}:`, err.message);
  }
}

async function suspendBot(bot) {
  if (bot.status === 'suspended') return;
  try {
    if (typeof baileysManager.pauseBot === 'function' && bot.plan_code === 'vue_unique') {
      await baileysManager.pauseBot(bot.id);
    } else if (bot.plan_code !== 'vue_unique') {
      await botManager.disconnectBot(bot.id, bot.session_key);
    } else {
      await baileysManager.pauseBot(bot.id);
    }
  } catch (err) {
    console.error(`[billing] pause bot ${bot.id}:`, err.message);
  }
  await supabase.from('bots').update({ status: 'suspended' }).eq('id', bot.id);
  await supabase
    .from('subscriptions')
    .update({ status: 'expired' })
    .eq('id', bot.subscription_id);
}

async function resumeBotAfterPayment(bot, endsAtIso) {
  await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      is_trial: false,
      amount: priceXaf(),
      ends_at: endsAtIso,
      billing_notices: {},
    })
    .eq('id', bot.subscription_id);

  await supabase.from('bots').update({ status: 'disconnected' }).eq('id', bot.id);

  try {
    await managerFor(bot.plan_code).startBot({
      botId: bot.id,
      sessionKey: bot.session_key,
      planCode: bot.plan_code,
      force: true,
    });
  } catch (err) {
    console.error(`[billing] resume bot ${bot.id}:`, err.message);
  }
}

async function applySuccessfulPayment(paymentRow) {
  const { data: bot } = await supabase
    .from('bots')
    .select('*')
    .eq('id', paymentRow.bot_id)
    .maybeSingle();

  const now = new Date();
  let base = now;
  if (bot?.subscription_id) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('ends_at, status')
      .eq('id', bot.subscription_id)
      .maybeSingle();
    if (sub?.ends_at && sub.status === 'active' && new Date(sub.ends_at) > now) {
      base = new Date(sub.ends_at);
    }
  }
  const endsAt = addDays(base, BILLING_MONTH_DAYS).toISOString();

  if (bot) {
    await resumeBotAfterPayment(bot, endsAt);
    setTimeout(() => {
      notifyBot(
        bot.id,
        bot.plan_code,
        `✅ Paiement reçu (${priceXaf()} FCFA).\nTon HexaroBot est prolongé jusqu'au ${new Date(endsAt).toLocaleDateString('fr-FR')}.\nMerci !`
      );
    }, 4000);
  } else if (paymentRow.subscription_id) {
    await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        is_trial: false,
        amount: priceXaf(),
        ends_at: endsAt,
        billing_notices: {},
      })
      .eq('id', paymentRow.subscription_id);
  }

  return endsAt;
}

function payPageUrl() {
  const base = (process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return `${base}/dashboard?pay=1`;
}

function reminderLastDayMessage() {
  const url = payPageUrl();
  return [
    '⚠️ HexaroBot — moins de 24 heures',
    '',
    'Ton accès se termine bientôt.',
    'Sans paiement, le bot sera mis en pause automatiquement (rien n’est supprimé).',
    '',
    `Passe au paiement : ${priceXaf()} FCFA / mois`,
    'Airtel Money ou MoBiCash',
    '',
    '👇 Clique ici :',
    url,
  ].join('\n');
}

function reminderExpiredMessage() {
  const url = payPageUrl();
  return [
    '⛔ HexaroBot est en pause',
    '',
    'Le délai est écoulé, sans paiement.',
    'Ta session et tes données sont conservées.',
    '',
    `Réactive pour ${priceXaf()} FCFA / mois :`,
    url,
  ].join('\n');
}

async function processBillingTick() {
  const { data: bots, error } = await supabase
    .from('bots')
    .select('id, user_id, plan_code, status, session_key, subscription_id, phone_number')
    .neq('plan_code', '___none___');

  if (error) {
    console.error('[billing] list bots:', error.message);
    return;
  }

  const now = Date.now();
  for (const bot of bots || []) {
    if (!bot.subscription_id) continue;

    const { data: profile } = await supabase
      .from('profiles')
      .select('exempt')
      .eq('id', bot.user_id)
      .maybeSingle();
    if (profile?.exempt) continue;

    const { data: rawSub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', bot.subscription_id)
      .maybeSingle();
    if (!rawSub?.ends_at) continue;
    const sub = await clampLegacyFreeSub(rawSub, false);

    const endsAt = new Date(sub.ends_at).getTime();
    const hoursLeft = (endsAt - now) / (3600 * 1000);
    const notices = sub.billing_notices || {};

    if (hoursLeft <= 0) {
      if (bot.status !== 'suspended') {
        if (!notices.expired) {
          await notifyBot(bot.id, bot.plan_code, reminderExpiredMessage());
          await supabase
            .from('subscriptions')
            .update({ billing_notices: { ...notices, expired: new Date().toISOString(), h24: notices.h24 || new Date().toISOString() } })
            .eq('id', sub.id);
        }
        await suspendBot(bot);
      }
      continue;
    }

    if (hoursLeft <= 24 && !notices.h24) {
      await notifyBot(bot.id, bot.plan_code, reminderLastDayMessage());
      await supabase
        .from('subscriptions')
        .update({ billing_notices: { ...notices, h24: new Date().toISOString() } })
        .eq('id', sub.id);
    }
  }
}

let billingTimer = null;

function startBillingJob() {
  if (billingTimer) return;
  const run = () => {
    processBillingTick().catch((err) => console.error('[billing] tick:', err.message));
  };
  setTimeout(run, 20_000);
  billingTimer = setInterval(run, BILLING_INTERVAL_MS);
  console.log(`[billing] job démarré (toutes les ${BILLING_INTERVAL_MS / 60000} min)`);
}

module.exports = {
  priceXaf,
  trialDays,
  generateReference,
  ensureSubscriptionForBot,
  getBillingSnapshot,
  applySuccessfulPayment,
  parseAmount,
  startBillingJob,
  processBillingTick,
  suspendBot,
};
