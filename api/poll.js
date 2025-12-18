/**
 * NeoClip 340 - Polling API v3.4.2
 * Properly polls provider status and saves completed videos to Supabase
 * 
 * CRITICAL FIXES v3.4.2:
 * 1. FIXED: DEP0169 - Completely avoid req.query access (triggers url.parse internally)
 * 2. FIXED: "Video completed but URL not found" - Correct Luma video_url extraction
 * 3. Uses only WHATWG URL API for query parsing
 * 4. Enhanced logging for debugging
 * 
 * GET /api/poll?generationId=xxx
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

/**
 * Provider configurations for polling
 * CRITICAL: extractVideoUrl must match actual API response structure
 */
const PROVIDERS = {
  wan: {
    name: 'Wan-2.1',
    getKey: () => process.env.REPLICATE_KEY,
    authHeader: (key) => `Token ${key}`,
    getStatusUrl: (taskId) => `https://api.replicate.com/v1/predictions/${taskId}`,
    parseStatus: (response) => {
      const status = response?.status?.toLowerCase() || '';
      if (status === 'succeeded') return 'completed';
      if (status === 'failed' || status === 'canceled') return 'failed';
      if (status === 'starting') return 'queued';
      return 'processing';
    },
    // Replicate returns output as array or string directly
    extractVideoUrl: (response) => {
      const output = response?.output;
      if (Array.isArray(output)) return output[0];
      if (typeof output === 'string') return output;
      return null;
    },
    extractError: (response) => response?.error,
    extractProgress: (response) => {
      const status = response?.status?.toLowerCase() || '';
      if (status === 'succeeded') return 100;
      if (status === 'starting') return 10;
      const logs = response?.logs || '';
      const match = logs.match(/(\d+)%/);
      if (match) return parseInt(match[1], 10);
      return 40;
    }
  },

  fal: {
    name: 'MiniMax-FAL',
    getKey: () => process.env.FAL_KEY,
    authHeader: (key) => `Key ${key}`,
    getStatusUrl: (taskId) => `https://queue.fal.run/fal-ai/minimax/video-01/requests/${taskId}/status`,
    getResultUrl: (taskId) => `https://queue.fal.run/fal-ai/minimax/video-01/requests/${taskId}`,
    parseStatus: (response) => {
      const status = response?.status?.toLowerCase() || '';
      if (status === 'completed' || status === 'succeeded') return 'completed';
      if (status === 'failed' || status === 'error') return 'failed';
      if (status === 'in_queue') return 'queued';
      return 'processing';
    },
    // FAL returns video URL in multiple possible locations
    extractVideoUrl: (response) => {
      return response?.video?.url || 
             response?.output?.video_url ||
             response?.video_url ||
             response?.result?.video?.url;
    },
    extractError: (response) => response?.error || response?.message,
    extractProgress: (response) => {
      const status = response?.status?.toLowerCase() || '';
      if (status === 'completed') return 100;
      if (status === 'in_queue') return 15;
      if (response?.logs) return 60;
      return 40;
    }
  },

  luma: {
    name: 'Luma',
    getKey: () => process.env.PIAPI_KEY,
    authHeader: (key) => `Bearer ${key}`,
    getStatusUrl: (taskId) => `https://api.piapi.ai/api/v1/task/${taskId}`,
    parseStatus: (response) => {
      // PiAPI wraps response in data object
      const status = (response?.data?.status || response?.status || '').toLowerCase();
      if (status === 'completed' || status === 'succeeded' || status === 'success') return 'completed';
      if (status === 'failed' || status === 'error') return 'failed';
      if (status === 'pending' || status === 'queued') return 'queued';
      return 'processing';
    },
    // CRITICAL FIX: PiAPI Luma returns video_url in data.output.video_url
    // Based on actual log: {"code":200,"data":{"output":{"video_url":"https://..."}}}
    extractVideoUrl: (response) => {
      // Try all possible paths for video URL
      const url = response?.data?.output?.video_url ||  // Most common path
                  response?.data?.video_url ||
                  response?.output?.video_url ||
                  response?.video_url ||
                  response?.data?.output?.url ||
                  response?.data?.url;
      
      console.log('[Luma] Extracting video URL from paths:');
      console.log('  data.output.video_url:', response?.data?.output?.video_url);
      console.log('  data.video_url:', response?.data?.video_url);
      console.log('  Final URL:', url);
      
      return url;
    },
    extractError: (response) => response?.data?.error || response?.error || response?.message,
    extractProgress: (response) => {
      const status = (response?.data?.status || response?.status || '').toLowerCase();
      if (status === 'completed') return 100;
      if (status === 'pending' || status === 'queued') return 15;
      const progress = response?.data?.progress || response?.progress;
      if (progress) return Math.min(progress, 95);
      return 50;
    }
  }
};

