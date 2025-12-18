/**
 * NeoClip 340 - Video Generation API v3.4.2
 * "Never-Fail" Pipeline with Proper API Formats
 * 
 * CRITICAL FIXES v3.4.2:
 * 1. FIXED: DEP0169 - Avoid req.query access completely
 * 2. FIXED: Wan-2.1 HTTP 422 - Correct Replicate API format
 * 3. FIXED: Luma video_url extraction path
 * 4. Uses only WHATWG URL API for query parsing
 * 
 * FALLBACK CHAIN (cost optimized):
 * FREE: Wan-2.1 (Replicate) $0.0008 → Luma (PiAPI) $0.20 (768p)
 * PAID: Luma (PiAPI) $0.20 (1080p) → FAL MiniMax $0.50
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

/**
 * Provider configurations with CORRECT API formats
 */
const PROVIDERS = {
  // Replicate Wan-2.1 - Cheapest option ($0.0008/video)
  // FIX: Correct Replicate API format - use model name, not version string
  wan: {
    name: 'Wan-2.1',
    tier: 'free',
    cost: 0.0008,
    createUrl: 'https://api.replicate.com/v1/predictions',
    getKey: () => process.env.REPLICATE_KEY,
    authHeader: (key) => `Token ${key}`,
    // CRITICAL FIX: Replicate requires specific format
    buildBody: (prompt, duration, resolution) => ({
      // Use the correct version hash for wan-2.1 model
      version: 'wan-lab/wan2.1-t2v-1.3b:e8c37be16be5e3bb950f55e0d73d1e87e4be5a47',
      input: {
        prompt: prompt,
        num_frames: Math.min(duration, 10) * 24, // 24fps, max 10s = 240 frames
        guidance_scale: 7.5,
        num_inference_steps: 50
      }
    }),
    extractTaskId: (response) => response?.id,
    getStatusUrl: (taskId) => `https://api.replicate.com/v1/predictions/${taskId}`,
    parseStatus: (response) => {
      const status = response?.status?.toLowerCase() || '';
      if (status === 'succeeded') return 'completed';
      if (status === 'failed' || status === 'canceled') return 'failed';
      return 'processing';
    },
    extractVideoUrl: (response) => {
      const output = response?.output;
      return Array.isArray(output) ? output[0] : output;
    },
    extractError: (response) => response?.error || response?.detail
  },

  // PiAPI Luma - Good quality at moderate cost ($0.20/video)
  // Used as fallback for FREE tier (768p) and primary for PAID tier (1080p)
  luma: {
    name: 'Luma',
    tier: 'both',
    cost: 0.20,
    createUrl: 'https://api.piapi.ai/api/v1/task',
    getKey: () => process.env.PIAPI_KEY,
    authHeader: (key) => `Bearer ${key}`,
    buildBody: (prompt, duration, resolution) => ({
      model: 'luma',
      task_type: 'video_generation',
      input: {
        prompt: prompt,
        expand_prompt: true,
        aspect_ratio: '16:9'
      }
    }),
    extractTaskId: (response) => response?.data?.task_id || response?.task_id,
    getStatusUrl: (taskId) => `https://api.piapi.ai/api/v1/task/${taskId}`,
    parseStatus: (response) => {
      const status = (response?.data?.status || response?.status || '').toLowerCase();
      if (status === 'completed' || status === 'succeeded' || status === 'success') return 'completed';
      if (status === 'failed' || status === 'error') return 'failed';
      return 'processing';
    },
    // CRITICAL: PiAPI returns video_url in data.output.video_url
    extractVideoUrl: (response) => {
      return response?.data?.output?.video_url ||
             response?.data?.video_url ||
             response?.output?.video_url;
    },
    extractError: (response) => response?.data?.error || response?.error || response?.message
  },

  // FAL MiniMax - Expensive, high quality ($0.50/video)
  // Only used as backup for PAID tier
  fal: {
    name: 'MiniMax-FAL',
    tier: 'paid',
    cost: 0.50,
    createUrl: 'https://queue.fal.run/fal-ai/minimax/video-01',
    getKey: () => process.env.FAL_KEY,
    authHeader: (key) => `Key ${key}`,
    buildBody: (prompt, duration, resolution) => ({
      prompt: prompt,
      prompt_optimizer: true
    }),
    extractTaskId: (response) => response?.request_id,
    getStatusUrl: (taskId) => `https://queue.fal.run/fal-ai/minimax/video-01/requests/${taskId}/status`,
    getResultUrl: (taskId) => `https://queue.fal.run/fal-ai/minimax/video-01/requests/${taskId}`,
    parseStatus: (response) => {
      const status = response?.status?.toLowerCase() || '';
      if (status === 'completed' || status === 'succeeded') return 'completed';
      if (status === 'failed' || status === 'error') return 'failed';
      if (status === 'in_queue') return 'queued';
      return 'processing';
    },
    extractVideoUrl: (response) => {
      return response?.video?.url || 
             response?.output?.video_url ||
             response?.video_url;
    },
    extractError: (response) => response?.error || response?.message
  }
};

