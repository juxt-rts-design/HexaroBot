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

/** Toutes les formes possibles d’un même numéro (QR, pairing, base). */
function phoneKeys(raw) {
  const n = normalizeWaPhone(raw);
  const digits = String(raw || '').replace(/\D/g, '');
  const keys = new Set();
  if (n) keys.add(n);
  if (digits) keys.add(digits);
  if (n.startsWith('241') && n.length >= 11) {
    const local = n.slice(3);
    keys.add(local);
    keys.add(`0${local}`);
    keys.add(`2410${local}`);
  }
  return [...keys].filter(Boolean);
}

async function getClaim(phone) {
  const keys = phoneKeys(phone);
  if (!keys.length) return null;
  const { data, error } = await supabase
    .from('whatsapp_trial_phones')
    .select('*')
    .in('phone', keys)
    .limit(1);
  if (error) {
    console.error('[trial-phone] read:', error.message);
    return null;
  }
  return data?.[0] || null;
}

async function deleteClaimsByPhones(phones) {
  const keys = [...new Set((phones || []).flatMap((p) => phoneKeys(p)))];
  if (!keys.length) return;
  const { error } = await supabase.from('whatsapp_trial_phones').delete().in('phone', keys);
  if (error) console.error('[trial-phone] delete phones:', error.message);
}

/** true si un autre compte a encore ce numéro sur un bot. */
async function isClaimStillHeld(claim, key) {
  if (!claim?.user_id) return false;
  const { data: profile } = await supabase.from('profiles').select('id').eq('id', claim.user_id).maybeSingle();
  if (!profile) return false;
  const { data: bots } = await supabase
    .from('bots')
    .select('phone_number')
    .eq('user_id', claim.user_id);
  return (bots || []).some((b) => phoneKeys(b.phone_number).includes(key) || normalizeWaPhone(b.phone_number) === key);
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
    const stillHeld = await isClaimStillHeld(claim, key);
    if (!stillHeld) {
      await deleteClaimsByPhones([key, claim.phone]);
    } else if (await userHasPaidAccess(userId)) {
      if (onLink) {
        console.log(`[trial-phone] transfert ${key} → user ${userId} (payé)`);
        await registerClaim(key, userId, botId);
      }
      return { allowed: true };
    } else {
      return { allowed: false, message: BLOCK_MSG };
    }
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

async function releaseUserPhones(userId, extraPhones = []) {
  if (!userId) return;
  const { data: claims } = await supabase.from('whatsapp_trial_phones').select('phone').eq('user_id', userId);
  const { data: bots } = await supabase.from('bots').select('phone_number').eq('user_id', userId);
  const phones = [
    ...extraPhones,
    ...(claims || []).map((c) => c.phone),
    ...(bots || []).map((b) => b.phone_number),
  ];
  const { error } = await supabase.from('whatsapp_trial_phones').delete().eq('user_id', userId);
  if (error) console.error('[trial-phone] release user:', error.message);
  await deleteClaimsByPhones(phones);
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
  deleteClaimsByPhones,
  userHasPaidAccess,
  BLOCK_MSG,
};
