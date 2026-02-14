const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { spawn } = require('child_process');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const fs = require('fs');

// 1. Trust Proxy for Render
app.set('trust proxy', 1);

// Write cookies from env var if present
const cookiesPath = path.join(__dirname, 'cookies.txt');
if (process.env.YOUTUBE_COOKIES) {
    try {
        fs.writeFileSync(cookiesPath, process.env.YOUTUBE_COOKIES);
        console.log('Cookies file created from environment variable.');
    } catch (err) {
        console.error('Failed to create cookies file:', err);
    }
}

// Helper: Get common yt-dlp args
function getCommonArgs() {
    const args = [
        '--no-check-certificates',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=android', // Anti-bot
    ];

    if (fs.existsSync(cookiesPath)) {
        args.push('--cookies', cookiesPath);
    }

    return args;
}

// Helper: Run yt-dlp
function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        const process = spawn('yt-dlp', args);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => stdout += data);
        process.stderr.on('data', (data) => stderr += data);

        process.on('close', (code) => {
            if (code !== 0) {
                console.error(`yt-dlp stderr: ${stderr}`);
                reject(new Error(stderr.trim() || `Exit code ${code}`));
            } else {
                resolve(stdout.trim());
            }
        });

        process.on('error', (err) => reject(err));
    });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serving Static Files
app.use(express.static(path.join(__dirname, '../')));
app.use('/css', express.static(path.join(__dirname, '../css')));
app.use('/js', express.static(path.join(__dirname, '../js')));
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

// Security: Rate Limit (5 requests per 10 sec)
const limiter = rateLimit({
    windowMs: 10 * 1000,
    max: 5,
    message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

// Root Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// API: Health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// API: Video Info
app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        const args = [
            ...getCommonArgs(),
            '-J',
            '--no-playlist',
            '--skip-download',
            url
        ];

        const rawOutput = await runYtDlp(args);
        const info = JSON.parse(rawOutput);

        const formats = (info.formats || []).map(f => ({
            itag: f.format_id,
            quality: f.format_note || `${f.height}p` || 'audio',
            ext: f.ext,
            container: f.ext,
            hasAudio: f.acodec !== 'none',
            hasVideo: f.vcodec !== 'none',
            filesize: f.filesize || f.filesize_approx || 0,
            direct_url: f.url
        }));

        // sort formats: high quality video first
        formats.sort((a, b) => {
            if (a.hasVideo && !b.hasVideo) return -1;
            if (!a.hasVideo && b.hasVideo) return 1;
            return 0; // maintain original order mostly
        });

        res.json({
            title: info.title,
            duration: info.duration_string || info.duration, // duration_string is better if available, else seconds
            thumbnail: info.thumbnail,
            channel: info.uploader,
            views: info.view_count,
            formats: formats
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch video info' });
    }
});

// API: Get Direct Link
app.get('/api/get-link', async (req, res) => {
    try {
        const { url, itag } = req.query;
        if (!url || !itag) return res.status(400).json({ error: 'Missing url or itag' });

        const args = [
            ...getCommonArgs(),
            '-f', itag,
            '-g',
            url
        ];

        const directLink = await runYtDlp(args);

        // Sometimes -g returns multiple lines if video and audio are separate streams.
        // We take the first one or the one that corresponds to the itag.
        // Usually valid direct link is just the stdout.

        res.json({ direct_url: directLink.split('\n')[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate link' });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});
