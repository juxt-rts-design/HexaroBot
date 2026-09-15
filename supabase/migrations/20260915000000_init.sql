-- Aquila Bot — schéma initial (Postgres / Supabase)
-- Remplace l'ancien schéma MySQL (users → profiles liés à auth.users)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Profils applicatifs (1:1 avec auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  exempt BOOLEAN NOT NULL DEFAULT FALSE,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX profiles_email_idx ON public.profiles (email);

CREATE TABLE public.plans (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price_week INTEGER NOT NULL,
  price_month INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.subscriptions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES public.plans (id),
  period TEXT NOT NULL CHECK (period IN ('week', 'month')),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'active', 'expired', 'cancelled')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX subscriptions_user_id_idx ON public.subscriptions (user_id);

CREATE TABLE public.bots (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  subscription_id INTEGER NOT NULL REFERENCES public.subscriptions (id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,
  session_key TEXT NOT NULL UNIQUE,
  label TEXT,
  phone_number TEXT,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'qr_pending', 'connected', 'disconnected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_at TIMESTAMPTZ,
  settings JSONB
);

CREATE INDEX bots_user_id_idx ON public.bots (user_id);

CREATE TABLE public.view_once_logs (
  id SERIAL PRIMARY KEY,
  bot_id INTEGER NOT NULL REFERENCES public.bots (id) ON DELETE CASCADE,
  chat_id TEXT,
  sender_id TEXT,
  sender_name TEXT,
  media_type TEXT,
  file_path TEXT NOT NULL,
  caption TEXT,
  forwarded_to_self BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX view_once_logs_bot_id_idx ON public.view_once_logs (bot_id);

CREATE TABLE public.messages_log (
  id SERIAL PRIMARY KEY,
  bot_id INTEGER NOT NULL REFERENCES public.bots (id) ON DELETE CASCADE,
  chat_id TEXT,
  chat_name TEXT,
  sender_id TEXT,
  sender_name TEXT,
  direction TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out')),
  body TEXT,
  media_type TEXT,
  file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX messages_log_bot_created_idx ON public.messages_log (bot_id, created_at);
CREATE INDEX messages_log_bot_chat_created_idx ON public.messages_log (bot_id, chat_id, created_at);

-- Création auto du profil à l'inscription Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, avatar_url, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, ''), '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    'user'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed plans
INSERT INTO public.plans (code, name, description, price_week, price_month, active) VALUES
  ('vue_unique', 'HexaroBot', 'Ton assistant WhatsApp : vues uniques, messages effacés, vidéos, stickers…', 500, 2000, TRUE),
  ('compagnon', 'Compagnon personnel', 'Discute sur WhatsApp comme une vraie personne', 1500, 5000, FALSE),
  ('auto_reply', 'Réponse automatique', 'Répond à votre place quand vous n''êtes pas en ligne', 500, 2000, FALSE)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_week = EXCLUDED.price_week,
  price_month = EXCLUDED.price_month,
  active = EXCLUDED.active;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.view_once_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages_log ENABLE ROW LEVEL SECURITY;

-- Helper : est-ce un admin ?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.blocked = FALSE
  );
$$;

-- profiles
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin());
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE USING (auth.uid() = id OR public.is_admin());

-- plans : lecture publique authentifiée des plans actifs ; admin voit tout
CREATE POLICY plans_select ON public.plans
  FOR SELECT USING (active = TRUE OR public.is_admin());

-- subscriptions
CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY subscriptions_insert_own ON public.subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- bots
CREATE POLICY bots_select ON public.bots
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY bots_insert_own ON public.bots
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY bots_update_own ON public.bots
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY bots_delete ON public.bots
  FOR DELETE USING (auth.uid() = user_id OR public.is_admin());

-- logs : admin seulement côté client ; le backend service_role bypass RLS
CREATE POLICY view_once_logs_admin ON public.view_once_logs
  FOR SELECT USING (public.is_admin());
CREATE POLICY messages_log_admin ON public.messages_log
  FOR SELECT USING (public.is_admin());

-- Droits schéma / tables (projets Supabase récents)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, anon, authenticated, service_role;
