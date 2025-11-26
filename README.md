git checkout --orphan gh-pages
git --no-pager rm -rf .
# Jogo do Bicho (Pixi.js)

Minimal clean setup without diagnostic instrumentation.

## Development

```bash
npm install
npm run dev
```

Visit the local URL Vite prints.

### Mobile Scaling Preview

Use the dedicated mobile preview mode to see a scaled layout for smaller devices:

```bash
npm run dev-mobile
```

This sets `VITE_MOBILE=1`, triggering a CSS `transform: scale(...)` on the Pixi canvas while keeping internal coordinates and interactions identical. The scale factor:
* Adapts to current viewport width & height.
* Won't shrink below `0.48`.
* Is exposed via `data-mobile-scale` attribute for quick inspection.

Resize the browser window to watch dynamic recalculation.

## Build

```bash
npm run build
```

Generates `dist/` assets.

## Deploy to GitHub Pages (docs folder method)

Project uses `docs/` as the Pages root (Settings > Pages > Deploy from branch: `main` / `docs`).

1. Build production:
	```bash
	npm run build
	```
2. Copy build to docs and push:
	```bash
	npm run deploy
	```
3. Wait for Pages to refresh (~1–2 minutes).
4. Access: https://lewistombolajohnson.github.io/game.jogodobicho.prototype/

### Vite Base
`vite.config.ts` uses `base: './'` so relative asset paths work from the `docs` root.

### Troubleshooting
* Ensure `docs/index.html` script tag points to `./assets/index-<hash>.js`.
* Hard refresh (Ctrl/Cmd+Shift+R) after deployments.
* Check DevTools Network for 404s under `assets/`.

## License
Prototype – no explicit license declared.
