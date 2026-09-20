# BingeBox

Preserved v26.6 frontend migrated from Netlify to Vercel.

## Deploy

GitHub `hiruuu30/bingebox`, production branch `main`, Vercel project `bingebox` in the `hello-65386311` team (`hello@brickand.bond`).

Build: `node scripts/build.mjs`. Output: `public/`. No npm dependencies required.
Vercel routes preserve the watch/lite/swipe URLs, policy redirects, workspace and custom 404 behavior, security headers, and service worker cache rules.
Only frontend files are published. SQL, worker source, and internal release reports stay outside the public build.

## Existing services

The public `config.js` retains BingeBox Supabase project `shffgnuprnycqblpwkrp`, its publishable key, and the existing BingeBox Cloudflare endpoints. No private credentials are included. No Animori or WagStack infrastructure is used.

## Remaining migration work

- Both `bingebox.bond` and `www.bingebox.bond` are attached to Vercel production. DNS remains pending in Cloudflare: CNAME `@` and CNAME `www` -> `2457351be69c0dc1.vercel-dns-017.com` (Vercel requests DNS-only / proxy disabled). Cloudflare security verification blocked the agent browser before any DNS edits.
- Verify Supabase Auth site/redirect URLs and existing worker CORS. Worker source currently permits only `https://bingebox.bond` and `https://www.bingebox.bond`; administrative imports on Vercel preview domains may be blocked.
- Existing importer is manual; the future discovery/queue/retry automation brief is a separate backend phase. Do not claim it is implemented by this frontend migration.
- Backend administration requires access to the BingeBox Supabase project. Do not substitute another project's database.

## Verification checkpoint

2026-09-20: Commit `2addd58` deployed READY. `https://bingebox-two.vercel.app/` loads 81 catalog titles from the existing BingeBox backend. Workspace returns 200 with no-store/noindex headers; service-worker returns 200 with no-store; /admin and SQL source URLs return 404. A sampled title reports media error 4 in this browser on both old and new hosts; playback is not verified. Custom-domain DNS cutover and backend automation remain unfinished.

