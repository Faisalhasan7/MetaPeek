/* MetaPeek — exports: JSON, CSV, GeoJSON, KML and a printable case report. */
(function () {
  'use strict';
  const MP = window.MP;

  function cleanValue(v, depth) {
    depth = depth || 0;
    if (v === null || v === undefined) return v;
    if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return `<binary ${v.byteLength} bytes>`;
    if (Array.isArray(v)) return depth > 4 ? '[…]' : v.slice(0, 200).map((x) => cleanValue(x, depth + 1));
    if (typeof v === 'object') {
      if (depth > 4) return '{…}';
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = cleanValue(x, depth + 1);
      return o;
    }
    if (typeof v === 'number' && !isFinite(v)) return String(v);
    return v;
  }
  MP.cleanValue = cleanValue;

  function summary(p) {
    return {
      file: p.name, path: p.path || undefined, size: p.size, mime: p.type, detectedFormat: p.realType,
      sha256: p.sha256, captured: p.date ? MP.isoLocal(p.date) : null, capturedSource: p.dateSource,
      utcOffsetMinutes: p.offsetMin, gpsUtc: p.gpsUtc ? p.gpsUtc.toISOString() : null,
      camera: p.camera, lens: p.lens || null, software: p.software || null, serial: p.serial || null, owner: p.owner || null,
      width: p.width, height: p.height,
      latitude: p.lat, longitude: p.lon, altitude: p.alt, heading: p.heading,
      place: MP.places && p.hasGps ? MP.places.label(p) : null, address: p.place ? p.place.full : null, myPlace: p.myPlace || null,
      privacyRisk: p.risk ? { score: p.risk.score, level: p.risk.level } : null,
      flags: p.flags.map((f) => ({ code: f.code, severity: f.sev, title: f.title, detail: f.detail }))
    };
  }

  MP.exportJSON = function (photos, meta) {
    const data = {
      tool: 'MetaPeek', version: MP.VERSION, generated: new Date().toISOString(), case: meta || undefined,
      photos: photos.map((p) => Object.assign(summary(p), { metadata: cleanValue(p.segs) }))
    };
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  };

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  MP.exportCSV = function (photos) {
    const cols = ['file', 'path', 'size', 'detectedFormat', 'sha256', 'captured', 'capturedSource', 'utcOffsetMinutes', 'gpsUtc', 'camera', 'lens', 'software', 'serial', 'owner', 'width', 'height', 'latitude', 'longitude', 'altitude', 'heading', 'place', 'address', 'riskScore', 'riskLevel', 'flags'];
    const rows = photos.map((p) => {
      const s = summary(p);
      s.riskScore = s.privacyRisk && s.privacyRisk.score; s.riskLevel = s.privacyRisk && s.privacyRisk.level;
      s.flags = p.flags.map((f) => f.code).join('|');
      return cols.map((c) => csvCell(s[c])).join(',');
    });
    return new Blob(['﻿' + cols.join(',') + '\n' + rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  };

  MP.exportGeoJSON = function (photos) {
    const fc = {
      type: 'FeatureCollection',
      features: photos.filter((p) => p.hasGps).map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p.alt !== null ? [p.lon, p.lat, p.alt] : [p.lon, p.lat] },
        properties: summary(p)
      }))
    };
    return new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' });
  };

  const xml = (s) => String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  MP.exportKML = function (photos) {
    const gps = photos.filter((p) => p.hasGps).sort((a, b) => (a.date || 0) - (b.date || 0));
    const marks = gps.map((p) => `    <Placemark>
      <name>${xml(p.myPlace || (p.place && p.place.short) || p.name)}</name>
      ${p.date ? `<TimeStamp><when>${xml(MP.isoLocal(p.date))}</when></TimeStamp>` : ''}
      <description>${xml(`${p.name}\n${p.place ? p.place.full + '\n' : ''}${p.camera}\n${p.date ? MP.fmtDate(p.date) : 'No date'}\nSHA-256: ${p.sha256 || 'n/a'}`)}</description>
      <Point><coordinates>${p.lon},${p.lat}${p.alt !== null ? ',' + p.alt : ''}</coordinates></Point>
    </Placemark>`).join('\n');
    const route = gps.length > 1 ? `    <Placemark><name>Chronological route</name><LineString><tessellate>1</tessellate><coordinates>${gps.map((p) => `${p.lon},${p.lat}`).join(' ')}</coordinates></LineString></Placemark>` : '';
    const doc = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>MetaPeek export</name>
${marks}
${route}
  </Document>
</kml>
`;
    return new Blob([doc], { type: 'application/vnd.google-earth.kml+xml' });
  };

  /** Self-contained printable HTML report (Print → Save as PDF). All values escaped. */
  MP.exportReport = function (photos, meta, stats) {
    const h = xml;
    const now = new Date();
    const flagged = photos.filter((p) => p.suspicious);
    const sevLabel = { alert: 'ALERT', warn: 'WARN', info: 'INFO' };
    const rows = photos.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${h(p.name)}</strong>${p.path ? `<br><small>${h(p.path)}</small>` : ''}<br><small>${h(MP.fmtBytes(p.size))} · ${h(p.realType.toUpperCase())}${p.width ? ` · ${p.width}×${p.height}` : ''}</small></td>
        <td class="mono">${h(p.sha256 || 'n/a')}</td>
        <td>${h(p.date ? MP.isoLocal(p.date) : '—')}${p.offsetMin !== null ? `<br><small>UTC${p.offsetMin >= 0 ? '+' : ''}${p.offsetMin / 60}</small>` : ''}</td>
        <td>${h(p.camera)}${p.serial ? `<br><small>S/N ${h(p.serial)}</small>` : ''}${p.software ? `<br><small>${h(p.software)}</small>` : ''}</td>
        <td class="mono">${p.hasGps ? `${MP.coord(p.lat, 6)}<br>${MP.coord(p.lon, 6)}` : '—'}</td>
        <td><span class="risk ${p.risk.level}">${p.risk.score}</span></td>
        <td>${p.flags.length ? p.flags.map((f) => `<div class="f ${f.sev}"><b>${sevLabel[f.sev]}</b> ${h(f.title)}${f.detail ? `<br><small>${h(f.detail)}</small>` : ''}</div>`).join('') : '<small>None</small>'}</td>
      </tr>`).join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MetaPeek case report${meta && meta.caseId ? ' — ' + h(meta.caseId) : ''}</title>
