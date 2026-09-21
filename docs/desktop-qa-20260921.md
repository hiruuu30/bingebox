# Desktop QA fixes — 2026-09-21

Desktop-only hardening for the BingeBox homepage. Mobile breakpoints remain unchanged.

Fixed:
- removed captured source floating controls;
- restored stable 3:4 hero-poster geometry on desktop;
- added a visible catalog loading state;
- extended poster fallbacks to hero/search/shelf cards;
- prevented hover-card blank flashes;
- aligned footer spacing with the 6vw content rhythm;
- standardized custom desktop UI font fallbacks;
- clamped search titles to two lines;
- smoothed the 1001–1180px header breakpoint;
- capped large-screen recommendation card widths;
- vertically centered shelf arrows against responsive poster sizes;
- scaled hover-card minimum height at narrow desktop widths;
- added a four-column intermediate search grid;
- replaced the ambiguous BingeBox hero chip with Trending/New metadata.

The fixes are loaded through `exact-desktop.css` and cache-busted desktop scripts.

Deployment verification merge: production rebuild requested after the complete desktop QA patch set.
