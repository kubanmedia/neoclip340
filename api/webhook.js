/**
 * NeoClip Production - Webhook Handler
 * Receives callbacks from video generation APIs
 * 
 * SECURITY: All sensitive keys are stored in Vercel Environment Variables
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const getSupabaseClient = () => {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
};

// Verify webhook signature (if provided by the API)
const verifySignature = (payload, signature, secret) => {
  if (!secret || !signature) return true; // Skip if not configured
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

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
    if (WEBHOOK_SECRET && !verifySignature(req.body, signature, WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
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
