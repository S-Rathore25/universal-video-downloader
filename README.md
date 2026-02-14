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
- **Docker Support**: Easy deployment with Docker.

## Tech Stack

- **Backend**: Node.js, Express, yt-dlp (System Binary Execution for improved stability)
- **Frontend**: HTML5, CSS3 (Variables, Animations), Vanilla JavaScript
- **Utilities**: express-rate-limit, node-cache, helmet, cors
- **Containerization**: Docker, Docker Compose (optional)

## Installation

### Method 1: Docker (Recommended)

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/universal-video-downloader.git
    cd universal-video-downloader
    ```

2.  **Build the Docker Image**:
    ```bash
    docker build -t universal-video-downloader .
    ```

3.  **Run the Container**:
    ```bash
    docker run -p 3000:3000 universal-video-downloader
    ```

4.  **Access the App**:
    - Open your browser and navigate to `http://localhost:3000`.

### Method 2: Standard Installation (Method 2)

**Prerequisites**:
- Node.js (v18+)
- Python 3+
- FFmpeg (Must be installed and added to PATH)
- yt-dlp (Must be installed and added to PATH or use `pip install yt-dlp`)

1.  **Install dependencies**:
    ```bash
    npm install
    # Ensure system dependencies (yt-dlp, python, ffmpeg) are installed on your machine.
    ```

2.  **Start the Server**:
    - For development: `npm run dev`
    - For production: `npm start`

3.  **Access the App**: `http://localhost:3000`

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
