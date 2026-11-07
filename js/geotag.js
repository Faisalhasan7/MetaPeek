/* MetaPeek — write GPS coordinates into photos (geotagging).
 * JPEG: GPS is added to the existing EXIF; all other metadata and the pixels stay as they are.
 * Other formats: converted to a high-quality JPEG carrying the GPS plus capture date/device.
 * Every output is re-read to confirm the coordinates landed. */
(function () {
  'use strict';
  const MP = window.MP;

  function toBinary(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return s;
  }
  function fromBinary(s) {
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
    return u8;
  }

  function dmsRational(deg) {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const mFloat = (a - d) * 60;
    const m = Math.floor(mFloat);
    const s = Math.round((mFloat - m) * 60 * 10000);
    return [[d, 1], [m, 1], [s, 10000]];
  }

  function gpsIfd(loc) {
    const G = piexif.GPSIFD;
    const g = {};
    g[G.GPSVersionID] = [2, 3, 0, 0];
    g[G.GPSLatitudeRef] = loc.lat >= 0 ? 'N' : 'S';
    g[G.GPSLatitude] = dmsRational(loc.lat);
    g[G.GPSLongitudeRef] = loc.lon >= 0 ? 'E' : 'W';
    g[G.GPSLongitude] = dmsRational(loc.lon);
    if (typeof loc.alt === 'number' && isFinite(loc.alt)) {
      g[G.GPSAltitudeRef] = loc.alt < 0 ? 1 : 0;
      g[G.GPSAltitude] = [Math.round(Math.abs(loc.alt) * 100), 100];
    }
    g[G.GPSMapDatum] = 'WGS-84';
    // Standard EXIF way to say the position did not come from a GPS receiver.
    g[G.GPSProcessingMethod] = 'ASCII\0\0\0MANUAL';
    return g;
  }

  const exifDate = (d) => `${d.getFullYear()}:${MP.pad(d.getMonth() + 1)}:${MP.pad(d.getDate())} ${MP.pad(d.getHours())}:${MP.pad(d.getMinutes())}:${MP.pad(d.getSeconds())}`;

  /** Try progressively simpler EXIF if the original contains tags piexif cannot re-serialise. */
  function dumpWithFallback(exif) {
    const attempts = [
      ['all metadata kept', () => exif],
      ['maker note dropped', () => { const e = Object.assign({}, exif, { Exif: Object.assign({}, exif.Exif) }); delete e.Exif[37500]; return e; }],
      ['thumbnail & interop dropped', () => ({ '0th': exif['0th'], Exif: Object.fromEntries(Object.entries(exif.Exif || {}).filter(([k]) => +k !== 37500)), GPS: exif.GPS, Interop: {}, '1st': {}, thumbnail: null })],
      ['only basic tags kept', () => ({ '0th': pick(exif['0th'], [271, 272, 274, 305, 306]), Exif: pick(exif.Exif, [36867, 36868, 36880, 36881]), GPS: exif.GPS, Interop: {}, '1st': {}, thumbnail: null })]
    ];
    let lastErr;
    for (const [note, build] of attempts) {
      try { return { bytes: piexif.dump(build()), note }; } catch (e) { lastErr = e; }
    }
    throw new Error('Could not write EXIF: ' + (lastErr && lastErr.message));
  }
  function pick(obj, keys) { const o = {}; for (const k of keys) if (obj && obj[k] !== undefined) o[k] = obj[k]; return o; }

  async function toJpeg(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // flatten transparency
    ctx.drawImage(bmp, 0, 0);
    bmp.close && bmp.close();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    if (!blob) throw new Error('JPEG conversion failed');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** @param loc {lat, lon, alt?} @returns {Promise<{blob,name,method,note,verified}>} */
  MP.geotagRecord = async function geotagRecord(rec, loc) {
    if (typeof piexif === 'undefined') throw new Error('EXIF writer failed to load');
    if (!(Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180)) throw new Error('Coordinates out of range');

    let jpegBin, exif, method;
    if (rec.realType === 'jpeg') {
      jpegBin = toBinary(new Uint8Array(await rec.file.arrayBuffer()));
      try { exif = piexif.load(jpegBin); } catch { exif = null; }
      method = 'GPS added (original JPEG kept)';
    } else {
      if (!rec.decodable) throw new Error(`${rec.realType.toUpperCase()} can't be decoded in this browser`);
      jpegBin = toBinary(await toJpeg(rec.file));
      exif = null;
      method = `converted ${rec.realType.toUpperCase()} → JPEG`;
    }
    if (!exif) {
      exif = { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {}, thumbnail: null };
      // Carry over the essentials we already read, so the new file isn't anonymous by surprise.
      if (rec.make) exif['0th'][piexif.ImageIFD.Make] = rec.make;
      if (rec.model) exif['0th'][piexif.ImageIFD.Model] = rec.model;
      if (rec.date) exif.Exif[piexif.ExifIFD.DateTimeOriginal] = exifDate(rec.date);
    }
    if (rec.realType !== 'jpeg') exif['0th'][piexif.ImageIFD.Orientation] = 1; // pixels already rotated
    exif.GPS = gpsIfd(loc);

    const dumped = dumpWithFallback(exif);
    const bytes = dumped.bytes;
    const note = rec.realType === 'jpeg' && exif !== null ? dumped.note : 'new EXIF with device & date carried over';
    const out = fromBinary(piexif.insert(bytes, jpegBin));
    const blob = new Blob([out], { type: 'image/jpeg' });

    let verified = false;
    try {
      const g = await exifr.gps(await blob.arrayBuffer());
      verified = !!g && Math.abs(g.latitude - loc.lat) < 1e-5 && Math.abs(g.longitude - loc.lon) < 1e-5;
    } catch { /* stays false */ }

    const base = rec.name.replace(/\.[^.]+$/, '');
    return { blob, name: `${base}_geotagged.jpg`, method, note, verified };
  };

  /** Update the in-app record so map, trips, risk and exports reflect the new location. */
  MP.applyManualLocation = function (rec, loc) {
    rec.lat = loc.lat; rec.lon = loc.lon; rec.hasGps = true;
    rec.alt = typeof loc.alt === 'number' && isFinite(loc.alt) ? loc.alt : rec.alt;
    rec.gpsManual = true;
    MP.analyze(rec);
  };

  MP.geotagMany = async function (records, loc, onProgress) {
    const zip = new JSZip();
    const log = [], used = new Set();
    await MP.pool(records, 3, async (r) => {
      try {
        const res = await MP.geotagRecord(r, loc);
        let name = res.name, n = 1;
        while (used.has(name)) name = res.name.replace(/(\.[^.]+)$/, `_${++n}$1`);
        used.add(name);
        zip.file(name, res.blob);
        MP.applyManualLocation(r, loc);
        log.push(`${r.name}\t${name}\t${res.method}; ${res.note}\t${res.verified ? 'verified' : 'CHECK'}`);
      } catch (e) {
        log.push(`${r.name}\t-\tFAILED\t${e.message}`);
      }
    }, onProgress);
    zip.file('_metapeek_geotag_log.tsv', `location\t${loc.lat},${loc.lon}${loc.alt != null ? ',' + loc.alt : ''}\n\nsource\toutput\tmethod\tresult\n${log.join('\n')}\n`);
    return zip.generateAsync({ type: 'blob' });
  };

  /** Parse "23.78, 90.41", "23.78 90.41", DMS like 23°46'50.2"N 90°24'25.2"E, or a Google/OSM/Apple maps URL. */
  MP.parseCoords = function (text) {
    if (!text) return null;
    const t = String(text).trim();
    let m = t.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ||                 // google .../@lat,lon,17z
            t.match(/[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ||
            t.match(/mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/) ||
            t.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return valid(+m[1], +m[2]);
    const dms = /(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|″|''))?\s*([NSEW])/gi;
    const parts = [...t.matchAll(dms)];
    if (parts.length === 2) {
      const conv = (p) => { const v = +p[1] + (+p[2] || 0) / 60 + (+p[3] || 0) / 3600; return /[SW]/i.test(p[4]) ? -v : v; };
      const a = parts.find((p) => /[NS]/i.test(p[4])), b = parts.find((p) => /[EW]/i.test(p[4]));
      if (a && b) return valid(conv(a), conv(b));
    }
    return null;
    function valid(lat, lon) { return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null; }
  };
})();
