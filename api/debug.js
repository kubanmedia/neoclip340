/**
 * NeoClip 340 - Debug Endpoint v3.4.2
 * Test provider connections and see response formats
 * 
 * CRITICAL FIXES v3.4.2:
 * - FIXED: DEP0169 - Completely avoid req.query access
 * - Uses ONLY WHATWG URL API for query parsing
 * 
 * GET /api/debug - Show configured providers
 * POST /api/debug - Test a specific provider
 */

/**
 * CRITICAL FIX for DEP0169:
 * Parse query parameters using ONLY WHATWG URL API
 * NEVER access req.query - it triggers internal url.parse() in Vercel/Node
 */
function getQueryParams(req) {
  try {
    // ALWAYS use WHATWG URL API, NEVER req.query
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET - Show configuration status
  if (req.method === 'GET') {
    const providers = {
      replicate: {
        name: 'Wan-2.1',
        configured: !!process.env.REPLICATE_KEY,
        keyPrefix: process.env.REPLICATE_KEY?.slice(0, 8) + '...',
        endpoint: 'https://api.replicate.com/v1/predictions',
        tier: 'free (primary)',
        cost: '$0.0008/video'
      },
      luma: {
        name: 'Luma (PiAPI)',
        configured: !!process.env.PIAPI_KEY,
        keyPrefix: process.env.PIAPI_KEY?.slice(0, 8) + '...',
        endpoint: 'https://api.piapi.ai/api/v1/task',
        tier: 'free (fallback), paid (primary)',
        cost: '$0.20/video'
      },
      fal: {
        name: 'MiniMax (FAL)',
        configured: !!process.env.FAL_KEY,
        keyPrefix: process.env.FAL_KEY?.slice(0, 8) + '...',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/video-01',
        tier: 'paid (fallback only)',
        cost: '$0.50/video'
      },
      supabase: {
        url: !!process.env.SUPABASE_URL,
        key: !!process.env.SUPABASE_KEY
      }
    };

    // Updated fallback chains info
    const fallbackChains = {
      free: ['Wan-2.1 ($0.0008)', 'Luma ($0.20)'],
      paid: ['Luma ($0.20)', 'MiniMax-FAL ($0.50)']
    };

    return res.status(200).json({
      message: 'NeoClip 340 Debug Info v3.4.2',
      timestamp: new Date().toISOString(),
      version: '3.4.2',
      providers,
      fallbackChains,
      environment: process.env.NODE_ENV || 'production',
      nodeVersion: process.version,
      fixes: [
        'DEP0169 FIXED: Avoid req.query access completely',
        'Video URL extraction: Correct Luma data.output.video_url path',
        'Wan-2.1: Corrected Replicate API format',
        'All APIs use WHATWG URL API only'
      ]
    });
  }

  // POST - Test a provider
  if (req.method === 'POST') {
    const { provider, prompt = 'A beautiful sunset over mountains' } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Provider is required (replicate, luma, fal)' });
    }

    const configs = {
      replicate: {
        url: 'https://api.replicate.com/v1/predictions',
        key: process.env.REPLICATE_KEY,
        authHeader: `Token ${process.env.REPLICATE_KEY}`,
        body: {
          version: 'wan-lab/wan2.1-t2v-1.3b:e8c37be16be5e3bb950f55e0d73d1e87e4be5a47',
          input: { prompt, num_frames: 240, guidance_scale: 7.5 }
        }
      },
      luma: {
        url: 'https://api.piapi.ai/api/v1/task',
        key: process.env.PIAPI_KEY,
        authHeader: `Bearer ${process.env.PIAPI_KEY}`,
        body: {
          model: 'luma',
          task_type: 'video_generation',
          input: { prompt, expand_prompt: true, aspect_ratio: '16:9' }
        }
      },
      fal: {
        url: 'https://queue.fal.run/fal-ai/minimax/video-01',
        key: process.env.FAL_KEY,
        authHeader: `Key ${process.env.FAL_KEY}`,
        body: { prompt, prompt_optimizer: true }
      }
    };

    const config = configs[provider];
    if (!config) {
      return res.status(400).json({ error: `Unknown provider: ${provider}. Valid: replicate, luma, fal` });
    }

    if (!config.key) {
      return res.status(400).json({ error: `${provider} API key not configured` });
    }

    try {
      console.log(`[DEBUG] Testing ${provider}...`);
      console.log(`[DEBUG] URL: ${config.url}`);
      console.log(`[DEBUG] Body:`, JSON.stringify(config.body));

      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Authorization': config.authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config.body)
      });

      const status = response.status;
      const headers = Object.fromEntries(response.headers.entries());
      
      let data;
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw_text: text };
      }

      console.log(`[DEBUG] Response status: ${status}`);
      console.log(`[DEBUG] Response headers:`, headers);
      console.log(`[DEBUG] Response body:`, JSON.stringify(data).slice(0, 1000));

      return res.status(200).json({
        provider,
        test: 'create_task',
        success: response.ok,
        status,
        headers,
        data,
        analysis: {
          hasId: !!data?.id,
          hasRequestId: !!data?.request_id,
          hasTaskId: !!data?.task_id || !!data?.data?.task_id,
          hasPredictionId: !!data?.prediction?.id,
          hasStatusUrl: !!data?.status_url,
          hasError: !!data?.error || !!data?.detail
        }
      });

    } catch (error) {
      console.error(`[DEBUG] Error testing ${provider}:`, error);
      return res.status(500).json({
        provider,
        error: error.message,
        stack: error.stack
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
