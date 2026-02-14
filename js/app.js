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
    ELEMENTS.views.textContent = `${data.views} views`;
    ELEMENTS.duration.textContent = data.duration;

    // Populate Qualities
    ELEMENTS.qualitySelect.innerHTML = '';
    data.formats.forEach(format => {
        const option = document.createElement('option');
        option.value = format.itag; // Use itag or qualityLabel
        option.textContent = `${format.quality} (${format.container})${format.hasAudio ? '' : ' (No Audio)'}`;
        option.dataset.qualityLabel = format.quality; // Store for backend
        ELEMENTS.qualitySelect.appendChild(option);
    });

    ELEMENTS.resultSection.classList.remove('hidden');
    ELEMENTS.linkContainer.classList.add('hidden');
}

async function handleDownload(type) {
    const qualityLabel = ELEMENTS.qualitySelect.value;

    if (type === 'direct') {
        // Direct Download: Use Form Submit to trigger browser download
        downloadDirectly(ELEMENTS.urlInput.value, qualityLabel);
    } else {
        // Generate Link
        await generateLink(ELEMENTS.urlInput.value, qualityLabel);
    }
}

function downloadDirectly(url, quality) {
    showToast('⬇️ Starting download...');

    // Create hidden form
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${API_BASE_URL}/api/download`;
    form.style.display = 'none';

    const inputUrl = document.createElement('input');
    inputUrl.name = 'url';
    inputUrl.value = url;

    const inputQuality = document.createElement('input');
    inputQuality.name = 'quality';
    inputQuality.value = quality;

    const inputType = document.createElement('input');
    inputType.name = 'type';
    inputType.value = 'direct';

    form.appendChild(inputUrl);
    form.appendChild(inputQuality);
    form.appendChild(inputType);

    document.body.appendChild(form);
    form.submit();

    setTimeout(() => document.body.removeChild(form), 1000);
}

async function generateLink(url, quality) {
    const btn = ELEMENTS.downloadLinkBtn;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<div class="loader"></div> Generating...';
    btn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, quality, type: 'link' })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to generate link');

        const fullLink = window.location.origin + data.url;
        ELEMENTS.generatedLinkInput.value = fullLink;
        ELEMENTS.linkContainer.classList.remove('hidden');
        showToast('✅ Link generated!');

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
                title: 'Video Download Link',
                text: 'Check out this video download link:',
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
