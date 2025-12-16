/**
 * NeoClip 302 - Debug Endpoint
 * Test provider connections and see response formats
 * 
 * GET /api/debug - Show configured providers
 * POST /api/debug - Test a specific provider
 */

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
        configured: !!process.env.REPLICATE_KEY,
        keyPrefix: process.env.REPLICATE_KEY?.slice(0, 8) + '...',
        endpoint: 'https://api.replicate.com/v1/predictions'
      },
      fal: {
        configured: !!process.env.FAL_KEY,
        keyPrefix: process.env.FAL_KEY?.slice(0, 8) + '...',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/video-01'
      },
      piapi: {
        configured: !!process.env.PIAPI_KEY,
        keyPrefix: process.env.PIAPI_KEY?.slice(0, 8) + '...',
        endpoint: 'https://api.piapi.ai/api/v1/task'
      },
      supabase: {
        url: !!process.env.SUPABASE_URL,
        key: !!process.env.SUPABASE_KEY
      }
    };

    return res.status(200).json({
      message: 'NeoClip 302 Debug Info',
      timestamp: new Date().toISOString(),
      providers,
      environment: process.env.NODE_ENV || 'production'
    });
  }

  // POST - Test a provider
  if (req.method === 'POST') {
    const { provider, prompt = 'A beautiful sunset over mountains' } = req.body;

    if (!provider) {
      return res.status(400).json({ error: 'Provider is required (replicate, fal, piapi)' });
    }

    const configs = {
      replicate: {
        url: 'https://api.replicate.com/v1/predictions',
        key: process.env.REPLICATE_KEY,
        authHeader: `Token ${process.env.REPLICATE_KEY}`,
        body: {
          version: 'wan-lab/wan-2.1:e8c37be16be5e3bb950f55e0d73d1e87e4be5a47',
          input: { prompt, num_frames: 240, guidance_scale: 7.5 }
        }
      },
      fal: {
        url: 'https://queue.fal.run/fal-ai/minimax/video-01',
        key: process.env.FAL_KEY,
        authHeader: `Key ${process.env.FAL_KEY}`,
        body: { prompt, prompt_optimizer: true }
      },
      piapi: {
        url: 'https://api.piapi.ai/api/v1/task',
        key: process.env.PIAPI_KEY,
        authHeader: `Bearer ${process.env.PIAPI_KEY}`,
        body: {
          model: 'luma',
          task_type: 'video_generation',
          input: { prompt, expand_prompt: true, aspect_ratio: '16:9' }
        }
      }
    };

    const config = configs[provider];
    if (!config) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
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
