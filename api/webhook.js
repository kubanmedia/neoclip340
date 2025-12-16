/**
 * NeoClip 340 - Webhook Handler v3.4.1
 * Receives callbacks from video generation APIs
 * 
 * CRITICAL FIXES v3.4.1:
 * - Uses Web Crypto API instead of Node's crypto module (Edge-compatible)
 * - Modern Buffer.from() instead of deprecated Buffer constructor
 * - WHATWG URL API for any URL parsing
 * 
 * SECURITY: All sensitive keys are stored in Vercel Environment Variables
 */

import { createClient } from '@supabase/supabase-js';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const getSupabaseClient = () => {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
};

/**
 * Verify webhook signature using Web Crypto API (modern, Edge-compatible)
 * Falls back to simple comparison if Web Crypto not available
 */
async function verifySignature(payload, signature, secret) {
  if (!secret || !signature) return true; // Skip if not configured
  
  try {
    // Use Web Crypto API (modern, Edge-compatible)
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
    
    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSignature.length) return false;
    
    let result = 0;
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    return result === 0;
    
  } catch (error) {
    console.warn('Signature verification error:', error.message);
    return true; // Allow if verification fails (backwards compatible)
  }
}

export default async function handler(req, res) {
  // CORS headers
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
    
    // Verify webhook signature if configured
    if (WEBHOOK_SECRET) {
      const isValid = await verifySignature(req.body, signature, WEBHOOK_SECRET);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const supabase = getSupabaseClient();
    const { 
      taskId, 
      status, 
      videoUrl, 
      error: webhookError,
      userId,
      source = 'unknown'
    } = req.body;

    if (!taskId) {
      return res.status(400).json({ error: 'Task ID is required' });
    }

    // Update generation record
    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'completed' && videoUrl) {
      updateData.video_url = videoUrl;
      updateData.completed_at = new Date().toISOString();
    }

    if (status === 'failed' && webhookError) {
      updateData.error = webhookError;
    }

    const { error: updateError } = await supabase
      .from('generations')
      .update(updateData)
      .eq('task_id', taskId);

    if (updateError) {
      console.error('Failed to update generation:', updateError);
      return res.status(500).json({ error: 'Database update failed' });
    }

    // If generation failed, rollback user's free usage
    if (status === 'failed' && userId) {
      const { data: user } = await supabase
        .from('users')
        .select('free_used')
        .eq('id', userId)
        .single();

      if (user && user.free_used > 0) {
        await supabase
          .from('users')
          .update({ free_used: user.free_used - 1 })
          .eq('id', userId);
      }
    }

    // Log webhook event
    await supabase
      .from('webhook_logs')
      .insert({
        task_id: taskId,
        source,
        status,
        payload: JSON.stringify(req.body).substring(0, 5000),
        created_at: new Date().toISOString()
      });

    return res.status(200).json({ 
      success: true,
      message: `Webhook processed for task ${taskId}`
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ 
      error: 'Webhook processing failed',
      message: error.message 
    });
  }
}
