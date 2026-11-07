/* MetaPeek — location intelligence.
 * Place names (opt-in, cached), frequent places, your own named places, travel legs & impossible travel,
 * sun position (offline) and camera field-of-view cones. */
(function () {
  'use strict';
  const MP = window.MP;
  const PL = (MP.places = {});

  /* ------------------------------------------------------------ storage */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  };
  const K_GEO = 'metapeek-geo-cache-v1', K_MINE = 'metapeek-my-places-v1', K_AUTO = 'metapeek-auto-geocode';
  let geoCache = store.get(K_GEO, {});
  PL.autoLookup = () => store.get(K_AUTO, false);
  PL.setAutoLookup = (v) => store.set(K_AUTO, !!v);
  PL.cacheSize = () => Object.keys(geoCache).length;
  PL.clearCache = () => { geoCache = {}; store.set(K_GEO, geoCache); };

  /* ------------------------------------------------------------- utc time */
  /** Best UTC estimate of when the photo was taken, plus how sure we are. */
  PL.photoUtc = function (p) {
    if (!p.date) return null;
    const wall = Date.UTC(p.date.getFullYear(), p.date.getMonth(), p.date.getDate(), p.date.getHours(), p.date.getMinutes(), p.date.getSeconds());
    if (p.offsetMin !== null && p.offsetMin !== undefined) return { t: new Date(wall - p.offsetMin * 60000), how: 'exact' };
    if (p.gpsUtc) return { t: p.gpsUtc, how: 'gps' };
    if (p.hasGps) return { t: new Date(wall - Math.round(p.lon / 15) * 3600000), how: 'approx' };
    return { t: new Date(wall), how: 'unknown' };
  };

  /* ------------------------------------------------------- place names */
  const cellKey = (lat, lon) => `${lat.toFixed(3)},${lon.toFixed(3)}`; // ~110 m cells

  function labelFrom(a) {
    const area = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.borough || a.hamlet || '';
    const city = a.city || a.town || a.village || a.municipality || a.county || a.state_district || '';
    const short = [...new Set([area, city].filter(Boolean))].join(', ') || a.state || a.country || '';
    return { short, area, city, state: a.state || '', country: a.country || '', cc: (a.country_code || '').toUpperCase() };
  }

  PL.applyCached = function (photos) {
    let n = 0;
    for (const p of photos) {
      if (!p.hasGps) { p.place = null; continue; }
      const hit = geoCache[cellKey(p.lat, p.lon)];
      p.place = hit || null;
      if (hit) n++;
    }
    applyMyPlaces(photos);
    return n;
  };

  PL.missingCells = function (photos) {
    const cells = new Map();
    for (const p of photos) if (p.hasGps && !geoCache[cellKey(p.lat, p.lon)]) cells.set(cellKey(p.lat, p.lon), { lat: p.lat, lon: p.lon });
    return [...cells.values()];
  };

  let running = null;
  /** Reverse-geocode unknown cells through Nominatim at its 1 request/second limit. */
  PL.lookup = async function (photos, onProgress) {
    if (running) return running;
    const todo = PL.missingCells(photos);
    const ctl = { cancelled: false };
    PL.cancelLookup = () => { ctl.cancelled = true; };
    running = (async () => {
      let done = 0, failed = 0;
      for (const c of todo) {
        if (ctl.cancelled) break;
        const t0 = Date.now();
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${c.lat}&lon=${c.lon}`,
            { referrerPolicy: 'strict-origin-when-cross-origin', headers: { 'Accept-Language': navigator.language || 'en' } });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const j = await r.json();
          if (j && j.address) {
            geoCache[cellKey(c.lat, c.lon)] = Object.assign(labelFrom(j.address), { full: j.display_name || '' });
            store.set(K_GEO, geoCache);
          } else failed++;
        } catch { failed++; }
        done++;
        PL.applyCached(photos);
        onProgress && onProgress(done, todo.length);
        const wait = 1100 - (Date.now() - t0);
        if (wait > 0 && done < todo.length) await new Promise((r) => setTimeout(r, wait));
      }
      return { done, failed, total: todo.length, cancelled: ctl.cancelled };
    })();
    try { return await running; } finally { running = null; }
  };
  PL.isRunning = () => !!running;

  /* ------------------------------------------------------- my places */
  PL.myPlaces = () => store.get(K_MINE, []);
  PL.saveMyPlace = function (name, lat, lon) {
    const list = PL.myPlaces().filter((m) => MP.haversineKm(m, { lat, lon }) > 0.05);
    if (name) list.push({ name: String(name).slice(0, 60), lat, lon });
    store.set(K_MINE, list);
  };
  PL.removeMyPlace = function (lat, lon) {
    store.set(K_MINE, PL.myPlaces().filter((m) => MP.haversineKm(m, { lat, lon }) > 0.05));
  };
  function applyMyPlaces(photos) {
    const mine = PL.myPlaces();
    for (const p of photos) {
      p.myPlace = null;
      if (!p.hasGps || !mine.length) continue;
      let best = null, bd = Infinity;
      for (const m of mine) { const d = MP.haversineKm(m, p); if (d < bd) { bd = d; best = m; } }
      if (best && bd <= 0.2) p.myPlace = best.name;
    }
  }
  PL.refreshMyPlaces = applyMyPlaces;

  /** Human label for a photo's location. */
  PL.label = (p) => p.myPlace || (p.place && p.place.short) || (p.hasGps ? `${MP.coord(p.lat, 4)}, ${MP.coord(p.lon, 4)}` : '');

  /* ---------------------------------------------------- frequent places */
  const RADIUS_KM = 0.15;
  PL.clusters = function (photos) {
    const gps = photos.filter((p) => p.hasGps);
    const cl = [];
    for (const p of gps) {
      let best = null, bd = Infinity;
      for (const c of cl) { const d = MP.haversineKm(c, p); if (d < bd) { bd = d; best = c; } }
      if (best && bd <= RADIUS_KM) {
        best.items.push(p);
        best.lat += (p.lat - best.lat) / best.items.length;
        best.lon += (p.lon - best.lon) / best.items.length;
      } else cl.push({ lat: p.lat, lon: p.lon, items: [p] });
    }
    const mine = PL.myPlaces();
    for (const c of cl) {
      const dated = c.items.filter((p) => p.date).sort((a, b) => a.date - b.date);
      const byDay = new Map();
      dated.forEach((p) => { const k = MP.dayKey(p.date); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(p); });
      c.days = byDay.size;
      c.dwellMin = [...byDay.values()].reduce((s, d) => s + (d[d.length - 1].date - d[0].date) / 60000, 0);
      c.first = dated[0] ? dated[0].date : null;
      c.last = dated.length ? dated[dated.length - 1].date : null;
      const counts = new Map();
      c.items.forEach((p) => { if (p.place && p.place.short) counts.set(p.place.short, (counts.get(p.place.short) || 0) + 1); });
      c.placeName = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || '';
      const named = mine.find((m) => MP.haversineKm(m, c) <= 0.2);
      c.myName = named ? named.name : '';
      c.myRef = named || null;
      c.name = c.myName || c.placeName || `${MP.coord(c.lat, 4)}, ${MP.coord(c.lon, 4)}`;
      c.full = (c.items.find((p) => p.place && p.place.full) || {}).place;
    }
    return cl.sort((a, b) => b.days - a.days || b.items.length - a.items.length);
  };

  /** Countries → cities → areas rollup (needs place names). */
  PL.rollup = function (photos) {
    const tree = new Map();
    for (const p of photos) {
      if (!p.place) continue;
      const co = p.place.country || 'Unknown', ci = p.place.city || p.place.state || 'Unknown', ar = p.place.area || '—';
      if (!tree.has(co)) tree.set(co, { n: 0, cc: p.place.cc, cities: new Map() });
      const C = tree.get(co); C.n++;
      if (!C.cities.has(ci)) C.cities.set(ci, { n: 0, areas: new Map() });
      const I = C.cities.get(ci); I.n++;
      I.areas.set(ar, (I.areas.get(ar) || 0) + 1);
    }
    return tree;
  };

  /* ------------------------------------------------------------- travel */
  const MODES = [
    [0, 'Stayed'], [7, 'Walking'], [140, 'Road'], [320, 'Fast train / highway'], [950, 'Flight'], [Infinity, 'Impossible']
  ];
  PL.legs = function (photos) {
    const pts = photos.filter((p) => p.hasGps && p.date).map((p) => ({ p, u: PL.photoUtc(p) })).filter((x) => x.u).sort((a, b) => a.u.t - b.u.t);
    const legs = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const km = MP.haversineKm(a.p, b.p);
      if (km < 0.2) continue;
      const h = (b.u.t - a.u.t) / 3.6e6;
      const speed = h > 0 ? km / h : Infinity;
      const approx = a.u.how === 'approx' || b.u.how === 'approx' || a.u.how === 'unknown' || b.u.how === 'unknown';
      // With guessed timezones, allow a few hours of slack before calling it impossible.
      const slackH = approx ? 3 : 0;
      const effSpeed = h + slackH > 0 ? km / (h + slackH) : Infinity;
      const impossible = km > 1 && effSpeed > 950;
      let mode;
      if (impossible) mode = 'Impossible';
      else if (km >= 600) mode = 'Flight (likely)';
      else if (h > 12 || (speed < 2 && h > 1)) mode = 'Later visit';
      else mode = MODES.find((m) => speed <= m[0])[1];
      if (mode === 'Impossible' && !impossible) mode = 'Flight';
      legs.push({ from: a.p, to: b.p, km, hours: h, speed, mode: impossible ? 'Impossible' : mode, impossible, approx });
    }
    return legs;
  };

  /* -------------------------------------------------------- sun position */
  // Adapted from SunCalc (c) Vladimir Agafonkin, BSD-2-Clause.
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
  const toDays = (d) => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  PL.sun = function (date, lat, lon) {
    const lw = rad * -lon, phi = rad * lat, d = toDays(date);
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const de = dec(L, 0), r = ra(L, 0);
    const H = rad * (280.16 + 360.9856235 * d) - lw - r;
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(de) * Math.cos(phi));
    const alt = Math.asin(Math.sin(phi) * Math.sin(de) + Math.cos(phi) * Math.cos(de) * Math.cos(H));
    const azimuth = (az / rad + 180 + 360) % 360, elevation = alt / rad;
    const phase = elevation < -18 ? 'Night' : elevation < -6 ? 'Twilight (dark)' : elevation < 0 ? 'Civil twilight' : elevation < 6 ? 'Golden hour' : 'Daylight';
    return { azimuth, elevation, phase };
  };

  PL.compass = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

  PL.lighting = function (heading, sunAz) {
    const d = Math.abs(((heading - sunAz + 540) % 360) - 180);
    return d <= 45 ? 'Camera faced into the sun (backlit)' : d >= 135 ? 'Sun behind the camera (front-lit)' : 'Sun to the side (side-lit)';
  };

  /* ------------------------------------------------------- camera view */
  /** Horizontal field of view in degrees, from the 35 mm-equivalent focal length when available. */
  PL.fov = function (p) {
    const t = p.tags || {};
    const f35 = t.FocalLengthIn35mmFormat;
    const portrait = (p.orientation >= 5 && p.orientation <= 8) ? (p.width && p.height ? p.width > p.height : true) : (p.width && p.height && p.height > p.width);
    if (!f35) return { deg: 65, est: true };
    const side = portrait ? 24 : 36;
    return { deg: (2 * Math.atan(side / (2 * f35))) / rad, est: false, f35 };
  };

  function offset(lat, lon, bearingDeg, km) {
    const R = 6371, br = bearingDeg * rad, la = lat * rad, lo = lon * rad, dr = km / R;
    const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(br));
    const lo2 = lo + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
    return [la2 / rad, ((lo2 / rad + 540) % 360) - 180];
  }
  PL.offset = offset;
  PL.cone = function (p, km) {
    const f = PL.fov(p);
    const pts = [[p.lat, p.lon]];
    const steps = 12;
    for (let i = 0; i <= steps; i++) pts.push(offset(p.lat, p.lon, p.heading - f.deg / 2 + (f.deg * i) / steps, km || 0.12));
    pts.push([p.lat, p.lon]);
    return { pts, fov: f };
  };

  /* ------------------------------------------------------- directions */
  PL.directions = (p) => ({
    google: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`,
    osm: `https://www.openstreetmap.org/directions?to=${p.lat}%2C${p.lon}`,
    apple: `https://maps.apple.com/?daddr=${p.lat},${p.lon}`
  });
  PL.routeBetween = (a, b) => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}`;
})();
