/** Lien WhatsApp pour joindre l’admin HEXARO. */
export const ADMIN_WHATSAPP_URL = 'https://wa.me/qr/ZAEWL4Z7AMJZL1';

export function displayPlanName(plan) {
  if (!plan) return 'HexaroBot';
  if (plan.code === 'vue_unique' || /vue.?unique/i.test(plan.name || '')) return 'HexaroBot';
  return plan.name;
}

export function displayBotLabel(bot) {
  if (!bot) return 'HexaroBot';
  if (
    bot.plan_code === 'vue_unique' ||
    bot.label === 'vue_unique' ||
    /vue.?unique/i.test(bot.label || '')
  ) {
    return 'HexaroBot';
  }
  return bot.label || 'HexaroBot';
}

export function displayPlanDescription(plan) {
  if (!plan) return '';
  if (plan.code === 'vue_unique' || /vue.?unique/i.test(plan.name || '')) {
    return 'Ton assistant WhatsApp : vues uniques, messages effacés, vidéos, stickers…';
  }
  return plan.description || '';
}
