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
const ytDlp = require('yt-dlp-exec');

// ... (middleware remains same)

// Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;
        // Basic check, yt-dlp handles validation better
        if (!url || !url.includes('youtu')) return res.status(400).json({ error: 'Invalid YouTube URL' });

        const output = await ytDlp(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            ]
        });

        const formats = output.formats.filter(f => f.acodec !== 'none' && f.vcodec !== 'none'); // video+audio
        // If no combined formats, fallback to video only or use best available
        // For simplicity in this demo, filter for mp4 with audio

        const videoData = {
            title: output.title,
            thumbnail: output.thumbnail,
            channel: output.uploader,
            views: output.view_count.toLocaleString(),
            duration: formatDuration(output.duration),
            formats: formats.map(f => ({
                itag: f.format_id, // map format_id to itag for frontend compat
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

        // Sanitize
        const info = await ytDlp(url, { dumpSingleJson: true, noCheckCertificates: true });
        const title = info.title.replace(/[^\w\s-]/gi, '_').substring(0, 50);
        const filename = `${title}.mp4`;

        if (type === 'direct') {
            res.header('Content-Disposition', `attachment; filename="${filename}"`);

            // Stream directly to response
            const stream = ytDlp.exec(url, {
                format: quality === 'highest' ? 'best[ext=mp4]' : `${quality}+bestaudio/best`,
                output: '-'
            });

            stream.stdout.pipe(res);
        } else {
            // Link generation
            const filePath = path.join(downloadsDir, filename);

            if (fs.existsSync(filePath)) {
                return res.json({ url: `/downloads/${encodeURIComponent(filename)}`, expires: '1 hour' });
            }

            // Download to file
            await ytDlp.exec(url, {
                format: quality === 'highest' ? 'best[ext=mp4]' : `${quality}+bestaudio/best`,
                output: filePath
            });

            res.json({ url: `/downloads/${encodeURIComponent(filename)}`, expires: '1 hour' });
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
