/**
 * Téléchargement de liens TikTok / Instagram / YouTube / etc.
 * Message « Téléchargement en cours... » puis média sans légende.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const {
  sanitizeMediaUrl,
  isSiteDownloadPlatform,
  downloadSiteMediaToFile,
} = require('./siteMediaDownloader');

const TEMP_DIR = path.join(os.tmpdir(), 'hexaro-media');

const videoJobCooldown = new Map();
const VIDEO_JOB_COOLDOWN_MS = 3 * 60 * 1000;

function detectVideoLink(message) {
  const videoPatterns = [
    /(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook\.com\/|fb\.watch\/|fb\.com\/)/i,
    /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/|youtu\.be\/)/i,
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|reels|tv|share)\//i,
    /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com\/|vm\.tiktok\.com\/|vt\.tiktok\.com\/)/i,
    /(?:https?:\/\/)?(?:www\.)?(?:pinterest\.(?:com|fr)\/pin\/|pin\.it\/)/i,
    /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com\/|x\.com\/).*(?:status|statuses)\//i,
    /(?:https?:\/\/)?(?:www\.)?(?:vimeo\.com\/)/i,
    /(?:https?:\/\/)?(?:www\.)?(?:dailymotion\.com\/video\/)/i,
  ];
  return videoPatterns.some((pattern) => pattern.test(message));
}

function isBareVideoLinkOnly(text) {
  const t = String(text || '').trim();
  if (!t || !detectVideoLink(t)) return false;
  const urls = t.match(/https?:\/\/[^\s]+/gi) || [];
  if (urls.length !== 1) return false;
  const rest = t.replace(urls[0], '').replace(/[\s*_\-~|.]+/g, '');
  return rest.length === 0;
}

function extractVideoUrl(message) {
  const urls = String(message || '').match(/https?:\/\/[^\s]+/gi);
  return urls ? sanitizeMediaUrl(urls[0]) : null;
}

function videoJobKey(url) {
  return String(url || '').trim().split('?')[0].toLowerCase();
}

function beginVideoJob(url) {
  const key = videoJobKey(url);
  const now = Date.now();
  const prev = videoJobCooldown.get(key);
  if (prev && now - prev.ts < VIDEO_JOB_COOLDOWN_MS) return false;
  videoJobCooldown.set(key, { ts: now });
  return true;
}

function endVideoJob(url) {
  const key = videoJobKey(url);
  videoJobCooldown.set(key, { ts: Date.now() });
  if (videoJobCooldown.size > 200) {
    for (const [k, v] of videoJobCooldown) {
      if (Date.now() - v.ts > VIDEO_JOB_COOLDOWN_MS) videoJobCooldown.delete(k);
    }
  }
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore */ }
}

function ensureTempDir() {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function downloadTikTokToFile(url, outputPath) {
  const { data } = await axios.post(
    'https://tikwm.com/api/',
    { url },
    {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    }
  );
  if (data?.code !== 0 || !data?.data) {
    throw new Error(data?.msg || 'API TikTok échec');
  }
  const videoUrl = data.data.hdplay || data.data.play || data.data.wmplay;
  if (!videoUrl) throw new Error('Aucune URL vidéo TikTok');
  const videoResponse = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://tikwm.com/',
    },
  });
  fs.writeFileSync(outputPath, Buffer.from(videoResponse.data));
  return { path: outputPath, isImage: false };
}

async function downloadMediaFromUrl(url) {
  ensureTempDir();
  const cleanUrl = sanitizeMediaUrl(url);
  const outputPath = path.join(TEMP_DIR, `media_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp4`);

  if (
    cleanUrl.includes('tiktok.com') ||
    cleanUrl.includes('vm.tiktok.com') ||
    cleanUrl.includes('vt.tiktok.com')
  ) {
    return downloadTikTokToFile(cleanUrl, outputPath);
  }

  if (isSiteDownloadPlatform(cleanUrl)) {
    return downloadSiteMediaToFile(cleanUrl, outputPath);
  }

  throw new Error('Plateforme non supportée');
}

async function sendSilentMedia(sock, jid, result) {
  if (!result?.path || !fs.existsSync(result.path) || fs.statSync(result.path).size < 512) {
    throw new Error('Fichier média invalide');
  }
  const sizeMb = fs.statSync(result.path).size / (1024 * 1024);
  if (sizeMb > 64) {
    safeUnlink(result.path);
    throw new Error('Fichier trop lourd');
  }
  const mediaBuffer = fs.readFileSync(result.path);
  if (result.isImage) {
    await sock.sendMessage(jid, { image: mediaBuffer });
  } else {
    await sock.sendMessage(jid, { video: mediaBuffer });
  }
  safeUnlink(result.path);
}

/**
 * Si le message contient un lien supporté, télécharge et renvoie le média
 * (sans légende). Retourne true si un job a été lancé.
 */
function tryHandleMediaLink(sock, msg, messageText) {
  if (!messageText?.trim() || !detectVideoLink(messageText)) return false;

  const fromMe = Boolean(msg.key?.fromMe);
  if (fromMe && !isBareVideoLinkOnly(messageText)) return false;

  const videoUrl = extractVideoUrl(messageText);
  if (!videoUrl || !beginVideoJob(videoUrl)) return false;

  const jid = msg.key.remoteJid;
  (async () => {
    try {
      await sock.sendMessage(jid, { text: 'Téléchargement en cours...' });
      const result = await downloadMediaFromUrl(videoUrl);
      await sendSilentMedia(sock, jid, result);
    } catch (err) {
      console.error('DL média:', err.message);
      try {
        await sock.sendMessage(jid, {
          text: "Impossible d'obtenir le média à partir de la ressource.",
        });
      } catch { /* ignore */ }
    } finally {
      endVideoJob(videoUrl);
    }
  })();

  return true;
}

module.exports = {
  detectVideoLink,
  extractVideoUrl,
  tryHandleMediaLink,
};
