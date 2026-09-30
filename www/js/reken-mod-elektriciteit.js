/* QE Rekenmachine — module Elektriciteit (v408)
 * BRON = QE-Software/reken-mod-elektriciteit.js; kopie in de www via `node sync-reken.js`.
 * Normen: AREI Boek 1 (2020), NBN HD 60364-5-52 (stroombelastbaarheid, tabellen B.52.2–B.52.5,
 * B.52.14/15/17), NBN HD 60364-5-52 bijlage G (spanningsval). Tabelwaarden = koper, 30 °C lucht /
 * 20 °C grond, gemarkeerd als indicatief: de installateur controleert met de norm en de kabelfiche.
 */
(function (root) {
    'use strict';
    var R = root.QEReken;
    if (!R) throw new Error('reken-kern.js eerst laden');
    var SECTIES = R.SECTIES, AUTOMATEN = R.AUTOMATEN;
    var VINK = String.fromCharCode(0x2713);

    // v411 — temperatuurvoelers: weerstand als functie van de temperatuur (°C)
    function rPt(R0, t) { return t >= 0 ? R0 * (1 + 3.9083e-3 * t - 5.775e-7 * t * t) : R0 * (1 + 3.9083e-3 * t - 5.775e-7 * t * t - 4.183e-12 * (t - 100) * t * t * t); }
    function rNiDin(t) { return 1000 * (1 + 5.485e-3 * t + 6.65e-6 * t * t + 2.805e-11 * Math.pow(t, 4) - 2e-17 * Math.pow(t, 6)); }
    function rNiTk5000(t) { return 1000 * (1 + 4.427e-3 * t + 5.172e-6 * t * t + 5.585e-9 * t * t * t); }
    function rNtc(R25, B, t) { return R25 * Math.exp(B * (1 / (t + 273.15) - 1 / 298.15)); }
    // Voeler uit de tabel van de fabrikant: tussen twee punten loopt ln(R) recht tegen 1/T (kelvin).
    // Buiten de tabel loopt de laatste helling door. punten = [[°C, Ω], ...] oplopend in temperatuur.
    function rTabel(punten) {
        var x = punten.map(function (p) { return 1 / (p[0] + 273.15); }), y = punten.map(function (p) { return Math.log(p[1]); });
        return function (t) {
            var xi = 1 / (t + 273.15), i = 0;
            while (i < punten.length - 2 && t > punten[i + 1][0]) i++;
            return Math.exp(y[i] + (y[i + 1] - y[i]) * (xi - x[i]) / (x[i + 1] - x[i]));
        };
    }
    // Tabellen uit de servicehandleidingen (Viessmann Vitotronic 200 WO1C, Honeywell, Siemens QAC32), nagelezen 29 sep 2026
    var NTC10_VI = [[-20, 97070], [-10, 55330], [0, 32650], [10, 19900], [20, 12490], [25, 10000], [30, 8057], [40, 5327], [50, 3603], [60, 2488], [70, 1752], [80, 1258], [100, 680]];
    var NTC20_VI = [[-20, 198442], [-10, 112403], [0, 66048], [10, 40034], [20, 25027], [25, 20000], [30, 16090], [40, 10613], [50, 7166], [60, 4943], [70, 3478], [80, 2492]];
    var NTC20_HW = [[-10, 122380], [0, 70200], [10, 41560], [20, 25340], [25, 20000], [30, 15884], [40, 10210], [50, 6718], [60, 4518], [70, 3100], [80, 2168]];
    var QAC32 = [[-20, 657.34], [-10, 642.38], [0, 623.21], [10, 600.58], [20, 575], [25, 563.5], [30, 551.21]];
    var VOELERS = [
        { v: 'pt1000', t: 'Pt1000 (1.000 Ω bij 0 °C): Danfoss ESM, zonneregelaars', r: function (t) { return rPt(1000, t); }, stijgt: true },
        { v: 'pt100', t: 'Pt100 (100 Ω bij 0 °C)', r: function (t) { return rPt(100, t); }, stijgt: true },
        { v: 'pt500', t: 'Pt500 (500 Ω bij 0 °C): oudere Viessmann ketel- en boilervoeler', r: function (t) { return rPt(500, t); }, stijgt: true },
        { v: 'ni1000', t: 'Ni1000 DIN (6.180 ppm/K)', r: rNiDin, stijgt: true },
        { v: 'ni1000tk', t: 'Ni1000 TK5000 (LG-Ni, Siemens)', r: rNiTk5000, stijgt: true },
        { v: 'ntc10a', t: 'NTC 10 kΩ: Viessmann (blauw), Vaillant VR 11, Honeywell', r: rTabel(NTC10_VI), ntc: true },
        { v: 'ntc20v', t: 'NTC 20 kΩ: Viessmann (oranje), Daikin Altherma', r: rTabel(NTC20_VI), ntc: true },
        { v: 'ntc20h', t: 'NTC 20 kΩ: Honeywell', r: rTabel(NTC20_HW), ntc: true },
        { v: 'vr10', t: 'NTC 2,7 kΩ: Vaillant VR 10', r: function (t) { return rNtc(2692, 4000, t); }, ntc: true },
        { v: 'qac32', t: 'Siemens QAC32 buitenvoeler (575 Ω bij 20 °C)', r: rTabel(QAC32), ntc: true, lo: -30, hi: 35 },
        { v: 'ntc10b', t: 'NTC 10 kΩ, B 3.435 (algemeen)', r: function (t) { return rNtc(10000, 3435, t); }, ntc: true },
        { v: 'ntc10c', t: 'NTC 10 kΩ, B 3.950 (algemeen)', r: function (t) { return rNtc(10000, 3950, t); }, ntc: true },
        { v: 'ntc5', t: 'NTC 5 kΩ, B 3.480 (algemeen)', r: function (t) { return rNtc(5000, 3480, t); }, ntc: true },
        { v: 'eigen', t: 'Eigen NTC (vul R bij 25 °C en B in)', ntc: true }
    ];
    function voelerT(fn, Rohm, stijgt, lo, hi) {       // omgekeerde functie via halveren, standaard tussen −60 en +250 °C
        if (lo == null) lo = -60;
        if (hi == null) hi = 250;
        if ((stijgt && (Rohm < fn(lo) || Rohm > fn(hi))) || (!stijgt && (Rohm > fn(lo) || Rohm < fn(hi)))) return null;
        for (var i = 0; i < 60; i++) { var m = (lo + hi) / 2, r = fn(m); if ((r < Rohm) === !!stijgt) lo = m; else hi = m; }
        return (lo + hi) / 2;
    }
    var SIGNALEN = [{ v: '0-10', t: '0 tot 10 V', a: 0, b: 10, e: 'V' }, { v: '2-10', t: '2 tot 10 V', a: 2, b: 10, e: 'V' }, { v: '4-20', t: '4 tot 20 mA', a: 4, b: 20, e: 'mA' }, { v: '0-20', t: '0 tot 20 mA', a: 0, b: 20, e: 'mA' }, { v: '0-5', t: '0 tot 5 V', a: 0, b: 5, e: 'V' }, { v: '1-5', t: '1 tot 5 V', a: 1, b: 5, e: 'V' }];
    var TRANSFOS = [10, 16, 25, 40, 63, 100, 160, 250, 400, 630];
    var LADERS = [{ v: 2.3, t: '2,3 kW: stopcontact, 10 A enkelfasig' }, { v: 3.7, t: '3,7 kW: 16 A enkelfasig' }, { v: 7.4, t: '7,4 kW: 32 A enkelfasig' }, { v: 11, t: '11 kW: 16 A driefasig' }, { v: 22, t: '22 kW: 32 A driefasig' }];
    function duur(uren) { var min = Math.round(uren * 60), u = Math.floor(min / 60), m = min % 60; return u + ' u ' + (m < 10 ? '0' : '') + m; }

    // Stroombelastbaarheid Iz (A), koper, per plaatsingswijze, index = SECTIES
    var IZ = {
        pvc2: { A1: [14.5, 19.5, 26, 34, 46, 61, 80, 99, 119, 151, 182, 210, 240, 273, 321], A2: [14, 18.5, 25, 32, 43, 57, 75, 92, 110, 139, 167, 192, 219, 248, 291], B1: [17.5, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269, 300, 341, 400], B2: [16.5, 23, 30, 38, 52, 69, 90, 111, 133, 168, 201, 232, 258, 294, 344], C: [19.5, 27, 36, 46, 63, 85, 112, 138, 168, 213, 258, 299, 344, 392, 461], D1: [22, 29, 37, 46, 60, 78, 99, 119, 140, 173, 204, 231, 261, 292, 336], D2: [22, 28, 38, 48, 64, 83, 110, 132, 156, 192, 230, 261, 293, 331, 382] },
        pvc3: { A1: [13.5, 18, 24, 31, 42, 56, 73, 89, 108, 136, 164, 188, 216, 245, 286], A2: [13, 17.5, 23, 29, 39, 52, 68, 83, 99, 125, 150, 172, 196, 223, 261], B1: [15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239, 262, 296, 346], B2: [15, 20, 27, 34, 46, 62, 80, 99, 118, 149, 179, 206, 225, 255, 297], C: [17.5, 24, 32, 41, 57, 76, 96, 119, 144, 184, 223, 259, 299, 341, 403], D1: [18, 24, 30, 38, 50, 64, 82, 98, 116, 143, 169, 192, 217, 243, 280], D2: [19, 24, 33, 41, 54, 70, 92, 110, 130, 162, 193, 220, 246, 278, 320] },
        xlpe2: { A1: [19, 26, 35, 45, 61, 81, 106, 131, 158, 200, 241, 278, 318, 362, 424], A2: [18.5, 25, 33, 42, 57, 76, 99, 121, 145, 183, 220, 253, 290, 329, 386], B1: [23, 31, 42, 54, 75, 100, 133, 164, 198, 253, 306, 354, 393, 449, 528], B2: [22, 30, 40, 51, 69, 91, 119, 146, 175, 221, 265, 305, 334, 384, 459], C: [24, 33, 45, 58, 80, 107, 138, 171, 209, 269, 328, 382, 441, 506, 599], D1: [25, 33, 43, 53, 71, 91, 116, 139, 164, 203, 239, 271, 306, 343, 395], D2: [27, 35, 46, 58, 77, 100, 129, 155, 183, 225, 270, 306, 343, 387, 448] },
        xlpe3: { A1: [17, 23, 31, 40, 54, 73, 95, 117, 141, 179, 216, 249, 285, 324, 380], A2: [16.5, 22, 30, 38, 51, 68, 89, 109, 130, 164, 197, 227, 259, 295, 346], B1: [20, 28, 37, 48, 66, 88, 117, 144, 175, 222, 269, 312, 342, 384, 450], B2: [19.5, 26, 35, 44, 60, 80, 105, 128, 154, 194, 233, 268, 300, 340, 398], C: [22, 30, 40, 52, 71, 96, 119, 147, 179, 229, 278, 322, 371, 424, 500], D1: [21, 28, 36, 44, 58, 75, 96, 115, 135, 167, 197, 223, 251, 281, 324], D2: [23, 30, 39, 49, 65, 84, 107, 129, 153, 188, 226, 257, 287, 324, 375] }
    };
    var METHODES = [
        { v: 'C', t: 'C — kabel op wand of plafond (XVB op de muur, meest gebruikt)' },
        { v: 'B2', t: 'B2 — kabel in buis of goot op de wand' },
        { v: 'B1', t: 'B1 — losse geleiders (VOB) in buis op de wand' },
        { v: 'A2', t: 'A2 — kabel in buis in een geïsoleerde wand' },
        { v: 'A1', t: 'A1 — losse geleiders in buis in een geïsoleerde wand' },
        { v: 'D2', t: 'D2 — kabel rechtstreeks in de grond (EXVB)' },
        { v: 'D1', t: 'D1 — kabel in buis in de grond' }
    ];
    // Correctie omgevingstemperatuur (B.52.14 lucht, B.52.15 grond)
    var KT = {
        lucht: { pvc: [[10, 1.22], [15, 1.17], [20, 1.12], [25, 1.06], [30, 1], [35, 0.94], [40, 0.87], [45, 0.79], [50, 0.71], [55, 0.61], [60, 0.5]], xlpe: [[10, 1.15], [15, 1.12], [20, 1.08], [25, 1.04], [30, 1], [35, 0.96], [40, 0.91], [45, 0.87], [50, 0.82], [55, 0.76], [60, 0.71], [65, 0.65], [70, 0.58], [75, 0.5], [80, 0.41]] },
        grond: { pvc: [[10, 1.1], [15, 1.05], [20, 1], [25, 0.95], [30, 0.89], [35, 0.84], [40, 0.77]], xlpe: [[10, 1.07], [15, 1.04], [20, 1], [25, 0.96], [30, 0.93], [35, 0.89], [40, 0.85]] }
    };
    // Correctie groepering (B.52.17, gebundeld in lucht/op wand/in buis)
    var KG = [[1, 1], [2, 0.8], [3, 0.7], [4, 0.65], [5, 0.6], [6, 0.57], [7, 0.54], [8, 0.52], [9, 0.5], [12, 0.45], [16, 0.41], [20, 0.38]];
    function kTemp(iso, methode, temp) {
        var lijst = KT[/^D/.test(methode) ? 'grond' : 'lucht'][iso];
        return R.interp(temp, lijst.map(function (p) { return p[0]; }), lijst.map(function (p) { return p[1]; }));
    }
    function kGroep(n) { return R.interp(n, KG.map(function (p) { return p[0]; }), KG.map(function (p) { return p[1]; })); }
    var RHO = { koper: 0.0225, aluminium: 0.036 };   // Ω·mm²/m in bedrijf (warm), bijlage G
    var LAMBDA = 0.00008;                            // Ω/m reactantie
    function spanningsval(fasen, I, L, S, cosphi, geleider) {
        var b = fasen === '3f' ? Math.sqrt(3) : 2;
        var sin = Math.sqrt(Math.max(0, 1 - cosphi * cosphi));
        var dU = b * I * L * (RHO[geleider] * cosphi / S + LAMBDA * sin);
        var U0 = fasen === '3f' ? 400 : 230;
        return { dU: dU, pct: dU / U0 * 100, U0: U0 };
    }
    function stroomUit(v, h) {
        // gedeeld: uit P of I de stroom bepalen
        var U = v.net === '3f' ? 400 : v.net === '3f230' ? 230 : v.net === 'dc' ? (v.U || 24) : v.net === 'eigen' ? (v.U || 230) : 230;
        var cos = v.net === 'dc' ? 1 : (v.cosphi || 1);
        var drie = v.net === '3f' || v.net === '3f230';
        if (v.I != null) return { I: v.I, U: U, cos: cos, drie: drie, P: drie ? Math.sqrt(3) * U * v.I * cos / 1000 : U * v.I * cos / 1000, uitI: false };
        if (v.P != null) return { I: drie ? v.P * 1000 / (Math.sqrt(3) * U * cos) : v.P * 1000 / (U * cos), U: U, cos: cos, drie: drie, P: v.P, uitI: true };
        return null;
    }
    var NET_OPTIES = [{ v: '1f', t: '1-fase 230 V' }, { v: '3f', t: '3-fase 400 V (3N)' }, { v: '3f230', t: '3-fase 230 V (oud net, 3 draden)' }, { v: 'dc', t: 'Gelijkstroom (DC)' }, { v: 'eigen', t: 'Andere spanning' }];
    var TOESTELLEN = [{ t: 'Cv-ketel 0,15', v: 0.15 }, { t: 'Circulatiepomp 0,06', v: 0.06 }, { t: 'Boiler 2,2', v: 2.2 }, { t: 'Warmtepomp 3', v: 3 }, { t: 'Airco 1', v: 1 }, { t: 'Oven 3,5', v: 3.5 }, { t: 'Inductie 7,4', v: 7.4 }, { t: 'Laadpaal 7,4', v: 7.4 }, { t: 'Laadpaal 11', v: 11 }, { t: 'Doorstromer 21', v: 21 }];

    R.registreer({
        key: 'elektriciteit', naam: 'Elektriciteit', emoji: '⚡', volgorde: 3,
        omschrijving: 'Ohm, vermogen en stroom, kabelsectie en spanningsval, beveiliging, laadpaal, capaciteitstarief, voelers en stuursignalen',
        groepen: [
            { naam: 'Basis', items: [
                {
                    id: 'elek.ohm', naam: 'Wet van Ohm en vermogen', kort: 'U, I, R en P uit twee gekende waarden',
                    zoek: 'ohm spanning stroom weerstand vermogen volt ampere watt gelijkstroom', soort: 'exact',
                    bron: 'U = I × R · P = U × I · P = I² × R · P = U² / R',
                    uitleg: 'Vul twee waarden in; de andere twee worden berekend. Geldt voor gelijkstroom en voor wisselstroom met zuiver ohmse belasting (cos φ = 1).',
                    velden: [
                        { k: 'U', label: 'Spanning', eh: 'V', ehs: ['V', 'mV', 'kV'], opt: true },
                        { k: 'I', label: 'Stroom', eh: 'A', ehs: ['A', 'mA', 'kA'], opt: true },
                        { k: 'R', label: 'Weerstand', eh: 'Ω', ehs: ['Ω', 'mΩ', 'kΩ', 'MΩ'], opt: true },
                        { k: 'P', label: 'Vermogen', eh: 'W', ehs: ['W', 'kW', 'MW'], opt: true }
                    ],
                    bereken: function (v, h) {
                        var U = v.U, I = v.I, Rr = v.R, P = v.P, st = [];
                        var n = [U, I, Rr, P].filter(function (x) { return x != null; }).length;
                        if (n < 2) return { wacht: true, ontbreekt: ['twee van de vier waarden'] };
                        if (U != null && I != null) { Rr = U / I; P = U * I; st.push('R = U / I = ' + h.f(U) + ' / ' + h.f(I) + ' = ' + h.f(Rr, null, 'Ω'), 'P = U × I = ' + h.f(P, null, 'W')); }
                        else if (U != null && Rr != null) { I = U / Rr; P = U * U / Rr; st.push('I = U / R = ' + h.f(U) + ' / ' + h.f(Rr) + ' = ' + h.f(I, null, 'A'), 'P = U² / R = ' + h.f(P, null, 'W')); }
                        else if (U != null && P != null) { I = P / U; Rr = U * U / P; st.push('I = P / U = ' + h.f(P) + ' / ' + h.f(U) + ' = ' + h.f(I, null, 'A'), 'R = U² / P = ' + h.f(Rr, null, 'Ω')); }
                        else if (I != null && Rr != null) { U = I * Rr; P = I * I * Rr; st.push('U = I × R = ' + h.f(I) + ' × ' + h.f(Rr) + ' = ' + h.f(U, null, 'V'), 'P = I² × R = ' + h.f(P, null, 'W')); }
                        else if (I != null && P != null) { U = P / I; Rr = P / (I * I); st.push('U = P / I = ' + h.f(U, null, 'V'), 'R = P / I² = ' + h.f(Rr, null, 'Ω')); }
                        else { I = Math.sqrt(P / Rr); U = Math.sqrt(P * Rr); st.push('I = √(P / R) = ' + h.f(I, null, 'A'), 'U = √(P × R) = ' + h.f(U, null, 'V')); }
                        return { uit: [h.uit('Spanning U', U, 'V', { hoofd: v.U == null }), h.uit('Stroom I', I, 'A', { hoofd: v.I == null }), h.uit('Weerstand R', Rr, 'Ω', { hoofd: v.R == null }), h.uit('Vermogen P', P, 'W', { hoofd: v.P == null })], stappen: st };
                    }
                },
                {
                    id: 'elek.vermogen_stroom', naam: 'Vermogen ↔ stroom (1-fase / 3-fase)', kort: 'kW naar ampère en omgekeerd, met cos φ',
                    zoek: 'kw ampere stroom vermogen 3 fase driefasig 400 230 cos phi kva ketel warmtepomp airco laadpaal boiler',
                    soort: 'exact', bron: '1-fase: P = U × I × cos φ · 3-fase: P = √3 × U × I × cos φ · S = P / cos φ',
                    uitleg: 'Vul het vermogen óf de stroom in. Bij verwarmingsweerstanden en boilers is cos φ = 1; motoren en pompen ±0,85; LED-drivers 0,9.',
                    velden: [
                        { k: 'net', label: 'Net', type: 'keuze', opties: NET_OPTIES },
                        { k: 'U', label: 'Spanning (alleen bij DC of andere spanning)', eh: 'V', opt: true, std: 230 },
                        { k: 'cosphi', label: 'cos φ', std: 1, min: 0.1, max: 1, snel: [{ t: 'Weerstand 1', v: 1 }, { t: 'LED 0,9', v: 0.9 }, { t: 'Motor 0,85', v: 0.85 }, { t: 'Compressor 0,8', v: 0.8 }] },
                        { k: 'P', label: 'Vermogen', eh: 'kW', ehs: ['kW', 'W', 'pk', 'BTU/h'], opt: true, snel: TOESTELLEN },
                        { k: 'I', label: 'Stroom', eh: 'A', opt: true }
                    ],
                    bereken: function (v, h) {
                        var s = stroomUit(v, h);
                        if (!s) return { wacht: true, ontbreekt: ['vermogen of stroom'] };
                        var S = s.P / s.cos, Q = Math.sqrt(Math.max(0, S * S - s.P * s.P));
                        var In = h.omhoogNaar(s.I, AUTOMATEN);
                        var st = [];
                        if (s.uitI) st.push(s.drie ? 'I = P / (√3 × U × cos φ) = ' + h.f(s.P * 1000) + ' / (1,732 × ' + s.U + ' × ' + h.f(s.cos) + ') = ' + h.f(s.I, 1, 'A') : 'I = P / (U × cos φ) = ' + h.f(s.P * 1000) + ' / (' + s.U + ' × ' + h.f(s.cos) + ') = ' + h.f(s.I, 1, 'A'));
                        else st.push(s.drie ? 'P = √3 × U × I × cos φ = 1,732 × ' + s.U + ' × ' + h.f(s.I) + ' × ' + h.f(s.cos) + ' = ' + h.f(s.P, 2, 'kW') : 'P = U × I × cos φ = ' + s.U + ' × ' + h.f(s.I) + ' × ' + h.f(s.cos) + ' = ' + h.f(s.P, 2, 'kW'));
                        if (s.cos < 1) st.push('S = P / cos φ = ' + h.f(S, 2, 'kVA') + ' · Q = √(S² − P²) = ' + h.f(Q, 2, 'kvar'));
                        return {
                            uit: [h.uit('Stroom I', s.I, 'A', { dec: 1, hoofd: s.uitI }), h.uit('Vermogen P', s.P, 'kW', { dec: 2, hoofd: !s.uitI }), h.uit('Schijnbaar vermogen S', S, 'kVA', { dec: 2 }), h.uit('Blindvermogen Q', Q, 'kvar', { dec: 2 }), h.uit('Automaat (minstens)', In, 'A', { opm: 'controleer de kabel met “Kabelsectie kiezen”' })],
                            stappen: st
                        };
                    }
                },
                {
                    id: 'elek.cosphi', naam: 'cos φ, kVA en compensatie', kort: 'Schijnbaar en blindvermogen, condensator om cos φ te verbeteren',
                    zoek: 'cos phi arbeidsfactor kva kvar blindvermogen compensatie condensator reactief', soort: 'exact',
                    bron: 'S = P / cos φ · Q = P × tan φ · Q_c = P × (tan φ₁ − tan φ₂)',
                    uitleg: 'Netbeheerders rekenen blindenergie aan boven ±50 % van de actieve energie (cos φ < 0,9). Compensatie brengt cos φ naar 0,95 à 0,98.',
                    velden: [
                        { k: 'P', label: 'Actief vermogen', eh: 'kW', ehs: ['kW', 'W'] },
                        { k: 'c1', label: 'Huidige cos φ', std: 0.8, min: 0.1, max: 1 },
                        { k: 'c2', label: 'Gewenste cos φ', std: 0.95, min: 0.1, max: 1 },
                        { k: 'net', label: 'Net', type: 'keuze', opties: [{ v: '3f', t: '3-fase 400 V' }, { v: '1f', t: '1-fase 230 V' }] }
                    ],
                    bereken: function (v, h) {
                        var t1 = Math.tan(Math.acos(v.c1)), t2 = Math.tan(Math.acos(v.c2));
                        var S1 = v.P / v.c1, Q1 = v.P * t1, S2 = v.P / v.c2, Q2 = v.P * t2, Qc = v.P * (t1 - t2);
                        var U = v.net === '3f' ? 400 : 230, k = v.net === '3f' ? Math.sqrt(3) : 1;
                        var I1 = S1 * 1000 / (k * U), I2 = S2 * 1000 / (k * U);
                        return {
                            uit: [h.uit('Condensatorvermogen Q_c', Math.max(0, Qc), 'kvar', { dec: 2, hoofd: true }), h.uit('Nu: S', S1, 'kVA', { dec: 2 }), h.uit('Nu: Q', Q1, 'kvar', { dec: 2 }), h.uit('Nu: stroom', I1, 'A', { dec: 1 }), h.uit('Na compensatie: S', S2, 'kVA', { dec: 2 }), h.uit('Na compensatie: stroom', I2, 'A', { dec: 1 })],
                            stappen: ['tan φ₁ = ' + h.f(t1, 3) + ', tan φ₂ = ' + h.f(t2, 3), 'Q_c = P × (tan φ₁ − tan φ₂) = ' + h.f(v.P) + ' × (' + h.f(t1, 3) + ' − ' + h.f(t2, 3) + ') = ' + h.f(Qc, 2, 'kvar')]
                        };
                    }
                },
                {
                    id: 'elek.geleider', naam: 'Weerstand van een geleider', kort: 'R uit lengte, sectie, materiaal en temperatuur',
                    zoek: 'weerstand geleider koper aluminium lengte sectie soortelijke rho temperatuur kabel', soort: 'exact',
                    bron: 'R = ρ × L / S · ρ(T) = ρ₂₀ × (1 + α × (T − 20)) · ρ₂₀ koper 0,01786, aluminium 0,02857 Ω·mm²/m',
                    velden: [
                        { k: 'mat', label: 'Materiaal', type: 'keuze', opties: [{ v: 'koper', t: 'Koper' }, { v: 'aluminium', t: 'Aluminium' }] },
                        { k: 'L', label: 'Lengte geleider', eh: 'm', ehs: ['m', 'km'], hint: 'heen én terug apart optellen, of vink “heen en terug” aan' },
                        { k: 'heenterug', label: 'Heen en terug (lengte × 2)', type: 'vink', std: true },
                        { k: 'S', label: 'Sectie', eh: 'mm²', std: 2.5, snel: SECTIES.slice(0, 8).map(function (s) { return { t: R.fmt(s), v: s }; }) },
                        { k: 'T', label: 'Geleidertemperatuur', eh: '°C', std: 20, snel: [{ t: '20', v: 20 }, { t: '70 (PVC vol belast)', v: 70 }, { t: '90 (XLPE)', v: 90 }] },
                        { k: 'I', label: 'Stroom (optioneel, voor de spanningsval)', eh: 'A', opt: true }
                    ],
                    bereken: function (v, h) {
                        var rho20 = v.mat === 'koper' ? 0.01786 : 0.02857, alpha = v.mat === 'koper' ? 0.00393 : 0.00403;
                        var rho = rho20 * (1 + alpha * (v.T - 20)), L = v.L * (v.heenterug ? 2 : 1);
                        var Rr = rho * L / v.S;
                        var uit = [h.uit('Weerstand R', Rr, 'Ω', { dec: 4, hoofd: true }), h.uit('ρ bij ' + h.f(v.T) + ' °C', rho, 'Ω·mm²/m', { dec: 5 }), h.uit('Geleiderlengte in rekening', L, 'm')];
                        var st = ['ρ = ' + h.f(rho20, 5) + ' × (1 + ' + h.fmt(alpha, 5) + ' × (' + h.f(v.T) + ' − 20)) = ' + h.f(rho, 5), 'R = ρ × L / S = ' + h.f(rho, 5) + ' × ' + h.f(L) + ' / ' + h.f(v.S) + ' = ' + h.f(Rr, 4, 'Ω')];
                        if (v.I != null) { uit.push(h.uit('Spanningsval bij ' + h.f(v.I) + ' A', Rr * v.I, 'V', { dec: 2 }), h.uit('Verlies in de geleider', Rr * v.I * v.I, 'W', { dec: 1 })); st.push('ΔU = R × I = ' + h.f(Rr * v.I, 2, 'V')); }
                        return { uit: uit, stappen: st };
                    }
                },
                {
                    id: 'elek.serieparallel', naam: 'Weerstanden in serie en parallel', kort: 'Vervangingsweerstand van een lijst',
                    zoek: 'serie parallel weerstanden vervangingsweerstand', soort: 'exact',
                    bron: 'Serie: R = R₁ + R₂ + … · Parallel: 1/R = 1/R₁ + 1/R₂ + …',
                    velden: [{ k: 'lijst', label: 'Weerstanden (Ω), gescheiden door komma of spatie', type: 'tekst', std: '10 22 47', hint: 'bv. 10 22 47' }],
                    bereken: function (v, h) {
                        var ws = String(v.lijst).split(/[\s;]+/).map(function (x) { return h.getal(x); }).filter(function (x) { return x != null && x > 0; });
                        if (ws.length < 2) return { wacht: true, ontbreekt: ['minstens twee weerstanden'] };
                        var serie = ws.reduce(function (a, b) { return a + b; }, 0), par = 1 / ws.reduce(function (a, b) { return a + 1 / b; }, 0);
                        return { uit: [h.uit('In serie', serie, 'Ω', { hoofd: true }), h.uit('Parallel', par, 'Ω', { hoofd: true })], stappen: ['Serie: ' + ws.map(function (x) { return h.f(x); }).join(' + ') + ' = ' + h.f(serie, null, 'Ω'), 'Parallel: 1 / (' + ws.map(function (x) { return '1/' + h.f(x); }).join(' + ') + ') = ' + h.f(par, null, 'Ω')] };
                    }
                }
            ] },
            { naam: 'Kabels en beveiliging', items: [
                {
                    id: 'elek.kabel', naam: 'Kabelsectie kiezen', kort: 'Sectie op stroombelasting én spanningsval, met de automaat erbij',
                    zoek: 'kabel sectie doorsnede mm2 xvb evxb kabeldikte stroombelastbaarheid spanningsval automaat zekering 2,5 6 10 16', soort: 'indicatief',
                    bron: 'NBN HD 60364-5-52 tabellen B.52.2–B.52.5 (Iz koper, 30 °C lucht / 20 °C grond), B.52.14/15 (temperatuur), B.52.17 (groepering), bijlage G (spanningsval); AREI Boek 1',
                    uitleg: 'Werkwijze: bedrijfsstroom I_b → automaat I_n ≥ I_b → sectie met I_z × correcties ≥ I_n → controle spanningsval (AREI: 3 % verlichting, 5 % andere). Aluminium: minimum 16 mm², waarden ≈ 0,78 × koper. Richtwaarden: controleer altijd met de norm en de fiche van de kabel.',
                    velden: [
                        { k: 'net', label: 'Net', type: 'keuze', opties: [{ v: '1f', t: '1-fase 230 V' }, { v: '3f', t: '3-fase 400 V' }] },
                        { k: 'P', label: 'Vermogen', eh: 'kW', ehs: ['kW', 'W'], opt: true, snel: TOESTELLEN },
                        { k: 'I', label: 'of stroom I_b', eh: 'A', opt: true },
                        { k: 'cosphi', label: 'cos φ', std: 1, min: 0.1, max: 1, snel: [{ t: '1', v: 1 }, { t: '0,9', v: 0.9 }, { t: '0,85', v: 0.85 }] },
                        { k: 'L', label: 'Kabellengte (enkele richting)', eh: 'm' },
                        { k: 'geleider', label: 'Geleider', type: 'keuze', opties: [{ v: 'koper', t: 'Koper' }, { v: 'aluminium', t: 'Aluminium (≥ 16 mm²)' }] },
                        { k: 'iso', label: 'Isolatie', type: 'keuze', opties: [{ v: 'pvc', t: 'PVC 70 °C (XVB, VOB, EXVB)' }, { v: 'xlpe', t: 'XLPE 90 °C (EXAVB, XGB…)' }] },
                        { k: 'methode', label: 'Plaatsingswijze', type: 'keuze', opties: METHODES },
                        { k: 'temp', label: 'Omgevingstemperatuur (lucht 30 °C, grond 20 °C)', eh: '°C', std: 30, snel: [{ t: '20', v: 20 }, { t: '30', v: 30 }, { t: '40', v: 40 }, { t: '50 (zolder)', v: 50 }] },
                        { k: 'groep', label: 'Aantal belaste kringen samen gebundeld', std: 1, min: 1, max: 20, snel: [{ t: '1', v: 1 }, { t: '2', v: 2 }, { t: '3', v: 3 }, { t: '4', v: 4 }, { t: '6', v: 6 }] },
                        { k: 'maxdu', label: 'Toegelaten spanningsval', type: 'keuze', opties: [{ v: 5, t: '5 % (andere verbruikers)' }, { v: 3, t: '3 % (verlichting)' }, { v: 2, t: '2 % (streng, lange leidingen)' }] }
                    ],
                    bereken: function (v, h) {
                        var s = stroomUit({ net: v.net, P: v.P, I: v.I, cosphi: v.cosphi }, h);
                        if (!s) return { wacht: true, ontbreekt: ['vermogen of stroom'] };
                        var Ib = s.I, drie = v.net === '3f';
                        var tabel = IZ[v.iso + (drie ? '3' : '2')][v.methode];
                        var kt = kTemp(v.iso, v.methode, v.temp), kg = kGroep(v.groep), k = kt * kg;
                        var kAl = v.geleider === 'aluminium' ? 0.78 : 1;
                        var In = h.omhoogNaar(Ib, AUTOMATEN);
                        if (In == null) return { fout: 'Stroom te groot voor deze tabel (max 400 A)' };
                        var maxdu = Number(v.maxdu);
                        var rijen = [], Sstroom = null, Sdu = null, keus = null;
                        for (var i = 0; i < SECTIES.length; i++) {
                            var S = SECTIES[i];
                            if (v.geleider === 'aluminium' && S < 16) continue;
                            var Iz = tabel[i] * kAl, Izk = Iz * k;
                            var du = spanningsval(v.net, Ib, v.L, S, s.cos, v.geleider);
                            var okI = Izk >= In, okU = du.pct <= maxdu;
                            if (okI && Sstroom == null) Sstroom = S;
                            if (okU && Sdu == null) Sdu = S;
                            if (okI && okU && keus == null) keus = { S: S, Iz: Iz, Izk: Izk, du: du };
                            rijen.push([h.fmt(S) + ' mm²', h.fmt(Iz, 0), h.fmt(Izk, 0), h.fmt(du.dU, 1) + ' V (' + h.fmt(du.pct, 1) + ' %)', okI && okU ? '✓' : okI ? 'ΔU te groot' : 'te zwak']);
                        }
                        if (!keus) return { fout: 'Geen sectie tot 240 mm² voldoet — verdeel de belasting of verkort de leiding', tabel: { kop: ['Sectie', 'I_z tabel', 'I_z × k', 'ΔU', ''], rijen: rijen } };
                        var waarsch = [];
                        if (Sdu > Sstroom) waarsch.push('De spanningsval bepaalt de sectie (op stroom volstond ' + h.fmt(Sstroom) + ' mm²).');
                        if (k < 0.9) waarsch.push('Correctiefactor ' + h.fmt(k, 2) + ' (temperatuur ' + h.fmt(kt, 2) + ' × groepering ' + h.fmt(kg, 2) + ') weegt zwaar: koeler plaatsen of kringen spreiden bespaart koper.');
                        if (In > Ib * 1.5 && Ib >= 6) waarsch.push('De automaat (' + In + ' A) ligt ver boven de bedrijfsstroom (' + h.fmt(Ib, 1) + ' A); dat mag, maar de kabel moet op de automaat gedimensioneerd zijn (gedaan).');
                        return {
                            uit: [
                                h.uit('Sectie', keus.S, 'mm² ' + (v.geleider === 'aluminium' ? 'Al' : 'Cu'), { hoofd: true }),
                                h.uit('Automaat I_n', In, 'A', { hoofd: true, opm: 'I_n ≥ I_b = ' + h.fmt(Ib, 1) + ' A' }),
                                h.uit('Bedrijfsstroom I_b', Ib, 'A', { dec: 1 }),
                                h.uit('I_z tabel (30 °C, 1 kring)', keus.Iz, 'A', { dec: 0 }),
                                h.uit('I_z na correctie (k = ' + h.fmt(k, 2) + ')', keus.Izk, 'A', { dec: 0 }),
                                h.uit('Spanningsval bij ' + h.fmt(keus.S) + ' mm²', keus.du.dU, 'V', { dec: 1, opm: h.fmt(keus.du.pct, 2) + ' % van ' + keus.du.U0 + ' V (max ' + maxdu + ' %)' }),
                                h.uit('Aanbevolen kabel', (drie ? (keus.S <= 6 ? '5G' : '4×') : '3G') + h.fmt(keus.S) + (v.geleider === 'aluminium' ? ' Al' : ''), '', { opm: 'G = met groen-gele aarding' })
                            ],
                            stappen: [
                                'I_b = ' + h.f(Ib, 1, 'A') + ' → automaat I_n = ' + In + ' A (eerstvolgende standaardwaarde)',
                                'Correctie: k = k_temp (' + h.fmt(kt, 2) + ') × k_groep (' + h.fmt(kg, 2) + ') = ' + h.fmt(k, 2),
                                'Kleinste sectie met I_z × k ≥ I_n: ' + h.fmt(Sstroom) + ' mm²',
                                'Spanningsval: ΔU = ' + (drie ? '√3' : '2') + ' × I × L × (ρ × cos φ / S + λ × sin φ), ρ = ' + h.fmt(RHO[v.geleider], 4) + ' Ω·mm²/m, λ = 0,08 mΩ/m → kleinste sectie ≤ ' + maxdu + ' %: ' + h.fmt(Sdu) + ' mm²',
                                'Gekozen: de grootste van beide = ' + h.fmt(keus.S) + ' mm²'
                            ],
                            waarsch: waarsch,
                            tabel: { kop: ['Sectie', 'I_z tabel', 'I_z × k', 'ΔU', ''], rijen: rijen }
                        };
                    }
                },
                {
                    id: 'elek.spanningsval', naam: 'Spanningsval', kort: 'ΔU over een kabel en de maximale lengte',
                    zoek: 'spanningsval kabellengte maximale lengte delta u procent 3% 5%', soort: 'exact',
                    bron: 'ΔU = b × I × L × (ρ × cos φ / S + λ × sin φ), b = 2 (1-fase) of √3 (3-fase); ρ koper 0,0225 / aluminium 0,036 Ω·mm²/m; λ 0,08 mΩ/m — NBN HD 60364-5-52 bijlage G; AREI: 3 % verlichting, 5 % andere',
                    velden: [
                        { k: 'net', label: 'Net', type: 'keuze', opties: [{ v: '1f', t: '1-fase 230 V' }, { v: '3f', t: '3-fase 400 V' }] },
                        { k: 'I', label: 'Stroom', eh: 'A' },
                        { k: 'L', label: 'Kabellengte (enkele richting)', eh: 'm' },
                        { k: 'S', label: 'Sectie', type: 'keuze', opties: SECTIES.map(function (s) { return { v: s, t: R.fmt(s) + ' mm²' }; }), std: 2.5 },
                        { k: 'cosphi', label: 'cos φ', std: 1, min: 0.1, max: 1 },
                        { k: 'geleider', label: 'Geleider', type: 'keuze', opties: [{ v: 'koper', t: 'Koper' }, { v: 'aluminium', t: 'Aluminium' }] }
                    ],
                    bereken: function (v, h) {
                        var S = Number(v.S), du = spanningsval(v.net, v.I, v.L, S, v.cosphi, v.geleider);
                        var per = du.dU / v.L;
                        var L3 = du.U0 * 0.03 / per, L5 = du.U0 * 0.05 / per;
                        return {
                            uit: [h.uit('Spanningsval ΔU', du.dU, 'V', { dec: 2, hoofd: true }), h.uit('Procentueel', du.pct, '%', { dec: 2, hoofd: true, kleur: du.pct > 5 ? 'rood' : du.pct > 3 ? 'amber' : 'groen' }), h.uit('Spanning aan de verbruiker', du.U0 - du.dU, 'V', { dec: 1 }), h.uit('Max. lengte voor 3 %', L3, 'm', { dec: 0 }), h.uit('Max. lengte voor 5 %', L5, 'm', { dec: 0 })],
                            stappen: ['ΔU = ' + (v.net === '3f' ? '√3' : '2') + ' × ' + h.f(v.I) + ' × ' + h.f(v.L) + ' × (' + h.fmt(RHO[v.geleider], 4) + ' × ' + h.f(v.cosphi) + ' / ' + h.fmt(S) + ' + 0,00008 × ' + h.fmt(Math.sqrt(1 - v.cosphi * v.cosphi), 2) + ') = ' + h.f(du.dU, 2, 'V'), 'Procent = ΔU / ' + du.U0 + ' V = ' + h.f(du.pct, 2, '%')],
                            waarsch: du.pct > 5 ? ['Boven 5 %: zwaardere sectie of kortere leiding nodig.'] : du.pct > 3 ? ['Boven 3 %: niet geschikt voor een verlichtingskring.'] : []
                        };
                    }
                },
                {
                    id: 'elek.beveiliging', naam: 'Automaat en differentieel kiezen', kort: 'Curve, kaliber en 30 / 300 mA per soort kring',
                    zoek: 'automaat differentieel verliesstroomschakelaar 30 ma 300 ma curve b c d kaliber zekering kring badkamer wasmachine laadpaal', soort: 'indicatief',
                    bron: 'AREI Boek 1 (2020) — hoofddifferentieel ≤ 300 mA type A; 30 mA voor badkamer, wasmachine, droogkast, vaatwasser, elektrische vloerverwarming, buitenstopcontacten, zwembad; laadpalen 30 mA type A + 6 mA DC-detectie of type B',
                    uitleg: 'Curve B schakelt bij 3–5 × I_n (verlichting, verwarming, stopcontacten), curve C bij 5–10 × I_n (motoren, pompen, warmtepompen, airco), curve D bij 10–20 × I_n (transformatoren, grote inschakelstromen).',
                    velden: [
                        { k: 'kring', label: 'Soort kring', type: 'keuze', opties: [{ v: 'verl', t: 'Verlichting' }, { v: 'stop', t: 'Stopcontacten' }, { v: 'kook', t: 'Kookvuur / oven' }, { v: 'was', t: 'Wasmachine, droogkast, vaatwasser' }, { v: 'boiler', t: 'Boiler' }, { v: 'verw', t: 'Elektrische verwarming / vloerverwarming' }, { v: 'wp', t: 'Warmtepomp / airco / compressor' }, { v: 'pomp', t: 'Pomp of motor' }, { v: 'laad', t: 'Laadpaal' }, { v: 'buiten', t: 'Buiten / tuin / zwembad' }, { v: 'bad', t: 'Badkamer' }] },
                        { k: 'I', label: 'Bedrijfsstroom I_b', eh: 'A', opt: true, hint: 'leeg = standaardkaliber van die kring' }
                    ],
                    bereken: function (v, h) {
                        var K = {
                            verl: { In: 16, S: 1.5, curve: 'B', diff: '300 mA (hoofd) volstaat; 30 mA in badkamer', opm: 'max. 8 lichtpunten per kring' },
                            stop: { In: 20, S: 2.5, curve: 'B', diff: '300 mA; 30 mA in badkamer, buiten en bij kinderen/nat', opm: 'max. 8 stopcontacten per kring (AREI)' },
                            kook: { In: 32, S: 6, curve: 'B', diff: '300 mA', opm: 'eigen kring; 40 A met 10 mm² bij zware inductie' },
                            was: { In: 20, S: 2.5, curve: 'B', diff: '30 mA verplicht', opm: 'één kring per toestel' },
                            boiler: { In: 20, S: 2.5, curve: 'B', diff: '30 mA in badkamer, anders 300 mA', opm: 'eigen kring' },
                            verw: { In: 20, S: 2.5, curve: 'B', diff: '30 mA (vloerverwarming verplicht)', opm: 'max. 3.680 W per 16 A-kring, 4.600 W per 20 A' },
                            wp: { In: 20, S: 2.5, curve: 'C', diff: '30 mA type A (buitenunit)', opm: 'aanloopstroom: curve C; kaliber volgens fabrikant' },
                            pomp: { In: 16, S: 2.5, curve: 'C', diff: '30 mA bij vocht/buiten', opm: 'aanloopstroom 5–8 × I_n' },
                            laad: { In: 32, S: 6, curve: 'B', diff: '30 mA type A + 6 mA DC-detectie (of type B)', opm: '1-fase 7,4 kW = 32 A / 6 mm²; 3-fase 11 kW = 16 A / 2,5 mm²; eigen kring' },
                            buiten: { In: 16, S: 2.5, curve: 'B', diff: '30 mA verplicht', opm: 'IP44 of hoger' },
                            bad: { In: 16, S: 2.5, curve: 'B', diff: '30 mA verplicht', opm: 'volumes 0/1/2 respecteren, equipotentiaal' }
                        }[v.kring];
                        var In = v.I != null ? h.omhoogNaar(v.I, AUTOMATEN) : K.In;
                        var S = v.I != null ? (In <= 16 ? 1.5 : In <= 20 ? 2.5 : In <= 25 ? 4 : In <= 40 ? 6 : In <= 63 ? 10 : 16) : K.S;
                        var waarsch = [];
                        if (v.I != null && In > K.In) waarsch.push('Kaliber ' + In + ' A ligt boven de gebruikelijke ' + K.In + ' A voor deze kring: controleer de kabelsectie met “Kabelsectie kiezen”.');
                        return {
                            uit: [h.uit('Automaat', In + ' A, curve ' + K.curve, '', { hoofd: true }), h.uit('Sectie (kort, koper, op wand)', S, 'mm²', { opm: 'richtwaarde; lange leiding → spanningsval nakijken' }), h.uit('Differentieel', K.diff, '', { hoofd: true }), h.uit('Opmerking', K.opm, '')],
                            waarsch: waarsch
                        };
                    }
                },
                {
                    id: 'elek.aarding', naam: 'Aardingsweerstand en aanraakspanning', kort: 'Is de aarding goed genoeg voor de differentieel?',
                    zoek: 'aarding aardingsweerstand ohm aanraakspanning aardlek differentieel 30 ohm 100 ohm', soort: 'exact',
                    bron: 'U_aanraking = R_aarde × IΔn; grens 50 V (25 V nat) · AREI: R_aarde ≤ 30 Ω; tussen 30 en 100 Ω alleen als álle kringen op 30 mA staan',
                    velden: [
                        { k: 'Ra', label: 'Gemeten aardingsweerstand', eh: 'Ω' },
                        { k: 'idn', label: 'Differentieel IΔn', type: 'keuze', opties: [{ v: 300, t: '300 mA' }, { v: 30, t: '30 mA' }, { v: 100, t: '100 mA' }, { v: 500, t: '500 mA' }], std: 300 },
                        { k: 'nat', label: 'Natte of vochtige omgeving (grens 25 V)', type: 'vink', std: false }
                    ],
                    bereken: function (v, h) {
                        var idn = Number(v.idn) / 1000, Ut = v.Ra * idn, grens = v.nat ? 25 : 50, Rmax = grens / idn;
                        var waarsch = [];
                        if (v.Ra > 100) waarsch.push('Meer dan 100 Ω: aarding verbeteren (langere pin, extra pin, aardingslus).');
                        else if (v.Ra > 30) waarsch.push('Tussen 30 en 100 Ω: AREI laat dit enkel toe als alle kringen door een 30 mA-differentieel beveiligd zijn.');
                        if (Ut > grens) waarsch.push('Aanraakspanning ' + h.fmt(Ut, 1) + ' V boven de grens van ' + grens + ' V: gevaarlijk.');
                        return {
                            uit: [h.uit('Aanraakspanning', Ut, 'V', { dec: 1, hoofd: true, kleur: Ut > grens ? 'rood' : 'groen' }), h.uit('Maximale R voor ' + grens + ' V', Rmax, 'Ω', { dec: 0 }), h.uit('AREI-beoordeling', v.Ra <= 30 ? 'in orde (≤ 30 Ω)' : v.Ra <= 100 ? 'enkel met 30 mA op alle kringen' : 'onvoldoende', '', { kleur: v.Ra <= 30 ? 'groen' : v.Ra <= 100 ? 'amber' : 'rood' })],
                            stappen: ['U = R × IΔn = ' + h.f(v.Ra) + ' × ' + h.f(idn, 3) + ' = ' + h.f(Ut, 1, 'V')],
                            waarsch: waarsch
                        };
                    }
                },
                {
                    id: 'elek.aansluiting', naam: 'Aansluitvermogen van de teller', kort: 'kVA uit de hoofdautomaat; wat kan er op?',
                    zoek: 'aansluitvermogen teller kva fluvius verzwaring 40a 25a 63a mono driefasig netbeheerder', soort: 'exact',
                    bron: '1-fase: S = 230 × I · 3-fase 400 V: S = √3 × 400 × I · 3 × 230 V: S = √3 × 230 × I — standaard Fluvius: 1 × 40 A (9,2 kVA) of 3 × 25 A 400 V (17,3 kVA)',
                    velden: [
                        { k: 'type', label: 'Aansluiting', type: 'keuze', opties: [{ v: '1f', t: '1-fase 230 V' }, { v: '3f', t: '3-fase 400 V + N' }, { v: '3f230', t: '3-fase 230 V (3 draden)' }] },
                        { k: 'I', label: 'Hoofdautomaat', eh: 'A', std: 40, snel: [{ t: '25', v: 25 }, { t: '32', v: 32 }, { t: '40', v: 40 }, { t: '50', v: 50 }, { t: '63', v: 63 }, { t: '80', v: 80 }] },
                        { k: 'Pnodig', label: 'Gewenst gelijktijdig vermogen (optioneel)', eh: 'kW', opt: true, hint: 'bv. warmtepomp 3 + laadpaal 7,4 + huishouden 4' }
                    ],
                    bereken: function (v, h) {
                        var U = v.type === '3f' ? 400 : 230, k = v.type === '1f' ? 1 : Math.sqrt(3);
                        var S = k * U * v.I / 1000;
                        var uit = [h.uit('Aansluitvermogen', S, 'kVA', { dec: 1, hoofd: true }), h.uit('≈ vermogen bij cos φ 1', S, 'kW', { dec: 1 })];
                        var waarsch = [];
                        if (v.Pnodig != null) {
                            var Inodig = v.Pnodig * 1000 / (k * U);
                            uit.push(h.uit('Nodige stroom voor ' + h.fmt(v.Pnodig, 1) + ' kW', Inodig, 'A', { dec: 1, kleur: Inodig > v.I ? 'rood' : 'groen' }));
                            if (Inodig > v.I) waarsch.push('Te zwaar voor deze aansluiting: verzwaring bij Fluvius aanvragen (of lastbeheer op laadpaal/warmtepomp).');
                        }
                        return { uit: uit, stappen: ['S = ' + (k === 1 ? '' : '√3 × ') + U + ' V × ' + h.f(v.I) + ' A = ' + h.f(S, 1, 'kVA')], waarsch: waarsch };
                    }
                },
                {
                    id: 'elek.kringen', naam: 'Standaardkringen in een woning', kort: 'Naslag: sectie, automaat en differentieel per kring (AREI)',
                    zoek: 'naslag kringen woning arei verlichting stopcontacten kookvuur wasmachine hoofdschakelaar tabel', soort: 'naslag',
                    bron: 'AREI Boek 1 (2020), gebruikelijke praktijk in België — richtwaarden, controleer de actuele tekst',
                    velden: [],
                    bereken: function (v, h) {
                        return {
                            tabel: {
                                kop: ['Kring', 'Kabel en beveiliging', 'Opmerking'],
                                rijen: [
                                    ['Verlichting', '3G1,5 mm² · 16 A B · 300 mA', 'max. 8 lichtpunten per kring'],
                                    ['Stopcontacten', '3G2,5 mm² · 20 A B · 300 mA (30 mA nat/buiten)', 'max. 8 enkelvoudige stopcontacten'],
                                    ['Kookvuur of inductie', '3G6 mm² · 32 A B (40 A + 10 mm² zwaar) · 300 mA', 'eigen kring, aansluitdoos'],
                                    ['Oven', '3G2,5 mm² · 20 A B · 300 mA', 'eigen kring'],
                                    ['Wasmachine', '3G2,5 mm² · 20 A B · 30 mA', 'eigen kring'],
                                    ['Droogkast', '3G2,5 mm² · 20 A B · 30 mA', 'eigen kring'],
                                    ['Vaatwasser', '3G2,5 mm² · 20 A B · 30 mA', 'eigen kring'],
                                    ['Boiler', '3G2,5 mm² · 20 A B · 30 mA in badkamer', 'eigen kring'],
                                    ['Badkamer (stopcontact, verlichting)', '3G2,5 / 3G1,5 · 20 / 16 A B · 30 mA', 'volumes en equipotentiaal'],
                                    ['Vloerverwarming (elektrisch)', '3G2,5 mm² · 16–20 A B · 30 mA', 'max. 3.680 W per 16 A'],
                                    ['Warmtepomp (buitenunit)', 'volgens fabrikant · C-curve · 30 mA type A', 'eigen kring'],
                                    ['Airco split', '3G2,5 mm² · 16–20 A C · 30 mA', 'eigen kring'],
                                    ['Laadpaal 1-fase 7,4 kW', '3G6 mm² · 32 A B · 30 mA A + 6 mA DC', 'eigen kring'],
                                    ['Laadpaal 3-fase 11 kW', '5G2,5 mm² · 16 A B · 30 mA A + 6 mA DC', 'eigen kring; 22 kW = 32 A / 5G6'],
                                    ['Stopcontact buiten of in de tuin', '3G2,5 mm² · 16–20 A B · 30 mA', 'IP44'],
                                    ['Hoofdschakelaar', '2P 40/63 A of 4P · 300 mA type A (hoofd)', 'teller → bord 10 mm² (40 A) / 16 mm² (63 A)']
                                ]
                            },
                            opm: 'Sectie geldt voor korte leidingen; bij lange leidingen bepaalt de spanningsval de sectie (zie “Kabelsectie kiezen”).'
                        };
                    }
                },
                {
                    id: 'elek.kortsluit', naam: 'Kortsluitstroom en grootste kabellengte', kort: 'Schakelt de automaat nog af bij een kortsluiting aan het einde van de kabel?',
                    zoek: 'kortsluitstroom kortsluiting maximale kabellengte automaat magnetische uitschakeling curve b c d lange kabel tuinhuis laadpaal ik', soort: 'indicatief',
                    bron: 'Conventionele methode: I_k,min = 0,8 × U × S / (ρ × 2 × L) met ρ koper 0,0225 en aluminium 0,036 Ω·mm²/m · de automaat schakelt magnetisch af vanaf 5 × I_n (curve B), 10 × I_n (curve C) of 20 × I_n (curve D)',
                    uitleg: 'Bij een lange, dunne kabel wordt de kortsluitstroom zo klein dat de automaat niet meer onmiddellijk afschakelt. De factor 0,8 rekent de weerstand van het net vóór het bord mee. Beide geleiders hebben dezelfde sectie.',
                    velden: [
                        { k: 'U', label: 'Spanning tussen de twee geleiders', eh: 'V', std: 230, min: 1 },
                        { k: 'S', label: 'Sectie', type: 'keuze', opties: SECTIES.slice(0, 11).map(function (s) { return { v: s, t: R.fmt(s, 1) + ' mm²' }; }), std: 2.5 },
                        { k: 'L', label: 'Kabellengte (enkele richting)', eh: 'm', std: 30, min: 0.1 },
                        { k: 'In', label: 'Automaat', type: 'keuze', opties: AUTOMATEN.slice(0, 12).map(function (a) { return { v: a, t: a + ' A' }; }), std: 16 },
                        { k: 'curve', label: 'Curve', type: 'keuze', opties: [{ v: 5, t: 'B (schakelt af vanaf 5 × In)' }, { v: 10, t: 'C (vanaf 10 × In)' }, { v: 20, t: 'D (vanaf 20 × In)' }], std: 10 },
                        { k: 'geleider', label: 'Geleider', type: 'keuze', opties: [{ v: 'koper', t: 'Koper' }, { v: 'alu', t: 'Aluminium' }], std: 'koper' }
                    ],
                    bereken: function (v, h) {
                        var rho = v.geleider === 'alu' ? 0.036 : 0.0225, S = Number(v.S), In = Number(v.In), Im = Number(v.curve) * In;
                        var Ik = 0.8 * v.U * S / (rho * 2 * v.L), Lmax = 0.8 * v.U * S / (rho * 2 * Im), ok = Ik >= Im;
                        var rijen = SECTIES.slice(0, 11).map(function (s) { var ik = 0.8 * v.U * s / (rho * 2 * v.L), lm = 0.8 * v.U * s / (rho * 2 * Im); return [h.fmt(s, 1) + ' mm²', h.fmt(ik, 0) + ' A', h.fmt(lm, 0) + ' m', ik >= Im ? VINK : 'te lang']; });
                        var waarsch = [];
                        if (!ok) waarsch.push('De kortsluitstroom (' + h.fmt(Ik, 0) + ' A) blijft onder de afschakelstroom van de automaat (' + h.fmt(Im, 0) + ' A). Kies een dikkere kabel, een curve B of een kleinere automaat.');
                        return {
                            uit: [h.uit('Kortsluitstroom aan het einde', Ik, 'A', { dec: 0, hoofd: true, kleur: ok ? 'groen' : 'rood' }), h.uit('Grootste kabellengte', Lmax, 'm', { dec: 0, hoofd: true }), h.uit('Afschakelstroom van de automaat', Im, 'A', { dec: 0, opm: h.fmt(Number(v.curve), 0) + ' × ' + In + ' A' })],
                            stappen: ['I_k = 0,8 × ' + h.f(v.U, 0) + ' × ' + h.fmt(S, 1) + ' / (' + h.fmt(rho, 4) + ' × 2 × ' + h.f(v.L, 1) + ') = ' + h.f(Ik, 0, 'A'), 'L_max = 0,8 × ' + h.f(v.U, 0) + ' × ' + h.fmt(S, 1) + ' / (' + h.fmt(rho, 4) + ' × 2 × ' + h.fmt(Im, 0) + ') = ' + h.f(Lmax, 0, 'm')],
                            tabel: { kop: ['Sectie', 'Kortsluitstroom', 'Grootste lengte', ''], rijen: rijen, kies: SECTIES.slice(0, 11).indexOf(S) }, waarsch: waarsch,
                            opm: 'Controleer daarnaast altijd de spanningsval en de stroombelastbaarheid (“Kabelsectie kiezen”). De bescherming tegen aanraking loopt in een woning via de differentieelschakelaar.'
                        };
                    }
                },
                {
                    id: 'elek.netten', naam: 'Net 3 × 230 V of 3N 400 V', kort: 'Naslag: welk net heb je en wat kan je erop aansluiten?',
                    zoek: 'net 3x230 3n400 driefasig zonder nul nulgeleider ster driehoek laadpaal warmtepomp aansluiten tweepolige automaat fluvius naslag', soort: 'naslag',
                    bron: 'AREI Boek 1 en de technische voorschriften van de netbeheerder (Synergrid C1/107). Samenvatting: controleer altijd het net ter plaatse.',
                    velden: [],
                    bereken: function () {
                        return {
                            tabel: { kop: ['', '3N 400 V (met nul)', '3 × 230 V (zonder nul)'], rijen: [
                                ['Spanning tussen twee fasen', '400 V', '230 V'],
                                ['Spanning tussen fase en nul', '230 V', 'er is geen nul'],
                                ['Herkennen', '4 geleiders op de teller, blauwe nulgeleider', '3 geleiders op de teller, geen blauwe geleider'],
                                ['Enkelfasig toestel (230 V)', 'tussen één fase en de nul', 'tussen twee fasen'],
                                ['Automaten', 'fase en nul samen onderbreken', 'tweepolig: beide geleiders staan onder spanning'],
                                ['Driefasig toestel van 400 V', 'rechtstreeks', 'niet rechtstreeks: versie voor 3 × 230 V of een transformator'],
                                ['Warmtepomp', 'enkelfasig of 3 × 400 V', 'enkelfasig, of een toestel dat de fabrikant voor 3 × 230 V levert'],
                                ['Laadpaal', '3,7 of 7,4 kW enkelfasig, 11 of 22 kW driefasig', 'enkelfasig tussen twee fasen (tot 7,4 kW); driefasig enkel met paal en auto die 3 × 230 V aankunnen'],
                                ['Stroom voor 11 kW driefasig', '16 A per fase', '28 A per fase']
                            ] },
                            opm: 'In oudere wijken ligt vaak nog een net van 3 × 230 V. De netbeheerder bouwt die netten geleidelijk om naar 3N 400 V. Vraag bij twijfel het nettype op bij Fluvius voor je een warmtepomp of laadpaal bestelt.'
                        };
                    }
                },
                {
                    id: 'elek.ip', naam: 'IP-klassen', kort: 'Naslag: bescherming tegen stof en water',
                    zoek: 'ip klasse ip44 ip54 ip65 ip67 beschermingsgraad stof water spatwater badkamer buiten naslag', soort: 'naslag',
                    bron: 'EN 60529. Het eerste cijfer geldt voor vaste deeltjes en aanraking, het tweede voor water. Een X betekent: niet getest.',
                    velden: [],
                    bereken: function () {
                        return {
                            tabel: { kop: ['Eerste cijfer', 'Bescherming tegen vaste deeltjes'], rijen: [['0', 'geen'], ['1', 'voorwerpen groter dan 50 mm (hand)'], ['2', 'groter dan 12,5 mm (vinger)'], ['3', 'groter dan 2,5 mm (gereedschap)'], ['4', 'groter dan 1 mm (draad)'], ['5', 'stof dringt beperkt binnen, zonder schade'], ['6', 'stofdicht']] },
                            tabel2: { kop: ['Tweede cijfer', 'Bescherming tegen water'], rijen: [['0', 'geen'], ['1', 'druppels die loodrecht vallen'], ['2', 'druppels bij een helling tot 15°'], ['3', 'sproeiwater tot 60° van de verticale'], ['4', 'spatwater uit alle richtingen'], ['5', 'waterstralen'], ['6', 'krachtige waterstralen'], ['7', 'tijdelijke onderdompeling (1 m, 30 minuten)'], ['8', 'blijvende onderdompeling volgens de fabrikant']] },
                            opm: 'Veel gebruikt: IP20 in een droge ruimte, IP44 tegen spatwater (badkamer buiten de douche, buiten onder een afdak), IP55 of IP65 buiten en in natte ruimtes, IP67 of IP68 onder water. Een buitenunit of een pomp buiten heeft minstens IPX4 nodig.'
                        };
                    }
                }
            ] },
            { naam: 'Toestellen', items: [
                {
                    id: 'elek.motor', naam: 'Motor: nominale stroom en aanloopstroom', kort: 'Uit het asvermogen, rendement en cos φ',
                    zoek: 'motor pomp compressor nominale stroom aanloopstroom startstroom rendement kw pk softstarter frequentieregelaar', soort: 'exact',
                    bron: 'I_n = P_as / (η × cos φ × U) (1-fase) of / (√3 × U × η × cos φ) (3-fase) · I_aanloop = k × I_n (direct 6–8, ster-driehoek ±2,5, softstarter 3, frequentieregelaar 1,2)',
                    velden: [
                        { k: 'P', label: 'Asvermogen', eh: 'kW', ehs: ['kW', 'W', 'pk'] },
                        { k: 'net', label: 'Net', type: 'keuze', opties: [{ v: '3f', t: '3-fase 400 V' }, { v: '1f', t: '1-fase 230 V' }] },
                        { k: 'eta', label: 'Rendement η', std: 0.85, min: 0.1, max: 1, snel: [{ t: 'klein 0,75', v: 0.75 }, { t: '0,85', v: 0.85 }, { t: 'IE3 0,92', v: 0.92 }] },
                        { k: 'cosphi', label: 'cos φ', std: 0.85, min: 0.1, max: 1 },
                        { k: 'k', label: 'Aanloopfactor', std: 6, min: 1, max: 12, snel: [{ t: 'Direct 6', v: 6 }, { t: 'Direct zwaar 8', v: 8 }, { t: 'Ster-driehoek 2,5', v: 2.5 }, { t: 'Softstarter 3', v: 3 }, { t: 'Frequentieregelaar 1,2', v: 1.2 }] }
                    ],
                    bereken: function (v, h) {
                        var U = v.net === '3f' ? 400 : 230, kk = v.net === '3f' ? Math.sqrt(3) : 1;
                        var Pin = v.P / v.eta, In = Pin * 1000 / (kk * U * v.cosphi), Ia = In * v.k;
                        var auto = h.omhoogNaar(In * 1.1, AUTOMATEN);
                        return {
                            uit: [h.uit('Nominale stroom I_n', In, 'A', { dec: 1, hoofd: true }), h.uit('Aanloopstroom', Ia, 'A', { dec: 0, hoofd: true }), h.uit('Opgenomen vermogen', Pin, 'kW', { dec: 2 }), h.uit('Schijnbaar vermogen', Pin / v.cosphi, 'kVA', { dec: 2 }), h.uit('Automaat (richtwaarde)', auto + ' A, curve ' + (v.k >= 5 ? 'C of D' : 'C'), '', { opm: 'motorbeveiligingsschakelaar instellen op I_n' })],
                            stappen: ['P_opgenomen = P_as / η = ' + h.f(v.P, 2) + ' / ' + h.f(v.eta) + ' = ' + h.f(Pin, 2, 'kW'), 'I_n = P / (' + (kk === 1 ? '' : '√3 × ') + U + ' × cos φ) = ' + h.f(In, 1, 'A'), 'I_aanloop = ' + h.f(v.k) + ' × I_n = ' + h.f(Ia, 0, 'A')]
                        };
                    }
                },
                {
                    id: 'elek.verwarming', naam: 'Elektrische verwarming (vloer of convector)', kort: 'Vermogen per ruimte, stroom, kringen en automaat',
                    zoek: 'elektrische vloerverwarming verwarmingsmat convector radiator elektrisch watt per m2 kring thermostaat', soort: 'indicatief',
                    bron: 'P = oppervlakte × vermogen/m² · I = P / 230 V · max 3.680 W per 16 A-kring (thermostaat 16 A) — AREI: 30 mA voor vloerverwarming',
                    velden: [
                        { k: 'A', label: 'Verwarmde oppervlakte', eh: 'm²' },
                        { k: 'q', label: 'Vermogen per m²', eh: 'W/m²', std: 150, snel: [{ t: 'Badkamer comfort 150', v: 150 }, { t: 'Bijverwarming 100', v: 100 }, { t: 'Hoofdverwarming goed geïsoleerd 80', v: 80 }, { t: 'Matig geïsoleerd 120', v: 120 }, { t: 'Terras/oprit ijsvrij 300', v: 300 }] },
                        { k: 'kring', label: 'Kring', type: 'keuze', opties: [{ v: 16, t: '16 A (3.680 W)' }, { v: 20, t: '20 A (4.600 W)' }], std: 16 },
                        { k: 'prijs', label: 'Stroomprijs', eh: '€/kWh', std: 0.35 },
                        { k: 'uren', label: 'Uren per dag in bedrijf', eh: 'h', std: 3 }
                    ],
                    bereken: function (v, h) {
                        var P = v.A * v.q, I = P / 230, In = Number(v.kring), Pkring = In * 230;
                        var kringen = Math.ceil(P / Pkring), kost = P / 1000 * v.uren * v.prijs;
                        return {
                            uit: [h.uit('Totaal vermogen', P, 'W', { dec: 0, hoofd: true }), h.uit('Stroom (1-fase)', I, 'A', { dec: 1 }), h.uit('Aantal kringen van ' + In + ' A', kringen, '', { hoofd: kringen > 1, opm: kringen > 1 ? 'verdeel de matten/thermostaten over ' + kringen + ' kringen' : 'past op één kring' }), h.uit('Kabel per kring', In === 16 ? '3G1,5 of 3G2,5 mm²' : '3G2,5 mm²', ''), h.uit('Differentieel', '30 mA', ''), h.uit('Kost per dag (' + h.fmt(v.uren) + ' h vol vermogen)', kost, '€', { dec: 2 })],
                            stappen: ['P = ' + h.f(v.A) + ' m² × ' + h.f(v.q) + ' W/m² = ' + h.f(P, 0, 'W'), 'I = P / 230 = ' + h.f(I, 1, 'A'), 'Kringen = ⌈' + h.f(P, 0) + ' / ' + Pkring + '⌉ = ' + kringen]
                        };
                    }
                },
                {
                    id: 'elek.boiler', naam: 'Elektrische boiler: opwarmtijd en verbruik', kort: 'Hoe lang duurt het opwarmen, wat kost het?',
                    zoek: 'boiler elektrisch opwarmtijd opwarmen liter kwh nachttarief weerstand', soort: 'exact',
                    bron: 'E = V × 1,163 Wh/(l·K) × ΔT / η · t = E / P',
                    velden: [
                        { k: 'V', label: 'Inhoud', eh: 'l', std: 150, snel: [{ t: '80', v: 80 }, { t: '100', v: 100 }, { t: '150', v: 150 }, { t: '200', v: 200 }, { t: '300', v: 300 }] },
                        { k: 'Tin', label: 'Koudwatertemperatuur', eh: '°C', std: 10 },
                        { k: 'Tuit', label: 'Boilertemperatuur', eh: '°C', std: 60 },
                        { k: 'P', label: 'Vermogen weerstand', eh: 'kW', ehs: ['kW', 'W'], std: 2.2, snel: [{ t: '1,2', v: 1.2 }, { t: '1,5', v: 1.5 }, { t: '2,0', v: 2 }, { t: '2,2', v: 2.2 }, { t: '3,0', v: 3 }] },
                        { k: 'eta', label: 'Rendement', std: 0.95, min: 0.3, max: 1 },
                        { k: 'prijs', label: 'Stroomprijs', eh: '€/kWh', std: 0.35 }
                    ],
                    bereken: function (v, h) {
                        var dT = v.Tuit - v.Tin;
                        if (dT <= 0) return { fout: 'Boilertemperatuur moet hoger zijn dan de koudwatertemperatuur' };
                        var E = v.V * 1.163 * dT / 1000 / v.eta, t = E / v.P, I = v.P * 1000 / 230;
                        var uur = Math.floor(t), min = Math.round((t - uur) * 60);
                        return {
                            uit: [h.uit('Opwarmtijd', uur + ' u ' + (min < 10 ? '0' : '') + min + ' min', '', { hoofd: true }), h.uit('Energie per opwarming', E, 'kWh', { dec: 2 }), h.uit('Kost per opwarming', E * v.prijs, '€', { dec: 2 }), h.uit('Stroom (1-fase)', I, 'A', { dec: 1 }), h.uit('Automaat', h.omhoogNaar(I, AUTOMATEN) + ' A', '', { opm: 'eigen kring' })],
                            stappen: ['E = ' + h.f(v.V) + ' l × 1,163 Wh × ' + h.f(dT) + ' K / ' + h.f(v.eta) + ' = ' + h.f(E, 2, 'kWh'), 't = E / P = ' + h.f(E, 2) + ' / ' + h.f(v.P) + ' = ' + h.f(t, 2, 'h')]
                        };
                    }
                },
                {
                    id: 'elek.verlichting', naam: 'Verlichting: lux, lumen en aantal armaturen', kort: 'Hoeveel armaturen voor een gewenste lichtsterkte?',
                    zoek: 'verlichting lux lumen armaturen led aantal lampen lichtsterkte werkvlak', soort: 'indicatief',
                    bron: 'n = E × A / (Φ × η_ruimte × behoudsfactor) — richtwaarden EN 12464-1 (werkvlak 500 lux, verkeerszone 100 lux)',
                    velden: [
                        { k: 'A', label: 'Oppervlakte', eh: 'm²' },
                        { k: 'E', label: 'Gewenste verlichtingssterkte', eh: 'lux', std: 300, snel: [{ t: 'Gang 100', v: 100 }, { t: 'Woonkamer 200', v: 200 }, { t: 'Keuken 300', v: 300 }, { t: 'Werkvlak/bureau 500', v: 500 }, { t: 'Atelier 500', v: 500 }, { t: 'Magazijn 150', v: 150 }, { t: 'Stookplaats 200', v: 200 }] },
                        { k: 'lm', label: 'Lichtstroom per armatuur', eh: 'lm', std: 3600, snel: [{ t: 'LED-spot 500', v: 500 }, { t: 'LED-lamp 800', v: 800 }, { t: 'LED-buis 150 cm 2.400', v: 2400 }, { t: 'LED-paneel 60×60 3.600', v: 3600 }, { t: 'LED-balk 150 cm 5.000', v: 5000 }] },
                        { k: 'eta', label: 'Ruimterendement', std: 0.6, min: 0.1, max: 1, snel: [{ t: 'Donker/hoog 0,5', v: 0.5 }, { t: 'Gemiddeld 0,6', v: 0.6 }, { t: 'Licht/laag 0,75', v: 0.75 }] },
                        { k: 'mf', label: 'Behoudsfactor (vervuiling, veroudering)', std: 0.8, min: 0.3, max: 1 },
                        { k: 'lmw', label: 'Rendement armatuur', eh: 'lm/W', std: 110 }
                    ],
                    bereken: function (v, h) {
                        var n = v.E * v.A / (v.lm * v.eta * v.mf), nn = Math.ceil(n - 1e-9);
                        var Ewerk = nn * v.lm * v.eta * v.mf / v.A, P = nn * v.lm / v.lmw;
                        return {
                            uit: [h.uit('Aantal armaturen', nn, '', { hoofd: true }), h.uit('Werkelijke verlichtingssterkte', Ewerk, 'lux', { dec: 0 }), h.uit('Totale lichtstroom', nn * v.lm, 'lm', { dec: 0 }), h.uit('Opgenomen vermogen (±)', P, 'W', { dec: 0 }), h.uit('Per m²', P / v.A, 'W/m²', { dec: 1 })],
                            stappen: ['n = E × A / (Φ × η × MF) = ' + h.f(v.E) + ' × ' + h.f(v.A) + ' / (' + h.f(v.lm) + ' × ' + h.f(v.eta) + ' × ' + h.f(v.mf) + ') = ' + h.f(n, 2) + ' → ' + nn]
                        };
                    }
                },
                {
                    id: 'elek.laadpaal', naam: 'Laadpaal: laadtijd en kost', kort: 'Hoe lang duurt het laden en wat kost het?',
                    zoek: 'laadpaal laden elektrische auto laadtijd kwh batterij 11 kw 7,4 kw 22 kw laadvermogen kost kilometer wallbox', soort: 'exact',
                    bron: 'Energie = batterij × (tot − van) · uit het net = energie / (1 − laadverlies) · tijd = energie uit het net / laadvermogen · de boordlader van de auto begrenst het vermogen bij wisselstroom',
                    velden: [
                        { k: 'bat', label: 'Batterij van de auto', eh: 'kWh', std: 60, min: 1, snel: [{ t: '40', v: 40 }, { t: '60', v: 60 }, { t: '77', v: 77 }, { t: '100', v: 100 }] },
                        { k: 'van', label: 'Laden van', eh: '%', std: 20, min: 0, max: 100 },
                        { k: 'tot', label: 'tot', eh: '%', std: 80, min: 0, max: 100 },
                        { k: 'P', label: 'Laadvermogen', type: 'keuze', opties: LADERS, std: 11 },
                        { k: 'verlies', label: 'Laadverlies', eh: '%', std: 10, min: 0, max: 40 },
                        { k: 'verbruik', label: 'Verbruik van de auto', eh: 'kWh/100 km', std: 18, min: 5 },
                        { k: 'prijs', label: 'Stroomprijs', eh: '€/kWh', std: 0.35, min: 0 }
                    ],
                    bereken: function (v, h) {
                        if (v.tot <= v.van) return { fout: 'Het eindpercentage moet hoger zijn dan het beginpercentage' };
                        var P = Number(v.P), E = v.bat * (v.tot - v.van) / 100, net = E / (1 - v.verlies / 100), t = net / P, km = E / v.verbruik * 100;
                        var rijen = LADERS.map(function (l) { return [h.fmt(l.v, 1) + ' kW', duur(net / l.v), h.fmt(l.v * (1 - v.verlies / 100) / v.verbruik * 100, 0) + ' km per uur']; });
                        return {
                            uit: [h.uit('Laadtijd', duur(t), '', { hoofd: true }), h.uit('Kost', net * v.prijs, '€', { dec: 2, hoofd: true }), h.uit('In de batterij', E, 'kWh', { dec: 1 }), h.uit('Uit het net', net, 'kWh', { dec: 1 }), h.uit('Bijgeladen rijbereik', km, 'km', { dec: 0 }), h.uit('Kost per 100 km', v.verbruik / (1 - v.verlies / 100) * v.prijs, '€', { dec: 2 })],
                            stappen: ['E = ' + h.f(v.bat, 0) + ' kWh × (' + h.f(v.tot, 0) + ' − ' + h.f(v.van, 0) + ') % = ' + h.f(E, 1, 'kWh'), 'Uit het net = ' + h.fmt(E, 1) + ' / (1 − ' + h.f(v.verlies, 0) + ' %) = ' + h.f(net, 1, 'kWh'), 'Tijd = ' + h.fmt(net, 1) + ' / ' + h.fmt(P, 1) + ' = ' + h.f(t, 2, 'uur')],
                            tabel: { kop: ['Laadvermogen', 'Laadtijd', 'Rijbereik'], rijen: rijen, kies: LADERS.map(function (l) { return l.v; }).indexOf(P) },
                            opm: 'Veel auto’s laden op wisselstroom hoogstens 7,4 of 11 kW, ook aan een paal van 22 kW. Boven 80 % laadt de auto trager. Een laadpaal weegt zwaar op het capaciteitstarief: laad traag of slim gestuurd.'
                        };
                    }
                },
                {
                    id: 'elek.transfo', naam: 'Transformator 24 V voor regeling', kort: 'Hoeveel VA voor stelmotoren, kleppen en thermostaten, en de spanningsval in de kabel',
                    zoek: 'transformator transfo 24 v va stelmotor zoneklep thermostaat regeling vloerverwarming voeding spanningsval dunne kabel', soort: 'exact',
                    bron: 'Som van de vermogens + reserve → eerstvolgende transformator · I = S / U · spanningsval ΔU = 2 × L × I × 0,0225 / sectie',
                    uitleg: 'Thermische stelmotoren trekken bij het inschakelen kort een veel hogere stroom (tot 0,3 A per stuk): kies de transformator daarom ruim.',
                    velden: [
                        { k: 'rijen', label: 'Verbruikers', type: 'rijen', kolommen: [{ k: 'soort', label: 'Verbruiker', type: 'keuze', opties: [{ v: 2, t: 'Thermische stelmotor (2 VA)' }, { v: 6, t: 'Zoneklep met motor (6 VA)' }, { v: 3, t: 'Thermostaat of regelaar (3 VA)' }, { v: 5, t: 'Klepaandrijving 0-10 V (5 VA)' }, { v: 10, t: 'Magneetventiel of relais (10 VA)' }, { v: 1, t: 'Andere (1 VA per stuk)' }] }, { k: 'n', label: 'Aantal', type: 'getal' }], std: [{ soort: 2, n: 8 }, { soort: 3, n: 4 }] },
                        { k: 'U', label: 'Secundaire spanning', type: 'keuze', opties: [{ v: 24, t: '24 V' }, { v: 12, t: '12 V' }, { v: 230, t: '230 V' }], std: 24 },
                        { k: 'res', label: 'Reserve', eh: '%', std: 30, min: 0 },
                        { k: 'L', label: 'Kabellengte naar de verste verbruiker', eh: 'm', std: 15, min: 0 },
                        { k: 'S', label: 'Sectie van de kabel', type: 'keuze', opties: [{ v: 0.5, t: '0,5 mm²' }, { v: 0.75, t: '0,75 mm²' }, { v: 0.8, t: '0,8 mm (0,5 mm²) signaalkabel' }, { v: 1, t: '1 mm²' }, { v: 1.5, t: '1,5 mm²' }, { v: 2.5, t: '2,5 mm²' }], std: 0.75 }
                    ],
                    bereken: function (v, h) {
                        var som = 0, rijen = [];
                        v.rijen.forEach(function (r) { if (!r.n || !r.soort) return; var va = Number(r.soort) * r.n; som += va; rijen.push([h.fmt(r.n, 0) + ' × ' + h.fmt(Number(r.soort), 0) + ' VA', h.fmt(va, 0) + ' VA']); });
                        if (!(som > 0)) return { wacht: true, ontbreekt: ['minstens één verbruiker'] };
                        var U = Number(v.U), nodig = som * (1 + v.res / 100), tr = h.omhoogNaar(nodig, TRANSFOS), I = som / U;
                        var S = Number(v.S) === 0.8 ? 0.5 : Number(v.S), dU = 2 * v.L * I * 0.0225 / S, pct = dU / U * 100;
                        var waarsch = [];
                        if (pct > 10) waarsch.push('De spanningsval is ' + h.fmt(pct, 0) + ' %: de verste verbruiker krijgt te weinig spanning. Neem een dikkere kabel of zet de transformator dichterbij.');
                        return {
                            uit: [h.uit('Transformator', tr ? tr + ' VA' : 'groter dan 630 VA', '', { hoofd: true, opm: 'nodig ' + h.fmt(nodig, 0) + ' VA met reserve' }), h.uit('Som van de verbruikers', som, 'VA', { dec: 0 }), h.uit('Stroom secundair', I, 'A', { dec: 2, hoofd: true }), h.uit('Stroom primair (230 V)', som / 230, 'A', { dec: 3 }), h.uit('Spanningsval in de kabel', dU, 'V', { dec: 2, kleur: pct > 10 ? 'rood' : pct > 5 ? 'amber' : 'groen', opm: h.fmt(pct, 1) + ' % van ' + U + ' V' })],
                            stappen: ['Som = ' + h.f(som, 0, 'VA') + ', met ' + h.f(v.res, 0) + ' % reserve = ' + h.f(nodig, 0, 'VA'), 'I = ' + h.fmt(som, 0) + ' / ' + U + ' = ' + h.f(I, 2, 'A'), 'ΔU = 2 × ' + h.f(v.L, 1) + ' × ' + h.fmt(I, 2) + ' × 0,0225 / ' + h.fmt(S, 2) + ' = ' + h.f(dU, 2, 'V')],
                            tabel: { kop: ['Verbruiker', 'Vermogen'], rijen: rijen }, waarsch: waarsch
                        };
                    }
                }
            ] },
            { naam: 'Verbruik en opwekking', items: [
                {
                    id: 'elek.verbruik', naam: 'Verbruik en kost', kort: 'kWh en euro per dag, maand en jaar',
                    zoek: 'verbruik kost kwh euro jaar stand-by sluipverbruik stroomprijs', soort: 'exact',
                    bron: 'E = P × t · kost = E × prijs',
                    velden: [
                        { k: 'P', label: 'Vermogen', eh: 'W', ehs: ['W', 'kW'], snel: [{ t: 'Stand-by 5 W', v: 5 }, { t: 'Circulatiepomp 45 W', v: 45 }, { t: 'Koelkast 100 W', v: 100 }, { t: 'Warmtepomp 2.500 W', v: 2500 }] },
                        { k: 'uren', label: 'Uren per dag', eh: 'h', std: 24, min: 0, max: 24 },
                        { k: 'dagen', label: 'Dagen per jaar', std: 365, min: 1, max: 366 },
                        { k: 'prijs', label: 'Stroomprijs', eh: '€/kWh', std: 0.35 }
                    ],
                    bereken: function (v, h) {
                        var dag = v.P / 1000 * v.uren, jaar = dag * v.dagen;
                        return { uit: [h.uit('Per jaar', jaar, 'kWh', { dec: 0, hoofd: true }), h.uit('Kost per jaar', jaar * v.prijs, '€', { dec: 0, hoofd: true }), h.uit('Per dag', dag, 'kWh', { dec: 2 }), h.uit('Per maand', jaar / 12, 'kWh', { dec: 0 }), h.uit('Kost per maand', jaar / 12 * v.prijs, '€', { dec: 2 })], stappen: ['E_dag = ' + h.f(v.P) + ' W × ' + h.f(v.uren) + ' h = ' + h.f(dag, 2, 'kWh'), 'E_jaar = ' + h.f(dag, 2) + ' × ' + h.f(v.dagen) + ' = ' + h.f(jaar, 0, 'kWh')] };
                    }
                },
                {
                    id: 'elek.batterij', naam: 'Batterij en UPS: autonomie', kort: 'Hoe lang houdt een batterij een belasting vol?',
                    zoek: 'batterij accu ups autonomie ah wh thuisbatterij ontlading omvormer noodstroom', soort: 'exact',
                    bron: 't = C × U × DoD × η / P · nodige capaciteit = P × t / (U × DoD × η)',
                    velden: [
                        { k: 'C', label: 'Capaciteit', eh: 'Ah', std: 100 },
                        { k: 'U', label: 'Batterijspanning', eh: 'V', std: 48, snel: [{ t: '12', v: 12 }, { t: '24', v: 24 }, { t: '48', v: 48 }] },
                        { k: 'P', label: 'Belasting', eh: 'W', ehs: ['W', 'kW'], std: 500 },
                        { k: 'dod', label: 'Toegelaten ontlading (DoD)', std: 0.8, min: 0.1, max: 1, snel: [{ t: 'Lood 0,5', v: 0.5 }, { t: 'Lithium 0,8', v: 0.8 }, { t: 'LiFePO₄ 0,9', v: 0.9 }] },
                        { k: 'eta', label: 'Rendement omvormer', std: 0.9, min: 0.5, max: 1 },
                        { k: 'tw', label: 'Gewenste autonomie (optioneel)', eh: 'h', opt: true }
                    ],
                    bereken: function (v, h) {
                        var E = v.C * v.U / 1000, t = E * v.dod * v.eta / (v.P / 1000);
                        var uit = [h.uit('Autonomie', t, 'h', { dec: 1, hoofd: true }), h.uit('Energie-inhoud', E, 'kWh', { dec: 2 }), h.uit('Bruikbaar', E * v.dod, 'kWh', { dec: 2 })];
                        var st = ['E = ' + h.f(v.C) + ' Ah × ' + h.f(v.U) + ' V = ' + h.f(E, 2, 'kWh'), 't = E × DoD × η / P = ' + h.f(t, 1, 'h')];
                        if (v.tw != null) { var Cn = v.P / 1000 * v.tw / (v.U / 1000 * v.dod * v.eta); uit.push(h.uit('Nodige capaciteit voor ' + h.fmt(v.tw) + ' h', Cn, 'Ah', { dec: 0, hoofd: true })); st.push('C_nodig = P × t / (U × DoD × η) = ' + h.f(Cn, 0, 'Ah')); }
                        return { uit: uit, stappen: st };
                    }
                },
                {
                    id: 'elek.pv', naam: 'Zonnepanelen: opbrengst en omvormer', kort: 'kWh per jaar, omvormerstroom en dakoppervlak',
                    zoek: 'zonnepanelen pv fotovoltaisch wp kwp opbrengst omvormer orientatie helling dak', soort: 'indicatief',
                    bron: 'België: ±950 kWh per kWp per jaar op een zuidgericht dak van 30–40°; oriëntatie- en hellingsfactoren indicatief',
                    velden: [
                        { k: 'n', label: 'Aantal panelen', std: 10, min: 1 },
                        { k: 'wp', label: 'Vermogen per paneel', eh: 'Wp', std: 430 },
                        { k: 'orient', label: 'Oriëntatie', type: 'keuze', opties: [{ v: 1, t: 'Zuid' }, { v: 0.95, t: 'Zuidoost / zuidwest' }, { v: 0.85, t: 'Oost / west' }, { v: 0.75, t: 'Noordoost / noordwest' }, { v: 0.6, t: 'Noord' }], std: 1 },
                        { k: 'hell', label: 'Helling', type: 'keuze', opties: [{ v: 1, t: '30–40°' }, { v: 0.97, t: '20–30° of 40–50°' }, { v: 0.9, t: 'Plat (0–15°)' }, { v: 0.85, t: 'Steil (60°)' }, { v: 0.7, t: 'Verticaal (gevel)' }], std: 1 },
                        { k: 'zelf', label: 'Zelfverbruik', eh: '%', std: 35, min: 0, max: 100 },
                        { k: 'prijs', label: 'Stroomprijs', eh: '€/kWh', std: 0.35 },
                        { k: 'inj', label: 'Injectievergoeding', eh: '€/kWh', std: 0.04 }
                    ],
                    bereken: function (v, h) {
                        var kwp = v.n * v.wp / 1000, f = Number(v.orient) * Number(v.hell), kwh = kwp * 950 * f;
                        var eigen = kwh * v.zelf / 100, inj = kwh - eigen, opbrengst = eigen * v.prijs + inj * v.inj;
                        var Iac1 = kwp * 1000 / 230, Iac3 = kwp * 1000 / (Math.sqrt(3) * 400);
                        return {
                            uit: [h.uit('Piekvermogen', kwp, 'kWp', { dec: 2 }), h.uit('Opbrengst per jaar', kwh, 'kWh', { dec: 0, hoofd: true }), h.uit('Waarde per jaar', opbrengst, '€', { dec: 0, hoofd: true }), h.uit('Omvormerstroom 1-fase / 3-fase', h.fmt(Iac1, 1) + ' A / ' + h.fmt(Iac3, 1) + ' A', ''), h.uit('Dakoppervlak (±2 m² per paneel)', v.n * 2, 'm²'), h.uit('Vermeden CO₂ (0,17 kg/kWh)', kwh * 0.17 / 1000, 'ton', { dec: 1 })],
                            stappen: ['kWp = ' + v.n + ' × ' + h.f(v.wp) + ' / 1000 = ' + h.f(kwp, 2), 'E = kWp × 950 × ' + h.fmt(f, 2) + ' = ' + h.f(kwh, 0, 'kWh')],
                            waarsch: kwp > 10 ? ['Boven 10 kVA is een 3-fasige aansluiting en een netstudie bij Fluvius nodig.'] : []
                        };
                    }
                },
                {
                    id: 'elek.capaciteit', naam: 'Capaciteitstarief', kort: 'Wat kost een hogere piek door een laadpaal, warmtepomp of doorstromer?',
                    zoek: 'capaciteitstarief piek maandpiek kwartiervermogen fluvius nettarief laadpaal warmtepomp doorstromer kost per kw digitale meter', soort: 'indicatief',
                    bron: 'Vlaamse Nutsregulator, tarieven 2026: de maandpiek is het hoogste kwartiervermogen van de maand, de factuur rekent met het gemiddelde van de laatste 12 maandpieken en met minstens 2,5 kW · Fluvius Antwerpen 52,37 euro per kW per jaar (met 6 % btw), andere netgebieden 52 tot 61 euro',
                    uitleg: 'De piek telt als een gemiddelde over een kwartier. Een toestel dat kort veel vraagt, weegt dus minder dan een laadpaal die een uur op vol vermogen laadt.',
                    velden: [
                        { k: 'piek', label: 'Gemiddelde maandpiek nu', eh: 'kW', std: 4, min: 0, snel: [{ t: 'Klein 2,5', v: 2.5 }, { t: 'Gezin 4', v: 4 }, { t: 'Groot 6', v: 6 }] },
                        { k: 'extra', label: 'Vermogen van het nieuwe toestel', eh: 'kW', std: 7.4, min: 0, snel: [{ t: 'Warmtepomp 3', v: 3 }, { t: 'Laadpaal 3,7', v: 3.7 }, { t: 'Laadpaal 7,4', v: 7.4 }, { t: 'Laadpaal 11', v: 11 }, { t: 'Doorstromer 18', v: 18 }] },
                        { k: 'samen', label: 'Deel dat samenvalt met de bestaande piek', eh: '%', std: 100, min: 0, max: 100, snel: [{ t: 'Altijd 100', v: 100 }, { t: 'Half 50', v: 50 }, { t: '’s Nachts 0', v: 0 }] },
                        { k: 'tarief', label: 'Tarief', eh: '€/kW', std: 52.37, min: 0, snel: [{ t: 'Antwerpen 52,37', v: 52.37 }, { t: 'Limburg 51,99', v: 51.99 }, { t: 'Imewo 57,45', v: 57.45 }, { t: 'Kempen 59,58', v: 59.58 }, { t: 'West 60,53', v: 60.53 }] }
                    ],
                    bereken: function (v, h) {
                        var basis = Math.max(2.5, v.piek), nacht = Math.max(2.5, v.extra), nieuw = Math.max(basis + v.extra * v.samen / 100, v.samen < 100 ? nacht : 0);
                        var k1 = basis * v.tarief, k2 = nieuw * v.tarief;
                        var rijen = [2.5, 4, 6, 8, 10, 12, 15].map(function (p) { return [h.fmt(p, 1) + ' kW', h.fmt(p * v.tarief, 0) + ' euro', h.fmt(p * v.tarief / 12, 2) + ' euro']; });
                        return {
                            uit: [h.uit('Meerkost per jaar', k2 - k1, '€', { dec: 0, hoofd: true }), h.uit('Nieuwe piek', nieuw, 'kW', { dec: 1, hoofd: true }), h.uit('Kost nu', k1, '€', { dec: 0, opm: 'piek ' + h.fmt(basis, 1) + ' kW' }), h.uit('Kost met het nieuwe toestel', k2, '€', { dec: 0 })],
                            stappen: ['Nu: ' + h.fmt(basis, 1) + ' kW × ' + h.f(v.tarief, 2) + ' = ' + h.fmt(k1, 0) + ' euro', 'Nieuw: ' + h.fmt(nieuw, 1) + ' kW × ' + h.f(v.tarief, 2) + ' = ' + h.fmt(k2, 0) + ' euro'],
                            tabel: { kop: ['Gemiddelde maandpiek', 'Per jaar', 'Per maand'], rijen: rijen },
                            opm: 'Richtwaarde: de factuur volgt het gemiddelde van twaalf maanden, dus één uitschieter weegt voor een twaalfde. Een laadpaal met slimme sturing of een lager ingesteld laadvermogen houdt de piek laag. Wie weinig verbruikt, betaalt hoogstens het maximumtarief per kWh.'
                        };
                    }
                }
            ] },
            { naam: 'Regeltechniek', items: [
                {
                    id: 'elek.voeler', naam: 'Temperatuurvoeler: weerstand en temperatuur', kort: 'Pt1000, Ni1000 en NTC nameten met de multimeter',
                    zoek: 'temperatuurvoeler voeler sensor weerstand ohm pt100 pt1000 ni1000 ntc 10k buitenvoeler ketelvoeler boilervoeler multimeter nameten defect', soort: 'indicatief',
                    bron: 'Pt (IEC 60751): R = R₀ × (1 + 3,9083 × 10⁻³ × T − 5,775 × 10⁻⁷ × T²) · Ni1000 DIN 43760 en Ni1000 TK5000: veelterm, nagerekend tegen de tabellen van Testo en Siemens · NTC van Viessmann, Honeywell en Siemens: de tabel uit de servicehandleiding · Vaillant VR 10: 2.692 Ω bij 25 °C, B 4.000 K · algemene NTC: R = R₂₅ × exp(B × (1/T − 1/298,15)) met T in kelvin',
                    uitleg: 'Maak de voeler los van de regelaar en meet de weerstand. Vergelijk met de temperatuur die je met een thermometer meet. Oneindig = draadbreuk, bijna 0 Ω = kortsluiting. Staat jouw voeler niet in de lijst: kies “Eigen NTC” en vul de waarden van de fiche in.',
                    velden: [
                        { k: 'type', label: 'Voeler', type: 'keuze', opties: VOELERS.map(function (x) { return { v: x.v, t: x.t }; }), std: 'ntc10a' },
                        { k: 'T', label: 'Temperatuur', eh: '°C', opt: true, min: -50, max: 200 },
                        { k: 'Rm', label: 'of gemeten weerstand', eh: 'Ω', ehs: ['Ω', 'kΩ'], opt: true, min: 0 },
                        { k: 'R25', label: 'Eigen NTC: weerstand bij 25 °C', eh: 'kΩ', std: 10, min: 0.1 },
                        { k: 'B', label: 'Eigen NTC: B-waarde', eh: 'K', std: 3975, min: 1000, max: 6000 }
                    ],
                    bereken: function (v, h) {
                        var V = VOELERS.filter(function (x) { return x.v === v.type; })[0] || VOELERS[0];
                        var fn = V.v === 'eigen' ? function (t) { return rNtc(v.R25 * 1000, v.B, t); } : V.r;
                        function toon(r) { return r >= 1000 ? h.fmt(r / 1000, r >= 100000 ? 0 : r >= 10000 ? 1 : 2) + ' kΩ' : h.fmt(r, 1) + ' Ω'; }
                        var uit = [], st = [], lo = V.lo == null ? -60 : V.lo, hi = V.hi == null ? 250 : V.hi;
                        if (v.T != null && (v.T < lo || v.T > hi)) return { fout: 'Deze voeler werkt tussen ' + h.fmt(lo, 0) + ' en ' + h.fmt(hi, 0) + ' °C' };
                        if (v.Rm != null && v.Rm > 0) {
                            var T = voelerT(fn, v.Rm, V.stijgt, lo, hi);
                            if (T == null) return { fout: 'Deze weerstand valt buiten het bereik van de voeler (' + h.fmt(lo, 0).replace('-', '−') + ' tot ' + h.fmt(hi, 0) + ' °C): draadbreuk, kortsluiting of een ander type voeler' };
                            uit.push(h.uit('Temperatuur bij ' + toon(v.Rm), T, '°C', { dec: 1, hoofd: true }));
                            if (v.T != null) uit.push(h.uit('Verschil met de gemeten temperatuur', T - v.T, 'K', { dec: 1, kleur: Math.abs(T - v.T) > 3 ? 'rood' : 'groen' }), h.uit('Weerstand die bij ' + h.fmt(v.T, 1) + ' °C hoort', toon(fn(v.T)), ''));
                            st.push('R = ' + toon(v.Rm) + ' → T = ' + h.f(T, 1, '°C'));
                        } else if (v.T != null) {
                            uit.push(h.uit('Weerstand bij ' + h.fmt(v.T, 1) + ' °C', toon(fn(v.T)), '', { hoofd: true }));
                            st.push('T = ' + h.f(v.T, 1) + ' °C → R = ' + toon(fn(v.T)));
                        } else return { wacht: true, ontbreekt: ['temperatuur of weerstand'] };
                        var rijen = [-20, -10, 0, 10, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100].filter(function (t) { return t >= lo && t <= hi; }).map(function (t) { return [String(t).replace('-', '−') + ' °C', toon(fn(t))]; });
                        return {
                            uit: uit, stappen: st, tabel: { kop: ['Temperatuur', 'Weerstand'], rijen: rijen },
                            waarsch: v.Rm != null && v.T != null && Math.abs(voelerT(fn, v.Rm, V.stijgt, lo, hi) - v.T) > 3 ? ['Meer dan 3 K verschil: controleer eerst of het juiste type voeler gekozen is, daarna de kabel en de aansluitingen. Blijft het verschil, vervang dan de voeler.'] : [],
                            opm: 'Welke voeler waar: Viessmann Vitotronic 200 type KW (oudere ketels) gebruikt Pt500 voor ketel en boiler en Ni500 voor buiten en aanvoer. Vitotronic 200 type WO1C en de nieuwere Vitodens gebruiken NTC 10 kΩ. De voelers ESM van Danfoss zijn Pt1000. De tabel van de fabrikant gaat altijd voor.'
                        };
                    }
                },
                {
                    id: 'elek.signaal', naam: 'Stuursignaal 0-10 V en 4-20 mA', kort: 'Van signaal naar meetwaarde of klepstand, en terug',
                    zoek: 'stuursignaal analoog signaal 0-10 v 4-20 ma 2-10 v meetwaarde klepstand procent schalen druksensor frequentieregelaar gebouwbeheer', soort: 'exact',
                    bron: 'Lineair: waarde = min + (signaal − begin) / (einde − begin) × (max − min) · 4 tot 20 mA over 500 Ω geeft 2 tot 10 V, over 250 Ω 1 tot 5 V',
                    velden: [
                        { k: 'sig', label: 'Signaal', type: 'keuze', opties: SIGNALEN.map(function (x) { return { v: x.v, t: x.t }; }), std: '0-10' },
                        { k: 'min', label: 'Waarde bij het laagste signaal', std: 0 },
                        { k: 'max', label: 'Waarde bij het hoogste signaal', std: 100 },
                        { k: 's', label: 'Gemeten signaal (V of mA)', opt: true },
                        { k: 'w', label: 'of gewenste waarde', opt: true }
                    ],
                    bereken: function (v, h) {
                        var G = SIGNALEN.filter(function (x) { return x.v === v.sig; })[0] || SIGNALEN[0];
                        if (v.max === v.min) return { fout: 'De hoogste en de laagste waarde moeten verschillen' };
                        if (v.s == null && v.w == null) return { wacht: true, ontbreekt: ['signaal of waarde'] };
                        var uit = [], st = [], waarsch = [];
                        if (v.s != null) {
                            var w = v.min + (v.s - G.a) / (G.b - G.a) * (v.max - v.min), pct = (v.s - G.a) / (G.b - G.a) * 100;
                            uit.push(h.uit('Waarde', w, '', { dec: 2, hoofd: true }), h.uit('Aandeel van het bereik', pct, '%', { dec: 1 }));
                            st.push('Waarde = ' + h.f(v.min) + ' + (' + h.f(v.s, 2) + ' − ' + G.a + ') / (' + G.b + ' − ' + G.a + ') × (' + h.f(v.max) + ' − ' + h.f(v.min) + ') = ' + h.f(w, 2));
                            if (v.s < G.a - 0.01 * (G.b - G.a)) waarsch.push(G.a > 0 ? 'Het signaal ligt onder ' + G.a + ' ' + G.e + ': draadbreuk of geen voeding van de sensor.' : 'Het signaal is negatief: controleer de polariteit.');
                            if (v.s > G.b * 1.02) waarsch.push('Het signaal ligt boven ' + G.b + ' ' + G.e + ': de meetwaarde valt buiten het bereik van de sensor.');
                        } else {
                            var s = G.a + (v.w - v.min) / (v.max - v.min) * (G.b - G.a);
                            uit.push(h.uit('Signaal', s, G.e, { dec: 2, hoofd: true }), h.uit('Aandeel van het bereik', (v.w - v.min) / (v.max - v.min) * 100, '%', { dec: 1 }));
                            st.push('Signaal = ' + G.a + ' + (' + h.f(v.w) + ' − ' + h.f(v.min) + ') / (' + h.f(v.max) + ' − ' + h.f(v.min) + ') × (' + G.b + ' − ' + G.a + ') = ' + h.f(s, 2, G.e));
                        }
                        var rijen = [0, 25, 50, 75, 100].map(function (p) { return [p + ' %', h.fmt(G.a + p / 100 * (G.b - G.a), 2) + ' ' + G.e, h.fmt(v.min + p / 100 * (v.max - v.min), 2)]; });
                        return { uit: uit, stappen: st, waarsch: waarsch, tabel: { kop: ['Bereik', 'Signaal', 'Waarde'], rijen: rijen } };
                    }
                }
            ] },
            { naam: 'Omzettingen', items: [
                {
                    id: 'elek.awg', naam: 'AWG ↔ mm²', kort: 'Amerikaanse draadmaat omrekenen',
                    zoek: 'awg mm2 draadmaat american wire gauge', soort: 'exact',
                    bron: 'd(mm) = 0,127 × 92^((36 − AWG) / 39); 0000 = −3, 000 = −2, 00 = −1',
                    velden: [{ k: 'awg', label: 'AWG (leeg laten om van mm² te vertrekken)', opt: true, min: -3, max: 40 }, { k: 'S', label: 'of sectie', eh: 'mm²', opt: true }],
                    bereken: function (v, h) {
                        function dv(n) { return 0.127 * Math.pow(92, (36 - n) / 39); }
                        if (v.awg != null) { var d = dv(v.awg), S = Math.PI * d * d / 4; return { uit: [h.uit('Sectie', S, 'mm²', { dec: 3, hoofd: true }), h.uit('Diameter', d, 'mm', { dec: 3 }), h.uit('Dichtstbijzijnde metrische maat', h.omhoogNaar(S, [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240]), 'mm²')] }; }
                        if (v.S != null) { var best = null; for (var n = -3; n <= 40; n++) { var Sn = Math.PI * Math.pow(dv(n), 2) / 4; if (!best || Math.abs(Sn - v.S) < Math.abs(best.S - v.S)) best = { n: n, S: Sn }; } var naam = best.n < 1 ? new Array(2 - best.n).join('0') + '0' : String(best.n); return { uit: [h.uit('Dichtstbijzijnde AWG', naam, '', { hoofd: true }), h.uit('= sectie', best.S, 'mm²', { dec: 3 })] }; }
                        return { wacht: true, ontbreekt: ['AWG of sectie'] };
                    }
                }
            ] }
        ]
    });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-elektriciteit */
