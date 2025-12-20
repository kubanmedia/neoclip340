/**
 * NeoClip 340 - Debug Endpoint v3.5.0
 * 
 * GET /api/debug - Shows configuration and health status
 * POST /api/debug - Tests provider connections
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET - Show configuration
  if (req.method === 'GET') {
    const piapiKey = process.env.PIAPI_KEY || process.env.PIAPI_API_KEY;
    
    return res.status(200).json({
      message: 'NeoClip 340 Debug Info',
      version: '3.5.0',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      nodeVersion: process.version,
      
      providers: {
        luma: {
          name: 'Luma (PiAPI)',
          configured: !!piapiKey,
          keyPrefix: piapiKey ? piapiKey.slice(0, 8) + '...' : 'NOT SET',
          endpoint: 'https://api.piapi.ai/api/v1/task',
          cost: '$0.20/video'
        }
      },
      
      fallbackChain: ['Luma ($0.20)'],
      
      fixes: [
        'v3.5.0: No @supabase/supabase-js dependency (prevents module not found)',
        'v3.5.0: Correct PiAPI Luma video URL extraction (nested paths)',
        'v3.5.0: DEP0169 fixed - WHATWG URL API only',
        'v3.5.0: Always-working user endpoint (no DB required)'
      ],
      
      endpoints: {
        '/api/user': 'POST/GET - User management (no DB)',
        '/api/generate': 'POST - Create video generation',
        '/api/poll': 'GET - Poll generation status',
        '/api/status': 'GET - User/task status',
        '/api/debug': 'GET/POST - This endpoint'
      },
      
      healthCheck: {
        api: 'OK',
        piapiConfigured: !!piapiKey
      }
    });
  }

  // POST - Test Luma/PiAPI
  if (req.method === 'POST') {
    const piapiKey = process.env.PIAPI_KEY || process.env.PIAPI_API_KEY;
    
    if (!piapiKey) {
      return res.status(400).json({
        error: 'PIAPI_KEY not configured',
        help: 'Add PIAPI_KEY or PIAPI_API_KEY to your Vercel environment variables'
      });
    }

    const { prompt = 'A test video of clouds', action = 'create' } = req.body || {};

    try {
      if (action === 'create') {
        console.log('[Debug] Testing Luma creation...');
        
        const response = await fetch('https://api.piapi.ai/api/v1/task', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${piapiKey}`,
            'X-API-Key': piapiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'luma',
            task_type: 'video_generation',
            input: {
              prompt: prompt,
              expand_prompt: true,
              aspect_ratio: '16:9'
            }
          })
        });

        const data = await response.json();
        
        return res.status(200).json({
          test: 'create_task',
          success: response.ok,
          status: response.status,
          data,
          taskId: data?.data?.task_id || data?.task_id,
          analysis: {
            hasTaskId: !!(data?.data?.task_id || data?.task_id),
            hasError: !!data?.error
          }
        });
      }

      if (action === 'balance') {
        console.log('[Debug] Checking PiAPI balance...');
        
        const response = await fetch('https://api.piapi.ai/api/v1/user/balance', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${piapiKey}`,
            'X-API-Key': piapiKey
          }
        });

        const data = await response.json();
        
        return res.status(200).json({
          test: 'balance_check',
          success: response.ok,
          data
        });
      }

      return res.status(400).json({
        error: 'Invalid action',
        validActions: ['create', 'balance']
      });

    } catch (error) {
      return res.status(500).json({
        error: error.message,
        stack: error.stack
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
