# Mockup Studio

Put your video (or a recorded website) on a 3D MacBook mockup, style the scene, animate it with keyframes and export an MP4 — plus a flat **Dribbble shot** (1600×1200, 1440×1040 frame).

## Run locally (all features)

```bash
npm install
npm start          # http://localhost:4173
```

The local app adds **website recording** (`localhost:3000`, any link — uses the Google Chrome installed on your computer) and **save-to-folder** export.

## Hosted version (Vercel)

`npm run build` copies the browser libraries into `public/vendor`; Vercel serves `public/` and runs `api/capture.js` as a serverless function.

- **Website recording of public links** works on the hosted site. The hosted machine is small, so instead of a live screen recording `api/capture.js` opens the page in headless Chromium (`@sparticuz/chromium`), loads lazy content, and captures the **whole page as tall image tiles** (`lib/record.js`, up to 30,000 px). The app then scrolls through them smoothly at the *Auto scroll speed*; the length is detected from the page height. Web apps with an inner scroll area are unlocked to their full height. Fixed headers appear once and videos / animations on the page are not captured. It refuses localhost / private-network addresses.
- **Pages on your own computer (`localhost:3000` …)**: a hosted server can't reach them, so the live site hands them to the **local app**. Keep `npm start` running on your computer, paste the localhost link on the live site and press *Record scroll*. (Chrome may ask to allow connecting to local devices — allow it.) That path uses the real wheel-scroll recorder (smooth video of animations too, no time limit). The local app only answers your own site and `localhost` (see `ALLOWED_ORIGINS` in `server.js` for a custom domain).
- The folder picker is local-only; on the hosted site MP4s download to the browser's Downloads folder. MP4 export needs a browser with WebCodecs (Chrome, Edge, Safari 17+).
- If the site asks you to log in to Vercel, turn off *Deployment Protection → Vercel Authentication* in the project settings.

## Notes

- 3D models and textures are in `public/models` and `public/textures` (`blender/` has the scripts that generated the table, wall and surface textures).
- The device and background models come from third-party mockup files. Check their licences before making this repository or site public.
