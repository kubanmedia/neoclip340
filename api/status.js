/**
 * NeoClip Production - Generation Status API
 * Check the status of a video generation task
 * 
 * SECURITY: All sensitive keys are stored in Vercel Environment Variables
 */

import { createClient } from '@supabase/supabase-js';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const getSupabaseClient = () => {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { taskId, userId } = req.query;

    if (!taskId && !userId) {
      return res.status(400).json({ 
        error: 'Either taskId or userId is required' 
      });
    }

    const supabase = getSupabaseClient();

    // If taskId provided, get specific generation
    if (taskId) {
      const { data: generation, error } = await supabase
        .from('generations')
        .select('*')
        .eq('task_id', taskId)
        .single();

      if (error || !generation) {
        return res.status(404).json({ error: 'Generation not found' });
      }

      return res.status(200).json({
        success: true,
        generation: {
          id: generation.id,
          taskId: generation.task_id,
          status: generation.status,
          videoUrl: generation.video_url,
          tier: generation.tier,
          prompt: generation.prompt,
          createdAt: generation.created_at,
          completedAt: generation.completed_at,
          error: generation.error
        }
      });
    }

    // If userId provided, get user's recent generations
    if (userId) {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, tier, free_used, resets_at')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { data: generations, error: genError } = await supabase
        .from('generations')
        .select('id, task_id, status, video_url, tier, prompt, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (genError) {
        return res.status(500).json({ error: 'Failed to fetch generations' });
      }

      // Calculate remaining days until reset
      const resetsAt = new Date(user.resets_at);
      const now = new Date();
      const daysUntilReset = Math.ceil((resetsAt - now) / (1000 * 60 * 60 * 24));

      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          tier: user.tier,
          freeUsed: user.free_used,
          freeRemaining: 10 - user.free_used,
          resetsAt: user.resets_at,
          daysUntilReset: Math.max(0, daysUntilReset)
        },
        generations: generations.map(g => ({
          id: g.id,
          taskId: g.task_id,
          status: g.status,
          videoUrl: g.video_url,
          tier: g.tier,
          prompt: g.prompt,
          createdAt: g.created_at
        }))
      });
    }

  } catch (error) {
    console.error('Status check error:', error);
    return res.status(500).json({ 
      error: 'Status check failed',
      message: error.message 
    });
  }
}
