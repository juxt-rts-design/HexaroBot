const { supabase } = require('../config/supabase');

/** Incrémenter pour redemander l’acceptation à tous. */
const TERMS_VERSION = '1';

const TERMS_TITLE = 'Conditions d’utilisation HexaroBot';

function termsBodyLines() {
  return [
    'En activant HexaroBot, tu confirmes avoir lu et accepté ce qui suit.',
    '',
    '1. Vie privée',
    'HexaroBot accède à ton compte WhatsApp lié uniquement pour fournir les fonctions que tu actives (messages, médias, statuts selon ton offre).',
    'Nous ne vendons pas tes données. Les accès admin sont strictement limités au support et à la modération prévue par le service.',
    '',
    '2. Conversations et contenus',
    'Les messages et médias traités par le bot le sont pour ton usage personnel. Tu restes responsable du contenu envoyé ou reçu via ton numéro.',
    'Ne partage pas de contenus illégaux, de harcèlement ou de données sensibles de tiers sans leur accord.',
    'Certaines fonctions peuvent conserver temporairement des métadonnées ou caches en mémoire ; les fichiers médias ne sont pas conservés sur le serveur sauf configuration explicite.',
    '',
    '3. Essai et abonnement',
    'L’essai gratuit est limité dans le temps. Un même numéro WhatsApp ne peut pas être utilisé pour multiplier les essais sur plusieurs comptes.',
    'Après l’essai, l’accès continue uniquement si l’abonnement est payé.',
    '',
    '4. Sécurité',
    'Garde ton mot de passe secret. Déconnecte le bot si tu changes de téléphone ou si tu ne fais plus confiance à un appareil lié.',
    '',
    'En cliquant « J’accepte », tu autorises HexaroBot à fonctionner sur ton WhatsApp lié dans ce cadre.',
  ];
}

async function getProfileTerms(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('exempt, role, terms_accepted_at, terms_version')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[terms] lecture profil:', error.message);
    return { terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION };
  }
  return data;
}

function isAccepted(profile) {
  if (profile?.exempt || profile?.role === 'admin') return true;
  if (!profile?.terms_accepted_at) return false;
  return profile.terms_version === TERMS_VERSION;
}

async function needsAcceptance(userId) {
  const profile = await getProfileTerms(userId);
  return !isAccepted(profile);
}

async function acceptTerms(userId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('profiles')
    .update({
      terms_accepted_at: now,
      terms_version: TERMS_VERSION,
    })
    .eq('id', userId)
    .select('terms_accepted_at, terms_version')
    .single();
  if (error) throw error;
  return data;
}

function publicTermsPayload(profile) {
  const accepted = isAccepted(profile);
  return {
    version: TERMS_VERSION,
    title: TERMS_TITLE,
    accepted,
    accepted_at: accepted ? profile?.terms_accepted_at : null,
    required: !accepted,
    sections: termsBodyLines(),
  };
}

module.exports = {
  TERMS_VERSION,
  TERMS_TITLE,
  termsBodyLines,
  needsAcceptance,
  acceptTerms,
  isAccepted,
  publicTermsPayload,
};
