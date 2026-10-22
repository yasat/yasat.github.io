# Satwik Ghanta - Portfolio, 2D Drive and Research City 3D (Version 4)

A static, GitHub Pages-ready academic portfolio with three separate ways to explore:

- **Text website:** `site/index.html`. The default, accessible academic resume.
- **2D driving game:** `site/game.html`. The original bright top-down car game with 32 breakable cards that respawn once offscreen.
- **3D research city:** `site/city.html`. A redesigned stylized perspective city with a correctly scaled car, building facades with windows, shops and rooftops, pedestrian-only billboards, road signs and a compact live map.

All three use the same curated information, derived from the supplied draft academic CV. Publication-status qualifications are kept, and the unreviewed draft PDF is not published.

## The 3D city

The map has **eight research and career districts** arranged around a central city plaza: Research, Publications, Teaching, Software Engineering, AI Innovation, Education, Academic Service and Contact. Each district has four billboards. The signs show a paper or project title, publication or project status, and a short description. Stop close to a billboard and select Read billboard (or press E) to view its complete text and source link. Billboard structures are placed inside the pavements of district blocks, not across driving lanes.

**Controls:**

- `W` or Up arrow: accelerate
- `S` or Down arrow: reverse
- `A` and `D` or Left and Right arrows: steer
- Space: brake
- `E`: read the closest billboard when parked
- `M`: open or close the city map
- On mobile, use LEFT, RIGHT, GO, REV and STOP.

The large field-guide map now starts CLOSED, leaving the 3D game visible. The smaller desktop minimap remains in the bottom-right corner. Open **City map** in the header (or press M) to jump to a district or read its four billboards directly. On mobile, the map opens as a drawer.

There are signs at all 16 intersections, a selected-destination waypoint panel with directions at junctions, and an on-screen car speed indicator. The car, camera, and billboard sizes have been adjusted relative to the street layout. Buildings now have window grids, entrances, awnings, roof equipment, lamp posts, planted verges and surrounding city blocks rather than blank cubes. The city can automatically reveal a nearby billboard when the car has been driven and then parked. It also offers a manual Read billboard button.

The 3D city uses a lightweight **software 3D perspective renderer** on the browser Canvas. It is an expanded low-poly city rather than a photorealistic GTA-style production game. It does not use Rockstar assets or include complex traffic simulation, pedestrians, or realistic vehicle physics. There are no third-party scripts, asset downloads or server components. The site is fully static and can be hosted free on GitHub Pages.

## Local preview

From the `site` directory:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in a browser. The default homepage has **Play 2D** and **Explore 3D city** buttons in the header, with larger buttons in the hero. Select 3D city to begin exploring. You can also visit `http://localhost:8000/city.html` for a controls introduction or `http://localhost:8000/city.html?start=1` to begin immediately.

## Deploy on GitHub Pages

1. Back up the current contents of your `yasat.github.io` repository.
2. Copy the extracted files, including `site/` and `.github/`, to the repository root.
3. Remove or disable any old Quarto publication workflow. The included workflow deploys **only `site/`** to avoid overwriting this version.
4. Commit and push to `main`.
5. Under repository **Settings > Pages**, choose **GitHub Actions** as the deployment source.

When the workflow completes, the homepage is `https://yasat.github.io/`, the top-down game is at `/game.html`, and the 3D city is at `/city.html`.

You can instead publish the contents of `site/` from a branch if you prefer, as long as `.nojekyll` and all the website files are in the published root.

## Edit the content

- Edit `site/game-data.js` to change the **shared district names, billboard titles, descriptions, publication statuses and links** used by both games.
- Edit `site/index.html` for the normal text resume.
- Edit `site/city.css` for the 3D interface colours and layout.
- Edit `site/city.js` for street layout, car speed and physics, and sign behaviour.
- Edit `site/styles.css` and `site/game.js` to adjust the top-down game.
- The unchanged preexisting Quarto project is backed up in `original-quarto/`; it is not deployed.

The original 7-page CV is an early draft and contains details needing confirmation. Review all published facts, dates and URLs before deployment. The game world uses the curated material from the previous website revision, not every line of the unpublished CV.

## Accessible routes

Visitors never have to play either game to read the resume. The 3D city has keyboard controls, touch controls, focusable district jump buttons, a separately accessible billboard list and descriptive, keyboard-reachable detail panels. The original 2D game remains intact.
