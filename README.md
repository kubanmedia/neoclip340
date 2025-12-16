# NeoClip 340 - AI Video Generator

> Generate viral short videos with AI. 10 free clips per month, no credit card needed.

**Version:** 3.4.1  
**Live Demo:** https://neoclip340.vercel.app  
**GitHub:** https://github.com/kubanmedia/neoclip340

## What's Fixed in v3.4.1

### Critical Fixes

1. **DEP0169 Deprecation Warning Fixed**
   - **Problem:** `url.parse()` behavior is deprecated in Node 18+
   - **Solution:** All API files now use WHATWG URL API for query parsing
   - **Result:** No more deprecation warnings in Vercel logs

2. **Updated Fallback Logic (Cost Optimized)**
   - **OLD FREE tier:** Wan → FAL MiniMax ($0.50 - expensive!)
   - **NEW FREE tier:** Wan ($0.0008) → Luma ($0.20 at 768p)
   - **PAID tier:** Luma ($0.20 at 1080p) → FAL MiniMax ($0.50)

3. **Modern Node.js Patterns**
   - Web Crypto API for webhook signature verification
   - AbortController for request timeouts
   - Buffer.from() instead of deprecated Buffer constructor

## Fallback Chain (Updated)

| Tier | Primary | Fallback | Resolution |
|------|---------|----------|------------|
| **FREE** | Wan-2.1 ($0.0008) | Luma ($0.20) | 768p |
| **PAID** | Luma ($0.20) | FAL MiniMax ($0.50) | 1080p |

**Cost savings for FREE tier:**
- Before: Up to $0.50/video if Wan fails
- After: Max $0.20/video (60% savings)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (main.js)                         │
├─────────────────────────────────────────────────────────────────┤
│  1. POST /api/generate → Returns generationId in <5 seconds     │
│  2. Poll GET /api/poll?generationId=xxx every 5 seconds         │
│     → When status='completed', returns videoUrl                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Vercel Serverless)                   │
├─────────────────────────────────────────────────────────────────┤
│  api/generate.js - Creates task, returns immediately             │
│  api/poll.js - Polls provider, saves videoUrl to Supabase       │
│  api/status.js - User's generation history                      │
│  api/user.js - User management                                   │
│  api/webhook.js - Provider callbacks                             │
│  api/debug.js - Configuration status                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    PROVIDERS (Updated v3.4.1)                    │
├─────────────────────────────────────────────────────────────────┤
│  FREE TIER:                                                      │
│  1. Wan-2.1 (Replicate) - $0.0008/video - Ultra cheap           │
│  2. Luma (PiAPI) - $0.20/video - Moderate cost, 768p            │
│                                                                  │
│  PAID TIER:                                                      │
│  1. Luma (PiAPI) - $0.20/video - Good quality, 1080p            │
│  2. MiniMax (FAL) - $0.50/video - High quality backup           │
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
  "length": 10
}

// Response
{
  "success": true,
  "generationId": "uuid",
  "provider": "wan",
  "providerName": "Wan-2.1",
  "resolution": "768p",
  "pollUrl": "/api/poll?generationId=uuid"
}
```

### GET /api/poll?generationId=xxx
Polls generation status using WHATWG URL API.

### GET /api/status?userId=xxx
User's generation history using WHATWG URL API.

### POST /api/user
Create or retrieve user.

### GET /api/debug
Shows provider configuration and costs.

## Environment Variables

```env
# Supabase (Required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# Providers (At least one required)
REPLICATE_KEY=your-replicate-key     # For Wan-2.1 ($0.0008)
PIAPI_KEY=your-piapi-key              # For Luma ($0.20)
FAL_KEY=your-fal-key                  # For MiniMax ($0.50)
```

## Deployment

1. **Supabase**: Run `supabase/schema.sql` in SQL Editor
2. **Vercel**: Import repo and add environment variables
3. **Verify**: Check `/api/debug` for provider status

## Changelog

### v3.4.1 (Current)
- **FIX:** DEP0169 url.parse() deprecation warnings
- **FIX:** Updated fallback chain (no FAL for free tier)
- **FIX:** Modern Web Crypto API for webhooks
- **IMPROVED:** Cost optimization for free tier

### v3.4.0
- Async polling pattern
- Videos saved to Supabase
- Library screen

### v3.3.0
- Initial async task pattern

## License

MIT License

---

Made with ❤️ by NeoClip AI
