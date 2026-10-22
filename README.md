# Satwik Ghanta - portfolio, 2D drive and 3D research city (Version 5)

A static GitHub Pages-ready academic portfolio with three separate ways to explore:

- **Text resume** (`site/index.html`): the default, accessible academic portfolio.
- **2D game** (`site/game.html`): the bright top-down driving game with breakable resume cards.
- **3D city** (`site/city.html`): a stylized perspective city with a continuous outer ring road, solid building boundaries, fixed direction signs, and readable stationary information billboards.

This update changes the 3D city only. The text resume and 2D game are retained from Version 4. Content is shared between both games in `site/game-data.js`.

## Version 5 improvements

### 1. Fully enclosed city with a perimeter road

The four outer roads at `x = -600`, `x = 600`, `z = -600` and `z = 600` join into a continuous drivable ring around all eight districts and the central plaza. Roads no longer continue out of the city into empty space.

Beyond that road loop, a continuous row of **72 detailed perimeter buildings**, including the four corners, encloses the whole map. The enclosure is dense and has no drivable gaps. There are **112 collidable buildings in total**. The car checks collision against the actual rectangular building footprints, not invisible district-sized blocks. The outer map boundary is a further safety limit. Billboards and signposts also prevent the car from driving through their supports.

Buildings retain coloured facades, window grids, entrances, awnings and rooftop details. The camera adjusts near the perimeter so it does not pass through the boundary buildings.

### 2. Fixed billboards with fixed printed text

All **32 billboards** are anchored to specific pavements inside the research blocks. Each faces the nearest road. The frame, supports, and pre-rendered text do not turn to face the car. The sign shows a district and number, a meaningful paper or project title, its status or dates, and a short description. The full information remains accessible by parking, pressing `E`, or selecting the item from the map.

Physical signs naturally grow or shrink in perspective as you approach or leave them. Their actual positions, orientation and print do not change.

### 3. Four fixed directional pointers per intersection

There are **16 intersections**, each with **four physical direction signs**: N, E, S and W, for a total of 64 static pointers. Their text is calculated once when the city loads, rather than following the driver or updating each frame. At the city edges, outward-facing pointers say CITY LIMIT to warn that the map does not continue beyond the perimeter. The optional destination panel is still allowed to give live driving guidance; it does not alter the street signs.

The pointer supports are on the pavement beyond the lane markings, and outermost zebra crossings no longer point outside the road network.

## Controls

- W or Up arrow: accelerate
- S or Down arrow: reverse
- A and D or Left and Right arrows: steer
- Space: brake
- E: read the closest billboard while parked
- M: open or close the optional district map
- Mobile: LEFT, RIGHT, GO, REV and STOP on-screen controls

A text-based list of billboards is available in the city guide for visitors who prefer to navigate without driving.

## Local preview

Run this from the `site` directory:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` for the text resume, `http://localhost:8000/game.html` for the 2D game or `http://localhost:8000/city.html` for the 3D city. Add `?start=1` to the game URLs to skip the instructions.

## Deploy to GitHub Pages

1. Back up the current contents of your `yasat.github.io` repository.
2. Copy the ZIP contents, including the `site/` and `.github/` folders, to the repository root.
3. Remove or disable older Quarto publishing workflows if they remain.
4. Commit and push to `main`.
5. In repository **Settings > Pages**, select **GitHub Actions**.

The included `.github/workflows/deploy.yml` publishes the contents of `site/`. This project is entirely client-side JavaScript, HTML and CSS. There are no third-party runtime dependencies, build steps or server requirements. The `original-quarto/` directory is a backup of the earlier website and is not deployed.

## Updating the website

- Change paper titles, summaries, status labels and source links in `site/game-data.js`.
- Edit the text portfolio in `site/index.html`.
- Edit city size, world objects, collisions, signs, 3D projections and driving rules in `site/city.js`.
- Edit colours and page layout in `site/city.css` and `site/styles.css`.

The 3D renderer is a lightweight, low-poly Canvas 2D perspective engine. It is not a photorealistic, GTA-style WebGL engine. This is intentional to preserve fast deployment and broad browser support. Always check the research details and publication statuses before publicly publishing an updated resume.