<style>
  body{font:13px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:32px;}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:28px 0 8px;border-bottom:2px solid #111;padding-bottom:4px}
  .meta{display:grid;grid-template-columns:160px 1fr;gap:4px 16px;margin:16px 0}
  .meta div:nth-child(odd){color:#555}
  .stats{display:flex;gap:12px;flex-wrap:wrap}.stat{border:1px solid #ddd;border-radius:8px;padding:8px 14px}.stat b{font-size:18px;display:block}
  table{width:100%;border-collapse:collapse;font-size:11.5px} th,td{border:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}
  th{background:#f3f3f3} .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;word-break:break-all}
  small{color:#555} .f{margin-bottom:4px}.f.alert b{color:#b91c1c}.f.warn b{color:#b45309}.f.info b{color:#1d4ed8}
  .risk{display:inline-block;min-width:28px;text-align:center;border-radius:6px;padding:2px 6px;font-weight:700}
  .risk.high{background:#fee2e2;color:#991b1b}.risk.medium{background:#fef3c7;color:#92400e}.risk.low{background:#dcfce7;color:#166534}
  .note{white-space:pre-wrap;border-left:3px solid #111;padding-left:10px}
  .disclaimer{margin-top:28px;color:#555;font-size:11px}
  .noprint{margin-bottom:16px} @media print{.noprint{display:none} body{margin:12mm} tr{page-break-inside:avoid}}
</style></head><body>
<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>
<h1>Image metadata analysis report</h1>
<div>Generated by MetaPeek v${h(MP.VERSION)} — fully client-side; no image left the analyst's device.</div>
<div class="meta">
  <div>Case / reference</div><div>${h((meta && meta.caseId) || '—')}</div>
  <div>Analyst</div><div>${h((meta && meta.analyst) || '—')}</div>
  <div>Generated</div><div>${h(now.toISOString())} (${h(Intl.DateTimeFormat().resolvedOptions().timeZone)})</div>
  <div>Files analysed</div><div>${photos.length}</div>
</div>
${meta && meta.notes ? `<h2>Analyst notes</h2><div class="note">${h(meta.notes)}</div>` : ''}
<h2>Summary</h2>
<div class="stats">
  <div class="stat"><b>${stats.gpsCount}</b>with GPS</div>
  <div class="stat"><b>${stats.cameraCount}</b>devices</div>
  <div class="stat"><b>${h(stats.dateRange)}</b>date range</div>
  <div class="stat"><b>${flagged.length}</b>files with warnings/alerts</div>
  <div class="stat"><b>${stats.dupGroups}</b>duplicate groups</div>
  <div class="stat"><b>${stats.highRisk}</b>high privacy exposure</div>
</div>
<h2>Evidence table</h2>
<table><thead><tr><th>#</th><th>File</th><th>SHA-256</th><th>Captured (camera clock)</th><th>Device</th><th>GPS</th><th>Risk</th><th>Findings</th></tr></thead><tbody>${rows}</tbody></table>
<p class="disclaimer">Metadata can be edited, stripped or fabricated. Findings are heuristic indicators to guide investigation, not proof of authenticity or manipulation. Hashes identify the exact files analysed; preserve originals separately.</p>
</body></html>`;
    return new Blob([html], { type: 'text/html' });
  };
})();
