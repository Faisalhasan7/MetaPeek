# 🔍 MetaPeek v2

> Drop a photo. See what it's hiding. Then make it hide nothing.

MetaPeek reads everything a photo quietly carries (GPS position, device, serial numbers, timestamps, editing history) and turns it into something useful: a privacy score, forensic red flags, maps, timelines and evidence-grade exports. It can also strip all of it out before you share.

Everything runs in your browser. No uploads, no accounts, no tracking, and it works offline once loaded.

---

## What's new in v2

v1 shipped as two separate pages. v2 merges them into **one app** that handles a single photo or a folder of thousands.

| Area | v1 | v2 |
|---|---|---|
| Apps | Two pages (single + OSINT) | One app; one photo opens straight into detail view |
| Security | EXIF text and filenames injected as HTML (XSS) | All metadata rendered as text; strict Content-Security-Policy |
| Performance | Every photo kept as a base64 data URL | Small canvas thumbnails + object URLs, parsed 4 at a time with progress |
| Formats | JPEG/PNG via `image/*` | + HEIC, AVIF, WebP, TIFF, RAW (DNG, CR2, NEF, ARW…); folders and paste |
| Metadata | EXIF/IPTC | + XMP, ICC, embedded thumbnails, PNG text chunks |
| Privacy | View only | **Privacy risk score** + **one-click clean** (lossless JPEG/PNG, batch ZIP, verified) |
| Forensics | none | Edit software, AI-tool markers, XMP history, modify-after-capture, GPS vs camera clock drift, thumbnail mismatch, Null Island, spoofed extensions, duplicates by SHA-256, serial numbers |
| Filters | GPS / no GPS | + search, flagged, high risk, device, date range, 6 sort orders |
| Map | Markers, heat, route | + trips coloured by journey, distance per trip, heading arrow, opt-in address lookup |
| Timeline | Bars + sessions | + pattern-of-life heatmap (weekday × hour) |
| Export | Promised in README, missing | JSON, CSV, GeoJSON, KML (with route), printable **case report** with hashes |
| UX | Light only | Dark mode, keyboard nav (← → Esc), mobile layout, installable PWA |
| Dependencies | Unpinned CDNs incl. Tailwind Play CDN | Pinned, vendored locally, no build step |

---

## Features

### 🛡 Privacy
- **Risk score (0–100)** per photo: what a stranger learns from that exact file (location, serial, owner name, capture time, device, IDs, comments).
- **Clean & download**: removes metadata from one photo or the whole filtered set (ZIP).
  - JPEG and PNG are cleaned **losslessly**: metadata segments are dropped and pixels are untouched. The ICC colour profile is kept so colours don't shift.
  - Rotated JPEGs and other formats are re-encoded at high quality with orientation applied.
  - Every output is **re-scanned** to confirm nothing remains, and the ZIP includes a log.

### 🧭 Places (location intelligence)
- **Place names** for every geotagged photo ("Gulshan, Dhaka"). Opt-in lookup through OpenStreetMap at 1 per second; only coordinates are sent. Results are cached in your browser, so each spot is looked up once. You can turn on auto-lookup for new photos.
- **Frequent places:** photos within ~150 m grouped and ranked by days visited, with photo count, first and last visit, and approximate time spent.
- **Your own places:** name a spot (Home, Office, Gym…) and it's remembered in this browser and shown everywhere.
- **Where you've been:** countries → cities → areas, with a one-click filter for each.
- **Directions** to any photo or place (Google Maps), plus a route between consecutive photos.
- **Journeys:** every move between photos, with distance, time, speed and likely travel mode. Moves faster than an airliner are flagged as **impossible travel** in Forensics.
- **Sun position** (offline): elevation, direction and phase (daylight, golden hour, twilight, night). Also whether the camera faced into the sun.
- **Camera view cones:** which way the camera faced and how wide, from the compass heading and focal length. Shown on the main map and in the photo view.

### 📍 Add a location (geotagging)
- Give any photo a location: click the map, drag the pin, search an address, or paste coordinates or a Google Maps / OSM link. Altitude is optional.
- Works for **one photo** (from its detail view) or **every photo shown** (toolbar → *Set location*, optionally only the ones without GPS) → ZIP.
- **JPEG**: GPS is added to the existing EXIF. Pixels and all other metadata stay exactly as they were.
- **PNG / WebP / HEIC**: converted to high-quality JPEG with the GPS, device and capture date carried over.
- The tag is honestly marked `GPSProcessingMethod = MANUAL`, and MetaPeek flags manually-set locations in Forensics.
- Each output is re-read to verify the coordinates landed.

