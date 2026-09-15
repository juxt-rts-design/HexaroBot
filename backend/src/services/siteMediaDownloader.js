/**
 * Moteur DL multi-plateformes pour le bot (stack Hexaro).
 * Par défaut : UNIQUEMENT l’API site (DOWNLOADER_API_URL).
 * Fallbacks locaux (yt-dlp…) seulement si SITE_DOWNLOADER_LOCAL_FALLBACK=true.
 * TikTok hors scope (tikwm dans le bot).
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function getDownloaderApiUrl() {
    return String(process.env.DOWNLOADER_API_URL || '').replace(/\/$/, '');
}

function getCobaltUrl() {
    return String(process.env.COBALT_URL || 'http://127.0.0.1:9000').replace(/\/$/, '');
}

/** true uniquement si USE_COBALT_LOCAL=true — sinon on évite Cobalt (échecs FB). */
function useCobaltLocal() {
    return String(process.env.USE_COBALT_LOCAL || 'false').toLowerCase() === 'true';
}

const YTDLP_CANDIDATES = [
    process.env.YTDLP_PATH,
    path.join(__dirname, 'bin', 'yt-dlp'),
    path.join(__dirname, '..', 'tik-tok', 'Backend_tiktok', 'bin', 'yt-dlp'),
    path.join(__dirname, '..', '..', 'tik-tok', 'Backend_tiktok', 'bin', 'yt-dlp'),
    '/home/ubuntu/tik-tok/Backend_tiktok/bin/yt-dlp',
    '/home/hexaro/tik-tok/Backend_tiktok/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp'
].filter(Boolean);

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const PLATFORM_HOSTS = {
    youtube: ['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'],
    instagram: ['instagram.com'],
    facebook: ['facebook.com', 'fb.watch', 'fb.com', 'm.facebook.com'],
    pinterest: ['pinterest.com', 'pinterest.fr', 'pin.it'],
    twitter: ['twitter.com', 'x.com']
};

function sanitizeMediaUrl(raw) {
    const text = String(raw || '').trim();
    const parts = text.split(/(?=https?:\/\/)/i).filter(Boolean);
    if (parts.length > 1 && /^https?:\/\//i.test(parts[0])) {
        return parts[0].trim().replace(/[)\].,;]+$/, '');
    }
    return text.replace(/[)\].,;]+$/, '');
}

function detectPlatform(rawUrl) {
    try {
        const host = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
        for (const [name, hosts] of Object.entries(PLATFORM_HOSTS)) {
            if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return name;
        }
        return null;
    } catch {
        return null;
    }
}

function isSiteDownloadPlatform(rawUrl) {
    const platform = detectPlatform(sanitizeMediaUrl(rawUrl));
    return Boolean(platform && platform !== 'tiktok');
}

function resolveYtDlpBin() {
    for (const candidate of YTDLP_CANDIDATES) {
        if (candidate === 'yt-dlp') return candidate;
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** Cookies Netscape pour YouTube (anti « Sign in to confirm you’re not a bot »). */
function getYtDlpCookieArgs() {
    const cookieFile = String(process.env.YTDLP_COOKIES || process.env.COOKIES_FILE || '').trim();
    if (cookieFile && fs.existsSync(cookieFile)) {
        return ['--cookies', cookieFile];
    }
    const fromBrowser = String(process.env.YTDLP_COOKIES_FROM_BROWSER || '').trim();
    if (fromBrowser) {
        return ['--cookies-from-browser', fromBrowser];
    }
    return [];
}

function runYtDlp(args) {
    const bin = resolveYtDlpBin();
    if (!bin) {
        return Promise.reject(new Error('yt-dlp introuvable (YTDLP_PATH ou /usr/local/bin/yt-dlp)'));
    }
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('yt-dlp timeout (5 min)'));
        }, 5 * 60 * 1000);
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else {
                const msg = stderr.trim().split('\n').slice(-3).join(' ') || `yt-dlp exit ${code}`;
                if (/Sign in to confirm|not a bot|cookies/i.test(msg) && !getYtDlpCookieArgs().length) {
                    reject(new Error(`${msg} → configure YTDLP_COOKIES=/chemin/cookies.txt sur le VPS`));
                } else {
                    reject(new Error(msg));
                }
            }
        });
    });
}

async function downloadBuffer(url, headers = {}) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 180000,
        maxRedirects: 5,
        maxContentLength: 100 * 1024 * 1024,
        headers: {
            'User-Agent': UA,
            Accept: '*/*',
            ...headers
        },
        validateStatus: (s) => s >= 200 && s < 400
    });
    const buf = Buffer.from(res.data);
    if (!buf.length || buf.length < 512) {
        throw new Error('Fichier média vide ou trop petit');
    }
    return buf;
}

