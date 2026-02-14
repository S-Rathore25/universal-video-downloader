const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 1. Trust Proxy for Render
app.set('trust proxy', 1);

// State Management
const videoCache = new Map(); // simple in-memory cache
const ipLocks = new Map(); // semaphore for 1 process per IP
const recentRequests = new Map(); // tracking recent URLs per IP

// Proxy Management
const PROXY_POOL = (process.env.PROXY_POOL || '').split(',').map(p => p.trim()).filter(p => p);
const proxyHealth = new Map(); // { fails: number, bannedUntil: number }

function getHealthyProxy() {
    if (PROXY_POOL.length === 0) return null;

    // Shuffle proxies for random selection
    const shuffled = [...PROXY_POOL].sort(() => 0.5 - Math.random());

    for (const proxy of shuffled) {
        const health = proxyHealth.get(proxy);
        if (!health) return proxy;

        if (Date.now() > health.bannedUntil) {
            // Unban if time expired
            proxyHealth.delete(proxy);
            return proxy;
        }
    }

    // If all banned, return the one with earliest unban time (fail-safe)
    return null;
}

function markProxyBad(proxy) {
    if (!proxy) return;

    const health = proxyHealth.get(proxy) || { fails: 0, bannedUntil: 0 };
    health.fails += 1;

    if (health.fails >= 2) {
        health.bannedUntil = Date.now() + (10 * 60 * 1000); // 10 mins
        console.log(`[Proxy] Banned ${proxy.substring(0, 20)}... until ${new Date(health.bannedUntil).toISOString()}`);
    }

    proxyHealth.set(proxy, health);
}

// Cookie Setup
const cookiesPath = path.join(__dirname, 'cookies.txt');
if (process.env.YOUTUBE_COOKIES) {
    try {
        fs.writeFileSync(cookiesPath, process.env.YOUTUBE_COOKIES);
        console.log('Cookies file created from environment variable.');
    } catch (err) {
        console.error('Failed to create cookies file:', err);
    }
}

// Session Management
// Generate or retrieve persistent Session ID
function getSessionId(req) {
    return req.headers['x-session-id'] || crypto.randomUUID();
}

// Advanced Random Header Generator
function generateBrowserHeaders(req) {
    const androidVersions = ['10', '11', '12', '13', '14'];
    const chromeVersions = ['114.0.0.0', '115.0.0.0', '116.0.0.0', '117.0.0.0'];
    const phones = ['Pixel 6', 'Pixel 7', 'Samsung Galaxy S22', 'OnePlus 9', 'Xiaomi Mi 11'];

    // Hash IP/Session to sustain same UA for a session if possible, or random
    const rand = Math.random();

    const android = androidVersions[Math.floor(rand * androidVersions.length)];
    const chrome = chromeVersions[Math.floor(rand * chromeVersions.length)];
    const phone = phones[Math.floor(rand * phones.length)];

    const ua = `Mozilla/5.0 (Linux; Android ${android}; ${phone}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Mobile Safari/537.36`;

    const languages = ['en-US,en;q=0.9', 'en-GB,en;q=0.8', 'en-CA,en;q=0.8'];
    const lang = languages[Math.floor(Math.random() * languages.length)];

    return { ua, lang };
}

// Core Execution Helper
function executeYtDlp(args) {
    return new Promise((resolve, reject) => {
        const process = spawn('yt-dlp', args);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => stdout += data);
        process.stderr.on('data', (data) => stderr += data);

        process.on('close', (code) => {
            if (code !== 0) {
                // Heuristic for bot detection
                if (stderr.includes('Sign in to confirm') ||
                    stderr.includes('bot') ||
                    stderr.includes('429')) {
                    const err = new Error('BOT_DETECTED');
                    err.stderr = stderr;
                    reject(err);
                } else {
                    reject(new Error(stderr.trim() || `Exit code ${code}`));
                }
            } else {
                resolve(stdout.trim());
            }
        });

        process.on('error', (err) => reject(err));
    });
}

