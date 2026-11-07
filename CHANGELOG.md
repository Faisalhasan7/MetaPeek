# Changelog

## 2.2.0
### Added
- **Places tab:** place names (opt-in, cached), frequent places with your own names (Home, Office…), countries → cities → areas, map of places, and directions to any place.
- **Journeys:** distance, time, speed and likely travel mode between consecutive photos, with a route link.
- **Impossible travel** forensic finding.
- **Sun position** and lighting for each photo (offline). **Camera view cones** on the main map and in the photo view.
- Place names in photo cards, search, CSV/JSON/GeoJSON and KML exports.

## 2.1.0
### Added
- **Set location (geotagging):** write GPS into one photo or every photo shown. Pick it on a map, by place search, or by pasting coordinates / a Google Maps link. JPEG is edited without touching pixels or other metadata; other formats convert to JPEG. Tagged `GPSProcessingMethod = MANUAL` and verified after writing.
- Forensics: new *Location set manually* finding.

### Fixed
- Map tiles blocked ("Access blocked" / 403) on GitHub Pages: OpenStreetMap requires a Referer. Now sends origin only, with automatic fallback to CARTO tiles.

## 2.0.0

### Breaking
- `index.html` and `MetaPeek_Osint.html` merged into one app at `index.html`. The old OSINT URL redirects.

### Security
- Fixed stored XSS: camera make/model, filenames and raw EXIF values were written into `innerHTML`. A crafted photo could run script. All rendering now goes through a text-only DOM builder.
- Added a strict Content-Security-Policy and `no-referrer`.
- CSV export neutralises spreadsheet formula injection.
- Dependencies pinned and vendored (previously unpinned CDN `exifr` and Tailwind Play CDN).

### Performance
- Photos stored as small canvas thumbnails + object URLs instead of full base64 data URLs (large batches no longer exhaust memory).
- Parsing runs 4 files at a time with a progress bar. Object URLs are revoked on clear.
- Fixed route-arrow markers leaking onto the map on every mode switch.

### Added
- Privacy risk score, single and batch metadata cleaning (lossless JPEG/PNG, verified, ZIP + log).
- Forensic findings engine (16 checks), SHA-256 hashing, duplicate detection.
- XMP, ICC, PNG text and embedded-thumbnail parsing. HEIC/AVIF/TIFF/RAW intake, folder drop/select, clipboard paste.
- Search, flagged/high-risk filters, device filter, date range, more sort orders.
- Trips coloured on map with distances, heading indicator, opt-in reverse geocoding.
- Pattern-of-life heatmap, devices view.
- Exports: JSON, CSV, GeoJSON, KML, printable case report (these were advertised in v1 but not implemented).
- Dark mode, keyboard navigation, mobile layout, offline PWA.
