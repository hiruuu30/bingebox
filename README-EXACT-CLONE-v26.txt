BingeBox ReelShort Exact Clone v26
=================================

Built from the source-faithful ReelShort capture clone, then injected with the current BingeBox v25.2 backend/package.

This package fixes the hover card as one system:
- source spacing: 15px detail inset + 16px detail/action gap
- dynamic panel height for one- and two-line titles
- active shelf/card stacking promoted above neighboring/lower shelves
- edge clamping without changing source card dimensions
- exact extracted glass recipe retained: #292929, 1px white/10%, radius 24px, blurred poster 47px / scale 1.08, black mask 30%

BingeBox injection:
- BingeBox mark/wordmark, favicon and metadata
- live published dramas from Supabase project shffgnuprnycqblpwkrp
- source-clone hero and shelves populated with BingeBox posters/titles/genres/descriptions
- hover Play routes to the existing BingeBox watch page
- hover Save persists a lightweight My List in localStorage for the exact-clone homepage
- search button uses the live BingeBox catalog
- existing BingeBox watch/player, Lite, Workspace, PWA, legal pages and backend config remain included

Deploy the entire folder/ZIP to Netlify.
