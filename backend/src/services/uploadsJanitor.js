const fs = require('fs');
const path = require('path');
const { persistChatMedia, persistViewOnceArchive, uploadsMaxAgeDays } = require('./mediaStorage');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const INTERVAL_MS = 24 * 60 * 60 * 1000;

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) walkFiles(p, out);
      else out.push({ path: p, mtime: st.mtimeMs, size: st.size });
    } catch { /* ignore */ }
  }
  return out;
}

function pruneDir(dir, maxAgeMs) {
  if (!fs.existsSync(dir)) return { removed: 0, freed: 0 };
  let removed = 0;
  let freed = 0;
  const now = Date.now();
  for (const f of walkFiles(dir)) {
    if (now - f.mtime <= maxAgeMs) continue;
    try {
      fs.unlinkSync(f.path);
      removed += 1;
      freed += f.size;
    } catch { /* ignore */ }
  }
  return { removed, freed };
}

function runJanitor() {
  const maxAgeMs = uploadsMaxAgeDays() * 86400000;
  const chat = persistChatMedia()
    ? pruneDir(path.join(UPLOADS_ROOT, 'chat'), maxAgeMs)
    : { removed: 0, freed: 0 };
  const vo = persistViewOnceArchive()
    ? pruneDir(path.join(UPLOADS_ROOT, 'viewonce'), maxAgeMs)
    : { removed: 0, freed: 0 };
  const mb = ((chat.freed + vo.freed) / 1024 / 1024).toFixed(1);
  if (chat.removed + vo.removed > 0) {
    console.log(`[uploads] nettoyage : ${chat.removed + vo.removed} fichiers, ~${mb} Mo libérés`);
  }
}

function startUploadsJanitor() {
  const chat = persistChatMedia();
  const vo = persistViewOnceArchive();
  console.log(
    `[uploads] chat disque=${chat ? 'oui' : 'non'} · viewonce archive=${vo ? 'oui' : 'non'} · rétention=${uploadsMaxAgeDays()}j`
  );
  runJanitor();
  setInterval(runJanitor, INTERVAL_MS).unref?.();
}

module.exports = { startUploadsJanitor, runJanitor };
