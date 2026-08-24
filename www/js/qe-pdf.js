/* =====================================================================
 * QE-PDF (v368) — ontvangstbewijzen als échte PDF, zonder bibliotheek.
 *
 * Waarom zelfgebouwd: de app draait in een WebView zonder buildstap, en een
 * PDF-bibliotheek meebundelen zou de OTA-download flink zwaarder maken. Deze
 * generator gebruikt alleen de 14 standaard-PDF-lettertypes (Helvetica) en
 * vectorlijnen — geen ingebedde afbeeldingen, dus ook geen JPEG/zlib-gedoe.
 * De handtekening wordt als echte lijnen getekend (scherp op elk zoomniveau).
 *
 * Deze code staat IDENTIEK in QE-Software/logistiek.html (de hub is één
 * los bestand). Bij wijzigen: BEIDE bijwerken.
 * ===================================================================== */
(function (root) {
    'use strict';

    /* De verklaring staat hier op EEN plek. Het tekenscherm toont exact deze
     * tekst en de PDF neemt hem woordelijk over — zo kan wat de werknemer
     * las nooit afwijken van wat hij ondertekent. */
    var VERKLARING = [
        'Ondergetekende bevestigt de hierboven vermelde goederen op de vermelde datum in goede staat en volledig te hebben ontvangen van Quality Environment.',
        'Voor de persoonlijke beschermingsmiddelen verklaart ondergetekende de nodige toelichting en gebruiksinstructies te hebben gekregen en begrepen, en deze te dragen zoals voorgeschreven telkens de werkzaamheden dit vereisen.',
        'Ondergetekende meldt beschadiging, slijtage of verlies onmiddellijk aan de werkgever en gebruikt geen beschadigde of onvolledige beschermingsmiddelen. Vervanging wordt kosteloos ter beschikking gesteld.',
        'De goederen blijven eigendom van de werkgever en worden bij uitdiensttreding terugbezorgd.',
    ];

    var A4 = { b: 595.28, h: 841.89 };
    var MARGE = 56;
    var INK = [0.149, 0.200, 0.294];    // #26334B
    var ORANJE = [0.976, 0.616, 0.243]; // #F99D3E
    var GRIJS = [0.42, 0.44, 0.48];
    var LICHT = [0.87, 0.86, 0.83];

    // ---- tekst → WinAnsi-bytes -------------------------------------------
    var WINANSI = { 0x20AC: 0x80, 0x201A: 0x82, 0x201E: 0x84, 0x2026: 0x85,
        0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
        0x2013: 0x96, 0x2014: 0x97 };
    function pdfTekst(s) {
        var uit = '';
        s = String(s == null ? '' : s);
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (WINANSI[c] !== undefined) c = WINANSI[c];
            else if (c > 255) c = 63;   // '?' voor wat WinAnsi niet kent
            var ch = String.fromCharCode(c);
            if (ch === '(' || ch === ')' || ch === '\\') uit += '\\';
            uit += ch;
        }
        return uit;
    }

    // ---- breedte schatten (Helvetica) -------------------------------------
    var SMAL = "iljtfIr'.,;:!|()[]-` ";
    var BREED = 'mwMW@%';
    function tekenBreedte(ch, groot) {
        if (SMAL.indexOf(ch) >= 0) return 0.30;
        if (BREED.indexOf(ch) >= 0) return 0.87;
        if (ch >= 'A' && ch <= 'Z') return groot ? 0.70 : 0.68;
        if (ch >= '0' && ch <= '9') return 0.556;
        return 0.53;
    }
    function breedte(tekst, grootte, vet) {
        var b = 0;
        tekst = String(tekst == null ? '' : tekst);
        for (var i = 0; i < tekst.length; i++) b += tekenBreedte(tekst.charAt(i), vet);
        return b * grootte * (vet ? 1.04 : 1);
    }
    function breek(tekst, grootte, vet, max) {
        var woorden = String(tekst || '').split(/\s+/).filter(Boolean);
        var regels = [], huidig = '';
        for (var i = 0; i < woorden.length; i++) {
            var poging = huidig ? (huidig + ' ' + woorden[i]) : woorden[i];
            if (breedte(poging, grootte, vet) > max && huidig) { regels.push(huidig); huidig = woorden[i]; }
            else huidig = poging;
        }
        if (huidig) regels.push(huidig);
        return regels.length ? regels : [''];
    }

    // ---- tekenaar ---------------------------------------------------------
    function Blad() {
        this.ops = [];
        this.y = A4.h - MARGE;
    }
    Blad.prototype.kleur = function (rgb) {
        this.ops.push(rgb[0].toFixed(3) + ' ' + rgb[1].toFixed(3) + ' ' + rgb[2].toFixed(3) + ' rg');
        return this;
    };
    Blad.prototype.lijnKleur = function (rgb) {
        this.ops.push(rgb[0].toFixed(3) + ' ' + rgb[1].toFixed(3) + ' ' + rgb[2].toFixed(3) + ' RG');
        return this;
    };
    Blad.prototype.tekst = function (s, x, y, grootte, vet, rgb) {
        this.kleur(rgb || INK);
        this.ops.push('BT /' + (vet ? 'F2' : 'F1') + ' ' + grootte + ' Tf ' +
            x.toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + pdfTekst(s) + ') Tj ET');
        return this;
    };
    Blad.prototype.vlak = function (x, y, b, h, rgb) {
        this.kleur(rgb);
        this.ops.push(x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + b.toFixed(2) + ' ' + h.toFixed(2) + ' re f');
        return this;
    };
    Blad.prototype.lijn = function (x1, y1, x2, y2, dikte, rgb) {
        this.lijnKleur(rgb || LICHT);
        this.ops.push((dikte || 0.7).toFixed(2) + ' w ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' m ' +
            x2.toFixed(2) + ' ' + y2.toFixed(2) + ' l S');
        return this;
    };
    /** Alinea met terugloop; geeft de nieuwe y terug. */
    Blad.prototype.alinea = function (s, x, y, grootte, max, vet, rgb, regelhoogte) {
        var regels = breek(s, grootte, vet, max);
        var rh = regelhoogte || (grootte * 1.45);
        for (var i = 0; i < regels.length; i++) this.tekst(regels[i], x, y - i * rh, grootte, vet, rgb);
        return y - (regels.length - 1) * rh;
    };
    /** Handtekening als vectorlijnen (paden in canvas-coördinaten). */
    Blad.prototype.handtekening = function (paden, canvasB, canvasH, x, y, maxB, maxH) {
        if (!paden || !paden.length) return;
        var schaal = Math.min(maxB / (canvasB || 1), maxH / (canvasH || 1));
        this.lijnKleur([0.0, 0.118, 0.271]);
        this.ops.push('1.6 w 1 J 1 j');
        for (var p = 0; p < paden.length; p++) {
            var pad = paden[p];
            if (!pad || pad.length < 2) continue;
            var d = '';
            for (var i = 0; i < pad.length; i++) {
                var px = x + pad[i].x * schaal;
                var py = y + (canvasH - pad[i].y) * schaal;   // PDF-y loopt omhoog
                d += px.toFixed(2) + ' ' + py.toFixed(2) + (i === 0 ? ' m ' : ' l ');
            }
            this.ops.push(d + 'S');
        }
    };

    // ---- PDF-bestand samenstellen -----------------------------------------
    function bouwPdf(blad) {
        var inhoud = blad.ops.join('\n');
        var objecten = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4.b.toFixed(2) + ' ' + A4.h.toFixed(2) +
                '] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
            '<< /Length ' + inhoud.length + ' >>\nstream\n' + inhoud + '\nendstream',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
        ];
        var uit = '%PDF-1.4\n';
        var offsets = [];
        for (var i = 0; i < objecten.length; i++) {
            offsets.push(uit.length);
            uit += (i + 1) + ' 0 obj\n' + objecten[i] + '\nendobj\n';
        }
        var xref = uit.length;
        uit += 'xref\n0 ' + (objecten.length + 1) + '\n0000000000 65535 f \n';
        for (var j = 0; j < offsets.length; j++) {
            uit += ('0000000000' + offsets[j]).slice(-10) + ' 00000 n \n';
        }
        uit += 'trailer\n<< /Size ' + (objecten.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
        // latin1 → bytes
        var bytes = new Uint8Array(uit.length);
        for (var k = 0; k < uit.length; k++) bytes[k] = uit.charCodeAt(k) & 0xFF;
        return bytes;
    }

    // ---- het ontvangstbewijs ----------------------------------------------
    /**
     * @param {Object} g
     *   werknemer      naam van de ontvanger
     *   datum          'YYYY-MM-DD'
     *   tijdstip       leesbaar tijdstip
     *   artikelen      [{ naam, aantal, maat, bedrag, laste }]
     *   ondertekenaar  ingetypte naam
     *   handtekening   { paden, breedte, hoogte }
     *   door           wie het uitgaf (bureel)
     */
    function ontvangstbewijs(g) {
        var b = new Blad();
        var L = MARGE, R = A4.b - MARGE, W = R - L;
        var y = A4.h - MARGE;

        // kop: QE-balk + titel
        b.vlak(L, y - 6, W, 4, ORANJE);
        y -= 34;
        b.tekst('QUALITY ENVIRONMENT', L, y, 9, true, ORANJE);
        y -= 26;
        b.tekst('Ontvangstbewijs', L, y, 22, true, INK);
        y -= 15;
        b.tekst('Levering van werkkledij en persoonlijke beschermingsmiddelen (PBM)', L, y, 9.5, false, GRIJS);
        y -= 12;
        b.tekst('Deuzeldlaan 36, 2900 Schoten', L, y, 8.5, false, GRIJS);

        // gegevensblok
        y -= 26;
        b.lijn(L, y, R, y, 0.7, LICHT);
        y -= 20;
        var rij = function (label, waarde) {
            b.tekst(label.toUpperCase(), L, y, 8, true, GRIJS);
            b.tekst(waarde, L + 150, y, 11, false, INK);
            y -= 20;
        };
        rij('Ontvangen door', g.werknemer || '—');
        rij('Datum', g.datumLang || g.datum || '—');
        if (g.door) rij('Overhandigd door', g.door);

        // artikelen
        y -= 6;
        b.lijn(L, y, R, y, 1.2, INK);
        y -= 15;
        b.tekst('ARTIKEL', L, y, 8, true, GRIJS);
        b.tekst('AANTAL', R - 150, y, 8, true, GRIJS);
        b.tekst('WAARDE', R - 70, y, 8, true, GRIJS);
        y -= 8;
        b.lijn(L, y, R, y, 0.7, LICHT);
        y -= 18;
        var lijst = g.artikelen || [];
        for (var i = 0; i < lijst.length; i++) {
            var a = lijst[i];
            var naam = a.naam + (a.maat ? '  (maat ' + a.maat + ')' : '');
            b.tekst(naam, L, y, 11, false, INK);
            b.tekst(String(a.aantal || 1), R - 150, y, 11, false, INK);
            b.tekst(a.bedrag || '—', R - 70, y, 11, false, INK);
            y -= 10;
            b.lijn(L, y, R, y, 0.5, LICHT);
            y -= 18;
        }

        // verklaring
        y -= 10;
        b.tekst('VERKLARING', L, y, 8, true, GRIJS);
        y -= 18;
        var stukken = VERKLARING;
        for (var s = 0; s < stukken.length; s++) {
            y = b.alinea(stukken[s], L, y, 9.5, W, false, INK, 13);
            y -= 20;
        }

        // vastleggen dat de tekst vóór het tekenen te lezen was
        y = b.alinea('Deze verklaring werd vóór ondertekening integraal op het scherm getoond. ' +
            'Ondergetekende heeft ze gelezen en uitdrukkelijk aanvaard' +
            (g.akkoordTijdstip ? ' op ' + g.akkoordTijdstip : '') + '.',
            L, y, 9.5, W, true, INK, 13);
        y -= 22;

        // handtekeningblok
        y -= 4;
        b.lijn(L, y, R, y, 0.7, LICHT);
        y -= 18;
        b.tekst('HANDTEKENING VOOR ONTVANGST', L, y, 8, true, GRIJS);
        var vakH = 92;
        var vakY = y - 12 - vakH;
        b.lijn(L, vakY, R, vakY, 0.7, LICHT);
        if (g.handtekening && g.handtekening.paden) {
            b.handtekening(g.handtekening.paden, g.handtekening.breedte, g.handtekening.hoogte,
                L + 6, vakY + 8, W - 12, vakH - 14);
        }
        var ny = vakY - 16;
        b.tekst('Naam: ' + (g.ondertekenaar || g.werknemer || ''), L, ny, 10, false, INK);
        b.tekst('Ondertekend op ' + (g.tijdstip || g.datumLang || g.datum || ''), R - 240, ny, 9, false, GRIJS);

        // voet
        b.lijn(L, MARGE + 26, R, MARGE + 26, 0.7, LICHT);
        b.tekst('Quality Environment  ·  Deuzeldlaan 36, 2900 Schoten  ·  Dit document is elektronisch ondertekend via de QE-app.',
            L, MARGE + 12, 7.5, false, GRIJS);
        return bouwPdf(b);
    }

    root.QEPdf = {
        ontvangstbewijs: ontvangstbewijs,
        VERKLARING: VERKLARING,
        _bouwPdf: bouwPdf,
        _Blad: Blad,
        _breek: breek,
        _pdfTekst: pdfTekst,
    };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
