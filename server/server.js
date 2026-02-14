const express = require('express');
const ytdl = require('@distube/ytdl-core');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const NodeCache = require('node-cache');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { spawn } = require('child_process');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Helper to run yt-dlp command and return JSON output
function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        // Use the system-wide 'yt-dlp' binary insteady of npm wrapper
        const process = spawn('yt-dlp', args);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => stdout += data);
        process.stderr.on('data', (data) => stderr += data);

        process.on('close', (code) => {
            if (code !== 0) {
                console.error(`yt-dlp stderr: ${stderr}`);
                // Include stderr in error message for better debugging
                reject(new Error(`yt-dlp failed: ${stderr.trim() || `Exit code ${code}`}`));
            } else {
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    if (!stdout) reject(new Error('yt-dlp returned empty output'));
                    else resolve(stdout);
                }
            }
        });

        process.on('error', (err) => {
            reject(new Error(`Spawn error: ${err.message}`));
        });
    });
}

// Middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} [${req.method}] ${req.url}`);
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../')));
app.use('/css', express.static(path.join(__dirname, '../css')));
app.use('/js', express.static(path.join(__dirname, '../js')));
app.use(cors());

// Configure Helmet with relaxed CSP
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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

const cache = new NodeCache({ stdTTL: 3600 });
const downloadsDir = path.join(__dirname, '../downloads');

if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}

// Explicit Root Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || !url.includes('youtu')) return res.status(400).json({ error: 'Invalid YouTube URL' });

        const args = [
            url,
            '--dump-single-json',
            '--no-check-certificates',
            '--no-warnings',
            '--prefer-free-formats',
            '--add-header', 'referer:youtube.com',
            '--add-header', 'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ];

        const output = await runYtDlp(args);

        const formats = output.formats.filter(f => f.acodec !== 'none' && f.vcodec !== 'none');

        const videoData = {
            title: output.title,
            thumbnail: output.thumbnail,
            channel: output.uploader,
            views: output.view_count ? output.view_count.toLocaleString() : '0',
            duration: formatDuration(output.duration),
            formats: formats.map(f => ({
                itag: f.format_id,
                quality: f.format_note || `${f.height}p`,
                container: f.ext,
                hasAudio: f.acodec !== 'none',
                hasVideo: f.vcodec !== 'none',
                url: f.url
            }))
        };

        res.json(videoData);
    } catch (error) {
        console.error('Info Error:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch video info' });
    }
});

app.post('/api/download', async (req, res) => {
    try {
        const { url, quality, type } = req.body;

        // Metadata fetch for filename (lightweight)
        const info = await runYtDlp([url, '--dump-single-json', '--no-check-certificates']);
        const title = info.title.replace(/[^\w\s-]/gi, '_').substring(0, 50);
        const filename = `${title}.mp4`;

        const args = [
            url,
            '-f', quality === 'highest' ? 'best[ext=mp4]' : `${quality}+bestaudio/best`,
            '-o', '-' // Output to stdout
        ];

        if (type === 'direct') {
            res.header('Content-Disposition', `attachment; filename="${filename}"`);

            const child = spawn('yt-dlp', args);
            child.stdout.pipe(res);
            child.stderr.on('data', d => console.error(`[yt-dlp stderr]: ${d}`));

            res.on('close', () => child.kill());

        } else {
            // Link generation
            const filePath = path.join(downloadsDir, filename);
            if (fs.existsSync(filePath)) {
                return res.json({ url: `/downloads/${encodeURIComponent(filename)}`, expires: '1 hour' });
            }

            const fileStream = fs.createWriteStream(filePath);
            const child = spawn('yt-dlp', args);
            child.stdout.pipe(fileStream);

            child.on('close', (code) => {
                if (code === 0) {
                    res.json({ url: `/downloads/${encodeURIComponent(filename)}`, expires: '1 hour' });
                } else {
                    res.status(500).json({ error: 'Download process failed' });
                }
            });

            child.on('error', (err) => {
                console.error('Spawn error:', err);
                res.status(500).json({ error: 'Download failed to start' });
            });
        }
    } catch (error) {
        console.error('Download Error:', error);
        res.status(500).json({ error: 'Server error during download' });
    }
});

app.get('/downloads/:filename', (req, res) => {
    const filepath = path.join(downloadsDir, req.params.filename);
    if (fs.existsSync(filepath)) res.download(filepath);
    else res.status(404).json({ error: 'File expired or not found' });
});

// Helper
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

// Cleanup
setInterval(() => {
    fs.readdir(downloadsDir, (err, files) => {
        if (err) return;
        files.forEach(f => {
            const p = path.join(downloadsDir, f);
            fs.stat(p, (err, stats) => {
                if (!err && (Date.now() - stats.ctimeMs > 3600000)) fs.unlink(p, () => { });
            });
        });
    });
}, 1800000); // 30 mins

const host = '0.0.0.0';
app.listen(port, host, () => {
    console.log(`Server starting...`);
    console.log(`Server running at http://${host}:${port}`);
});
