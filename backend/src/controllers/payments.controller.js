const { supabase } = require('../config/supabase');
const { darepayFetch, extractPayment } = require('../services/darepay');
const billing = require('../services/billing');

const OPERATORS = new Set(['AIRTEL_MONEY', 'MOOV_MONEY']);

function normalizeMsisdn(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('241') && d.length >= 11) d = d.slice(3);
  if (d.length === 8) d = `0${d}`;
  return d;
}

async function subscriptionAccessForBot(userId, botId) {
  if (!botId) return null;
  try {
    const snapshot = await billing.getBillingSnapshot(userId);
    return snapshot.bots.find((b) => b.id === botId)?.subscription || null;
  } catch {
    return null;
  }
}

exports.getBillingMe = async (req, res) => {
  try {
    const snapshot = await billing.getBillingSnapshot(req.user.id);
    res.json(snapshot);
  } catch (err) {
    console.error('billing.me:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.createPayment = async (req, res) => {
  try {
    if (req.user.exempt) {
      return res.status(400).json({ error: 'Ton compte est exempté — pas besoin de payer.' });
    }

    const operator_code = String(req.body?.operator_code || '').toUpperCase();
    const msisdn = normalizeMsisdn(req.body?.customer_msisdn || req.body?.msisdn);
    let botId = req.body?.bot_id ? Number(req.body.bot_id) : null;

    if (!OPERATORS.has(operator_code)) {
      return res.status(400).json({
        error: 'Choisis Airtel Money ou MoBiCash.',
      });
    }
    if (!msisdn || msisdn.length < 8 || msisdn.length > 15) {
      return res.status(400).json({ error: 'Indique le numéro Mobile Money à débiter.' });
    }
    if (operator_code === 'MOOV_MONEY' && msisdn.startsWith('07')) {
      return res.status(400).json({
        error: 'Pour MoBiCash, utilise un numéro Libertis (ex. 065255797).',
      });
    }
    if (operator_code === 'AIRTEL_MONEY' && msisdn.startsWith('06')) {
      return res.status(400).json({
        error: 'Pour Airtel Money, utilise un numéro Airtel (ex. 074000000).',
      });
    }

    let botQuery = supabase
      .from('bots')
      .select('id, subscription_id, plan_code, status, session_key')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (botId) botQuery = botQuery.eq('id', botId);
    const { data: bots } = await botQuery.limit(1);
    const bot = bots?.[0];
    if (!bot) {
      return res.status(404).json({ error: 'Aucun bot à renouveler. Crée d’abord HexaroBot.' });
    }
    botId = bot.id;

    const amount = billing.priceXaf();
    const reference = billing.generateReference();
    const payload = {
      reference,
      amount,
      currency: 'XAF',
      customer_msisdn: msisdn,
      operator_code,
    };

    const { data: paymentRow, error: insertErr } = await supabase
      .from('payments')
      .insert({
        user_id: req.user.id,
        subscription_id: bot.subscription_id,
        bot_id: botId,
        reference,
        operator_code,
        msisdn,
        amount,
        currency: 'XAF',
        status: 'PENDING',
      })
      .select('*')
      .single();
    if (insertErr) {
      console.error('payments.insert:', insertErr.message);
      return res.status(500).json({ error: 'Impossible de créer le paiement.' });
    }

    const result = await darepayFetch('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const payment = extractPayment(result.body);

    const patch = {
      updated_at: new Date().toISOString(),
      darepay_payment_id: payment?.payment_id != null ? String(payment.payment_id) : null,
      transaction_id: payment?.transaction_id || null,
      status: payment?.status === 'FAILED' ? 'FAILED' : 'PENDING',
      failure_reason:
        result.body?.success === false
          ? result.body?.message || 'Paiement non initié'
          : null,
    };
    await supabase.from('payments').update(patch).eq('id', paymentRow.id);

    if (!result.ok || result.body?.success === false) {
      let message = result.body?.message || 'Paiement non initié. Réessaie dans un instant.';
      if (operator_code === 'MOOV_MONEY' && /gateway|http/i.test(message)) {
        message =
          'MoBiCash est indisponible côté opérateur pour le moment. Essaie Airtel Money.';
      }
      return res.status(result.status >= 400 ? result.status : 502).json({
        success: false,
        error: message,
        reference,
      });
    }

    res.status(200).json({
      success: true,
      payment: {
        reference,
        amount,
        currency: 'XAF',
        status: payment?.status || 'PENDING',
        operator_code,
        transaction_id: payment?.transaction_id || null,
      },
    });
  } catch (err) {
    console.error('payments.create:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

exports.getPaymentStatus = async (req, res) => {
  try {
    const reference = String(req.params.reference || '');
    const { data: row } = await supabase
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (!row) return res.status(404).json({ error: 'Paiement introuvable.' });

    if (row.status === 'SUCCESS' || row.status === 'FAILED') {
      const access = row.status === 'SUCCESS'
        ? await subscriptionAccessForBot(req.user.id, row.bot_id)
        : null;
      return res.json({
        success: true,
        payment: {
          reference: row.reference,
          amount: row.amount,
          currency: row.currency,
          status: row.status,
          operator_code: row.operator_code,
          transaction_id: row.transaction_id,
          failure_reason: row.failure_reason,
        },
        subscription: access,
      });
    }

    const result = await darepayFetch(`/payments/${encodeURIComponent(reference)}/status`);
    const payment = extractPayment(result.body);
    if (payment?.status && payment.status !== row.status) {
      const next = {
        status: payment.status,
        transaction_id: payment.transaction_id || row.transaction_id,
        darepay_payment_id:
          payment.payment_id != null ? String(payment.payment_id) : row.darepay_payment_id,
        updated_at: new Date().toISOString(),
      };
      await supabase.from('payments').update(next).eq('id', row.id);
      if (payment.status === 'SUCCESS') {
        await billing.applySuccessfulPayment({ ...row, ...next });
      }
      row.status = payment.status;
      row.transaction_id = next.transaction_id;
    }

    const access = row.status === 'SUCCESS'
      ? await subscriptionAccessForBot(req.user.id, row.bot_id)
      : null;

    res.status(result.status).json({
      success: result.ok,
      payment: {
        reference: row.reference,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        operator_code: row.operator_code,
        transaction_id: row.transaction_id,
      },
      subscription: access,
    });
  } catch (err) {
    console.error('payments.status:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
};

/** Callback DarePay / HexaPay — public, idempotent */
exports.hexapayCallback = async (req, res) => {
  const {
    payment_id,
    reference,
    transaction_id,
    status,
    amount,
    currency,
    failure_reason,
  } = req.body || {};

  const receivedAt = new Date().toISOString();

  try {
    if (!reference) {
      return res.status(200).json({ received: true, ignored: true, reason: 'no_reference' });
    }

    const { data: row } = await supabase
      .from('payments')
      .select('*')
      .eq('reference', String(reference))
      .maybeSingle();

    if (!row) {
      console.warn(`[hexapay] callback référence inconnue: ${reference}`);
      return res.status(200).json({ received: true, ignored: true, reason: 'unknown_reference' });
    }

    const expected = billing.priceXaf();
    const got = billing.parseAmount(amount);
    if (Number.isFinite(got) && got !== expected) {
      console.warn(`[hexapay] montant invalide ref=${reference} got=${got} expected=${expected}`);
      return res.status(200).json({ received: true, ignored: true, reason: 'bad_amount' });
    }

    const alreadyDone =
      row.status === 'SUCCESS' &&
      status === 'SUCCESS' &&
      row.transaction_id &&
      row.transaction_id === transaction_id;

    const payload = {
      payment_id,
      reference,
      transaction_id,
      status,
      amount,
      currency,
      failure_reason: failure_reason ?? null,
      receivedAt,
    };

    if (alreadyDone) {
      return res.status(200).json({ received: true, reference, transaction_id, duplicate: true });
    }

    const patch = {
      status: status === 'SUCCESS' || status === 'FAILED' ? status : row.status,
      transaction_id: transaction_id || row.transaction_id,
      darepay_payment_id: payment_id != null ? String(payment_id) : row.darepay_payment_id,
      failure_reason: failure_reason ?? row.failure_reason,
      callback_payload: payload,
      updated_at: receivedAt,
    };
    await supabase.from('payments').update(patch).eq('id', row.id);

    if (status === 'SUCCESS' && row.status !== 'SUCCESS') {
      await billing.applySuccessfulPayment({ ...row, ...patch });
    }

    return res.status(200).json({ received: true, reference, transaction_id });
  } catch (err) {
    console.error('hexapay.callback:', err.message);
    // Toujours 200 pour éviter les retries agressifs si déjà traité partiellement
    return res.status(200).json({ received: true, error: err.message });
  }
};
