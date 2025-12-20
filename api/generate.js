/**
 * NeoClip 340 - Video Generation API v3.5.0
 * 
 * CRITICAL FIXES v3.5.0:
 * 1. Simplified - Uses ONLY Luma via PiAPI (most reliable)
 * 2. No external dependencies - No @supabase/supabase-js
 * 3. Proper PiAPI request format that actually works
 * 4. DEP0169 fix - No req.query access
 * 
 * Cost: ~$0.20 per video via Luma
 */

const PIAPI_BASE_URL = 'https://api.piapi.ai/api/v1';
const FREE_TIER_LIMIT = 10;

/**
 * Make HTTP request with timeout
 */
async function makeRequest(url, options, timeoutMs = 30000) {
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
      console.warn('Response not JSON:', text.slice(0, 200));
    }

    return { 
      status: response.status, 
      data, 
      ok: response.ok,
      error: !response.ok ? (data.error || data.message || `HTTP ${response.status}`) : null
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { status: 408, data: {}, ok: false, error: 'Request timeout' };
    }
    return { status: 0, data: {}, ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate video using Luma via PiAPI
 * This is the CORRECT format that works with PiAPI
 */
async function generateWithLuma(prompt, aspectRatio = '16:9') {
  const apiKey = process.env.PIAPI_KEY || process.env.PIAPI_API_KEY;
  
  if (!apiKey) {
    throw new Error('PIAPI_KEY not configured');
  }

  console.log('[Luma] Starting generation with prompt:', prompt.slice(0, 50) + '...');

  // CORRECT PiAPI format - tested and working
  const requestBody = {
    model: 'luma',
    task_type: 'video_generation',
    input: {
      prompt: prompt,
      expand_prompt: true,
      aspect_ratio: aspectRatio
    }
  };

  console.log('[Luma] Request body:', JSON.stringify(requestBody));

  const { status, data, ok, error } = await makeRequest(
    `${PIAPI_BASE_URL}/task`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-API-Key': apiKey  // Some PiAPI endpoints use this header
      },
      body: JSON.stringify(requestBody)
    }
  );

  console.log('[Luma] Response status:', status);
  console.log('[Luma] Response data:', JSON.stringify(data).slice(0, 500));

  if (!ok) {
    console.error('[Luma] API error:', error);
    throw new Error(`Luma API error: ${error}`);
  }

  // Extract task ID from response
  const taskId = data?.data?.task_id || data?.task_id;
  
  if (!taskId) {
    console.error('[Luma] No task ID in response:', JSON.stringify(data));
    throw new Error('Luma did not return a task ID');
  }

  console.log('[Luma] ✅ Task created:', taskId);

  return {
    taskId: taskId,
    generationId: taskId,
    provider: 'luma',
    providerName: 'Luma',
    cost: 0.20,
    status: 'processing',
    pollUrl: `/api/poll?generationId=${taskId}`,
    message: 'Video generation started'
  };
}

/**
 * Generate unique ID
 */
function generateUniqueId() {
  return `gen_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Main Handler
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    const { 
      prompt, 
      userId,
      tier = 'free',
      aspectRatio = '16:9',
      freeUsed = 0,  // Frontend tracks usage
      testMode = false
    } = req.body || {};

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Prompt is required',
        example: { prompt: 'A cat playing piano', userId: 'user123' }
      });
    }

    const cleanPrompt = prompt.trim().slice(0, 500);

    console.log(`\n========== Generation Request ==========`);
    console.log(`User: ${userId || 'anonymous'}`);
    console.log(`Tier: ${tier}`);
    console.log(`FreeUsed: ${freeUsed}`);
    console.log(`Prompt: ${cleanPrompt.slice(0, 80)}...`);
    console.log(`TestMode: ${testMode}`);

    // Check free tier limit (if not testMode)
    if (!testMode && tier === 'free' && freeUsed >= FREE_TIER_LIMIT) {
      return res.status(402).json({
        error: 'Free limit reached',
        message: `You've used all ${FREE_TIER_LIMIT} free clips this month. Upgrade to Pro for 120 HD clips!`,
        freeUsed: freeUsed,
        freeLimit: FREE_TIER_LIMIT,
        upgradeUrl: '/pricing'
      });
    }

    // Generate video with Luma
    const result = await generateWithLuma(cleanPrompt, aspectRatio);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Task created in ${elapsed}s`);

    return res.status(200).json({
      success: true,
      ...result,
      tier: tier,
      needsAd: tier === 'free' && !testMode,
      testMode: testMode,
      freeUsed: tier === 'free' && !testMode ? freeUsed + 1 : freeUsed,
      freeRemaining: tier === 'free' ? FREE_TIER_LIMIT - freeUsed - 1 : null,
      estimatedTime: '60-180 seconds'
    });

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`❌ Generation failed after ${elapsed}s:`, error.message);

    return res.status(500).json({ 
      success: false,
      error: 'Generation failed',
      message: error.message,
      duration: `${elapsed}s`
    });
  }
}
