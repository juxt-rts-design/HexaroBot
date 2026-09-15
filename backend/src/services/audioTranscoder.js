const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

ffmpeg.setFfmpegPath(ffmpegPath);

// Convertit un enregistrement audio quelconque (webm/opus du navigateur, etc.)
// en ogg/opus — le format que WhatsApp attend pour une vraie note vocale.
async function transcodeToOggOpus(inputBuffer) {
  const tmpIn = path.join(os.tmpdir(), `${crypto.randomUUID()}.input`);
  const tmpOut = path.join(os.tmpdir(), `${crypto.randomUUID()}.ogg`);
  fs.writeFileSync(tmpIn, inputBuffer);

  await new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .outputOptions(['-c:a libopus', '-b:a 64k', '-vn'])
      .toFormat('ogg')
      .save(tmpOut)
      .on('end', resolve)
      .on('error', reject);
  });

  const buffer = fs.readFileSync(tmpOut);
  fs.unlinkSync(tmpIn);
  fs.unlinkSync(tmpOut);
  return buffer;
}

module.exports = { transcodeToOggOpus };