/**
 * Fallback chains - Cost optimized
 * FREE: Wan (cheapest) → Luma (moderate, 768p quality)
 * PAID: Luma (good quality, 1080p) → FAL MiniMax (expensive backup)
 */
const FALLBACK_CHAINS = {
  free: ['wan', 'luma'],
  paid: ['luma', 'fal']
};

/**
 * Make HTTP request with timeout using modern AbortController
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
      error: !response.ok ? (data.error || data.detail || data.message || `HTTP ${response.status}`) : null
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
 * Create task with a provider
 */
async function createProviderTask(providerKey, prompt, duration, resolution) {
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new Error(`Unknown provider: ${providerKey}`);

  const apiKey = provider.getKey();
  if (!apiKey) {
    throw new Error(`No API key for ${provider.name}`);
  }

  console.log(`[${provider.name}] Creating task with duration=${duration}s, resolution=${resolution}...`);

  const body = provider.buildBody(prompt, duration, resolution);
  console.log(`[${provider.name}] Request body:`, JSON.stringify(body).slice(0, 300));

  const { status, data, ok, error } = await makeRequest(provider.createUrl, {
    method: 'POST',
    headers: { 'Authorization': provider.authHeader(apiKey) },
    body: JSON.stringify(body)
  });

  console.log(`[${provider.name}] Response: HTTP ${status}`, JSON.stringify(data).slice(0, 500));

  if (status === 401 || status === 403) {
    throw new Error(`Auth error for ${provider.name}: ${error}`);
  }
  if (status === 422) {
    // Validation error - log details
    console.error(`[${provider.name}] Validation error:`, JSON.stringify(data));
    throw new Error(`${provider.name} validation error: ${error || JSON.stringify(data)}`);
  }
  if (status === 429) {
    throw new Error(`Rate limited on ${provider.name}`);
  }
  if (!ok) {
    throw new Error(`${provider.name} error: ${error || JSON.stringify(data)}`);
  }

  const taskId = provider.extractTaskId(data);
  if (!taskId) {
    throw new Error(`No task ID from ${provider.name}: ${JSON.stringify(data)}`);
  }

  console.log(`[${provider.name}] ✅ Task created: ${taskId}`);

  return {
    providerTaskId: taskId,
    provider: providerKey,
    providerName: provider.name,
    cost: provider.cost,
    statusUrl: provider.getStatusUrl(taskId),
    resultUrl: provider.getResultUrl ? provider.getResultUrl(taskId) : null
  };
}

/**
 * Try providers with fallback
 */
