# Jogo do Bicho (Pixi + TypeScript)

Interactive prototype of a Jogo do Bicho inspired game built with Pixi.js and TypeScript.

Features (current):
* Ticket creation (manual and random) with animated animal selection flights
* Progressive result reveals with suspenseful final slot shake
* Bonus round: 25-box number selection (choose 5, then 5 animal-number draws with tiered match payouts)
* Tier logic: 4-digit full match = 40x, 3-digit tail = 15x, 2-digit tail = 5x (4-digit vs 4-digit requires complete equality)
* Stake capture for bonus, animated balance changes, win particle FX, coin travel, parallax background
* Selection commit "suck-in" animation, ticket reordering by potential live win

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build production bundle:

```bash
npm run build
```

Preview production build locally:

```bash
npm run preview
```

## GitHub Pages Deployment

This repo is configured for GitHub Pages using Vite + an Actions workflow.

### 1. Ensure repository name matches Vite base
`vite.config.ts` sets:
```ts
base: '/game.jogodobicho.prototype/'
```
If you rename the repository, update this value accordingly.

### 2. Enable Pages (if not already)
In GitHub: Settings > Pages > Build and deployment: choose "GitHub Actions".

### 3. Workflow
An Actions workflow (`.github/workflows/pages.yml`) will build and publish `dist` to the `gh-pages` deployment environment on pushes to `main`.

### 4. Access URL
After the first successful run, your game will be available at:
```
https://<your-username>.github.io/game.jogodobicho.prototype/
```

## Manual Deployment (Optional)

If you prefer manual:
```bash
npm run build
git checkout --orphan gh-pages
git --no-pager rm -rf .
cp -R dist/* .
git add .
git commit -m "Deploy"
git push origin gh-pages --force
```
Then switch back:
```bash
git checkout main
```

## Notes
* Numbers use last two digits to map animals (00 interpreted as 100).
* For 4-digit selections, a 4-digit draw must match all digits to get 40x (no partial tail payout in that case).
* Audio assets referenced are placeholders; replace `/audio/*.mp3` with real files or adjust paths.

## Roadmap / Potential Enhancements
* Vignette pulse / ambient layers
* Momentum badge for rapidly climbing potential wins
* Ticket breathing idle animation
* Bonus recap toast
* Persist session balance

## License
Prototype – no explicit license yet. Add one (e.g., MIT) if you plan to open the project.
