/* QE Rekenmachine — module Werf & kantoor (v411)
 * BRON = QE-Software/reken-mod-werf.js; kopie in de www via `node sync-reken.js`.
 * Rekenhulpjes voor op de werf en aan het bureau: helling en afschot, verspringing met bochten,
 * driehoek, oppervlakte en inhoud, gewicht van leidingen, beugelafstanden, gasflessen, btw, marge en uren.
 * Bronnen: meetkunde; EN 10255 (staal draadbuis, reeks M); EN 1057 (koper); DIN 1988-2 / EN 806-4 (beugelafstanden).
 */
(function (root) {
    'use strict';
    var R = root.QEReken;
    if (!R) throw new Error('reken-kern.js eerst laden');

    function rad(g) { return g * Math.PI / 180; }
    function graden(r) { return r * 180 / Math.PI; }

    // Buizen met buitendiameter × wanddikte (mm) en soortelijke massa (kg/m³) voor het gewicht
    var DICHTHEID = { staal: 7850, rvs: 7900, koper: 8940, gietijzer: 7200, alu: 2700, pvc: 1400, pe: 950, pp: 900, meerlagen: 1500 };
    var MAT_NAAM = { staal: 'Staal', rvs: 'RVS', koper: 'Koper', gietijzer: 'Gietijzer', alu: 'Aluminium', pvc: 'PVC', pe: 'PE', pp: 'PP', meerlagen: 'Meerlagenbuis' };
    var GEWICHT_BUIZEN = [
        { v: 'eigen', t: 'Eigen maat (vul buitendiameter en wanddikte in)' },
        { v: 'st15', t: 'Staal 1/2" (DN15) 21,3 × 2,65', mat: 'staal', D: 21.3, s: 2.65 }, { v: 'st20', t: 'Staal 3/4" (DN20) 26,9 × 2,65', mat: 'staal', D: 26.9, s: 2.65 },
        { v: 'st25', t: 'Staal 1" (DN25) 33,7 × 3,25', mat: 'staal', D: 33.7, s: 3.25 }, { v: 'st32', t: 'Staal 5/4" (DN32) 42,4 × 3,25', mat: 'staal', D: 42.4, s: 3.25 },
        { v: 'st40', t: 'Staal 6/4" (DN40) 48,3 × 3,25', mat: 'staal', D: 48.3, s: 3.25 }, { v: 'st50', t: 'Staal 2" (DN50) 60,3 × 3,65', mat: 'staal', D: 60.3, s: 3.65 },
        { v: 'st65', t: 'Staal 2½" (DN65) 76,1 × 3,65', mat: 'staal', D: 76.1, s: 3.65 }, { v: 'st80', t: 'Staal 3" (DN80) 88,9 × 4,05', mat: 'staal', D: 88.9, s: 4.05 },
        { v: 'st100', t: 'Staal 4" (DN100) 114,3 × 4,5', mat: 'staal', D: 114.3, s: 4.5 }, { v: 'st125', t: 'Staal DN125 139,7 × 4,85', mat: 'staal', D: 139.7, s: 4.85 },
        { v: 'st150', t: 'Staal DN150 165,1 × 4,85', mat: 'staal', D: 165.1, s: 4.85 },
        { v: 'k15', t: 'Koper 15 × 1', mat: 'koper', D: 15, s: 1 }, { v: 'k18', t: 'Koper 18 × 1', mat: 'koper', D: 18, s: 1 }, { v: 'k22', t: 'Koper 22 × 1', mat: 'koper', D: 22, s: 1 },
        { v: 'k28', t: 'Koper 28 × 1,5', mat: 'koper', D: 28, s: 1.5 }, { v: 'k35', t: 'Koper 35 × 1,5', mat: 'koper', D: 35, s: 1.5 }, { v: 'k42', t: 'Koper 42 × 1,5', mat: 'koper', D: 42, s: 1.5 },
        { v: 'k54', t: 'Koper 54 × 2', mat: 'koper', D: 54, s: 2 },
        { v: 'p15', t: 'Dunwandig staal pers 15 × 1,2', mat: 'staal', D: 15, s: 1.2 }, { v: 'p22', t: 'Dunwandig staal pers 22 × 1,5', mat: 'staal', D: 22, s: 1.5 }, { v: 'p28', t: 'Dunwandig staal pers 28 × 1,5', mat: 'staal', D: 28, s: 1.5 },
        { v: 'p35', t: 'Dunwandig staal pers 35 × 1,5', mat: 'staal', D: 35, s: 1.5 }, { v: 'p54', t: 'Dunwandig staal pers 54 × 1,5', mat: 'staal', D: 54, s: 1.5 }, { v: 'p76', t: 'Dunwandig staal pers 76,1 × 2', mat: 'staal', D: 76.1, s: 2 },
        { v: 'pvc110', t: 'PVC afvoer 110 × 3,2', mat: 'pvc', D: 110, s: 3.2 }, { v: 'pvc125', t: 'PVC afvoer 125 × 3,2', mat: 'pvc', D: 125, s: 3.2 }, { v: 'pvc160', t: 'PVC afvoer 160 × 4', mat: 'pvc', D: 160, s: 4 }
    ];
    var VULLING = [{ v: 0, t: 'Leeg (lucht of gas)' }, { v: 1000, t: 'Water' }, { v: 1040, t: 'Water met glycol 30 %' }, { v: 850, t: 'Stookolie' }];

    // "7:30", "7u30", "07.30", "730", "7" → minuten sinds middernacht (of een duur in minuten)
    function tijd(s) {
        s = String(s == null ? '' : s).trim().toLowerCase();
        if (!s) return null;
        var m = /^(\d{1,3})\s*[:uh.]\s*(\d{1,2})?$/.exec(s);
        if (m) { var mm = m[2] == null || m[2] === '' ? 0 : Number(m[2]); if (mm > 59) return null; return Number(m[1]) * 60 + mm; }
        m = /^(\d{1,2})(\d{2})$/.exec(s);
        if (m && Number(m[2]) <= 59) return Number(m[1]) * 60 + Number(m[2]);
        m = /^(\d{1,3})$/.exec(s);
        if (m) return Number(m[1]) * 60;
        m = /^(\d{1,3}),(\d{1,2})$/.exec(s);          // 7,5 = 7,5 uur
        if (m) return Math.round(Number(m[1] + '.' + m[2]) * 60);
        return null;
    }
    function uurTekst(min) {
        var neg = min < 0; min = Math.round(Math.abs(min));
        var u = Math.floor(min / 60), m = min % 60;
        return (neg ? '−' : '') + u + ' u ' + (m < 10 ? '0' : '') + m;
    }
    function klok(min) { min = ((Math.round(min) % 1440) + 1440) % 1440; var u = Math.floor(min / 60), m = min % 60; return (u < 10 ? '0' : '') + u + ':' + (m < 10 ? '0' : '') + m; }

    // v411 — beugelafstanden in meter, nagelezen 29 sep 2026. null = geen waarde in de bron.
    // Koper en staal: DIN 1988-2 (buis gevuld met water) en Sikla (gevuld én geïsoleerd, voorzichtiger).
    var BEUGELS = [
        { v: 'koper', t: 'Koper', kop: ['Buis', 'DIN 1988-2', 'Gevuld en geïsoleerd'], uit: ['Beugelafstand (DIN 1988-2)', 'Gevuld en geïsoleerd (Sikla)'],
            rijen: [[12, 1.25, 1], [15, 1.25, 1.1], [18, 1.5, 1.2], [22, 2, 1.3], [28, 2.25, 1.5], [35, 2.75, 1.6], [42, 3, 1.8], [54, 3.5, 2], [64, 4, null], [76.1, 4.25, null], [88.9, 4.75, null], [108, 5, null], [133, 5, null], [159, 5, null]] },
        { v: 'staal', t: 'Staal draadbuis (vul de DN in)', dn: true, kop: ['Buis', 'DIN 1988-2', 'Gevuld en geïsoleerd'], uit: ['Beugelafstand (DIN 1988-2)', 'Gevuld en geïsoleerd (Sikla)'],
            rijen: [[10, 2.25, 1.2], [15, 2.75, 1.5], [20, 3, 2], [25, 3.5, 2.5], [32, 3.75, 2.9], [40, 4.25, 3.3], [50, 4.75, 4], [65, 5.5, 4.75], [80, 6, 5.25], [100, 6, 5.8], [125, 6, null]] },
        { v: 'henco', t: 'Meerlagenbuis Henco', kop: ['Buis', 'Horizontaal', 'Verticaal'], uit: ['Beugelafstand horizontaal', 'Beugelafstand verticaal'],
            rijen: [[14, 1.2, 1.5], [16, 1.2, 1.5], [18, 1.2, 1.5], [20, 1.3, 1.9], [26, 1.5, 1.95], [32, 1.75, 2], [40, 1.75, 2], [50, 1.8, 1.8], [63, 2, 2]] },
        { v: 'uponor', t: 'Meerlagenbuis Uponor', kop: ['Buis', 'Van de rol', 'Staaf', 'Verticaal'], uit: ['Horizontaal, buis van de rol', 'Horizontaal, buis in staven', 'Beugelafstand verticaal'],
            rijen: [[14, 1.2, null, 1.7], [16, 1.2, 2, 2.3], [20, 1.3, 2.3, 2.6], [25, 1.5, 2.6, 3], [32, 1.6, 2.6, 3], [40, null, 2, 2.2], [50, null, 2, 2.6], [63, null, 2.2, 2.85], [75, null, 2.4, 3.1], [90, null, 2.4, 3.1], [110, null, 2.4, 3.1]] },
        { v: 'pvcdruk', t: 'PVC-drukbuis', kop: ['Buis', 'Bij 20 °C', 'Bij 40 °C'], uit: ['Beugelafstand bij 20 °C', 'Beugelafstand bij 40 °C'],
            rijen: [[16, 0.8, 0.5], [20, 0.9, 0.6], [25, 0.95, 0.65], [32, 1.05, 0.7], [40, 1.05, 0.7], [50, 1.4, 1.1], [63, 1.5, 1.2], [75, 1.65, 1.35], [90, 1.8, 1.5], [110, 2, 1.7], [160, 2.4, 2.1]] },
        { v: 'afvoerpvc', t: 'Afvoer in PVC', kop: ['Buis', 'Horizontaal', 'Verticaal'], uit: ['Beugelafstand horizontaal', 'Beugelafstand verticaal'], maten: [32, 40, 50, 75, 90, 110, 125, 160, 200],
            regel: function (D) { return [Math.min(2, Math.max(0.5, 10 * D / 1000)), Math.min(3, Math.max(1.2, 25 * D / 1000))]; } },
        { v: 'afvoerpp', t: 'Afvoer in PP', kop: ['Buis', 'Horizontaal', 'Verticaal', 'Verticaal, met hulpstukken'], uit: ['Beugelafstand horizontaal', 'Beugelafstand verticaal', 'Verticaal, met hulpstukken tussen de beugels'], maten: [32, 40, 50, 75, 90, 110, 125, 160],
            regel: function (D) { return [10 * D / 1000, 25 * D / 1000, 15 * D / 1000]; } }
    ];
    var DN_DUIM = { 10: '3/8"', 15: '1/2"', 20: '3/4"', 25: '1"', 32: '5/4"', 40: '6/4"', 50: '2"', 65: '2½"', 80: '3"', 100: '4"', 125: '5"' };
    // v411 — propaanfles: afname in kg/h bij meer dan 15 °C (GOK), per flesgrootte in kg
    var PROPAAN_KG = [5, 11, 33], PROPAAN_CONT = [0.2, 0.3, 0.6], PROPAAN_KORT = [1.5, 2, 3];
    R.registreer({
        key: 'werf', naam: 'Werf & kantoor', emoji: '', volgorde: 6,
        omschrijving: 'Helling, verspringing en inhoud, ladder, zaagplan en kernboring, gewicht en beugels, gasflessen, btw, marge en uren',
        groepen: [
            { naam: 'Meten en uitzetten', items: [
                {
                    id: 'werf.helling', naam: 'Helling en afschot', kort: 'Procent, cm per meter, graden en hoogteverschil over een lengte',
                    zoek: 'helling afschot verval procent cm per meter graden hoogteverschil afvoer goot condens leiding schuin verhouding', soort: 'exact',
                    bron: 'Helling in % = hoogteverschil / horizontale lengte × 100 · 1 cm per meter = 1 % · graden = atan(% / 100)',
                    uitleg: 'Vul de helling in (procent of graden), of een lengte met het hoogteverschil. Richtwaarden: afvoer 1 tot 2 cm per meter, condensafvoer minstens 1 cm per meter, regenwater in de grond 0,5 tot 1 cm per meter, inloopdouche 1,5 tot 2 cm per meter.',
                    velden: [
                        { k: 'pct', label: 'Helling', eh: '%', opt: true, min: 0, snel: [{ t: '0,5', v: 0.5 }, { t: '1', v: 1 }, { t: '1,5', v: 1.5 }, { t: '2', v: 2 }, { t: '3', v: 3 }, { t: '5', v: 5 }] },
                        { k: 'gr', label: 'of helling in graden', eh: '°', opt: true, min: 0, max: 89 },
                        { k: 'L', label: 'Horizontale lengte', eh: 'm', ehs: ['m', 'cm', 'mm'], opt: true, min: 0 },
                        { k: 'dh', label: 'Hoogteverschil', eh: 'cm', ehs: ['cm', 'mm', 'm'], opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var pct = v.pct, st = [], L = v.L, dh = v.dh;
                        if (pct == null && v.gr != null) { pct = Math.tan(rad(v.gr)) * 100; st.push('Helling = tan(' + h.f(v.gr) + '°) × 100 = ' + h.f(pct, 2, '%')); }
                        if (pct == null && L != null && dh != null) {
                            if (!(L > 0)) return { fout: 'De lengte moet groter zijn dan 0' };
                            pct = dh / (L * 100) * 100; st.push('Helling = ' + h.f(dh, 1) + ' cm / ' + h.f(L * 100, 0) + ' cm × 100 = ' + h.f(pct, 2, '%'));
                        }
                        if (pct == null) return { wacht: true, ontbreekt: ['helling, of lengte met hoogteverschil'] };
                        if (L == null && dh != null && pct > 0) { L = dh / pct; st.push('Lengte = ' + h.f(dh, 1) + ' cm / ' + h.f(pct, 2) + ' cm per meter = ' + h.f(L, 2, 'm')); }
                        var uit = [h.uit('Helling', pct, '%', { dec: 2, hoofd: true, opm: h.fmt(pct, 2) + ' cm per meter' }), h.uit('In graden', graden(Math.atan(pct / 100)), '°', { dec: 2, hoofd: true }), h.uit('Per meter', pct * 10, 'mm', { dec: 1 }), h.uit('Verhouding', pct > 0 ? '1 op ' + h.fmt(100 / pct, 1) : 'vlak', '')];
                        if (L != null) {
                            uit.push(h.uit('Hoogteverschil over ' + h.fmt(L, 2) + ' m', L * pct, 'cm', { dec: 1, hoofd: true, opm: h.fmt(L * pct * 10, 0) + ' mm' }), h.uit('Schuine lengte', L * Math.sqrt(1 + Math.pow(pct / 100, 2)), 'm', { dec: 3 }));
                            st.push('Hoogteverschil = ' + h.f(L, 2) + ' m × ' + h.f(pct, 2) + ' cm per meter = ' + h.f(L * pct, 1, 'cm'));
                        }
                        var rijen = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map(function (m) { return [m + ' m', h.fmt(m * pct, 1) + ' cm', h.fmt(m * pct * 10, 0) + ' mm']; });
                        var waarsch = [];
                        if (pct > 0 && pct < 0.5) waarsch.push('Minder dan 0,5 cm per meter: te weinig voor een afvoer, het water blijft staan.');
                        if (pct > 5) waarsch.push('Meer dan 5 cm per meter: in een afvoer loopt het water weg van de vaste stoffen. Gebruik voor een groot hoogteverschil een valstuk.');
                        return { uit: uit, stappen: st, tabel: { kop: ['Lengte', 'Hoogteverschil', 'In mm'], rijen: rijen }, waarsch: waarsch };
                    }
                },
                {
                    id: 'werf.verspringing', naam: 'Verspringing met twee bochten', kort: 'Schuine lengte en zaagmaat bij een sprong met bochten van 45°, 30°, 60°',
                    zoek: 'verspringing offset etage sprong bochten 45 graden 30 60 schuine lengte zaagmaat z-maat leiding omleggen verzet obstakel', soort: 'exact',
                    bron: 'Schuine lengte (hart op hart) = verspringing / sin(hoek) · vooruitgang = verspringing / tan(hoek) · bij 45°: verspringing × 1,414 · zaaglengte = schuine lengte − 2 × Z-maat',
                    uitleg: 'De verspringing is de afstand tussen de hartlijnen van de twee evenwijdige leidingen. Moet de leiding tegelijk opzij en omhoog, vul dan ook de tweede verspringing in. De Z-maat staat in de fiche van de fitting (afstand van het hart van de bocht tot de aanslag van de buis).',
                    velden: [
                        { k: 'V', label: 'Verspringing (hart op hart)', eh: 'mm', ehs: ['mm', 'cm', 'm'], min: 0 },
                        { k: 'V2', label: 'Tweede verspringing, haaks op de eerste', eh: 'mm', ehs: ['mm', 'cm', 'm'], opt: true, min: 0 },
                        { k: 'hoek', label: 'Bochten', type: 'keuze', opties: [{ v: 45, t: '45°' }, { v: 30, t: '30°' }, { v: 60, t: '60°' }, { v: 22.5, t: '22,5°' }, { v: 15, t: '15°' }, { v: 67.5, t: '67,5° (afvoer)' }, { v: 87.5, t: '87,5° (afvoer)' }], std: 45 },
                        { k: 'Z', label: 'Z-maat van één bocht', eh: 'mm', std: 0, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var a = Number(v.hoek), V = Math.sqrt(v.V * v.V + (v.V2 || 0) * (v.V2 || 0));
                        if (!(V > 0)) return { fout: 'De verspringing moet groter zijn dan 0' };
                        var S = V / Math.sin(rad(a)), A = V / Math.tan(rad(a)), zaag = S - 2 * v.Z;
                        var st = [];
                        if (v.V2) st.push('Werkelijke verspringing = √(' + h.f(v.V) + '² + ' + h.f(v.V2) + '²) = ' + h.f(V, 1, 'mm'));
                        st.push('Schuine lengte = ' + h.f(V, 1) + ' / sin(' + h.f(a) + '°) = ' + h.f(S, 1, 'mm'), 'Vooruitgang = ' + h.f(V, 1) + ' / tan(' + h.f(a) + '°) = ' + h.f(A, 1, 'mm'));
                        if (v.Z > 0) st.push('Zaaglengte = ' + h.f(S, 1) + ' − 2 × ' + h.f(v.Z) + ' = ' + h.f(zaag, 1, 'mm'));
                        var hoeken = [15, 22.5, 30, 45, 60, 67.5, 87.5], kies = hoeken.indexOf(a);
                        var rijen = hoeken.map(function (g) { return [h.fmt(g, 1) + '°', h.fmt(1 / Math.sin(rad(g)), 3), h.fmt(V / Math.sin(rad(g)), 0) + ' mm', h.fmt(V / Math.tan(rad(g)), 0) + ' mm']; });
                        var waarsch = [];
                        if (zaag <= 0) waarsch.push('De twee bochten raken elkaar: de verspringing is te klein voor deze bochten. Kies een kleinere hoek.');
                        return {
                            uit: [h.uit('Schuine lengte (hart op hart)', S, 'mm', { dec: 0, hoofd: true }), h.uit(v.Z > 0 ? 'Zaaglengte van de buis' : 'Zaaglengte (vul de Z-maat in)', zaag > 0 ? zaag : null, 'mm', { dec: 0, hoofd: v.Z > 0 }), h.uit('Vooruitgang in de looprichting', A, 'mm', { dec: 0 }), h.uit('Werkelijke verspringing', V, 'mm', { dec: 1 })],
                            stappen: st, tabel: { kop: ['Bocht', 'Factor', 'Schuine lengte', 'Vooruitgang'], rijen: rijen, kies: kies }, waarsch: waarsch
                        };
                    }
                },
                {
                    id: 'werf.driehoek', naam: 'Rechthoekige driehoek en haaks uitzetten', kort: 'Zijden en hoek uit twee gekende waarden, met de 3-4-5-regel',
                    zoek: 'driehoek pythagoras schuine zijde diagonaal hoek haaks uitzetten 3 4 5 regel rechte hoek winkelhaak sinus', soort: 'exact',
                    bron: 'c² = a² + b² · tan(hoek) = b / a · een driehoek met zijden 3, 4 en 5 (of een veelvoud) heeft een rechte hoek',
                    uitleg: 'Vul twee waarden in. De hoek ligt tussen zijde a en de schuine zijde.',
                    velden: [
                        { k: 'a', label: 'Zijde a', eh: 'm', ehs: ['m', 'cm', 'mm'], opt: true, min: 0 },
                        { k: 'b', label: 'Zijde b (haaks op a)', eh: 'm', ehs: ['m', 'cm', 'mm'], opt: true, min: 0 },
                        { k: 'c', label: 'Schuine zijde c', eh: 'm', ehs: ['m', 'cm', 'mm'], opt: true, min: 0 },
                        { k: 'hoek', label: 'Hoek tussen a en c', eh: '°', opt: true, min: 0, max: 89.9 }
                    ],
                    bereken: function (v, h) {
                        var a = v.a, b = v.b, c = v.c, g = v.hoek, n = [a, b, c, g].filter(function (x) { return x != null; }).length;
                        if (n < 2) return { wacht: true, ontbreekt: ['twee waarden'] };
                        if (a != null && b != null) { c = Math.sqrt(a * a + b * b); g = graden(Math.atan2(b, a)); }
                        else if (a != null && c != null) { if (c <= a) return { fout: 'De schuine zijde moet langer zijn dan zijde a' }; b = Math.sqrt(c * c - a * a); g = graden(Math.acos(a / c)); }
                        else if (b != null && c != null) { if (c <= b) return { fout: 'De schuine zijde moet langer zijn dan zijde b' }; a = Math.sqrt(c * c - b * b); g = graden(Math.asin(b / c)); }
                        else if (a != null && g != null) { b = a * Math.tan(rad(g)); c = a / Math.cos(rad(g)); }
                        else if (b != null && g != null) { if (!(g > 0)) return { fout: 'De hoek moet groter zijn dan 0' }; a = b / Math.tan(rad(g)); c = b / Math.sin(rad(g)); }
                        else { a = c * Math.cos(rad(g)); b = c * Math.sin(rad(g)); }
                        if (!(a > 0) || !(c > 0)) return { fout: 'De zijden moeten groter zijn dan 0' };
                        var k = a / 3;
                        return {
                            uit: [h.uit('Zijde a', a, 'm', { dec: 3, hoofd: v.a == null }), h.uit('Zijde b', b, 'm', { dec: 3, hoofd: v.b == null }), h.uit('Schuine zijde c', c, 'm', { dec: 3, hoofd: v.c == null }), h.uit('Hoek tussen a en c', g, '°', { dec: 2, hoofd: v.hoek == null }), h.uit('Andere hoek', 90 - g, '°', { dec: 2 }), h.uit('Oppervlakte', a * b / 2, 'm²', { dec: 3 })],
                            stappen: ['c = √(a² + b²) = √(' + h.fmt(a, 3) + '² + ' + h.fmt(b, 3) + '²) = ' + h.f(c, 3, 'm')],
                            opm: 'Haaks uitzetten op zijde a: meet ' + h.fmt(a, 2) + ' m langs de ene kant en ' + h.fmt(4 * k, 2) + ' m langs de andere kant. De hoek is recht als de diagonaal ' + h.fmt(5 * k, 2) + ' m is (3-4-5-regel). Een rechthoek is haaks als de twee diagonalen even lang zijn.'
                        };
                    }
                },
                {
                    id: 'werf.vormen', naam: 'Oppervlakte en inhoud', kort: 'Kamer of bak, cilinder, buis, bol en sleuf',
                    zoek: 'oppervlakte inhoud volume kamer bak cilinder vat buis bol sleuf trapezium m2 m3 liter omtrek wanden', soort: 'exact',
                    bron: 'Rechthoek: A = l × b, V = A × h · cilinder: A = π × d² / 4, V = A × h · buis: inhoud = π × d_binnen² / 4 × l · bol: V = π × d³ / 6 · sleuf: V = (boven + onder) / 2 × diepte × lengte',
                    velden: [
                        { k: 'vorm', label: 'Vorm', type: 'keuze', opties: [{ v: 'rect', t: 'Kamer, bak of plaat (rechthoek)' }, { v: 'cil', t: 'Cilinder of vat' }, { v: 'buis', t: 'Buis (wand en inhoud)' }, { v: 'bol', t: 'Bol' }, { v: 'sleuf', t: 'Sleuf of goot (trapezium)' }], std: 'rect' },
                        { k: 'a', label: 'Lengte, diameter of bovenbreedte', eh: 'm', ehs: ['m', 'cm', 'mm'], min: 0 },
                        { k: 'b', label: 'Breedte, binnendiameter of onderbreedte', eh: 'm', ehs: ['m', 'cm', 'mm'], opt: true, min: 0 },
                        { k: 'c', label: 'Hoogte of diepte', eh: 'm', ehs: ['m', 'cm', 'mm'], opt: true, min: 0 },
                        { k: 'L', label: 'Lengte van buis of sleuf', eh: 'm', ehs: ['m', 'cm', 'mm'], opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var a = v.a, b = v.b, c = v.c, L = v.L, uit = [], st = [];
                        function vol(m3) { return h.uit('Inhoud', m3 * 1000, 'l', { dec: m3 < 1 ? 1 : 0, hoofd: true, opm: h.fmt(m3, 3) + ' m³' }); }
                        if (v.vorm === 'rect') {
                            if (b == null) return { wacht: true, ontbreekt: ['breedte'] };
                            uit.push(h.uit('Oppervlakte', a * b, 'm²', { dec: 2, hoofd: true }), h.uit('Omtrek', 2 * (a + b), 'm', { dec: 2 }));
                            st.push('A = ' + h.f(a, 3) + ' × ' + h.f(b, 3) + ' = ' + h.f(a * b, 2, 'm²'));
                            if (c != null) { uit.push(vol(a * b * c), h.uit('Wanden samen', 2 * (a + b) * c, 'm²', { dec: 2 }), h.uit('Wanden, vloer en plafond', 2 * (a + b) * c + 2 * a * b, 'm²', { dec: 2 })); st.push('V = ' + h.f(a * b, 2) + ' × ' + h.f(c, 3) + ' = ' + h.f(a * b * c, 3, 'm³')); }
                        } else if (v.vorm === 'cil') {
                            var A = Math.PI * a * a / 4;
                            uit.push(h.uit('Grondvlak', A, 'm²', { dec: 3, hoofd: c == null }), h.uit('Omtrek', Math.PI * a, 'm', { dec: 3 }));
                            st.push('A = π × ' + h.f(a, 3) + '² / 4 = ' + h.f(A, 3, 'm²'));
                            if (c != null) { uit.unshift(vol(A * c)); uit.push(h.uit('Mantel', Math.PI * a * c, 'm²', { dec: 2 })); st.push('V = ' + h.f(A, 3) + ' × ' + h.f(c, 3) + ' = ' + h.f(A * c, 3, 'm³')); }
                        } else if (v.vorm === 'buis') {
                            if (b == null) return { wacht: true, ontbreekt: ['binnendiameter'] };
                            if (b >= a) return { fout: 'De binnendiameter moet kleiner zijn dan de buitendiameter' };
                            var Ai = Math.PI * b * b / 4, Aw = Math.PI * (a * a - b * b) / 4;
                            uit.push(h.uit('Doorlaat', Ai * 1e4, 'cm²', { dec: 2, hoofd: L == null }), h.uit('Inhoud per meter', Ai * 1000, 'l', { dec: 3 }), h.uit('Doorsnede van de wand', Aw * 1e4, 'cm²', { dec: 2 }), h.uit('Buitenoppervlak per meter', Math.PI * a, 'm²', { dec: 3 }));
                            st.push('Doorlaat = π × ' + h.f(b, 4) + '² / 4 = ' + h.f(Ai * 1e4, 2, 'cm²'));
                            if (L != null) { uit.unshift(vol(Ai * L)); uit.push(h.uit('Buitenoppervlak over de lengte', Math.PI * a * L, 'm²', { dec: 2 })); }
                        } else if (v.vorm === 'bol') {
                            uit.push(vol(Math.PI * Math.pow(a, 3) / 6), h.uit('Oppervlak', Math.PI * a * a, 'm²', { dec: 3 }));
                            st.push('V = π × ' + h.f(a, 3) + '³ / 6 = ' + h.f(Math.PI * Math.pow(a, 3) / 6, 3, 'm³'));
                        } else {
                            if (b == null || c == null) return { wacht: true, ontbreekt: ['onderbreedte en diepte'] };
                            var At = (a + b) / 2 * c;
                            uit.push(h.uit('Doorsnede', At, 'm²', { dec: 3, hoofd: L == null }));
                            st.push('A = (' + h.f(a, 3) + ' + ' + h.f(b, 3) + ') / 2 × ' + h.f(c, 3) + ' = ' + h.f(At, 3, 'm²'));
                            if (L != null) { uit.unshift(h.uit('Inhoud', At * L, 'm³', { dec: 2, hoofd: true, opm: h.fmt(At * L * 1000, 0) + ' l' })); uit.push(h.uit('Uitgegraven grond, los (× 1,25)', At * L * 1.25, 'm³', { dec: 2 })); }
                        }
                        return { uit: uit, stappen: st };
                    }
                },
                {
                    id: 'werf.ladder', naam: 'Ladder: lengte en opstelling', kort: 'Hoe lang moet de ladder zijn en hoe ver staat de voet van de muur?',
                    zoek: 'ladder lengte opstelhoek 75 graden 1 op 4 uitsteken dakrand schuifladder veilig werken op hoogte voet afstand muur', soort: 'indicatief',
                    bron: 'Codex over het welzijn op het werk, boek IV titel 5, art. IV.5-4 tot IV.5-6: de ladder steekt voldoende uit boven het toegangsniveau en wordt vastgezet (de Codex noemt geen cijfers) · goede praktijk: opstelhoek ±75° (1 op 4) en 1 m boven het toegangsniveau · lengte = hoogte / sin(hoek) + uitsteek',
                    velden: [
                        { k: 'H', label: 'Hoogte van het steunpunt (dakrand, bordes)', eh: 'm', ehs: ['m', 'cm'], min: 0 },
                        { k: 'hoek', label: 'Opstelhoek', eh: '°', std: 75, min: 60, max: 80 },
                        { k: 'uit', label: 'Uitsteken boven het steunpunt', eh: 'm', std: 1, min: 0, max: 2, snel: [{ t: 'Overstappen 1', v: 1 }, { t: 'Alleen leunen 0', v: 0 }] }
                    ],
                    bereken: function (v, h) {
                        if (!(v.H > 0)) return { fout: 'De hoogte moet groter zijn dan 0' };
                        var a = rad(v.hoek), L = v.H / Math.sin(a) + v.uit, voet = v.H / Math.tan(a), waarsch = [];
                        if (v.hoek < 65) waarsch.push('Vlakker dan 65°: de voet kan wegglijden.');
                        if (v.hoek > 76) waarsch.push('Steiler dan 75°: de ladder kan achterover kantelen.');
                        if (v.uit < 1) waarsch.push('Stap je over op het dak of het bordes? Laat de ladder dan 1 m uitsteken, of zorg voor een andere veilige houvast.');
                        return {
                            uit: [h.uit('Ladder minstens', L, 'm', { dec: 2, hoofd: true }), h.uit('Voet van de ladder op', voet, 'm', { dec: 2, hoofd: true, opm: 'van de muur' }), h.uit('Verhouding', '1 op ' + h.fmt(v.H / voet, 1), '', { opm: 'hoogte tegenover afstand' })],
                            stappen: ['Lengte = ' + h.f(v.H, 2) + ' / sin(' + h.f(v.hoek, 0) + '°) + ' + h.f(v.uit, 2) + ' = ' + h.f(L, 2, 'm'), 'Voet = ' + h.f(v.H, 2) + ' / tan(' + h.f(v.hoek, 0) + '°) = ' + h.f(voet, 2, 'm')],
                            waarsch: waarsch,
                            opm: 'Een ladder is een toegangsmiddel. Als werkplek mag ze alleen dienen voor kort werk met een klein risico, als een veiliger arbeidsmiddel niet verantwoord is. Zet de ladder vast, bovenaan of onderaan, voor je ze betreedt. Draag alleen lichte lasten en houd een hand vrij. Bij een schuifladder overlappen de delen: reken op de lengte die de fabrikant opgeeft voor de uitgeschoven ladder.'
                        };
                    }
                }
            ] },
            { naam: 'Leidingen: zagen, boren en ophangen', items: [
                {
                    id: 'werf.buisgewicht', naam: 'Gewicht van een leiding', kort: 'Kilogram per meter, leeg en gevuld, en de last per beugel',
                    zoek: 'gewicht leiding buis kg per meter staal koper gevuld water ophanging beugel last draadstang dragen tillen', soort: 'exact',
                    bron: 'Massa wand = π × (D² − d²) / 4 × ρ · staal 7.850 kg/m³, koper 8.940, RVS 7.900, PVC 1.400, PE 950 · water 1.000 kg/m³ · maten staal volgens EN 10255 (reeks M)',
                    velden: [
                        { k: 'buis', label: 'Buis', type: 'keuze', opties: GEWICHT_BUIZEN, std: 'st50' },
                        { k: 'mat', label: 'Materiaal (bij eigen maat)', type: 'keuze', opties: Object.keys(DICHTHEID).map(function (k) { return { v: k, t: MAT_NAAM[k] + ' (' + R.fmt(DICHTHEID[k], 0) + ' kg/m³)' }; }), std: 'staal' },
                        { k: 'D', label: 'Buitendiameter (bij eigen maat)', eh: 'mm', opt: true, min: 0 },
                        { k: 's', label: 'Wanddikte (bij eigen maat)', eh: 'mm', opt: true, min: 0 },
                        { k: 'L', label: 'Lengte', eh: 'm', std: 6, min: 0 },
                        { k: 'vul', label: 'Gevuld met', type: 'keuze', opties: VULLING, std: 1000 },
                        { k: 'iso', label: 'Isolatie en toebehoren', eh: 'kg/m', std: 0, min: 0 },
                        { k: 'beugel', label: 'Afstand tussen de beugels', eh: 'm', std: 2, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var B = GEWICHT_BUIZEN.filter(function (x) { return x.v === v.buis; })[0] || GEWICHT_BUIZEN[0];
                        var mat = B.mat || v.mat, D = B.D != null ? B.D : v.D, s = B.s != null ? B.s : v.s;
                        if (D == null || s == null) return { wacht: true, ontbreekt: ['buitendiameter en wanddikte'] };
                        if (!(s > 0) || 2 * s >= D) return { fout: 'De wanddikte moet groter zijn dan 0 en kleiner dan de halve buitendiameter' };
                        var d = D - 2 * s, Aw = Math.PI * (D * D - d * d) / 4 / 1e6, Ai = Math.PI * d * d / 4 / 1e6;
                        var leeg = Aw * DICHTHEID[mat], inhoud = Ai * 1000, vol = leeg + Ai * Number(v.vul) + v.iso;
                        var uit = [h.uit('Gewicht gevuld', vol, 'kg/m', { dec: 2, hoofd: true, opm: 'over ' + h.fmt(v.L, 1) + ' m: ' + h.fmt(vol * v.L, 1) + ' kg' }), h.uit('Gewicht leeg', leeg, 'kg/m', { dec: 2, hoofd: true, opm: 'over ' + h.fmt(v.L, 1) + ' m: ' + h.fmt(leeg * v.L, 1) + ' kg' }), h.uit('Inhoud', inhoud, 'l/m', { dec: 3 }), h.uit('Binnendiameter', d, 'mm', { dec: 1 })];
                        if (v.beugel > 0) uit.push(h.uit('Last per beugel', vol * v.beugel, 'kg', { dec: 1, opm: h.fmt(vol * v.beugel * 9.81, 0) + ' N bij een beugel om de ' + h.fmt(v.beugel, 2) + ' m' }));
                        return {
                            uit: uit,
                            stappen: ['Wand = π × (' + h.fmt(D, 1) + '² − ' + h.fmt(d, 1) + '²) / 4 = ' + h.f(Aw * 1e6, 0, 'mm²'), 'Leeg = ' + h.fmt(Aw * 1e6, 0) + ' mm² × ' + h.fmt(DICHTHEID[mat], 0) + ' kg/m³ = ' + h.f(leeg, 2, 'kg/m'), 'Gevuld = ' + h.fmt(leeg, 2) + ' + ' + h.fmt(inhoud, 3) + ' l × ' + h.fmt(Number(v.vul) / 1000, 2) + ' kg/l + ' + h.fmt(v.iso, 2) + ' = ' + h.f(vol, 2, 'kg/m')],
                            opm: 'Reken voor de bevestiging met het gevulde gewicht en een veiligheidsfactor. De toegelaten last van anker, draadstang en beugel staat in de fiche van de fabrikant.'
                        };
                    }
                },
                {
                    id: 'werf.zaaglijst', naam: 'Zaagplan voor buizen en profielen', kort: 'Hoeveel staven heb je nodig en hoe zaag je ze met het minste afval?',
                    zoek: 'zaagplan zaaglijst zaagstaat buizen staven lengtes optimaliseren afval snijverlies stalen buis 6 meter profiel rail draadstang', soort: 'indicatief',
                    bron: 'Grootste stukken eerst, elk stuk in de staaf waar het het best past (best fit decreasing) · elke zaagsnede kost de breedte van het zaagblad · ondergrens = totale lengte gedeeld door de staaflengte',
                    uitleg: 'Vul per regel een lengte en een aantal in. Het plan is goed, maar niet altijd het allerbeste: bij het kleinste aantal staven staat dat erbij.',
                    velden: [
                        { k: 'stok', label: 'Lengte van een staaf', eh: 'mm', ehs: ['mm', 'cm', 'm'], std: 6000, min: 1, snel: [{ t: '3 m', v: 3000 }, { t: '5 m', v: 5000 }, { t: '6 m', v: 6000 }] },
                        { k: 'zaag', label: 'Breedte van de zaagsnede', eh: 'mm', std: 3, min: 0, max: 20 },
                        { k: 'kop', label: 'Afval aan het begin van elke staaf', eh: 'mm', std: 0, min: 0 },
                        { k: 'rijen', label: 'Stukken', type: 'rijen', kolommen: [{ k: 'L', label: 'Lengte in mm', type: 'getal' }, { k: 'n', label: 'Aantal', type: 'getal' }], std: [{ L: 2400, n: 4 }, { L: 1350, n: 6 }, { L: 800, n: 5 }] }
                    ],
                    bereken: function (v, h) {
                        var stukken = [], totaal = 0;
                        (v.rijen || []).forEach(function (r) { var n = Math.round(r.n || 0); if (r.L > 0 && n > 0) for (var i = 0; i < n; i++) { stukken.push(r.L); totaal += r.L; } });
                        if (!stukken.length) return { wacht: true, ontbreekt: ['minstens één stuk'] };
                        if (stukken.length > 600) return { fout: 'Meer dan 600 stukken: splits de lijst' };
                        var bruikbaar = v.stok - v.kop, langste = Math.max.apply(null, stukken);
                        if (langste > bruikbaar + 1e-9) return { fout: 'Een stuk van ' + h.fmt(langste, 0) + ' mm past niet in een staaf van ' + h.fmt(bruikbaar, 0) + ' mm' };
                        stukken.sort(function (a, b) { return b - a; });
                        var cap = bruikbaar + v.zaag, staven = [];
                        stukken.forEach(function (L) {
                            var beste = -1, rest = Infinity;
                            for (var i = 0; i < staven.length; i++) { var over = cap - staven[i].vol - (L + v.zaag); if (over >= -1e-9 && over < rest) { rest = over; beste = i; } }
                            if (beste < 0) { staven.push({ vol: 0, s: [] }); beste = staven.length - 1; }
                            staven[beste].vol += L + v.zaag; staven[beste].s.push(L);
                        });
                        var ondergrens = Math.ceil(stukken.reduce(function (a, L) { return a + L + v.zaag; }, 0) / cap - 1e-9);
                        var groepen = {}, volgorde = [], grootsteRest = 0, afval = 0;
                        staven.forEach(function (st) {
                            var gebruikt = st.s.reduce(function (a, b) { return a + b; }, 0), rest = Math.max(0, v.stok - v.kop - gebruikt - v.zaag * st.s.length);
                            st.rest = rest; grootsteRest = Math.max(grootsteRest, rest); afval += v.stok - gebruikt;
                            var sleutel = st.s.join('+');
                            if (!groepen[sleutel]) { groepen[sleutel] = { n: 0, st: st }; volgorde.push(sleutel); }
                            groepen[sleutel].n++;
                        });
                        function plan(st) { var tel = {}, lijst = []; st.s.forEach(function (L) { if (!tel[L]) { tel[L] = 0; lijst.push(L); } tel[L]++; }); return lijst.map(function (L) { return tel[L] + ' × ' + h.fmt(L, 0); }).join(' + '); }
                        var rijen = volgorde.map(function (k) { var g = groepen[k]; return [g.n + ' ×', plan(g.st), h.fmt(g.st.rest, 0) + ' mm']; });
                        return {
                            uit: [h.uit('Staven nodig', staven.length, '', { dec: 0, hoofd: true, opm: staven.length === ondergrens ? 'minder kan niet' : 'ondergrens: ' + ondergrens }), h.uit('Afval', afval / (staven.length * v.stok) * 100, '%', { dec: 1, hoofd: true, opm: h.fmt(afval / 1000, 2) + ' m, zaagsneden inbegrepen' }), h.uit('Totale lengte van de stukken', totaal / 1000, 'm', { dec: 2, opm: stukken.length + ' stukken' }), h.uit('Langste rest', grootsteRest, 'mm', { dec: 0, opm: 'bruikbaar voor een volgend werk' }), h.uit('Aan te kopen', staven.length * v.stok / 1000, 'm', { dec: 1 })],
                            stappen: ['Ondergrens = (' + h.fmt(totaal, 0) + ' mm + zaagsneden) / ' + h.fmt(bruikbaar, 0) + ' mm = ' + ondergrens + ' staven', 'Verdeling: grootste stukken eerst, telkens in de staaf met de kleinste rest'],
                            tabel: { kop: ['Staven', 'Zaagplan (mm)', 'Rest'], rijen: rijen }
                        };
                    }
                },
                {
                    id: 'werf.kernboring', naam: 'Kernboring en doorvoer', kort: 'Welke boor voor een buis met isolatie en speling?',
                    zoek: 'kernboring kernboor doorvoer muurdoorvoer gat boren diameter buis isolatie mantelbuis speling diamantboor', soort: 'exact',
                    bron: 'Gat = buitendiameter + 2 × isolatie + 2 × speling · gangbare kernboren: 32 · 42 · 52 · 62 · 72 · 82 · 92 · 102 · 112 · 122 · 132 · 152 · 162 · 182 · 202 · 225 · 250 mm',
                    velden: [
                        { k: 'D', label: 'Buitendiameter van de buis', eh: 'mm', min: 0, snel: [{ t: '22', v: 22 }, { t: '28', v: 28 }, { t: '50', v: 50 }, { t: '80', v: 80 }, { t: '110', v: 110 }, { t: '125', v: 125 }] },
                        { k: 'iso', label: 'Isolatie rond de buis', eh: 'mm', std: 0, min: 0, snel: [{ t: 'Geen 0', v: 0 }, { t: '9', v: 9 }, { t: '13', v: 13 }, { t: '20', v: 20 }, { t: '30', v: 30 }] },
                        { k: 'sp', label: 'Speling rondom', eh: 'mm', std: 10, min: 0, snel: [{ t: 'Strak 5', v: 5 }, { t: '10', v: 10 }, { t: 'Met mantelbuis 20', v: 20 }] },
                        { k: 'n', label: 'Aantal buizen naast elkaar in één gat', std: 1, min: 1, max: 4 }
                    ],
                    bereken: function (v, h) {
                        var BOREN = [18, 20, 22, 25, 28, 32, 35, 38, 42, 45, 52, 57, 62, 67, 72, 77, 82, 92, 102, 112, 122, 132, 142, 152, 162, 172, 182, 202, 225, 250, 300];
                        var n = Math.round(v.n), een = v.D + 2 * v.iso, bundel = n === 1 ? een : n === 2 ? 2 * een : n === 3 ? een * (1 + 2 / Math.sqrt(3)) : een * (1 + Math.SQRT2);
                        var gat = bundel + 2 * v.sp, boor = h.omhoogNaar(gat, BOREN);
                        return {
                            uit: [h.uit('Kernboor', boor ? 'Ø ' + boor + ' mm' : 'groter dan 300 mm', '', { hoofd: true }), h.uit('Nodige opening', gat, 'mm', { dec: 0, hoofd: true }), h.uit('Buis met isolatie', een, 'mm', { dec: 0 }), h.uit('Speling die overblijft rondom', boor ? (boor - bundel) / 2 : null, 'mm', { dec: 0 })],
                            stappen: ['Buis met isolatie = ' + h.f(v.D, 0) + ' + 2 × ' + h.f(v.iso, 0) + ' = ' + h.f(een, 0, 'mm'), 'Opening = ' + h.fmt(bundel, 0) + ' + 2 × ' + h.f(v.sp, 0) + ' = ' + h.f(gat, 0, 'mm')],
                            opm: 'Boor een afvoer met afschot naar buiten. Door een brandwerende wand of vloer hoort een gekeurde brandmanchet of brandwerende afdichting: de opening volgt dan de fiche van dat product. Boor nooit zonder te weten wat er in de muur zit (leidingen, wapening, spankabels).'
                        };
                    }
                },
                {
                    id: 'werf.beugels', naam: 'Beugelafstanden', kort: 'Grootste afstand tussen de beugels per materiaal en diameter',
                    zoek: 'beugelafstand beugels ophanging afstand bevestiging koper staal meerlagen henco uponor pvc pp afvoer naslag tabel', soort: 'indicatief',
                    bron: 'Koper en staal: DIN 1988-2 (buis gevuld met water) en de voorzichtigere waarden van Sikla voor gevulde en geïsoleerde buis · meerlagenbuis: Henco (ATG 15/2432) en Uponor (technische informatie) · PVC-drukbuis: Sikla · afvoer: werkinstructies van Wavin (PVC: 10 keer de diameter horizontaal, 25 keer verticaal; PP: hoogstens 10 en 25 keer). De fiche van de fabrikant gaat voor.',
                    uitleg: 'Kies het materiaal. Vul je ook de diameter in, dan staat de afstand voor die buis bovenaan. Dunwandig staal in perssystemen: volg de tabel van de fabrikant, die ligt meestal dicht bij die van koper.',
                    velden: [
                        { k: 'mat', label: 'Leiding', type: 'keuze', opties: BEUGELS.map(function (x) { return { v: x.v, t: x.t }; }), std: 'koper' },
                        { k: 'D', label: 'Buitendiameter (staal: DN)', eh: 'mm', opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var B = BEUGELS.filter(function (x) { return x.v === v.mat; })[0] || BEUGELS[0];
                        function m(x) { return x == null ? '–' : h.fmt(x, 2) + ' m'; }
                        function naam(d) { return B.dn ? 'DN ' + d + (DN_DUIM[d] ? ' (' + DN_DUIM[d] + ')' : '') : h.fmt(d, 1) + ' mm'; }
                        var rijen = B.regel ? B.maten.map(function (d) { return [d].concat(B.regel(d)); }) : B.rijen;
                        var res = { tabel: { kop: B.kop, rijen: rijen.map(function (r) { return [naam(r[0])].concat(r.slice(1).map(m)); }) }, opm: 'Zet een beugel bij elke richtingsverandering en bij elk toestel. Warme leidingen moeten kunnen uitzetten: werk met vaste punten en glijbeugels (zie “Uitzetting van leidingen”). Geïsoleerde koudwaterleidingen: gebruik beugels met een isolerende inleg tegen condens. Meerlagenbuis op de ruwe vloer: om de 80 cm vastzetten, en 30 cm voor en na elke bocht. Afvoer in PP: één vastpuntbeugel per buislengte.' };
                        if (v.D != null && v.D > 0) {
                            var waarden, i = -1;
                            if (B.regel) { waarden = B.regel(v.D); i = B.maten.indexOf(v.D); }
                            else { for (var j = 0; j < rijen.length; j++) if (rijen[j][0] <= v.D + 0.5) i = j; if (i < 0) i = 0; waarden = rijen[i].slice(1); }
                            res.uit = B.uit.map(function (label, k) { return h.uit(label, waarden[k] == null ? 'geen waarde in de tabel' : waarden[k], waarden[k] == null ? '' : 'm', { dec: 2, hoofd: k === 0 || (k === 1 && waarden[0] == null) }); });
                            res.tabel.kies = i;
                            if (!B.regel && Math.abs(rijen[i][0] - v.D) > 0.5) res.waarsch = ['Deze maat staat niet in de tabel: de afstand van ' + naam(rijen[i][0]) + ' is genomen.'];
                        }
                        return res;
                    }
                }
            ] },
            { naam: 'Gasflessen', items: [
                {
                    id: 'werf.flessen', naam: 'Gasfles: inhoud en autonomie', kort: 'Hoeveel gas zit er nog in en hoe lang kan je ermee werken?',
                    zoek: 'gasfles fles zuurstof acetyleen stikstof argon menggas propaan inhoud druk bar liter autonomie lassen solderen roofing brander afpersen', soort: 'indicatief',
                    bron: 'Samengeperst gas (zuurstof, stikstof, argon, menggas): inhoud ≈ waterinhoud van de fles × druk (liter gas bij 1 bar) · propaan: 12,8 kWh per kg, 11 kg ≈ 5.600 l gas, 1 kg ≈ 1,96 l vloeibaar; afname per fles volgens GOK (boven 15 °C) · acetyleen is opgelost in aceton: de druk zegt weinig over de inhoud, 1 kg ≈ 909 l gas; afname hoogstens 1/10 van de inhoud per uur bij onderbroken gebruik en 1/15 bij continu gebruik (Air Products) · zuurstof: hoogstens 1.200 tot 1.500 l per uur uit één fles',
                    uitleg: 'Bij zuurstof, stikstof en menggas daalt de druk mee met de inhoud: een fles van 200 bar die 100 bar aanwijst is half leeg. Bij propaan en acetyleen blijft de druk ongeveer gelijk tot de fles bijna leeg is: daar telt het gewicht.',
                    velden: [
                        { k: 'gas', label: 'Gas', type: 'keuze', opties: [{ v: 'o2', t: 'Zuurstof' }, { v: 'n2', t: 'Stikstof (afpersen)' }, { v: 'ar', t: 'Argon of menggas' }, { v: 'c3', t: 'Propaan (gewicht)' }, { v: 'c2', t: 'Acetyleen (gewicht)' }], std: 'o2' },
                        { k: 'V', label: 'Waterinhoud van de fles', eh: 'l', std: 20, min: 0, snel: [{ t: '5', v: 5 }, { t: '10', v: 10 }, { t: '20', v: 20 }, { t: '40', v: 40 }, { t: '50', v: 50 }] },
                        { k: 'p', label: 'Druk op de manometer', eh: 'bar', std: 150, min: 0, snel: [{ t: '200', v: 200 }, { t: '150', v: 150 }, { t: '100', v: 100 }, { t: '50', v: 50 }] },
                        { k: 'kg', label: 'Inhoud in kg (propaan of acetyleen)', eh: 'kg', std: 10.5, min: 0, snel: [{ t: '6', v: 6 }, { t: '10,5', v: 10.5 }, { t: '18', v: 18 }, { t: '35', v: 35 }] },
                        { k: 'q', label: 'Verbruik', eh: 'l/min', opt: true, min: 0, snel: [{ t: 'Solderen 3', v: 3 }, { t: 'Lassen 5', v: 5 }, { t: 'Snijden 15', v: 15 }], hint: 'samengeperst gas en acetyleen: liter gas per minuut' },
                        { k: 'P', label: 'Belasting van de brander (propaan)', eh: 'kW', opt: true, min: 0, snel: [{ t: 'Soldeerbrander 3', v: 3 }, { t: 'Dakbrander 60', v: 60 }, { t: 'Heteluchtkanon 30', v: 30 }] }
                    ],
                    bereken: function (v, h) {
                        var uit = [], st = [], waarsch = [];
                        if (v.gas === 'c3') {
                            var E = v.kg * 12.8, m3 = v.kg * 5.6 / 11, cont = h.interp(v.kg, PROPAAN_KG, PROPAAN_CONT), kortst = h.interp(v.kg, PROPAAN_KG, PROPAAN_KORT);
                            uit.push(h.uit('Energie in de fles', E, 'kWh', { dec: 0, hoofd: true }), h.uit('Gas', m3, 'm³', { dec: 2, opm: h.fmt(v.kg / 0.51, 1) + ' l vloeibaar' }));
                            st.push('E = ' + h.f(v.kg, 1) + ' kg × 12,8 kWh/kg = ' + h.f(E, 0, 'kWh'));
                            if (v.P > 0) {
                                var kgh = v.P / 12.8;
                                uit.push(h.uit('Autonomie bij ' + h.fmt(v.P, 1) + ' kW', uurTekst(E / v.P * 60), '', { hoofd: true }), h.uit('Verbruik', kgh, 'kg/h', { dec: 2 }));
                                st.push('Verbruik = ' + h.f(v.P, 1) + ' kW / 12,8 = ' + h.f(kgh, 2, 'kg/h'));
                                if (kgh > kortst) waarsch.push('Deze brander vraagt ' + h.fmt(kgh, 1) + ' kg per uur. Een fles van ' + h.fmt(v.kg, 1) + ' kg levert continu ±' + h.fmt(cont, 1) + ' kg/h en kort ±' + h.fmt(kortst, 1) + ' kg/h: ze koelt snel af en de druk zakt. Brand in korte beurten, wissel tussen flessen of koppel er meerdere.');
                                else if (kgh > cont) waarsch.push('Boven de continue afname van ±' + h.fmt(cont, 1) + ' kg/h: goed voor kort gebruik. Bij lang branden koelt de fles af en zakt de druk.');
                            }
                            uit.push(h.uit('Afname continu', cont, 'kg/h', { dec: 1, opm: '±' + h.fmt(cont * 12.8, 0) + ' kW' }), h.uit('Afname kortstondig', kortst, 'kg/h', { dec: 1, opm: '±' + h.fmt(kortst * 12.8, 0) + ' kW' }));
                            return { uit: uit, stappen: st, waarsch: waarsch, opm: 'De druk in een propaanfles hangt af van de temperatuur, niet van de inhoud. Weeg de fles: het leeggewicht (tarra) staat op de kraag. De afname geldt voor een volle fles bij meer dan 15 °C: bij koud weer en bij een bijna lege fles is het minder.' };
                        }
                        if (v.gas === 'c2') {
                            var l2 = v.kg * 909;
                            uit.push(h.uit('Gas in de fles', l2, 'l', { dec: 0, hoofd: true, opm: h.fmt(l2 / 1000, 2) + ' m³' }), h.uit('Grootste afname, onderbroken gebruik', l2 / 10, 'l/h', { dec: 0, opm: '1/10 van de inhoud per uur' }), h.uit('Grootste afname, continu', l2 / 15, 'l/h', { dec: 0, opm: '1/15 van de inhoud per uur' }));
                            st.push('Gas = ' + h.f(v.kg, 1) + ' kg × 909 l/kg = ' + h.f(l2, 0, 'l'));
                            if (v.q > 0) { uit.push(h.uit('Autonomie bij ' + h.fmt(v.q, 1) + ' l/min', uurTekst(l2 / v.q), '', { hoofd: true })); if (v.q * 60 > l2 / 10) waarsch.push('Het verbruik ligt boven 1/10 van de inhoud per uur: de fles geeft dan aceton mee. Koppel twee flessen of neem een grotere fles.'); else if (v.q * 60 > l2 / 15) waarsch.push('Het verbruik ligt boven 1/15 van de inhoud per uur: goed voor kort werk, niet voor continu gebruik.'); }
                            return { uit: uit, stappen: st, waarsch: waarsch, opm: 'Acetyleenflessen altijd rechtop gebruiken en vervoeren. De vulling staat in kg op de fles (±0,18 tot 0,20 kg per liter flesinhoud); de druk (±18 bar vol) hangt af van de temperatuur en zegt weinig over de inhoud.' };
                        }
                        var liter = v.V * v.p, vol = v.V * 200;
                        uit.push(h.uit('Gas in de fles', liter, 'l', { dec: 0, hoofd: true, opm: h.fmt(liter / 1000, 2) + ' m³' }), h.uit('Vulling ten opzichte van 200 bar', v.V > 0 ? liter / vol * 100 : 0, '%', { dec: 0 }));
                        st.push('Gas = ' + h.f(v.V, 1) + ' l × ' + h.f(v.p, 0) + ' bar = ' + h.f(liter, 0, 'l'));
                        if (v.q > 0) { uit.push(h.uit('Autonomie bij ' + h.fmt(v.q, 1) + ' l/min', uurTekst(liter / v.q), '', { hoofd: true })); st.push('Tijd = ' + h.f(liter, 0) + ' l / ' + h.f(v.q, 1) + ' l/min = ' + h.f(liter / v.q, 0, 'min')); }
                        if (v.p > 0 && v.p < 10) waarsch.push('Minder dan 10 bar: de fles is zo goed als leeg. Laat altijd een kleine restdruk staan zodat er geen lucht of vocht in de fles komt.');
                        if (v.gas === 'o2' && v.q > 0 && v.q * 60 > 1500) waarsch.push('Meer dan 1.500 l per uur uit één zuurstoffles: koppel flessen, anders kan de drukregelaar bevriezen.');
                        return { uit: uit, stappen: st, waarsch: waarsch, opm: v.gas === 'n2' ? 'Om een installatie af te persen is weinig gas nodig: inhoud van de leidingen in liter × testdruk in bar. Gebruik altijd een drukregelaar en nooit zuurstof of perslucht met olie op een koelcircuit.' : 'Richtwaarde: bij 200 bar wijkt een echt gas enkele procenten af van deze regel.' };
                    }
                }
            ] },
            { naam: 'Kantoor', items: [
                {
                    id: 'werf.btw', naam: 'Btw en korting', kort: 'Van exclusief naar inclusief en terug, met 6, 12 of 21 procent',
                    zoek: 'btw inclusief exclusief 6 procent 21 procent korting prijs bedrag factuur offerte renovatie', soort: 'exact',
                    bron: 'Inclusief = exclusief × (1 + btw) · exclusief = inclusief / (1 + btw) · korting eerst, daarna btw',
                    velden: [
                        { k: 'bedrag', label: 'Bedrag', eh: '€', min: 0 },
                        { k: 'richting', label: 'Dit bedrag is', type: 'keuze', opties: [{ v: 'excl', t: 'Exclusief btw' }, { v: 'incl', t: 'Inclusief btw' }], std: 'excl' },
                        { k: 'btw', label: 'Btw-tarief', type: 'keuze', opties: [{ v: 21, t: '21 %' }, { v: 6, t: '6 %' }, { v: 12, t: '12 %' }, { v: 0, t: '0 % (btw verlegd of vrijgesteld)' }], std: 21 },
                        { k: 'korting', label: 'Korting', eh: '%', std: 0, min: 0, max: 100 }
                    ],
                    bereken: function (v, h) {
                        var t = Number(v.btw) / 100, excl0 = v.richting === 'incl' ? v.bedrag / (1 + t) : v.bedrag;
                        var kort = excl0 * v.korting / 100, excl = excl0 - kort, btw = excl * t, incl = excl + btw;
                        var uit = [h.uit('Inclusief btw', incl, '€', { dec: 2, hoofd: true }), h.uit('Exclusief btw', excl, '€', { dec: 2, hoofd: true }), h.uit('Btw ' + h.fmt(Number(v.btw), 0) + ' %', btw, '€', { dec: 2 })];
                        if (v.korting > 0) uit.push(h.uit('Korting ' + h.fmt(v.korting, 1) + ' %', kort, '€', { dec: 2, opm: 'op ' + h.fmt(excl0, 2) + ' exclusief' }));
                        var rijen = [21, 12, 6, 0].map(function (p) { return [p + ' %', h.fmt(excl, 2), h.fmt(excl * p / 100, 2), h.fmt(excl * (1 + p / 100), 2)]; });
                        return { uit: uit, stappen: ['Exclusief = ' + h.fmt(excl0, 2) + ' − ' + h.fmt(kort, 2) + ' = ' + h.fmt(excl, 2), 'Inclusief = ' + h.fmt(excl, 2) + ' × ' + h.fmt(1 + t, 2) + ' = ' + h.fmt(incl, 2)], tabel: { kop: ['Tarief', 'Exclusief', 'Btw', 'Inclusief'], rijen: rijen, kies: [21, 12, 6, 0].indexOf(Number(v.btw)) }, opm: 'Het tarief van 6 % geldt onder voorwaarden voor werken aan een privéwoning die ouder is dan 10 jaar. Het bureel bepaalt welk tarief op de factuur komt.' };
                    }
                },
                {
                    id: 'werf.marge', naam: 'Marge en opslag', kort: 'Van inkoop naar verkoop, en het verschil tussen marge en opslag',
                    zoek: 'marge opslag winstmarge inkoop verkoop kostprijs verkoopprijs procent markup calculatie', soort: 'exact',
                    bron: 'Opslag = (verkoop − inkoop) / inkoop · marge = (verkoop − inkoop) / verkoop · marge = opslag / (1 + opslag)',
                    uitleg: 'Vul twee waarden in. Opslag reken je op de inkoopprijs, marge op de verkoopprijs. 25 % opslag is dus 20 % marge.',
                    velden: [
                        { k: 'inkoop', label: 'Inkoop', eh: '€', opt: true, min: 0 },
                        { k: 'verkoop', label: 'Verkoop', eh: '€', opt: true, min: 0 },
                        { k: 'opslag', label: 'Opslag op de inkoop', eh: '%', opt: true, min: 0 },
                        { k: 'marge', label: 'Marge op de verkoop', eh: '%', opt: true, min: 0, max: 99.9 }
                    ],
                    bereken: function (v, h) {
                        var i = v.inkoop, s = v.verkoop, o = v.opslag != null ? v.opslag / 100 : null, m = v.marge != null ? v.marge / 100 : null;
                        if (i != null && s != null) { if (!(i > 0) || !(s > 0)) return { fout: 'Inkoop en verkoop moeten groter zijn dan 0' }; o = (s - i) / i; m = (s - i) / s; }
                        else if (o == null && m == null) return { wacht: true, ontbreekt: ['twee waarden'] };
                        else {
                            if (o == null) o = m / (1 - m); else m = o / (1 + o);
                            if (i != null) s = i * (1 + o); else if (s != null) i = s / (1 + o);
                        }
                        var uit = [h.uit('Opslag op de inkoop', o * 100, '%', { dec: 2, hoofd: v.opslag == null }), h.uit('Marge op de verkoop', m * 100, '%', { dec: 2, hoofd: v.marge == null })];
                        if (i != null && s != null) uit.unshift(h.uit('Verkoop', s, '€', { dec: 2, hoofd: v.verkoop == null }), h.uit('Inkoop', i, '€', { dec: 2, hoofd: v.inkoop == null }), h.uit('Winst', s - i, '€', { dec: 2 }));
                        var rijen = [10, 15, 20, 25, 30, 35, 40, 50, 60, 75, 100].map(function (p) { return [p + ' %', h.fmt(p / (100 + p) * 100, 1) + ' %', '× ' + h.fmt(1 + p / 100, 2)]; });
                        return { uit: uit, stappen: ['Marge = opslag / (1 + opslag) = ' + h.fmt(o, 4) + ' / ' + h.fmt(1 + o, 4) + ' = ' + h.f(m * 100, 2, '%')], tabel: { kop: ['Opslag', 'Marge', 'Factor op de inkoop'], rijen: rijen } };
                    }
                },
                {
                    id: 'werf.uren', naam: 'Uren en minuten', kort: 'Van begin tot einde min de pauze, of tijden optellen',
                    zoek: 'uren minuten werktijd duur begin einde pauze optellen decimaal kwartier afronden tijd werkbon', soort: 'exact',
                    bron: 'Duur = einde − begin − pauze · decimale uren = minuten / 60 · afronden op het dichtste kwartier',
                    uitleg: 'Schrijf een tijd als 7:30, 7u30 of 730. In de lijst mag je duren optellen, bijvoorbeeld 2:15 1:30 0:45.',
                    velden: [
                        { k: 'van', label: 'Begin', type: 'tekst', std: '07:30' },
                        { k: 'tot', label: 'Einde', type: 'tekst', std: '16:15' },
                        { k: 'pauze', label: 'Pauze', eh: 'min', std: 45, min: 0 },
                        { k: 'lijst', label: 'of tel duren op (gescheiden door een spatie)', type: 'tekst', std: '' },
                        { k: 'tarief', label: 'Uurtarief', eh: '€/h', opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var min, st = [];
                        var stukken = String(v.lijst || '').split(/[\s;+]+/).filter(Boolean);
                        if (stukken.length) {
                            var som = 0, fout = null;
                            stukken.forEach(function (s) { var t = tijd(s); if (t == null) fout = s; else som += t; });
                            if (fout) return { fout: 'Deze tijd begrijp ik niet: ' + fout };
                            min = som; st.push('Som van ' + stukken.length + ' duren = ' + h.fmt(min, 0) + ' min');
                        } else {
                            var a = tijd(v.van), b = tijd(v.tot);
                            if (a == null || b == null) return { wacht: true, ontbreekt: ['begin en einde'] };
                            if (a >= 1440 || b > 1440) return { fout: 'Een uur ligt tussen 0:00 en 24:00' };
                            var bruto = b - a; if (bruto < 0) bruto += 1440;
                            min = bruto - v.pauze;
                            if (min < 0) return { fout: 'De pauze is langer dan de werktijd' };
                            st.push(klok(b) + ' − ' + klok(a) + ' = ' + uurTekst(bruto), uurTekst(bruto) + ' − ' + h.fmt(v.pauze, 0) + ' min pauze = ' + uurTekst(min));
                        }
                        var kw = Math.round(min / 15) * 15;
                        var uit = [h.uit('Duur', uurTekst(min), '', { hoofd: true }), h.uit('Decimaal', min / 60, 'uur', { dec: 2, hoofd: true }), h.uit('Afgerond op een kwartier', uurTekst(kw), '', { opm: h.fmt(kw / 60, 2) + ' uur' }), h.uit('In minuten', min, 'min', { dec: 0 })];
                        if (v.tarief > 0) uit.push(h.uit('Bedrag', min / 60 * v.tarief, '€', { dec: 2, opm: 'op het kwartier: ' + h.fmt(kw / 60 * v.tarief, 2) }));
                        return { uit: uit, stappen: st };
                    }
                }
            ] }
        ]
    });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-werf */
