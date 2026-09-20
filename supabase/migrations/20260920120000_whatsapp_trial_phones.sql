-- Un numéro WhatsApp ne peut lier l'essai gratuit qu'à un seul compte Hexaro.
CREATE TABLE IF NOT EXISTS public.whatsapp_trial_phones (
  phone TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  first_bot_id INTEGER REFERENCES public.bots (id) ON DELETE SET NULL,
  trial_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_trial_phones_user_id_idx ON public.whatsapp_trial_phones (user_id);

ALTER TABLE public.whatsapp_trial_phones ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_trial_phones TO service_role;
