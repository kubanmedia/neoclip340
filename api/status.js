/**
 * NeoClip 340 - Status API v3.5.0
 * 
 * Simple status endpoint - no external dependencies
 * Frontend uses this to check generation history
 * 
 * GET /api/status?userId=xxx - Get user's generations (from localStorage via frontend)
 * GET /api/status?taskId=xxx - Get specific task status
 */

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

const FREE_TIER_LIMIT = 10;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const query = getQueryParams(req);
    const { userId, taskId, freeUsed } = query;

    // If taskId provided, redirect to poll endpoint
    if (taskId) {
      return res.status(200).json({
        success: true,
        message: 'Use /api/poll for task status',
        redirectTo: `/api/poll?generationId=${taskId}`
      });
    }

    // User status
    if (userId) {
      const parsedFreeUsed = parseInt(freeUsed) || 0;
      const freeRemaining = Math.max(0, FREE_TIER_LIMIT - parsedFreeUsed);
      
      // Calculate days until reset
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const daysUntilReset = Math.ceil((nextMonth - now) / (1000 * 60 * 60 * 24));

      return res.status(200).json({
        success: true,
        user: {
          id: userId,
          tier: 'free',
          freeUsed: parsedFreeUsed,
          freeRemaining: freeRemaining,
          freeLimit: FREE_TIER_LIMIT,
          daysUntilReset: daysUntilReset
        },
        // Frontend manages generation history via localStorage
        generations: [],
        message: 'Generation history is stored locally in your browser'
      });
    }

    return res.status(400).json({
      error: 'userId or taskId required',
      example: '/api/status?userId=xxx'
    });

  } catch (error) {
    console.error('[Status API] Error:', error);
    return res.status(500).json({
      error: 'Status check failed',
      message: error.message
    });
  }
}
