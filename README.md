# Satwik Ghanta · Portfolio and RC Grand Prix

A static GitHub Pages website with three experiences:

- **Updated full text résumé:** `site/index.html` — retained as the canonical, accessible portfolio.
- **Original 2D tabletop RC game:** `site/game.html` — preserved.
- **New 3D RC Grand Prix:** `site/city.html` — replaces the previous 3D research city. The page address stays the same so existing links continue to work.

## 3D game · The résumé run

The new game is an F1-inspired, scenic 3D RC car circuit with a dramatically smaller RC car and damped, speed-sensitive steering, with an asphalt track, red/white kerbs, start/finish markings, a gantry, grandstands and spectators, service garages, trackside signs, floodlights, pine forests, ponds, landscape, and detailed miniature RC cars.

**Eleven extra-long résumé pit stops:** Each curved, off-main-track service lane spans roughly 400–505 in-game distance units; one per section: About, Research, Collaborations, Publications, Teaching, Educational Innovation, Mentorship, Education, Professional Software Engineering, Academic Service, and Contact. Each pit lane features permanent in-world billboards for **every one of that section's résumé entries** (42 individual boards in the current content). Landscape-format board images contain the **complete text** of each item, not an abbreviated abstract, plus relevant dates, status, metadata, and visible link labels. There are no pop-up résumé cards. Press **E** near a poster to smoothly zoom the camera toward its in-world surface, and E again to continue. Scroll to zoom closer. This is a camera mode, not a modal or popup. A pit guide provides an optional index and direct navigation to the eleven physical pit lanes.

**Automatically synchronized résumé content:** On each visit, the 3D game fetches `index.html` and parses its sections and entries, so subsequent updates to your text résumé appear on billboards without editing the game. A snapshot fallback is bundled in `site/rc-resume-data.js` for resilience; if the homepage structure changes significantly, run `python update-resume-snapshot.py` at repository root to refresh it.

**Fuel and driving:** Drive unrestricted around the circuit and accessible surrounding terrain using WASD/arrow keys. One full tank covers approximately **two complete track lengths** at full speed. Fuel consumption is distance-based: reading while stopped does not burn fuel. Pit lanes are intentionally curved and narrower than the main straight, impose a speed penalty, and reconnect with the circuit. To refill, enter a pit lane from one end, drive through its midpoint, and exit through the opposite end; **no stopping is required**. Taking a shortcut across the main track does not refill the car. If stranded, press **T** to get towed to the closest pit entrance with enough fuel to drive through it. Arcade towing adds a 20-second race-time penalty.

## Arcade multiplayer

The standalone **Arcade Grand Prix** mode has the same scenic RC circuit, only **one refuelling pit lane**, and **no résumé billboards**. It features live competitors, fuel management, refill-on-drive-through, lap counting and times, resettable races, and Shift-activated nitro (recharging over time and via boost pads). Players can select 2, 3, 5, 8, or 12 laps, choose a driver name, host a room, and copy an invite URL containing a short room code.

**Architecture:** GitHub Pages hosts the static page. The host's browser coordinates the lobby, start countdown, positions and race results via PeerJS WebRTC data connections. The **free default PeerJS Cloud signalling service** is used to connect browsers; this is an external service, not a GitHub Pages backend. The host must keep their game and browser tab open. Race movement is simulated on each player's own client and shared over the network; this is casual multiplayer, **not a cheat-resistant authoritative tournament server**. Every new race round now resets the host and guests to their own grid slots with fresh fuel, lap counters, clocks and opponent positions. Starts carry a shared absolute launch time and a monotonically increasing round number, preventing stale race packets from reviving an old round. The race view now takes keyboard focus on launch. The vehicles are non-colliding to avoid inconsistent positions between peer machines. Network restrictions/firewalls/NATs or signalling service downtime can prevent some peers from connecting; for guaranteed connectivity or large groups, operate your own signalling server and TURN relay outside GitHub Pages. One host plus seven guests is the intended lobby cap, but real-world WebRTC connections are dependent on each player's network. There is also offline single-player Arcade mode (once the 3D library has loaded).

The 3D renderer is **Three.js 0.180.0** loaded from jsDelivr, and optional multiplayer uses **PeerJS 1.5.5** loaded from jsDelivr. No build command, paid host, credentials, database, or environment file is required. First-time page load needs internet access for the CDNs. No claims of guaranteed cross-network WebRTC connectivity are made.

### Controls

