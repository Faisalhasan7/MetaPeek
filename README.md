# 🔍 MetaPeek

> Drop a photo. See what it's hiding.

Photos carry more than just pixels. Every image you take — especially on a smartphone — quietly embeds a bunch of metadata: the camera model, the exact timestamp, camera settings, and sometimes... GPS coordinates pinpointing exactly where you were standing. MetaPeek rips all of that open instantly, right in your browser.

No uploads to a server. No accounts. Just drag, drop, and see.

---

## ✨ What's inside

There are actually **two tools** in this repo, which is worth knowing upfront:

### `index.html` — MetaPeek (Single Image)

The simple one. You drop a photo, it shows you everything:

- **Camera info** — make, model, lens
- **Shooting settings** — shutter speed, aperture, ISO, focal length, flash
- **Dimensions & orientation**
- **Date & time** the photo was taken (not just *saved* — the original capture time)
- **GPS coordinates** — if they exist, it plots them on an embedded OpenStreetMap
- Copy all metadata to clipboard in one click

### `MetaPeek_Osint.html` — MetaPeek OSINT Edition

The powerful one. Built for analyzing *batches* of images — think 20, 50, 100 photos at once. This is the version that starts to feel genuinely useful for investigators, researchers, or honestly just anyone curious about their own photo library.

It adds:

- **Bulk upload** — drag a whole folder of images in at once
- **Statistics dashboard** — how many photos have GPS data, unique cameras found, date range of the collection
- **Interactive Leaflet map** — all geotagged photos plotted together, with clustering and a heatmap layer
- **Timeline chart** — photo activity broken down over time
- **Camera groupings** — photos organized by the device that shot them
- **Photo grid with modal detail view** — click any thumbnail to see its full metadata breakdown
- **Filtering** — slice the collection by GPS availability, camera, date range
- Export everything to JSON or CSV

---

## 🚀 Getting started

It's just HTML. Genuinely. There's no build step, no `npm install`, nothing to configure.

```bash
git clone https://github.com/yourusername/metapeek.git
cd metapeek
```

Then just open `index.html` (or `MetaPeek_Osint.html`) in your browser. That's it.

If you want to serve it properly — maybe you're worried about some browsers being fussy with local file access — you can spin up a tiny local server:

```bash
# Python 3
python -m http.server 8080

# Then visit http://localhost:8080
```

---

## 🛠 Tech stack

Honestly pretty minimal, which is kind of the point:

- **[exifr](https://github.com/MikeKovarik/exifr)** — the heavy lifter for EXIF parsing. It's fast and handles a *lot* of edge cases
- **[Leaflet.js](https://leafletjs.com/)** — interactive maps (OSINT version)
- **[Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster)** — clusters map pins so things don't get messy with lots of photos
- **[leaflet.heat](https://github.com/Leaflet/Leaflet.heat)** — the heatmap layer
- **[Tailwind CSS](https://tailwindcss.com/)** — styling via CDN
- **OpenStreetMap** — map tiles (free, no API key needed)

Zero backend. Everything runs client-side.

---

## 🔒 Privacy

Everything happens locally in your browser. Your photos never leave your device — they're read directly from memory and never sent anywhere. There's no server, no analytics, no tracking.

This matters more than it might seem. The whole *point* of MetaPeek is revealing what data is hiding in images, so it'd be pretty ironic to silently collect that data on a server somewhere.

---

## 💡 Use cases

- **OSINT & investigations** — correlate photo locations, identify devices, build timelines from a batch of images
- **Privacy auditing** — check what metadata your own photos contain before you post them somewhere
- **Photography** — review your shooting data across a session or trip
- **Forensics / journalism** — verify when and where images were taken
- **Just curiosity** — honestly it's kind of wild what your phone quietly embeds in every photo

---

## 📂 File structure

```
metapeek/
├── index.html           # Single-image metadata viewer
└── MetaPeek_Osint.html  # Bulk OSINT analysis tool
```

---

## 🤝 Contributing

Found a bug? Want to add support for more metadata fields, a new export format, or a dark mode? PRs are welcome. Open an issue first if it's a bigger change — just so we're on the same page before you put a ton of work in.

---

## 📄 License

MIT — do whatever you want with it.
