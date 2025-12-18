/**
 * NeoClip 340 - Enhanced User Management API v3.4.2
 * 
 * CRITICAL FIXES v3.4.2:
 * - FIXED: DEP0169 - Completely avoid req.query access
 * - Uses ONLY WHATWG URL API for query parsing
 * 
 * Full OAuth user data collection and management
 * Supports: Google, Apple, Email, Anonymous auth
 * 
 * Endpoints:
 * - POST: Create/register user with full data collection
 * - GET: Retrieve user info
 * - PATCH: Update user profile
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const getSupabase = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  
  if (!url || !key) {
    console.error('Missing Supabase credentials');
    return null;
  }
  
  return createClient(url, key);
};

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Generate unique referral code
const generateReferralCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'NC';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

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

// Main handler
export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ message: 'OK' });
  }
  
  // Set CORS headers
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(500).json({
      success: false,
      error: 'Database connection failed'
    });
  }
  
  try {
    // POST - Create/Register User
    if (req.method === 'POST') {
      const {
        deviceId,
        email,
        authProvider = 'anonymous',
        authProviderId,
        fullName,
        displayName,
        avatarUrl,
        locale,
        timezone,
        devicePlatform,
        deviceModel,
        osVersion,
        appVersion,
        utmSource,
        utmMedium,
        utmCampaign,
        acquisitionChannel,
        referredBy,
      } = req.body;
      
      if (!deviceId && !email) {
        return res.status(400).json({
          success: false,
          error: 'Either deviceId or email is required'
        });
      }
      
      // Check if user already exists
      let existingUser = null;
      
      if (email) {
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('email', email)
          .single();
        existingUser = data;
      }
      
      if (!existingUser && deviceId) {
        const { data } = await supabase
          .from('users')
          .select('*')
          .eq('device_id', deviceId)
          .single();
        existingUser = data;
      }
      
      if (existingUser) {
        await supabase
          .from('users')
          .update({
            last_login_at: new Date().toISOString(),
            last_active_at: new Date().toISOString(),
            login_count: (existingUser.login_count || 0) + 1,
            device_platform: devicePlatform || existingUser.device_platform,
            device_model: deviceModel || existingUser.device_model,
            os_version: osVersion || existingUser.os_version,
            app_version: appVersion || existingUser.app_version,
          })
          .eq('id', existingUser.id);
        
        const freeRemaining = Math.max(0, 10 - (existingUser.free_used || 0));
        
        return res.status(200).json({
          success: true,
          isNewUser: false,
          user: {
            id: existingUser.id,
            deviceId: existingUser.device_id,
            email: existingUser.email,
            fullName: existingUser.full_name,
            displayName: existingUser.display_name,
            avatarUrl: existingUser.avatar_url,
            authProvider: existingUser.auth_provider,
            tier: existingUser.tier,
            freeUsed: existingUser.free_used || 0,
            freeRemaining,
            paidUsed: existingUser.paid_used || 0,
            referralCode: existingUser.referral_code,
            referralCount: existingUser.referral_count,
            totalVideosGenerated: existingUser.total_videos_generated,
            subscriptionStatus: existingUser.subscription_status,
            resetsAt: existingUser.resets_at,
            createdAt: existingUser.created_at,
          }
        });
      }
      
      // Create new user
      const newUserData = {
        device_id: deviceId,
        email: email || null,
        auth_provider: authProvider,
        auth_provider_id: authProviderId || null,
        full_name: fullName || null,
        display_name: displayName || fullName || null,
        avatar_url: avatarUrl || null,
        locale: locale || 'en',
        timezone: timezone || null,
        tier: 'free',
        free_used: 0,
        paid_used: 0,
        total_videos_generated: 0,
        referral_code: generateReferralCode(),
        referred_by: referredBy || null,
        referral_count: 0,
        device_platform: devicePlatform || null,
        device_model: deviceModel || null,
        os_version: osVersion || null,
        app_version: appVersion || null,
        utm_source: utmSource || null,
        utm_medium: utmMedium || null,
        utm_campaign: utmCampaign || null,
        acquisition_channel: acquisitionChannel || authProvider,
        has_seen_onboarding: false,
        notifications_enabled: true,
        marketing_emails_enabled: true,
        dark_mode: true,
        preferred_quality: '1080p',
        preferred_aspect_ratio: '9:16',
        last_login_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
        login_count: 1,
      };
      
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert([newUserData])
        .select()
        .single();
      
      if (createError) {
        console.error('Error creating user:', createError);
        return res.status(500).json({
          success: false,
          error: 'Failed to create user: ' + createError.message
        });
      }
      
      // Process referral
      if (referredBy) {
        try {
          const { data: referrer } = await supabase
            .from('users')
            .select('id, referral_count, tier')
            .eq('referral_code', referredBy)
            .single();
          
          if (referrer) {
            const newCount = (referrer.referral_count || 0) + 1;
            await supabase
              .from('users')
              .update({
                referral_count: newCount,
                tier: newCount % 3 === 0 && referrer.tier === 'free' ? 'pro' : referrer.tier,
              })
              .eq('id', referrer.id);
          }
        } catch (refError) {
          console.error('Referral processing error:', refError);
        }
      }
      
      return res.status(201).json({
        success: true,
        isNewUser: true,
        user: {
          id: newUser.id,
          deviceId: newUser.device_id,
          email: newUser.email,
          fullName: newUser.full_name,
          displayName: newUser.display_name,
          avatarUrl: newUser.avatar_url,
          authProvider: newUser.auth_provider,
          tier: newUser.tier,
          freeUsed: newUser.free_used || 0,
          freeRemaining: 10,
          paidUsed: newUser.paid_used || 0,
          referralCode: newUser.referral_code,
          referralCount: newUser.referral_count,
          totalVideosGenerated: newUser.total_videos_generated,
          subscriptionStatus: newUser.subscription_status,
          resetsAt: newUser.resets_at,
          createdAt: newUser.created_at,
        }
      });
    }
    
    // GET - Retrieve User (using WHATWG URL API)
    if (req.method === 'GET') {
      // CRITICAL: Use WHATWG URL API only, avoid req.query
      const query = getQueryParams(req);
      const { userId, deviceId, email } = query;
      
      if (!userId && !deviceId && !email) {
        return res.status(400).json({
          success: false,
          error: 'userId, deviceId, or email is required'
        });
      }
      
      let dbQuery = supabase.from('users').select('*');
      
      if (userId) {
        dbQuery = dbQuery.eq('id', userId);
      } else if (email) {
        dbQuery = dbQuery.eq('email', email);
      } else if (deviceId) {
        dbQuery = dbQuery.eq('device_id', deviceId);
      }
      
      const { data: user, error } = await dbQuery.single();
      
      if (error || !user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const freeRemaining = Math.max(0, 10 - (user.free_used || 0));
      
      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          deviceId: user.device_id,
          email: user.email,
          fullName: user.full_name,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          authProvider: user.auth_provider,
          tier: user.tier,
          freeUsed: user.free_used || 0,
          freeRemaining,
          paidUsed: user.paid_used || 0,
          totalVideosGenerated: user.total_videos_generated,
          referralCode: user.referral_code,
          referralCount: user.referral_count,
          subscriptionStatus: user.subscription_status,
          resetsAt: user.resets_at,
          hasSeenOnboarding: user.has_seen_onboarding,
          createdAt: user.created_at,
          lastActiveAt: user.last_active_at,
        }
      });
    }
    
    // PATCH - Update User
    if (req.method === 'PATCH') {
      const { userId, deviceId } = req.body;
      
      if (!userId && !deviceId) {
        return res.status(400).json({
          success: false,
          error: 'userId or deviceId is required'
        });
      }
      
      const allowedUpdates = [
        'email', 'full_name', 'display_name', 'avatar_url',
        'tier', 'locale', 'timezone',
        'has_seen_onboarding', 'onboarding_completed_at',
        'notifications_enabled', 'marketing_emails_enabled',
        'dark_mode', 'preferred_quality', 'preferred_aspect_ratio',
      ];
      
      const updates = {};
      allowedUpdates.forEach(field => {
        const camelField = field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        if (req.body[camelField] !== undefined) {
          updates[field] = req.body[camelField];
        }
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      });
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid update fields provided'
        });
      }
      
      updates.updated_at = new Date().toISOString();
      
      let updateQuery = supabase.from('users').update(updates);
      
      if (userId) {
        updateQuery = updateQuery.eq('id', userId);
      } else {
        updateQuery = updateQuery.eq('device_id', deviceId);
      }
      
      const { data: updated, error } = await updateQuery.select().single();
      
      if (error) {
        return res.status(500).json({
          success: false,
          error: 'Failed to update user'
        });
      }
      
      return res.status(200).json({
        success: true,
        user: {
          id: updated.id,
          email: updated.email,
          fullName: updated.full_name,
          tier: updated.tier,
          hasSeenOnboarding: updated.has_seen_onboarding,
          updatedAt: updated.updated_at,
        }
      });
    }
    
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
    
  } catch (error) {
    console.error('User API error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
