# MetaPeek

**MetaPeek** is a privacy-first, browser-based image metadata viewer that instantly extracts and displays EXIF data from photos — including camera info, timestamps, and GPS coordinates — without uploading images to any server.

All processing happens locally in the user’s browser using JavaScript and the EXIFR library.

---

## Features

- Drag-and-drop or file selection image upload  
- Instant EXIF metadata extraction in browser  
- Camera, lens, date, exposure, and file details  
- GPS coordinate detection with optional map preview  
- Copy metadata to clipboard  
- Image preview with filename display  
- Fully client-side — no uploads, no tracking  
- Modern glassmorphic UI with TailwindCSS  

---

## Privacy Model

MetaPeek is designed with strict client-side privacy:

- Images never leave the browser
- EXIF parsing runs locally via JavaScript
- GPS coordinates are **only sent to OpenStreetMap if the user clicks “Show Location Map”**
- No analytics or external storage

---

## How It Works

1. User selects or drops an image
2. Browser reads the file via FileReader
3. EXIF data extracted using EXIFR
4. Metadata rendered dynamically in UI
5. GPS data (if present) converted to map link
6. Optional map iframe loads OpenStreetMap

---

## Tech Stack

- HTML5  
- TailwindCSS  
- Vanilla JavaScript  
- EXIFR (client-side EXIF parser)  
- OpenStreetMap embed  
