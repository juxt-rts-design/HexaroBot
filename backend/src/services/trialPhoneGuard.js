const { supabase } = require('../config/supabase');

const BLOCK_MSG =
  'Ce numéro WhatsApp est déjà lié à un autre compte Hexaro. Utilise ce compte, ou paie l’abonnement (2100 FCFA) sur ton compte actuel pour autoriser ce numéro.';

/** Clé unique pour comparer QR, code pairing et numéro Baileys. */
function normalizeWaPhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('2410') && d.length >= 11) {
    d = `241${d.slice(4)}`;
  }
  const trunkDrop = d.match(/^(33|32|34|39|44|49|237|225|221|226)0(\d{8,})$/);
  if (trunkDrop) d = trunkDrop[1] + trunkDrop[2];
  if (d.length === 9 && d.startsWith('0')) d = `241${d.slice(1)}`;
  if (d.length === 8 && /^[67]/.test(d)) d = `241${d}`;
  return d;
}

async function isUserExempt(userId) {
  const { data } = await supabase.from('profiles').select('exempt').eq('id', userId).maybeSingle();
  return Boolean(data?.exempt);
}

/** Compte payé avec un accès encore valide (pas un ancien paiement expiré). */
async function userHasPaidAccess(userId) {
  const { count, error } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'SUCCESS');
  if (error) {
    console.error('[trial-phone] payments:', error.message);
    return false;
  }
  if (!(count > 0)) return false;

  const { data: subs, error: subErr } = await supabase
    .from('subscriptions')
    .select('status, is_trial, ends_at')
    .eq('user_id', userId);
  if (subErr) {
    console.error('[trial-phone] subs:', subErr.message);
    return false;
  }
  const now = Date.now();
  return (subs || []).some(
    (s) =>
      s.status === 'active' &&
      !s.is_trial &&
      s.ends_at &&
      new Date(s.ends_at).getTime() > now
  );
}

async function getClaim(phone) {
  const key = normalizeWaPhone(phone);
  if (!key) return null;
  const { data, error } = await supabase
    .from('whatsapp_trial_phones')
    .select('*')
    .eq('phone', key)
    .maybeSingle();
  if (error) {
    console.error('[trial-phone] read:', error.message);
    return null;
  }
  return data;
}

async function registerClaim(phone, userId, botId) {
  const key = normalizeWaPhone(phone);
  if (!key || !userId) return;
  const now = new Date().toISOString();
  const { data: existing } = await supabase.from('whatsapp_trial_phones').select('phone, user_id').eq('phone', key).maybeSingle();
  if (existing) {
    const patch = { updated_at: now, user_id: userId };
    if (botId != null) patch.first_bot_id = botId;
    await supabase.from('whatsapp_trial_phones').update(patch).eq('phone', key);
    return;
  }
  const { error } = await supabase.from('whatsapp_trial_phones').insert({
    phone: key,
    user_id: userId,
    first_bot_id: botId ?? null,
    trial_started_at: now,
    updated_at: now,
  });
  if (error && error.code !== '23505') {
    console.error('[trial-phone] insert:', error.message);
  }
}

async function checkPhoneForUser(phoneRaw, userId, { onLink = false, botId = null } = {}) {
  const key = normalizeWaPhone(phoneRaw);
  if (!key) return { allowed: true };

  const claim = await getClaim(key);
  if (claim && claim.user_id !== userId) {
    if (await userHasPaidAccess(userId)) {
      if (onLink) {
        console.log(`[trial-phone] transfert ${key} → user ${userId} (payé)`);
        await registerClaim(key, userId, botId);
      }
      return { allowed: true };
    }
    return { allowed: false, message: BLOCK_MSG };
  }

  if (onLink) {
    await registerClaim(key, userId, botId);
  }
  return { allowed: true };
}

/** Avant demande de code pairing — refus si le numéro appartient à un autre compte sans paiement. */
async function assertPairingAllowed(phoneRaw, userId) {
  if (await isUserExempt(userId)) return { allowed: true };
  const key = normalizeWaPhone(phoneRaw);
  if (!key) {
    const err = new Error('Numéro invalide.');
    err.status = 400;
    throw err;
  }
  const result = await checkPhoneForUser(key, userId, { onLink: false });
  if (!result.allowed) {
    const err = new Error(result.message);
    err.status = 403;
    err.code = 'trial_phone_taken';
    throw err;
  }
  return { allowed: true };
}

async function expireBotTrialSubscription(bot) {
  if (!bot?.subscription_id) return;
  await supabase
    .from('subscriptions')
    .update({
      status: 'expired',
      is_trial: false,
      ends_at: new Date().toISOString(),
      billing_notices: {},
    })
    .eq('id', bot.subscription_id);
}

/**
 * À l’ouverture de session WhatsApp : enregistre le numéro ou bloque un 2ᵉ compte non payé.
 * @returns {{ allowed: boolean, message?: string }}
 */
async function assertLinkAllowed(botId, phoneRaw) {
  const phone = normalizeWaPhone(phoneRaw);
  if (!phone) return { allowed: true };

  const { data: bot } = await supabase
    .from('bots')
    .select('id, user_id, subscription_id, session_key, plan_code')
    .eq('id', botId)
    .maybeSingle();
  if (!bot) return { allowed: true };

  if (await isUserExempt(bot.user_id)) {
    await registerClaim(phone, bot.user_id, bot.id);
    return { allowed: true };
  }

  const result = await checkPhoneForUser(phone, bot.user_id, { onLink: true, botId: bot.id });
  if (!result.allowed) {
    console.warn(
      `[trial-phone] blocage bot=${botId} user=${bot.user_id} phone=${phone}`
    );
    await expireBotTrialSubscription(bot);
    return { allowed: false, message: result.message };
  }

  return { allowed: true };
}

async function releaseUserPhones(userId) {
  if (!userId) return;
  const { error } = await supabase.from('whatsapp_trial_phones').delete().eq('user_id', userId);
  if (error) console.error('[trial-phone] release:', error.message);
}
async function seedFromExistingBots() {
  const { data: bots, error } = await supabase
    .from('bots')
    .select('id, user_id, phone_number, created_at')
    .not('phone_number', 'is', null)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[trial-phone] seed:', error.message);
    return;
  }
  for (const bot of bots || []) {
    const key = normalizeWaPhone(bot.phone_number);
    if (!key) continue;
    const claim = await getClaim(key);
    if (!claim) {
      await registerClaim(key, bot.user_id, bot.id);
    }
  }
}

module.exports = {
  normalizeWaPhone,
  assertPairingAllowed,
  assertLinkAllowed,
  registerClaim,
  seedFromExistingBots,
  releaseUserPhones,
  userHasPaidAccess,
  BLOCK_MSG,
};