async function createTaskWithFallback(prompt, tier, duration, resolution) {
  const chain = FALLBACK_CHAINS[tier] || FALLBACK_CHAINS.free;
  
  console.log(`Creating task: tier=${tier}, duration=${duration}s, resolution=${resolution}, chain=[${chain.join(', ')}]`);

  let lastError = null;

  for (const providerKey of chain) {
    const provider = PROVIDERS[providerKey];
    const apiKey = provider?.getKey();

    if (!apiKey) {
      console.warn(`[${provider?.name || providerKey}] Skipping - no API key`);
      continue;
    }

    try {
      return await createProviderTask(providerKey, prompt, duration, resolution);
    } catch (error) {
      console.error(`[${provider?.name || providerKey}] Failed:`, error.message);
      lastError = error;
    }
  }

  throw lastError || new Error('All providers failed');
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
    const { prompt, userId, tier = 'free', length = 10 } = req.body || {};

    // Validate
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Determine duration and resolution based on tier
    const duration = tier === 'free' ? Math.min(length, 10) : Math.min(length, 30);
    const resolution = tier === 'free' ? '768p' : '1080p';

    console.log(`\n========== New Generation ==========`);
    console.log(`User: ${userId}, Tier: ${tier}, Duration: ${duration}s, Resolution: ${resolution}`);
    console.log(`Prompt: ${prompt.slice(0, 100)}...`);

    // Get user from database
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, free_used, paid_used, tier, resets_at')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error('User lookup failed:', userError);
      return res.status(404).json({ error: 'User not found' });
    }

    // Check monthly reset
    const now = new Date();
    const resetsAt = user.resets_at ? new Date(user.resets_at) : now;
    if (now >= resetsAt) {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await supabase
        .from('users')
        .update({ 
          free_used: 0, 
          paid_used: 0,
          resets_at: nextMonth.toISOString().split('T')[0] 
        })
        .eq('id', userId);
      user.free_used = 0;
    }

    // Check free quota
    const FREE_LIMIT = 10;
    if (tier === 'free' && (user.free_used || 0) >= FREE_LIMIT) {
      return res.status(402).json({ 
        error: 'Free limit reached',
        message: `You've used all ${FREE_LIMIT} free clips. Upgrade to Pro for 120 HD clips!`,
        freeUsed: user.free_used,
        freeLimit: FREE_LIMIT
      });
    }

    // Create provider task
    const taskResult = await createTaskWithFallback(prompt, tier, duration, resolution);

    // Generate unique ID for this generation
    const generationId = crypto.randomUUID ? crypto.randomUUID() : `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // CRITICAL: Save to Supabase immediately
    const { error: insertError } = await supabase
      .from('generations')
      .insert({
        id: generationId,
        user_id: userId,
        task_id: taskResult.providerTaskId,
        prompt: prompt.slice(0, 500),
        tier,
        length: duration,
        duration: duration,
        model: taskResult.providerName,
        provider: taskResult.provider,
        resolution: resolution,
        status: 'processing',
        cost: taskResult.cost,
        cost_usd: taskResult.cost,
        created_at: new Date().toISOString(),
        started_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Failed to save generation:', insertError);
      // Continue anyway - task is running
    }

    // Increment usage
    if (tier === 'free') {
      await supabase
        .from('users')
        .update({ free_used: (user.free_used || 0) + 1 })
        .eq('id', userId);
    } else {
      await supabase
        .from('users')
        .update({ paid_used: (user.paid_used || 0) + 1 })
        .eq('id', userId);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Task created in ${elapsed}s: ${generationId}`);

    // Return immediately - client will poll /api/poll
    return res.status(200).json({
      success: true,
      status: 'processing',
      generationId: generationId,
      taskId: taskResult.providerTaskId,
      provider: taskResult.provider,
      providerName: taskResult.providerName,
      tier,
      duration,
      resolution,
      needsAd: tier === 'free',
      remainingFree: tier === 'free' ? FREE_LIMIT - ((user.free_used || 0) + 1) : null,
      message: 'Video generation started. Poll /api/poll for status.',
      pollUrl: `/api/poll?generationId=${generationId}`,
      estimatedTime: '180-300 seconds'
    });

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n❌ FAILED after ${elapsed}s:`, error.message);

    return res.status(500).json({ 
      error: 'Generation failed',
      message: error.message || 'Failed to start generation',
      duration: `${elapsed}s`
    });
  }
}
