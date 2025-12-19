# NeoClip 340 - AI Video Generator

> Generate viral short videos with AI. 10 free clips per month, no credit card needed.

**Version:** 3.4.3  
**Live Demo:** https://neoclip340.vercel.app  
**GitHub:** https://github.com/kubanmedia/neoclip340

## What's Fixed in v3.4.3 (CRITICAL)

### 1. DEP0169 Deprecation Warning - PERMANENTLY FIXED
**Problem:** Vercel logs showed:
```
(node:4) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized
at getQueryParams (file:///var/task/api/poll.js:119:11)
```

**Root Cause:** Accessing `req.query` in Vercel triggers internal `url.parse()` even if your code doesn't call it directly.

**Solution:** ALL API files now COMPLETELY AVOID `req.query` and use ONLY WHATWG URL API:
```javascript
// ❌ OLD - triggers DEP0169 internally
if (req.query && Object.keys(req.query).length > 0) {
  return req.query;
}

// ✅ NEW - pure WHATWG URL API
const host = req.headers?.host || 'localhost';
const protocol = req.headers?.['x-forwarded-proto'] || 'https';
const fullUrl = new URL(req.url || '/', `${protocol}://${host}`);
return Object.fromEntries(fullUrl.searchParams);
```

### 2. "Video completed but URL not found" - FIXED
**Problem:** Luma video generation succeeds but video URL not extracted.

**Root Cause:** PiAPI Luma returns video URL in NESTED structure:
```json
{
  "data": {
    "output": {
      "video": { "url": "https://...watermarked.mp4" },
      "video_raw": { "url": "https://...clean.mp4" }
    }
  }
}
```
Previous code looked for `data.output.video_url` (flat path) instead of `data.output.video.url` (nested path).

**Solution:** Enhanced video URL extraction with ALL possible paths:
```javascript
extractVideoUrl: (response) => {
  return response?.data?.output?.video_raw?.url ||   // ✅ Prefer unwatermarked
         response?.data?.output?.video?.url ||        // ✅ Watermarked fallback
         response?.data?.output?.video_url ||         // Old flat structure
         response?.data?.video_url ||
         response?.output?.video?.url ||
         response?.output?.video_raw?.url ||
         response?.video_url;
}
```

### 3. Wan-2.1 Model No Longer Exists - UPDATED TO Wan-2.2
**Problem:** Replicate returns validation error:
```
[Wan-2.1] Failed: validation error: The specified version does not exist
```

**Root Cause:** The Wan-2.1 model was deprecated/removed from Replicate.

**Solution:** Updated to `wan-video/wan-2.2-t2v-fast`:
```javascript
// ❌ OLD - model no longer exists
createUrl: 'https://api.replicate.com/v1/predictions',
version: 'wan-lab/wan2.1-t2v-1.3b:e8c37be...'

// ✅ NEW - use model endpoint directly
createUrl: 'https://api.replicate.com/v1/models/wan-video/wan-2.2-t2v-fast/predictions',
// No version hash needed with model endpoint
```

### 4. AdMob Prevention for Tests - ADDED
**New Feature:** `testMode` parameter to skip ads and quota limits during testing:
```json
// Request with testMode
{
  "prompt": "Test video",
  "userId": "test-user",
  "tier": "free",
  "testMode": true  // ← New parameter
}
```
- Skips free quota check
- Sets `needsAd: false` in response
- Records `test_mode: true` in database

## Fallback Chain (Cost Optimized)

| Tier | Primary | Fallback | Max Cost |
|------|---------|----------|----------|
| **FREE** | Wan-2.2 (~$0.001) | Luma ($0.20) | $0.20 |
| **PAID** | Luma ($0.20) | FAL MiniMax ($0.50) | $0.50 |

**Cost savings for FREE tier:**
- Before: Up to $0.50/video if Wan fails (FAL fallback)
- After: Max $0.20/video (Luma fallback) = **60% savings**

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (main.js)                          │
├─────────────────────────────────────────────────────────────────┤
│  1. POST /api/generate → Returns generationId in <5 seconds      │
│  2. Poll GET /api/poll?generationId=xxx every 5 seconds          │
│     → When status='completed', returns videoUrl                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Vercel Serverless)                   │
├─────────────────────────────────────────────────────────────────┤
│  api/generate.js - Creates task, returns immediately             │
│  api/poll.js - Polls provider, saves videoUrl to Supabase        │
│  api/status.js - User's generation history                       │
│  api/user.js - User management                                   │
│  api/webhook.js - Provider callbacks                             │
│  api/debug.js - Configuration status                             │
└─────────────────────────────────────────────────────────────────┘
```

## API Endpoints

### POST /api/generate
Creates a new video generation task.

```json
// Request
{
  "prompt": "A cat playing piano",
  "userId": "uuid",
  "tier": "free",
  "length": 10,
  "testMode": false  // Optional: skip ads & quota for testing
}

// Response
{
  "success": true,
  "generationId": "uuid",
  "provider": "wan",
  "providerName": "Wan-2.2",
  "pollUrl": "/api/poll?generationId=uuid",
  "needsAd": true,
  "testMode": false
}
```

### GET /api/poll?generationId=xxx
Polls generation status. Returns `videoUrl` when completed.

### GET /api/status?userId=xxx
User's generation history.

### GET /api/debug
Shows provider configuration and current version.

## Environment Variables

```env
# Supabase (Required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# Providers (At least one required)
REPLICATE_KEY=your-replicate-key     # For Wan-2.2 (~$0.001)
PIAPI_KEY=your-piapi-key             # For Luma ($0.20)
FAL_KEY=your-fal-key                 # For MiniMax ($0.50)
```

## Deployment

1. **Supabase**: Run `supabase/schema.sql` in SQL Editor
2. **Vercel**: Import repo and add environment variables
3. **Verify**: Check `/api/debug` for provider status

## Verification

After deployment, verify at `/api/debug`:

```bash
curl https://neoclip340.vercel.app/api/debug
```

Expected response should show:
- `"version": "3.4.3"`
- `"fixes": ["DEP0169 FIXED: ...", "Video URL extraction: Handle nested ...", "Wan model UPDATED: ..."]`

## Test the Fixes

### Test Video Generation
```bash
curl -X POST https://neoclip340.vercel.app/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Cherry blossoms falling",
    "userId": "test-user-123",
    "tier": "free",
    "testMode": true
  }'
```

### Test Polling
```bash
curl "https://neoclip340.vercel.app/api/poll?generationId=YOUR_GENERATION_ID"
```

## Changelog

### v3.4.3 (Current) - CRITICAL FIXES
- **FIXED:** "Video completed but URL not found" - Handle nested Luma response paths (`data.output.video.url` and `data.output.video_raw.url`)
- **FIXED:** Wan-2.1 → Wan-2.2-t2v-fast (old model no longer exists on Replicate)
- **FIXED:** DEP0169 - Complete avoidance of `req.query` access
- **ADDED:** `testMode` parameter for AdMob prevention during testing
- **IMPROVED:** Enhanced logging for all video URL extraction paths

### v3.4.2
- **FIXED:** DEP0169 - Avoid `req.query` access in ALL API files
- **FIXED:** Wan-2.1 HTTP 422 - Correct Replicate API format

### v3.4.1
- Initial WHATWG URL API migration (incomplete)
- Updated fallback chains

### v3.4.0
- Async polling pattern
- Videos saved to Supabase
- Library screen

## License

MIT License

---

Made with ❤️ by NeoClip AI
