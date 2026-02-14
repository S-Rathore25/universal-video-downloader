# Universal Video Downloader 🎬

A production-ready, beautiful YouTube video downloader web application built with Node.js, Express, and Vanilla JS.

## Features

- **Core Functionality**: Download YouTube videos and Shorts in multiple qualities (144p to 1080p).
- **Two Download Modes**:
  - **Direct Download**: Stream video directly to your device.
  - **Shareable Link**: Generate a temporary cloud link (expires in 1 hour).
- **Modern UI**: Glassmorphism design with animated backgrounds and smooth transitions.
- **Mobile First**: Fully responsive on iOS and Android.
- **Security**: Rate limiting, localized filename sanitization, and secure headers with Helmet.js.
- **Auto-Cleanup**: Temporary files are automatically deleted after 1 hour.

## Tech Stack

- **Backend**: Node.js, Express, @distube/ytdl-core (reliable fork of ytdl-core)
- **Frontend**: HTML5, CSS3 (Variables, Animations), Vanilla JavaScript
- **Utilities**: express-rate-limit, node-cache, helmet, cors

## Installation

1.  **Clone the repository** (or download the files):
    ```bash
    git clone https://github.com/yourusername/universal-video-downloader.git
    cd universal-video-downloader
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment**:
    - Rename `.env.example` to `.env` (optional, defaults to port 3000).

4.  **Start the Server**:
    - For development (auto-reload):
      ```bash
      npm run dev
      ```
    - For production:
      ```bash
      npm start
      ```

5.  **Access the App**:
    - Open your browser and navigate to `http://localhost:3000`.

## API Endpoints

-   `GET /api/health`: Check server status.
-   `POST /api/video-info`: Get metadata and formats for a video.
-   `POST /api/download`:
    -   Body: `{ url, quality, type: 'direct' | 'link' }`
    -   Returns: File stream (direct) or JSON with download link (link).
-   `GET /downloads/:filename`: Access generated file.

## Disclaimer

This tool is for educational purposes only. Please respect YouTube's Terms of Service and copyright laws.

## License

ISC