| Control | Action |
|---|---|
| W / ↑ | Accelerate |
| S / ↓ | Reverse |
| A, D / ←, → | Steering |
| Space | Brake |
| Shift | Nitro in Arcade mode |
| E | Focus/unfocus the nearest billboard, no popup |
| Mouse wheel / + and − | Zoom in billboard focus mode |
| C | Switch chase, helicopter, bumper and aerial camera |
| P | Show or hide résumé pit-stop guide |
| T | Recovery tow when the tank is empty (Arcade penalty: +20 seconds) |
| On-screen buttons | Basic driving on touch devices |

## Visual rebuild and compatibility camera (October 2026)

The October revision spaces the 42 signs along the **outer edges** of 11 longer pit lanes, dynamically checks clearance from the main racing surface (including at hairpins), shifts any conflicting posters, uses landscape sign faces, renders only the current pit-lane exhibits in the 2.5D view, makes RC vehicles about half their former size, and replaces aggressive steering with steering damping and modest road guidance. The fallback rendering now clips road polygons at the near camera plane, uses a physically aligned horizon, and adds additional scenery.

### Earlier blank-screen issue

Some browsers/drivers may render only the aquamarine WebGL background while the dashboard and minimap continue functioning. The racer now checks the actual 3D framebuffer after starting a race. When repeated checks find no visible geometry, it **automatically switches to a canvas-projected compatibility camera**, which draws the asphalt circuit, curved service lanes, forests, grandstands, cars and in-world résumé posters using the same world positions, game physics, fuel, laps and room networking. This is a **2.5D fallback, not native WebGL 3D**. It preserves playability when the 3D GPU rendering fails.

There is a **VIEW: 3D / VIEW: COMPAT** switch in the race footer to override the automatic choice at any time. Add `?renderer=compat` to the racing page URL to force compatibility rendering immediately, e.g., `/city.html?renderer=compat`. `rc-compatibility.js` is shipped with the site. The `city.html` imports have an updated `v=4` version suffix to avoid stale browser caches. While this fixes the blank-screen symptom, the exact cause of the native WebGL failure on every particular driver cannot be confirmed without browser GPU diagnostics.

## Preview locally

From the `site` folder run:

```bash
python3 -m http.server 8000
```

Visit `http://localhost:8000/` (text résumé), `/game.html` (2D), or `/city.html` (new 3D). Start a local server rather than opening `city.html` from `file://`, because the game reads the homepage with `fetch()` and uses ES modules. When checking multiplayer, use two *separate browser sessions* and a genuine GitHub Pages HTTPS URL for best WebRTC behaviour.

## Deploy

1. Extract this project into the root of the `yasat.github.io` repository, including `site/` and `.github/`.
2. Commit the changed files and push them to `main`.
3. In **Settings → Pages**, select **GitHub Actions**. The included `.github/workflows/deploy.yml` publishes the contents of `site/`.
4. Visit `https://yasat.github.io/city.html` and test both modes. Share an Arcade room URL with a friend to test two-browser peer-to-peer racing.

The `original-quarto/` folder is preserved as an undeployed archive. The 2D game and full text résumé were not rewritten; the navigation copy pointing to the new 3D racer was updated.

## Testing notes

- JavaScript parsing: `node --check` passed for both racing modules.
- Physics regression harness: smooth acceleration, turning, braking and steering return passed.
- Multiplayer state-machine harness: host launch, guest launch, stale round rejection, and fresh host/guest second-round resets passed using simulated networking.
- 2.5D renderer rendered multiple track viewpoints and a résumé pit-lane viewpoint in an isolated browser canvas without script errors.
- Poster generator created all 42 résumé item canvases without drawing any text beyond their bounds.
- Sampled pit geometry is roughly 400–505 game-distance units per lane. All 42 poster placements cleared the main track in the geometry safety check.
- **Not verified:** actual site under normal web-network conditions in a live WebGL browser, and a live two-device PeerJS/WebRTC session. The simulation tests do **not** prove cross-device connectivity; PeerJS public signalling and browser NAT restrictions still apply.


- `node --check site/rc-race.js` validates JavaScript parsing.
- The résumé snapshot generator extracts the same 11 sections and 42 items from `site/index.html`.
- Functional 3D/WebRTC testing should be performed in real browsers with WebGL and external CDN access. WebRTC availability depends on the internet environment. The **Multiplayer** feature is a usable PeerJS implementation, not a guarantee that every NAT/router configuration will connect.
