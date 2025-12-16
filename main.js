/**
 * NeoClip Frontend v3.4.0
 * Complete rewrite with proper polling and Library screen
 * 
 * FIXES:
 * 1. Increased poll timeout to 5 minutes (FAL takes 180-300s)
 * 2. Proper error handling and progress display
 * 3. Added Library screen to view generated videos
 * 4. Videos are displayed from Supabase, not lost
 */

// Configuration
const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : window.location.origin;

// Polling configuration - CRITICAL: FAL takes 180-300 seconds!
const POLL_INTERVAL_MS = 5000;      // Poll every 5 seconds
const MAX_POLL_TIME_MS = 360000;    // Max 6 minutes (FAL takes up to 5 min)

// State
let currentUser = null;
let selectedTier = 'free';
let currentVideoUrl = null;
let generations = [];
let pollTimer = null;
let pollStartTime = null;
let currentScreen = 'home';  // 'home', 'library', 'player'

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});

function setupEventListeners() {
    const promptInput = document.getElementById('promptInput');
    if (promptInput) {
        promptInput.addEventListener('input', (e) => {
            const charCount = document.getElementById('charCount');
            if (charCount) {
                charCount.textContent = e.target.value.length;
            }
        });
    }
}

async function initializeApp() {
    try {
        const deviceId = getDeviceId();
        const response = await fetch(`${API_BASE_URL}/api/user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId })
        });

        const data = await response.json();

        if (data.success && data.user) {
            currentUser = data.user;
            updateUserStats();
            await loadUserGenerations();
        } else {
            showError('Failed to initialize. Please refresh.');
        }
    } catch (error) {
        console.error('Init error:', error);
        showError('Connection failed. Check your internet.');
    }
}

function getDeviceId() {
    let deviceId = localStorage.getItem('neoclip_device_id');
    if (!deviceId) {
        deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem('neoclip_device_id', deviceId);
    }
    return deviceId;
}

function updateUserStats() {
    if (!currentUser) return;

    const freeRemaining = 10 - (currentUser.free_used || 0);
    const resetsAt = currentUser.resets_at ? new Date(currentUser.resets_at) : new Date();
    const now = new Date();
    const daysUntilReset = Math.max(0, Math.ceil((resetsAt - now) / (1000 * 60 * 60 * 24)));

    const freeEl = document.getElementById('freeRemaining');
    const daysEl = document.getElementById('daysUntilReset');

    if (freeEl) freeEl.textContent = Math.max(0, freeRemaining);
    if (daysEl) daysEl.textContent = daysUntilReset;
}

function selectTier(tier) {
    selectedTier = tier;
    
    document.querySelectorAll('.tier-button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tier === tier) {
            btn.classList.add('active');
        }
    });

    const buttonText = document.getElementById('buttonText');
    if (buttonText) {
        buttonText.textContent = tier === 'free' 
            ? '🚀 Generate 10s FREE Video' 
            : '⭐ Generate 30s HD Video (Pro)';
    }
}

// ============================================
// VIDEO GENERATION WITH PROPER POLLING
// ============================================

async function generateVideo() {
    const promptInput = document.getElementById('promptInput');
    const prompt = promptInput ? promptInput.value.trim() : '';

    if (!prompt) {
        showError('Please enter a prompt');
        return;
    }

    if (!currentUser) {
        showError('Not initialized. Refresh page.');
        return;
    }

    stopPolling();
    showLoadingUI('Starting video generation...');

    try {
        // Step 1: Create generation task
        const response = await fetch(`${API_BASE_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                userId: currentUser.id,
                tier: selectedTier,
                length: selectedTier === 'free' ? 10 : 30
            })
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 402) {
                showError(data.message || 'Free limit reached. Upgrade to Pro!');
                setTimeout(() => handleUpgrade(), 2000);
                return;
            }
            throw new Error(data.error || data.message || 'Generation failed');
        }

        if (!data.success || !data.generationId) {
            throw new Error(data.error || 'Invalid response');
        }

        console.log('Generation started:', data);
        
        // Update stats immediately
        if (data.remainingFree !== null) {
            currentUser.free_used = 10 - data.remainingFree;
            updateUserStats();
        }

        // Update UI
        updateLoadingUI(`Generating with ${data.providerName || 'AI'}...`, 15);
        showMessage('⏱️ Video generation takes 3-5 minutes. Please wait...');

        // Step 2: Start polling
        pollStartTime = Date.now();
        startPolling(data.generationId, data.needsAd);

    } catch (error) {
        console.error('Generation error:', error);
        showError(error.message || 'Failed to start generation');
        hideLoadingUI();
    }
}