// Queue & Throttling Wrapper
async function runSafeYtDlp(req, url, commandFlags) {
    const ip = req.ip || 'unknown';

    // 1. Check IP Lock (1 concurrent process per IP)
    if (ipLocks.get(ip)) {
        throw new Error('QUEUE_FULL');
    }

    // 2. Check Repeated Request (15s cooldown for SAME video)
    const lastReq = recentRequests.get(ip);
    if (lastReq && lastReq.url === url && (Date.now() - lastReq.time < 15000)) {
        console.log(`[Anti-Scrape] Blocked repeat request from ${ip}`);
        throw new Error('RATE_LIMIT_DUPLICATE');
    }
    recentRequests.set(ip, { url, time: Date.now() });

    // Acquire Lock
    ipLocks.set(ip, true);

    try {
        // 3. Random Delay (human simulation)
        const delay = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(r => setTimeout(r, delay));

        // Use session-consistent headers
        const headers = generateBrowserHeaders(req);

        // Retry Logic (Max 3 attempts with Proxy Rotation)
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const proxy = getHealthyProxy();

            // If proxy pool is configured but no healthy proxy found
            if (PROXY_POOL.length > 0 && !proxy) {
                throw new Error('NO_HEALTHY_PROXIES');
            }

            const args = [
                '--no-playlist',
                '--no-check-certificates',
                '--prefer-free-formats',
                '--geo-bypass',
                '--geo-bypass-country', 'IN',
                '--socket-timeout', '15',
                '--retries', '2',
                '--fragment-retries', '2',
                '--skip-unavailable-fragments',
                '--concurrent-fragments', '1',

                // Fingerprint simulation
                '--extractor-args', 'youtube:player_client=android',
                '--extractor-args', 'youtube:player_skip=webpage,configs',
                '--add-header', `accept-language:${headers.lang}`,
                '--add-header', 'sec-fetch-mode:navigate',
                '--add-header', 'sec-fetch-site:none',
                '--add-header', 'sec-fetch-user:?1',
                '--add-header', `sec-ch-ua-platform:"Android"`,
                '--add-header', `sec-ch-ua-mobile:?1`,
                '--user-agent', headers.ua
            ];

            if (proxy) {
                args.push('--proxy', proxy);
            }

            if (fs.existsSync(cookiesPath)) {
                args.push('--cookies', cookiesPath);
            }

            const finalArgs = [...args, ...commandFlags, url];

            try {
                return await executeYtDlp(finalArgs);
            } catch (error) {
                lastError = error;
                if (error.message === 'BOT_DETECTED') {
                    console.log(`⚠️ Bot detected via ${proxy ? 'proxy' : 'direct'}. Attempt ${attempt + 1}/3`);
                    if (proxy) markProxyBad(proxy);

                    // Small delay before retry
                    await new Promise(r => setTimeout(r, 1000));
                    continue; // Retry with new proxy
                }
                // If it's another error (e.g. video not found), throw immediately
                throw error;
            }
        }

        // If we exhausted retries
        throw lastError;

    } finally {
        // Release Lock
        ipLocks.delete(ip);
    }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://i.ytimg.com", "https://yt3.ggpht.com"],
            connectSrc: ["'self'", "https://*.youtube.com", "https://*.googlevideo.com"],
            mediaSrc: ["'self'", "blob:", "https://*.googlevideo.com"],
            frameSrc: ["'self'"],
            upgradeInsecureRequests: [],
        },
    },
}));

// Static Files
app.use(express.static(path.join(__dirname, '../')));
app.use('/css', express.static(path.join(__dirname, '../css')));
app.use('/js', express.static(path.join(__dirname, '../js')));

// Security: Rate Limit (3 requests per 12 sec)
const limiter = rateLimit({
    windowMs: 12 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' }
});
app.use('/api/', limiter);

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        // Cache Check
        const cached = videoCache.get(url);
        if (cached && (Date.now() - cached.time < 60000)) {
            return res.json(cached.data);
        }

        const output = await runSafeYtDlp(req, url, ['-J', '--skip-download']);
        const info = JSON.parse(output);

        const formats = (info.formats || []).map(f => ({
            itag: f.format_id,
            quality: f.format_note || `${f.height}p`,
            ext: f.ext,
            container: f.ext,
            hasAudio: f.acodec !== 'none',
            hasVideo: f.vcodec !== 'none',
            filesize: f.filesize || f.filesize_approx || 0,
            direct_url: f.url
        }));

        formats.sort((a, b) => {
            if (a.hasVideo && !b.hasVideo) return -1;
            if (!a.hasVideo && b.hasVideo) return 1;
            return 0;
        });

        const data = {
            title: info.title,
            duration: info.duration_string || info.duration,
            thumbnail: info.thumbnail,
            channel: info.uploader,
            views: info.view_count,
            formats: formats
        };

        // Set Cache
        videoCache.set(url, { time: Date.now(), data });

        res.json(data);

    } catch (error) {
        if (error.message === 'QUEUE_FULL') {
            return res.status(429).json({ error: 'Server busy. Please wait a moment.' });
        }
        if (error.message === 'RATE_LIMIT_DUPLICATE') {
            return res.status(429).json({ error: 'Please wait before checking this video again.' });
        }
        if (error.message === 'NO_HEALTHY_PROXIES') {
            return res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
        }
        if (error.message === 'BOT_DETECTED') {
            return res.status(503).json({ error: 'Video temporarily unavailable due to high traffic.' });
        }
        console.error('Video Info Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch video info. Please try again.' });
    }
});

app.get('/api/get-link', async (req, res) => {
    try {
        const { url, itag } = req.query;
        if (!url || !itag) return res.status(400).json({ error: 'Missing parameters' });

        const output = await runSafeYtDlp(req, url, ['-f', itag, '-g']);
        res.json({ direct_url: output.split('\n')[0] });

    } catch (error) {
        if (error.message === 'QUEUE_FULL') {
            return res.status(429).json({ error: 'Server busy. Please wait a moment.' });
        }
        console.error('Link Generation Error:', error.message);
        res.status(500).json({ error: 'Failed to generate link. Please try again.' });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});
