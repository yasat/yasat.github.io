# Satwik Ghanta - Research Website and Driving Game

A text-first academic website with an optional, playable, top-down driving experience based on the supplied Quarto website and draft academic CV. **No server, build step or external JavaScript dependency is required.**

## What is in this repository?

- `site/index.html`: default text-first research and resume homepage
- `site/game.html`: optional driving experience linked in the header
- `site/game.js` and `site/game-data.js`: driving physics, map, destructible resume blocks, respawning, and content
- `site/styles.css`: visual design and responsive layout
- `site/resume.html`: redirect from the old resume URL to the new homepage, preserving section fragments
- `site/assets/`: SVG favicon
- `original-quarto/`: unchanged backup of the previous Quarto source (not published by the deployment workflow)
- `.github/workflows/deploy.yml`: publishes **only `site/`** using GitHub Actions

## Try locally

```bash
cd site
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser for the text resume, then select **Play the game**. Use **WASD or arrow keys**. On a touchscreen, use the visible control pad. Drive through colourful resume blocks to reveal information. A broken block is rebuilt after it leaves the camera viewport. Visit a district directly using the left navigation.

## Deploy to `yasat.github.io`

1. Back up your existing GitHub repository before replacing its contents.
2. Copy the contents of this repository into the **root** of your existing `yasat.github.io` repository. Remove the old top-level Quarto `publish.yml` workflow if it still exists - otherwise it may publish over this version.
3. Commit and push to `main`.
4. On GitHub: **Settings > Pages > Build and deployment > Source: GitHub Actions**.
5. The included `Deploy static resume game` workflow publishes `site/`; the site appears at **https://yasat.github.io/** after deployment finishes.

To use *Deploy from a branch* instead, move the contents of `site/` to the repository root and set Pages to `main` / `(root)`. Ensure `.nojekyll` exists in that publishing directory.

## Content notes - review before publishing

The supplied 7-page CV is explicitly a **draft** and includes a number of unconfirmed details, placeholders and proposed work. The website uses a curated subset with appropriate status labels (published, accepted, preprint, student pilot, expected, etc.). The original draft PDF is **not** published and is **not** attached as a CV download. Check dates, statuses, links and affiliations before publishing. `site/game-data.js` is the easiest place to revise the in-game information; update `site/resume.html` for the matching text-only version.

### Design and accessibility

- Keyboard controls and mobile on-screen controls
- Direct navigation to districts; the game is **never required** to read the resume
- Descriptive semantic HTML fallback (`resume.html`), proper links, reduced-motion handling
- No trackers or third-party libraries
- The world runs entirely in the browser, so it works on GitHub Pages

## How the respawn works

Blocks have a `broken` state. A collision triggers a reveal and particles; while the block is within the visible canvas viewport it stays destroyed. As soon as that block's world-space rectangle moves outside the camera viewport (with a small padding), it is restored, so a later visit can break it again. Discoveries are counted only once per browser session.

## Changes in v2

- Default homepage is the text resume. The playable game lives at `/game.html` (with optional `?start=1` for instant play) and is linked prominently in the header and hero.
- Game cards use descriptive paper topics rather than conference acronyms; the publication status and full paper titles remain in card detail text.
- Game world and user interface are brighter and easier to scan.
- Decorative Unicode arrows, stars, dashes, bullets and unusual typography were replaced with conventional plain text in the published site. Proper names retain their authentic accents.