function writeOutput(outputPath, buffer) {
    fs.writeFileSync(outputPath, buffer);
    return {
        path: outputPath,
        size: buffer.length,
        isImage: /\.(jpe?g|png|webp|gif)$/i.test(outputPath)
    };
}

async function processCobalt(url) {
    const cobaltUrl = getCobaltUrl();
    const { data } = await axios.post(
        `${cobaltUrl}/`,
        {
            url,
            alwaysProxy: true,
            videoQuality: '1080',
            downloadMode: 'auto',
            filenameStyle: 'pretty'
        },
        {
            timeout: 30000,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json'
            },
            validateStatus: () => true
        }
    );
    return data;
}

async function downloadViaCobalt(url, outputPath) {
    const cobalt = await processCobalt(url);
    if (!cobalt || cobalt.status === 'error') {
        const code = cobalt?.error?.code || 'error.unknown';
        throw new Error(`Cobalt: ${code}`);
    }

    if (Array.isArray(cobalt.picker) && cobalt.picker.length && !cobalt.url && !cobalt.tunnel?.[0]) {
        const first = cobalt.picker[0];
        const mediaUrl = first.url;
        if (!mediaUrl) throw new Error('Cobalt picker sans URL');
        const buf = await downloadBuffer(mediaUrl);
        const imgPath = outputPath.replace(/\.mp4$/i, '.jpg');
        writeOutput(imgPath, buf);
        return {
            path: imgPath,
            platform: detectPlatform(url) || 'web',
            title: cobalt.filename || 'Média',
            source: 'cobalt-picker',
            isImage: true
        };
    }

    const mediaUrl = cobalt.url || cobalt.tunnel?.[0];
    if (!mediaUrl) throw new Error('Cobalt: aucun fichier');

    const buf = await downloadBuffer(mediaUrl);
    writeOutput(outputPath, buf);
    return {
        path: outputPath,
        platform: detectPlatform(url) || 'web',
        title: (cobalt.filename || 'media').replace(/\.[^.]+$/, ''),
        source: 'cobalt',
        isImage: false
    };
}

function extractTweetId(url) {
    const match = String(url).match(/(?:status|statuses)\/(\d+)/i);
    return match ? match[1] : null;
}

async function downloadViaTwitterFallback(url, outputPath) {
    const tweetId = extractTweetId(url);
    if (!tweetId) throw new Error('Lien X / Twitter invalide');

    const { data } = await axios.get(`https://api.fxtwitter.com/status/${tweetId}`, {
        timeout: 20000,
        headers: { Accept: 'application/json', 'User-Agent': UA }
    });

    const tweet = data?.tweet;
    if (!tweet) throw new Error('Post X introuvable');

    const videos = tweet.media?.videos || [];
    const photos = tweet.media?.photos || tweet.media?.images || [];
    const video = videos[0];
    let mediaUrl = video?.url || null;

    if (Array.isArray(video?.variants) && video.variants.length) {
        const mp4s = video.variants
            .filter((item) => (item.content_type || '').includes('mp4') || String(item.url || '').includes('.mp4'))
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (mp4s[0]?.url) mediaUrl = mp4s[0].url;
    }

    if (mediaUrl) {
        const buf = await downloadBuffer(mediaUrl, { Referer: 'https://x.com/' });
        writeOutput(outputPath, buf);
        return {
            path: outputPath,
            platform: 'twitter',
            title: (tweet.text || `Post X`).slice(0, 120),
            source: 'fxtwitter',
            isImage: false
        };
    }

    const photoUrl = photos[0]?.url || photos[0];
    if (!photoUrl) throw new Error('Aucun média dans ce post X');

    const buf = await downloadBuffer(photoUrl, { Referer: 'https://x.com/' });
    const imgPath = outputPath.replace(/\.mp4$/i, '.jpg');
    writeOutput(imgPath, buf);
    return {
        path: imgPath,
        platform: 'twitter',
        title: (tweet.text || `Post X`).slice(0, 120),
        source: 'fxtwitter-photo',
        isImage: true
    };
}

