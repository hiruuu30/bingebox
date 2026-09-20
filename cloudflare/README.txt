Deploy importer-worker.js as the Cloudflare Worker named bingebox-import.
Expected URL: https://bingebox-import.hero-tolentino.workers.dev

The Worker:
- accepts only HTTPS *.dramafren.org URLs
- requires the existing BingeBox admin login/JWT
- discovers episode pages and exposed iframe/video sources
- uses ordinary public HTTP requests only
- does not bypass CAPTCHA, DRM, login/session gates, or anti-bot/access controls

After deploying the Worker, Workspace uses:
Paste Watch / series URL -> Fetch episodes -> Preview -> Import all.


v21.9: replace the Worker with importer-worker.js in this package. It adds per-episode failures, targeted retry support, dynamic CORS for bingebox.bond/www, and the 21.9 health response.
