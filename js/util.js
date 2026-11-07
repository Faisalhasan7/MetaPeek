/* MetaPeek — shared utilities. Everything is attached to window.MP. */
(function () {
  'use strict';
  const MP = (window.MP = window.MP || {});

  /**
   * Safe DOM builder. Never uses innerHTML for data.
   * el('div', {class: 'x', onclick: fn, dataset: {id: 1}}, 'text', childNode, [more])
   */
  MP.el = function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    appendChildren(node, children);
    return node;
  };
  function appendChildren(node, children) {
    for (const c of children) {
      if (c === undefined || c === null || c === false) continue;
      if (Array.isArray(c)) appendChildren(node, c);
      else if (c instanceof Node) node.appendChild(c);
      else node.appendChild(document.createTextNode(String(c)));
    }
  }

  /** SVG icon from a fixed internal set (no user data ever reaches these strings). */
  const ICONS = {
    image: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    upload: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
    shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    camera: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM15 13a3 3 0 11-6 0 3 3 0 016 0z',
    pin: 'M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z',
    alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
    sun: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
    moon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z',
    x: 'M6 18L18 6M6 6l12 12',
    left: 'M15 19l-7-7 7-7',
    right: 'M9 5l7 7-7 7',
    copy: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
    doc: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    folder: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
    eraser: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    fingerprint: 'M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4'
  };
  MP.icon = function icon(name, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ico ' + (cls || ''));
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('d', ICONS[name] || ICONS.image);
    svg.appendChild(p);
    return svg;
  };

  MP.clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
  MP.$ = (sel, root) => (root || document).querySelector(sel);
  MP.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Run async jobs with bounded concurrency, reporting progress. */
  MP.pool = async function pool(items, limit, worker, onProgress) {
    const results = new Array(items.length);
    let next = 0, done = 0;
    async function run() {
      while (next < items.length) {
        const i = next++;
        try { results[i] = await worker(items[i], i); }
        catch (e) { console.warn('[MetaPeek] job failed', e); results[i] = null; }
        done++;
        if (onProgress) onProgress(done, items.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  };

  MP.sha256 = async function sha256(buf) {
    if (!(window.crypto && crypto.subtle)) return null;
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  MP.fmtBytes = function (n) {
    if (!n && n !== 0) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(1) : n) + ' ' + u[i];
  };
  MP.fmtDate = (d, opts) => (d ? d.toLocaleString(undefined, opts || { dateStyle: 'medium', timeStyle: 'medium' }) : '');
  MP.fmtDay = (d) => (d ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
  MP.pad = (n) => String(n).padStart(2, '0');
  MP.isoLocal = (d) => d ? `${d.getFullYear()}-${MP.pad(d.getMonth() + 1)}-${MP.pad(d.getDate())}T${MP.pad(d.getHours())}:${MP.pad(d.getMinutes())}:${MP.pad(d.getSeconds())}` : '';
  MP.dayKey = (d) => `${d.getFullYear()}-${MP.pad(d.getMonth() + 1)}-${MP.pad(d.getDate())}`;
  MP.coord = (n, p) => (typeof n === 'number' ? n.toFixed(p || 6) : '');

  MP.download = function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = MP.el('a', { href: url, download: name, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  };

  MP.toast = function toast(msg, kind) {
    let box = MP.$('#toasts');
    if (!box) { box = MP.el('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(box); }
    const t = MP.el('div', { class: 'toast ' + (kind || '') }, msg);
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2800);
    setTimeout(() => t.remove(), 3300);
  };

  MP.copy = async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); MP.toast((label || 'Copied') + ' to clipboard', 'ok'); }
    catch { MP.toast('Clipboard not available', 'err'); }
  };

  MP.haversineKm = function (a, b) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
})();
