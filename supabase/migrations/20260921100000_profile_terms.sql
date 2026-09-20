ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version TEXT;

-- Comptes déjà connectés avant cette mise à jour : considérés comme ayant accepté v1.
UPDATE public.profiles p
SET
  terms_accepted_at = COALESCE(p.terms_accepted_at, NOW()),
  terms_version = COALESCE(p.terms_version, '1')
WHERE EXISTS (
  SELECT 1 FROM public.bots b
  WHERE b.user_id = p.id
    AND (
      b.connected_at IS NOT NULL
      OR b.phone_number IS NOT NULL
      OR b.status = 'connected'
    )
);
