const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { MessageMedia } = require('whatsapp-web.js');

ffmpeg.setFfmpegPath(ffmpegPath);

// Convertit un média (image ou vidéo courte) en sticker webp 512x512, porté de
// aquila V7 components/stickerConverter.js (qui shellait ffmpeg directement).
async function mediaToStickerMedia(media) {
  const ext = media.mimetype.includes('video') || media.mimetype.includes('gif') ? 'mp4' : 'png';
  const tmpIn = path.join(os.tmpdir(), `${crypto.randomUUID()}.${ext}`);
  const tmpOut = path.join(os.tmpdir(), `${crypto.randomUUID()}.webp`);
  fs.writeFileSync(tmpIn, Buffer.from(media.data, 'base64'));

  await new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .outputOptions([
        '-vcodec libwebp',
        '-vf scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=white@0.0,format=rgba',
        '-loop 0',
        '-preset default',
        '-an',
        '-vsync 0',
      ])
      .toFormat('webp')
      .save(tmpOut)
      .on('end', resolve)
      .on('error', reject);
  });

  const webpBase64 = fs.readFileSync(tmpOut).toString('base64');
  fs.unlinkSync(tmpIn);
  fs.unlinkSync(tmpOut);
  return new MessageMedia('image/webp', webpBase64, 'sticker.webp');
}

/** Buffer image/vidéo → WebP sticker (Baileys). */
async function bufferToStickerWebp(buffer, isVideo = false) {
  const ext = isVideo ? 'mp4' : 'png';
  const tmpIn = path.join(os.tmpdir(), `${crypto.randomUUID()}.${ext}`);
  const tmpOut = path.join(os.tmpdir(), `${crypto.randomUUID()}.webp`);
  fs.writeFileSync(tmpIn, buffer);

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(tmpIn)
        .outputOptions(
          isVideo
            ? [
                '-vcodec libwebp',
                '-vf scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15',
                '-loop 0',
                '-preset default',
                '-an',
                '-vsync 0',
                '-t 6',
              ]
            : [
                '-vcodec libwebp',
                '-vf scale=512:512:force_original_aspect_ratio=increase,crop=512:512',
                '-loop 0',
                '-preset default',
                '-an',
                '-vsync 0',
              ]
        )
        .toFormat('webp')
        .save(tmpOut)
        .on('end', resolve)
        .on('error', reject);
    });
    return fs.readFileSync(tmpOut);
  } finally {
    try { fs.unlinkSync(tmpIn); } catch { /* ignore */ }
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch { /* ignore */ }
  }
}

module.exports = { mediaToStickerMedia, bufferToStickerWebp };
