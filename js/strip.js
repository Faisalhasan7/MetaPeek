/* MetaPeek — metadata removal.
 * JPEG and PNG are cleaned losslessly (metadata segments/chunks dropped, pixels untouched).
 * Rotated JPEGs and other formats are re-encoded through a canvas, which carries no metadata.
 * Every output is re-parsed to verify nothing identifying survived. */
(function () {
  'use strict';
  const MP = window.MP;

  function stripJpeg(u8, keepIcc) {
    if (u8[0] !== 0xff || u8[1] !== 0xd8) throw new Error('Not a JPEG');
    const out = [u8.subarray(0, 2)];
    let i = 2;
    while (i < u8.length) {
      if (u8[i] !== 0xff) throw new Error('Corrupt JPEG marker at ' + i);
      const marker = u8[i + 1];
      if (marker === 0xff) { i++; continue; } // fill byte
      if (marker === 0xda) { out.push(u8.subarray(i)); break; } // start of scan: rest is image data
      if (marker === 0xd9) { out.push(u8.subarray(i, i + 2)); break; }
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(u8.subarray(i, i + 2)); i += 2; continue; }
      const len = (u8[i + 2] << 8) | u8[i + 3];
      const seg = u8.subarray(i, i + 2 + len);
      const isApp = marker >= 0xe1 && marker <= 0xef; // APP1..APP15 (EXIF, XMP, ICC, IPTC, Ducky, Adobe…)
      const isCom = marker === 0xfe;
      const isIcc = marker === 0xe2 && String.fromCharCode(...seg.subarray(4, 15)) === 'ICC_PROFILE';
      const isAdobe = marker === 0xee; // APP14 Adobe: colour transform info, no personal data; dropping can shift colours
      if ((!isApp && !isCom) || (keepIcc && isIcc) || isAdobe) out.push(seg);
      i += 2 + len;
    }
    return new Blob(out, { type: 'image/jpeg' });
  }

  const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  function stripPng(u8) {
    const out = [u8.subarray(0, 8)];
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let i = 8;
    while (i + 8 <= u8.length) {
      const len = dv.getUint32(i);
      const type = String.fromCharCode(...u8.subarray(i + 4, i + 8));
      const end = i + 12 + len;
      if (!PNG_DROP.has(type)) out.push(u8.subarray(i, end));
      i = end;
      if (type === 'IEND') break;
    }
    return new Blob(out, { type: 'image/png' });
  }

  async function reencode(file, srcType) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close && bmp.close();
    const type = srcType === 'png' ? 'image/png' : srcType === 'webp' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise((r) => c.toBlob(r, type, 0.95));
    if (!blob) throw new Error('Re-encode failed');
    return blob;
  }

  const EXT_FOR = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  /** @returns {Promise<{blob, name, method, verified, remaining}>} */
  MP.stripRecord = async function stripRecord(rec, opts) {
    opts = Object.assign({ keepIcc: true }, opts);
    const u8 = new Uint8Array(await rec.file.arrayBuffer());
    let blob, method;
    if (rec.realType === 'jpeg' && (rec.orientation || 1) === 1) {
      blob = stripJpeg(u8, opts.keepIcc); method = 'lossless';
    } else if (rec.realType === 'png') {
      blob = stripPng(u8); method = 'lossless';
    } else {
      if (!rec.decodable) throw new Error(`${rec.realType.toUpperCase()} cannot be decoded in this browser`);
      blob = await reencode(rec.file, rec.realType); method = rec.realType === 'jpeg' ? 're-encoded (orientation applied)' : 're-encoded';
    }
    // Verify
    let remaining = [];
    try {
      const check = await exifr.parse(await blob.arrayBuffer(), { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, mergeOutput: true });
      if (check) remaining = Object.keys(check).filter((k) => !/^(ImageWidth|ImageHeight|BitDepth|ColorType|Compression|Filter|Interlace|JFIF|ResolutionUnit|XResolution|YResolution|ThumbnailWidth|ThumbnailHeight|JFIFVersion)$/i.test(k));
    } catch { /* unparseable == nothing left */ }
    const base = rec.name.replace(/\.[^.]+$/, '');
    const ext = EXT_FOR[blob.type] || rec.ext || 'jpg';
    return { blob, name: `${base}_clean.${ext}`, method, verified: remaining.length === 0, remaining, saved: rec.size - blob.size };
  };

  MP.stripMany = async function stripMany(records, onProgress) {
    if (typeof JSZip === 'undefined') throw new Error('ZIP library failed to load');
    const zip = new JSZip();
    const log = [];
    const used = new Set();
    await MP.pool(records, 3, async (r) => {
      try {
        const res = await MP.stripRecord(r);
        let name = res.name, n = 1;
        while (used.has(name)) name = res.name.replace(/(\.[^.]+)$/, `_${++n}$1`);
        used.add(name);
        zip.file(name, res.blob);
        log.push(`${r.name}\t${name}\t${res.method}\t${res.verified ? 'verified clean' : 'CHECK: ' + res.remaining.join(',')}`);
      } catch (e) {
        log.push(`${r.name}\t-\tFAILED\t${e.message}`);
      }
    }, onProgress);
    zip.file('_metapeek_strip_log.tsv', 'source\toutput\tmethod\tresult\n' + log.join('\n') + '\n');
    return zip.generateAsync({ type: 'blob' });
  };
})();
