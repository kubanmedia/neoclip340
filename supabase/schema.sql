-- ============================================
-- NeoClip 302 - Supabase Database Schema v3.4.0
-- Matches production database structure
-- ============================================
-- 
-- Run this SQL in your Supabase SQL Editor
-- This schema is designed to match the actual production database
--
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.users (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Device identification
    device_id text UNIQUE,
    
    -- Authentication
    auth_provider_id text,
    auth_provider text DEFAULT 'anonymous',
    email text UNIQUE,
    email_verified boolean DEFAULT false,
    
    -- Profile
    full_name text,
    display_name text,
    avatar_url text,
    
    -- Device info
    device_platform text,
    device_model text,
    os_version text,
    app_version text,
    locale text DEFAULT 'en',
    timezone text,
    
    -- Marketing attribution
    utm_campaign text,
    utm_source text,
    utm_medium text,
    utm_term text,
    utm_content text,
    utm_params jsonb DEFAULT '{}'::jsonb,
    acquisition_channel text,
    
    -- Referral system
    referral_code text UNIQUE,
    referred_by uuid REFERENCES public.users(id),
    referral_count integer DEFAULT 0,
    
    -- Preferences
    dark_mode boolean DEFAULT false,
    language text DEFAULT 'en',
    notification_settings jsonb DEFAULT '{}'::jsonb,
    notifications_enabled boolean DEFAULT true,
    marketing_emails_enabled boolean DEFAULT true,
    preferred_theme text DEFAULT 'system',
    video_autoplay boolean DEFAULT true,
    preferred_aspect_ratio text DEFAULT '16:9',
    preferred_quality text DEFAULT '720p',
    
    -- Usage tracking
    total_videos_generated integer DEFAULT 0,
    tier text DEFAULT 'free' CHECK (tier IN ('free', 'basic', 'pro')),
    current_tier text DEFAULT 'free',
    free_used integer DEFAULT 0 CHECK (free_used >= 0),
    paid_used integer DEFAULT 0,
    pro_used integer DEFAULT 0,
    monthly_usage_count integer DEFAULT 0,
    last_monthly_reset timestamp with time zone,
    resets_at date DEFAULT ((date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'))::date,
    
    -- Session tracking
    last_active_at timestamp with time zone,
    last_login_at timestamp with time zone,
    login_count integer DEFAULT 0,
    
    -- Subscription
    is_pro_user boolean DEFAULT false,
    trial_ends_at timestamp with time zone,
    subscription_status text DEFAULT 'inactive',
    subscription_ends_at timestamp with time zone,
    stripe_customer_id text,
    stripe_subscription_id text,
    
    -- Onboarding
    has_seen_onboarding boolean DEFAULT false,
    
    -- Security
    is_active boolean DEFAULT true,
    failed_login_attempts integer DEFAULT 0,
    lockout_until timestamp with time zone,
    two_factor_enabled boolean DEFAULT false,
    
    -- Timestamps
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_device_id ON public.users(device_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_tier ON public.users(tier);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON public.users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON public.users(created_at DESC);

-- ============================================
-- GENERATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.generations (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    
    -- Provider task tracking
    task_id text,
    
    -- Generation input
    prompt text NOT NULL,
    
    -- Configuration
    tier text DEFAULT 'free',
    length integer DEFAULT 10,
    duration integer DEFAULT 10,
    resolution text DEFAULT '768p',
    model text,
    provider text,
    
    -- Results
    video_url text,
    thumbnail_url text,
    
    -- Status
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
    error text,
    
    -- Cost tracking
    cost numeric DEFAULT 0,
    cost_usd numeric DEFAULT 0,
    
    -- Timestamps
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for generations
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON public.generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_task_id ON public.generations(task_id);
CREATE INDEX IF NOT EXISTS idx_generations_status ON public.generations(status);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON public.generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_user_status ON public.generations(user_id, status);

-- ============================================
-- PROVIDER KEYS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.provider_keys (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES public.users(id),
    provider_type text,
    api_key text,
    usage_count integer DEFAULT 0,
    last_used_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON public.provider_keys(provider_type);

-- ============================================
-- REFERRAL CODES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.referral_codes (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES public.users(id),
    code text UNIQUE,
    used_by_user_id uuid REFERENCES public.users(id),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone
);

-- ============================================
-- REFERRALS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.referrals (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id uuid REFERENCES public.users(id),
    referred_id uuid REFERENCES public.users(id),
    referral_code text NOT NULL,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rewarded')),
    reward_type text DEFAULT 'free_month',
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone
);

-- ============================================
-- SUBSCRIPTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES public.users(id),
    stripe_subscription_id text UNIQUE,
    stripe_price_id text,
    status text DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid')),
    tier text NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);

-- ============================================
-- USER SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_sessions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES public.users(id),
    session_token text UNIQUE,
    device_info jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone,
    last_activity_at timestamp with time zone,
    is_active boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);

-- ============================================
-- APP EVENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.app_events (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES public.users(id),
    event_type text,
    event_data jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address inet,
    user_agent text
);

CREATE INDEX IF NOT EXISTS idx_app_events_user_id ON public.app_events(user_id);
CREATE INDEX IF NOT EXISTS idx_app_events_event_type ON public.app_events(event_type);
CREATE INDEX IF NOT EXISTS idx_app_events_created_at ON public.app_events(created_at DESC);

-- ============================================
-- WEBHOOK LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id text,
    source text,
    status text,
    payload jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_task_id ON public.webhook_logs(task_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- Service role policies (for Vercel serverless)
CREATE POLICY "Service role full access - users" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access - generations" ON public.generations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access - provider_keys" ON public.provider_keys FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access - referral_codes" ON public.referral_codes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access - referrals" ON public.referrals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access - subscriptions" ON public.subscriptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access - user_sessions" ON public.user_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access - app_events" ON public.app_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access - webhook_logs" ON public.webhook_logs FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_generations_updated_at ON public.generations;
CREATE TRIGGER update_generations_updated_at
    BEFORE UPDATE ON public.generations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Generate referral code
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
    code TEXT;
    exists_flag BOOLEAN;
BEGIN
    LOOP
        code := 'NC' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
        SELECT EXISTS(SELECT 1 FROM public.users WHERE referral_code = code) INTO exists_flag;
        EXIT WHEN NOT exists_flag;
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

-- Auto-generate referral code on user insert
CREATE OR REPLACE FUNCTION set_referral_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.referral_code IS NULL THEN
        NEW.referral_code := generate_referral_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_referral_code ON public.users;
CREATE TRIGGER trigger_set_referral_code
    BEFORE INSERT ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION set_referral_code();

-- Reset monthly usage
CREATE OR REPLACE FUNCTION reset_monthly_free_usage()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE public.users
    SET 
        free_used = 0,
        paid_used = 0,
        resets_at = ((date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'))::date,
        updated_at = CURRENT_TIMESTAMP
    WHERE resets_at <= CURRENT_DATE;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Update user stats on generation completion
CREATE OR REPLACE FUNCTION update_user_stats_on_generation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        UPDATE public.users
        SET 
            total_videos_generated = total_videos_generated + 1,
            last_active_at = CURRENT_TIMESTAMP
        WHERE id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_stats ON public.generations;
CREATE TRIGGER trigger_update_user_stats
    AFTER INSERT OR UPDATE ON public.generations
    FOR EACH ROW
    EXECUTE FUNCTION update_user_stats_on_generation();

-- ============================================
-- VIEWS
-- ============================================

-- User video library view
CREATE OR REPLACE VIEW public.user_video_library AS
SELECT 
    g.id,
    g.user_id,
    g.prompt,
    g.video_url,
    g.thumbnail_url,
    g.tier,
    g.model,
    g.duration,
    g.status,
    g.created_at,
    g.completed_at
FROM public.generations g
WHERE g.status = 'completed' AND g.video_url IS NOT NULL
ORDER BY g.created_at DESC;

-- Daily stats view
CREATE OR REPLACE VIEW public.daily_generation_stats AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_generations,
    COUNT(*) FILTER (WHERE status = 'completed') as completed,
    COUNT(*) FILTER (WHERE status = 'failed') as failed,
    COUNT(*) FILTER (WHERE tier = 'free') as free_tier,
    COUNT(*) FILTER (WHERE tier != 'free') as paid_tier,
    SUM(cost_usd) as total_cost
FROM public.generations
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- ============================================
-- NOTES
-- ============================================
-- 1. Run this schema in Supabase SQL Editor
-- 2. Set environment variables in Vercel:
--    - SUPABASE_URL
--    - SUPABASE_KEY (service role key)
--    - FAL_KEY
--    - REPLICATE_KEY
--    - PIAPI_KEY
-- 3. For monthly reset, call: SELECT reset_monthly_free_usage();
