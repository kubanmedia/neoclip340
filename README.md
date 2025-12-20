# NeoClip 340 - AI Video Generator

> Generate viral short videos with AI. 10 free clips per month, no credit card needed.

**Version:** 3.5.0  
**Live Demo:** https://neoclip340.vercel.app  
**GitHub:** https://github.com/kubanmedia/neoclip340

## 🚨 What's Fixed in v3.5.0 (CRITICAL)

### 1. "Connection Error Check Internet" - FIXED
**Problem:** App showed "Connection error check internet connection" on every reload.

**Root Cause:** The deployed `user.js` had `import { createClient } from '@supabase/supabase-js'` but the package wasn't installed, causing:
```
Cannot find module '@supabase/supabase-js'
Require stack: - /var/task/api/user.js
```

**Solution:** Complete rewrite of ALL API files to work WITHOUT any external dependencies:
- `api/user.js` - No imports, always returns valid response
- `api/generate.js` - Uses only native `fetch`, no Supabase
- `api/poll.js` - No external dependencies
- `api/status.js` - No external dependencies
- `api/debug.js` - No external dependencies

### 2. "Video Completed but URL Not Found" - FIXED
**Problem:** Luma video generation completed but URL wasn't extracted.

**Root Cause:** PiAPI returns nested structure:
```json
{
  "data": {
    "output": {
      "video": { "url": "https://..." },
      "video_raw": { "url": "https://..." }
    }
  }
}
```
Previous code looked for flat `data.output.video_url` path.

**Solution:** Comprehensive URL extraction checking all paths.

### 3. DEP0169 Deprecation Warning - FIXED
**Problem:** `url.parse()` deprecation warnings in Vercel logs.

**Solution:** All endpoints use WHATWG URL API exclusively.

## 🎬 How It Works

```
┌─────────────────────────────────────────────┐
│             Frontend (main.js)               │
├─────────────────────────────────────────────┤
│  1. User enters prompt                       │
│  2. POST /api/generate → Returns taskId      │
│  3. Poll GET /api/poll?generationId=xxx      │
│  4. When completed → Display video           │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│           Backend (Vercel Serverless)        │
├─────────────────────────────────────────────┤
│  api/user.js - User session (no DB needed)   │
│  api/generate.js - Create Luma task          │
│  api/poll.js - Check task status             │
│  api/status.js - User/task info              │
│  api/debug.js - Configuration check          │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│           PiAPI.ai (Luma Provider)           │
├─────────────────────────────────────────────┤
│  POST /api/v1/task - Create video            │
│  GET /api/v1/task/{id} - Check status        │
│  Cost: ~$0.20 per video                      │
└─────────────────────────────────────────────┘
```

## 📦 No External Dependencies

v3.5.0 is designed to work with **ZERO runtime dependencies**:

- ❌ No `@supabase/supabase-js`
- ❌ No database required
- ✅ Uses native `fetch` API
- ✅ Uses native `URL` API
- ✅ Usage tracked via localStorage in frontend

## 🚀 Quick Start

### 1. Clone Repository
```bash
git clone https://github.com/kubanmedia/neoclip340.git
cd neoclip340
```

### 2. Configure Environment
Add to Vercel Environment Variables:
```
PIAPI_KEY=your_piapi_key_here
# or
PIAPI_API_KEY=your_piapi_key_here
```

Get your PiAPI key at: https://piapi.ai/dashboard

### 3. Deploy
```bash
vercel --prod
```

## 🔧 API Endpoints

### POST /api/user
Create or retrieve user session.

```bash
curl -X POST https://neoclip340.vercel.app/api/user \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"device123","platform":"web"}'
```

### POST /api/generate
Start video generation.

```bash
curl -X POST https://neoclip340.vercel.app/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Cherry blossoms falling","userId":"user123"}'
```

Response:
```json
{
  "success": true,
  "taskId": "xxx-xxx-xxx",
  "pollUrl": "/api/poll?generationId=xxx-xxx-xxx",
  "estimatedTime": "60-180 seconds"
}
```

### GET /api/poll?generationId=xxx
Poll for video completion.

```bash
curl "https://neoclip340.vercel.app/api/poll?generationId=xxx"
```

### GET /api/debug
Check configuration.

```bash
curl https://neoclip340.vercel.app/api/debug
```

## 💰 Pricing

| Tier | Cost per Video | Monthly Limit |
|------|---------------|---------------|
| Free | $0.20 (Luma)  | 10 videos     |
| Pro  | $0.20 (Luma)  | 120 videos    |

## ✅ Verification

After deploying, test:

```bash
# 1. Check debug endpoint
curl https://neoclip340.vercel.app/api/debug
# Should return version: "3.5.0"

# 2. Test user endpoint
curl -X POST https://neoclip340.vercel.app/api/user \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test123"}'
# Should return {"success":true,...}

# 3. Open app in browser
# Should NOT show "Connection error check internet"
```

## 📝 Changelog

### v3.5.0 (Current) - CRITICAL FIX
- **FIXED:** "Connection error" - Removed all @supabase/supabase-js imports
- **FIXED:** "Video completed but URL not found" - Correct nested URL extraction
- **FIXED:** DEP0169 - Pure WHATWG URL API
- **SIMPLIFIED:** No external runtime dependencies
- **IMPROVED:** User session via frontend localStorage

### v3.4.3
- Wan-2.2 model update
- testMode parameter added

### v3.4.2
- DEP0169 fix attempt (incomplete)

## 🔒 Security Notes

- PIAPI_KEY is server-side only
- No sensitive data stored in frontend
- Usage tracked via localStorage (user-controlled)

## 📞 Support

- GitHub Issues: https://github.com/kubanmedia/neoclip340/issues
- PiAPI Dashboard: https://piapi.ai/dashboard

---

Made with ❤️ by NeoClip AI
