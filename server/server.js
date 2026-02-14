const express = require('express');
const ytdl = require('@distube/ytdl-core');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const NodeCache = require('node-cache');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
// Middleware
app.use(express.json());
// Serve static files from root-level folders since they were moved out of 'public'
app.use(express.static(path.join(__dirname, '../')));
app.use('/css', express.static(path.join(__dirname, '../css')));
app.use('/js', express.static(path.join(__dirname, '../js')));
app.use(cors());

// Configure Helmet with relaxed CSP for video downloading/previewing
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
    max: 100, // Increased for testing, 30 might be too strict for assets
    message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

const cache = new NodeCache({ stdTTL: 3600 });
const downloadsDir = path.join(__dirname, '../downloads');

if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}

// Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;
        if (!ytdl.validateURL(url)) return res.status(400).json({ error: 'Invalid YouTube URL' });

        const info = await ytdl.getInfo(url);
        const formats = ytdl.filterFormats(info.formats, 'videoandaudio');

        // Sort formats by quality roughly
        formats.sort((a, b) => (b.height || 0) - (a.height || 0));

        const videoData = {
            title: info.videoDetails.title,
            thumbnail: info.videoDetails.thumbnails.pop().url,
            channel: info.videoDetails.author.name,
            views: parseInt(info.videoDetails.viewCount).toLocaleString(),
            duration: formatDuration(info.videoDetails.lengthSeconds),
            formats: formats.map(f => ({
                itag: f.itag,
                quality: f.qualityLabel || `${f.height}p`,
                container: f.container,
                hasAudio: f.hasAudio,
                hasVideo: f.hasVideo,
                url: f.url
            }))
        };

        res.json(videoData);
    } catch (error) {
        console.error('Info Error:', error);
        res.status(500).json({ error: 'Failed to fetch video info' });
    }
});

app.post('/api/download', async (req, res) => {
    try {
        const { url, quality, type } = req.body; // type: 'direct' or 'link'
        if (!ytdl.validateURL(url)) return res.status(400).json({ error: 'Invalid URL' });

        const info = await ytdl.getInfo(url);
        const format = ytdl.chooseFormat(info.formats, { quality: quality || 'highest' });
        const title = info.videoDetails.title.replace(/[^\w\s-]/gi, '_').substring(0, 50);
        const filename = `${title}.mp4`;

        if (type === 'direct') {
            res.header('Content-Disposition', `attachment; filename="${filename}"`);
            ytdl(url, { format }).pipe(res);
        } else {
            // Link generation (save to server)
            const filePath = path.join(downloadsDir, filename);
            // Check if file exists to avoid redownload (simple cache)
            if (fs.existsSync(filePath)) {
                return res.json({ url: `/downloads/${encodeURIComponent(filename)}`, expires: '1 hour' });
            }

            const stream = ytdl(url, { format }).pipe(fs.createWriteStream(filePath));

            stream.on('finish', () => {
                res.json({ url: `/downloads/${encodeURIComponent(filename)}`, expires: '1 hour' });
            });

            stream.on('error', (err) => {
                res.status(500).json({ error: 'Download failed' });
            });
        }
    } catch (error) {
        console.error('Download Error:', error);
        res.status(500).json({ error: 'Server error' });
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

app.listen(port, () => console.log(`Server running on port ${port}`));
