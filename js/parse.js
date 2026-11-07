/* MetaPeek — file ingestion: hashing, magic-byte typing, EXIF/XMP/IPTC/ICC parsing, thumbnails. */
(function () {
  'use strict';
  const MP = window.MP;

  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?|bmp|dng|cr2|cr3|nef|arw|orf|rw2|raf)$/i;
  MP.isImageFile = (f) => (f.type && f.type.startsWith('image/')) || IMAGE_EXT.test(f.name || '');

  const THUMB_MAX = 360;
  let seq = 0;

  /** Identify the real container format from magic bytes (forensics: extension spoofing). */
  function sniff(bytes) {
    const b = bytes;
    const ascii = (s, e) => String.fromCharCode(...b.slice(s, e));
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
    if (ascii(0, 3) === 'GIF') return 'gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
    if (ascii(4, 8) === 'ftyp') {
      const brand = ascii(8, 12);
      if (/^(avif|avis)/.test(brand)) return 'avif';
      if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(brand)) return 'heic';
      if (/^crx/.test(brand)) return 'cr3';
      return 'isobmff';
    }
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'tiff';
    if (ascii(0, 2) === 'BM') return 'bmp';
    return 'unknown';
  }
  const EXT_FAMILY = {
    jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', heic: 'heic', heif: 'heic', avif: 'avif',
    tif: 'tiff', tiff: 'tiff', dng: 'tiff', cr2: 'tiff', nef: 'tiff', arw: 'tiff', orf: 'tiff', rw2: 'tiff', bmp: 'bmp', cr3: 'cr3', raf: 'unknown'
  };
  MP.extFamily = (ext) => EXT_FAMILY[ext] || null;

  const EXIFR_OPTS = {
    tiff: true, ifd0: true, ifd1: true, exif: true, gps: true, interop: true,
    iptc: true, xmp: true, icc: true, jfif: true, ihdr: true,
    makerNote: false, userComment: true,
    translateKeys: true, translateValues: false, reviveValues: true,
    sanitize: true, mergeOutput: false
  };

  function dms(v, ref) {
    if (typeof v === 'number') return (ref === 'S' || ref === 'W') ? -Math.abs(v) : v;
    if (!Array.isArray(v) || v.length < 3) return null;
    const d = v[0] + v[1] / 60 + v[2] / 3600;
    return (ref === 'S' || ref === 'W') ? -d : d;
  }

  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'string') {
      const s = v.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const d = new Date(s);
      return isNaN(d) ? null : d;
    }
    return null;
  }

  function gpsUtc(g) {
    if (!g || !g.GPSDateStamp || g.GPSTimeStamp == null) return null;
    const ds = String(g.GPSDateStamp).match(/(\d{4})\D(\d{2})\D(\d{2})/);
    if (!ds) return null;
    let h, m, s;
    if (Array.isArray(g.GPSTimeStamp)) [h, m, s] = g.GPSTimeStamp;
    else { const t = String(g.GPSTimeStamp).split(':').map(Number); [h, m, s] = t; }
    if ([h, m, s].some((x) => typeof x !== 'number' || isNaN(x))) return null;
    return new Date(Date.UTC(+ds[1], +ds[2] - 1, +ds[3], h, m, Math.floor(s)));
  }

  function parseOffset(s) {
    const m = typeof s === 'string' && s.match(/^([+-])(\d{2}):?(\d{2})$/);
    return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null;
  }

  async function decodeThumb(blobOrFile) {
    const bmp = await createImageBitmap(blobOrFile);
    const scale = Math.min(1, THUMB_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close && bmp.close();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    out.url = blob ? URL.createObjectURL(blob) : null;
    return out;
  }

  MP.parseFile = async function parseFile(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf, 0, Math.min(64, buf.byteLength));
    const ext = (file.name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();

    const rec = {
      id: 'p' + (++seq), file, name: file.name, size: file.size, type: file.type || '', ext,
      realType: sniff(bytes), lastModified: file.lastModified ? new Date(file.lastModified) : null,
      path: file.webkitRelativePath || file._relPath || '',
      sha256: null, segs: {}, tags: {}, hasExif: false, flags: [], risk: null,
      thumbUrl: null, width: null, height: null, decodable: true, embThumb: null
    };

    const [hash, segs] = await Promise.all([
      MP.sha256(buf).catch(() => null),
      exifr.parse(buf, EXIFR_OPTS).catch((e) => { console.warn('[MetaPeek] exifr', file.name, e); return null; })
    ]);
    rec.sha256 = hash;
    rec.segs = segs || {};

    // Flat view (later segments don't overwrite earlier, more specific ones)
    const order = ['ifd0', 'exif', 'gps', 'interop', 'iptc', 'xmp', 'icc', 'jfif', 'ihdr', 'ifd1'];
    const flat = {};
    for (const k of order) {
      const seg = rec.segs[k];
      if (seg && typeof seg === 'object') for (const [kk, vv] of Object.entries(seg)) if (!(kk in flat)) flat[kk] = vv;
    }
    for (const [k, v] of Object.entries(rec.segs)) if (!order.includes(k) && (typeof v !== 'object' || v instanceof Date)) flat[k] = v;
    rec.tags = flat;
    rec.hasExif = !!(rec.segs.ifd0 || rec.segs.exif || rec.segs.gps);

    // Core fields
    const t = flat;
    rec.make = String(t.Make || '').trim();
    rec.model = String(t.Model || '').trim();
    rec.camera = rec.make && rec.model
      ? (rec.model.toLowerCase().startsWith(rec.make.toLowerCase()) ? rec.model : `${rec.make} ${rec.model}`)
      : (rec.make || rec.model || 'Unknown camera');
    rec.lens = String(t.LensModel || t.Lens || t.LensInfoString || '').trim();
    rec.software = String(t.Software || t.CreatorTool || t.ProcessingSoftware || '').trim();
    rec.orientation = typeof t.Orientation === 'number' ? t.Orientation : 1;

    const g = rec.segs.gps || {};
    let lat = g.latitude ?? rec.segs.latitude ?? dms(g.GPSLatitude, g.GPSLatitudeRef);
    let lon = g.longitude ?? rec.segs.longitude ?? dms(g.GPSLongitude, g.GPSLongitudeRef);
    rec.hasGps = typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    rec.lat = rec.hasGps ? lat : null;
    rec.lon = rec.hasGps ? lon : null;
    rec.alt = typeof g.GPSAltitude === 'number' ? (g.GPSAltitudeRef === 1 ? -g.GPSAltitude : g.GPSAltitude) : null;
    rec.heading = typeof g.GPSImgDirection === 'number' ? g.GPSImgDirection : null;
    rec.gpsUtc = gpsUtc(g);

    const se = rec.segs.exif || {};
    const s0 = rec.segs.ifd0 || {};
    rec.date = toDate(se.DateTimeOriginal) || toDate(se.CreateDate) || toDate(t.DateCreated) || toDate(s0.ModifyDate);
    rec.dateSource = toDate(se.DateTimeOriginal) ? 'DateTimeOriginal' : toDate(se.CreateDate) ? 'CreateDate' : toDate(t.DateCreated) ? 'XMP/IPTC DateCreated' : toDate(s0.ModifyDate) ? 'ModifyDate' : null;
    rec.modifyDate = toDate(s0.ModifyDate) || toDate(t.ModifyDate);
    rec.offsetMin = parseOffset(se.OffsetTimeOriginal || se.OffsetTime);

    // Pixels: real decode for thumb & dimensions; fall back to embedded EXIF thumbnail.
    try {
      const th = await decodeThumb(file);
      rec.thumbUrl = th.url; rec.width = th.width; rec.height = th.height;
    } catch {
      rec.decodable = false;
    }
    try {
      const emb = await exifr.thumbnail(buf);
      if (emb && emb.byteLength) {
        const blob = new Blob([emb], { type: 'image/jpeg' });
        const eb = await createImageBitmap(blob);
        rec.embThumb = { url: URL.createObjectURL(blob), width: eb.width, height: eb.height, bytes: emb.byteLength };
        eb.close && eb.close();
        if (!rec.thumbUrl) rec.thumbUrl = rec.embThumb.url;
      }
    } catch { /* no embedded thumbnail */ }
    if (!rec.width) { rec.width = t.ExifImageWidth || t.ImageWidth || null; rec.height = t.ExifImageHeight || t.ImageHeight || null; }

    MP.analyze(rec);
    return rec;
  };

  MP.disposeRecord = function (r) {
    if (r.thumbUrl) URL.revokeObjectURL(r.thumbUrl);
    if (r.embThumb && r.embThumb.url !== r.thumbUrl) URL.revokeObjectURL(r.embThumb.url);
    if (r.fullUrl) URL.revokeObjectURL(r.fullUrl);
  };

  MP.fullUrl = function (r) {
    if (!r.fullUrl) r.fullUrl = r.decodable ? URL.createObjectURL(r.file) : r.thumbUrl;
    return r.fullUrl;
  };
})();
