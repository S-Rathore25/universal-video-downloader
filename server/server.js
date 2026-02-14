const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const fs = require('fs');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 1. Trust Proxy for Render
app.set('trust proxy', 1);

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

// Random UA Generator
function getRandomUserAgent() {
    const androidVersions = ['10', '11', '12', '13', '14'];
    const chromeVersions = ['114.0.0.0', '115.0.0.0', '116.0.0.0', '117.0.0.0'];
    const phones = ['Pixel 6', 'Pixel 7', 'Samsung Galaxy S22', 'OnePlus 9', 'Xiaomi Mi 11'];

    const android = androidVersions[Math.floor(Math.random() * androidVersions.length)];
    const chrome = chromeVersions[Math.floor(Math.random() * chromeVersions.length)];
    const phone = phones[Math.floor(Math.random() * phones.length)];

    return `Mozilla/5.0 (Linux; Android ${android}; ${phone}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Mobile Safari/537.36`;
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

// Safe Wrapper (Delay + Retry + Anti-Bot Args)
async function runSafeYtDlp(url, commandFlags) {
    // 1. Random Delay (2-5s)
    const delay = Math.floor(Math.random() * 3000) + 2000;
    await new Promise(r => setTimeout(r, delay));

    const generateArgs = () => {
        const ua = getRandomUserAgent();
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
            '--extractor-args', 'youtube:player_client=android',
            '--extractor-args', 'youtube:player_skip=webpage,configs',
            '--add-header', 'accept-language:en-US,en;q=0.9',
            '--add-header', 'sec-fetch-mode:navigate',
            '--add-header', 'sec-fetch-site:none',
            '--add-header', 'sec-fetch-user:?1',
            '--user-agent', ua
        ];

        if (fs.existsSync(cookiesPath)) {
            args.push('--cookies', cookiesPath);
        }

        // Add command specific flags and URL
        return [...args, ...commandFlags, url];
    };

    try {
        return await executeYtDlp(generateArgs());
    } catch (error) {
        if (error.message === 'BOT_DETECTED') {
            console.log('⚠️ Bot detected. Retrying with fresh UA...');
            // Retry once
            await new Promise(r => setTimeout(r, 2000));
            return await executeYtDlp(generateArgs());
        }
        throw error;
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
