/* =====================================================================
 * QE XLSX-writer — client-side (port van klok-stats-xlsx.php)
 * ---------------------------------------------------------------------
 * Genereert een multi-sheet .xlsx VOLLEDIG in de browser, zonder externe
 * library: eigen ZIP (STORE-modus, met CRC32) + OOXML. Zelfde styles,
 * formules en kleuren als de PHP-versie, zodat de export er identiek uitziet.
 *
 * Gebruik:
 *   const sheets = {
 *     'Overzicht': [
 *        [ {v:'Naam',t:'s',s:1}, {v:'Uren',t:'s',s:1} ],   // header (style 1)
 *        [ {v:'Levi',t:'s'},     {v:168.5,t:'n',s:2} ],    // data
 *     ],
 *   };
 *   const b64 = QEXlsx.toBase64(sheets);           // base64 string
 *   QEBridge.saveBase64File(b64, 'uren.xlsx', QEXlsx.MIME);
 *
 * Cel: { v:waarde, t:'s'|'n', s:styleCode, f:formule(optioneel) }
 *   styleCodes: zie klok-stats-xlsx.php (0..33) — 1-op-1 overgenomen.
 * ===================================================================== */
(function () {
  'use strict';

  var MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ---------- CRC32 ----------
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = (c >>> 8) ^ CRC[(c ^ bytes[i]) & 0xFF];
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  var ENC = new TextEncoder();
  function sb(s) { return ENC.encode(s); }
  function u16(n) { return new Uint8Array([n & 0xFF, (n >> 8) & 0xFF]); }
  function u32(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]); }
  function concat(arrs) {
    var len = 0, i;
    for (i = 0; i < arrs.length; i++) len += arrs[i].length;
    var out = new Uint8Array(len), o = 0;
    for (i = 0; i < arrs.length; i++) { out.set(arrs[i], o); o += arrs[i].length; }
    return out;
  }

  // ---------- ZIP (STORE, geen compressie — Excel accepteert dit) ----------
  function zipStore(files) {  // files: [{name, data:Uint8Array}]
    var parts = [], cd = [], offset = 0, count = 0;
    var d = new Date();
    var dosTime = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
    var dosDate = ((((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F));
    for (var i = 0; i < files.length; i++) {
      var nameB = sb(files[i].name), data = files[i].data, crc = crc32(data), len = data.length;
      var lfh = concat([
        sb('PK\x03\x04'), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(len), u32(len), u16(nameB.length), u16(0), nameB
      ]);
      parts.push(lfh, data);
      cd.push(concat([
        sb('PK\x01\x02'), u16(0x031e), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(len), u32(len), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(offset), nameB
      ]));
      offset += lfh.length + data.length;
      count++;
    }
    var cdBytes = concat(cd);
    var eocd = concat([sb('PK\x05\x06'), u16(0), u16(0), u16(count), u16(count), u32(cdBytes.length), u32(offset), u16(0)]);
    return concat(parts.concat([cdBytes, eocd]));
  }

  // ---------- OOXML helpers ----------
  function colLetter(n) { var s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
  function xmlEsc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function safeSheetName(name) { return String(name).replace(/[\\\/:?*\[\]]/g, '-').trim().slice(0, 31); }

  function cellDisplayLength(cell) {
    var type = cell.t || 's', val = (cell.v == null ? '' : cell.v);
    if (val === '' || val === null) return 0;
    if (type === 'n') {
      var num = parseFloat(val); if (isNaN(num)) return 4;
      if (num === 0) return 4;
      var intPart = Math.floor(Math.abs(num));
      var intLen = intPart === 0 ? 1 : (Math.floor(Math.log10(intPart)) + 1);
      var len = intLen + 3; if (num < 0) len++;
      return len;
    }
    var lines = String(val).split(/\r?\n/), max = 0;
    for (var i = 0; i < lines.length; i++) if (lines[i].length > max) max = lines[i].length;
    return max;
  }

  function buildSheet(rows) {
    // PASS 1: kolom-breedtes (auto-fit)
    var maxLen = {}, r, c;
    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r].length; c++) {
        var l = cellDisplayLength(rows[r][c]);
        if (!maxLen[c + 1] || l > maxLen[c + 1]) maxLen[c + 1] = l;
      }
    }
    var colsXml = '';
    var keys = Object.keys(maxLen);
    if (keys.length) {
      colsXml = '<cols>';
      for (var ci = 0; ci < keys.length; ci++) {
        var col = parseInt(keys[ci], 10), len = maxLen[col];
        if (len <= 0) continue;
        var w = len + 2; if (w < 4) w = 4; if (w > 50) w = 50;
        colsXml += '<col min="' + col + '" max="' + col + '" width="' + w + '" customWidth="1" bestFit="1"/>';
      }
      colsXml += '</cols>';
    }
    // PASS 2: sheetData
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + colsXml + '<sheetData>';
    for (r = 0; r < rows.length; r++) {
      var rowIdx = r + 1;
      xml += '<row r="' + rowIdx + '">';
      for (c = 0; c < rows[r].length; c++) {
        var cell = rows[r][c];
        var colL = colLetter(c + 1), ref = colL + rowIdx;
        var type = cell.t || 's', val = (cell.v == null ? '' : cell.v);
        var style = (cell.s != null) ? (' s="' + (cell.s | 0) + '"') : '';
        var formula = (cell.f != null) ? cell.f : null;
        if (formula !== null && formula !== '') {
          var f = String(formula).replace(/^=/, '');
          var fXml = '<f>' + xmlEsc(f) + '</f>';
          if (type === 'n') {
            var vXml = (val === '' || val === null || isNaN(parseFloat(val))) ? '' : '<v>' + parseFloat(val) + '</v>';
            xml += '<c r="' + ref + '"' + style + '>' + fXml + vXml + '</c>';
          } else {
            var vXml2 = (val === '' || val === null) ? '' : '<v>' + xmlEsc(String(val)) + '</v>';
            xml += '<c r="' + ref + '" t="str"' + style + '>' + fXml + vXml2 + '</c>';
          }
        } else if (type === 'n') {
          if (val === '' || val === null) xml += '<c r="' + ref + '"' + style + '/>';
          else xml += '<c r="' + ref + '" t="n"' + style + '><v>' + (isNaN(parseFloat(val)) ? 0 : parseFloat(val)) + '</v></c>';
        } else {
          xml += '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + xmlEsc(String(val)) + '</t></is></c>';
        }
      }
      xml += '</row>';
    }
    xml += '</sheetData></worksheet>';
    return xml;
  }

  // ---------- styles.xml (1-op-1 uit klok-stats-xlsx.php) ----------
  var STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="3"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0.0"/></numFmts>'
    + '<fonts count="11">'
    + '<font><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF001E45"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF001E45"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF2E7D32"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFC62828"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFA30C4A"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF1565C0"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF6A2C91"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFF57F17"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF00695C"/><name val="Calibri"/></font>'
    + '</fonts>'
    + '<fills count="19">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF001E45"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF99D3E"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF6A2C91"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF0F2F5"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF6B7A8D"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F5E9"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3E0"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4EC"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFFBE3D6"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFE97132"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFE1F0FA"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF3E5F5"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF9C4"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFE0F2F1"/></patternFill></fill>'
    + '</fills>'
    + '<borders count="2"><border/><border><left style="thin"><color rgb="FFC0C0C0"/></left><right style="thin"><color rgb="FFC0C0C0"/></right><top style="thin"><color rgb="FFC0C0C0"/></top><bottom style="thin"><color rgb="FFC0C0C0"/></bottom></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="34">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
    + '<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1" applyBorder="1"/>'
    + '<xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="4" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="5" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="6" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="2" fillId="10" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="2" fillId="12" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="12" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="2" fillId="11" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="11" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="12" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="5" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="1" fillId="14" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="0" fillId="14" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>'
    + '<xf numFmtId="0" fontId="7" fillId="15" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="8" fillId="16" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="9" fillId="17" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="0" fontId="10" fillId="18" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="7" fillId="15" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="8" fillId="16" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="9" fillId="17" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '<xf numFmtId="164" fontId="10" fillId="18" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>'
    + '</cellXfs>'
    + '</styleSheet>';

  // ---------- workbook ----------
  function build(sheets) {
    var names = Object.keys(sheets), n = names.length, i;
    var files = [];

    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    for (i = 1; i <= n; i++) ct += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    ct += '</Types>';
    files.push({ name: '[Content_Types].xml', data: sb(ct) });

    files.push({ name: '_rels/.rels', data: sb(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>') });

    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    for (i = 0; i < n; i++) wb += '<sheet name="' + xmlEsc(safeSheetName(names[i])) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    wb += '</sheets><calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>';
    files.push({ name: 'xl/workbook.xml', data: sb(wb) });

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    for (i = 1; i <= n; i++) rels += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i + '.xml"/>';
    rels += '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    rels += '</Relationships>';
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: sb(rels) });

    files.push({ name: 'xl/styles.xml', data: sb(STYLES_XML) });

    for (i = 0; i < n; i++) files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sb(buildSheet(sheets[names[i]])) });

    return zipStore(files);
  }

  function toBase64(sheets) {
    var bytes = build(sheets), bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }

  window.QEXlsx = { build: build, toBase64: toBase64, colLetter: colLetter, MIME: MIME };
})();