### 🧪 Forensics
Each finding explains itself and is rated `ALERT`, `WARN` or `INFO`:

| Check | What it catches |
|---|---|
| Editing software | Photoshop, Lightroom, GIMP, Snapseed, Canva… in Software/CreatorTool |
| AI generation markers | Firefly, Midjourney, Stable Diffusion, IPTC *trainedAlgorithmicMedia*, C2PA |
| XMP edit history | History / DerivedFrom / DocumentAncestors left by editors |
| Modified after capture | ModifyDate ≠ DateTimeOriginal |
| GPS clock drift | Satellite UTC time doesn't match camera time + valid timezone |
| Thumbnail mismatch | Embedded EXIF preview has a different shape (classic crop tell), shown side by side |
| Null Island | GPS at 0°, 0° |
| Extension spoofing | `.jpg` that is really PNG (magic-byte check) |
| Duplicates | Byte-identical files under different names (SHA-256) |
| Manual location | GPS entered by hand (`GPSProcessingMethod = MANUAL`) |
| Identity leads | Body/lens serial numbers, artist, copyright, owner |

These are heuristics, not verdicts. Metadata can be forged.

### 🗺 Map, timeline, devices
- Clustered thumbnail markers, heatmap, and chronological routes, split into **trips** with distance.
- Activity chart by day, month or year; **pattern-of-life** grid; shooting sessions.
- Device view with lenses, serial numbers and software per camera.

### 📦 Exports
`JSON` (every segment) · `CSV` (formula-injection safe) · `GeoJSON` · `KML` (Google Earth, with route) · **Case report** (HTML → Print → PDF, with case ID, analyst, notes, SHA-256 per file and all findings).

Exports cover whatever your current filters show.

---

## Getting started

No build, no install.

```bash
git clone https://github.com/Faisalhasan7/MetaPeek.git
cd MetaPeek
# open index.html in your browser, or serve it:
python3 -m http.server 8080   # → http://localhost:8080
```

Serving over `http://localhost` or HTTPS (e.g. GitHub Pages) enables offline mode / install-as-app. It also guarantees SHA-256 hashing, which needs a secure context.

---

## Project structure

```
MetaPeek/
├── index.html              # The app
├── MetaPeek_Osint.html     # Redirect to index.html (keeps old links working)
├── css/app.css             # Design tokens, light/dark themes
├── js/
│   ├── theme.js            # Applies saved theme before paint
│   ├── util.js             # Safe DOM builder, icons, pool, hashing, helpers
│   ├── parse.js            # Ingest: magic bytes, exifr, thumbnails
│   ├── forensics.js        # Findings + privacy risk score
│   ├── strip.js            # Lossless JPEG/PNG cleaning, re-encode, verify, ZIP
│   ├── geotag.js           # Write GPS into photos, coordinate parsing
│   ├── places.js           # Place names, frequent places, journeys, sun position, view cones
│   ├── export.js           # JSON / CSV / GeoJSON / KML / case report
│   └── app.js              # State, filters, views, modal
├── vendor/                 # Pinned: exifr 7.1.3, Leaflet 1.9.4, markercluster 1.5.3, leaflet.heat 0.2.0, JSZip 3.10.1
├── sw.js, manifest.webmanifest, icons/
└── .github/workflows/static.yml   # GitHub Pages deploy
```

## Privacy

Photos are read from memory and never transmitted. The only network calls are OpenStreetMap map tiles, plus **opt-in** address lookup and place search: they send coordinates or your search text (never the image) to Nominatim, and only after you confirm. A strict Content-Security-Policy blocks everything else.

## Tech

[exifr](https://github.com/MikeKovarik/exifr) · [Leaflet](https://leafletjs.com/) + markercluster + heat · [JSZip](https://stuk.github.io/jszip/) · [piexifjs](https://github.com/hMatoba/piexifjs) · OpenStreetMap. Vanilla JS, no framework, no build.

## Contributing

PRs welcome. For a bigger change, open an issue first. Please keep the two rules: **no data leaves the device**, and **never put metadata into `innerHTML`** (use `MP.el`).

## License

MIT
