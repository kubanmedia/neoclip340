/**
 * NeoClip 340 - Webhook Handler v3.5.0
 * 
 * Receives callbacks from video generation APIs
 * Currently not used - polling is primary method
 * 
 * CRITICAL: No external dependencies
 */

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/**
 * Verify webhook signature using Web Crypto API
 */
async function verifySignature(payload, signature, secret) {
  if (!secret || !signature) return true;
  
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(JSON.stringify(payload))
    );
    
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    if (signature.length !== expectedSignature.length) return false;
    
    let result = 0;
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    return result === 0;
    
  } catch (error) {
    console.warn('Signature verification error:', error.message);
    return true;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Signature');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-webhook-signature'];
    
    // Verify signature if configured
    if (WEBHOOK_SECRET) {
      const isValid = await verifySignature(req.body, signature, WEBHOOK_SECRET);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const { 
      taskId, 
      status, 
      videoUrl, 
      error: webhookError,
      source = 'unknown'
    } = req.body || {};

    if (!taskId) {
      return res.status(400).json({ error: 'Task ID is required' });
    }

    console.log(`[Webhook] Received: taskId=${taskId}, status=${status}, source=${source}`);

    // Log the webhook (no database needed)
    // Frontend uses polling, so webhooks are just logged
    
    if (status === 'completed' && videoUrl) {
      console.log(`[Webhook] ✅ Video completed: ${videoUrl.slice(0, 60)}...`);
    }

    if (status === 'failed' && webhookError) {
      console.log(`[Webhook] ❌ Video failed: ${webhookError}`);
    }

    return res.status(200).json({ 
      success: true,
      message: `Webhook processed for task ${taskId}`,
      note: 'This app uses polling - webhooks are logged but not required'
    });

  } catch (error) {
    console.error('[Webhook] Error:', error);
    return res.status(500).json({ 
      error: 'Webhook processing failed',
      message: error.message 
    });
  }
}
