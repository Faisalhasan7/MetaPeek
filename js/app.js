/* MetaPeek v2 — application controller and views. All user/metadata strings go through textContent. */
(function () {
  'use strict';
  const MP = window.MP;
  const { el, icon, clear, $, $$ } = MP;
  MP.VERSION = '2.2.0';

  const state = {
    photos: [],
    collection: { dupGroups: [], devices: new Map() },
    f: { q: '', quick: 'all', cam: '', from: '', to: '', sort: 'date' },
    tab: 'photos', mapMode: 'markers', tlGroup: 'day', cones: true,
    modal: { list: [], idx: -1, tab: 'overview', map: null }
  };
  const TRIP_COLORS = ['#5b5bf0', '#e11d48', '#059669', '#d97706', '#0891b2', '#9333ea', '#65a30d', '#db2777'];

  /* ------------------------------------------------------------------ boot */
  function hydrateIcons(root) {
    $$('[data-icon]', root).forEach((n) => {
      const svg = icon(n.dataset.icon, n.dataset.cls);
      n.replaceWith(svg);
    });
  }

  function init() {
    hydrateIcons(document);
    syncThemeIcon();

    const fi = $('#fileInput'), di = $('#folderInput');
    $('#pickFiles').addEventListener('click', () => fi.click());
    $('#pickFolder').addEventListener('click', () => di.click());
    $('#addMore').addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { ingest(Array.from(fi.files)); fi.value = ''; });
    di.addEventListener('change', () => { ingest(Array.from(di.files)); di.value = ''; });

    const dz = $('#dropZone');
    ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) dz.classList.remove('dragover'); }));
    document.addEventListener('drop', async (e) => {
      dz.classList.remove('dragover');
      const files = await filesFromDrop(e.dataTransfer);
      if (files.length) ingest(files);
    });
    document.addEventListener('paste', (e) => {
      const files = Array.from(e.clipboardData ? e.clipboardData.files : []).map((f, i) => f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png')}`, { type: f.type }));
      if (files.length) ingest(files);
    });

    $('#homeBtn').addEventListener('click', () => { if (!state.photos.length) showLanding(); else window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#clearBtn').addEventListener('click', resetAll);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#stripAllBtn').addEventListener('click', () => stripSet(filtered(), 'shown'));

    // Export menu
    const menu = $('#exportMenu'), eb = $('#exportBtn');
    eb.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); eb.setAttribute('aria-expanded', String(!menu.classList.contains('hidden'))); });
    document.addEventListener('click', () => { menu.classList.add('hidden'); eb.setAttribute('aria-expanded', 'false'); });
    $$('[data-export]', menu).forEach((b) => b.addEventListener('click', () => doExport(b.dataset.export)));

    // Tabs
    $$('#tabs .tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    // Filters
    $('#q').addEventListener('input', debounce((e) => { state.f.q = e.target.value.trim().toLowerCase(); refreshViews(); }, 150));
    $$('#filters .chip').forEach((c) => c.addEventListener('click', () => setQuick(c.dataset.f)));
    $('#camFilter').addEventListener('change', (e) => { state.f.cam = e.target.value; refreshViews(); });
    $('#dFrom').addEventListener('change', (e) => { state.f.from = e.target.value; refreshViews(); });
    $('#dTo').addEventListener('change', (e) => { state.f.to = e.target.value; refreshViews(); });
    $('#sortSel').addEventListener('change', (e) => { state.f.sort = e.target.value; renderGrid(); });

    // Map
    $$('[data-map]').forEach((c) => c.addEventListener('click', () => {
      state.mapMode = c.dataset.map;
      $$('[data-map]').forEach((x) => x.classList.toggle('active', x === c));
      renderMap();
    }));
    $('#fitBtn').addEventListener('click', fitMap);
    $('#conesBtn').addEventListener('click', () => { state.cones = !state.cones; $('#conesBtn').classList.toggle('active', state.cones); renderMap(); });

    // Geotag
    $('#geoShownBtn').addEventListener('click', () => {
      const list = sorted(filtered());
      const noGps = list.filter((p) => !p.hasGps);
      const target = noGps.length && noGps.length < list.length && confirm(`Tag only the ${noGps.length} shown photo(s) without GPS?\n\nOK = only those without GPS · Cancel = all ${list.length} shown`) ? noGps : list;
      openGeoDialog(target);
    });
    $('#geoSearchBtn').addEventListener('click', geoSearch);
    $('#geoSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); geoSearch(); } });
    $('#geoCoords').addEventListener('change', () => { const loc = MP.parseCoords($('#geoCoords').value); if (loc) placeGeo(loc, true); else $('#geoApply').disabled = true; });
    $('#geoCoords').addEventListener('input', () => { $('#geoApply').disabled = !MP.parseCoords($('#geoCoords').value); });
    $('#geoCancel').addEventListener('click', () => $('#geoDlg').close());
    $('#geoApply').addEventListener('click', applyGeo);

    // Modal
    $('#mClose').addEventListener('click', closeModal);
    $('#mPrev').addEventListener('click', () => stepModal(-1));
    $('#mNext').addEventListener('click', () => stepModal(1));
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    $$('#mTabs .tab').forEach((t) => t.addEventListener('click', () => { state.modal.tab = t.dataset.mtab; renderModalTab(); }));
    $('#mStrip').addEventListener('click', () => { const p = currentModalPhoto(); if (p) stripOne(p); });
    document.addEventListener('keydown', (e) => {
      if ($('#modal').classList.contains('hidden') || $('#geoDlg').open) return;
      if (e.key === 'Escape') closeModal();
      else if (e.key === 'ArrowLeft' && !isTyping(e)) stepModal(-1);
      else if (e.key === 'ArrowRight' && !isTyping(e)) stepModal(1);
    });

    // PWA (only on http/https)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  const isTyping = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  async function filesFromDrop(dt) {
    const items = dt.items ? Array.from(dt.items) : [];
    const entries = items.map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return Array.from(dt.files || []);
    const out = [];
    async function walk(entry, path) {
      if (entry.isFile) {
        const f = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
        if (f) { try { f._relPath = path + f.name; } catch (e) { /* frozen */ } out.push(f); }
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res) => reader.readEntries(res, () => res([])));
          for (const c of batch) await walk(c, path + entry.name + '/');
        } while (batch.length);
      }
    }
    for (const e of entries) await walk(e, '');
    return out;
  }

  /* ---------------------------------------------------------------- ingest */
  async function ingest(files) {
    const imgs = files.filter(MP.isImageFile);
    const skipped = files.length - imgs.length;
    if (!imgs.length) { MP.toast(skipped ? 'No supported image files found' : 'Nothing to add', 'err'); return; }
    const known = new Set(state.photos.map((p) => `${p.name}|${p.size}|${p.file.lastModified}`));
    const fresh = imgs.filter((f) => !known.has(`${f.name}|${f.size}|${f.lastModified}`));
    if (!fresh.length) { MP.toast('Those files are already loaded'); return; }

    showApp();
    const wasEmpty = state.photos.length === 0;
    progress(0, fresh.length, 'Reading metadata');
    const recs = await MP.pool(fresh, 4, MP.parseFile, (d, n) => progress(d, n, 'Reading metadata'));
    progress(null);
    const ok = recs.filter(Boolean);
    state.photos.push(...ok);
    recompute();
    const failed = fresh.length - ok.length;
    MP.toast(`Added ${ok.length} photo${ok.length !== 1 ? 's' : ''}${failed ? ` · ${failed} unreadable` : ''}${skipped ? ` · ${skipped} non-image skipped` : ''}`, failed ? 'err' : 'ok');
    renderAll();
    if (MP.places.autoLookup() && MP.places.missingCells(state.photos).length) runLookup(true);
    if (wasEmpty && state.photos.length === 1) openModal(state.photos[0].id, [state.photos[0].id]);
  }

  function recompute() {
    MP.places.applyCached(state.photos);
    state.collection = MP.analyzeCollection(state.photos);
  }

  function progress(done, total, label) {
    const box = $('#progress'), lab = $('#progressLabel');
    if (done === null) { box.classList.add('hidden'); lab.classList.add('hidden'); return; }
    box.classList.remove('hidden'); lab.classList.remove('hidden');
    $('.bar', box).style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
    lab.textContent = `${label} ${done}/${total}`;
  }

  function showApp() { $('#landing').classList.add('hidden'); $('#app').classList.remove('hidden'); }
  function showLanding() { $('#app').classList.add('hidden'); $('#landing').classList.remove('hidden'); }

  function resetAll() {
    if (state.photos.length && !confirm(`Remove all ${state.photos.length} photos from this session?`)) return;
    closeModal();
    state.photos.forEach(MP.disposeRecord);
    state.photos = [];
    state.collection = { dupGroups: [], devices: new Map() };
    Object.assign(state.f, { q: '', quick: 'all', cam: '', from: '', to: '' });
    $('#q').value = ''; $('#dFrom').value = ''; $('#dTo').value = '';
    if (mapState.map) { mapState.layer.clearLayers(); }
    showLanding();
  }

  /* --------------------------------------------------------------- filters */
  function setQuick(q) {
    state.f.quick = q;
    $$('#filters .chip').forEach((c) => c.classList.toggle('active', c.dataset.f === q));
    refreshViews();
  }

  function filtered() {
    const f = state.f;
    const from = f.from ? new Date(f.from + 'T00:00:00') : null;
    const to = f.to ? new Date(f.to + 'T23:59:59') : null;
    return state.photos.filter((p) => {
      if (f.quick === 'gps' && !p.hasGps) return false;
      if (f.quick === 'nogps' && p.hasGps) return false;
      if (f.quick === 'flagged' && !p.suspicious) return false;
      if (f.quick === 'high' && p.risk.level !== 'high') return false;
      if (f.cam && p.camera !== f.cam) return false;
      if ((from || to) && (!p.date || (from && p.date < from) || (to && p.date > to))) return false;
      if (f.q) {
        const hay = `${p.name} ${p.path} ${p.camera} ${p.lens} ${p.software} ${p.serial} ${p.owner} ${p.sha256 || ''} ${p.myPlace || ''} ${p.place ? p.place.full : ''} ${p.flags.map((x) => x.title).join(' ')}`.toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    });
  }

  function sorted(list) {
    const s = state.f.sort, out = [...list];
    const byDate = (a, b) => (a.date ? a.date.getTime() : Infinity) - (b.date ? b.date.getTime() : Infinity);
    if (s === 'date') out.sort((a, b) => byDate(a, b) || a.name.localeCompare(b.name));
    else if (s === 'camera') out.sort((a, b) => a.camera.localeCompare(b.camera) || byDate(a, b));
    else if (s === 'risk') out.sort((a, b) => b.risk.score - a.risk.score);
    else if (s === 'flags') out.sort((a, b) => b.topSev - a.topSev || b.flags.length - a.flags.length);
    else if (s === 'size') out.sort((a, b) => b.size - a.size);
    else out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return out;
  }

  /* ---------------------------------------------------------------- render */
  function renderAll() {
    $('#countPill').textContent = `${state.photos.length} photo${state.photos.length !== 1 ? 's' : ''}`;
    renderCamFilter();
    refreshViews();
  }
  function refreshViews() {
    renderStats();
    renderGrid();
    renderActiveTab();
  }
  function renderActiveTab() {
    const t = state.tab;
    if (t === 'forensics') renderForensics();
    else if (t === 'privacy') renderPrivacy();
    else if (t === 'map') renderMap();
    else if (t === 'timeline') renderTimeline();
    else if (t === 'devices') renderDevices();
    else if (t === 'places') renderPlaces();
    const flaggedN = state.photos.filter((p) => p.suspicious).length;
    $('#forensicsBadge').textContent = flaggedN;
  }

  function switchTab(tab) {
    state.tab = tab;
    $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $$('.tabpanel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + tab));
    renderActiveTab();
  }

  function renderCamFilter() {
    const sel = $('#camFilter');
    const cams = [...new Set(state.photos.map((p) => p.camera))].sort();
    clear(sel).appendChild(el('option', { value: '' }, 'All devices'));
    cams.forEach((c) => sel.appendChild(el('option', { value: c }, c)));
    if (!cams.includes(state.f.cam)) state.f.cam = '';
    sel.value = state.f.cam;
  }

  function dateRangeText(list) {
    const ds = list.filter((p) => p.date).map((p) => p.date.getTime()).sort((a, b) => a - b);
    if (!ds.length) return '—';
    const f = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return ds.length === 1 || MP.dayKey(new Date(ds[0])) === MP.dayKey(new Date(ds[ds.length - 1])) ? f(ds[0]) : `${f(ds[0])} – ${f(ds[ds.length - 1])}`;
  }

  function collectionStats(list) {
    return {
      gpsCount: list.filter((p) => p.hasGps).length,
      cameraCount: new Set(list.map((p) => p.camera)).size,
      dateRange: dateRangeText(list),
      flagged: list.filter((p) => p.suspicious).length,
      highRisk: list.filter((p) => p.risk.level === 'high').length,
      dupGroups: state.collection.dupGroups.length
    };
  }

  function renderStats() {
    const all = state.photos, s = collectionStats(all);
    const gpsPct = all.length ? Math.round((s.gpsCount / all.length) * 100) : 0;
    const trips = detectTrips(all.filter((p) => p.hasGps)).length;
    const card = (n, l, cls, onClick, small) => el('div', { class: `stat ${cls || ''} ${onClick ? 'clickable' : ''}`, onclick: onClick, role: onClick ? 'button' : null, tabindex: onClick ? 0 : null },
      el('div', { class: 'n' + (small ? ' sm' : '') }, n), el('div', { class: 'l' }, l));
    clear($('#stats')).append(
      card(all.length, 'Photos', 'accent'),
      card(`${gpsPct}%`, `GPS coverage (${s.gpsCount})`, s.gpsCount ? 'ok' : '', s.gpsCount ? () => { switchTab('map'); } : null),
      card(s.cameraCount, 'Devices', '', () => switchTab('devices')),
      card(s.dateRange, 'Date range', '', () => switchTab('timeline'), true),
      card(MP.places.clusters(all).length, 'Places', 'accent', s.gpsCount ? () => switchTab('places') : null),
      card(trips, 'Trips detected', '', trips ? () => switchTab('map') : null),
      card(s.flagged, 'Files with findings', s.flagged ? 'warn' : 'ok', () => switchTab('forensics')),
      card(s.highRisk, 'High privacy exposure', s.highRisk ? 'bad' : 'ok', () => switchTab('privacy'))
    );
  }

  function thumbEl(p, cls) {
    if (p.thumbUrl) return el('img', { src: p.thumbUrl, alt: '', loading: 'lazy', decoding: 'async', class: cls || '' });
    return el('div', { class: 'ph' }, p.realType.toUpperCase());
  }

  function renderGrid() {
    const list = sorted(filtered());
    const grid = clear($('#grid'));
    $('#gridEmpty').classList.toggle('hidden', list.length > 0);
    $('#resultCount').textContent = list.length === state.photos.length ? `${list.length} shown` : `${list.length} of ${state.photos.length} shown`;
    const ids = list.map((p) => p.id);
    const frag = document.createDocumentFragment();
    for (const p of list) frag.appendChild(photoCard(p, ids));
    grid.appendChild(frag);
  }

  function photoCard(p, ids) {
    const top = el('div', { class: 'badges' },
      el('span', { class: 'dot ' + (p.hasGps ? 'gps' : 'nogps') }, icon('pin'), p.hasGps ? 'GPS' : 'No GPS'),
      p.topSev >= 2 ? el('span', { class: `dot sev-${p.topSev}`, title: p.flags.filter((f) => f.sev !== 'info').map((f) => f.title).join('\n') }, icon('alert'), String(p.flags.filter((f) => f.sev !== 'info').length)) : null
    );
    return el('button', { class: 'card', type: 'button', title: p.name, onclick: () => openModal(p.id, ids) },
      el('div', { class: 'thumb' }, thumbEl(p), top),
      el('div', { class: 'body' },
        el('div', { class: 'name' }, p.name),
        el('div', { class: 'sub' }, [p.date ? MP.fmtDay(p.date) : 'No date', p.myPlace || (p.place && p.place.short) || (p.camera !== 'Unknown camera' ? p.camera : null)].filter(Boolean).join(' · ')),
        el('div', { style: { marginTop: '6px' } }, el('span', { class: `pill risk-${p.risk.level}`, title: 'Privacy exposure score' }, `Risk ${p.risk.score}`))
      )
    );
  }

  function mini(p, sub, ids) {
    return el('button', { class: 'mini', type: 'button', title: p.name, onclick: () => openModal(p.id, ids) },
      p.thumbUrl ? el('img', { src: p.thumbUrl, alt: '', loading: 'lazy' }) : el('div', { class: 'ph' }),
      el('span', null, p.name, sub ? el('small', null, sub) : null));
  }

  /* ------------------------------------------------------------- forensics */
  function renderForensics() {
    const host = clear($('#tab-forensics'));
    const list = filtered();
    const groups = new Map();
    for (const p of list) for (const f of p.flags) {
      if (!groups.has(f.code)) groups.set(f.code, { sev: f.sev, title: f.title, why: f.why, items: [] });
      groups.get(f.code).items.push({ p, detail: f.detail });
    }
    const arr = [...groups.entries()].sort((a, b) => MP.SEV_RANK[b[1].sev] - MP.SEV_RANK[a[1].sev] || b[1].items.length - a[1].items.length);

    const head = el('div', { class: 'panel' },
      el('h3', null, 'Forensic findings'),
      el('p', { class: 'desc' }, `Heuristic checks across ${list.length} photo${list.length !== 1 ? 's' : ''} in the current filter. Metadata can be forged or stripped, so treat these as leads to verify, not verdicts.`)
    );
    if (!arr.length) head.appendChild(el('div', { class: 'empty' }, 'No findings for the current selection.'));
    for (const [code, g] of arr) {
      const ids = g.items.map((i) => i.p.id);
      head.appendChild(el('details', { class: 'finding', open: g.sev !== 'info' && g.items.length <= 24 ? true : null, dataset: { code } },
        el('summary', null, el('span', { class: `sev-bar ${g.sev}` }), el('span', { class: `pill ${g.sev}` }, g.sev.toUpperCase()), el('span', { class: 't' }, g.title), el('span', { class: 'pill brand' }, String(g.items.length))),
        el('div', { class: 'why' }, g.why),
        el('div', { class: 'items' }, g.items.slice(0, 200).map((i) => mini(i.p, i.detail, ids)))
      ));
    }
    host.appendChild(head);

    // Integrity: hashes & duplicates
    const dup = state.collection.dupGroups;
    const integ = el('div', { class: 'panel' }, el('h3', null, 'File integrity'),
      el('p', { class: 'desc' }, 'SHA-256 fingerprints identify the exact bytes analysed. Identical hashes mean byte-for-byte copies, even when renamed.'));
    if (dup.length) {
      dup.forEach((g, i) => {
        const ids = g.map((p) => p.id);
        integ.appendChild(el('div', { class: 'finding' }, el('div', { style: { padding: '10px 14px' } },
          el('b', null, `Duplicate group ${i + 1}`), ' ', el('span', { class: 'mono muted' }, g[0].sha256.slice(0, 16) + '…')),
          el('div', { class: 'items' }, g.map((p) => mini(p, MP.fmtBytes(p.size), ids)))));
      });
    } else integ.appendChild(el('div', { class: 'muted' }, 'No duplicate files.'));
    host.appendChild(integ);
  }

  /* --------------------------------------------------------------- privacy */
  function renderPrivacy() {
    const host = clear($('#tab-privacy'));
    const list = filtered();
    const levels = { high: [], medium: [], low: [] };
    list.forEach((p) => levels[p.risk.level].push(p));
    const leaks = new Map();
    list.forEach((p) => p.risk.items.forEach((i) => leaks.set(i.label, (leaks.get(i.label) || 0) + 1)));

    const top = el('div', { class: 'panel' },
      el('h3', null, 'Privacy exposure'),
      el('p', { class: 'desc' }, 'What anyone receiving these exact files could learn. Cleaning removes all of it while keeping the picture.'),
      el('div', { class: 'stats', style: { marginBottom: '14px' } },
        el('div', { class: 'stat bad' }, el('div', { class: 'n' }, levels.high.length), el('div', { class: 'l' }, 'High (50+)')),
        el('div', { class: 'stat warn' }, el('div', { class: 'n' }, levels.medium.length), el('div', { class: 'l' }, 'Medium (20–49)')),
        el('div', { class: 'stat ok' }, el('div', { class: 'n' }, levels.low.length), el('div', { class: 'l' }, 'Low (<20)'))
      ),
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        el('button', { class: 'btn primary', type: 'button', disabled: !(levels.high.length + levels.medium.length) || null, onclick: () => stripSet([...levels.high, ...levels.medium], 'exposed') }, icon('eraser'), `Clean ${levels.high.length + levels.medium.length} exposed photos`),
        el('button', { class: 'btn', type: 'button', disabled: !list.length || null, onclick: () => stripSet(list, 'shown') }, icon('eraser'), `Clean all ${list.length}`))
    );
    host.appendChild(top);

    const cols = el('div', { class: 'cols', style: { marginTop: '16px' } });
    const leakPanel = el('div', { class: 'panel' }, el('h3', null, 'What is leaking'), el('p', { class: 'desc' }, 'Number of photos exposing each kind of data.'));
    if (!leaks.size) leakPanel.appendChild(el('div', { class: 'muted' }, 'Nothing identifying found.'));
    [...leaks.entries()].sort((a, b) => b[1] - a[1]).forEach(([label, n]) => {
      const pct = Math.round((n / list.length) * 100);
      leakPanel.appendChild(el('div', { style: { margin: '8px 0' } },
        el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' } }, el('span', null, label), el('b', null, `${n} · ${pct}%`)),
        el('div', { style: { height: '6px', background: 'var(--surface-2)', borderRadius: '6px', marginTop: '4px', overflow: 'hidden' } },
          el('div', { style: { width: pct + '%', height: '100%', background: 'linear-gradient(90deg,var(--brand),var(--brand-2))' } }))));
    });
    const worst = sorted(list).sort((a, b) => b.risk.score - a.risk.score).slice(0, 24);
    const ids = worst.map((p) => p.id);
    const worstPanel = el('div', { class: 'panel' }, el('h3', null, 'Most exposed'), el('p', { class: 'desc' }, 'Highest scores first.'),
      el('div', { class: 'items', style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } }, worst.map((p) => mini(p, `Risk ${p.risk.score} · ${p.risk.items.slice(0, 2).map((i) => i.label).join(', ')}`, ids))));
    cols.append(leakPanel, worstPanel);
    host.appendChild(cols);
  }

  /* ------------------------------------------------------------------- map */
  const mapState = { map: null, layer: null };
  function ensureMap() {
    if (mapState.map) return mapState.map;
    const m = L.map('map', { worldCopyJump: true }).setView([20, 0], 2);
    addBaseLayer(m);
    mapState.map = m;
    mapState.layer = L.layerGroup().addTo(m);
    return m;
  }

  /* OSM's tile servers block requests without a Referer (and opened-from-disk pages never send one).
   * Send only our origin, and fall back to CARTO's OSM-based tiles if OSM refuses. */
  let tilesBlocked = false;
  function addBaseLayer(m) {
    const carto = () => L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO', subdomains: 'abcd', maxZoom: 20
    });
    if (tilesBlocked || location.protocol === 'file:') { carto().addTo(m); return; }
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin'
    });
    let loaded = 0, failed = 0;
    osm.on('tileload', () => { loaded++; });
    osm.on('tileerror', () => {
      if (++failed >= 3 && loaded === 0 && m.hasLayer(osm)) { tilesBlocked = true; m.removeLayer(osm); carto().addTo(m); }
    });
    osm.addTo(m);
  }

  function detectTrips(gps) {
    const dated = gps.filter((p) => p.date).sort((a, b) => a.date - b.date);
    const trips = [];
    let cur = [];
    for (const p of dated) {
      const prev = cur[cur.length - 1];
      if (prev && ((p.date - prev.date) / 3.6e6 > 24 || MP.haversineKm(prev, p) > 300 && (p.date - prev.date) / 3.6e6 > 6)) { trips.push(cur); cur = []; }
      cur.push(p);
    }
    if (cur.length) trips.push(cur);
    return trips;
  }

  function renderMap() {
    if (state.tab !== 'map') return;
    const m = ensureMap();
    setTimeout(() => m.invalidateSize(), 50);
    mapState.layer.clearLayers();
    const list = filtered();
    const gps = list.filter((p) => p.hasGps);
    $('#mapNote').textContent = `${gps.length} of ${list.length} shown photos have GPS`;
    const trips = detectTrips(gps);
    const tripOf = new Map();
    trips.forEach((t, i) => t.forEach((p) => tripOf.set(p.id, i)));
    const ids = gps.map((p) => p.id);

    if (state.mapMode === 'heat') {
      if (gps.length && L.heatLayer) mapState.layer.addLayer(L.heatLayer(gps.map((p) => [p.lat, p.lon, 1]), { radius: 30, blur: 22, maxZoom: 16 }));
    } else {
      const cluster = L.markerClusterGroup({ disableClusteringAtZoom: 15, showCoverageOnHover: false });
      gps.forEach((p) => {
        const color = tripOf.has(p.id) ? TRIP_COLORS[tripOf.get(p.id) % TRIP_COLORS.length] : '#64748b';
        const pin = el('div', { class: 'pin', style: { background: color, borderColor: '#fff' } }, p.thumbUrl ? el('img', { src: p.thumbUrl, alt: '' }) : null);
        const mk = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: pin.outerHTML, iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -38] }), title: p.name });
        mk.bindPopup(() => el('div', { class: 'popup' },
          p.thumbUrl ? el('img', { src: p.thumbUrl, alt: '' }) : null,
          el('b', null, p.name), el('div', null, p.camera), el('div', null, p.date ? MP.fmtDate(p.date) : 'No date'),
          el('div', { class: 'mono' }, `${MP.coord(p.lat, 5)}, ${MP.coord(p.lon, 5)}`),
          el('button', { class: 'btn sm', type: 'button', onclick: () => openModal(p.id, ids) }, 'Details')));
        cluster.addLayer(mk);
      });
      mapState.layer.addLayer(cluster);
      if (state.cones) gps.filter((p) => p.heading !== null).forEach((p) => addCone(mapState.layer, p));
      if (state.mapMode === 'route') {
        trips.forEach((t, i) => {
          if (t.length < 2) return;
          const color = TRIP_COLORS[i % TRIP_COLORS.length];
          mapState.layer.addLayer(L.polyline(t.map((p) => [p.lat, p.lon]), { color, weight: 3, opacity: 0.85, dashArray: '8 6' }));
          t.forEach((p, j) => { if (j) mapState.layer.addLayer(L.circleMarker([p.lat, p.lon], { radius: 3, color, fillOpacity: 1, interactive: false })); });
        });
      }
    }
    renderTrips(trips);
    if (gps.length) fitMap();
  }

  function fitMap() {
    const gps = filtered().filter((p) => p.hasGps);
    if (!gps.length || !mapState.map) return;
    mapState.map.fitBounds(L.latLngBounds(gps.map((p) => [p.lat, p.lon])), { padding: [40, 40], maxZoom: 16 });
  }

  function renderTrips(trips) {
    const host = clear($('#tripsPanel'));
    host.appendChild(el('h3', null, 'Trips & movement'));
    host.appendChild(el('p', { class: 'desc' }, 'Dated, geotagged photos grouped into trips (a new trip starts after a 24 h gap, or a 300 km jump after 6 h).'));
    if (!trips.length) { host.appendChild(el('div', { class: 'muted' }, 'No dated GPS photos in the current filter.')); return; }
    trips.forEach((t, i) => {
      let km = 0;
      for (let j = 1; j < t.length; j++) km += MP.haversineKm(t[j - 1], t[j]);
      const span = t.length > 1 ? `${MP.fmtDate(t[0].date, { dateStyle: 'medium', timeStyle: 'short' })} → ${MP.fmtDate(t[t.length - 1].date, { dateStyle: 'medium', timeStyle: 'short' })}` : MP.fmtDate(t[0].date, { dateStyle: 'medium', timeStyle: 'short' });
      host.appendChild(el('div', { class: 'trip', role: 'button', tabindex: 0, onclick: () => mapState.map && mapState.map.fitBounds(L.latLngBounds(t.map((p) => [p.lat, p.lon])), { padding: [40, 40], maxZoom: 16 }) },
        el('span', { class: 'sw', style: { background: TRIP_COLORS[i % TRIP_COLORS.length] } }),
        el('div', { style: { flex: '1' } }, el('div', { class: 't' }, `Trip ${i + 1}`), el('div', { class: 's' }, span)),
        el('span', { class: 'pill brand' }, `${t.length} photo${t.length !== 1 ? 's' : ''}`),
        el('span', { class: 'pill info' }, `${km < 10 ? km.toFixed(1) : Math.round(km)} km`)));
    });
  }

  /* -------------------------------------------------------------- timeline */
  function renderTimeline() {
    const host = clear($('#tab-timeline'));
    const list = filtered().filter((p) => p.date);
    if (!list.length) { host.appendChild(el('div', { class: 'panel empty' }, 'No capture dates in the current selection.')); return; }

    const groupBtns = ['day', 'month', 'year'].map((g) => el('button', { class: 'chip' + (state.tlGroup === g ? ' active' : ''), type: 'button', onclick: () => { state.tlGroup = g; renderTimeline(); } }, g[0].toUpperCase() + g.slice(1)));
    const counts = new Map();
    list.forEach((p) => {
      const d = p.date;
      const k = state.tlGroup === 'year' ? String(d.getFullYear()) : state.tlGroup === 'month' ? `${d.getFullYear()}-${MP.pad(d.getMonth() + 1)}` : MP.dayKey(d);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    const keys = [...counts.keys()].sort();
    const max = Math.max(...counts.values());
    const W = state.tlGroup === 'day' ? 22 : state.tlGroup === 'month' ? 34 : 56;
    const bars = el('div', { class: 'bars' }), labels = el('div', { class: 'bar-labels' });
    keys.forEach((k) => {
      const n = counts.get(k);
      bars.appendChild(el('div', { class: 'bar', title: `${k}: ${n} photo${n !== 1 ? 's' : ''}`, style: { width: W + 'px', height: Math.max(3, Math.round((n / max) * 180)) + 'px' } }));
      labels.appendChild(el('div', { style: { width: W + 'px' } }, state.tlGroup === 'day' ? k.slice(5) : k));
    });
    bars.addEventListener('scroll', () => { labels.scrollLeft = bars.scrollLeft; });

    host.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'toolbar', style: { marginBottom: '8px' } }, el('h3', { style: { margin: '0 8px 0 0' } }, 'Activity'), ...groupBtns,
        el('span', { class: 'result-count' }, `${list.length} dated photo${list.length !== 1 ? 's' : ''} · ${dateRangeText(list)}`)),
      bars, labels));

    // Pattern of life: hour × weekday
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    list.forEach((p) => grid[(p.date.getDay() + 6) % 7][p.date.getHours()]++);
    const gmax = Math.max(1, ...grid.flat());
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const heat = el('div', { class: 'hgrid', style: { gridTemplateColumns: '34px repeat(24, minmax(10px, 1fr))' } });
    days.forEach((d, di) => {
      heat.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--muted)', alignSelf: 'center' } }, d));
      for (let h = 0; h < 24; h++) {
        const n = grid[di][h];
        heat.appendChild(el('div', { class: 'hcell', title: `${d} ${MP.pad(h)}:00 — ${n} photo${n !== 1 ? 's' : ''}`, style: { opacity: n ? String(0.15 + 0.85 * (n / gmax)) : '0.05' } }));
      }
    });
    const pol = el('div', { class: 'panel' },
      el('h3', null, 'Pattern of life'),
      el('p', { class: 'desc' }, 'When photos were taken, by weekday and hour (camera clock). Clusters reveal routines: commutes, work hours, weekends.'),
      heat, el('div', { class: 'legend-row', style: { paddingLeft: '38px' } }, el('span', null, '00:00'), el('span', null, '06:00'), el('span', null, '12:00'), el('span', null, '18:00'), el('span', null, '23:00')));

    // Sessions
    const srt = [...list].sort((a, b) => a.date - b.date);
    const sessions = [];
    let cur = [srt[0]];
    for (let i = 1; i < srt.length; i++) { if ((srt[i].date - srt[i - 1].date) / 3.6e6 > 3) { sessions.push(cur); cur = []; } cur.push(srt[i]); }
    sessions.push(cur);
    const sp = el('div', { class: 'panel' }, el('h3', null, `Shooting sessions (${sessions.length})`), el('p', { class: 'desc' }, 'Bursts of photos with less than 3 hours between shots.'));
    sessions.slice().reverse().slice(0, 40).forEach((s, i) => {
      const cams = [...new Set(s.map((p) => p.camera))];
      const ids = s.map((p) => p.id);
      sp.appendChild(el('div', { class: 'session' },
        el('div', null, el('div', { class: 't' }, `Session ${sessions.length - i}`),
          el('div', { class: 's' }, `${MP.fmtDate(s[0].date, { dateStyle: 'medium', timeStyle: 'short' })}${s.length > 1 ? ' → ' + MP.fmtDate(s[s.length - 1].date, { timeStyle: 'short' }) : ''} · ${cams.join(', ')}`)),
        el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          el('span', { class: 'pill brand' }, `${s.length} photo${s.length !== 1 ? 's' : ''}`),
          s.some((p) => p.hasGps) ? el('span', { class: 'pill ok' }, `${s.filter((p) => p.hasGps).length} GPS`) : null,
          el('button', { class: 'btn sm', type: 'button', onclick: () => openModal(s[0].id, ids) }, 'Open'))));
    });
    if (sessions.length > 40) sp.appendChild(el('div', { class: 'muted' }, `+ ${sessions.length - 40} older sessions`));
    host.append(el('div', { class: 'cols', style: { marginTop: '16px' } }, pol, sp));
  }

  /* --------------------------------------------------------------- devices */
  function renderDevices() {
    const host = clear($('#tab-devices'));
    const list = filtered();
    const groups = new Map();
    list.forEach((p) => { if (!groups.has(p.camera)) groups.set(p.camera, []); groups.get(p.camera).push(p); });
    if (!groups.size) { host.appendChild(el('div', { class: 'panel empty' }, 'No photos in the current selection.')); return; }
    [...groups.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([cam, ps]) => {
      const lenses = [...new Set(ps.map((p) => p.lens).filter(Boolean))];
      const serials = [...new Set(ps.map((p) => p.serial).filter(Boolean))];
      const sw = [...new Set(ps.map((p) => p.software).filter(Boolean))];
      const ids = ps.map((p) => p.id);
      host.appendChild(el('details', { class: 'group' },
        el('summary', null, icon('camera'), el('span', { class: 't' }, cam),
          el('span', { class: 'pill brand' }, `${ps.length} photo${ps.length !== 1 ? 's' : ''}`),
          ps.some((p) => p.hasGps) ? el('span', { class: 'pill ok' }, `${ps.filter((p) => p.hasGps).length} GPS`) : null,
          serials.length ? el('span', { class: 'pill warn', title: 'Distinct serial numbers' }, `${serials.length} serial${serials.length !== 1 ? 's' : ''}`) : null,
          el('span', { class: 'muted', style: { fontSize: '12px' } }, dateRangeText(ps))),
        el('div', { class: 'inner' },
          el('div', { class: 'kv', style: { marginBottom: '12px' } },
            lenses.length ? [el('div', null, 'Lenses'), el('div', null, lenses.join(' · '))] : null,
            serials.length ? [el('div', null, 'Serial numbers'), el('div', { class: 'mono' }, serials.join(' · '))] : null,
            sw.length ? [el('div', null, 'Software'), el('div', null, sw.join(' · '))] : null),
          el('div', { class: 'grid' }, sorted(ps).map((p) => photoCard(p, ids))))));
    });
  }

  /* ----------------------------------------------------------------- modal */
  function currentModalPhoto() {
    const id = state.modal.list[state.modal.idx];
    return state.photos.find((p) => p.id === id);
  }
  function openModal(id, list) {
    state.modal.list = list && list.length ? list : state.photos.map((p) => p.id);
    state.modal.idx = Math.max(0, state.modal.list.indexOf(id));
    $('#modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderModal();
    $('#mClose').focus();
  }
  function closeModal() {
    $('#modal').classList.add('hidden');
    document.body.style.overflow = '';
    if (state.modal.map) { state.modal.map.remove(); state.modal.map = null; }
  }
  function stepModal(d) {
    const n = state.modal.list.length;
    if (n < 2) return;
    state.modal.idx = (state.modal.idx + d + n) % n;
    renderModal();
  }

  function renderModal() {
    const p = currentModalPhoto();
    if (!p) return closeModal();
    const n = state.modal.list.length;
    $('#mPrev').disabled = n < 2; $('#mNext').disabled = n < 2;
    $('#mTitle').textContent = p.name;
    const pills = clear($('#mPills'));
    pills.append(
      el('span', { class: 'pill brand' }, `${state.modal.idx + 1} / ${n}`),
      el('span', { class: 'pill ' + (p.hasGps ? 'ok' : 'info') }, p.hasGps ? 'GPS' : 'No GPS'),
      el('span', { class: `pill risk-${p.risk.level}` }, `Privacy risk ${p.risk.score}`),
      p.flags.filter((f) => f.sev !== 'info').length ? el('span', { class: 'pill warn' }, `${p.flags.filter((f) => f.sev !== 'info').length} finding(s)`) : null
    );

    // Left: preview, map, links
    const left = clear($('#mLeft'));
    const src = p.decodable ? MP.fullUrl(p) : p.thumbUrl;
    left.appendChild(src ? el('img', { class: 'preview', src, alt: p.name }) : el('div', { class: 'preview empty' }, `${p.realType.toUpperCase()} preview not supported in this browser`));
    if (!p.decodable && p.thumbUrl) left.appendChild(el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } }, 'Showing embedded EXIF preview (the browser cannot decode this format).'));
    if (state.modal.map) { state.modal.map.remove(); state.modal.map = null; }
    if (p.hasGps) {
      const mapBox = el('div', { id: 'modalMap' });
      left.appendChild(mapBox);
      const coords = `${MP.coord(p.lat, 6)}, ${MP.coord(p.lon, 6)}`;
      const addr = el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } });
      left.appendChild(el('div', { class: 'links' },
        el('button', { class: 'btn sm', type: 'button', onclick: () => MP.copy(coords, 'Coordinates') }, icon('copy'), coords),
        el('a', { class: 'btn sm', href: `https://www.google.com/maps?q=${p.lat},${p.lon}`, target: '_blank', rel: 'noopener noreferrer' }, 'Google Maps'),
        el('a', { class: 'btn sm', href: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}`, target: '_blank', rel: 'noopener noreferrer' }, 'OpenStreetMap'),
        el('a', { class: 'btn sm primary', href: MP.places.directions(p).google, target: '_blank', rel: 'noopener noreferrer' }, icon('pin'), 'Directions'),
        p.place ? null : el('button', { class: 'btn sm', type: 'button', title: 'Sends these coordinates to OpenStreetMap Nominatim', onclick: () => reverseGeocode(p, addr) }, 'Look up address')));
      if (p.myPlace || p.place) addr.textContent = [p.myPlace ? `★ ${p.myPlace}` : '', p.place ? p.place.full : ''].filter(Boolean).join(' — ');
      left.appendChild(addr);
      requestAnimationFrame(() => {
        const m = L.map(mapBox, { zoomControl: true, attributionControl: true }).setView([p.lat, p.lon], p.heading !== null ? 17 : 15);
        addBaseLayer(m);
        L.marker([p.lat, p.lon]).addTo(m);
        if (p.heading !== null) addCone(m, p);
        const sunNow = sunFor(p);
        if (sunNow && sunNow.sun.elevation > -6) {
          L.polyline([[p.lat, p.lon], MP.places.offset(p.lat, p.lon, sunNow.sun.azimuth, 0.16)], { color: '#f59e0b', weight: 3, dashArray: '2 6', interactive: false }).addTo(m);
          L.circleMarker(MP.places.offset(p.lat, p.lon, sunNow.sun.azimuth, 0.17), { radius: 7, color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 1 }).bindTooltip(`Sun ${Math.round(sunNow.sun.azimuth)}° ${MP.places.compass(sunNow.sun.azimuth)}, ${Math.round(sunNow.sun.elevation)}° up`).addTo(m);
        }
        state.modal.map = m;
        setTimeout(() => m.invalidateSize(), 60);
      });
    }
    left.appendChild(el('div', { class: p.hasGps ? 'links' : 'geo-callout' },
      p.hasGps ? null : el('div', null, el('b', null, 'No location in this photo'), el('div', { class: 'muted' }, 'Know where it was taken? Add it and download a geotagged copy.')),
      el('button', { class: 'btn sm' + (p.hasGps ? '' : ' primary'), type: 'button', onclick: () => openGeoDialog([p]) }, icon('pin'), p.hasGps ? 'Change location' : 'Set location')));
    if (p.embThumb && p.decodable) {
      left.appendChild(el('div', { class: 'sec', style: { marginTop: '14px' } }, el('h4', null, 'Embedded preview vs image'),
        el('div', { class: 'compare' },
          el('figure', null, el('img', { src: p.thumbUrl, alt: '' }), el('figcaption', null, `Image ${p.width}×${p.height}`)),
          el('figure', null, el('img', { src: p.embThumb.url, alt: '' }), el('figcaption', null, `EXIF thumbnail ${p.embThumb.width}×${p.embThumb.height}`)))));
    }

    $$('#mTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.mtab === state.modal.tab));
    renderModalTab();
  }

  async function reverseGeocode(p, out) {
    if (!confirm('This sends the photo\'s coordinates (not the photo) to OpenStreetMap Nominatim to look up an address. Continue?')) return;
    out.textContent = 'Looking up…';
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${encodeURIComponent(p.lat)}&lon=${encodeURIComponent(p.lon)}`, { referrerPolicy: 'strict-origin-when-cross-origin' });
      const j = await r.json();
      out.textContent = j.display_name ? `≈ ${j.display_name}` : 'No address found.';
    } catch { out.textContent = 'Lookup failed (offline or blocked).'; }
  }

  // Formatters
  const F = {
    exposure: (v) => (typeof v !== 'number' ? null : v >= 1 ? `${+v.toFixed(1)} s` : `1/${Math.round(1 / v)} s`),
    fnum: (v) => (typeof v === 'number' ? `f/${+v.toFixed(1)}` : null),
    focal: (v) => (typeof v === 'number' ? `${+v.toFixed(1)} mm` : null),
    flash: (v) => (typeof v !== 'number' ? (v || null) : `${v & 1 ? 'Fired' : 'Did not fire'}${['', ', compulsory', ', suppressed', ', auto'][(v >> 3) & 3] || ''}${v & 0x40 ? ', red-eye' : ''}`),
    orient: (v) => ({ 1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Mirrored vertically', 5: 'Mirrored + 270°', 6: 'Rotated 90° CW', 7: 'Mirrored + 90°', 8: 'Rotated 270° CW' }[v] || (v != null ? String(v) : null)),
    metering: (v) => ({ 0: 'Unknown', 1: 'Average', 2: 'Center-weighted', 3: 'Spot', 4: 'Multi-spot', 5: 'Pattern / matrix', 6: 'Partial', 255: 'Other' }[v] ?? (v != null ? String(v) : null)),
    program: (v) => ({ 0: 'Not defined', 1: 'Manual', 2: 'Program', 3: 'Aperture priority', 4: 'Shutter priority', 5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape' }[v] ?? (v != null ? String(v) : null)),
    wb: (v) => (v === 0 ? 'Auto' : v === 1 ? 'Manual' : v != null ? String(v) : null),
    bias: (v) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${+v.toFixed(2)} EV` : null),
    colorspace: (v) => (v === 1 ? 'sRGB' : v === 65535 ? 'Uncalibrated' : v != null ? String(v) : null)
  };

  function kvSection(title, rows) {
    rows = rows.filter((r) => r[1] !== null && r[1] !== undefined && r[1] !== '');
    if (!rows.length) return null;
    return el('div', { class: 'sec' }, el('h4', null, title), el('div', { class: 'kv' }, rows.map(([k, v, cls]) => [el('div', null, k), el('div', { class: cls || '' }, v instanceof Node ? v : String(v))])));
  }

  function renderModalTab() {
    const p = currentModalPhoto();
    const c = clear($('#mContent'));
    const t = p.tags;
    const tab = state.modal.tab;
    if (tab === 'overview') {
      const hashNode = p.sha256 ? el('span', null, el('span', { class: 'mono' }, p.sha256), ' ', el('button', { class: 'btn sm', type: 'button', onclick: () => MP.copy(p.sha256, 'SHA-256') }, 'Copy')) : 'Unavailable (needs https or localhost)';
      c.append(...[
        kvSection('Capture', [
          ['Taken', p.date ? MP.fmtDate(p.date, { dateStyle: 'full', timeStyle: 'medium' }) : 'Unknown'],
          ['Date source', p.dateSource],
          ['UTC offset', p.offsetMin !== null ? `UTC${p.offsetMin >= 0 ? '+' : '-'}${MP.pad(Math.floor(Math.abs(p.offsetMin) / 60))}:${MP.pad(Math.abs(p.offsetMin) % 60)}` : null],
          ['GPS time (UTC)', p.gpsUtc ? p.gpsUtc.toISOString().replace('T', ' ').slice(0, 19) : null],
          ['Modified', p.modifyDate ? MP.fmtDate(p.modifyDate) : null]
        ]),
        kvSection('Location', [
          ['Place', p.hasGps ? (p.myPlace ? `★ ${p.myPlace}` + (p.place ? ` (${p.place.short})` : '') : p.place ? p.place.short : 'Not looked up yet (Places tab)') : null],
          ['Address', p.place ? p.place.full : null],
          ['Latitude', p.hasGps ? MP.coord(p.lat, 6) : null, 'mono'], ['Longitude', p.hasGps ? MP.coord(p.lon, 6) : null, 'mono'],
          ['Altitude', p.alt !== null ? `${p.alt.toFixed(1)} m` : null], ['Facing', p.heading !== null ? `${Math.round(p.heading)}° (${'N NE E SE S SW W NW'.split(' ')[Math.round(p.heading / 45) % 8]})` : null],
          ['Speed', typeof t.GPSSpeed === 'number' ? `${t.GPSSpeed} ${({ K: 'km/h', M: 'mph', N: 'knots' })[t.GPSSpeedRef] || ''}` : null],
          ['Accuracy', typeof t.GPSHPositioningError === 'number' ? `±${t.GPSHPositioningError.toFixed(1)} m` : null]
        ]),
        sunSection(p),
        kvSection('Device', [
          ['Make', p.make], ['Model', p.model], ['Lens', p.lens], ['Serial', p.serial, 'mono'], ['Software', p.software], ['Owner / author', p.owner]
        ]),
        kvSection('Exposure', [
          ['Shutter', F.exposure(t.ExposureTime)], ['Aperture', F.fnum(t.FNumber)], ['ISO', t.ISO ?? t.PhotographicSensitivity], ['Focal length', F.focal(t.FocalLength)],
          ['35 mm equiv.', t.FocalLengthIn35mmFormat ? `${t.FocalLengthIn35mmFormat} mm` : null], ['Exposure bias', F.bias(t.ExposureCompensation)],
          ['Program', F.program(t.ExposureProgram)], ['Metering', F.metering(t.MeteringMode)], ['Flash', F.flash(t.Flash)], ['White balance', F.wb(t.WhiteBalance)]
        ]),
        kvSection('File', [
          ['Name', p.name], ['Folder', p.path ? p.path.replace(/[^/]*$/, '') : null], ['Size', MP.fmtBytes(p.size)],
          ['Format', `${p.realType.toUpperCase()}${p.type ? ` (${p.type})` : ''}`], ['Dimensions', p.width ? `${p.width} × ${p.height} px${p.width * p.height > 0 ? ` · ${(p.width * p.height / 1e6).toFixed(1)} MP` : ''}` : null],
          ['Orientation', F.orient(p.orientation)], ['Color space', F.colorspace(t.ColorSpace)], ['ICC profile', t.ProfileDescription || null],
          ['File modified', p.lastModified ? MP.fmtDate(p.lastModified) : null], ['SHA-256', hashNode]
        ])
      ].filter(Boolean));
    } else if (tab === 'findings') {
      if (!p.flags.length) c.appendChild(el('div', { class: 'empty' }, 'No findings for this file.'));
      p.flags.forEach((f) => c.appendChild(el('div', { class: 'flag-card' }, el('span', { class: `sev-bar ${f.sev}` }),
        el('div', null, el('div', { class: 't' }, f.title, ' ', el('span', { class: `pill ${f.sev}` }, f.sev)), el('div', { class: 'w' }, f.why), f.detail ? el('div', { class: 'd' }, f.detail) : null))));
      c.appendChild(el('p', { class: 'muted', style: { fontSize: '12px' } }, 'Findings are heuristic. Absence of findings does not prove an image is authentic.'));
    } else if (tab === 'privacy') {
      const col = p.risk.level === 'high' ? 'var(--bad)' : p.risk.level === 'medium' ? 'var(--warn)' : 'var(--ok)';
      c.append(
        el('div', { class: 'gauge' },
          el('div', { class: 'ring', style: { background: `conic-gradient(${col} ${p.risk.score * 3.6}deg, var(--surface-2) 0)` } }, el('span', null, p.risk.score)),
          el('div', null, el('b', null, `${p.risk.level[0].toUpperCase() + p.risk.level.slice(1)} exposure`), el('div', { class: 'muted', style: { fontSize: '12.5px' } }, 'What a recipient of this exact file could learn.'))),
        ...(p.risk.items.length ? p.risk.items.map((i) => el('div', { class: 'risk-item' }, el('div', null, i.label, i.detail ? el('small', null, i.detail) : null), el('b', null, `+${i.pts}`))) : [el('div', { class: 'muted' }, 'No identifying metadata found.')]),
        el('div', { style: { marginTop: '14px' } }, el('button', { class: 'btn primary', type: 'button', onclick: () => stripOne(p) }, icon('eraser'), 'Download clean copy')),
        el('p', { class: 'muted', style: { fontSize: '12px' } }, 'JPEG and PNG are cleaned losslessly (pixels untouched). Rotated JPEGs and other formats are re-encoded at high quality. The result is re-scanned to confirm nothing remains.'));
    } else {
      const search = el('input', { type: 'search', placeholder: 'Filter tags…', style: { width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface-2)', marginBottom: '10px' } });
      const box = el('div');
      const copyAll = el('button', { class: 'btn sm', type: 'button', onclick: () => MP.copy(JSON.stringify(MP.cleanValue(p.segs), null, 2), 'All metadata') }, icon('copy'), 'Copy JSON');
      const draw = () => {
        clear(box);
        const q = search.value.trim().toLowerCase();
        let total = 0;
        for (const [segName, seg] of Object.entries(p.segs)) {
          if (!seg || typeof seg !== 'object' || seg instanceof Date) continue;
          const rows = Object.entries(seg).filter(([k, v]) => !q || k.toLowerCase().includes(q) || displayVal(v).toLowerCase().includes(q));
          if (!rows.length) continue;
          total += rows.length;
          box.appendChild(el('div', { class: 'raw-group' }, el('h4', null, `${segName} (${rows.length})`),
            el('div', { class: 'kv' }, rows.map(([k, v]) => [el('div', null, k), el('div', { class: 'mono' }, displayVal(v))]))));
        }
        if (!total) box.appendChild(el('div', { class: 'empty' }, q ? 'No matching tags.' : 'No metadata found in this file.'));
      };
      search.addEventListener('input', draw);
      c.append(el('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, search, copyAll), box);
      draw();
    }
  }

  function displayVal(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return isNaN(v) ? 'Invalid date' : v.toISOString().replace('.000Z', 'Z');
    if (ArrayBuffer.isView(v)) return `<binary, ${v.byteLength} bytes>`;
    if (Array.isArray(v)) return v.length > 32 ? `[${v.slice(0, 32).map(displayVal).join(', ')}, … ${v.length} items]` : `[${v.map(displayVal).join(', ')}]`;
    if (typeof v === 'object') { try { const s = JSON.stringify(MP.cleanValue(v)); return s.length > 600 ? s.slice(0, 600) + '…' : s; } catch { return String(v); } }
    const s = String(v);
    return s.length > 600 ? s.slice(0, 600) + '…' : s;
  }

  /* -------------------------------------------------------------- places */
  function addCone(target, p) {
    const c = MP.places.cone(p, 0.12);
    L.polygon(c.pts, { color: '#e11d48', weight: 1.5, fillColor: '#e11d48', fillOpacity: 0.18, interactive: true })
      .bindTooltip(`Camera facing ${Math.round(p.heading)}° ${MP.places.compass(p.heading)} · view ≈${Math.round(c.fov.deg)}°${c.fov.est ? ' (estimated)' : ''}`).addTo(target);
  }

  function sunFor(p) {
    if (!p.hasGps || !p.date) return null;
    const u = MP.places.photoUtc(p);
    if (!u || u.how === 'unknown') return null;
    return { sun: MP.places.sun(u.t, p.lat, p.lon), how: u.how };
  }

  function sunSection(p) {
    const s = sunFor(p);
    const rows = [];
    if (s) {
      const basis = { exact: 'camera clock + its UTC offset', gps: 'GPS satellite time', approx: 'timezone estimated from longitude (±1 h)' }[s.how];
      rows.push(['Sun', `${s.sun.phase} · ${Math.round(s.sun.elevation)}° above horizon`]);
      rows.push(['Sun direction', `${Math.round(s.sun.azimuth)}° ${MP.places.compass(s.sun.azimuth)}`]);
      if (p.heading !== null) rows.push(['Lighting', MP.places.lighting(p.heading, s.sun.azimuth)]);
      rows.push(['Time basis', basis]);
    }
    if (p.hasGps && p.heading !== null) {
      const f = MP.places.fov(p);
      rows.push(['Camera view', `Facing ${Math.round(p.heading)}° ${MP.places.compass(p.heading)} · field of view ≈${Math.round(f.deg)}°${f.est ? ' (estimated)' : ` (${f.f35} mm equiv.)`}`]);
    }
    return kvSection('Sun & camera view', rows);
  }

  async function runLookup(silent) {
    const PL = MP.places;
    if (PL.isRunning()) return;
    const cells = PL.missingCells(state.photos);
    if (!cells.length) { if (!silent) MP.toast('All places already named', 'ok'); return; }
    if (!silent && !confirm(`Look up place names for ${cells.length} location${cells.length !== 1 ? 's' : ''}?\n\nThis sends coordinates only (never photos) to OpenStreetMap Nominatim, about 1 per second (~${Math.ceil(cells.length * 1.1)} s). Results are saved in this browser so each spot is looked up once.`)) return;
    const res = await PL.lookup(state.photos, (d, n) => {
      progress(d, n, 'Naming places');
      if (state.tab === 'places' && d % 5 === 0) renderPlaces();
    });
    progress(null);
    recompute();
    refreshViews();
    if (res) MP.toast(res.cancelled ? `Stopped after ${res.done} lookups` : `Named ${res.done - res.failed} of ${res.total} locations${res.failed ? ` · ${res.failed} failed (try again later)` : ''}`, res.failed ? 'err' : 'ok');
  }

  const placesMap = { map: null, layer: null };
  const fmtDur = (min) => min < 1 ? '<1 min' : min < 60 ? `${Math.round(min)} min` : min < 1440 ? `${(min / 60).toFixed(1)} h` : `${(min / 1440).toFixed(1)} days`;
  const fmtKm = (km) => km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`;

  function renderPlaces() {
    const PL = MP.places;
    const host = clear($('#tab-places'));
    const list = filtered();
    const gps = list.filter((p) => p.hasGps);
    if (!gps.length) {
      host.appendChild(el('div', { class: 'panel empty' }, 'No photos with GPS in the current selection. Use “Set location” to add one.'));
      return;
    }
    const clusters = PL.clusters(list);
    const legs = PL.legs(list);
    const tree = PL.rollup(list);
    const missing = PL.missingCells(list).length;
    const named = gps.filter((p) => p.place).length;
    const cities = new Set(), areas = new Set();
    tree.forEach((C, co) => C.cities.forEach((I, ci) => { cities.add(co + '|' + ci); I.areas.forEach((n, ar) => areas.add(co + '|' + ci + '|' + ar)); }));
    const totalKm = legs.reduce((s, l) => s + l.km, 0);
    const impossible = legs.filter((l) => l.impossible).length;

    // Header + lookup controls
    const auto = el('input', { type: 'checkbox', id: 'autoGeo', onchange: (e) => { PL.setAutoLookup(e.target.checked); if (e.target.checked) runLookup(false); } });
    auto.checked = PL.autoLookup();
    host.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'places-head' },
        el('div', null, el('h3', null, 'Places'), el('p', { class: 'desc', style: { margin: 0 } }, `${named} of ${gps.length} geotagged photos have place names. Name your own spots (Home, Office…) and they stick in this browser.`)),
        el('div', { class: 'places-actions' },
          PL.isRunning()
            ? el('button', { class: 'btn', type: 'button', onclick: () => PL.cancelLookup && PL.cancelLookup() }, 'Stop lookup')
            : el('button', { class: 'btn primary', type: 'button', disabled: !missing || null, onclick: () => runLookup(false) }, icon('search'), missing ? `Look up ${missing} place name${missing !== 1 ? 's' : ''}` : 'All places named'),
          el('label', { class: 'check', for: 'autoGeo' }, auto, 'Auto for new photos'))),
      el('div', { class: 'stats', style: { margin: '14px 0 0' } },
        miniStat(clusters.length, 'Distinct places'),
        miniStat(clusters.filter((c) => c.days >= 2).length, 'Visited on 2+ days'),
        miniStat(tree.size || '—', 'Countries'),
        miniStat(cities.size || '—', 'Cities'),
        miniStat(areas.size || '—', 'Areas'),
        miniStat(fmtKm(totalKm), 'Distance between photos'),
        miniStat(impossible, 'Impossible jumps', impossible ? 'bad' : 'ok'))));

    // Map + frequent list
    const mapBox = el('div', { id: 'placesMap' });
    const listBox = el('div', { class: 'place-list' });
    host.appendChild(el('div', { class: 'places-grid' },
      el('div', { class: 'panel' }, el('h3', null, 'Map of places'), el('p', { class: 'desc' }, 'Circle size = number of photos. Click one for details and directions.'), mapBox),
      el('div', { class: 'panel' }, el('h3', null, 'Frequent places'), el('p', { class: 'desc' }, 'Spots within ~150 m grouped together, ranked by how many days you were there.'), listBox)));

    clusters.slice(0, 60).forEach((c, i) => {
      const ids = c.items.map((p) => p.id);
      const cover = c.items.find((p) => p.thumbUrl);
      listBox.appendChild(el('div', { class: 'place-card' },
        cover ? el('img', { src: cover.thumbUrl, alt: '', loading: 'lazy' }) : el('div', { class: 'ph' }),
        el('div', { class: 'pc-body' },
          el('div', { class: 'pc-title' }, el('span', { class: 'rank' }, `#${i + 1}`), c.myName ? el('span', { class: 'star' }, '★ ') : null, c.name),
          el('div', { class: 'pc-sub' }, c.myName && c.placeName ? c.placeName : (c.full ? c.full.full : `${MP.coord(c.lat, 5)}, ${MP.coord(c.lon, 5)}`)),
          el('div', { class: 'pc-pills' },
            el('span', { class: 'pill brand' }, `${c.items.length} photo${c.items.length !== 1 ? 's' : ''}`),
            c.days ? el('span', { class: 'pill info' }, `${c.days} day${c.days !== 1 ? 's' : ''}`) : null,
            c.dwellMin >= 1 ? el('span', { class: 'pill ok', title: 'Time between first and last photo here, summed per day' }, `~${fmtDur(c.dwellMin)} here`) : null,
            c.first ? el('span', { class: 'muted', style: { fontSize: '11.5px' } }, c.first === c.last || MP.dayKey(c.first) === MP.dayKey(c.last) ? MP.fmtDay(c.first) : `${MP.fmtDay(c.first)} – ${MP.fmtDay(c.last)}`) : null),
          el('div', { class: 'pc-actions' },
            el('a', { class: 'btn sm primary', href: PL.directions(c).google, target: '_blank', rel: 'noopener noreferrer' }, 'Directions'),
            el('button', { class: 'btn sm', type: 'button', onclick: () => { placesMap.map && placesMap.map.setView([c.lat, c.lon], 16); mapBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 'Show'),
            el('button', { class: 'btn sm', type: 'button', onclick: () => openModal(c.items[0].id, ids) }, 'Photos'),
            el('button', { class: 'btn sm', type: 'button', onclick: () => namePlace(c) }, c.myName ? 'Rename' : 'Name it'),
            c.myName ? el('button', { class: 'btn sm ghost', type: 'button', title: 'Remove your name for this place', onclick: () => { PL.removeMyPlace(c.myRef.lat, c.myRef.lon); afterPlaceEdit(); } }, '✕') : null))));
    });
    if (clusters.length > 60) listBox.appendChild(el('div', { class: 'muted' }, `+ ${clusters.length - 60} more places`));

    requestAnimationFrame(() => {
      if (placesMap.map && !document.body.contains(placesMap.map.getContainer())) { placesMap.map.remove(); placesMap.map = null; }
      if (!placesMap.map) {
        placesMap.map = L.map(mapBox, { worldCopyJump: true }).setView([20, 0], 2);
        addBaseLayer(placesMap.map);
        placesMap.layer = L.layerGroup().addTo(placesMap.map);
      }
      placesMap.layer.clearLayers();
      const max = Math.max(...clusters.map((c) => c.items.length));
      clusters.forEach((c) => {
        const r = 7 + 18 * Math.sqrt(c.items.length / max);
        L.circleMarker([c.lat, c.lon], { radius: r, color: c.myName ? '#e11d48' : '#5b5bf0', weight: 2, fillOpacity: 0.35 })
          .bindPopup(() => el('div', { class: 'popup' }, el('b', null, (c.myName ? '★ ' : '') + c.name), el('div', null, `${c.items.length} photos · ${c.days} day(s)`),
            el('a', { class: 'btn sm', href: PL.directions(c).google, target: '_blank', rel: 'noopener noreferrer', style: { marginTop: '6px' } }, 'Directions'), ' ',
            el('button', { class: 'btn sm', type: 'button', onclick: () => openModal(c.items[0].id, c.items.map((p) => p.id)) }, 'Photos')))
          .bindTooltip(el('span', null, (c.myName ? '★ ' : '') + c.name)).addTo(placesMap.layer);
      });
      placesMap.map.invalidateSize();
      placesMap.map.fitBounds(L.latLngBounds(clusters.map((c) => [c.lat, c.lon])), { padding: [30, 30], maxZoom: 15 });
    });

    // Countries → cities → areas
    const roll = el('div', { class: 'panel' }, el('h3', null, 'Where you’ve been'), el('p', { class: 'desc' }, 'Countries, cities and areas from looked-up place names.'));
    if (!tree.size) roll.appendChild(el('div', { class: 'muted' }, 'Look up place names to see countries, cities and areas.'));
    [...tree.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([co, C]) => {
      roll.appendChild(el('details', { class: 'group', open: tree.size <= 3 || null },
        el('summary', null, el('span', { class: 't' }, `${flagEmoji(C.cc)} ${co}`), el('span', { class: 'pill brand' }, `${C.n} photo${C.n !== 1 ? 's' : ''}`), el('span', { class: 'muted', style: { fontSize: '12px' } }, `${C.cities.size} cit${C.cities.size !== 1 ? 'ies' : 'y'}`)),
        el('div', { class: 'inner' }, [...C.cities.entries()].sort((a, b) => b[1].n - a[1].n).map(([ci, I]) =>
          el('div', { class: 'city-row' }, el('b', null, ci), el('span', { class: 'muted' }, ` · ${I.n}`),
            el('div', { class: 'area-chips' }, [...I.areas.entries()].sort((a, b) => b[1] - a[1]).map(([ar, n]) =>
              el('button', { class: 'chip', type: 'button', title: 'Filter photos to this area', onclick: () => { $('#q').value = ar === '—' ? ci : ar; state.f.q = $('#q').value.toLowerCase(); switchTab('photos'); refreshViews(); } }, `${ar} · ${n}`))))))));
    });

    // Travel legs
    const lg = el('div', { class: 'panel' }, el('h3', null, `Journeys between photos (${legs.length})`),
      el('p', { class: 'desc' }, 'Each move between consecutive geotagged photos, with distance, time and a likely way of travel from the speed. Moves faster than an airliner are flagged as impossible.'));
    if (!legs.length) lg.appendChild(el('div', { class: 'muted' }, 'Need at least two dated photos at different places.'));
    legs.slice().reverse().slice(0, 150).forEach((l) => {
      const cls = l.impossible ? 'bad' : /Flight/.test(l.mode) ? 'info' : l.mode === 'Later visit' ? 'warn' : l.mode === 'Walking' ? 'ok' : 'brand';
      lg.appendChild(el('div', { class: 'leg' + (l.impossible ? ' impossible' : '') },
        el('div', { class: 'leg-main' },
          el('div', { class: 'leg-route' }, el('span', null, PL.label(l.from)), el('span', { class: 'arrow' }, '→'), el('span', null, PL.label(l.to))),
          el('div', { class: 'leg-sub' }, `${MP.fmtDate(l.from.date, { dateStyle: 'medium', timeStyle: 'short' })} → ${MP.fmtDate(l.to.date, { dateStyle: 'medium', timeStyle: 'short' })}${l.approx ? ' · timezone estimated' : ''}`)),
        el('div', { class: 'leg-stats' },
          el('span', { class: 'mono' }, fmtKm(l.km)), el('span', { class: 'mono muted' }, fmtDur(l.hours * 60)),
          el('span', { class: 'mono muted' }, isFinite(l.speed) ? `${Math.round(l.speed)} km/h` : '∞'),
          el('span', { class: `pill ${cls}` }, l.mode),
          el('a', { class: 'btn sm', href: PL.routeBetween(l.from, l.to), target: '_blank', rel: 'noopener noreferrer', title: 'Open this route in Google Maps' }, 'Route'),
          el('button', { class: 'btn sm ghost', type: 'button', onclick: () => openModal(l.from.id, [l.from.id, l.to.id]) }, 'Compare'))));
    });
    if (legs.length > 150) lg.appendChild(el('div', { class: 'muted' }, `+ ${legs.length - 150} earlier journeys`));
    host.append(roll, lg);
  }

  function miniStat(n, l, cls) { return el('div', { class: 'stat ' + (cls || '') }, el('div', { class: 'n' + (String(n).length > 6 ? ' sm' : '') }, n), el('div', { class: 'l' }, l)); }
  function flagEmoji(cc) { return cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '🌐'; }

  function namePlace(c) {
    const name = prompt(`Name this place (e.g. Home, Office, Gym)\n\n${c.placeName || ''}`, c.myName || '');
    if (name === null) return;
    MP.places.saveMyPlace(name.trim(), c.myRef ? c.myRef.lat : c.lat, c.myRef ? c.myRef.lon : c.lon);
    afterPlaceEdit();
    if (name.trim()) MP.toast(`Saved “${name.trim()}”`, 'ok');
  }
  function afterPlaceEdit() { recompute(); refreshViews(); }

  /* -------------------------------------------------------------- geotag */
  const geo = { list: [], map: null, marker: null, searchOk: false };

  function openGeoDialog(list) {
    if (!list.length) return MP.toast('No photos to tag', 'err');
    geo.list = list;
    const dlg = $('#geoDlg');
    const one = list.length === 1 ? list[0] : null;
    $('#geoTitle').textContent = one ? `Set location — ${one.name}` : `Set location for ${list.length} photos`;
    const nonJpeg = list.filter((p) => p.realType !== 'jpeg').length;
    $('#geoNote').textContent = (one ? '' : 'The same location is written to every photo. ') +
      'JPEG photos keep all their other metadata and pixels. ' +
      (nonJpeg ? `${nonJpeg} non-JPEG file${nonJpeg !== 1 ? 's' : ''} will be converted to high-quality JPEG. ` : '') +
      'The tag is marked as manually set (GPSProcessingMethod = MANUAL).';
    $('#geoAlt').value = one && one.alt !== null && one.gpsManual ? one.alt : '';
    $('#geoResults').replaceChildren();
    $('#geoSearch').value = '';
    const start = one && one.hasGps ? { lat: one.lat, lon: one.lon } : null;
    setGeoInputs(start);
    dlg.showModal();
    requestAnimationFrame(() => {
      if (!geo.map) {
        geo.map = L.map('geoMap', { worldCopyJump: true }).setView([20, 0], 2);
        addBaseLayer(geo.map);
        geo.map.on('click', (e) => placeGeo({ lat: e.latlng.lat, lon: wrapLon(e.latlng.lng) }, false));
      }
      geo.map.invalidateSize();
      if (start) placeGeo(start, true);
      else {
        if (geo.marker) { geo.map.removeLayer(geo.marker); geo.marker = null; }
        const known = state.photos.filter((p) => p.hasGps);
        if (known.length) geo.map.fitBounds(L.latLngBounds(known.map((p) => [p.lat, p.lon])), { padding: [30, 30], maxZoom: 13 });
        else geo.map.setView([20, 0], 2);
      }
      $('#geoCoords').focus();
    });
  }
  const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

  function setGeoInputs(loc) {
    $('#geoCoords').value = loc ? `${MP.coord(loc.lat, 6)}, ${MP.coord(loc.lon, 6)}` : '';
    $('#geoApply').disabled = !loc;
  }

  function placeGeo(loc, zoom) {
    setGeoInputs(loc);
    if (!geo.map) return;
    if (!geo.marker) {
      geo.marker = L.marker([loc.lat, loc.lon], { draggable: true }).addTo(geo.map);
      geo.marker.on('dragend', () => { const ll = geo.marker.getLatLng(); setGeoInputs({ lat: ll.lat, lon: wrapLon(ll.lng) }); });
    } else geo.marker.setLatLng([loc.lat, loc.lon]);
    if (zoom) geo.map.setView([loc.lat, loc.lon], Math.max(geo.map.getZoom(), 15));
  }

  async function geoSearch() {
    const q = $('#geoSearch').value.trim();
    const out = $('#geoResults');
    if (!q) return;
    const direct = MP.parseCoords(q);
    if (direct) { placeGeo(direct, true); out.replaceChildren(); return; }
    if (!geo.searchOk && !confirm('Address search sends your search text (not your photos) to OpenStreetMap Nominatim. Continue?')) return;
    geo.searchOk = true;
    out.replaceChildren(el('div', { class: 'muted' }, 'Searching…'));
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { referrerPolicy: 'strict-origin-when-cross-origin' });
      const list = await r.json();
      out.replaceChildren();
      if (!list.length) { out.appendChild(el('div', { class: 'muted' }, 'No places found. Try a different spelling, or click the map.')); return; }
      list.forEach((h) => out.appendChild(el('button', { type: 'button', class: 'geo-hit', onclick: () => { placeGeo({ lat: +h.lat, lon: +h.lon }, true); out.replaceChildren(); } }, h.display_name)));
    } catch { out.replaceChildren(el('div', { class: 'muted' }, 'Search failed (offline or blocked). You can still click the map or paste coordinates.')); }
  }

  async function applyGeo() {
    const loc = MP.parseCoords($('#geoCoords').value);
    if (!loc) { MP.toast('Enter coordinates like 23.7806, 90.4070, or click the map', 'err'); return; }
    const altRaw = $('#geoAlt').value.trim();
    if (altRaw !== '') { const a = parseFloat(altRaw); if (!isFinite(a)) { MP.toast('Altitude must be a number in metres', 'err'); return; } loc.alt = a; }
    $('#geoDlg').close();
    const list = geo.list;
    try {
      if (list.length === 1) {
        const res = await MP.geotagRecord(list[0], loc);
        MP.download(res.blob, res.name);
        MP.applyManualLocation(list[0], loc);
        MP.toast(res.verified ? `Geotagged copy saved (${res.method})` : 'Saved, but the location could not be verified. Check the file.', res.verified ? 'ok' : 'err');
      } else {
        progress(0, list.length, 'Geotagging');
        const zip = await MP.geotagMany(list, loc, (d, n) => progress(d, n, 'Geotagging'));
        progress(null);
        MP.download(zip, `metapeek-geotagged-${stamp()}.zip`);
        MP.toast(`Geotagged ${list.length} photos → ZIP (see _metapeek_geotag_log.tsv inside)`, 'ok');
      }
    } catch (e) { progress(null); MP.toast('Geotagging failed: ' + e.message, 'err'); }
    recompute();
    refreshViews();
    if (!$('#modal').classList.contains('hidden')) renderModal();
  }

  /* ------------------------------------------------------- strip & export */
  async function stripOne(p) {
    try {
      const res = await MP.stripRecord(p);
      MP.download(res.blob, res.name);
      MP.toast(res.verified ? `Clean copy saved (${res.method})` : `Saved, but some tags remain: ${res.remaining.slice(0, 4).join(', ')}`, res.verified ? 'ok' : 'err');
    } catch (e) { MP.toast(`Could not clean ${p.name}: ${e.message}`, 'err'); }
  }

  async function stripSet(list, label) {
    if (!list.length) return MP.toast('No photos to clean', 'err');
    if (list.length === 1) return stripOne(list[0]);
    try {
      progress(0, list.length, 'Cleaning');
      const zip = await MP.stripMany(list, (d, n) => progress(d, n, 'Cleaning'));
      progress(null);
      MP.download(zip, `metapeek-clean-${stamp()}.zip`);
      MP.toast(`Cleaned ${list.length} ${label} photos → ZIP (see _metapeek_strip_log.tsv inside)`, 'ok');
    } catch (e) { progress(null); MP.toast('Cleaning failed: ' + e.message, 'err'); }
  }

  const stamp = () => { const d = new Date(); return `${d.getFullYear()}${MP.pad(d.getMonth() + 1)}${MP.pad(d.getDate())}-${MP.pad(d.getHours())}${MP.pad(d.getMinutes())}`; };

  function doExport(kind) {
    const list = sorted(filtered());
    if (!list.length) return MP.toast('Nothing to export with the current filters', 'err');
    if (kind === 'report') {
      const dlg = $('#reportDlg');
      dlg.onclose = () => {
        if (dlg.returnValue !== 'ok') return;
        const meta = { caseId: $('#rCase').value.trim(), analyst: $('#rAnalyst').value.trim(), notes: $('#rNotes').value.trim() };
        MP.download(MP.exportReport(list, meta, collectionStats(list)), `metapeek-report-${stamp()}.html`);
        MP.toast('Report downloaded. Open it and choose Print → Save as PDF', 'ok');
      };
      dlg.returnValue = '';
      dlg.showModal();
      return;
    }
    const map = {
      json: () => [MP.exportJSON(list), 'json'], csv: () => [MP.exportCSV(list), 'csv'],
      geojson: () => [MP.exportGeoJSON(list), 'geojson'], kml: () => [MP.exportKML(list), 'kml']
    };
    const [blob, ext] = map[kind]();
    if ((kind === 'geojson' || kind === 'kml') && !list.some((p) => p.hasGps)) MP.toast('No GPS photos in this selection; file will be empty', 'err');
    MP.download(blob, `metapeek-${stamp()}.${ext}`);
  }

  /* ------------------------------------------------------------------ theme */
  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('metapeek-theme', next); } catch (e) { /* private mode */ }
    syncThemeIcon();
  }
  function syncThemeIcon() {
    const b = $('#themeBtn');
    clear(b).appendChild(icon(document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon'));
  }

  MP._state = state; // for debugging / tests
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
