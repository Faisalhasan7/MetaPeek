/* MetaPeek — forensic flags and privacy-exposure scoring. Heuristics, not proof: every flag explains itself. */
(function () {
  'use strict';
  const MP = window.MP;

  const EDITORS = /photoshop|lightroom|gimp|affinity|pixelmator|snapseed|picsart|canva|facetune|vsco|capture one|luminar|darktable|rawtherapee|paint\.net|photoscape|fotor|meitu|lensa|remini|faceapp|adobe firefly|stable diffusion|midjourney|dall.?e|comfyui|automatic1111/i;
  const AI_GEN = /firefly|stable diffusion|midjourney|dall.?e|comfyui|automatic1111|imagen|generative/i;

  MP.FLAG_INFO = {
    NO_METADATA:        { sev: 'info',  title: 'No camera metadata', why: 'EXIF is absent. Typical of screenshots, social-media downloads, messaging apps, or deliberate stripping.' },
    EDIT_SOFTWARE:      { sev: 'warn',  title: 'Processed by editing software', why: 'The Software / CreatorTool tag names an image editor.' },
    AI_SOFTWARE:        { sev: 'alert', title: 'AI generation tool referenced', why: 'Metadata names a generative-AI tool. Treat the image as possibly synthetic.' },
    EDIT_HISTORY:       { sev: 'warn',  title: 'XMP edit history present', why: 'XMP contains History / DerivedFrom / DocumentAncestors entries left by editors.' },
    MODIFIED_AFTER:     { sev: 'warn',  title: 'Modified after capture', why: 'ModifyDate differs from the original capture time.' },
    THUMB_MISMATCH:     { sev: 'alert', title: 'Embedded thumbnail does not match', why: 'The EXIF preview thumbnail has a different aspect ratio than the image. Common after cropping in tools that do not refresh the thumbnail. Compare both visually.' },
    GPS_TIME_DRIFT:     { sev: 'warn',  title: 'GPS clock disagrees with camera clock', why: 'The satellite UTC timestamp does not line up with the camera time plus a valid timezone offset.' },
    NULL_ISLAND:        { sev: 'alert', title: 'GPS at 0°, 0° ("Null Island")', why: 'Coordinates are zero. Usually a failed fix or a tampered location.' },
    DATE_IMPLAUSIBLE:   { sev: 'warn',  title: 'Implausible capture date', why: 'Capture date is in the future or before 1990 (camera clock never set, or edited).' },
    DATE_MISSING:       { sev: 'info',  title: 'No capture date', why: 'EXIF exists but carries no original capture timestamp.' },
    CAMERA_MISSING:     { sev: 'info',  title: 'No device make/model', why: 'EXIF exists but device identity was removed or never written.' },
    EXT_MISMATCH:       { sev: 'warn',  title: 'File extension does not match content', why: 'The file signature (magic bytes) shows a different format than the extension claims.' },
    SERIAL_NUMBER:      { sev: 'info',  title: 'Device serial number embedded', why: 'A body or lens serial number can tie this image to a specific physical device.' },
    OWNER_IDENTITY:     { sev: 'info',  title: 'Owner / author identity embedded', why: 'Artist, Copyright or owner-name fields contain a person or organisation.' },
    DUPLICATE:          { sev: 'info',  title: 'Identical file elsewhere in set', why: 'Another file has the same SHA-256 hash (byte-for-byte copy, possibly renamed).' },
    IMPOSSIBLE_TRAVEL:  { sev: 'alert', title: 'Impossible travel', why: 'This photo and the previous one (by capture time) are too far apart to travel between in the time recorded, faster than an airliner. A location or timestamp is likely wrong or edited.' },
    MANUAL_GPS:         { sev: 'info',  title: 'Location set manually', why: 'Coordinates were entered by hand (GPSProcessingMethod = MANUAL, or set in MetaPeek), not recorded by a GPS receiver.' },
    UNDECODABLE:        { sev: 'info',  title: 'Browser cannot render pixels', why: 'Metadata was read, but this browser cannot decode the image (e.g. HEIC/RAW in Chrome).' }
  };
  const SEV_RANK = { alert: 3, warn: 2, info: 1 };
  MP.SEV_RANK = SEV_RANK;

  function flag(rec, code, detail) {
    const f = MP.FLAG_INFO[code];
    rec.flags.push({ code, sev: f.sev, title: f.title, why: f.why, detail: detail || '' });
  }

  MP.analyze = function analyze(rec) {
    rec.flags = [];
    const t = rec.tags, segs = rec.segs;

    // Extension vs content
    const fam = MP.extFamily(rec.ext);
    if (fam && fam !== 'unknown' && rec.realType !== 'unknown' && fam !== rec.realType &&
        !(fam === 'heic' && rec.realType === 'isobmff') && !(fam === 'tiff' && rec.realType === 'tiff')) {
      flag(rec, 'EXT_MISMATCH', `.${rec.ext} file contains ${rec.realType.toUpperCase()} data`);
    }

    if (!rec.hasExif) flag(rec, 'NO_METADATA');
    if (!rec.decodable) flag(rec, 'UNDECODABLE', rec.realType.toUpperCase());

    // Software / AI
    const swFields = [t.Software, t.CreatorTool, t.ProcessingSoftware, t.HistorySoftwareAgent].filter(Boolean).map(String);
    const xmpText = segs.xmp ? safeJson(segs.xmp) : '';
    const sw = swFields.find((s) => EDITORS.test(s));
    if (sw) flag(rec, 'EDIT_SOFTWARE', sw);
    if (swFields.some((s) => AI_GEN.test(s)) || /c2pa|trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/i.test(xmpText)) {
      flag(rec, 'AI_SOFTWARE', (swFields.find((s) => AI_GEN.test(s)) || 'IPTC digital source type / C2PA marker'));
    }
    if (/History|DerivedFrom|DocumentAncestors/.test(Object.keys(segs.xmp || {}).join(' '))) flag(rec, 'EDIT_HISTORY');

    // Time consistency
    if (rec.date && rec.modifyDate && rec.dateSource === 'DateTimeOriginal') {
      const diff = Math.abs(rec.modifyDate - rec.date) / 1000;
      if (diff > 60) flag(rec, 'MODIFIED_AFTER', `${MP.fmtDate(rec.date)} → ${MP.fmtDate(rec.modifyDate)}`);
    }
    if (rec.date) {
      const y = rec.date.getFullYear();
      if (rec.date.getTime() > Date.now() + 86400000 || y < 1990) flag(rec, 'DATE_IMPLAUSIBLE', MP.fmtDate(rec.date));
    } else if (rec.hasExif) flag(rec, 'DATE_MISSING');
    if (rec.hasExif && !rec.make && !rec.model) flag(rec, 'CAMERA_MISSING');

    // GPS clock vs camera clock. Camera time is "wall clock" parsed as local; compare as naive wall-clock minutes.
    if (rec.gpsUtc && rec.date) {
      const wallMin = Date.UTC(rec.date.getFullYear(), rec.date.getMonth(), rec.date.getDate(), rec.date.getHours(), rec.date.getMinutes()) / 60000;
      const utcMin = rec.gpsUtc.getTime() / 60000;
      const diff = wallMin - utcMin; // should equal tz offset
      let bad;
      if (rec.offsetMin !== null) bad = Math.abs(diff - rec.offsetMin) > 5;
      else bad = Math.abs(diff) > 14 * 60 + 5 || Math.abs(diff - Math.round(diff / 15) * 15) > 5;
      if (bad) flag(rec, 'GPS_TIME_DRIFT', `camera ${MP.isoLocal(rec.date)} vs GPS ${rec.gpsUtc.toISOString().slice(0, 19)}Z (${Math.round(diff)} min apart${rec.offsetMin !== null ? `, declared offset ${rec.offsetMin} min` : ''})`);
    }
    if (rec.gpsManual || /MANUAL/i.test(textOf(t.GPSProcessingMethod))) flag(rec, 'MANUAL_GPS', rec.gpsManual ? 'Set in this MetaPeek session' : 'GPSProcessingMethod: MANUAL');
    if (rec.hasGps && Math.abs(rec.lat) < 0.001 && Math.abs(rec.lon) < 0.001) flag(rec, 'NULL_ISLAND');

    // Embedded thumbnail geometry
    if (rec.embThumb && rec.width && rec.height && rec.decodable) {
      const a1 = rec.width / rec.height, a2 = rec.embThumb.width / rec.embThumb.height;
      const close = (x, y) => Math.abs(x - y) / Math.max(x, y) < 0.06;
      if (!close(a1, a2) && !close(a1, 1 / a2)) {
        flag(rec, 'THUMB_MISMATCH', `image ${rec.width}×${rec.height} vs thumbnail ${rec.embThumb.width}×${rec.embThumb.height}`);
      }
    }

    // Identity leads
    const serial = t.BodySerialNumber || t.SerialNumber || t.InternalSerialNumber || t.CameraSerialNumber || t.LensSerialNumber;
    rec.serial = serial ? String(serial).trim() : '';
    if (rec.serial) flag(rec, 'SERIAL_NUMBER', rec.serial);
    const owner = [t.Artist, t.Copyright, t.OwnerName, t.CameraOwnerName, t.XPAuthor, t.creator, t.Creator, t['By-line'], t.Rights, t.Author]
      .filter((v) => v && String(v).trim()).map((v) => Array.isArray(v) ? v.join(', ') : String(v).trim());
    rec.owner = [...new Set(owner)].join(' · ');
    if (rec.owner) flag(rec, 'OWNER_IDENTITY', rec.owner);

    rec.risk = scoreRisk(rec);
    sortFlags(rec);
  };

  function sortFlags(rec) {
    rec.flags.sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
    rec.topSev = rec.flags.reduce((m, f) => Math.max(m, SEV_RANK[f.sev]), 0);
    rec.suspicious = rec.flags.some((f) => f.sev !== 'info');
  }

  function textOf(v) {
    if (!v) return '';
    if (ArrayBuffer.isView(v)) { try { return String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); } catch { return ''; } }
    return String(v);
  }
  function safeJson(o) { try { return JSON.stringify(o); } catch { return ''; } }

  /** Privacy exposure: what a stranger learns if this exact file is shared. */
  function scoreRisk(rec) {
    const t = rec.tags, items = [];
    const add = (pts, label, detail) => items.push({ pts, label, detail });
    if (rec.hasGps) add(45, 'Exact GPS location', `${MP.coord(rec.lat, 5)}, ${MP.coord(rec.lon, 5)}`);
    if (rec.alt !== null || rec.heading !== null) add(5, 'Altitude / facing direction', [rec.alt !== null ? `${Math.round(rec.alt)} m` : '', rec.heading !== null ? `${Math.round(rec.heading)}°` : ''].filter(Boolean).join(' · '));
    if (rec.serial) add(15, 'Device serial number', rec.serial);
    if (rec.owner) add(10, 'Name / copyright owner', rec.owner);
    if (rec.date) add(10, 'Exact capture time', MP.fmtDate(rec.date));
    if (rec.make || rec.model) add(5, 'Device make & model', rec.camera);
    if (rec.lens) add(3, 'Lens model', rec.lens);
    if (rec.software) add(2, 'Software', rec.software);
    const note = [t.ImageDescription, t.UserComment, t.XPComment, t.Comment, t.Description, t['Caption-Abstract']].find((v) => v && typeof v === 'string' && v.trim());
    if (note) add(5, 'Free-text description / comment', note.trim().slice(0, 120));
    if (rec.segs.xmp) add(5, 'XMP block (may hold edit history, IDs)', '');
    if (rec.embThumb) add(5, 'Embedded preview thumbnail', 'may show pre-crop content');
    if (t.ImageUniqueID || t.DocumentID || t.InstanceID || t.OriginalDocumentID) add(5, 'Unique image / document IDs', String(t.ImageUniqueID || t.DocumentID || t.OriginalDocumentID || t.InstanceID));
    const score = Math.min(100, items.reduce((s, i) => s + i.pts, 0));
    const level = score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low';
    return { score, level, items };
  }

  /** Collection-level analysis: duplicates by hash, devices by serial. */
  MP.analyzeCollection = function (photos) {
    const byHash = new Map();
    for (const p of photos) {
      p.flags = p.flags.filter((f) => f.code !== 'DUPLICATE' && f.code !== 'IMPOSSIBLE_TRAVEL');
      if (!p.sha256) continue;
      if (!byHash.has(p.sha256)) byHash.set(p.sha256, []);
      byHash.get(p.sha256).push(p);
    }
    const dupGroups = [];
    for (const group of byHash.values()) {
      if (group.length < 2) continue;
      dupGroups.push(group);
      for (const p of group) {
        const others = group.filter((o) => o !== p).map((o) => o.name).join(', ');
        p.flags.push({ code: 'DUPLICATE', sev: 'info', title: MP.FLAG_INFO.DUPLICATE.title, why: MP.FLAG_INFO.DUPLICATE.why, detail: others });
      }
    }
    if (MP.places) {
      for (const l of MP.places.legs(photos)) {
        if (!l.impossible) continue;
        const detail = `${l.from.name} → ${l.to.name}: ${Math.round(l.km)} km in ${l.hours < 1 ? Math.round(l.hours * 60) + ' min' : l.hours.toFixed(1) + ' h'}${l.approx ? ' (timezone estimated)' : ''}`;
        for (const p of [l.from, l.to]) if (!p.flags.some((f) => f.code === 'IMPOSSIBLE_TRAVEL')) p.flags.push({ code: 'IMPOSSIBLE_TRAVEL', sev: 'alert', title: MP.FLAG_INFO.IMPOSSIBLE_TRAVEL.title, why: MP.FLAG_INFO.IMPOSSIBLE_TRAVEL.why, detail });
      }
    }
    photos.forEach(sortFlags);
    const devices = new Map();
    for (const p of photos) {
      const key = p.serial ? `${p.camera} · S/N ${p.serial}` : null;
      if (!key) continue;
      if (!devices.has(key)) devices.set(key, []);
      devices.get(key).push(p);
    }
    return { dupGroups, devices };
  };
})();
