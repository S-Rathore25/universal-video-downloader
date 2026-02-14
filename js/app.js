const ELEMENTS = {
    urlInput: document.getElementById('video-url'),
    fetchBtn: document.getElementById('fetch-btn'),
    clearBtn: document.getElementById('clear-btn'),
    errorMsg: document.getElementById('error-msg'),
    resultSection: document.getElementById('result-section'),
    thumbnail: document.getElementById('thumbnail'),
    videoTitle: document.getElementById('video-title'),
    channelName: document.getElementById('channel-name').querySelector('span'),
    views: document.getElementById('views'),
    duration: document.getElementById('duration'),
    qualitySelect: document.getElementById('quality-select'),
    downloadDirectBtn: document.getElementById('download-direct-btn'),
    downloadLinkBtn: document.getElementById('download-link-btn'),
    linkContainer: document.getElementById('generated-link-container'),
    generatedLinkInput: document.getElementById('generated-link'),
    copyLinkBtn: document.getElementById('copy-link-btn'),
    shareLinkBtn: document.getElementById('share-link-btn'),
    toast: document.getElementById('toast'),
    loader: document.querySelector('.loader'),
    modal: document.getElementById('disclaimer-modal'),
    acceptDisclaimerBtn: document.getElementById('accept-disclaimer')
};

// State
const API_BASE_URL = '';
let currentVideoData = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkDisclaimer();
    setupEventListeners();
});

function checkDisclaimer() {
    if (!localStorage.getItem('disclaimerAccepted')) {
        ELEMENTS.modal.style.display = 'flex';
    } else {
        ELEMENTS.modal.style.display = 'none';
    }
}

function setupEventListeners() {
    ELEMENTS.acceptDisclaimerBtn.addEventListener('click', () => {
        localStorage.setItem('disclaimerAccepted', 'true');
        ELEMENTS.modal.style.display = 'none';
        showToast('Welcome! 🎬');
    });

    ELEMENTS.fetchBtn.addEventListener('click', fetchVideoInfo);
    ELEMENTS.urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') fetchVideoInfo();
    });

    ELEMENTS.urlInput.addEventListener('input', () => {
        ELEMENTS.clearBtn.classList.toggle('hidden', !ELEMENTS.urlInput.value);
        ELEMENTS.errorMsg.classList.add('hidden');
    });

    ELEMENTS.clearBtn.addEventListener('click', () => {
        ELEMENTS.urlInput.value = '';
        ELEMENTS.clearBtn.classList.add('hidden');
        ELEMENTS.resultSection.classList.add('hidden');
        ELEMENTS.urlInput.focus();
    });

    ELEMENTS.downloadDirectBtn.addEventListener('click', () => handleDownload('direct'));
    ELEMENTS.downloadLinkBtn.addEventListener('click', () => handleDownload('link'));

    ELEMENTS.copyLinkBtn.addEventListener('click', copyLinkToClipboard);
    ELEMENTS.shareLinkBtn.addEventListener('click', shareLink);
}

// Core Functions
async function fetchVideoInfo() {
    const url = ELEMENTS.urlInput.value.trim();
    if (!url) return showError('Please enter a YouTube URL.');

    setLoading(true);
    ELEMENTS.resultSection.classList.add('hidden');
    ELEMENTS.errorMsg.classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE_URL}/api/video-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Failed to fetch video.');

        currentVideoData = data;
        populateUI(data);
        showToast('✅ Video found!');

    } catch (error) {
        showError(error.message);
    } finally {
        setLoading(false);
    }
}

