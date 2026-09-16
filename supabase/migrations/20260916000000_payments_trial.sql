-- Paiement Mobile Money + essai 3 jours

UPDATE public.plans
SET price_month = 2100,
    description = 'Essai 3 jours puis 2100 FCFA/mois — vues uniques, messages effacés, vidéos, stickers…'
WHERE code = 'vue_unique';

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS billing_notices JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.bots DROP CONSTRAINT IF EXISTS bots_status_check;
ALTER TABLE public.bots
  ADD CONSTRAINT bots_status_check
  CHECK (status IN ('created', 'qr_pending', 'connected', 'disconnected', 'suspended'));

CREATE TABLE IF NOT EXISTS public.payments (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES public.subscriptions (id) ON DELETE SET NULL,
  bot_id INTEGER REFERENCES public.bots (id) ON DELETE SET NULL,
  reference TEXT NOT NULL,
  operator_code TEXT NOT NULL
    CHECK (operator_code IN ('AIRTEL_MONEY', 'MOOV_MONEY')),
  msisdn TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 2100,
  currency TEXT NOT NULL DEFAULT 'XAF',
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  darepay_payment_id TEXT,
  transaction_id TEXT,
  failure_reason TEXT,
  callback_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_reference_len CHECK (char_length(reference) <= 10)
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_reference_uidx ON public.payments (reference);
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON public.payments (status);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select_own ON public.payments;
CREATE POLICY payments_select_own ON public.payments
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.payments_id_seq TO service_role;
GRANT SELECT ON public.payments TO authenticated;
