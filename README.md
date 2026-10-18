# Rowan Flappy

A personal Flappy Bird style browser game starring Rowan, using the supplied photo and audio. Built with HTML, CSS, JavaScript, and Canvas, with no package install or build step required.

## Run locally

With Node.js installed, run the included server (no package install needed):

```sh
node scripts/serve.mjs
```

Open [localhost:8080](http://localhost:8080/). Follow the game's on-screen controls to start, flap, pause, and play again. Browsers require a user interaction before audio can play.

Tap, click, Space, or Up Arrow to flap. P / Escape pauses, M toggles sound, and R restarts. The supplied voice clip plays on each flap. Every defeat features a fluffy Shih Tzu giving Rowan a cartoon paw bonk. Best scores are stored per difficulty on the current device. Leaving the tab automatically pauses a flight.

Run the simulation checks with `node --test tests/engine.test.mjs`. For a 390px responsive layout preview, open `/scripts/mobile-preview.html` on the local server. The server also supports `/Rowan-flappy/` to check the GitHub Pages project path.

## Website files

- `index.html`: page structure and game interface.
- `styles.css`: responsive styling.
- `game.js`: Canvas rendering, interface, and audio behavior.
- `engine.mjs`: game simulation, collisions, scoring, and difficulty modes.
- `assets/`: supplied photo and audio.

All website resources use relative paths so the same files work at the GitHub Pages project path `/Rowan-flappy/` and on localhost.

## Publish to GitHub Pages

Review and approve the local game before pushing it to [Paila009/Rowan-flappy](https://github.com/Paila009/Rowan-flappy).

1. Push the approved files to the repository's `main` branch.
2. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source.
3. The **Deploy Rowan Flappy to GitHub Pages** workflow runs on changes to the website files. If Pages was enabled after the initial push, run the workflow manually from the **Actions** tab.
4. After a successful deployment, the game will be available at [paila009.github.io/Rowan-flappy/](https://paila009.github.io/Rowan-flappy/).

The workflow uploads only the four website files and `assets/`; documentation, tests, and local tooling are excluded from the published site. The workflow uses GitHub's built-in token, so no deployment secret is needed.
