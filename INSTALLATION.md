# NeoClip 340 v3.4.1 Installation Guide

## What's Fixed in v3.4.1

### 1. DEP0169 Deprecation Warning (FIXED)
**Problem:** Vercel logs showed:
```
(node:4) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors
```

**Solution:** All API files now use WHATWG URL API:
```javascript
// OLD (deprecated)
const { parse } = require('url');
const query = parse(req.url, true).query;

// NEW (modern)
const baseUrl = `http://${req.headers?.host || 'localhost'}`;
const fullUrl = new URL(req.url || '/', baseUrl);
return Object.fromEntries(fullUrl.searchParams);
```

### 2. Fallback Logic Updated (COST SAVINGS)

| Tier | Before v3.4.1 | After v3.4.1 | Savings |
|------|---------------|--------------|---------|
| **FREE** | Wan → FAL MiniMax ($0.50) | Wan → Luma ($0.20) | **60%** |
| **PAID** | Luma → FAL MiniMax | Luma → FAL MiniMax | No change |

**Why?** FAL MiniMax at $0.50/video is too expensive for free tier fallback. Luma at $0.20 provides good quality at 768p.

### 3. Modern Node.js Patterns
- Web Crypto API for webhook signature verification
- AbortController for request timeouts
- Modern `Buffer.from()` instead of deprecated constructor

## Files Changed

| File | Changes |
|------|---------|
| `api/generate.js` | WHATWG URL API + New fallback chains |
| `api/poll.js` | WHATWG URL API + Luma provider support |
| `api/status.js` | WHATWG URL API |
| `api/user.js` | WHATWG URL API |
| `api/debug.js` | WHATWG URL API + Updated provider info |
| `api/webhook.js` | Web Crypto API for signatures |
| `index.html` | Version 3.4.1 + neoclip340 URLs |
| `main.js` | Version 3.4.1 |
| `package.json` | Version 3.4.1 |
| `README.md` | Updated documentation |
| `.gitignore` | Added for clean repository |

## Deployment Steps

### Option 1: Vercel Auto-Deploy (Recommended)

If your repository is already connected to Vercel:
1. Push to GitHub: `git push origin main`
2. Vercel will auto-deploy

### Option 2: Manual Vercel Deploy

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
cd neoclip340
vercel --prod
```

### Option 3: Upload to Vercel Dashboard

1. Go to https://vercel.com/dashboard
2. Import Project → GitHub → kubanmedia/neoclip340
3. Deploy

## Environment Variables Required

Set these in Vercel Dashboard → Project → Settings → Environment Variables:

```env
# Required - Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# Required - At least ONE provider
REPLICATE_KEY=your-replicate-key      # For Wan-2.1 ($0.0008/video)
PIAPI_KEY=your-piapi-key              # For Luma ($0.20/video)

# Optional - Paid tier fallback
FAL_KEY=your-fal-key                  # For MiniMax ($0.50/video)

# Optional - Webhook security
WEBHOOK_SECRET=your-secret-for-hmac
```

## Verify Deployment

After deployment, verify at `/api/debug`:

```bash
curl https://neoclip340.vercel.app/api/debug
```

Expected response:
```json
{
  "message": "NeoClip 340 Debug Info v3.4.1",
  "version": "3.4.1",
  "providers": {
    "replicate": { "configured": true, "tier": "free (primary)" },
    "luma": { "configured": true, "tier": "free (fallback), paid (primary)" },
    "fal": { "configured": true, "tier": "paid (fallback only)" }
  },
  "fallbackChains": {
    "free": ["Wan-2.1 ($0.0008)", "Luma ($0.20)"],
    "paid": ["Luma ($0.20)", "MiniMax-FAL ($0.50)"]
  },
  "fixes": [
    "WHATWG URL API (no url.parse deprecation)",
    "Updated fallback chains (no FAL for free tier)",
    "Modern Web Crypto API for webhooks"
  ]
}
```

## Supabase Schema

If you haven't set up the database, run this SQL:

```sql
-- See supabase/schema.sql for full schema
```

## Troubleshooting

### Still seeing DEP0169 warning?
The warning might come from dependencies. This is expected and doesn't affect functionality.
Our code no longer uses `url.parse()`.

### Video generation failing?
1. Check `/api/debug` to verify API keys are configured
2. Check Vercel logs for detailed error messages
3. Ensure Supabase is properly connected

### Videos not saving to library?
1. Check Supabase `generations` table
2. Verify `video_url` column is being populated
3. Check `/api/poll` logs for save errors

## Support

- **Live App:** https://neoclip340.vercel.app
- **GitHub:** https://github.com/kubanmedia/neoclip340
- **Issues:** Create a GitHub issue for bugs

---

Made with ❤️ by NeoClip AI
