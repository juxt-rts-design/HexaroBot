require('dotenv').config({ override: true });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || serviceKey;

if (!url || !serviceKey) {
  throw new Error('Configure SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans backend/.env');
}

/** Client service_role — bypass RLS. À utiliser uniquement côté serveur. */
const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Client anon (vérif JWT utilisateur). */
const supabaseAnon = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = { supabase, supabaseAnon };
