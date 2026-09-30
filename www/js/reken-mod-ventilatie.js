/* QE Rekenmachine — module Ventilatie & rookgas (v408; v411: kanaaltraject, roosters, meten, vochtige lucht;
 * koellast en koelmiddel staan sinds v411 in reken-mod-airco.js)
 * BRON = QE-Software/reken-mod-ventilatie.js; kopie in de www via `node sync-reken.js`.
 * Normen/bronnen: NBN D 50-001 + EPB (woningventilatie), EN 13384-1 (schouwberekening, vereenvoudigd),
 * NBN B 61-001 / B 61-002 (stookplaatsen en schoorstenen), NBN D 51-003 (gas: verbrandingslucht),
 * EN 16798 (CO₂-klassen), F-gassenverordening (EU) 2024/573, Magnus (dauwpunt).
 */
(function (root) {
    'use strict';
    var R = root.QEReken;
    if (!R) throw new Error('reken-kern.js eerst laden');
    var L = R.LUCHT;
    var RUIMTES = [
        { v: 'woon', t: 'Woonkamer', soort: 'toe', min: 75, max: 150 }, { v: 'slaap', t: 'Slaapkamer / bureau / speelkamer', soort: 'toe', min: 25, max: 72 },
        { v: 'keuken', t: 'Keuken (gesloten)', soort: 'af', min: 50, max: 75 }, { v: 'openkeuken', t: 'Open keuken (bij woonkamer)', soort: 'af', min: 75, max: 75 },
        { v: 'bad', t: 'Badkamer', soort: 'af', min: 50, max: 75 }, { v: 'was', t: 'Wasplaats / berging', soort: 'af', min: 50, max: 75 }, { v: 'wc', t: 'WC', soort: 'af', min: 25, max: 25 }
    ];
    var KANALEN = [80, 100, 125, 150, 160, 180, 200, 250, 315, 355, 400, 450, 500];
    // rookgasafvoer: massadebiet per kW belasting (g/s), rookgastemperatuur aan het toestel (°C), nodige trek (Pa; 0 = toestel met ventilator)
    var TOESTELLEN = [
        { v: 'atm', t: 'Atmosferische gasketel / gaskachel (open, type B11)', f: 0.9, T: 110, trek: 3, dauw: 55, dmin: 80 },
        { v: 'gasgesl', t: 'Gasketel met ventilator, niet-condenserend', f: 0.5, T: 140, trek: 0, dauw: 55, dmin: 80 },
        { v: 'cond', t: 'Condenserende gasketel (overdruk-afvoer)', f: 0.47, T: 60, trek: 0, dauw: 55, dmin: 80 },
        { v: 'olie_geel', t: 'Stookolieketel, gele brander (natuurlijke trek)', f: 0.5, T: 200, trek: 8, dauw: 47, dmin: 130 },
        { v: 'olie_bl', t: 'Stookolieketel, blauwe brander / ventilator', f: 0.45, T: 150, trek: 0, dauw: 47, dmin: 100 },
        { v: 'pellet', t: 'Pelletketel / pelletkachel', f: 0.6, T: 130, trek: 6, dauw: 50, dmin: 80 },
        { v: 'hout', t: 'Houtkachel (nominaal vermogen)', f: 1.0, T: 250, trek: 12, dauw: 50, dmin: 150 },
        { v: 'houtketel', t: 'Houtvergasser / houtketel', f: 0.6, T: 160, trek: 10, dauw: 50, dmin: 150 }
    ];
    var SCHOUWEN = [
        { v: 'rvs2', t: 'Dubbelwandig RVS geïsoleerd', koel: 2, lam: 0.02 }, { v: 'keram', t: 'Gemetseld met keramische/RVS voering', koel: 4, lam: 0.03 },
        { v: 'metsel', t: 'Gemetseld zonder voering', koel: 6, lam: 0.04 }, { v: 'enkel_bin', t: 'Enkelwandig metaal, binnen', koel: 6, lam: 0.02 }, { v: 'enkel_bui', t: 'Enkelwandig metaal, buiten', koel: 12, lam: 0.02 }
    ];
    var DIAMETERS = [80, 100, 110, 125, 130, 150, 160, 180, 200, 250, 300, 350, 400];
    function rho(T) { return 1.293 * 273.15 / (273.15 + T); }
    // v411 — vochtige lucht (Magnus boven water; drukken in hPa, x in kg per kg droge lucht, h in kJ/kg)
    function pws(T) { return 6.112 * Math.exp(17.62 * T / (243.12 + T)); }
    function dauw(pv) { var g = Math.log(pv / 6.112); return 243.12 * g / (17.62 - g); }
    function lucht(T, rv, p) {
        var pv = pws(T) * rv / 100, x = 0.622 * pv / (p - pv);
        return { pv: pv, x: x, h: 1.006 * T + x * (2501 + 1.86 * T), td: dauw(pv), rho: (p - pv) * 100 / (287.05 * (T + 273.15)) + pv * 100 / (461.5 * (T + 273.15)) };
    }
    function natteBol(T, rv, p) {
        var pv = pws(T) * rv / 100, lo = -60, hi = T;
        for (var i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (pws(m) - 6.62e-4 * p * (T - m) - pv > 0) hi = m; else lo = m; }
        return (lo + hi) / 2;
    }
    var VINK = String.fromCharCode(0x2713);

    // v411 — verluchting tot 70 kW: cm² vrije doorlaat per kW [van buiten, 1 doorstroomopening, 2 doorstroomopeningen]
    var STOOK = [
        { v: 'b1', t: 'Gas, type B1 (open toestel met trekonderbreker)', kort: 'Gas B1, met trekonderbreker', gas: true, f: [6, 8, 10] },
        { v: 'b2', t: 'Gas, type B2 of B3 (open toestel zonder trekonderbreker)', kort: 'Gas B2 en B3', gas: true, f: [3, 4, 5] },
        { v: 'olie', t: 'Stookolie (open toestel)', kort: 'Stookolie', f: [3, 3, 3] },
        { v: 'pellet', t: 'Pellets of kolen', kort: 'Pellets of kolen', f: [6, 6, 6] },
        { v: 'hout', t: 'Hout', kort: 'Hout', f: [30, 30, 30] },
        { v: 'a', t: 'Gas, type A (zonder afvoer, bijvoorbeeld een kooktoestel)', kort: 'Gas type A, zonder afvoer', gas: true, f: [13, 18, 23] },
        { v: 'c', t: 'Type C (gesloten toestel)' }
    ];
    R.registreer({
        key: 'ventilatie', naam: 'Ventilatie & rookgas', emoji: '🌬️', volgorde: 4,
        omschrijving: 'Woningventilatie en luchtdichtheid, kanalen en roosters, schouw en verluchting van het stooklokaal, vochtige lucht en geluid',
        groepen: [
            { naam: 'Woningventilatie', items: [
                {
                    id: 'vent.woning', naam: 'Ventilatiedebieten per ruimte (NBN D 50-001)', kort: 'Toevoer, afvoer en de grootte van de unit',
                    zoek: 'ventilatie woning debiet per ruimte nbn d 50-001 epb systeem c d toevoer afvoer wtw unit m3/h', soort: 'indicatief',
                    bron: 'NBN D 50-001 / EPB: ontwerpdebiet 3,6 m³/h per m² vloer; droge ruimtes: woonkamer min 75 – max 150, slaapkamer/bureau min 25 – max 72; natte ruimtes: keuken/badkamer/wasplaats min 50 – max 75 (open keuken 75), WC 25; totaal toevoer = totaal afvoer (grootste van beide)',
                    velden: [
                        { k: 'rijen', label: 'Ruimtes', type: 'rijen', kolommen: [{ k: 'r', label: 'Ruimte', type: 'keuze', opties: RUIMTES }, { k: 'A', label: 'm²', type: 'getal' }], std: [{ r: 'woon', A: 35 }, { r: 'openkeuken', A: 12 }, { r: 'slaap', A: 16 }, { r: 'slaap', A: 12 }, { r: 'slaap', A: 10 }, { r: 'bad', A: 7 }, { r: 'wc', A: 1.5 }, { r: 'was', A: 6 }] },
                        { k: 'sys', label: 'Systeem', type: 'keuze', opties: [{ v: 'C', t: 'C — natuurlijke toevoer, mechanische afvoer' }, { v: 'D', t: 'D — mechanisch met warmteterugwinning' }, { v: 'A', t: 'A — natuurlijk' }, { v: 'B', t: 'B — mechanische toevoer, natuurlijke afvoer' }], std: 'D' },
                        { k: 'marge', label: 'Marge unit', eh: '%', std: 20 }
                    ],
                    bereken: function (v, h) {
                        var toe = 0, af = 0, rijen = [];
                        v.rijen.forEach(function (r) {
                            var t = RUIMTES.filter(function (x) { return x.v === r.r; })[0]; if (!t || !r.A) return;
                            var q = Math.min(t.max, Math.max(t.min, 3.6 * r.A));
                            if (t.soort === 'toe') toe += q; else af += q;
                            rijen.push([t.t, h.fmt(r.A, 1) + ' m²', h.fmt(3.6 * r.A, 0), h.fmt(q, 0) + ' m³/h ' + (t.soort === 'toe' ? 'toevoer' : 'afvoer')]);
                        });
                        if (!rijen.length) return { wacht: true, ontbreekt: ['minstens één ruimte'] };
                        var tot = Math.max(toe, af), unit = tot * (1 + v.marge / 100);
                        var uit = [h.uit('Toevoer (droge ruimtes)', toe, 'm³/h', { dec: 0 }), h.uit('Afvoer (natte ruimtes)', af, 'm³/h', { dec: 0 }), h.uit('Ontwerpdebiet installatie', tot, 'm³/h', { dec: 0, hoofd: true })];
                        if (v.sys === 'D') uit.push(h.uit('Unit kiezen (bij 150 Pa) minstens', unit, 'm³/h', { dec: 0, hoofd: true, opm: 'maat ' + h.omhoogNaar(unit, [150, 200, 250, 300, 350, 400, 450, 500, 600]) }));
                        else if (v.sys === 'C') uit.push(h.uit('Afzuigunit (bij 100 Pa) minstens', af * (1 + v.marge / 100), 'm³/h', { dec: 0, hoofd: true }), h.uit('Raamroosters voor toevoer', toe, 'm³/h', { dec: 0, opm: 'som van de roosters bij 2 Pa; verdeel per droge ruimte' }));
                        return {
                            uit: uit, tabel: { kop: ['Ruimte', 'Opp.', '3,6 × m²', 'Ontwerp'], rijen: rijen },
                            stappen: ['Per ruimte: 3,6 m³/h × m², begrensd door min/max van de norm', 'Installatie = max(Σ toevoer, Σ afvoer) = ' + h.f(tot, 0, 'm³/h')],
                            opm: 'Doorstroomopeningen: 25 m³/h onder deuren (spleet 1 cm bij 70 cm breedte) of 70 cm² rooster; WC 25 m³/h. Kanaaldiameters: “Kanaaldiameter en drukverlies”.'
                        };
                    }
                },
                {
                    id: 'vent.ach', naam: 'Luchtverversing (ACH)', kort: 'Debiet uit ruimte en aantal wisselingen per uur, of omgekeerd',
                    zoek: 'luchtverversing ach luchtwisselingen per uur debiet ruimte volume garage kantoor', soort: 'indicatief',
                    bron: 'Q = V × n · richtwaarden n (1/h): woonkamer 0,5–1, slaapkamer 0,5–1, badkamer 4–8, keuken 10–15, WC 4–6, garage 4–6, kantoor 2–4, klas 4–6, atelier 4–8, stookplaats 1–2',
                    velden: [
                        { k: 'A', label: 'Oppervlakte', eh: 'm²' },
                        { k: 'hgt', label: 'Hoogte', eh: 'm', std: 2.6 },
                        { k: 'n', label: 'Luchtwisselingen', eh: '1/h', opt: true, snel: [{ t: 'Woon 0,7', v: 0.7 }, { t: 'Bad 6', v: 6 }, { t: 'Keuken 12', v: 12 }, { t: 'Garage 5', v: 5 }, { t: 'Kantoor 3', v: 3 }, { t: 'Atelier 6', v: 6 }] },
                        { k: 'Q', label: 'of gewenst debiet', eh: 'm³/h', ehs: ['m³/h', 'l/s', 'cfm'], opt: true }
                    ],
                    bereken: function (v, h) {
                        var V = v.A * v.hgt;
                        if (v.n == null && v.Q == null) return { wacht: true, ontbreekt: ['luchtwisselingen of debiet'] };
                        var Q = v.Q != null ? v.Q : V * v.n, n = v.Q != null ? v.Q / V : v.n;
                        return { uit: [h.uit('Debiet', Q, 'm³/h', { dec: 0, hoofd: v.Q == null, opm: h.fmt(Q / 3.6, 1) + ' l/s' }), h.uit('Luchtwisselingen', n, '1/h', { dec: 2, hoofd: v.Q != null }), h.uit('Ruimtevolume', V, 'm³', { dec: 1 })], stappen: ['V = ' + h.f(v.A) + ' × ' + h.f(v.hgt) + ' = ' + h.f(V, 1, 'm³'), 'Q = V × n'] };
                    }
                },
                {
                    id: 'vent.dampkap', naam: 'Dampkap en keukenafzuiging', kort: 'Debiet uit keukenvolume, kanaalmaat en aandachtspunten',
                    zoek: 'dampkap afzuigkap keuken afzuiging debiet m3/h kanaal 125 150 recirculatie gastoestel', soort: 'indicatief',
                    bron: 'Woonkeuken: 10–15 luchtwisselingen per uur; kanaal 125 mm tot ±350 m³/h, 150 mm tot ±550 m³/h (snelheid ≤ 8 m/s), zo kort en recht mogelijk',
                    velden: [
                        { k: 'A', label: 'Keukenoppervlakte', eh: 'm²' },
                        { k: 'hgt', label: 'Hoogte', eh: 'm', std: 2.6 },
                        { k: 'n', label: 'Luchtwisselingen', eh: '1/h', std: 12, snel: [{ t: 'Rustig 10', v: 10 }, { t: 'Normaal 12', v: 12 }, { t: 'Veel koken 15', v: 15 }] },
                        { k: 'gas', label: 'Open gastoestel (type B) in dezelfde ruimte', type: 'vink', std: false }
                    ],
                    bereken: function (v, h) {
                        var Q = v.A * v.hgt * v.n, kan = Q <= 350 ? 125 : Q <= 550 ? 150 : 200;
                        var waarsch = [];
                        if (v.gas) waarsch.push('Een afvoerdampkap kan de trek van een open gastoestel omkeren (CO!): enkel met een venstercontact/voldoende toevoeropening, of kies recirculatie (NBN D 51-003).');
                        return { uit: [h.uit('Dampkapdebiet', Q, 'm³/h', { dec: 0, hoofd: true }), h.uit('Afvoerkanaal', 'Ø ' + kan + ' mm', '', { hoofd: true }), h.uit('Keukenvolume', v.A * v.hgt, 'm³', { dec: 1 })], stappen: ['Q = ' + h.f(v.A) + ' × ' + h.f(v.hgt) + ' × ' + h.f(v.n) + ' = ' + h.f(Q, 0, 'm³/h')], waarsch: waarsch, opm: 'Terugslagklep aan de gevel, geen flexibele slang op lange trajecten, en de dampkap telt niet mee als hygiënische ventilatie (EPB).' };
                    }
                },
                {
                    id: 'vent.luchtdichtheid', naam: 'Luchtdichtheid: n50 en v50', kort: 'Uitslag van de blowerdoortest omrekenen en begrijpen',
                    zoek: 'luchtdichtheid blowerdoor blowerdoortest n50 v50 lekdebiet 50 pascal epb infiltratie lekken passiefhuis luchtdichtheidsmeting', soort: 'exact',
                    bron: 'n50 = lekdebiet bij 50 Pa / inwendig volume · v50 = lekdebiet bij 50 Pa / verliesoppervlakte · EPB rekent met v50 = 12 m³/(h·m²) als er geen meting is · passiefhuis: n50 hoogstens 0,6 per uur · natuurlijke infiltratie ≈ n50 / 20 (vuistregel) · gat met dezelfde lek: A = Q / (0,61 × √(2 × 50 / 1,2))',
                    uitleg: 'Vul één van de drie waarden in (lekdebiet, n50 of v50), samen met het volume en de verliesoppervlakte. De rest volgt.',
                    velden: [
                        { k: 'q', label: 'Lekdebiet bij 50 Pa', eh: 'm³/h', opt: true, min: 0 },
                        { k: 'n50', label: 'of n50', eh: '1/h', opt: true, min: 0 },
                        { k: 'v50', label: 'of v50', eh: 'm³/(h·m²)', opt: true, min: 0, snel: [{ t: 'EPB zonder meting 12', v: 12 }] },
                        { k: 'V', label: 'Inwendig volume', eh: 'm³', opt: true, min: 0 },
                        { k: 'A', label: 'Verliesoppervlakte', eh: 'm²', opt: true, min: 0, hint: 'alle wanden, daken en vloeren rond het beschermd volume' },
                        { k: 'dT', label: 'Temperatuurverschil binnen en buiten', eh: 'K', std: 28, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var q = v.q, st = [];
                        if (q == null && v.n50 != null) { if (!(v.V > 0)) return { wacht: true, ontbreekt: ['Inwendig volume'] }; q = v.n50 * v.V; st.push('Lekdebiet = ' + h.f(v.n50, 2) + ' × ' + h.f(v.V, 0) + ' m³ = ' + h.f(q, 0, 'm³/h')); }
                        if (q == null && v.v50 != null) { if (!(v.A > 0)) return { wacht: true, ontbreekt: ['Verliesoppervlakte'] }; q = v.v50 * v.A; st.push('Lekdebiet = ' + h.f(v.v50, 2) + ' × ' + h.f(v.A, 0) + ' m² = ' + h.f(q, 0, 'm³/h')); }
                        if (q == null) return { wacht: true, ontbreekt: ['lekdebiet, n50 of v50'] };
                        if (!(v.V > 0) && !(v.A > 0)) return { wacht: true, ontbreekt: ['volume of verliesoppervlakte'] };
                        var n50 = v.V > 0 ? q / v.V : null, v50 = v.A > 0 ? q / v.A : null, gat = q / 3600 / (0.61 * Math.sqrt(2 * 50 / 1.2)) * 10000;
                        var oordeel = n50 == null ? null : n50 <= 0.6 ? 'passiefhuisniveau' : n50 <= 1 ? 'zeer goed' : n50 <= 3 ? 'goed' : 'meer dan 3: ruimte voor verbetering';
                        var uit = [h.uit('n50', n50, '1/h', { dec: 2, hoofd: true, opm: oordeel || '' }), h.uit('v50', v50, 'm³/(h·m²)', { dec: 2, hoofd: true, opm: v50 == null ? '' : v50 < 12 ? 'beter dan de EPB-waarde zonder meting (12)' : 'niet beter dan de EPB-waarde zonder meting (12)' }), h.uit('Lekdebiet bij 50 Pa', q, 'm³/h', { dec: 0 }), h.uit('Alle lekken samen, als één gat', gat, 'cm²', { dec: 0, opm: 'een vierkant van ' + h.fmt(Math.sqrt(gat), 0) + ' cm' })];
                        if (n50 != null) { var inf = n50 / 20, P = 0.34 * inf * v.V * v.dT; uit.push(h.uit('Natuurlijke infiltratie', inf, '1/h', { dec: 2, opm: h.fmt(inf * v.V, 0) + ' m³/h' }), h.uit('Warmteverlies door de lekken', P, 'W', { dec: 0, opm: 'bij ΔT ' + h.fmt(v.dT, 0) + ' K' })); st.push('Infiltratie ≈ ' + h.fmt(n50, 2) + ' / 20 = ' + h.f(inf, 2, '1/h'), 'Warmteverlies = 0,34 × ' + h.fmt(inf * v.V, 0) + ' m³/h × ' + h.f(v.dT, 0) + ' K = ' + h.f(P, 0, 'W')); }
                        return { uit: uit, stappen: st, opm: 'De meting zelf gebeurt volgens STS-P 71-3 door een erkend meetbedrijf. Een luchtdichte woning heeft een ventilatiesysteem nodig: zie “Ventilatiedebieten per ruimte”. Open toestellen (type B) en een luchtdichte woning gaan niet samen.' };
                    }
                },
                {
                    id: 'vent.co2', naam: 'CO₂ en verse lucht per persoon', kort: 'Hoeveel buitenlucht om onder 1.000 ppm te blijven?',
                    zoek: 'co2 ppm personen verse lucht per persoon klaslokaal vergaderzaal 1000 ppm en 16798 ida', soort: 'exact',
                    bron: 'Q = G / (C_binnen − C_buiten); CO₂-productie zittend 18 l/h, licht werk 25, zwaar 40; buitenlucht ±420 ppm; EN 16798: klasse II ≤ 800 ppm boven buiten (±1.200), Vlaamse scholen streef ≤ 900–1.200 ppm',
                    velden: [
                        { k: 'pers', label: 'Personen', std: 20, min: 1 },
                        { k: 'act', label: 'Activiteit', type: 'keuze', opties: [{ v: 18, t: 'Zittend (18 l/h CO₂)' }, { v: 25, t: 'Licht werk (25)' }, { v: 40, t: 'Zwaar werk / sport (40)' }], std: 18 },
                        { k: 'cin', label: 'Gewenste CO₂ binnen', eh: 'ppm', std: 1000, snel: [{ t: '800', v: 800 }, { t: '1.000', v: 1000 }, { t: '1.200', v: 1200 }] },
                        { k: 'cout', label: 'CO₂ buiten', eh: 'ppm', std: 420 }
                    ],
                    bereken: function (v, h) {
                        if (v.cin <= v.cout) return { fout: 'Binnen moet hoger zijn dan buiten' };
                        var q = Number(v.act) / 1000 / ((v.cin - v.cout) / 1e6), Q = q * v.pers;
                        return { uit: [h.uit('Verse lucht per persoon', q, 'm³/h', { dec: 0, hoofd: true }), h.uit('Totaal', Q, 'm³/h', { dec: 0, hoofd: true, opm: h.fmt(Q / 3.6, 0) + ' l/s' })], stappen: ['q = ' + Number(v.act) + ' l/h / (' + h.f(v.cin) + ' − ' + h.f(v.cout) + ') ppm = ' + h.f(q, 1, 'm³/h per persoon')] };
                    }
                }
            ] },
            { naam: 'Kanalen, roosters en meten', items: [
                {
                    id: 'vent.kanaal', naam: 'Kanaaldiameter en drukverlies', kort: 'Rond kanaal uit debiet en snelheid, drukverlies per meter, rechthoekig equivalent',
                    zoek: 'kanaal kanaaldiameter luchtkanaal snelheid drukverlies pa/m spiro flexibel rechthoekig equivalent', soort: 'exact',
                    bron: 'd = √(4Q / (π v)); Darcy-Weisbach met lucht ρ 1,2 kg/m³, ν 15 × 10⁻⁶; ruwheid spiro 0,15 mm, kunststof 0,05, flexibel 3 mm; rechthoekig: d_e = 1,3 × (a·b)^0,625 / (a+b)^0,25',
                    uitleg: 'Richtsnelheden woning: hoofdkanaal 3 m/s, aftakkingen 2–2,5 m/s (geluid), ventielen ≤ 2 m/s; utiliteit 4–6 m/s. Drukverlies streef ≤ 1 Pa/m in woningen.',
                    velden: [
                        { k: 'Q', label: 'Debiet', eh: 'm³/h', ehs: ['m³/h', 'l/s', 'cfm'] },
                        { k: 'vmax', label: 'Maximale snelheid', eh: 'm/s', std: 3, snel: [{ t: 'Ventiel 2', v: 2 }, { t: 'Aftak 2,5', v: 2.5 }, { t: 'Hoofd 3', v: 3 }, { t: 'Utiliteit 5', v: 5 }] },
                        { k: 'mat', label: 'Kanaal', type: 'keuze', opties: [{ v: 0.15, t: 'Spiro / verzinkt staal' }, { v: 0.05, t: 'Kunststof (PE/PP)' }, { v: 3, t: 'Flexibel (alu/PVC)' }], std: 0.15 },
                        { k: 'a', label: 'Rechthoekig kanaal: breedte (optioneel)', eh: 'mm', opt: true },
                        { k: 'b', label: 'hoogte', eh: 'mm', opt: true }
                    ],
                    bereken: function (v, h) {
                        var dmin = Math.sqrt(4 * v.Q / 3600 / (Math.PI * v.vmax)) * 1000, keus = null, rijen = [];
                        KANALEN.forEach(function (d) {
                            var r = R.darcy(v.Q, d, Number(v.mat), 15e-6, L.rho);
                            var ok = r.v <= v.vmax; if (ok && !keus) keus = { d: d, r: r };
                            rijen.push(['Ø ' + d, h.fmt(r.v, 2) + ' m/s', h.fmt(r.dp, 2) + ' Pa/m', ok ? (keus && keus.d === d ? '✓ kleinste' : '✓') : 'te snel']);
                        });
                        var uit = [h.uit('Kanaal', keus ? 'Ø ' + keus.d + ' mm' : 'groter dan Ø 500', '', { hoofd: true }), h.uit('Minimale diameter', dmin, 'mm', { dec: 0 })];
                        if (keus) uit.push(h.uit('Snelheid', keus.r.v, 'm/s', { dec: 2 }), h.uit('Drukverlies', keus.r.dp, 'Pa/m', { dec: 2 }));
                        var st = ['d_min = √(4 × ' + h.fmt(v.Q / 3600, 4) + ' / (π × ' + h.f(v.vmax) + ')) = ' + h.f(dmin, 0, 'mm')];
                        if (v.a != null && v.b != null) { var de = 1.3 * Math.pow(v.a * v.b, 0.625) / Math.pow(v.a + v.b, 0.25); uit.push(h.uit('Rechthoek ' + h.fmt(v.a) + '×' + h.fmt(v.b) + ' ≙ rond', de, 'mm', { dec: 0 })); st.push('d_e = 1,3 × (a·b)^0,625 / (a+b)^0,25 = ' + h.f(de, 0, 'mm')); }
                        return { uit: uit, stappen: st, tabel: { kop: ['Maat', 'Snelheid', 'Drukverlies', ''], rijen: rijen }, opm: 'Bochten ±0,3 × dynamische druk elk, ventielen 20–60 Pa, filters 50–150 Pa, WTW-unit 100–150 Pa: tel op voor de ventilatordruk.' };
                    }
                },
                {
                    id: 'vent.ventilator', naam: 'Ventilatorvermogen en SFP', kort: 'Asvermogen uit debiet en druk, specifiek ventilatorvermogen, jaarverbruik',
                    zoek: 'ventilator vermogen sfp specifiek ventilatorvermogen druk debiet verbruik', soort: 'exact',
                    bron: 'P = Q × Δp / η [W, m³/s, Pa]; SFP = P / Q [W per (m³/s)]; EPB-eis woningen SFP ≤ ±1.000 W/(m³/s) per unit (0,28 W per m³/h)',
                    velden: [
                        { k: 'Q', label: 'Debiet', eh: 'm³/h', ehs: ['m³/h', 'l/s'] },
                        { k: 'dp', label: 'Totale druk', eh: 'Pa', std: 150 },
                        { k: 'eta', label: 'Totaalrendement (motor + ventilator)', std: 0.5, min: 0.1, max: 0.95, snel: [{ t: 'Klein 0,3', v: 0.3 }, { t: 'EC 0,5', v: 0.5 }, { t: 'Groot 0,7', v: 0.7 }] },
                        { k: 'uren', label: 'Draaiuren per jaar', eh: 'h', std: 8760 },
                        { k: 'prijs', label: 'Stroomprijs', eh: '€/kWh', std: 0.35 }
                    ],
                    bereken: function (v, h) {
                        var P = v.Q / 3600 * v.dp / v.eta, sfp = P / (v.Q / 3600), E = P * v.uren / 1000;
                        return { uit: [h.uit('Opgenomen vermogen', P, 'W', { dec: 0, hoofd: true }), h.uit('SFP', sfp, 'W/(m³/s)', { dec: 0, kleur: sfp > 1000 ? 'amber' : 'groen', opm: h.fmt(sfp / 3600, 2) + ' W per m³/h' }), h.uit('Verbruik per jaar', E, 'kWh', { dec: 0, opm: '€ ' + h.fmt(E * v.prijs, 0) })], stappen: ['P = ' + h.fmt(v.Q / 3600, 4) + ' m³/s × ' + h.f(v.dp) + ' Pa / ' + h.f(v.eta) + ' = ' + h.f(P, 0, 'W')] };
                    }
                },
                {
                    id: 'vent.wtw', naam: 'Warmteterugwinning en naverwarmer', kort: 'Toevoertemperatuur na de WTW, teruggewonnen vermogen, naverwarming',
                    zoek: 'warmteterugwinning wtw rendement naverwarmer toevoertemperatuur systeem d besparing', soort: 'indicatief',
                    bron: 'θ_toevoer = θ_buiten + η × (θ_afvoer − θ_buiten); P = 0,34 W/(m³/h·K) × Q × Δθ; jaarbesparing ≈ 0,34 × Q × 24 × graaddagen (Ukkel ±2.400 dagen·K) × η',
                    velden: [
                        { k: 'Q', label: 'Debiet', eh: 'm³/h', ehs: ['m³/h', 'l/s'] },
                        { k: 'tb', label: 'Buitentemperatuur', eh: '°C', std: -8 },
                        { k: 'ti', label: 'Afvoerlucht (binnen)', eh: '°C', std: 20 },
                        { k: 'eta', label: 'Temperatuurrendement WTW', std: 0.85, min: 0, max: 1 },
                        { k: 'tin', label: 'Gewenste inblaastemperatuur', eh: '°C', std: 18 },
                        { k: 'prijs', label: 'Warmteprijs', eh: '€/kWh', std: 0.12 }
                    ],
                    bereken: function (v, h) {
                        var tna = v.tb + v.eta * (v.ti - v.tb), Pterug = L.wh_m3_K * v.Q * (tna - v.tb), Pna = Math.max(0, L.wh_m3_K * v.Q * (v.tin - tna));
                        var jaar = L.wh_m3_K * v.Q * 24 * 2400 / 1000, bespaard = jaar * v.eta;
                        return { uit: [h.uit('Toevoer na WTW', tna, '°C', { dec: 1, hoofd: true }), h.uit('Teruggewonnen vermogen', Pterug, 'W', { dec: 0 }), h.uit('Naverwarmer tot ' + h.fmt(v.tin) + ' °C', Pna, 'W', { dec: 0, hoofd: Pna > 0 }), h.uit('Ventilatieverlies zonder WTW (jaar)', jaar, 'kWh', { dec: 0 }), h.uit('Besparing per jaar (±)', bespaard, 'kWh', { dec: 0, opm: '€ ' + h.fmt(bespaard * v.prijs, 0) })], stappen: ['θ_na = ' + h.f(v.tb) + ' + ' + h.f(v.eta) + ' × (' + h.f(v.ti) + ' − ' + h.f(v.tb) + ') = ' + h.f(tna, 1, '°C'), 'P = 0,34 × ' + h.f(v.Q) + ' × Δθ'] };
                    }
                },
                {
                    id: 'vent.kanaalnet', naam: 'Drukverlies van een kanaaltraject', kort: 'Wrijving over de lengte plus bochten, T-stukken en ventielen',
                    zoek: 'drukverlies kanaal traject luchtkanaal bochten t-stuk verloop ventiel weerstand pascal ventilatordruk tak', soort: 'indicatief',
                    bron: 'Δp = (Δp per meter × L) + Σζ × ρ × v² / 2 + toestellen · ζ: bocht 90° 0,3 · bocht 45° 0,15 · T-stuk aftakking 1,0 · verloop 0,2 · lucht ρ 1,2 kg/m³',
                    uitleg: 'Reken het traject naar het verste ventiel door. De som van alle deeltrajecten plus de unit, de filters en de roosters geeft de druk die de ventilator moet leveren.',
                    velden: [
                        { k: 'Q', label: 'Debiet', eh: 'm³/h', ehs: ['m³/h', 'l/s'], min: 0 },
                        { k: 'd', label: 'Kanaal', type: 'keuze', opties: KANALEN.map(function (d) { return { v: d, t: 'Ø ' + d + ' mm' }; }), std: 125 },
                        { k: 'mat', label: 'Soort kanaal', type: 'keuze', opties: [{ v: 0.15, t: 'Spiro / verzinkt staal' }, { v: 0.05, t: 'Kunststof (PE/PP)' }, { v: 3, t: 'Flexibel (alu/PVC)' }], std: 0.15 },
                        { k: 'L', label: 'Lengte', eh: 'm', std: 10, min: 0 },
                        { k: 'b90', label: 'Bochten 90°', std: 2, min: 0 },
                        { k: 'b45', label: 'Bochten 45°', std: 0, min: 0 },
                        { k: 'tst', label: 'T-stukken (aftakking)', std: 0, min: 0 },
                        { k: 'verl', label: 'Verlopen', std: 0, min: 0 },
                        { k: 'extra', label: 'Ventiel, demper of rooster', eh: 'Pa', std: 30, min: 0, snel: [{ t: 'Geen 0', v: 0 }, { t: 'Ventiel 30', v: 30 }, { t: 'Demper 15', v: 15 }, { t: 'Buitenrooster 20', v: 20 }] }
                    ],
                    bereken: function (v, h) {
                        if (!(v.Q > 0)) return { fout: 'Het debiet moet groter zijn dan 0' };
                        var d = Number(v.d), r = R.darcy(v.Q, d, Number(v.mat), 15e-6, L.rho), pd = L.rho * r.v * r.v / 2;
                        var zeta = v.b90 * 0.3 + v.b45 * 0.15 + v.tst * 1.0 + v.verl * 0.2, dpL = r.dp * v.L, dpZ = zeta * pd, tot = dpL + dpZ + v.extra;
                        var waarsch = [];
                        if (r.v > 4) waarsch.push('Snelheid ' + h.fmt(r.v, 1) + ' m/s: dat hoor je in een woning. Kies een groter kanaal (streef naar 3 m/s in het hoofdkanaal en 2 m/s bij de ventielen).');
                        if (Number(v.mat) === 3 && v.L > 1.5) waarsch.push('Flexibele slang geeft veel weerstand en vervuilt snel: gebruik ze enkel voor de laatste meter naar het ventiel en trek ze strak.');
                        return {
                            uit: [h.uit('Drukverlies van het traject', tot, 'Pa', { dec: 0, hoofd: true }), h.uit('Wrijving in het kanaal', dpL, 'Pa', { dec: 1, opm: h.fmt(r.dp, 2) + ' Pa per meter' }), h.uit('Bochten en hulpstukken (Σζ = ' + h.fmt(zeta, 2) + ')', dpZ, 'Pa', { dec: 1 }), h.uit('Ventiel, demper of rooster', v.extra, 'Pa', { dec: 0 }), h.uit('Snelheid', r.v, 'm/s', { dec: 2, kleur: r.v > 4 ? 'amber' : 'groen' }), h.uit('Dynamische druk', pd, 'Pa', { dec: 1 })],
                            stappen: ['v = ' + h.f(r.v, 2, 'm/s') + ', Δp per meter = ' + h.f(r.dp, 2, 'Pa'), 'Δp = ' + h.fmt(r.dp, 2) + ' × ' + h.f(v.L, 1) + ' + ' + h.fmt(zeta, 2) + ' × ' + h.fmt(pd, 1) + ' + ' + h.f(v.extra, 0) + ' = ' + h.f(tot, 0, 'Pa')],
                            waarsch: waarsch
                        };
                    }
                },
                {
                    id: 'vent.rooster', naam: 'Rooster en ventiel: doorlaat en snelheid', kort: 'Hoe groot moet het rooster zijn, of hoe snel gaat de lucht erdoor?',
                    zoek: 'rooster ventiel doorlaat netto vrije doorlaat luchtsnelheid buitenrooster deurrooster doorstroomopening spleet onder deur cm2 afmeting', soort: 'indicatief',
                    bron: 'v = Q / (A_bruto × vrije doorlaat) · A_netto = Q / v_max · doorstroomopening volgens NBN D 50-001: 70 cm² per 25 m³/h (bij 2 Pa) · drukverlies rooster ≈ 2 × ρ × v² / 2',
                    velden: [
                        { k: 'Q', label: 'Debiet', eh: 'm³/h', ehs: ['m³/h', 'l/s'], min: 0 },
                        { k: 'vmax', label: 'Grootste snelheid in de vrije doorlaat', eh: 'm/s', std: 2.5, min: 0.1, snel: [{ t: 'Toevoer in de kamer 2', v: 2 }, { t: 'Buitenrooster 2,5', v: 2.5 }, { t: 'Afvoer 3', v: 3 }, { t: 'Technische ruimte 4', v: 4 }] },
                        { k: 'vrij', label: 'Vrije doorlaat van het rooster', eh: '%', std: 50, min: 5, max: 100, snel: [{ t: 'Lamellen 50', v: 50 }, { t: 'Gaas 60', v: 60 }, { t: 'Open 80', v: 80 }] },
                        { k: 'b', label: 'Bestaand rooster: breedte', eh: 'mm', opt: true, min: 0 },
                        { k: 'hgt', label: 'hoogte', eh: 'mm', opt: true, min: 0 },
                        { k: 'deur', label: 'Breedte van de deur (voor de spleet)', eh: 'cm', std: 80, min: 1 }
                    ],
                    bereken: function (v, h) {
                        if (!(v.Q > 0)) return { fout: 'Het debiet moet groter zijn dan 0' };
                        var netto = v.Q / 3600 / v.vmax * 1e4, bruto = netto / (v.vrij / 100), zij = Math.ceil(Math.sqrt(bruto) * 10 / 50) * 50;
                        var door = 70 * v.Q / 25, spleet = door / v.deur;
                        var uit = [h.uit('Nodige vrije doorlaat', netto, 'cm²', { dec: 0, hoofd: true }), h.uit('Rooster bruto', bruto, 'cm²', { dec: 0, hoofd: true, opm: 'bijvoorbeeld ' + zij + ' × ' + zij + ' mm' })];
                        var st = ['A_netto = ' + h.fmt(v.Q / 3600, 4) + ' m³/s / ' + h.f(v.vmax, 1) + ' m/s = ' + h.f(netto, 0, 'cm²'), 'A_bruto = ' + h.fmt(netto, 0) + ' / ' + h.f(v.vrij, 0) + ' % = ' + h.f(bruto, 0, 'cm²')];
                        var waarsch = [];
                        if (v.b != null && v.hgt != null && v.b > 0 && v.hgt > 0) {
                            var An = v.b * v.hgt / 100 * v.vrij / 100, vv = v.Q / 3600 / (An / 1e4);
                            uit.push(h.uit('Snelheid in het rooster van ' + h.fmt(v.b, 0) + ' × ' + h.fmt(v.hgt, 0) + ' mm', vv, 'm/s', { dec: 2, hoofd: true, kleur: vv > v.vmax ? 'rood' : 'groen' }), h.uit('Drukverlies over dat rooster (±)', 2 * L.rho * vv * vv / 2, 'Pa', { dec: 0 }));
                            st.push('v = ' + h.fmt(v.Q / 3600, 4) + ' / (' + h.fmt(An, 0) + ' cm²) = ' + h.f(vv, 2, 'm/s'));
                            if (vv > v.vmax) waarsch.push('Het rooster is te klein: de lucht gaat er sneller door dan ' + h.fmt(v.vmax, 1) + ' m/s. Dat geeft geluid en tocht.');
                        }
                        uit.push(h.uit('Doorstroomopening naar een andere ruimte', door, 'cm²', { dec: 0, opm: 'spleet van ' + h.fmt(spleet * 10, 0) + ' mm onder een deur van ' + h.fmt(v.deur, 0) + ' cm' }));
                        return { uit: uit, stappen: st, waarsch: waarsch };
                    }
                },
                {
                    id: 'vent.meten', naam: 'Debiet meten en inregelen', kort: 'Uit de luchtsnelheid of uit het drukverschil met de k-factor',
                    zoek: 'debiet meten inregelen ventiel anemometer luchtsnelheid drukverschil k-factor meetkruis flowmeter ventilatieverslag afwijking ontwerpdebiet', soort: 'exact',
                    bron: 'Uit de snelheid: Q = v × A × correctiefactor · uit het drukverschil: Q = k × √Δp (k-factor uit de fiche van het ventiel of de meetflens)',
                    uitleg: 'Meet de snelheid op meerdere punten en vul het gemiddelde in. De k-factor van een ventiel hangt af van de stand: lees hem af in de fiche voor de ingestelde opening.',
                    velden: [
                        { k: 'meth', label: 'Methode', type: 'keuze', opties: [{ v: 'v', t: 'Luchtsnelheid in een kanaal of op een rooster' }, { v: 'dp', t: 'Drukverschil met k-factor' }], std: 'v' },
                        { k: 'v', label: 'Gemiddelde luchtsnelheid', eh: 'm/s', opt: true, min: 0 },
                        { k: 'd', label: 'Rond kanaal: diameter', eh: 'mm', opt: true, min: 0, snel: [{ t: '100', v: 100 }, { t: '125', v: 125 }, { t: '160', v: 160 }, { t: '200', v: 200 }] },
                        { k: 'a', label: 'of rechthoek: breedte', eh: 'mm', opt: true, min: 0 },
                        { k: 'b', label: 'hoogte', eh: 'mm', opt: true, min: 0 },
                        { k: 'cf', label: 'Correctiefactor', std: 1, min: 0.1, max: 1.2, snel: [{ t: 'Kanaal 1', v: 1 }, { t: 'Rooster 0,8', v: 0.8 }, { t: 'Gaas 0,7', v: 0.7 }] },
                        { k: 'dp', label: 'Drukverschil', eh: 'Pa', opt: true, min: 0 },
                        { k: 'k', label: 'k-factor', opt: true, min: 0 },
                        { k: 'keh', label: 'Eenheid van de k-factor', type: 'keuze', opties: [{ v: 1, t: 'm³/h per √Pa' }, { v: 3.6, t: 'l/s per √Pa' }], std: 1 },
                        { k: 'Qo', label: 'Ontwerpdebiet', eh: 'm³/h', ehs: ['m³/h', 'l/s'], opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var Q, st = [];
                        if (v.meth === 'dp') {
                            if (v.dp == null || v.k == null) return { wacht: true, ontbreekt: ['drukverschil en k-factor'] };
                            Q = v.k * Number(v.keh) * Math.sqrt(v.dp);
                            st.push('Q = ' + h.f(v.k, 2) + ' × √' + h.f(v.dp, 1) + (Number(v.keh) === 1 ? '' : ' × 3,6') + ' = ' + h.f(Q, 1, 'm³/h'));
                        } else {
                            var A = v.d != null ? Math.PI * v.d * v.d / 4 / 1e6 : (v.a != null && v.b != null ? v.a * v.b / 1e6 : null);
                            if (v.v == null || A == null) return { wacht: true, ontbreekt: ['luchtsnelheid en de maat van het kanaal of rooster'] };
                            Q = v.v * A * v.cf * 3600;
                            st.push('A = ' + h.f(A * 1e4, 1, 'cm²'), 'Q = ' + h.f(v.v, 2) + ' m/s × ' + h.fmt(A, 5) + ' m² × ' + h.f(v.cf, 2) + ' × 3.600 = ' + h.f(Q, 1, 'm³/h'));
                        }
                        var uit = [h.uit('Gemeten debiet', Q, 'm³/h', { dec: 0, hoofd: true, opm: h.fmt(Q / 3.6, 1) + ' l/s' })];
                        var waarsch = [];
                        if (v.Qo > 0) {
                            var afw = (Q - v.Qo) / v.Qo * 100;
                            uit.push(h.uit('Afwijking van het ontwerp', afw, '%', { dec: 0, hoofd: true, kleur: Math.abs(afw) <= 10 ? 'groen' : Math.abs(afw) <= 20 ? 'amber' : 'rood' }), h.uit('Ontwerpdebiet', v.Qo, 'm³/h', { dec: 0 }));
                            if (v.meth === 'dp' && v.k > 0) uit.push(h.uit('Drukverschil bij het ontwerpdebiet', Math.pow(v.Qo / (v.k * Number(v.keh)), 2), 'Pa', { dec: 1, opm: 'bij deze k-factor' }));
                            if (afw < -10) waarsch.push('Te weinig debiet: ventiel verder open, of de ventilator een stand hoger. Regel altijd eerst het verste ventiel in.');
                            if (afw > 20) waarsch.push('Te veel debiet: ventiel verder dicht. Te veel lucht geeft geluid en tocht.');
                        }
                        return { uit: uit, stappen: st, waarsch: waarsch };
                    }
                }
            ] },
            { naam: 'Rookgas en verbrandingslucht', items: [
                {
                    id: 'vent.schouw', naam: 'Schouwdiameter (rookgasafvoer)', kort: 'Diameter uit vermogen, hoogte en toesteltype — trek, weerstand, snelheid en condensatie',
                    zoek: 'schouw schoorsteen diameter rookgasafvoer trek hoogte kw ketel kachel en 13384 nbn b 61 condensatie voering', soort: 'indicatief',
                    bron: 'Vereenvoudigde EN 13384-1: trek p_H = g × H × (ρ_lucht − ρ_rookgas); weerstand Δp = (λ × H/d + Σζ) × ρ × w²/2; eisen: p_H − Δp ≥ nodige trek van het toestel, snelheid ≥ 0,5 m/s, rookgas boven het dauwpunt aan de monding (anders vochtbestendige voering) — NBN B 61-002 (< 70 kW), NBN B 61-001 (≥ 70 kW)',
                    uitleg: 'Richtwaarde voor een eerste keuze. De fabrikant van het toestel geeft massadebiet, temperatuur en toegelaten weerstand; de norm rekent daarmee. Condenserende toestellen: overdruk-afvoer in PP volgens de fabrikant (max. lengte en aantal bochten in de handleiding).',
                    velden: [
                        { k: 'toestel', label: 'Toestel', type: 'keuze', opties: TOESTELLEN, std: 'atm' },
                        { k: 'P', label: 'Nominale belasting', eh: 'kW', std: 24 },
                        { k: 'H', label: 'Effectieve schouwhoogte (aansluiting → monding)', eh: 'm', std: 8 },
                        { k: 'schouw', label: 'Schouwtype', type: 'keuze', opties: SCHOUWEN, std: 'keram' },
                        { k: 'bochten', label: 'Bochten in het traject', std: 2, min: 0 },
                        { k: 'tl', label: 'Buitentemperatuur (trekcontrole)', eh: '°C', std: 15 },
                        { k: 'pfan', label: 'Beschikbare ventilatordruk (toestellen met ventilator)', eh: 'Pa', std: 80 }
                    ],
                    bereken: function (v, h) {
                        var T = TOESTELLEN.filter(function (x) { return x.v === v.toestel; })[0], S = SCHOUWEN.filter(function (x) { return x.v === v.schouw; })[0];
                        var m = T.f * v.P / 1000, Tmond = Math.max(v.tl + 5, T.T - S.koel * v.H), Tgem = (T.T + Tmond) / 2;
                        var rg = rho(Tgem), rl = rho(v.tl), pH = 9.81 * v.H * (rl - rg), zeta = 0.5 + 1.0 + v.bochten * 0.4;
                        var keus = null, rijen = [];
                        DIAMETERS.forEach(function (d) {
                            var A = Math.PI * Math.pow(d / 1000, 2) / 4, w = m / (rg * A), dp = (S.lam * v.H / (d / 1000) + zeta) * rg * w * w / 2;
                            var beschikbaar = pH - dp, ok;
                            if (T.trek > 0) ok = beschikbaar >= T.trek && w >= 0.5;
                            else ok = (dp - pH) <= v.pfan && w >= 0.5;
                            if (d < T.dmin) ok = false;   // nooit kleiner dan de aansluiting van het toestel
                            if (ok && !keus) keus = { d: d, w: w, dp: dp, beschikbaar: beschikbaar };
                            rijen.push(['Ø ' + d, h.fmt(w, 2) + ' m/s', h.fmt(dp, 1) + ' Pa', h.fmt(beschikbaar, 1) + ' Pa', ok ? (keus && keus.d === d ? '✓ kleinste' : '✓') : d < T.dmin ? 'kleiner dan de aansluiting' : w < 0.5 ? 'te traag' : T.trek > 0 ? 'te weinig trek' : 'te veel weerstand']);
                        });
                        var waarsch = [];
                        if (Tmond < T.dauw) waarsch.push('Rookgas koelt tot ±' + h.fmt(Tmond, 0) + ' °C aan de monding (dauwpunt ±' + T.dauw + ' °C): condensatie in de schouw → vochtbestendige, gladde voering (RVS/PP) en condensafvoer, of beter isoleren.');
                        if (T.v === 'cond') waarsch.push('Condenserende ketel: altijd een overdruk-rookgasafvoer (PP, klasse P1) volgens de handleiding; deze berekening toont enkel de weerstand van het traject.');
                        if (v.H < 4 && T.trek > 0) waarsch.push('Minder dan 4 m effectieve hoogte geeft zelden genoeg trek voor een toestel met natuurlijke trek.');
                        return {
                            uit: [h.uit('Diameter', keus ? 'Ø ' + keus.d + ' mm' : 'geen maat voldoet', '', { hoofd: true, kleur: keus ? 'groen' : 'rood' }), h.uit('Rookgasdebiet', m * 1000, 'g/s', { dec: 1, opm: h.fmt(m * 3600, 0) + ' kg/h' }), h.uit('Natuurlijke trek (schouw)', pH, 'Pa', { dec: 1 }), h.uit('Weerstand bij gekozen maat', keus ? keus.dp : null, 'Pa', { dec: 1 }), h.uit(T.trek > 0 ? 'Beschikbaar voor het toestel (nodig ' + T.trek + ' Pa)' : 'Netto over te winnen door de ventilator', keus ? (T.trek > 0 ? keus.beschikbaar : Math.max(0, keus.dp - pH)) : null, 'Pa', { dec: 1 }), h.uit('Snelheid', keus ? keus.w : null, 'm/s', { dec: 2 }), h.uit('Temperatuur aan de monding (±)', Tmond, '°C', { dec: 0, kleur: Tmond < T.dauw ? 'amber' : 'groen' })],
                            stappen: ['ṁ = ' + h.fmt(T.f, 2) + ' g/s per kW × ' + h.f(v.P) + ' kW = ' + h.f(m * 1000, 1, 'g/s'), 'ρ_rookgas (' + h.fmt(Tgem, 0) + ' °C) = ' + h.fmt(rg, 3) + ' kg/m³, ρ_lucht (' + h.f(v.tl) + ' °C) = ' + h.fmt(rl, 3), 'p_H = 9,81 × ' + h.f(v.H) + ' × (' + h.fmt(rl, 3) + ' − ' + h.fmt(rg, 3) + ') = ' + h.f(pH, 1, 'Pa'), 'Δp = (λ × H/d + Σζ) × ρ × w² / 2 met λ = ' + h.fmt(S.lam, 3) + ', Σζ = ' + h.fmt(zeta, 1) + ' (intrede 0,5 + monding 1,0 + ' + v.bochten + ' × 0,4)'],
                            tabel: { kop: ['Maat', 'Snelheid', 'Weerstand', 'Trek − weerstand', ''], rijen: rijen }, waarsch: waarsch,
                            opm: 'Nooit kleiner dan de rookgasaansluiting van het toestel. Monding: minstens 1 m boven een plat dak, bij een hellend dak liefst boven de nok en buiten de windzone van hogere gebouwen (NBN B 61-002).'
                        };
                    }
                },
                {
                    id: 'vent.stookplaats', naam: 'Verluchting van het stooklokaal', kort: 'Lage en hoge verluchting in cm² voor open toestellen en stookafdelingen',
                    zoek: 'verbrandingslucht toevoeropening stookplaats stooklokaal stookafdeling verluchting ventilatie cm2 per kw rooster nbn d 51-003 b 61-001 b 61-002 type b type c trekonderbreker doorstroomopening', soort: 'indicatief',
                    bron: 'Tot 70 kW (NBN D 51-003 en NBN/DTD B 61-002): cm² vrije doorlaat per kW, gelezen in het dossier van KVBG (Inforgas) en in de opleiding van Cedicol · vanaf 70 kW (NBN/DTD B 61-001): gelezen in de opleiding van Techlink · stookolie: ook besluit van de Vlaamse Regering van 8 december 2006 · luchtbehoefte ±1,2 m³ per kWh. De normen zelf zijn betalend en niet geraadpleegd: controleer bij twijfel de norm.',
                    uitleg: 'De lage verluchting brengt de verbrandingslucht binnen, de hoge verluchting voert warmte en gassen af. Een gesloten toestel (type C) neemt zijn lucht buiten en heeft geen opening voor de verbranding nodig.',
                    velden: [
                        { k: 'P', label: 'Totale belasting van de toestellen in het lokaal', eh: 'kW', std: 30, min: 0 },
                        { k: 'soort', label: 'Toestel', type: 'keuze', opties: STOOK.map(function (x) { return { v: x.v, t: x.t }; }), std: 'b1' },
                        { k: 'weg', label: 'Waar komt de lucht vandaan? (gas, tot 30 kW)', type: 'keuze', opties: [{ v: 0, t: 'Rechtstreeks van buiten' }, { v: 1, t: 'Via 1 doorstroomopening (bestaand gebouw)' }, { v: 2, t: 'Via 2 doorstroomopeningen (bestaand gebouw)' }], std: 0 },
                        { k: 'schouw', label: 'Schoorsteen (vanaf 70 kW)', type: 'keuze', opties: [{ v: 'hoog', t: 'Hoger dan 6 m' }, { v: 'laag', t: '6 m of lager' }], std: 'hoog' },
                        { k: 'V', label: 'Inhoud van het lokaal of de kast (type C)', eh: 'm³', opt: true, min: 0 },
                        { k: 'afz', label: 'Afzuiging in hetzelfde lokaal (dampkap, droogkast)', eh: 'm³/h', opt: true, min: 0 },
                        { k: 'vrij', label: 'Vrije doorlaat van het rooster', eh: '%', std: 60, min: 10, max: 100, snel: [{ t: 'Lamellen 50', v: 50 }, { t: 'Gaas 60', v: 60 }, { t: 'Open 80', v: 80 }] }
                    ],
                    bereken: function (v, h) {
                        if (!(v.P > 0)) return { fout: 'De belasting moet groter zijn dan 0' };
                        var T = STOOK.filter(function (x) { return x.v === v.soort; })[0] || STOOK[0], weg = Number(v.weg), uit = [], st = [], waarsch = [], opm;
                        function maat(cm2) { var z = Math.ceil(Math.sqrt(cm2) * 10 / 50) * 50; return h.fmt(z, 0) + ' × ' + h.fmt(z, 0) + ' mm'; }
                        function rooster(cm2) { var bruto = cm2 / (v.vrij / 100); return 'rooster bruto ±' + h.fmt(bruto, 0) + ' cm², bijvoorbeeld ' + maat(bruto); }
                        if (v.P >= 70) {
                            if (v.P > 12000) return { fout: 'Boven 12.000 kW geeft de norm geen formule: laat de verluchting berekenen' };
                            var laagK = v.schouw === 'laag', per = laagK ? 150 : 100;
                            var onder = v.P > 1200 ? Math.sqrt(v.P) * (laagK ? 300 : 200) : v.P / 17.5 * per, boven = Math.max(200, onder / 3);
                            uit.push(h.uit('Lage verluchting, vrije doorlaat', onder, 'cm²', { dec: 0, hoofd: true, opm: rooster(onder) }), h.uit('Hoge verluchting, vrije doorlaat', boven, 'cm²', { dec: 0, hoofd: true, opm: rooster(boven) }), h.uit('Of mechanische luchttoevoer', v.P * 2 / 1.16, 'm³/h', { dec: 0, opm: '2 m³/h per 1,16 kW, met de ketels vergrendeld op de luchtstroom' }), h.uit('Verbrandingslucht bij vollast', 1.2 * v.P, 'm³/h', { dec: 0 }));
                            st.push(v.P > 1200 ? 'Laag = √' + h.f(v.P, 0) + ' × ' + (laagK ? 300 : 200) + ' = ' + h.f(onder, 0, 'cm²') : 'Laag = ' + h.f(v.P, 1) + ' / 17,5 × ' + per + ' = ' + h.f(onder, 0, 'cm²'), 'Hoog = het grootste van 200 cm² en een derde van de lage verluchting = ' + h.f(boven, 0, 'cm²'));
                            if (T.v === 'c') waarsch.push('Vanaf 70 kW blijft luchtaanvoer nodig, ook als de branders hun lucht buiten nemen. De norm geeft daarvoor geen cijfer: de waarden hierboven zijn die voor open toestellen.');
                            opm = 'Stookafdeling vanaf 70 kW (NBN/DTD B 61-001). De waarden gelden voor hoogstens 3 roosters en bochten van 90° na elkaar: tel er per extra rooster of bocht 10 % bij. De bovenrand van de lage verluchting ligt hoogstens op een kwart van de hoogte van het lokaal. Geen klep of schuif in de openingen. De hoge verluchting is altijd natuurlijk.';
                            return { uit: uit, stappen: st, waarsch: waarsch, opm: opm };
                        }
                        if (T.v === 'c') {
                            if (v.V != null && v.V > 0 && v.P / v.V > 35) {
                                var opening = Math.max(50, v.P);
                                uit.push(h.uit('Opening onderaan en bovenaan, elk', opening, 'cm²', { dec: 0, hoofd: true, opm: 'een spleet onder en boven de deur mag' }), h.uit('Belasting per m³', v.P / v.V, 'kW/m³', { dec: 0, opm: 'meer dan 35: de kast moet verlucht worden' }));
                                st.push(h.f(v.P, 1) + ' kW / ' + h.f(v.V, 2) + ' m³ = ' + h.f(v.P / v.V, 0, 'kW/m³') + ', meer dan 35', 'Opening = het grootste van 50 cm² en 1 cm² per kW = ' + h.f(opening, 0, 'cm²'));
                            } else {
                                uit.push(h.uit('Opening voor de verbranding', 'niet nodig', '', { hoofd: true }));
                                if (v.V != null && v.V > 0) uit.push(h.uit('Belasting per m³', v.P / v.V, 'kW/m³', { dec: 1, opm: 'tot 35: geen verluchting van het lokaal nodig' }));
                                else waarsch.push('Staat het toestel in een kast of een klein lokaal? Vul dan de inhoud in: boven 35 kW per m³ zijn openingen nodig.');
                            }
                            return { uit: uit, stappen: st, waarsch: waarsch, opm: 'Een gesloten toestel (type C) haalt zijn verbrandingslucht via de concentrische afvoer of een aparte luchtbuis. De gewone ventilatie van de ruimte blijft nodig.' };
                        }
                        if (weg > 0 && !T.gas) { waarsch.push('Doorstroomopeningen staan alleen in de tabel voor gastoestellen: de lucht komt hier rechtstreeks van buiten.'); weg = 0; }
                        if (weg > 0 && v.P > 30) { waarsch.push('Doorstroomopeningen zijn alleen toegelaten tot 30 kW, in een bestaand gebouw: de lucht komt hier rechtstreeks van buiten.'); weg = 0; }
                        var f = T.f[weg], laag = Math.max(50, f * v.P), hoog = Math.max(50, laag / 3);
                        uit.push(h.uit('Lage verluchting, vrije doorlaat', laag, 'cm²', { dec: 0, hoofd: true, opm: rooster(laag) }));
                        st.push('Laag = het grootste van 50 cm² en ' + h.fmt(f, 0) + ' cm² × ' + h.f(v.P, 1) + ' kW = ' + h.f(laag, 0, 'cm²') + (weg ? ' per opening' : ''));
                        if (T.v !== 'a') { uit.push(h.uit('Hoge verluchting, vrije doorlaat', hoog, 'cm²', { dec: 0, hoofd: true, opm: rooster(hoog) })); st.push('Hoog = het grootste van 50 cm² en een derde van de lage verluchting = ' + h.f(hoog, 0, 'cm²')); }
                        if (v.afz > 0) { var extra = 160 * v.afz / 100; uit.push(h.uit('Extra toevoer voor de afzuiging', extra, 'cm²', { dec: 0, opm: '160 cm² per 100 m³/h, rechtstreeks van buiten' })); st.push('Extra = 160 × ' + h.f(v.afz, 0) + ' / 100 = ' + h.f(extra, 0, 'cm²')); }
                        uit.push(h.uit('Verbrandingslucht bij vollast', 1.2 * v.P, 'm³/h', { dec: 0 }));
                        if (weg) waarsch.push('Elke doorstroomopening en de opening naar buiten krijgen deze doorlaat. Een spleet onder een deur telt alleen als ze minstens 2,5 cm hoog is en 150 cm² groot.');
                        if (T.v === 'a') waarsch.push('Een keukengeiser zonder afvoer (type A1AS) vraagt een toevoer van minstens 150 cm² en bovenaan een opening van minstens 150 cm² rechtstreeks naar buiten. Zulke toestellen mogen sinds 2014 niet meer geplaatst of vervangen worden.');
                        var tabel = { kop: ['cm² per kW', 'Van buiten', 'Via 1 opening', 'Via 2'], rijen: STOOK.filter(function (x) { return x.f; }).map(function (x) { return [x.kort, String(x.f[0]), x.gas ? String(x.f[1]) : '–', x.gas ? String(x.f[2]) : '–']; }), kies: STOOK.filter(function (x) { return x.f; }).indexOf(T) };
                        return { uit: uit, stappen: st, waarsch: waarsch, tabel: tabel, opm: 'Toestellen tot 70 kW. De lage verluchting zit onderaan (bijvoorbeeld 10 cm boven de vloer) en is niet afsluitbaar. De hoge verluchting mag via het rookkanaal lopen als er één ketel met trekonderbreker staat waarvan de instroomopening op minstens twee derde van de hoogte van het lokaal zit. Open toestellen (type B) zijn verboden in slaapkamer, badkamer, douche en wc.' };
                    }
                },
                {
                    id: 'vent.schouwhoogte', naam: 'Schouwmonding en hoogte boven het dak', kort: 'Naslag: regels voor de uitmonding',
                    zoek: 'schouw hoogte dak monding nok uitmonding regels naslag windzone', soort: 'naslag',
                    bron: 'NBN B 61-002 / NBN D 51-003 / EN 15287 — samenvatting, controleer de norm per geval',
                    velden: [],
                    bereken: function (v, h) {
                        return {
                            tabel: { kop: ['Situatie', 'Regel (richtwaarde)'], rijen: [
                                ['Plat dak', 'Monding ≥ 1 m boven het dak; ≥ 1 m boven een dakrand of opbouw binnen 1,5 m'],
                                ['Hellend dak, monding bij de nok', 'Boven de nok of ≥ 0,4 m boven de nok bij hoge trekweerstand'],
                                ['Hellend dak, monding lager op het dak', '≥ 1 m boven het dakvlak; met een hellingshoek > 20° liefst boven de nok'],
                                ['Nabij hogere gebouwen of muren', 'Buiten de windzone: hoogte ≥ de lijn onder 15° vanaf de hindernis, of ≥ hindernis binnen 8 m'],
                                ['Ramen en ventilatieopeningen', 'Rookgasmonding ≥ 1 m verwijderd van openingen; condenserend gevelmonding: ≥ 0,4 m onder een raam, ≥ 0,6 m naast'],
                                ['Type C gevelafvoer (gas < 70 kW)', 'Toegelaten volgens NBN D 51-003 met minimale afstanden tot ramen, hoeken en de grond (≥ 0,3 m)'],
                                ['Houtkachel', 'Monding boven de nok, effectieve hoogte ≥ 4 m, regenkap die de trek niet stoort']
                            ] },
                            opm: 'De trek van een schouw hangt vooral van de hoogte en de temperatuur af; een te lage monding in een windzone geeft terugslag ondanks een juiste diameter.'
                        };
                    }
                }
            ] },
            { naam: 'Lucht', items: [
                {
                    id: 'vent.dauwpunt', naam: 'Dauwpunt en condensatie', kort: 'Dauwpunt, absolute vochtigheid en condensrisico op koude oppervlakken',
                    zoek: 'dauwpunt condensatie relatieve vochtigheid absolute vochtigheid koude leiding wand schimmel isolatie', soort: 'exact',
                    bron: 'Magnus: T_d = b × γ / (a − γ), γ = ln(RV/100) + a × T / (b + T), a = 17,62, b = 243,12 · absolute vochtigheid ρ_v = 216,7 × p_v / (T + 273,15) g/m³',
                    velden: [
                        { k: 'T', label: 'Luchttemperatuur', eh: '°C', std: 20 },
                        { k: 'rv', label: 'Relatieve vochtigheid', eh: '%', std: 60, min: 1, max: 100 },
                        { k: 'Ts', label: 'Oppervlaktetemperatuur (leiding, wand, raam)', eh: '°C', opt: true }
                    ],
                    bereken: function (v, h) {
                        var a = 17.62, b = 243.12, g = Math.log(v.rv / 100) + a * v.T / (b + v.T), Td = b * g / (a - g);
                        var pv = 6.112 * Math.exp(a * v.T / (b + v.T)) * v.rv / 100, rhov = 216.7 * pv / (v.T + 273.15);
                        var uit = [h.uit('Dauwpunt', Td, '°C', { dec: 1, hoofd: true }), h.uit('Absolute vochtigheid', rhov, 'g/m³', { dec: 1 }), h.uit('Waterdampdruk', pv, 'hPa', { dec: 1 })];
                        var waarsch = [];
                        if (v.Ts != null) { var cond = v.Ts <= Td; uit.push(h.uit('Oppervlak van ' + h.fmt(v.Ts, 1) + ' °C', cond ? 'condenseert' : 'blijft droog', '', { hoofd: true, kleur: cond ? 'rood' : 'groen', opm: 'marge ' + h.fmt(v.Ts - Td, 1) + ' K' })); if (cond) waarsch.push('Isoleer de leiding dampdicht (koudwater, koelleidingen) of verhoog de oppervlaktetemperatuur; bij wanden: ventileren en isoleren (schimmelrisico vanaf RV 80 % aan het oppervlak).'); }
                        return { uit: uit, stappen: ['γ = ln(' + h.f(v.rv) + '/100) + 17,62 × ' + h.f(v.T) + ' / (243,12 + ' + h.f(v.T) + ') = ' + h.fmt(g, 3), 'T_d = 243,12 × γ / (17,62 − γ) = ' + h.f(Td, 1, '°C')], waarsch: waarsch };
                    }
                },
                {
                    id: 'vent.geluid', naam: 'Geluid: dB optellen en afstand', kort: 'Meerdere bronnen samen en het niveau op afstand',
                    zoek: 'geluid decibel db optellen bronnen afstand warmtepomp buitenunit geluidsniveau buren', soort: 'exact',
                    bron: 'L = 10 × log(Σ 10^(Li/10)) · puntbron: L₂ = L₁ − 20 × log(r₂/r₁) · Vlaanderen (VLAREM II): geluid van een warmtepomp bij de buren doorgaans ≤ 40 dB(A) ’s nachts (richtwaarde, gemeente kan afwijken)',
                    velden: [
                        { k: 'lijst', label: 'Geluidsniveaus (dB), gescheiden door spatie', type: 'tekst', std: '55 52' },
                        { k: 'r1', label: 'Gemeten op afstand', eh: 'm', std: 1 },
                        { k: 'r2', label: 'Niveau op afstand', eh: 'm', std: 5 }
                    ],
                    bereken: function (v, h) {
                        var ls = String(v.lijst).split(/[\s,;]+/).map(function (x) { return h.getal(x); }).filter(function (x) { return x != null; });
                        if (!ls.length) return { wacht: true, ontbreekt: ['minstens één niveau'] };
                        var som = 10 * Math.log10(ls.reduce(function (a, l) { return a + Math.pow(10, l / 10); }, 0));
                        var op = som - 20 * Math.log10(v.r2 / v.r1);
                        return { uit: [h.uit('Samen', som, 'dB', { dec: 1, hoofd: true }), h.uit('Op ' + h.fmt(v.r2) + ' m', op, 'dB', { dec: 1, hoofd: true, kleur: op > 40 ? 'amber' : 'groen' })], stappen: ['L = 10 × log(' + ls.map(function (l) { return '10^(' + h.f(l) + '/10)'; }).join(' + ') + ') = ' + h.f(som, 1, 'dB'), 'L(' + h.f(v.r2) + ' m) = ' + h.fmt(som, 1) + ' − 20 × log(' + h.f(v.r2) + '/' + h.f(v.r1) + ') = ' + h.f(op, 1, 'dB')], opm: '+3 dB = dubbel geluidsvermogen, +10 dB = ervaren als dubbel zo luid. Geluidsvermogen L_W (fiche) ≈ geluidsdruk op 1 m + 8 dB.' };
                    }
                },
                {
                    id: 'vent.mollier', naam: 'Vochtige lucht (h-x)', kort: 'Vochtgehalte, enthalpie, dauwpunt en natteboltemperatuur',
                    zoek: 'vochtige lucht mollier h-x diagram enthalpie vochtgehalte absolute vochtigheid natte bol natteboltemperatuur dauwpunt g/kg psychrometrie', soort: 'exact',
                    bron: 'Magnus: p_ws = 6,112 × exp(17,62 × T / (243,12 + T)) hPa · x = 0,622 × p_v / (p − p_v) · h = 1,006 × T + x × (2.501 + 1,86 × T) kJ/kg · natte bol: p_v = p_ws(T_nb) − 0,000662 × p × (T − T_nb)',
                    velden: [
                        { k: 'T', label: 'Luchttemperatuur', eh: '°C', std: 20, min: -40, max: 80 },
                        { k: 'rv', label: 'Relatieve vochtigheid', eh: '%', std: 50, min: 1, max: 100 },
                        { k: 'p', label: 'Luchtdruk', eh: 'hPa', std: 1013, min: 600, max: 1100 }
                    ],
                    bereken: function (v, h) {
                        var a = lucht(v.T, v.rv, v.p), s = lucht(v.T, 100, v.p), nb = natteBol(v.T, v.rv, v.p);
                        return {
                            uit: [h.uit('Vochtgehalte x', a.x * 1000, 'g/kg', { dec: 2, hoofd: true }), h.uit('Enthalpie h', a.h, 'kJ/kg', { dec: 1, hoofd: true }), h.uit('Dauwpunt', a.td, '°C', { dec: 1 }), h.uit('Natteboltemperatuur', nb, '°C', { dec: 1 }), h.uit('Dichtheid', a.rho, 'kg/m³', { dec: 3 }), h.uit('Dampdruk', a.pv, 'hPa', { dec: 2 }), h.uit('Vochtgehalte bij verzadiging', s.x * 1000, 'g/kg', { dec: 2 })],
                            stappen: ['p_ws = 6,112 × exp(17,62 × ' + h.f(v.T, 1) + ' / (243,12 + ' + h.f(v.T, 1) + ')) = ' + h.f(pws(v.T), 2, 'hPa'), 'p_v = ' + h.fmt(pws(v.T), 2) + ' × ' + h.f(v.rv, 0) + ' % = ' + h.f(a.pv, 2, 'hPa'), 'x = 0,622 × ' + h.fmt(a.pv, 2) + ' / (' + h.f(v.p, 0) + ' − ' + h.fmt(a.pv, 2) + ') = ' + h.f(a.x * 1000, 2, 'g/kg'), 'h = 1,006 × ' + h.f(v.T, 1) + ' + ' + h.fmt(a.x, 5) + ' × (2.501 + 1,86 × ' + h.f(v.T, 1) + ') = ' + h.f(a.h, 1, 'kJ/kg')]
                        };
                    }
                },
                {
                    id: 'vent.mengen', naam: 'Twee luchtstromen mengen', kort: 'Temperatuur en vochtigheid na het mengen van buitenlucht en retourlucht',
                    zoek: 'lucht mengen mengkast buitenlucht retourlucht recirculatie mengtemperatuur vochtigheid luchtbehandelingskast mist', soort: 'exact',
                    bron: 'Massabalans op droge lucht: x_m = Σ(m × x) / Σm en h_m = Σ(m × h) / Σm · T_m = (h_m − 2.501 × x_m) / (1,006 + 1,86 × x_m)',
                    velden: [
                        { k: 'Q1', label: 'Stroom 1: debiet', eh: 'm³/h', ehs: ['m³/h', 'l/s'], std: 200, min: 0 },
                        { k: 'T1', label: 'Stroom 1: temperatuur', eh: '°C', std: -5, min: -40, max: 80 },
                        { k: 'rv1', label: 'Stroom 1: relatieve vochtigheid', eh: '%', std: 85, min: 1, max: 100 },
                        { k: 'Q2', label: 'Stroom 2: debiet', eh: 'm³/h', ehs: ['m³/h', 'l/s'], std: 400, min: 0 },
                        { k: 'T2', label: 'Stroom 2: temperatuur', eh: '°C', std: 21, min: -40, max: 80 },
                        { k: 'rv2', label: 'Stroom 2: relatieve vochtigheid', eh: '%', std: 45, min: 1, max: 100 }
                    ],
                    bereken: function (v, h) {
                        if (!(v.Q1 + v.Q2 > 0)) return { fout: 'Minstens één debiet moet groter zijn dan 0' };
                        var a = lucht(v.T1, v.rv1, 1013), b = lucht(v.T2, v.rv2, 1013);
                        var m1 = a.rho * v.Q1 / (1 + a.x), m2 = b.rho * v.Q2 / (1 + b.x), m = m1 + m2;
                        var x = (m1 * a.x + m2 * b.x) / m, hm = (m1 * a.h + m2 * b.h) / m, T = (hm - 2501 * x) / (1.006 + 1.86 * x);
                        var pv = x * 1013 / (0.622 + x), rv = pv / pws(T) * 100, waarsch = [];
                        if (rv > 100) waarsch.push('Het mengpunt ligt boven de verzadigingslijn: er ontstaat mist of condens in de mengkast. Verwarm de buitenlucht voor.');
                        return {
                            uit: [h.uit('Temperatuur na het mengen', T, '°C', { dec: 1, hoofd: true }), h.uit('Relatieve vochtigheid', Math.min(rv, 100), '%', { dec: 0, hoofd: true, kleur: rv > 100 ? 'rood' : '' }), h.uit('Vochtgehalte', x * 1000, 'g/kg', { dec: 2 }), h.uit('Enthalpie', hm, 'kJ/kg', { dec: 1 }), h.uit('Totaal debiet', v.Q1 + v.Q2, 'm³/h', { dec: 0 }), h.uit('Aandeel van stroom 1', m1 / m * 100, '%', { dec: 0 })],
                            stappen: ['Stroom 1: x = ' + h.fmt(a.x * 1000, 2) + ' g/kg, h = ' + h.f(a.h, 1, 'kJ/kg'), 'Stroom 2: x = ' + h.fmt(b.x * 1000, 2) + ' g/kg, h = ' + h.f(b.h, 1, 'kJ/kg'), 'Mengsel: x = ' + h.fmt(x * 1000, 2) + ' g/kg, h = ' + h.f(hm, 1, 'kJ/kg')],
                            waarsch: waarsch
                        };
                    }
                },
                {
                    id: 'vent.luchtvermogen', naam: 'Lucht verwarmen of koelen', kort: 'Vermogen van een batterij uit debiet en temperaturen, met ontvochtiging',
                    zoek: 'lucht verwarmen koelen batterij verwarmingsbatterij koelbatterij naverwarmer vermogen debiet temperatuur ontvochtigen latent voelbaar luchtgordijn', soort: 'exact',
                    bron: 'Voelbaar: P = 0,34 × Q × ΔT [W, m³/h, K] · totaal: P = m × (h₂ − h₁) met m de massa droge lucht · condens = m × (x₁ − x₂) · waterzijdig: Q_w = P / (1,163 × ΔT_water)',
                    uitleg: 'Zonder vochtigheid rekent de tool enkel de voelbare warmte. Vul bij koelen de relatieve vochtigheid voor en na de batterij in: dan komt de ontvochtiging erbij.',
                    velden: [
                        { k: 'Q', label: 'Luchtdebiet', eh: 'm³/h', ehs: ['m³/h', 'l/s'], min: 0 },
                        { k: 'T1', label: 'Temperatuur voor de batterij', eh: '°C', std: -8, min: -40, max: 80 },
                        { k: 'T2', label: 'Temperatuur na de batterij', eh: '°C', std: 20, min: -40, max: 80 },
                        { k: 'rv1', label: 'Relatieve vochtigheid voor', eh: '%', opt: true, min: 1, max: 100 },
                        { k: 'rv2', label: 'Relatieve vochtigheid na', eh: '%', opt: true, min: 1, max: 100 },
                        { k: 'dTw', label: 'ΔT aan de waterzijde', eh: 'K', std: 20, min: 1, snel: [{ t: 'Verwarmen 20', v: 20 }, { t: 'Warmtepomp 5', v: 5 }, { t: 'Koelen 5', v: 5 }] }
                    ],
                    bereken: function (v, h) {
                        var Ps = L.wh_m3_K * v.Q * (v.T2 - v.T1) / 1000, koelen = v.T2 < v.T1;
                        var uit = [h.uit(koelen ? 'Voelbaar koelvermogen' : 'Verwarmingsvermogen', Math.abs(Ps), 'kW', { dec: 2, hoofd: true })];
                        var st = ['P = 0,34 × ' + h.f(v.Q, 0) + ' × (' + h.f(v.T2, 1) + ' − ' + h.f(v.T1, 1) + ') = ' + h.f(Ps * 1000, 0, 'W')], P = Math.abs(Ps);
                        if (v.rv1 != null && v.rv2 != null) {
                            var a = lucht(v.T1, v.rv1, 1013), b = lucht(v.T2, v.rv2, 1013), m = a.rho * v.Q / 3600 / (1 + a.x);
                            var Pt = m * (b.h - a.h), water = m * (a.x - b.x) * 3600;
                            P = Math.abs(Pt);
                            uit.push(h.uit('Totaal vermogen (met vocht)', P, 'kW', { dec: 2, hoofd: true }), h.uit('Latent deel', Math.abs(Pt - Ps), 'kW', { dec: 2 }), h.uit(water >= 0 ? 'Condenswater' : 'Toe te voegen vocht', Math.abs(water), 'l/h', { dec: 2 }));
                            st.push('h₁ = ' + h.fmt(a.h, 1) + ' en h₂ = ' + h.f(b.h, 1, 'kJ/kg') + ', m = ' + h.f(m, 3, 'kg/s'), 'P = ' + h.fmt(m, 3) + ' × (' + h.fmt(b.h, 1) + ' − ' + h.fmt(a.h, 1) + ') = ' + h.f(Pt, 2, 'kW'));
                        }
                        uit.push(h.uit('Waterdebiet door de batterij', P * 1000 / (R.WATER.wh_l_K * v.dTw), 'l/h', { dec: 0, opm: 'bij ΔT ' + h.fmt(v.dTw, 0) + ' K' }));
                        return { uit: uit, stappen: st };
                    }
                }
            ] }
        ]
    });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-ventilatie */
