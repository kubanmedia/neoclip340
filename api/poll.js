/**
 * NeoClip 340 - Polling API v3.5.0
 * 
 * CRITICAL FIXES v3.5.0:
 * 1. No external dependencies - No @supabase/supabase-js
 * 2. Correct Luma/PiAPI video URL extraction (nested paths)
 * 3. DEP0169 fix - No req.query access
 * 
 * GET /api/poll?generationId=xxx
 * GET /api/poll?taskId=xxx
 */

const PIAPI_BASE_URL = 'https://api.piapi.ai/api/v1';

/**
 * CRITICAL FIX for DEP0169:
 * Parse query parameters using ONLY WHATWG URL API
 */
function getQueryParams(req) {
  try {
    const host = req.headers?.host || req.headers?.['x-forwarded-host'] || 'localhost';
    const protocol = req.headers?.['x-forwarded-proto'] || 'https';
    const baseUrl = `${protocol}://${host}`;
    const fullUrl = new URL(req.url || '/', baseUrl);
    return Object.fromEntries(fullUrl.searchParams);
  } catch (err) {
    console.error('URL parsing error:', err.message);
    return {};
  }
}

/**
 * Make HTTP request with timeout
 */
async function makeRequest(url, options, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    const text = await response.text();
    let data = {};
    try {
      if (text) data = JSON.parse(text);
    } catch (e) {
      console.warn('Response not JSON:', text.slice(0, 100));
    }

    return { status: response.status, data, ok: response.ok, text };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { status: 408, data: {}, ok: false, text: '' };
    }
    return { status: 0, data: {}, ok: false, text: '' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * CRITICAL: Extract video URL from Luma/PiAPI response
 * 
 * PiAPI returns nested structure:
 * {
 *   "code": 200,
 *   "data": {
 *     "status": "completed",
 *     "output": {
 *       "video": { "url": "https://..." },
 *       "video_raw": { "url": "https://..." }
 *     }
 *   }
 * }
 */
function extractVideoUrl(response) {
  // Log all paths for debugging
  console.log('[ExtractURL] Checking paths:');
  console.log('  data.output.video_raw.url:', response?.data?.output?.video_raw?.url);
  console.log('  data.output.video.url:', response?.data?.output?.video?.url);
  console.log('  data.output.video_url:', response?.data?.output?.video_url);

  // Try all possible paths in order of preference
  const url = response?.data?.output?.video_raw?.url ||   // Prefer unwatermarked
              response?.data?.output?.video?.url ||        // Watermarked fallback
              response?.data?.output?.video_url ||         // Flat structure
              response?.data?.video_url ||                 // Direct on data
              response?.output?.video_raw?.url ||          // Without data wrapper
              response?.output?.video?.url ||
              response?.output?.video_url ||
              response?.video_url;

  console.log('  Final URL:', url ? url.slice(0, 60) + '...' : 'NOT FOUND');
  return url;
}

/**
 * Parse status from PiAPI response
 */
function parseStatus(response) {
  const status = (response?.data?.status || response?.status || '').toLowerCase();
  if (status === 'completed' || status === 'succeeded' || status === 'success') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'pending' || status === 'queued') return 'queued';
  return 'processing';
}

/**
 * Poll Luma task status via PiAPI
 */
async function pollLumaTask(taskId) {
  const apiKey = process.env.PIAPI_KEY || process.env.PIAPI_API_KEY;
  
  if (!apiKey) {
    return { status: 'failed', error: 'PIAPI_KEY not configured' };
  }

  const statusUrl = `${PIAPI_BASE_URL}/task/${taskId}`;
  console.log('[Poll] Fetching:', statusUrl);

  const { status: httpStatus, data, ok, text } = await makeRequest(statusUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'X-API-Key': apiKey
    }
  });

  console.log('[Poll] HTTP Status:', httpStatus);
  console.log('[Poll] Response:', text?.slice(0, 500));

  if (httpStatus === 401 || httpStatus === 403) {
    return { status: 'failed', error: 'Authentication error' };
  }

  if (!ok && httpStatus !== 200) {
    return { status: 'processing', progress: 30, warning: `HTTP ${httpStatus}` };
  }

  const taskStatus = parseStatus(data);
  console.log('[Poll] Parsed status:', taskStatus);

  if (taskStatus === 'completed') {
    const videoUrl = extractVideoUrl(data);
    
    if (videoUrl) {
      console.log('[Poll] ✅ Video URL found');
      return { 
        status: 'completed', 
        videoUrl,
        progress: 100
      };
    } else {
      // CRITICAL: Completed but no URL = failed
      console.error('[Poll] ❌ Completed but no video URL!');
      console.error('[Poll] Full response:', JSON.stringify(data, null, 2));
      return { 
        status: 'failed', 
        error: 'Video completed but URL not found in response'
      };
    }
  }

  if (taskStatus === 'failed') {
    const errorMsg = data?.data?.error || data?.error || data?.message || 'Generation failed';
    console.log('[Poll] ❌ Task failed:', errorMsg);
    return { 
      status: 'failed', 
      error: errorMsg
    };
  }

  // Still processing
  const progress = taskStatus === 'queued' ? 15 : 50;
  return { 
    status: taskStatus,
    progress
  };
}

/**
 * Main Handler
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    // CRITICAL: Use WHATWG URL API only
    const query = getQueryParams(req);
    const taskId = query.generationId || query.taskId;

    if (!taskId) {
      return res.status(400).json({ 
        error: 'generationId or taskId is required',
        example: '/api/poll?generationId=xxx'
      });
    }

    console.log(`\n========== Polling: ${taskId} ==========`);

    // Poll Luma via PiAPI
    const result = await pollLumaTask(taskId);

    if (result.status === 'completed') {
      return res.status(200).json({
        success: true,
        status: 'completed',
        videoUrl: result.videoUrl,
        progress: 100,
        provider: 'luma',
        message: 'Video generation completed!'
      });
    }

    if (result.status === 'failed') {
      return res.status(200).json({
        success: false,
        status: 'failed',
        error: result.error,
        progress: 0,
        message: 'Video generation failed'
      });
    }

    // Still processing
    return res.status(200).json({
      success: true,
      status: result.status,
      progress: result.progress || 50,
      message: result.status === 'queued' 
        ? 'Video is queued for processing...'
        : 'Generating video...',
      warning: result.warning
    });

  } catch (error) {
    console.error('[Poll] Error:', error);
    return res.status(500).json({ 
      error: 'Poll failed',
      message: error.message
    });
  }
}