function startPolling(generationId, needsAd) {
    console.log(`Starting poll for ${generationId}`);
    
    const poll = async () => {
        const elapsed = Date.now() - pollStartTime;
        
        // Check timeout - 6 minutes max
        if (elapsed > MAX_POLL_TIME_MS) {
            stopPolling();
            showError('Generation timed out after 6 minutes. Please try again.');
            hideLoadingUI();
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/poll?generationId=${generationId}`);
            const data = await response.json();

            console.log('Poll response:', data);

            // Update progress
            const progress = data.progress || Math.min(20 + Math.floor(elapsed / 10000) * 5, 90);
            updateLoadingUI(data.message || `Generating... ${progress}%`, progress);

            if (data.status === 'completed' && data.videoUrl) {
                // SUCCESS!
                stopPolling();
                updateLoadingUI('Video ready!', 100);
                
                currentVideoUrl = data.videoUrl;
                displayVideo(data.videoUrl, needsAd);
                
                // Reload library
                await loadUserGenerations();
                hideLoadingUI();
                showMessage('✅ Video generated successfully!');
                return;
            }

            if (data.status === 'failed') {
                stopPolling();
                showError(data.error || 'Generation failed');
                hideLoadingUI();
                await loadUserGenerations();
                return;
            }

            // Still processing - schedule next poll
            pollTimer = setTimeout(poll, POLL_INTERVAL_MS);

        } catch (error) {
            console.error('Poll error:', error);
            // Don't stop on poll errors, retry
            pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
        }
    };

    poll();
}

function stopPolling() {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    pollStartTime = null;
}

// ============================================
// UI HELPERS
// ============================================

function showLoadingUI(message) {
    const generateButton = document.getElementById('generateButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const loadingText = document.getElementById('loadingText');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const errorContainer = document.getElementById('errorContainer');
    const videoContainer = document.getElementById('videoContainer');

    if (generateButton) generateButton.disabled = true;
    if (loadingIndicator) loadingIndicator.classList.remove('hidden');
    if (loadingText) loadingText.textContent = message;
    if (progressBar) progressBar.classList.remove('hidden');
    if (progressFill) progressFill.style.width = '5%';
    if (errorContainer) errorContainer.classList.add('hidden');
    if (videoContainer) videoContainer.classList.add('hidden');
}

function updateLoadingUI(message, progress) {
    const loadingText = document.getElementById('loadingText');
    const progressFill = document.getElementById('progressFill');
    
    if (loadingText) loadingText.textContent = message;
    if (progressFill) progressFill.style.width = `${Math.min(progress, 99)}%`;
}

function hideLoadingUI() {
    const generateButton = document.getElementById('generateButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const progressBar = document.getElementById('progressBar');

    if (generateButton) generateButton.disabled = false;
    if (loadingIndicator) loadingIndicator.classList.add('hidden');
    if (progressBar) progressBar.classList.add('hidden');
}

function displayVideo(videoUrl, showAd = false) {
    const videoContainer = document.getElementById('videoContainer');
    const videoPlayer = document.getElementById('videoPlayer');
    const adBanner = document.getElementById('adBanner');

    if (videoPlayer) {
        videoPlayer.src = videoUrl;
        videoPlayer.load();
    }
    if (videoContainer) videoContainer.classList.remove('hidden');

    if (adBanner) {
        if (showAd || selectedTier === 'free') {
            adBanner.classList.remove('hidden');
        } else {
            adBanner.classList.add('hidden');
        }
    }

    if (videoContainer) {
        videoContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// ============================================
// LIBRARY / HISTORY
// ============================================

async function loadUserGenerations() {
    if (!currentUser) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/status?userId=${currentUser.id}`);
        const data = await response.json();

        if (data.success) {
            if (data.generations) {
                generations = data.generations;
                displayGenerations();
            }
            if (data.user) {
                currentUser.free_used = data.user.freeUsed;
                currentUser.resets_at = data.user.resetsAt;
                updateUserStats();
            }
        }
    } catch (error) {
        console.error('Failed to load generations:', error);
    }
}

