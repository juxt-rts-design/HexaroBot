-- Affichage plan / bots : HexaroBot à la place de « Vue unique »
UPDATE public.plans
SET
  name = 'HexaroBot',
  description = 'Ton assistant WhatsApp : vues uniques, messages effacés, vidéos, stickers…'
WHERE code = 'vue_unique';

UPDATE public.bots
SET label = 'HexaroBot'
WHERE plan_code = 'vue_unique'
  AND (label IS NULL OR label IN ('vue_unique', 'Vue unique'));
