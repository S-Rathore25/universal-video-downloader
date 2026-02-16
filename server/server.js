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
// Proxy Management
// Combine single PROXY_URL and PROXY_POOL into one list
const rawProxies = [process.env.PROXY_URL, ...(process.env.PROXY_POOL || '').split(',')];
const PROXY_POOL = rawProxies.map(p => p?.trim()).filter(p => p);

const proxyHealth = new Map(); // { fails: number, bannedUntil: number }

function getHealthyProxy() {
    if (PROXY_POOL.length === 0) return null;

    // Shuffle proxies for random selection
    const shuffled = [...PROXY_POOL].sort(() => 0.5 - Math.random());

    let bestBadProxy = null;
    let minBanTime = Infinity;

    for (const proxy of shuffled) {
        const health = proxyHealth.get(proxy);
        if (!health) return proxy; // Fresh proxy

        if (Date.now() > health.bannedUntil) {
            // Unban if time expired
            proxyHealth.delete(proxy);
            return proxy;
        }

        // Track the one that will be unbanned soonest
        if (health.bannedUntil < minBanTime) {
            minBanTime = health.bannedUntil;
            bestBadProxy = proxy;
        }
    }

    // If all are banned, use the one that expires soonest (Force Proxy Usage)
    // This prevents falling back to direct connection which leaks IP
    if (bestBadProxy) {
        console.warn(`[Proxy] All proxies banned. Forcing use of ${bestBadProxy.substring(0, 20)}...`);
        return bestBadProxy;
    }

    return PROXY_POOL[0]; // Fallback to first if something weird happens
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
// Queue & Throttling Wrapper
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
        const delay = Math.floor(Math.random() * 1000) + 500;
        await new Promise(r => setTimeout(r, delay));

        const strategies = [
            {
                name: 'Android Client',
                args: [
                    '--extractor-args', 'youtube:player_client=android',
                    '--extractor-args', 'youtube:player_skip=webpage,configs',
                    '--user-agent', 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.101 Mobile Safari/537.36'
                ]
            },
            {
                name: 'iOS Client',
                args: [
                    '--extractor-args', 'youtube:player_client=ios',
                    '--extractor-args', 'youtube:player_skip=webpage,configs',
                    '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1'
                ]
            },
            {
                name: 'Web Client',
                args: [
                    '--extractor-args', 'youtube:player_client=web',
                    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                ]
            }
        ];

        let lastError = null;

        for (const strategy of strategies) {
            console.log(`[Attempt] Trying with ${strategy.name}...`);

            const args = [
                '--force-ipv4', // CRITICAL for Render: Avoid blocked IPv6 ranges
                '--no-playlist',
                '--no-check-certificates',
                '--prefer-free-formats',
                '--geo-bypass',
                '--socket-timeout', '15',
                '--retries', '2',
                '--fragment-retries', '2',
                '--skip-unavailable-fragments',
                '--concurrent-fragments', '1',
                // Explicitly tell yt-dlp to use node for JS challenges
                '--js-runtimes', 'node',
                // Enable remote code execution for challenge solving (REQUIRED for new YouTube changes)
                '--remote-components', 'ejs:github',
                ...strategy.args
            ];

            // Proxy support if configured
            const proxy = getHealthyProxy();
            if (proxy) {
                args.push('--proxy', proxy);
            } else if (PROXY_POOL.length > 0) {
                console.warn('Proxy pool configured but no healthy proxies available. Trying direct.');
            }

            if (fs.existsSync(cookiesPath)) {
                args.push('--cookies', cookiesPath);
            }

            const finalArgs = [...args, ...commandFlags, url];

            try {
                return await executeYtDlp(finalArgs);
            } catch (error) {
                lastError = error;
                // Only retry on bot detection or network errors
                if (error.message === 'BOT_DETECTED' || (error.stderr && (error.stderr.includes('429') || error.stderr.includes('network')))) {
                    console.warn(`[Retry] ${strategy.name} failed: ${error.message}. Trying next strategy...`);
                    await new Promise(r => setTimeout(r, 1000)); // Wait a bit before retry
                    continue;
                }
                throw error; // Throw other errors immediately
            }
        }

        throw lastError; // If all strategies fail

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

// FFmpeg Configuration
// FFmpeg Configuration
if (process.env.LOCALAPPDATA) {
    const ffmpegDir = path.join(process.env.LOCALAPPDATA, 'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.0.1-full_build/bin');
    if (fs.existsSync(ffmpegDir)) {
        process.env.PATH = `${ffmpegDir};${process.env.PATH}`;
        console.log(`[FFmpeg] Added to Windows PATH: ${ffmpegDir}`);
    } else {
        console.warn('[FFmpeg] Windows FFmpeg directory not found. Utilizing system PATH instead.');
    }
} else {
    // Linux/Docker/Render Environment
    console.log('[FFmpeg] Running on non-Windows environment. Relying on system PATH for FFmpeg.');
}

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

// Stream Download Endpoint (For Merging Video+Audio)
app.get('/api/stream-download', async (req, res) => {
    const { url, itag, title } = req.query;
    if (!url || !itag) return res.status(400).send('Missing parameters');

    const safeTitle = (title || 'video').replace(/[^a-zA-Z0-9-_]/g, '_');
    res.header('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.header('Content-Type', 'video/mp4');

    const args = [
        '--force-ipv4', // CRITICAL for Render
        '--no-playlist',
        '--no-check-certificates',
        '--prefer-free-formats',
        '--geo-bypass',
        '--socket-timeout', '30',
        '--retries', '3',
        // Merge video+audio
        '-f', `${itag}+bestaudio/best`,
        '--merge-output-format', 'mp4',
        '-o', '-', // Output to stdout

        // Critical for Render/Cloud: Spoof Android App
        '--extractor-args', 'youtube:player_client=android',
        '--extractor-args', 'youtube:player_skip=webpage,configs',

        url
    ];

    // Use our healthy proxy logic if possible, but for streaming large files,
    // we should be careful about proxy bandwidth.
    // For now, let's use direct connection or the proxy wrapper slightly modified.
    // To keep it simple and reusing the safe wrapper logic is hard here because of piping.
    // We will spawn directly but use the proxy pool logic manually.

    console.log(`[Stream] Starting download for ${itag} from ${url}`);

    const proxy = getHealthyProxy();
    if (proxy) args.push('--proxy', proxy);
    if (fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);

    // Dynamic User Agent (Android)
    args.push('--user-agent', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');

    const ytProcess = spawn('yt-dlp', args);

    ytProcess.stdout.pipe(res);

    ytProcess.stderr.on('data', (data) => {
        // Log stderr but don't fail immediately unless it's fatal
        const msg = data.toString();
        if (msg.includes('ERROR:')) console.error(`[Stream Error] ${msg}`);
    });

    ytProcess.on('close', (code) => {
        if (code !== 0) console.log(`[Stream] Ended with code ${code}`);
    });

    req.on('close', () => {
        ytProcess.kill(); // Kill download if client disconnects
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});
