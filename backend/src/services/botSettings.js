const { supabase } = require('../config/supabase');

const DEFAULTS = {
  vue_unique: {},
  compagnon: {
    reactions_enabled: true,
  },
  auto_reply: {},
};

const cache = new Map();

async function getSettings(botId, planCode) {
  if (cache.has(botId)) return cache.get(botId);
  const { data, error } = await supabase.from('bots').select('settings, plan_code').eq('id', botId).maybeSingle();
  if (error) throw error;
  const code = planCode || data?.plan_code || 'vue_unique';
  const merged = { ...(DEFAULTS[code] || {}), ...(data?.settings || {}) };
  cache.set(botId, merged);
  return merged;
}

async function updateSettings(botId, updates) {
  const { data, error } = await supabase.from('bots').select('settings, plan_code').eq('id', botId).maybeSingle();
  if (error) throw error;
  const merged = { ...(DEFAULTS[data?.plan_code] || {}), ...(data?.settings || {}), ...updates };
  const { error: upErr } = await supabase.from('bots').update({ settings: merged }).eq('id', botId);
  if (upErr) throw upErr;
  cache.set(botId, merged);
  return merged;
}

function clearCache(botId) {
  cache.delete(botId);
}

module.exports = { getSettings, updateSettings, clearCache, DEFAULTS };
