const { supabase } = require('../config/supabase');

exports.listPlans = async (req, res) => {
  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, code, name, description, price_week, price_month')
    .eq('active', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ plans: plans || [] });
};

exports.createSubscription = async (req, res) => {
  const { planId, period } = req.body;
  if (!['week', 'month'].includes(period)) {
    return res.status(400).json({ error: 'Période invalide.' });
  }
  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('*')
    .eq('id', planId)
    .eq('active', true)
    .maybeSingle();
  if (planErr) return res.status(500).json({ error: planErr.message });
  if (!plan) return res.status(404).json({ error: 'Offre introuvable.' });
  const amount = period === 'week' ? plan.price_week : plan.price_month;

  const { data: sub, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: req.user.id,
      plan_id: plan.id,
      period,
      amount,
      status: 'pending_payment',
    })
    .select('id, plan_id, period, amount, status')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ subscription: sub });
};

exports.listMySubscriptions = async (req, res) => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, plans(code, name)')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const subscriptions = (data || []).map((s) => ({
    ...s,
    plan_code: s.plans?.code,
    plan_name: s.plans?.name,
    plans: undefined,
  }));
  res.json({ subscriptions });
};
