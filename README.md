# Satwik Ghanta - Text Resume and Two Driving Games

A static, GitHub Pages-ready academic portfolio with three separate ways to explore:

- **Text website:** `site/index.html`. The default, accessible academic resume.
- **2D driving game:** `site/game.html`. The original bright top-down car game with 32 breakable cards that respawn once offscreen.
- **3D research city:** `site/city.html`. A new stylized perspective city with roads, junction signs, a follow-camera car and 32 roadside billboards.

All three use the same curated information, derived from the supplied draft academic CV. Publication-status qualifications are kept, and the unreviewed draft PDF is not published.

## The 3D city

The map has **eight research and career districts** arranged around a central city plaza: Research, Publications, Teaching, Software Engineering, AI Innovation, Education, Academic Service and Contact. Each district has four billboards. Their short titles are painted on the signs; when you pull over and read one, a high-contrast panel shows its full description, status and any available source link.

**Controls:**

- `W` or Up arrow: accelerate
- `S` or Down arrow: reverse
- `A` and `D` or Left and Right arrows: steer
- Space: brake
- `E`: read the closest billboard when parked
- On mobile, use LEFT, RIGHT, GO, REV and STOP.

The destination panel on the right works as a map and as an alternative to driving: choose a district to jump there, or open any of its four billboard entries directly. On a phone, open the panel with the **City map** button.

There are signs at all 16 intersections, a selected-destination waypoint panel with directions at junctions, and an on-screen car speed indicator. The city can automatically reveal a nearby billboard when the car has been driven and then parked. It also offers a manual Read billboard button.

The 3D city uses a lightweight **software 3D perspective renderer** on the browser Canvas. It is intentionally stylized rather than a photorealistic WebGL scene. There are no third-party scripts, asset downloads or server components. The site is fully static and can be hosted free on GitHub Pages.

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
