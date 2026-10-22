# Satwik Ghanta — Drive Through My Resume

A playable, top-down browser driving experience based on the supplied Quarto website and draft academic CV. **No server, build step or external JavaScript dependency is required.**

## What is in this repository?

- `site/index.html`: the game-first homepage
- `site/game.js` and `site/game-data.js`: driving physics, map, destructible resume blocks, respawning, and content
- `site/styles.css`: visual design and responsive layout
- `site/resume.html`: accessible, indexable long-form résumé for visitors who prefer not to play
- `site/assets/`: SVG favicon
- `original-quarto/`: unchanged backup of the previous Quarto source (not published by the deployment workflow)
- `.github/workflows/deploy.yml`: publishes **only `site/`** using GitHub Actions

## Try locally

```bash
cd site
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser. Use **WASD or arrow keys**. On a touchscreen, use the visible control pad. Drive through colourful résumé blocks to reveal information. A broken block is rebuilt after it leaves the camera viewport. Visit a district directly using the left navigation.

## Deploy to `yasat.github.io`

1. Back up your existing GitHub repository before replacing its contents.
2. Copy the contents of this repository into the **root** of your existing `yasat.github.io` repository. Remove the old top-level Quarto `publish.yml` workflow if it still exists — otherwise it may publish over this version.
3. Commit and push to `main`.
4. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. The included `Deploy static resume game` workflow publishes `site/`; the site appears at **https://yasat.github.io/** after deployment finishes.

To use *Deploy from a branch* instead, move the contents of `site/` to the repository root and set Pages to `main` / `(root)`. Ensure `.nojekyll` exists in that publishing directory.

## Content notes — review before publishing

The supplied 7-page CV is explicitly a **draft** and includes a number of unconfirmed details, placeholders and proposed work. The website uses a curated subset with appropriate status labels (published, accepted, preprint, student pilot, expected, etc.). The original draft PDF is **not** published and is **not** attached as a CV download. Check dates, statuses, links and affiliations before publishing. `site/game-data.js` is the easiest place to revise the in-game information; update `site/resume.html` for the matching text-only version.

### Design and accessibility

- Keyboard controls and mobile on-screen controls
- Direct navigation to districts; the game is **never required** to read the résumé
- Descriptive semantic HTML fallback (`resume.html`), proper links, reduced-motion handling
- No trackers or third-party libraries
- The world runs entirely in the browser, so it works on GitHub Pages

## How the respawn works

Blocks have a `broken` state. A collision triggers a reveal and particles; while the block is within the visible canvas viewport it stays destroyed. As soon as that block's world-space rectangle moves outside the camera viewport (with a small padding), it is restored, so a later visit can break it again. Discoveries are counted only once per browser session.
