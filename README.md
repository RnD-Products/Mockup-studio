# Mockup Studio

Put your video (or a recorded website) on a 3D MacBook mockup, style the scene, animate it with keyframes and export an MP4 — plus a flat **Dribbble shot** (1600×1200, 1440×1040 frame).

## Run locally (all features)

```bash
npm install
npm start          # http://localhost:4173
```

The local app adds **website recording** (`localhost:3000`, any link — uses the Google Chrome installed on your computer) and **save-to-folder** export.

## Hosted version (Vercel)

The app also works as plain static files. `npm run build` copies the browser libraries into `public/vendor`; Vercel serves `public/`.
On the hosted version, website recording and the folder picker are unavailable; MP4s download to the browser's Downloads folder. MP4 export needs a browser with WebCodecs (Chrome, Edge, Safari 17+).

## Notes

- 3D models and textures are in `public/models` and `public/textures` (`blender/` has the scripts that generated the table, wall and surface textures).
- The device and background models come from third-party mockup files. Check their licences before making this repository or site public.