/**
 * CRITICAL FIX for DEP0169:
 * Parse query parameters using ONLY WHATWG URL API
 * NEVER access req.query - it triggers internal url.parse() in Vercel/Node
 */
function getQueryParams(req) {
  try {
    // ALWAYS use WHATWG URL API, NEVER req.query
    // req.query access triggers url.parse() internally in Vercel's request handling
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
 * Poll provider for task status
 */
async function pollProvider(providerKey, taskId) {
  const config = PROVIDERS[providerKey];
  if (!config) {
    return { status: 'failed', error: `Unknown provider: ${providerKey}` };
  }

  const apiKey = config.getKey();
  if (!apiKey) {
    return { status: 'failed', error: `No API key for ${config.name}` };
  }

  try {
    // Get status
    const statusUrl = config.getStatusUrl(taskId);
    console.log(`[${config.name}] Polling: ${statusUrl}`);
    
    let { status: httpStatus, data, ok, text } = await makeRequest(statusUrl, {
      method: 'GET',
      headers: { 'Authorization': config.authHeader(apiKey) }
    });

    // Log full response for debugging (truncated for very long responses)
    const logText = text.length > 500 ? text.slice(0, 500) + '...[truncated]' : text;
    console.log(`[${config.name}] Status: HTTP ${httpStatus}`, logText);

    if (httpStatus === 401 || httpStatus === 403) {
      return { status: 'failed', error: 'Authentication error' };
    }

    const taskStatus = config.parseStatus(data);
    const progress = config.extractProgress(data);

    console.log(`[${config.name}] Parsed status: ${taskStatus}, progress: ${progress}`);

    if (taskStatus === 'completed') {
      // Try to get video URL
      let videoUrl = config.extractVideoUrl(data);
      
      // For FAL, might need to fetch result separately
      if (!videoUrl && config.getResultUrl) {
        const resultUrl = config.getResultUrl(taskId);
        console.log(`[${config.name}] Fetching result separately: ${resultUrl}`);
        
        const resultResponse = await makeRequest(resultUrl, {
          method: 'GET',
          headers: { 'Authorization': config.authHeader(apiKey) }
        });
        
        if (resultResponse.ok) {
          console.log(`[${config.name}] Result response:`, resultResponse.text?.slice(0, 300));
          videoUrl = config.extractVideoUrl(resultResponse.data);
        }
      }

      if (videoUrl) {
        console.log(`[${config.name}] ✅ Video URL found: ${videoUrl.slice(0, 80)}...`);
        return { status: 'completed', videoUrl, progress: 100 };
      } else {
        // Log the full data structure for debugging
        console.error(`[${config.name}] ❌ Video URL NOT found in response!`);
        console.error(`[${config.name}] Full response data:`, JSON.stringify(data, null, 2).slice(0, 1000));
        return { status: 'failed', error: 'Video completed but URL not found in response' };
      }
    }

    if (taskStatus === 'failed') {
      const errorMsg = config.extractError(data) || 'Generation failed';
      console.log(`[${config.name}] ❌ Task failed: ${errorMsg}`);
      return { 
        status: 'failed', 
        error: errorMsg
      };
    }

    // Still processing
    return { 
      status: taskStatus,
      progress
    };

  } catch (error) {
    console.error(`[${config.name}] Poll error:`, error.message);
    return { 
      status: 'processing',
      progress: 30,
      warning: error.message
    };
  }
}

/**
 * Main Handler - GET only
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // CRITICAL: Accept GET method only
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    // CRITICAL: Use WHATWG URL API only, avoid req.query
    const query = getQueryParams(req);
    const generationId = query.generationId;

    if (!generationId) {
      return res.status(400).json({ error: 'generationId is required' });
    }

    console.log(`\n========== Polling generation: ${generationId} ==========`);

    // Get generation from database
    const { data: generation, error: dbError } = await supabase
      .from('generations')
      .select('*')
      .eq('id', generationId)
      .single();

    if (dbError || !generation) {
      console.error('Generation not found:', dbError);
      return res.status(404).json({ 
        error: 'Generation not found',
        generationId 
      });
    }

    console.log(`Provider: ${generation.provider}, TaskId: ${generation.task_id}, Status: ${generation.status}`);

    // If already completed, return cached result
    if (generation.status === 'completed' && generation.video_url) {
      console.log('✅ Returning cached completed generation');
      return res.status(200).json({
        success: true,
        status: 'completed',
        videoUrl: generation.video_url,
        thumbnailUrl: generation.thumbnail_url,
        progress: 100,
        model: generation.model,
        tier: generation.tier,
        duration: generation.duration || generation.length,
        generationTime: generation.total_time_ms ? `${(generation.total_time_ms / 1000).toFixed(1)}s` : null,
        needsAd: generation.tier === 'free'
      });
    }

    // If already failed, return error
    if (generation.status === 'failed') {
      return res.status(200).json({
        success: false,
        status: 'failed',
        error: generation.error || 'Generation failed',
        progress: 0
      });
    }

    // Poll the provider
    const pollResult = await pollProvider(generation.provider, generation.task_id);

    // Update database based on result
    if (pollResult.status === 'completed' && pollResult.videoUrl) {
      const completedAt = new Date().toISOString();
      const startedAt = new Date(generation.started_at || generation.created_at);
      const totalTimeMs = Date.now() - startedAt.getTime();

      // CRITICAL: Save video URL to Supabase
      const { error: updateError } = await supabase
        .from('generations')
        .update({
          status: 'completed',
          video_url: pollResult.videoUrl,
          completed_at: completedAt,
          updated_at: completedAt,
          total_time_ms: totalTimeMs
        })
        .eq('id', generationId);

      if (updateError) {
        console.error('Failed to update generation:', updateError);
      } else {
        console.log('✅ Video URL saved to Supabase:', pollResult.videoUrl.slice(0, 60));
      }

      // Update user stats
      await supabase
        .from('users')
        .update({
          last_active_at: completedAt,
          total_videos_generated: (generation.user?.total_videos_generated || 0) + 1
        })
        .eq('id', generation.user_id);

      return res.status(200).json({
        success: true,
        status: 'completed',
        videoUrl: pollResult.videoUrl,
        progress: 100,
        model: generation.model,
        tier: generation.tier,
        duration: generation.duration || generation.length,
        generationTime: `${(totalTimeMs / 1000).toFixed(1)}s`,
        needsAd: generation.tier === 'free'
      });
    }

    if (pollResult.status === 'failed') {
      // Update database
      await supabase
        .from('generations')
        .update({
          status: 'failed',
          error: pollResult.error,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', generationId);

      // Rollback usage
      const { data: user } = await supabase
        .from('users')
        .select('free_used, paid_used')
        .eq('id', generation.user_id)
        .single();

      if (user) {
        if (generation.tier === 'free' && (user.free_used || 0) > 0) {
          await supabase
            .from('users')
            .update({ free_used: user.free_used - 1 })
            .eq('id', generation.user_id);
          console.log('🔄 Rolled back free_used for user');
        } else if (generation.tier !== 'free' && (user.paid_used || 0) > 0) {
          await supabase
            .from('users')
            .update({ paid_used: user.paid_used - 1 })
            .eq('id', generation.user_id);
          console.log('🔄 Rolled back paid_used for user');
        }
      }

      return res.status(200).json({
        success: false,
        status: 'failed',
        error: pollResult.error,
        progress: 0
      });
    }

    // Still processing
    const elapsedMs = Date.now() - new Date(generation.created_at).getTime();
    const elapsedSec = Math.round(elapsedMs / 1000);

    return res.status(200).json({
      success: true,
      status: pollResult.status || 'processing',
      progress: pollResult.progress || Math.min(20 + Math.floor(elapsedSec / 5), 90),
      elapsed: `${elapsedSec}s`,
      model: generation.model,
      message: pollResult.status === 'queued' 
        ? 'Video is queued for processing...'
        : `Generating video... (${elapsedSec}s elapsed)`,
      warning: pollResult.warning
    });

  } catch (error) {
    console.error('Poll error:', error);
    return res.status(500).json({ 
      error: 'Poll failed',
      message: error.message
    });
  }
}
