const { supabase } = require('../config/supabase');

const MAX_BODY_LENGTH = 2000;

/** Payload socket / API client : jamais exposer file_path. */
function sanitizeChatMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    chat_id: row.chat_id,
    chat_name: row.chat_name,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    direction: row.direction,
    body: row.body,
    media_type: row.media_type,
    has_media: Boolean(row.file_path || row.has_media),
    created_at: row.created_at,
  };
}

async function logMessage({ botId, chatId, chatName, senderId, senderName, direction = 'in', body, mediaType, filePath }) {
  const truncated = body ? String(body).slice(0, MAX_BODY_LENGTH) : null;
  const { data, error } = await supabase
    .from('messages_log')
    .insert({
      bot_id: botId,
      chat_id: chatId || null,
      chat_name: chatName || null,
      sender_id: senderId || null,
      sender_name: senderName || null,
      direction,
      body: truncated,
      media_type: mediaType || null,
      file_path: filePath || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return sanitizeChatMessage(data);
}

module.exports = { logMessage, sanitizeChatMessage };