function populateUI(data) {
    ELEMENTS.thumbnail.src = data.thumbnail;
    ELEMENTS.videoTitle.textContent = data.title;
    ELEMENTS.channelName.textContent = data.channel;
    ELEMENTS.views.textContent = data.views ? `${Number(data.views).toLocaleString()} views` : '';
    ELEMENTS.duration.textContent = formatDuration(data.duration);

    // Populate Qualities
    ELEMENTS.qualitySelect.innerHTML = '';

    // Filter out formats that are likely not useful usually handled by backend but double check
    const uniqueFormats = data.formats.filter(f => f.direct_url);

    uniqueFormats.forEach(format => {
        const option = document.createElement('option');
        option.value = format.itag;
        const audioInfo = format.hasAudio ? '' : ' (No Audio)';
        const sizeInfo = format.filesize ? ` - ${(format.filesize / 1024 / 1024).toFixed(1)} MB` : '';
        option.textContent = `${format.quality} (${format.ext})${audioInfo}${sizeInfo}`;
        ELEMENTS.qualitySelect.appendChild(option);
    });

    ELEMENTS.resultSection.classList.remove('hidden');
    ELEMENTS.linkContainer.classList.add('hidden');
}

async function handleDownload(type) {
    const itag = ELEMENTS.qualitySelect.value;
    const url = ELEMENTS.urlInput.value.trim();

    if (!itag || !url) return showError('Please select a quality.');

    const btn = type === 'direct' ? ELEMENTS.downloadDirectBtn : ELEMENTS.downloadLinkBtn;
    const originalText = btn.innerHTML;

    // UI Feedback
    btn.innerHTML = '<div class="loader"></div> Processing...';
    btn.disabled = true;

    try {
        // We use the separate endpoint to ensure we get a fresh link
        const params = new URLSearchParams({ url, itag });
        const response = await fetch(`${API_BASE_URL}/api/get-link?${params.toString()}`);

        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Failed to get link');

        if (type === 'direct') {
            showToast('🚀 Redirecting to download...');
            // Redirect the browser to the direct googlevideo link
            window.location.href = data.direct_url;
        } else {
            ELEMENTS.generatedLinkInput.value = data.direct_url;
            ELEMENTS.linkContainer.classList.remove('hidden');
            showToast('✅ Direct Link generated!');
        }

    } catch (error) {
        showError(error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// Utils
function setLoading(isLoading) {
    if (isLoading) {
        ELEMENTS.fetchBtn.classList.add('loading');
        ELEMENTS.fetchBtn.querySelector('.btn-text').style.display = 'none';
        ELEMENTS.fetchBtn.querySelector('.fa-arrow-right').style.display = 'none';
        ELEMENTS.loader.classList.remove('hidden');
        ELEMENTS.fetchBtn.disabled = true;
    } else {
        ELEMENTS.fetchBtn.classList.remove('loading');
        ELEMENTS.fetchBtn.querySelector('.btn-text').style.display = 'inline';
        ELEMENTS.fetchBtn.querySelector('.fa-arrow-right').style.display = 'inline';
        ELEMENTS.loader.classList.add('hidden');
        ELEMENTS.fetchBtn.disabled = false;
    }
}

function formatDuration(duration) {
    if (!duration) return '00:00';
    // If it's already a string like "10:05", return it
    if (String(duration).includes(':')) return duration;

    // Otherwise treat as seconds
    const seconds = parseInt(duration);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function showError(msg) {
    ELEMENTS.errorMsg.textContent = msg;
    ELEMENTS.errorMsg.classList.remove('hidden');
    showToast('❌ ' + msg);
}

function showToast(msg) {
    const toast = ELEMENTS.toast;
    toast.querySelector('#toast-message').textContent = msg;
    toast.classList.remove('hidden');

    // Reset animation
    toast.style.animation = 'none';
    toast.offsetHeight; /* trigger reflow */
    toast.style.animation = 'slideUp 0.3s ease-out';

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function copyLinkToClipboard() {
    ELEMENTS.generatedLinkInput.select();
    document.execCommand('copy');
    showToast('📋 Link copied!');
}

async function shareLink() {
    const link = ELEMENTS.generatedLinkInput.value;
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Video Direct Link',
                text: 'Direct download link:',
                url: link
            });
            showToast('Shared successfully!');
        } catch (err) {
            console.log('Share canceled');
        }
    } else {
        copyLinkToClipboard();
        showToast('Web Share not supported. Link copied instead.');
    }
}