function displayGenerations() {
    const historyContainer = document.getElementById('historyContainer');
    const historyList = document.getElementById('historyList');

    if (!historyContainer || !historyList) return;

    // Filter completed generations with video URLs
    const completedVideos = generations.filter(g => g.status === 'completed' && g.videoUrl);

    if (completedVideos.length === 0) {
        historyContainer.classList.add('hidden');
        return;
    }

    historyContainer.classList.remove('hidden');
    historyList.innerHTML = '';

    // Show recent 10 videos
    completedVideos.slice(0, 10).forEach(gen => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
            <div class="history-prompt">${escapeHtml(gen.prompt || 'Untitled')}</div>
            <div class="history-meta">
                <span class="history-tier">${gen.tier === 'free' ? '🎬 Free' : '⭐ Pro'}</span>
                <span class="history-time">${formatTime(gen.createdAt)}</span>
            </div>
        `;
        item.addEventListener('click', () => {
            if (gen.videoUrl) {
                currentVideoUrl = gen.videoUrl;
                displayVideo(gen.videoUrl, gen.tier === 'free');
            }
        });
        historyList.appendChild(item);
    });
}

function showLibrary() {
    // Show all videos in an expanded view
    const completedVideos = generations.filter(g => g.status === 'completed' && g.videoUrl);
    
    if (completedVideos.length === 0) {
        showMessage('No videos yet. Generate your first video!');
        return;
    }

    // Create library modal/overlay
    let library = document.getElementById('libraryOverlay');
    if (!library) {
        library = document.createElement('div');
        library.id = 'libraryOverlay';
        library.className = 'library-overlay';
        document.body.appendChild(library);
    }

    library.innerHTML = `
        <div class="library-content">
            <div class="library-header">
                <h2>📚 Your Video Library</h2>
                <button class="close-btn" onclick="closeLibrary()">✕</button>
            </div>
            <div class="library-grid">
                ${completedVideos.map(gen => `
                    <div class="library-item" onclick="playFromLibrary('${escapeHtml(gen.videoUrl)}', '${gen.tier}')">
                        <div class="library-preview">
                            <video src="${escapeHtml(gen.videoUrl)}" muted></video>
                            <div class="play-icon">▶</div>
                        </div>
                        <div class="library-info">
                            <p class="library-prompt">${escapeHtml(gen.prompt || 'Untitled')}</p>
                            <span class="library-date">${formatTime(gen.createdAt)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    library.classList.add('visible');
}

function closeLibrary() {
    const library = document.getElementById('libraryOverlay');
    if (library) {
        library.classList.remove('visible');
    }
}

function playFromLibrary(videoUrl, tier) {
    closeLibrary();
    currentVideoUrl = videoUrl;
    displayVideo(videoUrl, tier === 'free');
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatTime(isoString) {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString();
    } catch {
        return '';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function downloadVideo() {
    if (!currentVideoUrl) return;

    const a = document.createElement('a');
    a.href = currentVideoUrl;
    a.download = `neoclip-${Date.now()}.mp4`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function shareVideo() {
    if (!currentVideoUrl) return;

    const shareData = {
        title: 'My NeoClip Video',
        text: 'Created with NeoClip AI - Free AI video generator!',
        url: currentVideoUrl
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            await navigator.clipboard.writeText(currentVideoUrl);
            showMessage('Video URL copied!');
        }
    } catch (error) {
        console.error('Share failed:', error);
    }
}

function resetUI() {
    const promptInput = document.getElementById('promptInput');
    const charCount = document.getElementById('charCount');
    const videoContainer = document.getElementById('videoContainer');
    const errorContainer = document.getElementById('errorContainer');

    if (promptInput) promptInput.value = '';
    if (charCount) charCount.textContent = '0';
    if (videoContainer) videoContainer.classList.add('hidden');
    if (errorContainer) errorContainer.classList.add('hidden');
    currentVideoUrl = null;
    stopPolling();
}

function handleUpgrade() {
    alert(`🌟 Upgrade to Pro - Coming Soon!

✅ 120 HD clips per month
✅ 30-second max length
✅ 1080p quality
✅ No ads
✅ Priority processing

Only $4.99/month`);
}

function showError(message) {
    const errorContainer = document.getElementById('errorContainer');
    const errorMessage = document.getElementById('errorMessage');

    if (errorMessage) errorMessage.textContent = message;
    if (errorContainer) errorContainer.classList.remove('hidden');

    setTimeout(() => {
        if (errorContainer) errorContainer.classList.add('hidden');
    }, 8000);
}

function showMessage(message) {
    // Simple toast notification
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    
    toast.textContent = message;
    toast.classList.add('visible');
    
    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}

// ============================================
// SCREEN NAVIGATION
// ============================================

function showScreen(screen) {
    currentScreen = screen;
    
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (screen === 'home') {
        // Show home screen elements
        document.querySelector('.nav-btn[onclick*="home"]')?.classList.add('active');
        closeLibrary();
    } else if (screen === 'library') {
        document.querySelector('.nav-btn[onclick*="Library"]')?.classList.add('active');
        showLibrary();
    }
}

// Global exports
window.selectTier = selectTier;
window.generateVideo = generateVideo;
window.downloadVideo = downloadVideo;
window.shareVideo = shareVideo;
window.resetUI = resetUI;
window.handleUpgrade = handleUpgrade;
window.showLibrary = showLibrary;
window.closeLibrary = closeLibrary;
window.playFromLibrary = playFromLibrary;
window.showScreen = showScreen;