function upgradePinimg(url) {
    if (!url) return url;
    return url.replace(/\/\d+x\//, '/originals/');
}

async function resolvePinterestPinId(url) {
    const direct = String(url).match(/\/pin\/(\d+)/);
    if (direct) return direct[1];

    const res = await axios.get(url, {
        maxRedirects: 8,
        timeout: 15000,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
        validateStatus: (status) => status >= 200 && status < 400
    });
    const finalUrl = res.request?.res?.responseUrl || res.headers.location || url;
    const match = String(finalUrl).match(/\/pin\/(\d+)/);
    if (match) return match[1];
    const bodyMatch = String(res.data || '').match(/\/pin\/(\d+)/);
    return bodyMatch ? bodyMatch[1] : null;
}

async function downloadViaPinterestFallback(url, outputPath) {
    const pinId = await resolvePinterestPinId(url);
    if (!pinId) throw new Error('Lien Pinterest invalide');

    let title = `Pin ${pinId}`;
    let mediaUrl = null;
    let isPhoto = false;

    try {
        const { data: embed } = await axios.get('https://www.pinterest.com/oembed.json', {
            params: { url: `https://www.pinterest.com/pin/${pinId}/` },
            timeout: 12000,
            headers: { Accept: 'application/json', 'User-Agent': UA }
        });
        title = (embed.title || title).slice(0, 140);
        if (embed.thumbnail_url) {
            mediaUrl = upgradePinimg(embed.thumbnail_url);
            isPhoto = true;
        }
    } catch (_) {
        // oembed optionnel
    }

    try {
        const { data: html } = await axios.get(`https://www.pinterest.com/pin/${pinId}/`, {
            timeout: 15000,
            headers: { Accept: 'text/html', 'User-Agent': UA }
        });
        const text = String(html);
        const videos = [
            ...text.matchAll(/https:\\\/\\\/v1\.pinimg\.com\\\/videos\\\/[^"\\]+/g),
            ...text.matchAll(/https:\/\/v1\.pinimg\.com\/videos\/[^"\\\s]+/g)
        ].map((m) => m[0].replace(/\\\//g, '/'));
        const mp4 = videos.find((v) => v.includes('.mp4'));
        if (mp4) {
            mediaUrl = mp4;
            isPhoto = false;
        } else if (!mediaUrl) {
            const originals = [
                ...text.matchAll(/https:\/\/i\.pinimg\.com\/originals\/[a-z0-9/_.-]+\.(?:jpg|jpeg|png|gif|webp)/gi)
            ].map((m) => m[0]);
            if (originals[0]) {
                mediaUrl = originals[0];
                isPhoto = true;
            }
        }
    } catch (_) {
        // scrape optionnel
    }

    if (!mediaUrl) throw new Error('Aucun média trouvé sur ce pin');

    const buf = await downloadBuffer(mediaUrl, { Referer: 'https://www.pinterest.com/' });
    const out = isPhoto ? outputPath.replace(/\.mp4$/i, '.jpg') : outputPath;
    writeOutput(out, buf);
    return {
        path: out,
        platform: 'pinterest',
        title,
        source: 'pinterest-fallback',
        isImage: isPhoto
    };
}

async function downloadViaYtDlp(url, outputPath) {
    const tmpPattern = `${outputPath}.tmp.%(ext)s`;
    const platform = detectPlatform(url);
    const cookieArgs = getYtDlpCookieArgs();
    const args = [
        ...cookieArgs,
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '-o',
        tmpPattern,
        url
    ];

    if (platform === 'youtube') {
        // android seul est souvent bloqué sur VPS ; cookies + clients multiples
        args.splice(0, 0, '--extractor-args', 'youtube:player_client=android,ios,tv,mweb');
        args.splice(0, 0, '-f', '18/best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best');
        args.splice(0, 0, '--merge-output-format', 'mp4');
        if (cookieArgs.length) {
            console.log('🍪 yt-dlp YouTube avec cookies');
        } else {
            console.log('⚠️ yt-dlp YouTube sans cookies (souvent bloqué sur VPS)');
        }
    } else {
        // Facebook / Instagram : laisser yt-dlp choisir (plus fiable que Cobalt)
        args.splice(0, 0, '-f', 'best[ext=mp4]/best');
        args.splice(0, 0, '--merge-output-format', 'mp4');
    }

    await runYtDlp(args);

    const dir = path.dirname(outputPath);
    const base = path.basename(outputPath) + '.tmp.';
    const produced = fs.readdirSync(dir).find((name) => name.startsWith(base));
    if (!produced) throw new Error('yt-dlp n’a pas produit de fichier');
    const producedPath = path.join(dir, produced);
    if (fs.statSync(producedPath).size < 1024) {
        fs.unlinkSync(producedPath);
        throw new Error('Fichier yt-dlp vide');
    }
    fs.renameSync(producedPath, outputPath);
    return {
        path: outputPath,
        platform: platform || 'youtube',
        title: path.basename(outputPath, '.mp4'),
        source: 'yt-dlp',
        isImage: false
    };
}

/**
 * API Hexaro Downloader (site) — orchestre Cobalt + fallbacks côté serveur.
 */
async function downloadViaSiteApi(url, outputPath) {
    const apiBase = getDownloaderApiUrl();
    if (!apiBase) {
        throw new Error('DOWNLOADER_API_URL non configuré');
    }

    const { data } = await axios.post(
        `${apiBase}/api/download`,
        { url },
        {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
        }
    );

    if (!data?.success || !data?.data) {
        throw new Error(data?.message || data?.error || 'API downloader échec');
    }

    let fileUrl = data.data.downloadUrl || data.data.video?.url || data.data.previewUrl;
    if (!fileUrl && Array.isArray(data.data.picker) && data.data.picker[0]?.url) {
        fileUrl = data.data.picker[0].url;
    }
    if (!fileUrl) throw new Error('API downloader: pas d’URL fichier');

    if (fileUrl.startsWith('/')) {
        fileUrl = `${apiBase}${fileUrl}`;
    }

    const buf = await downloadBuffer(fileUrl);
    const isImage =
        data.data.type === 'image' ||
        (data.data.type === 'picker' && !data.data.video?.url) ||
        /\.(jpe?g|png|webp|gif)(\?|$)/i.test(fileUrl);
    const out = isImage ? outputPath.replace(/\.mp4$/i, '.jpg') : outputPath;
    writeOutput(out, buf);
    return {
        path: out,
        platform: data.data.platform || detectPlatform(url) || 'web',
        title: data.data.title || 'Média',
        source: `api:${data.data.source || 'hexaro'}`,
        isImage
    };
}

/**
 * Stratégie bot : UNIQUEMENT l’API Hexaro (DOWNLOADER_API_URL).
 * Les fallbacks locaux (yt-dlp / fxtwitter / Cobalt) sont désactivés —
 * YouTube / FB / etc. se gèrent côté site Hexaro.
 * Opt-in secours : SITE_DOWNLOADER_LOCAL_FALLBACK=true
 */
function useLocalDownloaderFallback() {
    return String(process.env.SITE_DOWNLOADER_LOCAL_FALLBACK || 'false').toLowerCase() === 'true';
}

async function downloadSiteMediaToFile(rawUrl, outputPath) {
    const url = sanitizeMediaUrl(rawUrl);
    const platform = detectPlatform(url);
    if (!platform) {
        throw new Error('Plateforme non supportée');
    }

    const apiBase = getDownloaderApiUrl();
    if (!apiBase) {
        throw new Error('DOWNLOADER_API_URL non configuré');
    }

    try {
        console.log(`🌐 API Hexaro uniquement (${apiBase})…`);
        return await downloadViaSiteApi(url, outputPath);
    } catch (e) {
        const detail = e?.response?.status
            ? `HTTP ${e.response.status}`
            : (e.message || 'échec');
        console.warn('⚠️ API Hexaro échec:', detail, e?.response?.data?.message || e?.response?.data?.error || '');
        if (!useLocalDownloaderFallback()) {
            // Message technique uniquement en logs — le bot affiche un texte friendly
            throw new Error('Échec API Hexaro');
        }
        console.warn('⚠️ SITE_DOWNLOADER_LOCAL_FALLBACK=true → tentative locale…');
    }

    const errors = ['API Hexaro'];

    if (platform === 'twitter') {
        try {
            console.log('🐦 fxtwitter…');
            return await downloadViaTwitterFallback(url, outputPath);
        } catch (e) {
            errors.push(`X: ${e.message}`);
            console.warn('⚠️ fxtwitter:', e.message);
        }
    }

    if (platform === 'pinterest') {
        try {
            console.log('📌 Pinterest…');
            return await downloadViaPinterestFallback(url, outputPath);
        } catch (e) {
            errors.push(`Pinterest: ${e.message}`);
            console.warn('⚠️ Pinterest:', e.message);
        }
    }

    if (platform === 'youtube' || platform === 'facebook' || platform === 'instagram') {
        try {
            console.log(`📥 yt-dlp (${platform})…`);
            return await downloadViaYtDlp(url, outputPath);
        } catch (e) {
            errors.push(`yt-dlp: ${e.message}`);
            console.warn('⚠️ yt-dlp:', e.message);
        }
    }

    if (useCobaltLocal()) {
        try {
            console.log(`⚡ Cobalt local (${getCobaltUrl()})…`);
            return await downloadViaCobalt(url, outputPath);
        } catch (e) {
            errors.push(`Cobalt: ${e.message}`);
            console.warn('⚠️ Cobalt:', e.message);
        }
    }

    throw new Error('Échec téléchargement');
}

module.exports = {
    sanitizeMediaUrl,
    detectPlatform,
    isSiteDownloadPlatform,
    downloadSiteMediaToFile,
    get COBALT_URL() {
        return getCobaltUrl();
    },
    get DOWNLOADER_API_URL() {
        return getDownloaderApiUrl();
    }
};
