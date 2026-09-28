/* QE Rekenmachine — module Ventilatie & rookgas (v408)
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
    var KOELMIDDELEN = [{ v: 'R32', t: 'R32 (GWP 675)', gwp: 675 }, { v: 'R410A', t: 'R410A (GWP 2088)', gwp: 2088 }, { v: 'R454B', t: 'R454B (GWP 466)', gwp: 466 }, { v: 'R290', t: 'R290 propaan (GWP 3)', gwp: 3 }, { v: 'R134a', t: 'R134a (GWP 1430)', gwp: 1430 }, { v: 'R407C', t: 'R407C (GWP 1774)', gwp: 1774 }, { v: 'R1234ze', t: 'R1234ze (GWP 7)', gwp: 7 }, { v: 'R744', t: 'R744 CO₂ (GWP 1)', gwp: 1 }];

    R.registreer({
        key: 'ventilatie', naam: 'Ventilatie & rookgas', emoji: '🌬️', volgorde: 4,
        omschrijving: 'Woningventilatie, kanalen, warmteterugwinning, schouw en verbrandingslucht, airco en koelmiddel, vocht en geluid',
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
            { naam: 'Kanalen', items: [
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
                            stappen: ['ṁ = ' + T.f + ' g/s per kW × ' + h.f(v.P) + ' kW = ' + h.f(m * 1000, 1, 'g/s'), 'ρ_rookgas (' + h.fmt(Tgem, 0) + ' °C) = ' + h.fmt(rg, 3) + ' kg/m³, ρ_lucht (' + h.f(v.tl) + ' °C) = ' + h.fmt(rl, 3), 'p_H = 9,81 × ' + h.f(v.H) + ' × (' + h.fmt(rl, 3) + ' − ' + h.fmt(rg, 3) + ') = ' + h.f(pH, 1, 'Pa'), 'Δp = (λ × H/d + Σζ) × ρ × w² / 2 met λ = ' + S.lam + ', Σζ = ' + h.fmt(zeta, 1) + ' (intrede 0,5 + monding 1,0 + ' + v.bochten + ' × 0,4)'],
                            tabel: { kop: ['Maat', 'Snelheid', 'Weerstand', 'Trek − weerstand', ''], rijen: rijen }, waarsch: waarsch,
                            opm: 'Nooit kleiner dan de rookgasaansluiting van het toestel. Monding: minstens 1 m boven een plat dak, bij een hellend dak liefst boven de nok en buiten de windzone van hogere gebouwen (NBN B 61-002).'
                        };
                    }
                },
                {
                    id: 'vent.stookplaats', naam: 'Verbrandingslucht en stookplaatsventilatie', kort: 'Openingen (cm²) voor open toestellen en stookplaatsen',
                    zoek: 'verbrandingslucht toevoeropening stookplaats ventilatie cm2 per kw rooster nbn d 51-003 b 61-001 type b type c', soort: 'indicatief',
                    bron: 'Richtwaarden NBN D 51-003 / NBN B 61-001: onderste (toevoer) opening ≥ 6 cm² per kW, minimum 150 cm²; bovenste (afvoer) opening ≥ 3 cm² per kW, minimum 150 cm²; type C (gesloten, concentrisch) heeft geen toevoer nodig; luchtbehoefte ±1,2 m³ per kWh',
                    velden: [
                        { k: 'P', label: 'Totale belasting van de open toestellen', eh: 'kW', std: 30 },
                        { k: 'soort', label: 'Situatie', type: 'keuze', opties: [{ v: 'b', t: 'Type B (open) toestel(len) in een lokaal, < 70 kW' }, { v: 'stook', t: 'Stookplaats ≥ 70 kW (NBN B 61-001)' }, { v: 'c', t: 'Type C (gesloten) toestel' }] },
                        { k: 'vrij', label: 'Vrije doorlaat van het rooster', eh: '%', std: 60, snel: [{ t: 'Lamellen 50', v: 50 }, { t: 'Gaas 60', v: 60 }, { t: 'Open 80', v: 80 }] }
                    ],
                    bereken: function (v, h) {
                        if (v.soort === 'c') return { uit: [h.uit('Toevoeropening', 'niet nodig', '', { hoofd: true })], opm: 'Een gesloten toestel (type C) haalt zijn verbrandingslucht via de concentrische afvoer of een aparte luchtbuis; het lokaal hoeft geen verbrandingsluchtopening. Wel gewone ventilatie voor de ruimte.' };
                        var onder = Math.max(150, 6 * v.P), boven = Math.max(150, 3 * v.P);
                        var brutoO = onder / (v.vrij / 100), brutoB = boven / (v.vrij / 100), lucht = 1.2 * v.P;
                        function maat(cm2) { var z = Math.ceil(Math.sqrt(cm2) * 10 / 50) * 50; return z + ' × ' + z + ' mm'; }
                        return {
                            uit: [h.uit('Onderste opening (toevoer), netto', onder, 'cm²', { dec: 0, hoofd: true, opm: 'rooster bruto ±' + h.fmt(brutoO, 0) + ' cm² → ' + maat(brutoO) }), h.uit('Bovenste opening (afvoer), netto', boven, 'cm²', { dec: 0, hoofd: v.soort === 'stook', opm: 'rooster bruto ±' + h.fmt(brutoB, 0) + ' cm² → ' + maat(brutoB) }), h.uit('Verbrandingslucht bij vollast', lucht, 'm³/h', { dec: 0 })],
                            stappen: ['Onder = max(150, 6 × ' + h.f(v.P) + ') = ' + h.f(onder, 0, 'cm²'), 'Boven = max(150, 3 × ' + h.f(v.P) + ') = ' + h.f(boven, 0, 'cm²'), 'Bruto = netto / ' + h.f(v.vrij) + ' %'],
                            opm: 'Openingen rechtstreeks naar buiten, niet afsluitbaar, onder: laag bij de vloer; boven: hoog. Bij < 70 kW in een woonruimte gelden de vereenvoudigde regels van NBN D 51-003 (rechtstreekse opening of ventilatie via aangrenzende ruimtes) — controleer de norm.'
                        };
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
            { naam: 'Koeling', items: [
                {
                    id: 'vent.koellast', naam: 'Koellast airco snel', kort: 'kW en BTU/h uit oppervlakte, bezetting en toestellen',
                    zoek: 'airco koellast koelvermogen btu kw ruimte oppervlakte split personen zolder', soort: 'indicatief',
                    bron: 'Richtwaarden W/m²: slaapkamer 60, woonkamer 80, veel glas / zuid 120, kantoor 100, zolder onder een dak 150; + 100 W per persoon + toestellen · 1 kW = 3.412 BTU/h',
                    velden: [
                        { k: 'A', label: 'Oppervlakte', eh: 'm²' },
                        { k: 'q', label: 'Basislast', eh: 'W/m²', std: 80, snel: [{ t: 'Slaapkamer 60', v: 60 }, { t: 'Woonkamer 80', v: 80 }, { t: 'Kantoor 100', v: 100 }, { t: 'Veel glas 120', v: 120 }, { t: 'Zolder 150', v: 150 }] },
                        { k: 'pers', label: 'Personen', std: 2, min: 0 },
                        { k: 'app', label: 'Toestellen (pc’s, verlichting, keuken)', eh: 'W', std: 300 },
                        { k: 'eer', label: 'EER / SEER van de airco', std: 3.5, min: 1 },
                        { k: 'prijs', label: 'Stroomprijs', eh: '€/kWh', std: 0.35 }
                    ],
                    bereken: function (v, h) {
                        var P = (v.A * v.q + v.pers * 100 + v.app) / 1000, unit = h.omhoogNaar(P, [2, 2.5, 3.5, 5, 6, 7.1, 8.5, 10, 12, 14]);
                        return { uit: [h.uit('Koellast', P, 'kW', { dec: 2, hoofd: true, opm: h.fmt(P * 3412, 0) + ' BTU/h' }), h.uit('Toestel kiezen', unit ? unit + ' kW' : '> 14 kW', '', { hoofd: true }), h.uit('Elektrisch vermogen (EER ' + h.fmt(v.eer, 1) + ')', P / v.eer, 'kW', { dec: 2 }), h.uit('Kost per uur op vol vermogen', P / v.eer * v.prijs, '€', { dec: 2 })], stappen: ['P = (' + h.f(v.A) + ' × ' + h.f(v.q) + ' + ' + v.pers + ' × 100 + ' + h.f(v.app) + ') / 1000 = ' + h.f(P, 2, 'kW')], opm: 'Voor grote of atypische ruimtes (serverlokaal, veranda) een echte koellastberekening (VDI 2078) laten maken.' };
                    }
                },
                {
                    id: 'vent.koelmiddel', naam: 'Koelmiddel: extra vulling en F-gassen', kort: 'Bijvullen bij langere leidingen, CO₂-equivalent en lekcontrole',
                    zoek: 'koelmiddel bijvullen extra vulling leidinglengte r32 r410a gwp co2 equivalent f-gassen lekcontrole', soort: 'exact',
                    bron: 'Extra vulling = (leidinglengte − voorgevulde lengte) × g/m (fiche fabrikant, typisch 20 g/m bij 6,35/9,52 mm) · CO₂-eq = kg × GWP · (EU) 2024/573: lekcontrole vanaf 5 t CO₂-eq jaarlijks (10 t hermetisch), ≥ 50 t halfjaarlijks, ≥ 500 t per kwartaal; werken op het koelcircuit enkel door een gecertificeerde technicus',
                    velden: [
                        { k: 'km', label: 'Koelmiddel', type: 'keuze', opties: KOELMIDDELEN, std: 'R32' },
                        { k: 'vul', label: 'Fabrieksvulling', eh: 'kg', std: 1.2 },
                        { k: 'L', label: 'Leidinglengte', eh: 'm', std: 8 },
                        { k: 'L0', label: 'Voorgevuld tot', eh: 'm', std: 5 },
                        { k: 'gm', label: 'Bijvullen per meter', eh: 'g/m', std: 20 },
                        { k: 'herm', label: 'Hermetisch gesloten (fabrieksdicht, monoblok)', type: 'vink', std: false }
                    ],
                    bereken: function (v, h) {
                        var K = KOELMIDDELEN.filter(function (x) { return x.v === v.km; })[0];
                        var extra = Math.max(0, v.L - v.L0) * v.gm / 1000, tot = v.vul + extra, co2 = tot * K.gwp / 1000;
                        var drempel = v.herm ? 10 : 5, freq = co2 >= 500 ? 'elke 3 maanden' : co2 >= 50 ? 'elke 6 maanden' : co2 >= drempel ? 'jaarlijks (om de 24 maanden met lekdetectie)' : 'geen verplichte lekcontrole';
                        return { uit: [h.uit('Bij te vullen', extra * 1000, 'g', { dec: 0, hoofd: true }), h.uit('Totale vulling', tot, 'kg', { dec: 2 }), h.uit('CO₂-equivalent', co2, 't', { dec: 2, hoofd: true, kleur: co2 >= drempel ? 'amber' : 'groen' }), h.uit('Lekcontrole', freq, '')], stappen: ['Extra = (' + h.f(v.L) + ' − ' + h.f(v.L0) + ') × ' + h.f(v.gm) + ' g/m = ' + h.f(extra * 1000, 0, 'g'), 'CO₂-eq = ' + h.fmt(tot, 2) + ' kg × ' + K.gwp + ' = ' + h.f(co2, 2, 't')], opm: 'Registreer elke vulling in het logboek van de installatie (verplicht vanaf 5 t CO₂-eq).' };
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
                }
            ] }
        ]
    });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-ventilatie */
