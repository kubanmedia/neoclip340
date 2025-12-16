/**
 * NeoClip 302 - Polling API v3.4.0
 * Properly polls provider status and saves completed videos to Supabase
 * 
 * CRITICAL FIXES:
 * 1. Correctly handles both GET method
 * 2. Polls provider API for actual status
 * 3. Saves video_url to Supabase when completed
 * 4. Rolls back usage on failure
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
    extractVideoUrl: (response) => {
      const output = response?.output;
      return Array.isArray(output) ? output[0] : output;
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
      const status = (response?.data?.status || response?.status || '').toLowerCase();
      if (status === 'completed' || status === 'succeeded' || status === 'success') return 'completed';
      if (status === 'failed' || status === 'error') return 'failed';
      if (status === 'pending' || status === 'queued') return 'queued';
      return 'processing';
    },
    extractVideoUrl: (response) => {
      return response?.data?.output?.video_url ||
             response?.data?.video_url ||
             response?.output?.video_url ||
             response?.video_url;
    },
    extractError: (response) => response?.data?.error || response?.error,
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
      console.warn('Response not JSON');
    }

    return { status: response.status, data, ok: response.ok };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { status: 408, data: {}, ok: false };
    }
    return { status: 0, data: {}, ok: false };
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
    
    let { status: httpStatus, data, ok } = await makeRequest(statusUrl, {
      method: 'GET',
      headers: { 'Authorization': config.authHeader(apiKey) }
    });

    console.log(`[${config.name}] Status: HTTP ${httpStatus}`, JSON.stringify(data).slice(0, 300));

    if (httpStatus === 401 || httpStatus === 403) {
      return { status: 'failed', error: 'Authentication error' };
    }

    const taskStatus = config.parseStatus(data);
    const progress = config.extractProgress(data);

    if (taskStatus === 'completed') {
      // Try to get video URL
      let videoUrl = config.extractVideoUrl(data);
      
      // For FAL, might need to fetch result separately
      if (!videoUrl && config.getResultUrl) {
        const resultUrl = config.getResultUrl(taskId);
        console.log(`[${config.name}] Fetching result: ${resultUrl}`);
        
        const resultResponse = await makeRequest(resultUrl, {
          method: 'GET',
          headers: { 'Authorization': config.authHeader(apiKey) }
        });
        
        if (resultResponse.ok) {
          videoUrl = config.extractVideoUrl(resultResponse.data);
          console.log(`[${config.name}] Video from result:`, videoUrl?.slice(0, 100));
        }
      }

      if (videoUrl) {
        return { status: 'completed', videoUrl, progress: 100 };
      } else {
        return { status: 'failed', error: 'Video completed but URL not found' };
      }
    }

    if (taskStatus === 'failed') {
      return { 
        status: 'failed', 
        error: config.extractError(data) || 'Generation failed'
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
 * Main Handler - Supports both GET
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // CRITICAL: Accept GET method
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    // Get generationId from query params
    const generationId = req.query?.generationId;

    if (!generationId) {
      return res.status(400).json({ error: 'generationId is required' });
    }

    console.log(`\nPolling generation: ${generationId}`);

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

    // If already completed, return cached result
    if (generation.status === 'completed' && generation.video_url) {
      console.log('Returning cached completed generation');
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
          updated_at: completedAt
        })
        .eq('id', generationId);

      if (updateError) {
        console.error('Failed to update generation:', updateError);
      } else {
        console.log('✅ Video URL saved to Supabase');
      }

      // Update user stats
      await supabase
        .from('users')
        .update({
          total_videos_generated: supabase.rpc ? undefined : 1,
          last_active_at: completedAt
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
        } else if (generation.tier !== 'free' && (user.paid_used || 0) > 0) {
          await supabase
            .from('users')
            .update({ paid_used: user.paid_used - 1 })
            .eq('id', generation.user_id);
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
