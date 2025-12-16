# Security Policy

## Vercel Security Advisory Response

**Re: CVE-2025-55182 - Critical RCE vulnerability affecting React Server Components**

### Status: NOT AFFECTED ✅

This project uses **Vercel Serverless Functions** (pure JavaScript API routes), NOT Next.js with React Server Components. Therefore, CVE-2025-55182 does not apply to this codebase.

### Architecture Verification

| Component | Technology | RSC Used? |
|-----------|------------|-----------|
| API Layer | Vercel Serverless Functions | ❌ No |
| Frontend | Expo React Native | ❌ No |
| Database | Supabase (external) | ❌ No |

### Security Measures Implemented

1. **Environment Variables**
   - All API keys stored in Vercel Environment Variables
   - No hardcoded secrets in source code
   - `.env` files excluded via `.gitignore`

2. **Input Validation**
   - All API endpoints validate input
   - Prompt length limited to 500 characters
   - User ID validation on all requests

3. **Database Security**
   - Row Level Security (RLS) enabled
   - Service role key used only server-side
   - Parameterized queries (no SQL injection)


### Recommended: If You Use Next.js

If you adapt this project to use Next.js, you MUST upgrade to a patched version:
- Next.js 15.0.5, 15.1.9, 15.2.6, 15.3.6, 15.4.8, 15.5.7, or 16.0.7

Check Vercel's blog for the latest guidance.
