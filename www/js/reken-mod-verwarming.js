/* QE Rekenmachine — module Verwarming (v408)
 * BRON = QE-Software/reken-mod-verwarming.js; kopie in de www via `node sync-reken.js`.
 * Normen/bronnen: NBN EN 12831 (warmteverlies, vereenvoudigd), EN 442 (radiatoren, n = 1,3),
 * EN 1264 (vloerverwarming, vereenvoudigd), EN 12828 (expansievat), NBN D 51-003 (gas, Renouard),
 * Siegert (rookgasanalyse), Vlaams besluit 8/12/2006 (keuring stooktoestellen).
 */
(function (root) {
    'use strict';
    var R = root.QEReken;
    if (!R) throw new Error('reken-kern.js eerst laden');
    var W = R.WATER, BUIZEN = R.BUIZEN;

    var GASSEN = {
        H: { naam: 'Aardgas H (rijk gas)', Hs: 11.6, Hi: 10.5, dr: 0.6, e: 'm³' },
        L: { naam: 'Aardgas L (arm gas)', Hs: 9.8, Hi: 8.8, dr: 0.64, e: 'm³' },
        propaan: { naam: 'Propaan', Hs: 13.8, Hi: 12.8, dr: 1.55, e: 'kg', HiGas: 25.9, kgl: 0.51 },
        butaan: { naam: 'Butaan', Hs: 13.7, Hi: 12.7, dr: 2.0, e: 'kg', HiGas: 31.7, kgl: 0.58 }
    };
    var METERS = [{ n: 'G4', max: 6 }, { n: 'G6', max: 10 }, { n: 'G10', max: 16 }, { n: 'G16', max: 25 }, { n: 'G25', max: 40 }, { n: 'G40', max: 65 }, { n: 'G65', max: 100 }];
    // uitzettingscoëfficiënt water (Vmax/V10 − 1) per maximumtemperatuur
    var E_WATER = { 40: 0.0079, 45: 0.0099, 50: 0.0121, 55: 0.0145, 60: 0.0171, 65: 0.0198, 70: 0.0228, 75: 0.0258, 80: 0.029, 85: 0.0324, 90: 0.0359, 95: 0.0396, 100: 0.0434 };
    var VATEN = [8, 12, 18, 25, 35, 50, 80, 100, 140, 200, 250, 300, 400, 500, 600, 800, 1000];
    // radiatoren: W per meter bij ΔT 50 K (EN 442, gemiddelde paneelradiator; richtwaarden)
    var RAD_WM = { 300: { 11: 640, 21: 900, 22: 1140, 33: 1620 }, 400: { 11: 820, 21: 1160, 22: 1470, 33: 2080 }, 500: { 11: 960, 21: 1380, 22: 1750, 33: 2500 }, 600: { 11: 1100, 21: 1590, 22: 2010, 33: 2880 }, 900: { 11: 1560, 21: 2230, 22: 2830, 33: 4000 } };
    var RAD_L = [40, 50, 60, 70, 80, 90, 100, 110, 120, 140, 160, 180, 200, 220, 240, 260, 300];
    var RAD_INHOUD = { 11: 3.0, 21: 4.4, 22: 5.9, 33: 8.8 };   // l per meter bij h 600 (richtwaarde)
    var REGIMES = [{ v: '75/65', t: '75/65 °C (klassiek, ΔT 50)', tv: 75, tr: 65 }, { v: '70/55', t: '70/55 °C', tv: 70, tr: 55 }, { v: '65/50', t: '65/50 °C', tv: 65, tr: 50 }, { v: '55/45', t: '55/45 °C (lage temperatuur)', tv: 55, tr: 45 }, { v: '45/35', t: '45/35 °C (warmtepomp)', tv: 45, tr: 35 }, { v: '35/28', t: '35/28 °C (vloerverwarming / WP)', tv: 35, tr: 28 }];
    function regime(v) { return REGIMES.filter(function (r) { return r.v === v; })[0] || REGIMES[0]; }
    function dtLn(tv, tr, ti) {
        if (tv <= ti || tr <= ti || tv <= tr) return null;
        return (tv - tr) / Math.log((tv - ti) / (tr - ti));
    }
    var DT_REF = dtLn(75, 65, 20);   // 49,83 K
    function buisOpties() {
        var o = [];
        Object.keys(BUIZEN).forEach(function (k) { if (k === 'pvc') return; BUIZEN[k].maten.forEach(function (m) { o.push({ v: k + '|' + m.n, t: BUIZEN[k].naam.split(' (')[0] + ' ' + m.n + ' (' + R.fmt(m.d, 1) + ' mm)' }); }); });
        return o;
    }
    function buis(key) { var p = key.split('|'), mat = BUIZEN[p[0]]; var m = mat ? mat.maten.filter(function (x) { return x.n === p[1]; })[0] : null; return m ? { mat: mat, m: m, key: p[0] } : null; }
    var NU = { w60: 0.475e-6, w40: 0.66e-6, w20: 1.0e-6, w10: 1.31e-6, g30: 1.6e-6 };
    var MEDIA = [{ v: 'w60', t: 'Verwarmingswater 60 °C' }, { v: 'w40', t: 'Water 40 °C (vloerverwarming, WP)' }, { v: 'w20', t: 'Water 20 °C' }, { v: 'w10', t: 'Koud water 10 °C (sanitair)' }, { v: 'g30', t: 'Water-glycol 30 % 40 °C' }];
    var STANDAARD_L = [8, 10, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 50, 60, 80, 100];
    var VINK = String.fromCharCode(0x2713);

    // v411 — U-waarde: warmtegeleiding λ in W/(m·K) (rekenwaarden), of een vaste weerstand R voor een luchtlaag
    var LAGEN = [
        { v: 'pir', t: 'Isolatie PIR / PUR (λ 0,023)', l: 0.023 }, { v: 'resol', t: 'Isolatie resolschuim (0,021)', l: 0.021 }, { v: 'mw32', t: 'Isolatie minerale wol (0,032)', l: 0.032 },
        { v: 'mw35', t: 'Isolatie minerale wol (0,035)', l: 0.035 }, { v: 'epsg', t: 'Isolatie EPS grijs (0,032)', l: 0.032 }, { v: 'eps', t: 'Isolatie EPS wit (0,038)', l: 0.038 },
        { v: 'xps', t: 'Isolatie XPS (0,035)', l: 0.035 }, { v: 'cel', t: 'Isolatie cellulose (0,039)', l: 0.039 }, { v: 'hv', t: 'Isolatie houtvezel (0,040)', l: 0.04 },
        { v: 'cg', t: 'Isolatie cellenglas (0,041)', l: 0.041 }, { v: 'spur', t: 'Gespoten PUR op de vloer (0,028)', l: 0.028 }, { v: 'isochape', t: 'Isolerende uitvulling, EPS-mortel (0,09)', l: 0.09 },
        { v: 'gevel', t: 'Gevelsteen (0,90)', l: 0.9 }, { v: 'snelbouw', t: 'Snelbouwsteen (0,40)', l: 0.4 }, { v: 'isosteen', t: 'Isolerende snelbouwsteen (0,24)', l: 0.24 },
        { v: 'volsteen', t: 'Volle baksteen, oud metselwerk (0,80)', l: 0.8 }, { v: 'cellenbeton', t: 'Cellenbeton (0,13)', l: 0.13 }, { v: 'kzs', t: 'Kalkzandsteen (0,91)', l: 0.91 },
        { v: 'betonblok', t: 'Betonblok (1,30)', l: 1.3 }, { v: 'beton', t: 'Gewapend beton (1,70)', l: 1.7 }, { v: 'chape', t: 'Chape of dekvloer (1,20)', l: 1.2 },
        { v: 'tegel', t: 'Tegels (1,20)', l: 1.2 }, { v: 'pleister', t: 'Gipspleister (0,52)', l: 0.52 }, { v: 'gyproc', t: 'Gipskartonplaat (0,25)', l: 0.25 },
        { v: 'cement', t: 'Cementpleister of crepi (0,93)', l: 0.93 }, { v: 'hout', t: 'Hout, naaldhout (0,13)', l: 0.13 }, { v: 'osb', t: 'OSB of multiplex (0,15)', l: 0.15 },
        { v: 'spouw', t: 'Luchtspouw, niet geventileerd (R 0,18)', R: 0.18 }, { v: 'spouwv', t: 'Luchtspouw, licht geventileerd (R 0,09)', R: 0.09 }
    ];
    var BOUWDELEN = [
        { v: 'muur', t: 'Buitenmuur', rsi: 0.13, rse: 0.04 }, { v: 'dak', t: 'Dak of plafond onder een zolder', rsi: 0.1, rse: 0.04 },
        { v: 'vloerb', t: 'Vloer boven buitenlucht of kruipruimte', rsi: 0.17, rse: 0.04 }, { v: 'vloerg', t: 'Vloer op volle grond', rsi: 0.17, rse: 0 },
        { v: 'binnen', t: 'Binnenmuur naar een onverwarmde ruimte', rsi: 0.13, rse: 0.13 }
    ];
    var KVS = [0.25, 0.4, 0.63, 1, 1.6, 2.5, 4, 6.3, 10, 16, 25, 40, 63, 100, 160];
    // v411 — kant-en-klare evenwichtsfles: grootste debiet in m³/h per maat (Caleffi reeks 548)
    var WISSEL_KANT = [{ dn: 25, q: 2.5 }, { dn: 32, q: 4 }, { dn: 40, q: 6 }, { dn: 50, q: 8.5 }, { dn: 65, q: 18 }, { dn: 80, q: 28 }, { dn: 100, q: 56 }, { dn: 125, q: 75 }, { dn: 150, q: 110 }, { dn: 200, q: 180 }, { dn: 250, q: 300 }, { dn: 300, q: 420 }];
    // v411 — membraanveiligheidsventielen: grootste ketelvermogen (kW) per maat en insteldruk (datablad SYR 1915)
    var SV_MAAT = [{ dn: 15, duim: '½"' }, { dn: 20, duim: '¾"' }, { dn: 25, duim: '1"' }, { dn: 32, duim: '1¼"' }, { dn: 40, duim: '1½"' }, { dn: 50, duim: '2"' }];
    var SV_UIT = ['¾"', '1"', '1¼"', '1½"', '2"', '2½"', '3"'];
    var SV_KW = { 1.5: [36, 72, 144, 252, 433, 650], 2: [43, 86, 172, 302, 518, 778], 2.5: [50, 100, 200, 350, 600, 900] };
    // v411 — VDI 2035 blad 1 (2021-03), tabel 1: toegelaten totale hardheid in mmol/l (null = geen eis) per specifieke waterinhoud
    var VDI2035 = [
        { t: 'Tot 50 kW, grote ketel', g: [null, 3, 0.05] },
        { t: 'Tot 50 kW, wandketel', g: [3, 1.5, 0.05] },
        { t: '50 tot 200 kW', g: [2, 1, 0.05] },
        { t: '200 tot 600 kW', g: [1.5, 0.05, 0.05] },
        { t: 'Meer dan 600 kW', g: [0.05, 0.05, 0.05] }
    ];
    // v411 — condensaat: liter per kWh, pH en neutralisatie (DWA-A 251)
    var CONDENS = [
        { v: 'gas', t: 'Aardgas', c: 0.14, ph: 'pH 3,7 tot 5,4' },
        { v: 'propaan', t: 'Propaan', c: 0.11, ph: 'pH 3,7 tot 5,4' },
        { v: 'olie', t: 'Stookolie, zwavelarm (tot 50 mg zwavel per kg)', c: 0.08, ph: 'pH 2,2 tot 4,2' },
        { v: 'olie2', t: 'Gewone stookolie', c: 0.08, ph: 'pH 1,8 tot 3,7', altijd: true }
    ];
    // Wh per liter en per graad: water en water met glycol
    var WARMTEDRAGER = [{ v: 1.163, t: 'Water' }, { v: 1.12, t: 'Water met 20 % glycol' }, { v: 1.08, t: 'Water met 30 % glycol' }, { v: 1.03, t: 'Water met 40 % glycol' }];
    // EPB-installatie-eisen (Energiebesluit bijlage XII, punt 7.1.2): kleinste lineaire warmteweerstand in m·K/W per buitendiameter.
    // Regime I = vertrek tot 55 °C, regime II = hoger. Omgeving I = buiten, in de grond, in de vloer of buiten het beschermd volume (h = 25),
    // omgeving II = technisch lokaal, koker, opbouw of verlaagd plafond (h = 8). Tussen de maten lineair interpoleren.
    var EPB_ISO = {
        d: [17.2, 21.3, 26.9, 33.7, 42.4, 48.3, 60.3, 76.1, 88.9, 114.3, 139.7, 168.3, 219.1, 273, 323.9, 355.6, 406.4],
        'I-I': [5.92, 5.49, 5.08, 4.65, 4.26, 4.03, 3.66, 3.3, 3.08, 2.72, 2.45, 2.22, 1.92, 1.68, 1.52, 1.43, 1.31],
        'I-II': [5.21, 4.81, 4.42, 4.05, 3.69, 3.48, 3.15, 2.84, 2.62, 2.31, 2.08, 1.87, 1.61, 1.4, 1.26, 1.18, 1.08],
        'II-I': [6.41, 5.95, 5.49, 5.08, 4.65, 4.41, 4.02, 3.64, 3.39, 3, 2.72, 2.47, 2.14, 1.88, 1.7, 1.61, 1.48],
        'II-II': [5.92, 5.49, 5.08, 4.65, 4.26, 4.03, 3.66, 3.3, 3.08, 2.72, 2.45, 2.22, 1.92, 1.68, 1.52, 1.43, 1.31]
    };
    function rLineair(Dmm, smm, lam, hh) { var D = Dmm / 1000, Di = D + 2 * smm / 1000; return Math.log(Di / D) / (2 * Math.PI * lam) + 1 / (hh * Math.PI * Di); }
    function staalDn(dmin) { var m = BUIZEN.staal.maten.filter(function (x) { return x.d >= dmin; })[0]; return m ? m.n : null; }

    R.registreer({
        key: 'verwarming', naam: 'Verwarming', emoji: '🔥', volgorde: 1,
        omschrijving: 'Warmteverlies, radiatoren en vloerverwarming, hydraulica, vulwater, ketel en condensaat, gas en stookolie, warmtepomp',
        groepen: [
            { naam: 'Warmtebehoefte', items: [
                {
                    id: 'verw.verlies_snel', naam: 'Warmteverlies snel schatten', kort: 'kW uit oppervlakte en isolatiegraad',
                    zoek: 'warmteverlies warmtebehoefte ketelvermogen schatting w/m2 isolatie bouwjaar vuistregel', soort: 'indicatief',
                    bron: 'Richtwaarden W/m² bij ontwerp-ΔT 28 K (20 °C binnen, −8 °C buiten, NBN EN 12831 België); gecorrigeerd voor de ingevulde temperaturen',
                    uitleg: 'Vuistregel om een ketel of warmtepomp een eerste maat te geven. Voor een echte berekening per ruimte: “Warmteverlies per ruimte”.',
                    velden: [
                        { k: 'A', label: 'Verwarmde vloeroppervlakte', eh: 'm²' },
                        { k: 'iso', label: 'Isolatiegraad', type: 'keuze', opties: [{ v: 130, t: 'Vóór 1975, niet geïsoleerd (130 W/m²)' }, { v: 100, t: '1975–1990, weinig isolatie (100 W/m²)' }, { v: 80, t: '1990–2006, matig geïsoleerd (80 W/m²)' }, { v: 60, t: '2006–2014, goed geïsoleerd, K45 (60 W/m²)' }, { v: 40, t: 'Na 2014, zeer goed geïsoleerd, BEN (40 W/m²)' }, { v: 15, t: 'Passiefhuis (15 W/m²)' }], std: 80 },
                        { k: 'ti', label: 'Binnentemperatuur', eh: '°C', std: 20 },
                        { k: 'te', label: 'Buitentemperatuur (ontwerp)', eh: '°C', std: -8, snel: [{ t: 'Kust −7', v: -7 }, { t: 'Antwerpen −8', v: -8 }, { t: 'Kempen −9', v: -9 }, { t: 'Ardennen −12', v: -12 }] },
                        { k: 'toeslag', label: 'Toeslag opwarmen na nachtverlaging', eh: '%', std: 10, snel: [{ t: '0', v: 0 }, { t: '10', v: 10 }, { t: '20', v: 20 }] }
                    ],
                    bereken: function (v, h) {
                        var q = Number(v.iso) * (v.ti - v.te) / 28, P = v.A * q * (1 + v.toeslag / 100) / 1000;
                        return {
                            uit: [h.uit('Warmteverlies', P, 'kW', { dec: 1, hoofd: true }), h.uit('Per m²', q * (1 + v.toeslag / 100), 'W/m²', { dec: 0 }), h.uit('Zonder toeslag', v.A * q / 1000, 'kW', { dec: 1 })],
                            stappen: ['q = ' + Number(v.iso) + ' W/m² × (' + h.f(v.ti) + ' − ' + h.f(v.te) + ') / 28 = ' + h.f(q, 0, 'W/m²'), 'P = ' + h.f(v.A) + ' m² × ' + h.f(q, 0) + ' × (1 + ' + h.f(v.toeslag) + ' %) = ' + h.f(P, 1, 'kW')],
                            opm: 'Warm water komt hier nog bij: zie “Ketelvermogen kiezen”.'
                        };
                    }
                },
                {
                    id: 'verw.verlies_ruimte', naam: 'Warmteverlies per ruimte', kort: 'Transmissie door muren, ramen, dak en vloer + ventilatie (EN 12831 vereenvoudigd)',
                    zoek: 'warmteverlies ruimte u-waarde transmissie ventilatie en 12831 radiator vermogen per kamer', soort: 'indicatief',
                    bron: 'Φ = Σ(U × A × f) × (θ_i − θ_e) + 0,34 × V × n × (θ_i − θ_e); f = 1 naar buiten, 0,5 vloer op grond / naar onverwarmde ruimte, 0,7 boven kruipruimte — vereenvoudiging van NBN EN 12831',
                    uitleg: 'Vul per bouwdeel de oppervlakte naar buiten (of naar een onverwarmde ruimte) en de U-waarde in. De snelkeuzes geven gangbare U-waarden per bouwperiode.',
                    velden: [
                        { k: 'ti', label: 'Binnentemperatuur', eh: '°C', std: 20, snel: [{ t: 'Woonkamer 20', v: 20 }, { t: 'Keuken 20', v: 20 }, { t: 'Slaapkamer 18', v: 18 }, { t: 'Badkamer 24', v: 24 }, { t: 'Gang 16', v: 16 }] },
                        { k: 'te', label: 'Buitentemperatuur (ontwerp)', eh: '°C', std: -8 },
                        { k: 'Am', label: 'Buitenmuur', eh: 'm²', std: 0, min: 0 },
                        { k: 'Um', label: 'U-waarde muur', eh: 'W/(m²·K)', std: 0.6, snel: [{ t: 'Volle steen 2,0', v: 2 }, { t: 'Spouw leeg 1,5', v: 1.5 }, { t: 'Spouw isolatie 0,6', v: 0.6 }, { t: 'Na 2006 0,4', v: 0.4 }, { t: 'BEN 0,24', v: 0.24 }] },
                        { k: 'Ar', label: 'Ramen en buitendeuren', eh: 'm²', std: 0, min: 0 },
                        { k: 'Ur', label: 'U-waarde ramen', eh: 'W/(m²·K)', std: 1.1, snel: [{ t: 'Enkel glas 5,8', v: 5.8 }, { t: 'Oud dubbel 2,9', v: 2.9 }, { t: 'HR 1,6', v: 1.6 }, { t: 'HR+ 1,1', v: 1.1 }, { t: 'Driedubbel 0,7', v: 0.7 }] },
                        { k: 'Ad', label: 'Dak of plafond naar buiten/zolder', eh: 'm²', std: 0, min: 0 },
                        { k: 'Ud', label: 'U-waarde dak', eh: 'W/(m²·K)', std: 0.3, snel: [{ t: 'Ongeïsoleerd 2,5', v: 2.5 }, { t: 'Matig 0,6', v: 0.6 }, { t: 'Goed 0,3', v: 0.3 }, { t: 'BEN 0,24', v: 0.24 }] },
                        { k: 'Av', label: 'Vloer', eh: 'm²', std: 0, min: 0 },
                        { k: 'Uv', label: 'U-waarde vloer', eh: 'W/(m²·K)', std: 0.4, snel: [{ t: 'Ongeïsoleerd 1,0', v: 1 }, { t: 'Geïsoleerd 0,4', v: 0.4 }, { t: 'BEN 0,24', v: 0.24 }] },
                        { k: 'fv', label: 'Vloer grenst aan', type: 'keuze', opties: [{ v: 0.5, t: 'Volle grond (factor 0,5)' }, { v: 0.7, t: 'Kruipruimte of kelder (0,7)' }, { v: 1, t: 'Buitenlucht, bv. boven een doorrit (1,0)' }, { v: 0, t: 'Verwarmde ruimte (0)' }], std: 0.5 },
                        { k: 'Ab', label: 'Binnenmuur naar onverwarmde ruimte (garage, zolder)', eh: 'm²', std: 0, min: 0 },
                        { k: 'Ub', label: 'U-waarde binnenmuur', eh: 'W/(m²·K)', std: 1.5 },
                        { k: 'V', label: 'Volume van de ruimte', eh: 'm³', hint: 'oppervlakte × hoogte' },
                        { k: 'n', label: 'Luchtverversing', eh: '1/h', std: 0.5, snel: [{ t: 'Nieuwbouw dicht 0,3', v: 0.3 }, { t: 'Normaal 0,5', v: 0.5 }, { t: 'Oud, tochtig 1,0', v: 1 }] },
                        { k: 'toeslag', label: 'Toeslag opwarmen', eh: '%', std: 10 }
                    ],
                    bereken: function (v, h) {
                        var dT = v.ti - v.te;
                        var delen = [['Buitenmuur', v.Am * v.Um * 1], ['Ramen en deuren', v.Ar * v.Ur * 1], ['Dak/plafond', v.Ad * v.Ud * 1], ['Vloer', v.Av * v.Uv * Number(v.fv)], ['Binnenmuur onverwarmd', v.Ab * v.Ub * 0.5]];
                        var Ht = delen.reduce(function (a, d) { return a + d[1]; }, 0), Hv = 0.34 * v.V * v.n;
                        var Pt = Ht * dT, Pv = Hv * dT, P = (Pt + Pv) * (1 + v.toeslag / 100);
                        var rijen = delen.filter(function (d) { return d[1] > 0; }).map(function (d) { return [d[0], h.fmt(d[1], 2) + ' W/K', h.fmt(d[1] * dT, 0) + ' W']; });
                        rijen.push(['Ventilatie (' + h.fmt(v.V) + ' m³ × ' + h.fmt(v.n) + '/h)', h.fmt(Hv, 2) + ' W/K', h.fmt(Pv, 0) + ' W']);
                        var opp = v.V > 0 ? v.V / 2.6 : 0;
                        return {
                            uit: [h.uit('Warmteverlies ruimte', P, 'W', { dec: 0, hoofd: true }), h.uit('Transmissie', Pt, 'W', { dec: 0 }), h.uit('Ventilatie', Pv, 'W', { dec: 0 }), h.uit('Nodige radiator (bij dit regime zie “Radiatoren kiezen”)', P, 'W', { dec: 0 }), h.uit('≈ per m² (bij 2,6 m hoogte)', opp ? P / opp : null, 'W/m²', { dec: 0 })],
                            stappen: ['H_T = Σ U × A × f = ' + h.f(Ht, 2, 'W/K'), 'H_V = 0,34 × ' + h.f(v.V) + ' × ' + h.f(v.n) + ' = ' + h.f(Hv, 2, 'W/K'), 'Φ = (H_T + H_V) × ' + h.f(dT) + ' K × (1 + ' + h.f(v.toeslag) + ' %) = ' + h.f(P, 0, 'W')],
                            tabel: { kop: ['Onderdeel', 'H', 'Verlies'], rijen: rijen }
                        };
                    }
                },
                {
                    id: 'verw.ketel', naam: 'Ketelvermogen kiezen', kort: 'Verwarming + warm water + reserve',
                    zoek: 'ketelvermogen ketel kiezen kw combi boiler sanitair warm water reserve modulatie', soort: 'indicatief',
                    bron: 'Combiketel: het tapdebiet bepaalt het vermogen (12 l/min bij ΔT 30 K = 25 kW); indirecte boiler: laadvermogen 2–3 kW extra of voorrang; verwarming alleen: warmteverlies + reserve',
                    velden: [
                        { k: 'Pv', label: 'Warmteverlies van de woning', eh: 'kW', ehs: ['kW', 'W'] },
                        { k: 'sww', label: 'Warm water', type: 'keuze', opties: [{ v: 'combi', t: 'Combiketel (doorstroom)' }, { v: 'boiler', t: 'Indirecte boiler (voorrangschakeling)' }, { v: 'geen', t: 'Geen (aparte boiler / geen SWW)' }] },
                        { k: 'pers', label: 'Personen', std: 4, min: 1, max: 20 },
                        { k: 'res', label: 'Reserve', eh: '%', std: 10, min: 0, max: 50 }
                    ],
                    bereken: function (v, h) {
                        var Pverw = v.Pv * (1 + v.res / 100), Psww = 0, uitleg = '';
                        if (v.sww === 'combi') { Psww = v.pers <= 2 ? 24 : v.pers <= 4 ? 28 : v.pers <= 6 ? 32 : 35; uitleg = 'combi: tapcomfort ' + (v.pers <= 2 ? '12' : v.pers <= 4 ? '14' : v.pers <= 6 ? '16' : '18') + ' l/min bij ΔT 30 K'; }
                        else if (v.sww === 'boiler') { Psww = Pverw + 2; uitleg = 'boiler met voorrang: het laden gaat vóór; 2 kW extra dekt de stilstand'; }
                        var Pk = Math.max(Pverw, Psww);
                        var waarsch = [];
                        if (v.sww === 'combi' && Pk > Pverw * 2) waarsch.push('Het tapwater bepaalt het vermogen (' + h.fmt(Pk, 0) + ' kW) terwijl de verwarming maar ' + h.fmt(Pverw, 1) + ' kW vraagt: kies een ketel die laag genoeg moduleert (bv. 3–25 kW) of overweeg een boiler.');
                        return {
                            uit: [h.uit('Gekozen ketelvermogen (nominaal)', Pk, 'kW', { dec: 0, hoofd: true }), h.uit('Verwarming incl. reserve', Pverw, 'kW', { dec: 1 }), h.uit('Warm water', Psww || 'n.v.t.', Psww ? 'kW' : '', { opm: uitleg }), h.uit('Gewenste modulatie tot', Math.max(2, v.Pv * 0.2), 'kW', { dec: 1, opm: '±20 % van het warmteverlies, tegen pendelen' })],
                            stappen: ['P_verwarming = ' + h.f(v.Pv, 1) + ' × (1 + ' + h.f(v.res) + ' %) = ' + h.f(Pverw, 1, 'kW'), 'P_ketel = max(verwarming, warm water) = ' + h.f(Pk, 0, 'kW')],
                            waarsch: waarsch
                        };
                    }
                },
                {
                    id: 'verw.jaarverbruik', naam: 'Jaarverbruik schatten', kort: 'kWh, m³ gas, liter stookolie of kWh warmtepomp per jaar',
                    zoek: 'jaarverbruik verbruik per jaar kwh m3 gas stookolie pellets warmtepomp kost energie', soort: 'indicatief',
                    bron: 'Richtwaarden kWh/(m²·jaar) voor verwarming per isolatiegraad + 800 kWh per persoon voor warm water; rendementen gas 0,95, stookolie 0,90, pellets 0,85, warmtepomp SCOP 3,5',
                    velden: [
                        { k: 'A', label: 'Verwarmde oppervlakte', eh: 'm²' },
                        { k: 'kl', label: 'Woning', type: 'keuze', opties: [{ v: 220, t: 'Oud, niet geïsoleerd (220 kWh/m²)' }, { v: 160, t: 'Weinig geïsoleerd (160)' }, { v: 110, t: 'Matig geïsoleerd (110)' }, { v: 70, t: 'Goed geïsoleerd (70)' }, { v: 40, t: 'BEN / nieuwbouw (40)' }, { v: 15, t: 'Passief (15)' }], std: 110 },
                        { k: 'pers', label: 'Personen (warm water)', std: 4, min: 0 },
                        { k: 'pg', label: 'Gasprijs', eh: '€/kWh', std: 0.1 },
                        { k: 'po', label: 'Stookolieprijs', eh: '€/l', std: 1 },
                        { k: 'pe', label: 'Stroomprijs', eh: '€/kWh', std: 0.35 },
                        { k: 'pp', label: 'Pelletprijs', eh: '€/kg', std: 0.4 }
                    ],
                    bereken: function (v, h) {
                        var Q = v.A * Number(v.kl) + v.pers * 800;
                        var gas = Q / 0.95, olie = Q / 0.9 / 10, wp = Q / 3.5, pel = Q / 0.85 / 4.8;
                        return {
                            uit: [h.uit('Warmtevraag per jaar', Q, 'kWh', { dec: 0, hoofd: true }), h.uit('Aardgas', h.fmt(gas, 0) + ' kWh ≈ ' + h.fmt(gas / 11.6, 0) + ' m³ · € ' + h.fmt(gas * v.pg, 0), ''), h.uit('Stookolie', h.fmt(olie, 0) + ' l · € ' + h.fmt(olie * v.po, 0), ''), h.uit('Warmtepomp (SCOP 3,5)', h.fmt(wp, 0) + ' kWh · € ' + h.fmt(wp * v.pe, 0), ''), h.uit('Pellets', h.fmt(pel, 0) + ' kg · € ' + h.fmt(pel * v.pp, 0), ''), h.uit('CO₂ gas / olie / WP', h.fmt(gas * 0.202 / 1000, 1) + ' / ' + h.fmt(olie * 10 * 0.266 / 1000, 1) + ' / ' + h.fmt(wp * 0.17 / 1000, 1) + ' ton', '')],
                            stappen: ['Q = ' + h.f(v.A) + ' m² × ' + Number(v.kl) + ' + ' + v.pers + ' × 800 = ' + h.f(Q, 0, 'kWh')]
                        };
                    }
                },
                {
                    id: 'verw.zwembad', naam: 'Zwembad verwarmen', kort: 'Opwarmtijd, vermogen en kost per dag',
                    zoek: 'zwembad verwarmen zwembadwarmtepomp opwarmtijd vermogen wisselaar zwembadwater jacuzzi spa afdekking', soort: 'indicatief',
                    bron: 'Opwarmen: E = V × 1,163 kWh per m³ en per graad · op temperatuur houden: V × 1,163 × afkoeling per dag · de afkoeling per dag is een schatting die je zelf aanpast (met afdekking veel minder dan zonder)',
                    uitleg: 'Vul het vermogen in om de opwarmtijd te kennen, of de gewenste opwarmtijd om het vermogen te kennen. Meet de afkoeling van je eigen bad: temperatuur ’s avonds en ’s ochtends, met de verwarming uit.',
                    velden: [
                        { k: 'L', label: 'Lengte', eh: 'm', min: 0 },
                        { k: 'B', label: 'Breedte', eh: 'm', min: 0 },
                        { k: 'd', label: 'Gemiddelde diepte', eh: 'm', std: 1.4, min: 0 },
                        { k: 'Tb', label: 'Temperatuur van het water nu', eh: '°C', std: 12 },
                        { k: 'Td', label: 'Gewenste temperatuur', eh: '°C', std: 28 },
                        { k: 'P', label: 'Vermogen van de verwarming', eh: 'kW', opt: true, min: 0 },
                        { k: 't', label: 'of gewenste opwarmtijd', eh: 'dag', ehs: ['dag', 'h'], opt: true, min: 0 },
                        { k: 'afk', label: 'Afkoeling per dag', eh: 'K', std: 1, min: 0, snel: [{ t: 'Met afdekking 0,5', v: 0.5 }, { t: 'Zonder afdekking 1,5', v: 1.5 }] },
                        { k: 'cop', label: 'COP van de warmtepomp (1 = elektrisch, leeg = ketel)', opt: true, min: 0.5, max: 10, snel: [{ t: 'Warmtepomp 5', v: 5 }, { t: 'Elektrisch 1', v: 1 }] },
                        { k: 'prijs', label: 'Prijs van de energie', eh: '€/kWh', std: 0.35, min: 0, snel: [{ t: 'Stroom 0,35', v: 0.35 }, { t: 'Gas 0,10', v: 0.1 }] }
                    ],
                    bereken: function (v, h) {
                        var V = v.L * v.B * v.d, dT = v.Td - v.Tb;
                        if (!(V > 0)) return { fout: 'De afmetingen moeten groter zijn dan 0' };
                        if (!(dT > 0)) return { fout: 'De gewenste temperatuur moet hoger zijn dan de temperatuur nu' };
                        var E = V * 1.163 * dT, dag = V * 1.163 * v.afk, cop = v.cop > 0 ? v.cop : 1, uit = [], st = ['Inhoud = ' + h.f(v.L, 1) + ' × ' + h.f(v.B, 1) + ' × ' + h.f(v.d, 2) + ' = ' + h.f(V, 1, 'm³'), 'Opwarmen = ' + h.fmt(V, 1) + ' × 1,163 × ' + h.f(dT, 0) + ' K = ' + h.f(E, 0, 'kWh')];
                        function duur(uren) { var u = Math.round(uren); return u >= 48 ? h.fmt(uren / 24, 1) + ' dagen' : u + ' uur'; }
                        if (v.P > 0) { var netto = v.P - dag / 24; if (!(netto > 0)) return { fout: 'Dit vermogen is kleiner dan het verlies van het bad (' + h.fmt(dag / 24, 1) + ' kW): het water wordt niet warmer' }; uit.push(h.uit('Opwarmtijd', duur(E / netto), '', { hoofd: true, opm: 'bij ' + h.fmt(v.P, 1) + ' kW, het verlies tijdens het opwarmen meegerekend' })); st.push('Tijd = ' + h.fmt(E, 0) + ' / (' + h.f(v.P, 1) + ' − ' + h.fmt(dag / 24, 1) + ') = ' + h.f(E / netto, 0, 'uur')); }
                        else if (v.t > 0) { var Pn = E / (v.t * 24) + dag / 24; uit.push(h.uit('Nodig vermogen', Pn, 'kW', { dec: 1, hoofd: true, opm: 'om in ' + duur(v.t * 24) + ' op temperatuur te zijn' })); st.push('P = ' + h.fmt(E, 0) + ' / ' + h.f(v.t * 24, 0) + ' uur + ' + h.fmt(dag / 24, 1) + ' = ' + h.f(Pn, 1, 'kW')); }
                        uit.push(h.uit('Inhoud', V, 'm³', { dec: 1, hoofd: !(v.P > 0) && !(v.t > 0) }), h.uit('Warmte om op te warmen', E, 'kWh', { dec: 0, opm: '€ ' + h.fmt(E / cop * v.prijs, 0) }), h.uit('Op temperatuur houden', dag, 'kWh per dag', { dec: 0, hoofd: true, opm: h.fmt(dag / 24, 1) + ' kW gemiddeld · € ' + h.fmt(dag / cop * v.prijs, 2) + ' per dag' }));
                        return { uit: uit, stappen: st, opm: 'Het grootste verlies van een zwembad is verdamping aan het oppervlak: een afdekking spaart het meeste. Een zwembadwarmtepomp haalt haar opgegeven COP alleen bij warm weer. Zwembadwater is agressief: gebruik een wisselaar in titanium of een toestel dat voor zwembaden gemaakt is.' };
                    }
                },
                {
                    id: 'verw.uwaarde', naam: 'U-waarde van een wand', kort: 'Warmtedoorgang uit de lagen: steen, isolatie, spouw en afwerking',
                    zoek: 'u-waarde r-waarde wand muur dak vloer lagen isolatie dikte lambda warmtedoorgang warmteweerstand epb spouwmuur pir minerale wol', soort: 'indicatief',
                    bron: 'R_totaal = R_si + Σ(dikte / λ) + R_se en U = 1 / R_totaal (NBN EN ISO 6946) · overgangsweerstanden: muur 0,13 + 0,04 · dak 0,10 + 0,04 · vloer 0,17 + 0,04 m²·K/W · λ = rekenwaarden per materiaal',
                    uitleg: 'Zet de lagen van binnen naar buiten onder elkaar. Bij een luchtspouw telt de dikte niet: de weerstand ligt vast. De uitkomst kan je invullen in “Warmteverlies per ruimte”.',
                    velden: [
                        { k: 'deel', label: 'Bouwdeel', type: 'keuze', opties: BOUWDELEN.map(function (b) { return { v: b.v, t: b.t }; }), std: 'muur' },
                        { k: 'rijen', label: 'Lagen (van binnen naar buiten)', type: 'rijen', kolommen: [{ k: 'mat', label: 'Materiaal', type: 'keuze', opties: LAGEN.map(function (x) { return { v: x.v, t: x.t }; }) }, { k: 'd', label: 'Dikte in mm', type: 'getal' }], std: [{ mat: 'pleister', d: 15 }, { mat: 'snelbouw', d: 140 }, { mat: 'pir', d: 100 }, { mat: 'spouw', d: 30 }, { mat: 'gevel', d: 90 }] },
                        { k: 'doel', label: 'Gewenste U-waarde', eh: 'W/(m²·K)', std: 0.24, min: 0.05, snel: [{ t: 'EPB 0,24', v: 0.24 }, { t: '0,20', v: 0.2 }, { t: '0,15', v: 0.15 }] }
                    ],
                    bereken: function (v, h) {
                        var B = BOUWDELEN.filter(function (b) { return b.v === v.deel; })[0] || BOUWDELEN[0], R0 = B.rsi + B.rse, Rt = R0, rijen = [];
                        v.rijen.forEach(function (r) {
                            var M = LAGEN.filter(function (x) { return x.v === r.mat; })[0]; if (!M) return;
                            if (M.R != null) { Rt += M.R; rijen.push([M.t.split(' (')[0], r.d ? h.fmt(r.d, 0) + ' mm' : '', '', h.fmt(M.R, 3)]); return; }
                            if (!(r.d > 0)) return;
                            var Rl = r.d / 1000 / M.l; Rt += Rl;
                            rijen.push([M.t.split(' (')[0], h.fmt(r.d, 0) + ' mm', h.fmt(M.l, 3), h.fmt(Rl, 3)]);
                        });
                        if (!rijen.length) return { wacht: true, ontbreekt: ['minstens één laag'] };
                        rijen.push(['Overgang binnen en buiten', '', '', h.fmt(R0, 2)]);
                        var U = 1 / Rt, tekort = 1 / v.doel - Rt;
                        var uit = [h.uit('U-waarde', U, 'W/(m²·K)', { dec: 3, hoofd: true, kleur: U <= v.doel + 1e-9 ? 'groen' : 'amber' }), h.uit('Warmteweerstand R', Rt, 'm²·K/W', { dec: 2, hoofd: true })];
                        if (tekort > 0) uit.push(h.uit('Extra isolatie voor U ' + h.fmt(v.doel, 2), Math.ceil(tekort * 0.023 * 1000 / 10) * 10, 'mm', { dec: 0, opm: 'PIR (λ 0,023), of ' + h.fmt(Math.ceil(tekort * 0.035 * 1000 / 10) * 10, 0) + ' mm minerale wol (λ 0,035)' }));
                        else uit.push(h.uit('Ten opzichte van U ' + h.fmt(v.doel, 2), 'voldoet', '', { kleur: 'groen' }));
                        uit.push(h.uit('Warmteverlies bij 28 K verschil', U * 28, 'W/m²', { dec: 1 }));
                        return { uit: uit, stappen: ['R = ' + rijen.map(function (r) { return r[3]; }).join(' + ') + ' = ' + h.f(Rt, 3, 'm²·K/W'), 'U = 1 / ' + h.fmt(Rt, 3) + ' = ' + h.f(U, 3, 'W/(m²·K)')], tabel: { kop: ['Laag', 'Dikte', 'λ', 'R'], rijen: rijen }, opm: 'Richtwaarde: houten of metalen regels, spouwankers en slordig geplaatste isolatie verhogen de echte U-waarde. De EPB-verslaggever rekent met de gecertificeerde λ van het product.' };
                    }
                }
            ] },
            { naam: 'Afgifte', items: [
                {
                    id: 'verw.radiator_dt', naam: 'Radiator: vermogen omrekenen naar een ander regime', kort: 'Van ΔT 50 (75/65/20) naar 55/45, 45/35 …',
                    zoek: 'radiator omrekenen delta t 50 regime lage temperatuur warmtepomp exponent 1,3 en 442 catalogus', soort: 'exact',
                    bron: 'EN 442: Φ = Φ₅₀ × (ΔT_ln / 49,83)^n met ΔT_ln = (T_v − T_r) / ln((T_v − T_i)/(T_r − T_i)), n = 1,3 (paneelradiator), 1,25 (convector), 1,33 (gietijzer)',
                    velden: [
                        { k: 'P50', label: 'Catalogusvermogen bij ΔT 50 K', eh: 'W', opt: true, hint: 'leeg als je van een nodig vermogen vertrekt' },
                        { k: 'Pn', label: 'of: nodig vermogen in de ruimte', eh: 'W', opt: true },
                        { k: 'tv', label: 'Aanvoer', eh: '°C', std: 55, snel: [{ t: '75', v: 75 }, { t: '70', v: 70 }, { t: '55', v: 55 }, { t: '45', v: 45 }, { t: '35', v: 35 }] },
                        { k: 'tr', label: 'Retour', eh: '°C', std: 45, snel: [{ t: '65', v: 65 }, { t: '55', v: 55 }, { t: '45', v: 45 }, { t: '35', v: 35 }, { t: '28', v: 28 }] },
                        { k: 'ti', label: 'Ruimtetemperatuur', eh: '°C', std: 20 },
                        { k: 'n', label: 'Exponent n', std: 1.3, min: 1, max: 1.6, snel: [{ t: 'Paneel 1,3', v: 1.3 }, { t: 'Convector 1,25', v: 1.25 }, { t: 'Gietijzer 1,33', v: 1.33 }] }
                    ],
                    bereken: function (v, h) {
                        var dt = dtLn(v.tv, v.tr, v.ti);
                        if (dt == null) return { fout: 'Aanvoer > retour > ruimtetemperatuur' };
                        var f = Math.pow(dt / DT_REF, v.n);
                        if (v.P50 == null && v.Pn == null) return { wacht: true, ontbreekt: ['catalogusvermogen of nodig vermogen'] };
                        var uit = [h.uit('ΔT_ln bij ' + h.fmt(v.tv) + '/' + h.fmt(v.tr) + '/' + h.fmt(v.ti), dt, 'K', { dec: 1 }), h.uit('Factor t.o.v. ΔT 50', f, '', { dec: 3 })];
                        var st = ['ΔT_ln = (' + v.tv + ' − ' + v.tr + ') / ln((' + v.tv + ' − ' + v.ti + ')/(' + v.tr + ' − ' + v.ti + ')) = ' + h.f(dt, 1, 'K'), 'f = (' + h.fmt(dt, 1) + ' / 49,83)^' + h.f(v.n) + ' = ' + h.fmt(f, 3)];
                        if (v.P50 != null) { uit.unshift(h.uit('Werkelijk vermogen bij dit regime', v.P50 * f, 'W', { dec: 0, hoofd: true })); st.push('Φ = ' + h.f(v.P50) + ' × ' + h.fmt(f, 3) + ' = ' + h.f(v.P50 * f, 0, 'W')); }
                        if (v.Pn != null) { uit.unshift(h.uit('Kies in de catalogus (ΔT 50) minstens', v.Pn / f, 'W', { dec: 0, hoofd: true })); st.push('Φ₅₀ = ' + h.f(v.Pn) + ' / ' + h.fmt(f, 3) + ' = ' + h.f(v.Pn / f, 0, 'W')); }
                        var rijen = REGIMES.map(function (r) { var d = dtLn(r.tv, r.tr, v.ti), ff = d ? Math.pow(d / DT_REF, v.n) : null; return [r.v, d ? h.fmt(d, 1) + ' K' : '–', ff ? h.fmt(ff, 2) : '–', v.P50 != null && ff ? h.fmt(v.P50 * ff, 0) + ' W' : (v.Pn != null && ff ? h.fmt(v.Pn / ff, 0) + ' W cat.' : '')]; });
                        return { uit: uit, stappen: st, tabel: { kop: ['Regime', 'ΔT_ln', 'Factor', v.P50 != null ? 'Vermogen' : 'Catalogus'], rijen: rijen } };
                    }
                },
                {
                    id: 'verw.radiator_kiezen', naam: 'Radiatoren kiezen (type 11/21/22/33)', kort: 'Welke lengte per type voor het nodige vermogen en regime?',
                    zoek: 'radiator kiezen type 11 21 22 33 lengte hoogte paneelradiator vermogen per meter', soort: 'indicatief',
                    bron: 'Richtwaarden W/m bij ΔT 50 K per hoogte (gemiddelde paneelradiator, EN 442) × regimefactor (n = 1,3); controleer de exacte waarde in de catalogus (Radson, Stelrad, Brugman)',
                    velden: [
                        { k: 'Pn', label: 'Nodig vermogen', eh: 'W', ehs: ['W', 'kW'] },
                        { k: 'hoogte', label: 'Radiatorhoogte', type: 'keuze', opties: [300, 400, 500, 600, 900].map(function (x) { return { v: x, t: x + ' mm' }; }), std: 600 },
                        { k: 'regime', label: 'Regime', type: 'keuze', opties: REGIMES, std: '55/45' },
                        { k: 'ti', label: 'Ruimtetemperatuur', eh: '°C', std: 20 },
                        { k: 'res', label: 'Reserve', eh: '%', std: 10 }
                    ],
                    bereken: function (v, h) {
                        var rg = regime(v.regime), dt = dtLn(rg.tv, rg.tr, v.ti);
                        if (dt == null) return { fout: 'Regime past niet bij de ruimtetemperatuur' };
                        var f = Math.pow(dt / DT_REF, 1.3), P = v.Pn * (1 + v.res / 100), wm = RAD_WM[Number(v.hoogte)];
                        var rijen = [], beste = null;
                        [11, 21, 22, 33].forEach(function (t) {
                            var Lm = P / (wm[t] * f), L = h.omhoogNaar(Lm * 100, RAD_L);
                            var Pwerk = L ? L / 100 * wm[t] * f : null;
                            rijen.push(['Type ' + t, h.fmt(wm[t] * f, 0) + ' W/m', L ? L + ' cm' : '> 300 cm', Pwerk ? h.fmt(Pwerk, 0) + ' W' : '–', L ? h.fmt(L / 100 * RAD_INHOUD[t] * Number(v.hoogte) / 600, 1) + ' l' : '–']);
                            if (L && (!beste || (t === 22 && beste.t !== 22 && L <= 200))) beste = { t: t, L: L, P: Pwerk };
                        });
                        // v410: type en lengte als twee aparte hoofdwaarden (groot in beeld), de gekozen rij licht op in de tabel
                        var uit = beste
                            ? [h.uit('Voorstel', 'Type ' + beste.t, '', { hoofd: true, opm: 'hoogte ' + v.hoogte + ' mm' }), h.uit('Lengte', beste.L, 'cm', { dec: 0, hoofd: true, opm: h.fmt(beste.P, 0) + ' W bij dit regime' })]
                            : [h.uit('Voorstel', 'Te groot voor één radiator', '', { hoofd: true, opm: 'verdeel het vermogen over twee radiatoren' })];
                        uit.push(h.uit('Te dekken vermogen (incl. reserve)', P, 'W', { dec: 0 }), h.uit('Regimefactor', f, '', { dec: 2, opm: 'ΔT_ln ' + h.fmt(dt, 1) + ' K' }));
                        return {
                            uit: uit,
                            stappen: ['Lengte = P / (W/m bij ΔT 50 × factor ' + h.fmt(f, 2) + '), afgerond naar de eerstvolgende standaardlengte'],
                            tabel: { kop: ['Type', 'Vermogen/m', 'Lengte', 'Vermogen', 'Inhoud'], rijen: rijen, kies: beste ? [11, 21, 22, 33].indexOf(beste.t) : -1 },
                            opm: 'Type 11 = 1 paneel 1 convector · 21 = 2 panelen 1 convector · 22 = 2/2 · 33 = 3/3. Meer dan 200 cm: verdeel over twee radiatoren.'
                        };
                    }
                },
                {
                    id: 'verw.vloerverwarming', naam: 'Vloerverwarming', kort: 'Aanvoertemperatuur, buislengte, kringen en debiet',
                    zoek: 'vloerverwarming legafstand aanvoertemperatuur kringen buislengte oppervlaktetemperatuur en 1264 tegel parket debiet verdeler', soort: 'indicatief',
                    bron: 'Vereenvoudigde EN 1264: q = 8,92 × (θ_vloer − θ_i)^1,1 (max. vloertemperatuur 29 °C, badkamer 33 °C, randzone 35 °C); θ_water = θ_vloer + q × (R_bedekking + R_dekvloer + R_legafstand)',
                    velden: [
                        { k: 'A', label: 'Oppervlakte met buis', eh: 'm²' },
                        { k: 'q', label: 'Nodig vermogen per m²', eh: 'W/m²', std: 60, snel: [{ t: 'BEN 30', v: 30 }, { t: 'Goed 50', v: 50 }, { t: 'Matig 70', v: 70 }, { t: 'Badkamer 90', v: 90 }] },
                        { k: 'ti', label: 'Ruimtetemperatuur', eh: '°C', std: 20, snel: [{ t: '20', v: 20 }, { t: 'Badkamer 24', v: 24 }] },
                        { k: 'zone', label: 'Zone', type: 'keuze', opties: [{ v: 29, t: 'Verblijfszone (max. 29 °C vloer)' }, { v: 33, t: 'Badkamer (33 °C)' }, { v: 35, t: 'Randzone (35 °C)' }], std: 29 },
                        { k: 'bedek', label: 'Vloerbedekking', type: 'keuze', opties: [{ v: 0.01, t: 'Tegel / natuursteen (R 0,01)' }, { v: 0.03, t: 'Vinyl / gietvloer (0,03)' }, { v: 0.05, t: 'Laminaat (0,05)' }, { v: 0.1, t: 'Parket (0,10)' }, { v: 0.15, t: 'Tapijt (0,15)' }], std: 0.01 },
                        { k: 'dek', label: 'Dekvloer', type: 'keuze', opties: [{ v: 0.04, t: 'Chape 45 mm boven de buis (R 0,04)' }, { v: 0.035, t: 'Anhydriet 35 mm (0,035)' }, { v: 0.03, t: 'Frees / droogbouw (0,03)' }], std: 0.04 },
                        { k: 'leg', label: 'Legafstand', type: 'keuze', opties: [{ v: 100, t: '100 mm' }, { v: 150, t: '150 mm' }, { v: 200, t: '200 mm' }, { v: 300, t: '300 mm' }], std: 150 },
                        { k: 'dTw', label: 'ΔT water (aanvoer − retour)', eh: 'K', std: 7, snel: [{ t: '5', v: 5 }, { t: '7', v: 7 }, { t: '10', v: 10 }] },
                        { k: 'Lmax', label: 'Max. kringlengte', eh: 'm', std: 100, snel: [{ t: '16 mm: 100', v: 100 }, { t: '20 mm: 120', v: 120 }] },
                        { k: 'aansl', label: 'Aansluitleiding per kring (heen + terug)', eh: 'm', std: 10 }
                    ],
                    bereken: function (v, h) {
                        var Ts = v.ti + Math.pow(v.q / 8.92, 1 / 1.1), Tmax = Number(v.zone);
                        var Rleg = { 100: 0.01, 150: 0.02, 200: 0.035, 300: 0.06 }[Number(v.leg)];
                        var Rtot = Number(v.bedek) + Number(v.dek) + Rleg;
                        var Tm = Ts + v.q * Rtot, Tv = Tm + v.dTw / 2, Tr = Tm - v.dTw / 2;
                        var P = v.q * v.A, Lbuis = v.A / (Number(v.leg) / 1000);
                        var kringen = Math.max(1, Math.ceil(Lbuis / (v.Lmax - v.aansl))), Ltot = Lbuis + kringen * v.aansl;
                        var Q = P / (W.wh_l_K * v.dTw);
                        var waarsch = [];
                        if (Ts > Tmax) waarsch.push('Vloertemperatuur ' + h.fmt(Ts, 1) + ' °C ligt boven het maximum van ' + Tmax + ' °C: ' + h.fmt(v.q) + ' W/m² is te veel voor vloerverwarming alleen; max. ≈ ' + h.fmt(8.92 * Math.pow(Tmax - v.ti, 1.1), 0) + ' W/m².');
                        if (Tv > 45) waarsch.push('Aanvoer ' + h.fmt(Tv, 0) + ' °C is hoog: kleinere legafstand of dunnere bedekking, zeker met een warmtepomp (streef ≤ 35–40 °C).');
                        return {
                            uit: [h.uit('Aanvoer / retour', h.fmt(Tv, 0) + ' / ' + h.fmt(Tr, 0), '°C', { hoofd: true }), h.uit('Vloertemperatuur', Ts, '°C', { dec: 1, kleur: Ts > Tmax ? 'rood' : 'groen' }), h.uit('Totaal vermogen', P, 'W', { dec: 0 }), h.uit('Buislengte totaal', Ltot, 'm', { dec: 0, hoofd: true, opm: h.fmt(Lbuis, 0) + ' m in de vloer + aansluitingen' }), h.uit('Aantal kringen', kringen, '', { hoofd: true, opm: '± ' + h.fmt(Ltot / kringen, 0) + ' m per kring' }), h.uit('Debiet totaal', Q, 'l/h', { dec: 0 }), h.uit('Debiet per kring', Q / kringen, 'l/h', { dec: 0 }), h.uit('Waterinhoud buis (16×2)', Ltot * 0.113, 'l', { dec: 1 })],
                            stappen: ['θ_vloer = ' + h.f(v.ti) + ' + (' + h.f(v.q) + ' / 8,92)^(1/1,1) = ' + h.f(Ts, 1, '°C'), 'R = ' + h.fmt(Number(v.bedek), 2) + ' + ' + h.fmt(Number(v.dek), 3) + ' + ' + h.fmt(Rleg, 3) + ' = ' + h.fmt(Rtot, 3) + ' m²·K/W', 'θ_water gem. = ' + h.fmt(Ts, 1) + ' + ' + h.f(v.q) + ' × ' + h.fmt(Rtot, 3) + ' = ' + h.f(Tm, 1, '°C'), 'Buis = ' + h.f(v.A) + ' / ' + h.fmt(Number(v.leg) / 1000, 2) + ' = ' + h.f(Lbuis, 0, 'm') + '; kringen = ⌈' + h.fmt(Lbuis, 0) + ' / (' + h.f(v.Lmax) + ' − ' + h.f(v.aansl) + ')⌉ = ' + kringen, 'Q = P / (1,163 × ΔT) = ' + h.f(Q, 0, 'l/h')],
                            waarsch: waarsch
                        };
                    }
                },
                {
                    id: 'verw.stooklijn', naam: 'Stooklijn (weersafhankelijke regeling)', kort: 'Aanvoertemperatuur bij een gegeven buitentemperatuur',
                    zoek: 'stooklijn weersafhankelijk buitenvoeler aanvoertemperatuur helling curve regeling', soort: 'indicatief',
                    bron: 'Belastingsgraad φ = (θ_i − θ_e) / (θ_i − θ_e,ontwerp); θ_gem = θ_i + (θ_gem,ontwerp − θ_i) × φ^(1/n); spreiding × φ; n = 1,3 radiatoren, 1,1 vloerverwarming',
                    velden: [
                        { k: 'ti', label: 'Gewenste binnentemperatuur', eh: '°C', std: 20 },
                        { k: 'ted', label: 'Ontwerpbuitentemperatuur', eh: '°C', std: -8 },
                        { k: 'tvd', label: 'Aanvoer bij ontwerp', eh: '°C', std: 55, snel: [{ t: 'Radiator 70', v: 70 }, { t: 'LT-radiator 55', v: 55 }, { t: 'Vloer 38', v: 38 }] },
                        { k: 'trd', label: 'Retour bij ontwerp', eh: '°C', std: 45 },
                        { k: 'n', label: 'Exponent afgifte', std: 1.3, snel: [{ t: 'Radiator 1,3', v: 1.3 }, { t: 'Vloer 1,1', v: 1.1 }] },
                        { k: 'te', label: 'Buitentemperatuur nu', eh: '°C', std: 5 }
                    ],
                    bereken: function (v, h) {
                        function punt(te) {
                            var phi = Math.max(0, Math.min(1, (v.ti - te) / (v.ti - v.ted)));
                            var tmd = (v.tvd + v.trd) / 2, tm = v.ti + (tmd - v.ti) * Math.pow(phi, 1 / v.n), spr = (v.tvd - v.trd) * phi;
                            return { tv: tm + spr / 2, tr: tm - spr / 2, phi: phi };
                        }
                        var p = punt(v.te);
                        var rijen = [-10, -5, 0, 5, 10, 15].map(function (te) { var q = punt(te); return [te + ' °C', h.fmt(q.tv, 0) + ' °C', h.fmt(q.tr, 0) + ' °C', h.fmt(q.phi * 100, 0) + ' %']; });
                        return {
                            uit: [h.uit('Aanvoer bij ' + h.fmt(v.te) + ' °C buiten', p.tv, '°C', { dec: 0, hoofd: true }), h.uit('Retour', p.tr, '°C', { dec: 0 }), h.uit('Belasting', p.phi * 100, '%', { dec: 0 }), h.uit('Helling (vuistregel regelaar)', (v.tvd - v.ti) / (v.ti - v.ted), '', { dec: 2, opm: '(aanvoer − binnen) / (binnen − ontwerp buiten)' })],
                            stappen: ['φ = (' + v.ti + ' − ' + h.f(v.te) + ') / (' + v.ti + ' − ' + v.ted + ') = ' + h.fmt(p.phi, 2), 'θ_gem = ' + v.ti + ' + (' + h.fmt((v.tvd + v.trd) / 2, 1) + ' − ' + v.ti + ') × ' + h.fmt(p.phi, 2) + '^(1/' + h.f(v.n) + ') = ' + h.f((p.tv + p.tr) / 2, 1, '°C')],
                            tabel: { kop: ['Buiten', 'Aanvoer', 'Retour', 'Belasting'], rijen: rijen }
                        };
                    }
                },
                {
                    id: 'verw.radiator_bestaand', naam: 'Bestaande radiator: welk vermogen?', kort: 'Vermogen uit type, hoogte en lengte, en de aanvoertemperatuur die nodig is',
                    zoek: 'bestaande radiator vermogen afmetingen type hoogte lengte lage temperatuur warmtepomp volstaat aanvoertemperatuur nodig renovatie', soort: 'indicatief',
                    bron: 'Richtwaarden W/m bij ΔT 50 K per type en hoogte (EN 442, gemiddelde paneelradiator) × lengte × regimefactor (n = 1,3) · nodige aanvoer: opgelost voor een spreiding van 10 K',
                    uitleg: 'Meet de radiator op en kijk van bovenaf hoeveel platen en lamellen hij heeft. Vul het warmteverlies van de ruimte in om te zien welke aanvoertemperatuur volstaat, bijvoorbeeld voor een warmtepomp.',
                    velden: [
                        { k: 'type', label: 'Type', type: 'keuze', opties: [{ v: 11, t: 'Type 11 (1 plaat, 1 lamel)' }, { v: 21, t: 'Type 21 (2 platen, 1 lamel)' }, { v: 22, t: 'Type 22 (2 platen, 2 lamellen)' }, { v: 33, t: 'Type 33 (3 platen, 3 lamellen)' }], std: 22 },
                        { k: 'hoogte', label: 'Hoogte', type: 'keuze', opties: [300, 400, 500, 600, 900].map(function (x) { return { v: x, t: x + ' mm' }; }), std: 600 },
                        { k: 'L', label: 'Lengte', eh: 'cm', ehs: ['cm', 'mm', 'm'], std: 120, min: 1 },
                        { k: 'regime', label: 'Regime', type: 'keuze', opties: REGIMES, std: '55/45' },
                        { k: 'ti', label: 'Ruimtetemperatuur', eh: '°C', std: 20 },
                        { k: 'Pn', label: 'Warmteverlies van de ruimte', eh: 'W', ehs: ['W', 'kW'], opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var wm = RAD_WM[Number(v.hoogte)][Number(v.type)], P50 = wm * v.L / 100, rg = regime(v.regime), dt = dtLn(rg.tv, rg.tr, v.ti);
                        if (dt == null) return { fout: 'Het regime past niet bij de ruimtetemperatuur' };
                        var f = Math.pow(dt / DT_REF, 1.3), P = P50 * f;
                        var uit = [h.uit('Vermogen bij ' + rg.v, P, 'W', { dec: 0, hoofd: true }), h.uit('Vermogen bij ΔT 50 (75/65/20)', P50, 'W', { dec: 0 }), h.uit('Regimefactor', f, '', { dec: 2 })];
                        var st = ['Φ₅₀ = ' + h.fmt(wm, 0) + ' W/m × ' + h.f(v.L / 100, 2) + ' m = ' + h.f(P50, 0, 'W'), 'Φ = ' + h.fmt(P50, 0) + ' × ' + h.fmt(f, 2) + ' = ' + h.f(P, 0, 'W')];
                        var waarsch = [];
                        function bij(tv) { var d = dtLn(tv, tv - 10, v.ti); return d == null ? 0 : P50 * Math.pow(d / DT_REF, 1.3); }
                        if (v.Pn > 0) {
                            var lo = v.ti + 10.1, hi = 90;
                            if (bij(hi) < v.Pn) { uit.push(h.uit('Aanvoer nodig voor ' + h.fmt(v.Pn, 0) + ' W', 'meer dan 90 °C', '', { hoofd: true, kleur: 'rood' })); waarsch.push('Deze radiator is te klein voor de ruimte: zelfs op 90 °C levert hij maar ' + h.fmt(bij(hi), 0) + ' W. Plaats een grotere of een bijkomende radiator.'); }
                            else {
                                for (var i = 0; i < 50; i++) { var m = (lo + hi) / 2; if (bij(m) < v.Pn) lo = m; else hi = m; }
                                uit.push(h.uit('Aanvoer nodig voor ' + h.fmt(v.Pn, 0) + ' W', hi, '°C', { dec: 0, hoofd: true, kleur: hi <= 45 ? 'groen' : hi <= 55 ? 'amber' : 'rood', opm: 'retour ' + h.fmt(hi - 10, 0) + ' °C' }));
                                st.push('Aanvoer waarbij Φ = ' + h.f(v.Pn, 0) + ' W met een spreiding van 10 K: ' + h.f(hi, 0, '°C'));
                                if (hi > 55) waarsch.push('Voor een warmtepomp is dat hoog: boven 55 °C daalt het rendement sterk. Isoleer eerst, of vergroot de radiator.');
                            }
                            uit.push(h.uit('Dekking bij ' + rg.v, P / v.Pn * 100, '%', { dec: 0, kleur: P >= v.Pn ? 'groen' : 'rood' }));
                        }
                        var rijen = REGIMES.map(function (r) { var d = dtLn(r.tv, r.tr, v.ti); return [r.v, d ? h.fmt(d, 1) + ' K' : '', d ? h.fmt(P50 * Math.pow(d / DT_REF, 1.3), 0) + ' W' : 'niet mogelijk']; });
                        return { uit: uit, stappen: st, waarsch: waarsch, tabel: { kop: ['Regime', 'ΔT_ln', 'Vermogen'], rijen: rijen, kies: REGIMES.map(function (r) { return r.v; }).indexOf(rg.v) }, opm: 'Richtwaarde voor een gewone paneelradiator. Oude ledenradiatoren en designradiatoren wijken af: zoek het vermogen op in de catalogus en reken om met “Radiator: vermogen omrekenen”.' };
                    }
                },
                {
                    id: 'verw.opstoken', naam: 'Vloerverwarming opstoken', kort: 'Opstookschema per dag voor een nieuwe dekvloer',
                    zoek: 'vloerverwarming opstoken opstookprotocol opwarmen chape dekvloer anhydriet schema dagen aanvoertemperatuur en 1264-4 droogstoken', soort: 'indicatief',
                    bron: 'EN 1264-4 (functieverwarmen): ten vroegste 21 dagen na het plaatsen van een cementdekvloer en 7 dagen na een anhydrietdekvloer · start op 20 tot 25 °C en minstens 3 dagen aanhouden · daarna de hoogste ontwerptemperatuur minstens 4 dagen aanhouden · het stapsgewijze schema (5 K per dag omhoog en omlaag) is de voorzichtigere werkwijze die vloerders vragen',
                    uitleg: 'Het voorschrift van de leverancier van de dekvloer en van de vloerbedekking gaat voor. Houd het schema bij op papier: de vloerder vraagt het opstookverslag.',
                    velden: [
                        { k: 'vloer', label: 'Dekvloer', type: 'keuze', opties: [{ v: 21, t: 'Cementdekvloer (chape)' }, { v: 7, t: 'Anhydriet (gietvloer)' }], std: 21 },
                        { k: 'schema', label: 'Schema', type: 'keuze', opties: [{ v: 'stap', t: 'Stapsgewijs op en af' }, { v: 'norm', t: 'Minimum volgens EN 1264-4' }], std: 'stap' },
                        { k: 'Tmax', label: 'Hoogste aanvoertemperatuur volgens het ontwerp', eh: '°C', std: 45, min: 25, max: 55, snel: [{ t: '35', v: 35 }, { t: '40', v: 40 }, { t: '45', v: 45 }, { t: '50', v: 50 }] },
                        { k: 'stap', label: 'Stap per dag', eh: 'K', std: 5, min: 1, max: 15 },
                        { k: 'houd', label: 'Dagen op de hoogste temperatuur', std: 4, min: 1, max: 14 }
                    ],
                    bereken: function (v, h) {
                        var rijen = [], dag = 1, wacht = Number(v.vloer);
                        function rij(n, T, wat) { rijen.push([n === 1 ? 'dag ' + dag : 'dag ' + dag + ' tot ' + (dag + n - 1), h.fmt(T, 0) + ' °C', wat]); dag += n; }
                        rij(3, 25, 'starttemperatuur aanhouden');
                        if (v.schema === 'stap') for (var T = 25 + v.stap; T < v.Tmax - 1e-9; T += v.stap) rij(1, T, 'verhogen');
                        rij(Math.round(v.houd), v.Tmax, 'hoogste temperatuur aanhouden');
                        if (v.schema === 'stap') { for (var Td = v.Tmax - v.stap; Td > 25 + 1e-9; Td -= v.stap) rij(1, Td, 'verlagen'); rij(1, 25, 'verlagen, daarna uitschakelen'); }
                        var duur = dag - 1;
                        return {
                            uit: [h.uit('Duur van het opstoken', duur, 'dagen', { dec: 0, hoofd: true }), h.uit('Ten vroegste starten', wacht, 'dagen', { dec: 0, hoofd: true, opm: 'na het plaatsen van de dekvloer' }), h.uit('Klaar ten vroegste', wacht + duur, 'dagen', { dec: 0, opm: 'na het plaatsen van de dekvloer' })],
                            stappen: ['Start: 3 dagen op 25 °C', v.schema === 'stap' ? 'Daarna ' + h.f(v.stap, 0) + ' K per dag omhoog tot ' + h.f(v.Tmax, 0) + ' °C, ' + Math.round(v.houd) + ' dagen aanhouden en even traag weer omlaag' : 'Daarna ' + Math.round(v.houd) + ' dagen op ' + h.f(v.Tmax, 0) + ' °C'],
                            tabel: { kop: ['Wanneer', 'Aanvoer', 'Wat'], rijen: rijen },
                            opm: 'Ventileer goed tijdens het opstoken, zonder tocht over de vloer. Meet het restvocht voor de vloerbedekking erop komt (parket en gietvloer zijn het strengst). Opstoken is geen droogstoken: een dikke chape heeft weken nodig om te drogen.'
                        };
                    }
                },
                {
                    id: 'verw.inregelen', naam: 'Radiatoren inregelen', kort: 'Debiet en kv-waarde per radiator voor de voorinstelling van de kraan',
                    zoek: 'inregelen radiatoren waterzijdig hydraulisch balanceren voorinstelling radiatorkraan kv debiet per radiator thermostaatkraan retourkoppeling', soort: 'exact',
                    bron: 'Debiet = vermogen / (1,163 × ΔT) · kv = debiet [m³/h] / √(drukverschil [bar]) · de voorinstelling die bij de kv-waarde hoort staat in de fiche van de kraan',
                    uitleg: 'Vul per radiator het warmteverlies van de ruimte in, niet het catalogusvermogen. Met een drukverschil van 10 kPa over de kraan blijft de regeling stil. De verste radiator krijgt de grootste opening.',
                    velden: [
                        { k: 'rijen', label: 'Radiatoren', type: 'rijen', kolommen: [{ k: 'naam', label: 'Ruimte', type: 'tekst' }, { k: 'P', label: 'Vermogen in W', type: 'getal' }], std: [{ naam: 'Woonkamer', P: 1800 }, { naam: 'Keuken', P: 900 }, { naam: 'Slaapkamer', P: 600 }, { naam: 'Badkamer', P: 700 }] },
                        { k: 'dT', label: 'ΔT aanvoer − retour', eh: 'K', std: 10, min: 1, snel: [{ t: 'Klassiek 20', v: 20 }, { t: 'Condenserend 15', v: 15 }, { t: 'Lage temperatuur 10', v: 10 }, { t: 'Warmtepomp 5', v: 5 }] },
                        { k: 'dp', label: 'Drukverschil over de kraan', eh: 'kPa', std: 10, min: 0.5, snel: [{ t: '5', v: 5 }, { t: '10', v: 10 }, { t: '15', v: 15 }] }
                    ],
                    bereken: function (v, h) {
                        var rijen = [], Ptot = 0, Qtot = 0;
                        v.rijen.forEach(function (r, i) {
                            if (!(r.P > 0)) return;
                            var Q = r.P / (W.wh_l_K * v.dT), kv = Q / 1000 / Math.sqrt(v.dp / 100);
                            Ptot += r.P; Qtot += Q;
                            rijen.push([r.naam || 'Radiator ' + (i + 1), h.fmt(r.P, 0) + ' W', h.fmt(Q, 0) + ' l/h', h.fmt(kv, 3)]);
                        });
                        if (!rijen.length) return { wacht: true, ontbreekt: ['minstens één radiator met een vermogen'] };
                        return {
                            uit: [h.uit('Totaal debiet', Qtot, 'l/h', { dec: 0, hoofd: true, opm: h.fmt(Qtot / 1000, 2) + ' m³/h' }), h.uit('Totaal vermogen', Ptot, 'W', { dec: 0, hoofd: true }), h.uit('Aantal radiatoren', rijen.length, '')],
                            stappen: ['Debiet = vermogen / (1,163 × ' + h.f(v.dT, 0) + ')', 'kv = debiet / 1.000 / √(' + h.f(v.dp, 1) + ' kPa / 100)'],
                            tabel: { kop: ['Ruimte', 'Vermogen', 'Debiet', 'kv'], rijen: rijen },
                            opm: 'Kleine kv-waarden (onder 0,05) zijn moeilijk in te stellen: kies dan een kraan met fijne voorinstelling of een kleinere ΔT. Regel in bij open thermostaatkoppen en controleer de retourtemperatuur per radiator.'
                        };
                    }
                }
            ] },
            { naam: 'Hydraulica', items: [
                {
                    id: 'verw.debiet_pomp', naam: 'Debiet en pomp', kort: 'Debiet uit vermogen en ΔT, opvoerhoogte uit het drukverlies',
                    zoek: 'debiet pomp circulatiepomp opvoerhoogte mwk kpa l/h m3/h delta t werkingspunt', soort: 'indicatief',
                    bron: 'Q = P / (1,163 × ΔT) [l/h, kW, K] · H = L × Δp/m × toeslag + extra weerstanden · 1 mWK = 9,81 kPa',
                    velden: [
                        { k: 'P', label: 'Vermogen', eh: 'kW', ehs: ['kW', 'W'] },
                        { k: 'dT', label: 'ΔT aanvoer − retour', eh: 'K', std: 20, snel: [{ t: 'Radiator 75/55: 20', v: 20 }, { t: '70/55: 15', v: 15 }, { t: 'Vloer: 7', v: 7 }, { t: 'WP: 5', v: 5 }] },
                        { k: 'L', label: 'Leidinglengte langste kring (heen + terug)', eh: 'm', std: 40 },
                        { k: 'dpm', label: 'Drukverlies per meter buis', eh: 'Pa/m', std: 150, snel: [{ t: '100', v: 100 }, { t: '150', v: 150 }, { t: '200', v: 200 }, { t: '300', v: 300 }] },
                        { k: 'toe', label: 'Toeslag bochten en fittingen', eh: '%', std: 30 },
                        { k: 'extra', label: 'Extra weerstand (ketel, wisselaar, afsluiters, radiatorkraan)', eh: 'kPa', std: 10, snel: [{ t: 'Radiatorkraan 5', v: 5 }, { t: 'Ketel 10', v: 10 }, { t: 'Plaatwisselaar 20', v: 20 }, { t: 'WP + buffer 25', v: 25 }] }
                    ],
                    bereken: function (v, h) {
                        var Q = v.P * 1000 / (W.wh_l_K * v.dT), Hpa = v.L * v.dpm * (1 + v.toe / 100) + v.extra * 1000;
                        return {
                            uit: [h.uit('Debiet', Q, 'l/h', { dec: 0, hoofd: true, opm: h.fmt(Q / 1000, 2) + ' m³/h · ' + h.fmt(Q / 60, 1) + ' l/min' }), h.uit('Opvoerhoogte', Hpa / 9806.65, 'mWK', { dec: 1, hoofd: true, opm: h.fmt(Hpa / 1000, 1) + ' kPa' }), h.uit('Werkingspunt pomp', h.fmt(Q / 1000, 2) + ' m³/h bij ' + h.fmt(Hpa / 9806.65, 1) + ' m', '')],
                            stappen: ['Q = ' + h.f(v.P) + ' kW × 1000 / (1,163 × ' + h.f(v.dT) + ') = ' + h.f(Q, 0, 'l/h'), 'H = ' + h.f(v.L) + ' × ' + h.f(v.dpm) + ' × ' + h.fmt(1 + v.toe / 100, 2) + ' + ' + h.f(v.extra * 1000) + ' = ' + h.f(Hpa, 0, 'Pa')],
                            opm: 'Woningpomp 25-60 / 25-80: tot ±4 à 6 m opvoerhoogte. Kies het werkingspunt in het midden van de pompcurve.'
                        };
                    }
                },
                {
                    id: 'verw.leiding', naam: 'Leidingdiameter (water)', kort: 'Kleinste buis bij een maximale snelheid, met snelheid en drukverlies per maat',
                    zoek: 'leidingdiameter buisdiameter koper staal meerlagen snelheid drukverlies water dimensioneren', soort: 'exact',
                    bron: 'v = Q / A; drukverlies Darcy-Weisbach met Colebrook (Swamee-Jain); ruwheid koper 0,0015 mm, staal 0,045 mm, kunststof 0,007 mm',
                    uitleg: 'Richtsnelheden: aftakkingen naar radiatoren 0,3–0,5 m/s, hoofdleidingen 0,8–1,0 m/s, kelderleidingen tot 1,5 m/s, sanitair tot 2 m/s. Drukverlies streefwaarde 100–200 Pa/m.',
                    velden: [
                        { k: 'Q', label: 'Debiet', eh: 'l/h', ehs: ['l/h', 'm³/h', 'l/min', 'l/s'] },
                        { k: 'mat', label: 'Materiaal', type: 'keuze', opties: Object.keys(BUIZEN).filter(function (k) { return k !== 'pvc'; }).map(function (k) { return { v: k, t: BUIZEN[k].naam }; }), std: 'koper' },
                        { k: 'vmax', label: 'Maximale snelheid', eh: 'm/s', std: 0.8, snel: [{ t: 'Aftakking 0,5', v: 0.5 }, { t: 'Hoofdleiding 1,0', v: 1 }, { t: 'Kelder 1,5', v: 1.5 }, { t: 'Sanitair 2,0', v: 2 }] },
                        { k: 'medium', label: 'Medium', type: 'keuze', opties: MEDIA, std: 'w60' }
                    ],
                    bereken: function (v, h) {
                        var mat = BUIZEN[v.mat], nu = NU[v.medium], rho = v.medium === 'w10' || v.medium === 'w20' ? 998 : 983;
                        var keus = null, rijen = [];
                        mat.maten.forEach(function (m) {
                            var d = R.darcy(v.Q / 1000, m.d, mat.ruwheid, nu, rho);
                            var ok = d.v <= v.vmax;
                            if (ok && !keus) keus = { m: m, d: d };
                            rijen.push([m.n + ' (' + h.fmt(m.d, 1) + ' mm)', h.fmt(d.v, 2) + ' m/s', h.fmt(d.dp, 0) + ' Pa/m', ok ? (keus && keus.m === m ? '✓ kleinste' : '✓') : 'te snel']);
                        });
                        if (!keus) return { fout: 'Debiet te groot voor de grootste maat in de lijst', tabel: { kop: ['Maat', 'Snelheid', 'Drukverlies', ''], rijen: rijen } };
                        return {
                            uit: [h.uit('Kleinste maat', keus.m.n + ' ' + mat.naam.split(' (')[0], '', { hoofd: true }), h.uit('Snelheid', keus.d.v, 'm/s', { dec: 2 }), h.uit('Drukverlies', keus.d.dp, 'Pa/m', { dec: 0, kleur: keus.d.dp > 300 ? 'amber' : '' }), h.uit('Reynolds', keus.d.Re, '', { dec: 0, opm: keus.d.Re < 2300 ? 'laminair' : 'turbulent' })],
                            stappen: ['v = Q / (π × d² / 4) = ' + h.fmt(v.Q / 3600 / 1000, 5) + ' m³/s / ' + h.fmt(Math.PI * Math.pow(keus.m.d / 1000, 2) / 4, 6) + ' m² = ' + h.f(keus.d.v, 2, 'm/s'), 'Δp/m = f × ρ × v² / (2 × d), f = ' + h.fmt(keus.d.f, 4)],
                            tabel: { kop: ['Maat', 'Snelheid', 'Drukverlies', ''], rijen: rijen }
                        };
                    }
                },
                {
                    id: 'verw.drukverlies', naam: 'Drukverlies van een leiding', kort: 'Wrijving + bochten, T-stukken en afsluiters',
                    zoek: 'drukverlies leiding weerstand bochten fittingen zeta darcy pa kpa mwk', soort: 'exact',
                    bron: 'Δp = (λ × L / d + Σζ) × ρ × v² / 2; ζ bocht 90° 0,7 · T-stuk 1,3 · kogelkraan 0,1 · klepafsluiter 4 · terugslagklep 2,5',
                    velden: [
                        { k: 'Q', label: 'Debiet', eh: 'l/h', ehs: ['l/h', 'm³/h', 'l/min', 'l/s'] },
                        { k: 'buis', label: 'Buis', type: 'keuze', opties: buisOpties(), std: 'koper|22×1' },
                        { k: 'L', label: 'Lengte (heen + terug)', eh: 'm' },
                        { k: 'medium', label: 'Medium', type: 'keuze', opties: MEDIA, std: 'w60' },
                        { k: 'b90', label: 'Bochten 90°', std: 0, min: 0 },
                        { k: 'tst', label: 'T-stukken', std: 0, min: 0 },
                        { k: 'kk', label: 'Kogelkranen', std: 0, min: 0 },
                        { k: 'kl', label: 'Klepafsluiters / terugslagkleppen', std: 0, min: 0 },
                        { k: 'zeta', label: 'Extra ζ (toestellen)', std: 0, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var b = buis(v.buis); if (!b) return { fout: 'Onbekende buis' };
                        var nu = NU[v.medium], rho = v.medium === 'w10' || v.medium === 'w20' ? 998 : 983;
                        var d = R.darcy(v.Q / 1000, b.m.d, b.mat.ruwheid, nu, rho);
                        var zeta = v.b90 * 0.7 + v.tst * 1.3 + v.kk * 0.1 + v.kl * 3 + v.zeta;
                        var dyn = rho * d.v * d.v / 2, dpL = d.dp * v.L, dpZ = zeta * dyn, dp = dpL + dpZ;
                        return {
                            uit: [h.uit('Drukverlies totaal', dp / 1000, 'kPa', { dec: 2, hoofd: true, opm: h.fmt(dp / 9806.65, 2) + ' mWK · ' + h.fmt(dp / 100, 1) + ' mbar' }), h.uit('Wrijving leiding', dpL / 1000, 'kPa', { dec: 2, opm: h.fmt(d.dp, 0) + ' Pa/m' }), h.uit('Weerstanden (Σζ = ' + h.fmt(zeta, 1) + ')', dpZ / 1000, 'kPa', { dec: 2 }), h.uit('Snelheid', d.v, 'm/s', { dec: 2, kleur: d.v > 2 ? 'rood' : d.v > 1.5 ? 'amber' : '' })],
                            stappen: ['v = ' + h.f(d.v, 3, 'm/s') + ', Re = ' + h.f(d.Re, 0) + ', λ = ' + h.fmt(d.f, 4), 'Δp = (λ × L/d + Σζ) × ρ × v²/2 = (' + h.fmt(d.f, 4) + ' × ' + h.f(v.L) + '/' + h.fmt(b.m.d / 1000, 4) + ' + ' + h.fmt(zeta, 1) + ') × ' + h.fmt(dyn, 1) + ' = ' + h.f(dp, 0, 'Pa')]
                        };
                    }
                },
                {
                    id: 'verw.kv', naam: 'Kv-waarde en inregelen', kort: 'Debiet, Kv en drukverlies over een afsluiter of kraan',
                    zoek: 'kv kvs waarde afsluiter kraan inregelen voorinstelling debiet drukverlies balanceren autoriteit', soort: 'exact',
                    bron: 'Q = Kv × √(Δp / 1 bar) [m³/h] · Δp = (Q / Kv)² bar · autoriteit = Δp_kraan / Δp_kring ≥ 0,3–0,5',
                    uitleg: 'Vul twee van de drie in. Kv staat in de fiche van de kraan (voorinstelling radiatorkraan: Kv 0,05–0,9).',
                    velden: [
                        { k: 'Kv', label: 'Kv', eh: 'm³/h', opt: true },
                        { k: 'Q', label: 'Debiet', eh: 'l/h', ehs: ['l/h', 'm³/h', 'l/min'], opt: true },
                        { k: 'dp', label: 'Drukverlies', eh: 'kPa', ehs: ['kPa', 'mbar', 'bar', 'mWK'], opt: true }
                    ],
                    bereken: function (v, h) {
                        var Q = v.Q != null ? v.Q / 1000 : null, dp = v.dp != null ? v.dp / 100 : null, Kv = v.Kv;
                        var n = [Q, dp, Kv].filter(function (x) { return x != null; }).length;
                        if (n < 2) return { wacht: true, ontbreekt: ['twee van de drie'] };
                        var st = [];
                        if (Kv == null) { Kv = Q / Math.sqrt(dp); st.push('Kv = Q / √Δp = ' + h.fmt(Q, 3) + ' / √' + h.fmt(dp, 3) + ' = ' + h.fmt(Kv, 3)); }
                        else if (Q == null) { Q = Kv * Math.sqrt(dp); st.push('Q = Kv × √Δp = ' + h.fmt(Kv, 3) + ' × √' + h.fmt(dp, 3) + ' = ' + h.fmt(Q, 3) + ' m³/h'); }
                        else { dp = Math.pow(Q / Kv, 2); st.push('Δp = (Q / Kv)² = (' + h.fmt(Q, 3) + ' / ' + h.fmt(Kv, 3) + ')² = ' + h.fmt(dp, 4) + ' bar'); }
                        return { uit: [h.uit('Kv', Kv, 'm³/h', { dec: 3, hoofd: v.Kv == null }), h.uit('Debiet', Q * 1000, 'l/h', { dec: 0, hoofd: v.Q == null }), h.uit('Drukverlies', dp * 100, 'kPa', { dec: 2, hoofd: v.dp == null, opm: h.fmt(dp * 1000, 0) + ' mbar' })], stappen: st };
                    }
                },
                {
                    id: 'verw.expansievat', naam: 'Expansievat verwarming', kort: 'Inhoud, voordruk en vuldruk uit systeeminhoud, temperatuur en hoogte',
                    zoek: 'expansievat expansie vat voordruk vuldruk inhoud liter veiligheidsventiel statische hoogte en 12828', soort: 'indicatief',
                    bron: 'EN 12828 / DIN 4807: V_n = (V_e + V_v) × (p_e + 1) / (p_e − p_0); V_e = V_syst × e(θ_max); V_v = max(0,5 % × V_syst, 3 l); p_0 = h/10 + 0,3 bar; p_e = p_veiligheidsventiel − 0,5 bar (of 0,9 × p_sv boven 5 bar)',
                    velden: [
                        { k: 'Vs', label: 'Waterinhoud installatie', eh: 'l', opt: true, hint: 'leeg = schatting uit vermogen en afgiftetype (zie ook “Waterinhoud installatie”)' },
                        { k: 'P', label: 'Ketelvermogen (voor de schatting)', eh: 'kW', opt: true },
                        { k: 'afg', label: 'Afgifte (voor de schatting)', type: 'keuze', opties: [{ v: 8, t: 'Paneelradiatoren (8 l/kW)' }, { v: 15, t: 'Gietijzeren radiatoren (15 l/kW)' }, { v: 20, t: 'Vloerverwarming (20 l/kW)' }, { v: 5, t: 'Convectoren (5 l/kW)' }], std: 8 },
                        { k: 'buffer', label: 'Buffer- of boilervat in het cv-circuit', eh: 'l', std: 0 },
                        { k: 'tmax', label: 'Maximale aanvoertemperatuur', type: 'keuze', opties: [40, 50, 60, 70, 80, 90].map(function (t) { return { v: t, t: t + ' °C' }; }), std: 70 },
                        { k: 'h', label: 'Statische hoogte (vat → hoogste punt)', eh: 'm', std: 6 },
                        { k: 'psv', label: 'Veiligheidsventiel', type: 'keuze', opties: [{ v: 2.5, t: '2,5 bar' }, { v: 3, t: '3 bar' }, { v: 4, t: '4 bar' }, { v: 6, t: '6 bar' }], std: 3 },
                        { k: 'gly', label: 'Glycol', eh: '%', std: 0, min: 0, max: 60 }
                    ],
                    bereken: function (v, h) {
                        var Vs = v.Vs;
                        var st = [];
                        if (Vs == null) {
                            if (v.P == null) return { wacht: true, ontbreekt: ['waterinhoud of ketelvermogen'] };
                            Vs = v.P * Number(v.afg) + 10 + v.buffer;
                            st.push('V_syst ≈ ' + h.f(v.P) + ' kW × ' + Number(v.afg) + ' l/kW + 10 l ketel + ' + h.f(v.buffer) + ' l = ' + h.f(Vs, 0, 'l'));
                        } else Vs += v.buffer;
                        var e = E_WATER[Number(v.tmax)] * (1 + v.gly / 100 * 0.8);
                        var Ve = Vs * e, Vv = Math.max(0.005 * Vs, 3);
                        var psv = Number(v.psv), p0 = v.h / 10 + 0.3, pe = psv >= 5 ? psv * 0.9 : psv - 0.5;
                        if (pe <= p0) return { fout: 'Voordruk (' + h.fmt(p0, 1) + ' bar) ligt boven de einddruk (' + h.fmt(pe, 1) + ' bar): zwaarder veiligheidsventiel of het vat hoger plaatsen' };
                        var Vn = (Ve + Vv) * (pe + 1) / (pe - p0), keuze = h.omhoogNaar(Vn, VATEN);
                        st.push('V_e = ' + h.f(Vs, 0) + ' × ' + h.fmt(e, 4) + ' = ' + h.f(Ve, 1, 'l'), 'V_v = max(0,5 % × V, 3 l) = ' + h.f(Vv, 1, 'l'), 'p_0 = ' + h.f(v.h) + '/10 + 0,3 = ' + h.fmt(p0, 2) + ' bar; p_e = ' + h.fmt(pe, 2) + ' bar', 'V_n = (' + h.fmt(Ve, 1) + ' + ' + h.fmt(Vv, 1) + ') × (' + h.fmt(pe, 2) + ' + 1) / (' + h.fmt(pe, 2) + ' − ' + h.fmt(p0, 2) + ') = ' + h.f(Vn, 1, 'l'));
                        return {
                            uit: [h.uit('Expansievat', keuze ? keuze + ' l' : '> 1000 l', '', { hoofd: true, opm: 'berekend ' + h.fmt(Vn, 1) + ' l' }), h.uit('Voordruk vat (leeg, koud)', p0, 'bar', { dec: 1, hoofd: true }), h.uit('Vuldruk installatie (koud)', p0 + 0.3, 'bar', { dec: 1 }), h.uit('Einddruk (warm)', pe, 'bar', { dec: 1 }), h.uit('Uitzettingsvolume', Ve, 'l', { dec: 1 }), h.uit('Systeeminhoud in rekening', Vs, 'l', { dec: 0 })],
                            stappen: st,
                            waarsch: v.gly > 0 ? ['Glycol zet meer uit: e verhoogd met ' + h.fmt(v.gly * 0.8, 0) + ' %.'] : []
                        };
                    }
                },
                {
                    id: 'verw.veiligheidsventiel', naam: 'Veiligheidsventiel kiezen', kort: 'Maat van het ventiel en van de afblaasleiding',
                    zoek: 'veiligheidsventiel overdrukventiel veiligheidsklep afblaasleiding afblaas 3 bar maat dn ketel vermogen membraanveiligheidsventiel', soort: 'indicatief',
                    bron: 'Datablad SYR 1915 (membraanveiligheidsventiel), grootste ketelvermogen per maat en per insteldruk · TRD 721: bij 3 bar geldt hetzelfde vermogen als bij 2,5 bar · afblaasleiding: hoogstens 2 bochten en 2 m in de maat van de uitgang, tot 3 bochten en 4 m één maat groter',
                    uitleg: 'Het ventiel hoort op de ketel of vlak erbij op de aanvoer, zonder afsluiter of vuilvanger ertussen. De fiche van het ventiel en van de ketel gaat voor.',
                    velden: [
                        { k: 'P', label: 'Vermogen van de ketel', eh: 'kW', min: 0 },
                        { k: 'druk', label: 'Insteldruk', type: 'keuze', opties: [{ v: 3, t: '3 bar' }, { v: 2.5, t: '2,5 bar' }, { v: 2, t: '2 bar' }, { v: 1.5, t: '1,5 bar' }], std: 3 },
                        { k: 'L', label: 'Lengte van de afblaasleiding', eh: 'm', std: 1, min: 0 },
                        { k: 'bochten', label: 'Bochten in de afblaasleiding', std: 1, min: 0 }
                    ],
                    bereken: function (v, h) {
                        if (!(v.P > 0)) return { fout: 'Het vermogen moet groter zijn dan 0' };
                        var druk = Number(v.druk), kw = SV_KW[druk === 3 ? 2.5 : druk], i = -1;
                        for (var j = 0; j < kw.length; j++) if (v.P <= kw[j] + 1e-9) { i = j; break; }
                        var aantal = 1;
                        if (i < 0) { aantal = Math.ceil(v.P / kw[kw.length - 1] - 1e-9); if (aantal > 3) return { fout: 'Meer dan 3 ventielen van DN 50 nodig: laat de beveiliging van deze ketel berekenen' }; i = kw.length - 1; }
                        var bochten = Math.round(v.bochten), extra, waarsch = [];
                        if (v.L <= 2 + 1e-9 && bochten <= 2) extra = 0;
                        else if (v.L <= 4 + 1e-9 && bochten <= 3) extra = 1;
                        else return { fout: 'Een afblaasleiding van meer dan 4 m of met meer dan 3 bochten is niet toegelaten: zet het ventiel dichter bij de afvoer' };
                        if (aantal > 1) waarsch.push('Eén ventiel van DN 50 volstaat niet: plaats ' + aantal + ' ventielen van DN 50. Meer dan drie ventielen per ketel is niet toegelaten.');
                        if (extra) waarsch.push('De afblaasleiding is langer dan 2 m of heeft 3 bochten: neem ze één maat groter dan de uitgang van het ventiel.');
                        var rijen = SV_MAAT.map(function (m, k) { return ['DN ' + m.dn + ' (' + m.duim + ')', h.fmt(kw[k], 0) + ' kW', SV_UIT[k]]; });
                        return {
                            uit: [h.uit('Veiligheidsventiel', (aantal > 1 ? aantal + ' × ' : '') + 'DN ' + SV_MAAT[i].dn + ' (' + SV_MAAT[i].duim + ')', '', { hoofd: true, opm: 'tot ' + h.fmt(kw[i], 0) + ' kW bij ' + h.fmt(druk, 1) + ' bar' }), h.uit('Afblaasleiding', SV_UIT[i + extra], '', { hoofd: true, opm: extra ? 'één maat groter dan de uitgang' : 'de maat van de uitgang' }), h.uit('Uitgang van het ventiel', SV_UIT[i], ''), h.uit('Toevoerleiding', SV_MAAT[i].duim, '', { opm: 'hoogstens 1 m, recht, zonder afsluiter' })],
                            stappen: [h.f(v.P, 1, 'kW') + ' bij ' + h.f(druk, 1, 'bar') + ': kleinste maat met een vermogen van minstens ' + h.f(v.P, 1, 'kW') + ' is DN ' + SV_MAAT[i].dn],
                            tabel: { kop: ['Ingang', 'Ketel tot', 'Uitgang'], rijen: rijen, kies: i }, waarsch: waarsch,
                            opm: 'Leg de afblaasleiding met doorlopend afschot en laat ze zichtbaar uitmonden boven een trechter of afvoerputje. De afvoer van de trechter heeft minstens de dubbele doorsnede van de ingang van het ventiel. SYR geeft voor 3 bar zelf iets hogere vermogens (56 tot 1.017 kW): deze tabel houdt de voorzichtige waarden van 2,5 bar aan.'
                        };
                    }
                },
                {
                    id: 'verw.waterinhoud', naam: 'Waterinhoud van de installatie', kort: 'Liters uit buislengtes, radiatoren, ketel en buffer',
                    zoek: 'waterinhoud inhoud installatie liter buis radiator ketel systeeminhoud glycol', soort: 'indicatief',
                    bron: 'Inhoud per meter buis uit de binnendiameter; radiatoren richtwaarden per meter bij h 600 (11: 3,0 l · 21: 4,4 · 22: 5,9 · 33: 8,8), gietijzer ±1,2 l per element, vloerverwarming 16×2: 0,113 l/m',
                    velden: [{ k: 'rijen', label: 'Onderdelen', type: 'rijen', kolommen: [
                        { k: 'soort', label: 'Onderdeel', type: 'keuze', opties: [
                            { v: 'kop15', t: 'Koper 15×1 (m)', l: 0.133 }, { v: 'kop18', t: 'Koper 18×1 (m)', l: 0.201 }, { v: 'kop22', t: 'Koper 22×1 (m)', l: 0.314 }, { v: 'kop28', t: 'Koper 28×1,5 (m)', l: 0.491 }, { v: 'kop35', t: 'Koper 35×1,5 (m)', l: 0.804 }, { v: 'kop42', t: 'Koper 42×1,5 (m)', l: 1.195 }, { v: 'kop54', t: 'Koper 54×2 (m)', l: 1.963 },
                            { v: 'ml16', t: 'Meerlagen 16×2 (m)', l: 0.113 }, { v: 'ml20', t: 'Meerlagen 20×2 (m)', l: 0.201 }, { v: 'ml26', t: 'Meerlagen 26×3 (m)', l: 0.314 }, { v: 'ml32', t: 'Meerlagen 32×3 (m)', l: 0.531 },
                            { v: 'st12', t: 'Staal 1/2" (m)', l: 0.201 }, { v: 'st34', t: 'Staal 3/4" (m)', l: 0.366 }, { v: 'st1', t: 'Staal 1" (m)', l: 0.581 }, { v: 'st54', t: 'Staal 5/4" (m)', l: 1.012 }, { v: 'st64', t: 'Staal 6/4" (m)', l: 1.372 }, { v: 'st2', t: 'Staal 2" (m)', l: 2.206 },
                            { v: 'r11', t: 'Radiator type 11 h600 (m)', l: 3.0 }, { v: 'r21', t: 'Radiator type 21 h600 (m)', l: 4.4 }, { v: 'r22', t: 'Radiator type 22 h600 (m)', l: 5.9 }, { v: 'r33', t: 'Radiator type 33 h600 (m)', l: 8.8 }, { v: 'giet', t: 'Gietijzer (elementen)', l: 1.2 }, { v: 'vv', t: 'Vloerverwarming 16×2 (m)', l: 0.113 },
                            { v: 'ketel', t: 'Ketel / warmtepomp (l)', l: 1 }, { v: 'buffer', t: 'Buffer / boiler cv-zijde (l)', l: 1 }, { v: 'los', t: 'Andere (l)', l: 1 }
                        ] },
                        { k: 'n', label: 'Aantal / meter', type: 'getal' }
                    ], std: [{ soort: 'kop22', n: 30 }, { soort: 'kop15', n: 60 }, { soort: 'r22', n: 8 }, { soort: 'ketel', n: 10 }] }],
                    bereken: function (v, h) {
                        var opties = this.velden[0].kolommen[0].opties, tot = 0, rijen = [];
                        v.rijen.forEach(function (r) {
                            var o = opties.filter(function (x) { return x.v === r.soort; })[0];
                            if (!o || !r.n) return;
                            var l = o.l * r.n; tot += l;
                            rijen.push([o.t, h.fmt(r.n), h.fmt(l, 1) + ' l']);
                        });
                        return { uit: [h.uit('Waterinhoud', tot, 'l', { dec: 0, hoofd: true })], tabel: { kop: ['Onderdeel', 'Aantal', 'Inhoud'], rijen: rijen }, opm: 'Gebruik dit getal in “Expansievat verwarming” en “Glycol”.' };
                    }
                },
                {
                    id: 'verw.vulwater', naam: 'Vulwater: hardheid (VDI 2035)', kort: 'Mag je vullen met leidingwater, of moet het onthard of gedemineraliseerd?',
                    zoek: 'vulwater vdi 2035 hardheid ketelsteen kalk ontharden demineraliseren elysator waterkwaliteit cv water geleidbaarheid ph aluminium bijvullen', soort: 'indicatief',
                    bron: 'VDI 2035 blad 1 (uitgave maart 2021), tabel 1: toegelaten totale hardheid volgens het totale vermogen en de specifieke waterinhoud · gelezen in de documentatie van UWS, Reflex en Elysator · 1 mmol/l = 10 °fH = 5,6 °dH',
                    uitleg: 'De specifieke waterinhoud is de inhoud van de installatie gedeeld door het vermogen van de kleinste ketel. De eisen van de ketelfabrikant gaan voor: de waarborg hangt ervan af.',
                    velden: [
                        { k: 'P', label: 'Totaal vermogen van de ketels', eh: 'kW', min: 0 },
                        { k: 'Pk', label: 'Vermogen van de kleinste ketel', eh: 'kW', opt: true, min: 0, hint: 'leeg = er is maar één ketel' },
                        { k: 'V', label: 'Waterinhoud van de installatie', eh: 'l', min: 0, hint: 'zie “Waterinhoud van de installatie”' },
                        { k: 'type', label: 'Soort ketel', type: 'keuze', opties: [{ v: 'door', t: 'Wandketel of doorstroomtoestel (minder dan 0,3 l water per kW)' }, { v: 'groot', t: 'Ketel met grote waterinhoud (0,3 l per kW of meer)' }], std: 'door' },
                        { k: 'hard', label: 'Hardheid van het vulwater', eh: '°fH', ehs: ['°fH', '°dH', 'mmol/l'], familie: 'hardheid', std: 30, min: 0, snel: [{ t: 'Zacht 10', v: 10 }, { t: 'Gemiddeld 25', v: 25 }, { t: 'Hard 35', v: 35 }, { t: 'Zeer hard 45', v: 45 }] },
                        { k: 'alu', label: 'Aluminium in de installatie (ketel of radiatoren)', type: 'vink', std: false }
                    ],
                    bereken: function (v, h) {
                        var Pk = v.Pk != null && v.Pk > 0 ? v.Pk : v.P;
                        if (!(v.P > 0) || !(Pk > 0)) return { fout: 'Het vermogen moet groter zijn dan 0' };
                        if (Pk > v.P + 1e-9) return { fout: 'De kleinste ketel kan niet groter zijn dan het totale vermogen' };
                        var vs = v.V / Pk, kol = vs <= 20 ? 0 : vs <= 40 ? 1 : 2;
                        var rij = v.P <= 50 ? (v.type === 'groot' ? 0 : 1) : v.P <= 200 ? 2 : v.P <= 600 ? 3 : 4;
                        var grens = VDI2035[rij].g[kol];          // mmol/l, null = geen eis
                        var fh = function (mmol) { return mmol * 10; };
                        var waarsch = [], advies, kleur;
                        if (grens == null) { advies = 'leidingwater mag'; kleur = 'groen'; }
                        else if (grens < 0.1) { advies = 'gedemineraliseerd of volledig onthard water'; kleur = v.hard <= fh(grens) ? 'groen' : 'rood'; }
                        else if (v.hard <= fh(grens) + 1e-9) { advies = 'leidingwater mag'; kleur = 'groen'; }
                        else { advies = 'ontharden tot ' + h.fmt(fh(grens), 0) + ' °fH of lager'; kleur = 'amber'; }
                        if (v.alu) waarsch.push('Met aluminium in de installatie: pH tussen 8,2 en 9,0. Volledig ontharden wordt dan afgeraden: vul met gedemineraliseerd water.');
                        if (vs > 40) waarsch.push('Meer dan 40 l per kW (veel water, bijvoorbeeld een buffervat): de strengste eis geldt.');
                        var NB = String.fromCharCode(160), tekst = function (g) { return g == null ? 'geen eis' : g < 0.1 ? '<' + NB + '0,5' + NB + '°fH' : h.fmt(fh(g), 0) + NB + '°fH'; };
                        var rijen = VDI2035.map(function (r) { return [r.t, tekst(r.g[0]), tekst(r.g[1]), tekst(r.g[2])]; });
                        return {
                            uit: [h.uit('Vulwater', advies, '', { hoofd: true, kleur: kleur }), h.uit('Toegelaten hardheid', grens == null ? 'geen eis' : grens < 0.1 ? 'lager dan 0,5 °fH' : h.fmt(fh(grens), 0) + ' °fH', '', { hoofd: true, opm: grens == null ? '' : grens < 0.1 ? 'lager dan 0,05 mmol/l of 0,3 °dH' : h.fmt(grens, 1) + ' mmol/l of ' + h.fmt(grens * 5.6, 1) + ' °dH' }), h.uit('Specifieke waterinhoud', vs, 'l/kW', { dec: 1 }), h.uit('Kalk in één vulling met dit water', v.V * v.hard * 0.01, 'g', { dec: 0, opm: '1 °fH = 10 mg kalk per liter' })],
                            stappen: ['Specifieke waterinhoud = ' + h.f(v.V, 0) + ' l / ' + h.f(Pk, 1) + ' kW = ' + h.f(vs, 1, 'l/kW'), 'Tabel: ' + VDI2035[rij].t + ', kolom ' + ['tot 20 l/kW', '20 tot 40 l/kW', 'meer dan 40 l/kW'][kol]],
                            tabel: { kop: ['Hoogste hardheid', 'Tot 20 l/kW', 'Tot 40 l/kW', 'Meer dan 40 l/kW'], rijen: rijen, kies: rij }, waarsch: waarsch,
                            opm: 'Verder volgens VDI 2035: pH tussen 8,2 en 10 (met aluminium tot 9,0), te meten ten vroegste 10 weken na de ingebruikname. Geleidbaarheid: zoutarm water 10 tot 100 µS/cm, zouthoudend water 100 tot 1.500 µS/cm. Bijvullen over de hele levensduur: richtwaarde hoogstens twee keer de inhoud van de installatie. Noteer elke vulling in het logboek van de installatie.'
                        };
                    }
                },
                {
                    id: 'verw.buffer', naam: 'Buffervat', kort: 'Inhoud, energie-inhoud en laadtijd',
                    zoek: 'buffervat buffer warmtepomp houtkachel pellet inhoud liter laadtijd ontkoppeling', soort: 'indicatief',
                    bron: 'Richtwaarden: warmtepomp 15–25 l/kW (ontdooien, minimale looptijd), houtkachel/pelletketel 50–100 l/kW (EN 303-5: min. 12 l/kW), hydraulische ontkoppeling 10 l/kW · E = V × 1,163 Wh × ΔT',
                    velden: [
                        { k: 'P', label: 'Vermogen warmtebron', eh: 'kW' },
                        { k: 'soort', label: 'Toepassing', type: 'keuze', opties: [{ v: 20, t: 'Warmtepomp (20 l/kW)' }, { v: 55, t: 'Houtkachel met waterzak / pelletketel (55 l/kW)' }, { v: 80, t: 'Houtvergasser (80 l/kW)' }, { v: 10, t: 'Ontkoppeling ketelcascade (10 l/kW)' }], std: 20 },
                        { k: 'dT', label: 'Bruikbaar temperatuurverschil', eh: 'K', std: 10, snel: [{ t: 'WP 10', v: 10 }, { t: 'Hout 30', v: 30 }, { t: 'Hout 40', v: 40 }] }
                    ],
                    bereken: function (v, h) {
                        var V = v.P * Number(v.soort), keuze = h.omhoogNaar(V, [50, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000]);
                        var E = keuze * W.wh_l_K * v.dT / 1000, laad = E / v.P;
                        return { uit: [h.uit('Buffervat', keuze, 'l', { hoofd: true, opm: 'berekend ' + h.fmt(V, 0) + ' l' }), h.uit('Energie-inhoud bij ΔT ' + h.fmt(v.dT) + ' K', E, 'kWh', { dec: 1 }), h.uit('Laadtijd op vol vermogen', laad * 60, 'min', { dec: 0 }), h.uit('Overbrugt bij 50 % belasting', laad * 2 * 60, 'min', { dec: 0 })], stappen: ['V = ' + h.f(v.P) + ' × ' + Number(v.soort) + ' = ' + h.f(V, 0, 'l') + ' → ' + keuze + ' l', 'E = ' + keuze + ' × 1,163 × ' + h.f(v.dT) + ' / 1000 = ' + h.f(E, 1, 'kWh')] };
                    }
                },
                {
                    id: 'verw.glycol', naam: 'Glycol (vorstbescherming)', kort: 'Mengverhouding, liters en de correcties op debiet en drukverlies',
                    zoek: 'glycol antivries vorstbescherming mengverhouding ethyleen propyleen procent debiet correctie warmtepomp zonneboiler', soort: 'indicatief',
                    bron: 'Volumeprocent per vorstgrens (MEG/MPG-tabellen); correcties: soortelijke warmte ↓ → debiet ↑; viscositeit ↑ → drukverlies ↑ (richtwaarden bij 30 %: cp 0,89–0,92, Δp × 1,3)',
                    velden: [
                        { k: 'type', label: 'Glycol', type: 'keuze', opties: [{ v: 'meg', t: 'Ethyleenglycol (MEG, niet-voedingsveilig)' }, { v: 'mpg', t: 'Propyleenglycol (MPG, sanitair/voeding)' }] },
                        { k: 'vorst', label: 'Vorstbescherming tot', eh: '°C', std: -15, max: 0, snel: [{ t: '−10', v: -10 }, { t: '−15', v: -15 }, { t: '−20', v: -20 }, { t: '−25', v: -25 }] },
                        { k: 'Vs', label: 'Waterinhoud installatie', eh: 'l' }
                    ],
                    bereken: function (v, h) {
                        var T = v.type === 'meg' ? { x: [-37, -30, -25, -20, -16, -12, -8, -4, 0], y: [50, 45, 40, 35, 30, 25, 20, 10, 0] } : { x: [-33, -27, -22, -17, -13, -10, -7, -3, 0], y: [50, 45, 40, 35, 30, 25, 20, 10, 0] };
                        var pct = Math.ceil(h.interp(v.vorst, T.x, T.y));
                        var cp = h.interp(pct, [0, 20, 30, 40, 50], v.type === 'meg' ? [1, 0.93, 0.89, 0.85, 0.81] : [1, 0.95, 0.92, 0.88, 0.84]);
                        var dpf = h.interp(pct, [0, 20, 30, 40, 50], [1, 1.15, 1.3, 1.5, 1.75]);
                        var waarsch = [];
                        if (v.vorst < (v.type === 'meg' ? -37 : -33)) waarsch.push('Zo diep beschermt een gewoon mengsel niet; boven 50 % daalt de warmteoverdracht sterk.');
                        return {
                            uit: [h.uit('Glycol', pct, 'vol-%', { hoofd: true }), h.uit('Liters glycol', v.Vs * pct / 100, 'l', { dec: 0, hoofd: true }), h.uit('Liters water', v.Vs * (1 - pct / 100), 'l', { dec: 0 }), h.uit('Debiet verhogen met', (1 / cp - 1) * 100, '%', { dec: 0, opm: 'zelfde vermogen, cp-factor ' + h.fmt(cp, 2) }), h.uit('Drukverlies stijgt met factor', dpf, '', { dec: 2 }), h.uit('Capaciteit wisselaars', '−5 à −10 %', '')],
                            waarsch: waarsch, opm: 'Kant-en-klare mengsels (bv. Tyfocor) hebben eigen tabellen: die gaan voor.'
                        };
                    }
                },
                {
                    id: 'verw.uitzetting', naam: 'Uitzetting van leidingen', kort: 'Lengteverandering en compensatiearm',
                    zoek: 'uitzetting lengteverandering thermisch koper staal kunststof compensator bocht expansie', soort: 'exact',
                    bron: 'ΔL = α × L × ΔT · compensatiearm L_B = C × √(d × ΔL) (mm): koper C 61, RVS 45, meerlagen 33, PP-R 30, PE 26',
                    velden: [
                        { k: 'mat', label: 'Materiaal', type: 'keuze', opties: [{ v: 'koper', t: 'Koper (0,0166 mm/m·K)' }, { v: 'staal', t: 'Staal (0,012)' }, { v: 'rvs', t: 'RVS (0,016)' }, { v: 'meerlagen', t: 'Meerlagen (0,025)' }, { v: 'ppr', t: 'PP-R (0,15)' }, { v: 'pe', t: 'PE / PE-X (0,18)' }, { v: 'pvc', t: 'PVC (0,08)' }] },
                        { k: 'L', label: 'Leidinglengte tussen vaste punten', eh: 'm' },
                        { k: 'dT', label: 'Temperatuurverschil montage → bedrijf', eh: 'K', std: 55, snel: [{ t: 'Cv 55', v: 55 }, { t: 'Vloer 25', v: 25 }, { t: 'Warm water 45', v: 45 }] },
                        { k: 'd', label: 'Buitendiameter (voor de compensatiearm)', eh: 'mm', opt: true }
                    ],
                    bereken: function (v, h) {
                        var A = { koper: 0.0166, staal: 0.012, rvs: 0.016, meerlagen: 0.025, ppr: 0.15, pe: 0.18, pvc: 0.08 }[v.mat];
                        var C = { koper: 61, rvs: 45, meerlagen: 33, ppr: 30, pe: 26, pvc: 34 }[v.mat];
                        var dL = A * v.L * v.dT, uit = [h.uit('Uitzetting ΔL', dL, 'mm', { dec: 1, hoofd: true })], st = ['ΔL = ' + h.fmt(A, 4) + ' × ' + h.f(v.L) + ' × ' + h.f(v.dT) + ' = ' + h.f(dL, 1, 'mm')];
                        if (v.d != null && C) { var LB = C * Math.sqrt(v.d * dL); uit.push(h.uit('Compensatiearm (U-bocht / haakse arm)', LB, 'mm', { dec: 0 })); st.push('L_B = ' + C + ' × √(' + h.f(v.d) + ' × ' + h.fmt(dL, 1) + ') = ' + h.f(LB, 0, 'mm')); }
                        else if (v.d != null) uit.push(h.uit('Compensatiearm', 'volgens leverancier (staal: lassen/vaste punten)', ''));
                        return { uit: uit, stappen: st };
                    }
                },
                {
                    id: 'verw.pqdt', naam: 'Vermogen, debiet en ΔT', kort: 'Twee waarden invullen, de derde volgt',
                    zoek: 'vermogen debiet delta t temperatuurverschil warmtemeter kw l/h aanvoer retour energie meten water glycol', soort: 'exact',
                    bron: 'P = 1,163 × Q × ΔT [W, l/h, K] voor water · met glycol daalt de factor (20 %: 1,12 · 30 %: 1,08 · 40 %: 1,03)',
                    velden: [
                        { k: 'P', label: 'Vermogen', eh: 'kW', ehs: ['kW', 'W'], opt: true, min: 0 },
                        { k: 'Q', label: 'Debiet', eh: 'l/h', ehs: ['l/h', 'm³/h', 'l/min', 'l/s'], opt: true, min: 0 },
                        { k: 'dT', label: 'ΔT aanvoer − retour', eh: 'K', opt: true, min: 0, snel: [{ t: '5', v: 5 }, { t: '7', v: 7 }, { t: '10', v: 10 }, { t: '15', v: 15 }, { t: '20', v: 20 }] },
                        { k: 'c', label: 'Warmtedrager', type: 'keuze', opties: WARMTEDRAGER, std: 1.163 }
                    ],
                    bereken: function (v, h) {
                        var c = Number(v.c), P = v.P, Q = v.Q, dT = v.dT, n = [P, Q, dT].filter(function (x) { return x != null; }).length, st = [];
                        if (n < 2) return { wacht: true, ontbreekt: ['twee van de drie'] };
                        if (P == null) { P = c * Q * dT / 1000; st.push('P = ' + h.fmt(c, 3) + ' × ' + h.f(Q, 0) + ' × ' + h.f(dT, 1) + ' / 1.000 = ' + h.f(P, 2, 'kW')); }
                        else if (Q == null) { if (!(dT > 0)) return { fout: 'ΔT moet groter zijn dan 0' }; Q = P * 1000 / (c * dT); st.push('Q = ' + h.f(P, 2) + ' × 1.000 / (' + h.fmt(c, 3) + ' × ' + h.f(dT, 1) + ') = ' + h.f(Q, 0, 'l/h')); }
                        else { if (!(Q > 0)) return { fout: 'Het debiet moet groter zijn dan 0' }; dT = P * 1000 / (c * Q); st.push('ΔT = ' + h.f(P, 2) + ' × 1.000 / (' + h.fmt(c, 3) + ' × ' + h.f(Q, 0) + ') = ' + h.f(dT, 1, 'K')); }
                        return { uit: [h.uit('Vermogen', P, 'kW', { dec: 2, hoofd: v.P == null, opm: h.fmt(P * 1000, 0) + ' W' }), h.uit('Debiet', Q, 'l/h', { dec: 0, hoofd: v.P != null && v.Q == null, opm: h.fmt(Q / 1000, 2) + ' m³/h · ' + h.fmt(Q / 60, 1) + ' l/min' }), h.uit('ΔT', dT, 'K', { dec: 1, hoofd: v.P != null && v.Q != null })], stappen: st };
                    }
                },
                {
                    id: 'verw.regelklep', naam: 'Regelklep kiezen: Kvs en autoriteit', kort: 'Mengkraan, tweeweg- of driewegklep dimensioneren',
                    zoek: 'regelklep mengkraan driewegkraan tweewegklep kvs autoriteit klepautoriteit dimensioneren motorklep menggroep drukverlies', soort: 'exact',
                    bron: 'Kv = Q / √Δp [m³/h, bar] · autoriteit a = Δp_klep / (Δp_klep + Δp_kring) met Δp_kring het drukverlies van het deel met veranderlijk debiet · Siemens: dimensioneer op een autoriteit van minstens 0,5 · onder 0,3 regelt een klep slecht (vuistregel uit de praktijk) · Kvs-reeks van Danfoss en Siemens: 0,25 · 0,4 · 0,63 · 1 · 1,6 · 2,5 · 4 · 6,3 · 10 · 16 · 25 · 40 · 63 · 100 · 160 (Kvs = debiet in m³/h bij 1 bar drukverlies, ± 10 %)',
                    uitleg: 'Een klep met te grote Kvs regelt alleen in het eerste stukje van zijn slag: de installatie pendelt. Kies daarom de klep op het drukverlies, niet op de diameter van de leiding.',
                    velden: [
                        { k: 'P', label: 'Vermogen', eh: 'kW', ehs: ['kW', 'W'], opt: true, min: 0 },
                        { k: 'dT', label: 'ΔT', eh: 'K', std: 20, min: 1 },
                        { k: 'Q', label: 'of debiet', eh: 'l/h', ehs: ['l/h', 'm³/h', 'l/min'], opt: true, min: 0 },
                        { k: 'dpk', label: 'Drukverlies van de kring met veranderlijk debiet', eh: 'kPa', std: 10, min: 0.1, snel: [{ t: 'Ketel 5', v: 5 }, { t: 'Verdeler 10', v: 10 }, { t: 'Wisselaar 20', v: 20 }] },
                        { k: 'a', label: 'Gewenste autoriteit', std: 0.5, min: 0.1, max: 0.9, snel: [{ t: '0,3', v: 0.3 }, { t: '0,5', v: 0.5 }] }
                    ],
                    bereken: function (v, h) {
                        var Q = v.Q != null ? v.Q / 1000 : (v.P != null ? v.P / (W.wh_l_K * v.dT) : null);
                        if (Q == null) return { wacht: true, ontbreekt: ['vermogen of debiet'] };
                        if (!(Q > 0)) return { fout: 'Het debiet moet groter zijn dan 0' };
                        var dpDoel = v.a / (1 - v.a) * v.dpk, kv = Q / Math.sqrt(dpDoel / 100), keus = -1;
                        var rijen = KVS.map(function (k, i) {
                            var dp = Math.pow(Q / k, 2) * 100, a = dp / (dp + v.dpk);
                            if (a >= v.a - 1e-9) keus = i;
                            return [h.fmt(k, 2), h.fmt(dp, 1) + ' kPa', h.fmt(a, 2), a < 0.3 ? 'regelt slecht' : dp > 40 ? 'veel drukverlies' : VINK];
                        });
                        if (keus < 0) keus = 0;
                        var K = KVS[keus], dpK = Math.pow(Q / K, 2) * 100, aK = dpK / (dpK + v.dpk), waarsch = [];
                        if (dpK > 40) waarsch.push('Deze klep vraagt ' + h.fmt(dpK, 0) + ' kPa: controleer of de pomp dat kan leveren, of aanvaard een lagere autoriteit.');
                        var van = Math.max(0, keus - 3), tot = Math.min(KVS.length, keus + 4);
                        return {
                            uit: [h.uit('Klep kiezen', 'Kvs ' + h.fmt(K, 2), '', { hoofd: true }), h.uit('Autoriteit', aK, '', { dec: 2, hoofd: true, kleur: aK >= 0.3 ? 'groen' : 'amber' }), h.uit('Drukverlies over de klep', dpK, 'kPa', { dec: 1 }), h.uit('Berekende Kv', kv, 'm³/h', { dec: 2 }), h.uit('Debiet', Q * 1000, 'l/h', { dec: 0 })],
                            stappen: ['Δp_klep voor a = ' + h.f(v.a, 2) + ': ' + h.f(v.a, 2) + ' / (1 − ' + h.f(v.a, 2) + ') × ' + h.f(v.dpk, 1) + ' = ' + h.f(dpDoel, 1, 'kPa'), 'Kv = ' + h.fmt(Q, 3) + ' / √(' + h.fmt(dpDoel / 100, 3) + ') = ' + h.f(kv, 2), 'Grootste Kvs met een autoriteit van minstens ' + h.f(v.a, 2) + ': ' + h.fmt(K, 2)],
                            tabel: { kop: ['Kvs', 'Drukverlies', 'Autoriteit', ''], rijen: rijen.slice(van, tot), kies: keus - van }, waarsch: waarsch
                        };
                    }
                },
                {
                    id: 'verw.wissel', naam: 'Evenwichtsfles en open verdeler', kort: 'Diameter, en de temperaturen als de debieten verschillen',
                    zoek: 'evenwichtsfles hydraulische wissel open verdeler ontkoppeling cascade primair secundair debiet diameter 3d regel retourtemperatuur caleffi', soort: 'indicatief',
                    bron: 'Snelheid in de fles hoogstens 0,2 m/s bij vollast (IKZ, haustec), 0,1 m/s als ontwerpwaarde voor een betere scheiding (UKGP): d = √(4 × Q / (π × v)) met het grootste van de twee debieten · vuistregel: de fles is 2,5 tot 3 keer zo breed als de aansluitleiding · kant-en-klare fles: grootste debiet per maat van Caleffi reeks 548 · menging uit de warmtebalans van de debieten',
                    uitleg: 'Is het secundaire debiet groter dan het primaire, dan mengt retourwater bij de aanvoer en wordt de aanvoer naar de groepen kouder. Is het primaire debiet groter, dan stijgt de retour naar de ketel: een condensatieketel condenseert dan minder.',
                    velden: [
                        { k: 'Pp', label: 'Vermogen van de ketels (primair)', eh: 'kW', min: 0 },
                        { k: 'dTp', label: 'ΔT primair', eh: 'K', std: 20, min: 1 },
                        { k: 'Ps', label: 'Vermogen van de groepen (secundair)', eh: 'kW', opt: true, min: 0, hint: 'leeg = gelijk aan het ketelvermogen' },
                        { k: 'dTs', label: 'ΔT secundair', eh: 'K', std: 15, min: 1 },
                        { k: 'Tap', label: 'Aanvoertemperatuur van de ketel', eh: '°C', std: 70 },
                        { k: 'vmax', label: 'Snelheid in de fles', type: 'keuze', opties: [{ v: 0.2, t: '0,2 m/s (grootste snelheid bij vollast)' }, { v: 0.1, t: '0,1 m/s (betere scheiding van lucht en slib)' }], std: 0.2 }
                    ],
                    bereken: function (v, h) {
                        var Ps = v.Ps != null ? v.Ps : v.Pp, Qp = v.Pp / (W.wh_l_K * v.dTp), Qs = Ps / (W.wh_l_K * v.dTs), Qm = Math.max(Qp, Qs);
                        if (!(Qm > 0)) return { fout: 'Het vermogen moet groter zijn dan 0' };
                        var vm = Number(v.vmax), d = Math.sqrt(4 * Qm / 3600 / (Math.PI * vm)) * 1000, da = Math.sqrt(4 * Qm / 3600 / (Math.PI * 1.0)) * 1000;
                        var kant = WISSEL_KANT.filter(function (x) { return x.q >= Qm - 1e-9; })[0];
                        var Tas, Trs, Trp, waarsch = [];
                        if (Qs > Qp && Qp > 0) { Tas = v.Tap - (Qs - Qp) / Qp * v.dTs; Trs = Tas - v.dTs; Trp = Trs; waarsch.push('Het secundaire debiet is groter dan het primaire: de groepen krijgen ' + h.fmt(Tas, 0) + ' °C in plaats van ' + h.fmt(v.Tap, 0) + ' °C. Verhoog het ketelvermogen of het primaire debiet, of verklein de pompen van de groepen.'); }
                        else { Tas = v.Tap; Trs = Tas - v.dTs; Trp = Qp > 0 ? (Qs * Trs + (Qp - Qs) * v.Tap) / Qp : Trs; if (Qp > Qs * 1.1) waarsch.push('Het primaire debiet is groter dan het secundaire: de retour naar de ketel stijgt tot ' + h.fmt(Trp, 0) + ' °C. Regel de ketelpomp op de temperatuur of het debiet van de groepen.'); }
                        return {
                            uit: [h.uit('Binnendiameter van de fles', d, 'mm', { dec: 0, hoofd: true, opm: (staalDn(d) ? 'stalen buis ' + staalDn(d) : 'groter dan de grootste buis in de lijst') + ' · ' + h.fmt(d / da, 1) + ' keer de aansluitleiding' }), h.uit('Kant-en-klare fles', kant ? 'DN ' + kant.dn : 'groter dan DN 300', '', { opm: kant ? 'tot ' + h.fmt(kant.q, 1) + ' m³/h (Caleffi 548)' : 'laten berekenen' }), h.uit('Aansluitleidingen (1 m/s)', da, 'mm', { dec: 0, opm: staalDn(da) ? 'stalen buis ' + staalDn(da) : '' }), h.uit('Debiet primair', Qp * 1000, 'l/h', { dec: 0 }), h.uit('Debiet secundair', Qs * 1000, 'l/h', { dec: 0 }), h.uit('Aanvoer naar de groepen', Tas, '°C', { dec: 1, hoofd: true, kleur: Tas < v.Tap - 0.5 ? 'amber' : 'groen' }), h.uit('Retour naar de ketel', Trp, '°C', { dec: 1, hoofd: true })],
                            stappen: ['Q_p = ' + h.f(v.Pp, 1) + ' / (1,163 × ' + h.f(v.dTp, 0) + ') = ' + h.f(Qp, 2, 'm³/h'), 'Q_s = ' + h.f(Ps, 1) + ' / (1,163 × ' + h.f(v.dTs, 0) + ') = ' + h.f(Qs, 2, 'm³/h'), 'd = √(4 × ' + h.fmt(Qm / 3600, 5) + ' / (π × ' + h.fmt(vm, 1) + ')) = ' + h.f(d, 0, 'mm')],
                            waarsch: waarsch,
                            opm: 'Afstand tussen de aansluitingen boven elkaar: minstens 2,5 keer de diameter van de fles. Snelheid in de aansluitleidingen: 0,7 tot 1,2 m/s. Plaats de aanvoervoeler van de regeling in de fles, aan de kant van de groepen.'
                        };
                    }
                },
                {
                    id: 'verw.mengkring', naam: 'Mengkring: debieten en temperaturen', kort: 'Vloerverwarming of lage temperatuur op een ketel met hoge temperatuur',
                    zoek: 'mengkring menggroep mengkraan driewegkraan vloerverwarming ketel aanvoer debiet bijmengen bypass injectie temperatuur', soort: 'exact',
                    bron: 'Q_kring = P / (1,163 × (T_aanvoer − T_retour)) · uit de ketel: Q_ketel = Q_kring × (T_aanvoer − T_retour) / (T_ketel − T_retour) · de rest stroomt rond via de bypass van de mengkraan',
                    velden: [
                        { k: 'P', label: 'Vermogen van de kring', eh: 'kW', ehs: ['kW', 'W'], min: 0 },
                        { k: 'Tv', label: 'Aanvoer in de kring', eh: '°C', std: 40 },
                        { k: 'Tr', label: 'Retour uit de kring', eh: '°C', std: 33 },
                        { k: 'Tk', label: 'Aanvoer van de ketel', eh: '°C', std: 70 }
                    ],
                    bereken: function (v, h) {
                        if (!(v.Tv > v.Tr)) return { fout: 'De aanvoer moet warmer zijn dan de retour' };
                        if (!(v.Tk >= v.Tv)) return { fout: 'De ketel moet minstens zo warm zijn als de aanvoer van de kring' };
                        var Qk = v.P * 1000 / (W.wh_l_K * (v.Tv - v.Tr)), Qp = Qk * (v.Tv - v.Tr) / (v.Tk - v.Tr), Qb = Qk - Qp;
                        return {
                            uit: [h.uit('Debiet in de kring', Qk, 'l/h', { dec: 0, hoofd: true }), h.uit('Debiet uit de ketel', Qp, 'l/h', { dec: 0, hoofd: true, opm: h.fmt(Qp / Qk * 100, 0) + ' % van het kringdebiet' }), h.uit('Debiet door de bypass', Qb, 'l/h', { dec: 0 }), h.uit('ΔT aan de ketelzijde', v.Tk - v.Tr, 'K', { dec: 0 })],
                            stappen: ['Q_kring = ' + h.f(v.P, 2) + ' × 1.000 / (1,163 × (' + h.f(v.Tv, 0) + ' − ' + h.f(v.Tr, 0) + ')) = ' + h.f(Qk, 0, 'l/h'), 'Q_ketel = ' + h.fmt(Qk, 0) + ' × (' + h.f(v.Tv, 0) + ' − ' + h.f(v.Tr, 0) + ') / (' + h.f(v.Tk, 0) + ' − ' + h.f(v.Tr, 0) + ') = ' + h.f(Qp, 0, 'l/h')],
                            opm: 'Dimensioneer de mengkraan op het debiet in de kring en de leiding van de ketel op het debiet uit de ketel. Bij vloerverwarming hoort een maximaalthermostaat op de aanvoer.'
                        };
                    }
                },
                {
                    id: 'verw.pompwetten', naam: 'Pomp- en ventilatorwetten', kort: 'Wat gebeurt er met debiet, druk en vermogen bij een ander toerental?',
                    zoek: 'pompwetten affiniteitswetten toerental debiet opvoerhoogte vermogen ventilator frequentieregelaar besparing pompstand', soort: 'exact',
                    bron: 'Q₂ = Q₁ × (n₂/n₁) · H₂ = H₁ × (n₂/n₁)² · P₂ = P₁ × (n₂/n₁)³ · geldt voor dezelfde pomp of ventilator in dezelfde installatie',
                    velden: [
                        { k: 'Q1', label: 'Debiet nu', eh: 'm³/h', ehs: ['m³/h', 'l/h', 'l/s'], std: 2, min: 0 },
                        { k: 'H1', label: 'Opvoerhoogte of druk nu', eh: 'm', std: 4, min: 0 },
                        { k: 'P1', label: 'Opgenomen vermogen nu', eh: 'W', std: 60, min: 0 },
                        { k: 'n2', label: 'Nieuw toerental', eh: '%', opt: true, min: 1, max: 200, snel: [{ t: '90', v: 90 }, { t: '80', v: 80 }, { t: '70', v: 70 }, { t: '50', v: 50 }] },
                        { k: 'Q2', label: 'of nieuw debiet', eh: 'm³/h', ehs: ['m³/h', 'l/h', 'l/s'], opt: true, min: 0 },
                        { k: 'uren', label: 'Draaiuren per jaar', eh: 'h', std: 5000, min: 0 },
                        { k: 'prijs', label: 'Stroomprijs', eh: '€/kWh', std: 0.35, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var r = v.n2 != null ? v.n2 / 100 : (v.Q2 != null && v.Q1 > 0 ? v.Q2 / v.Q1 : null);
                        if (r == null) return { wacht: true, ontbreekt: ['nieuw toerental of nieuw debiet'] };
                        var Q2 = v.Q1 * r, H2 = v.H1 * r * r, P2 = v.P1 * r * r * r, dE = (v.P1 - P2) * v.uren / 1000;
                        var rijen = [100, 90, 80, 70, 60, 50].map(function (p) { var x = p / 100; return [p + ' %', h.fmt(v.Q1 * x, 2) + ' m³/h', h.fmt(v.H1 * x * x, 2) + ' m', h.fmt(v.P1 * x * x * x, 0) + ' W']; });
                        return {
                            uit: [h.uit('Nieuw debiet', Q2, 'm³/h', { dec: 2, hoofd: true }), h.uit('Nieuwe opvoerhoogte', H2, 'm', { dec: 2, hoofd: true }), h.uit('Nieuw vermogen', P2, 'W', { dec: 0, hoofd: true }), h.uit('Toerental', r * 100, '%', { dec: 0 }), h.uit('Verschil per jaar', dE, 'kWh', { dec: 0, opm: '€ ' + h.fmt(dE * v.prijs, 0), kleur: dE > 0 ? 'groen' : '' })],
                            stappen: ['Verhouding = ' + h.fmt(r, 3), 'H₂ = ' + h.f(v.H1, 2) + ' × ' + h.fmt(r, 3) + '² = ' + h.f(H2, 2, 'm'), 'P₂ = ' + h.f(v.P1, 0) + ' × ' + h.fmt(r, 3) + '³ = ' + h.f(P2, 0, 'W')],
                            tabel: { kop: ['Toerental', 'Debiet', 'Opvoerhoogte', 'Vermogen'], rijen: rijen },
                            opm: '20 % minder debiet vraagt maar de helft van het vermogen. Daarom loont een juist ingestelde, toerengeregelde pomp.'
                        };
                    }
                },
                {
                    id: 'verw.wisselaar', naam: 'Warmtewisselaar', kort: 'Vermogen, debieten, gemiddeld temperatuurverschil en oppervlak',
                    zoek: 'warmtewisselaar platenwisselaar wisselaar lmtd logaritmisch temperatuurverschil tegenstroom oppervlak afleverset zwembad stadsverwarming', soort: 'exact',
                    bron: 'P = 1,163 × Q × ΔT · LMTD = (ΔT_a − ΔT_b) / ln(ΔT_a / ΔT_b) · A = P / (U × LMTD) · U platenwisselaar water/water ±3.000 tot 5.000 W/(m²·K), buizenwisselaar ±1.000',
                    velden: [
                        { k: 'T1i', label: 'Primair in', eh: '°C', std: 70 },
                        { k: 'T1u', label: 'Primair uit', eh: '°C', std: 50 },
                        { k: 'T2i', label: 'Secundair in', eh: '°C', std: 40 },
                        { k: 'T2u', label: 'Secundair uit', eh: '°C', std: 60 },
                        { k: 'P', label: 'Vermogen', eh: 'kW', ehs: ['kW', 'W'], opt: true, min: 0 },
                        { k: 'Q2', label: 'of debiet secundair', eh: 'l/h', ehs: ['l/h', 'm³/h', 'l/min'], opt: true, min: 0 },
                        { k: 'stroom', label: 'Stroming', type: 'keuze', opties: [{ v: 'tegen', t: 'Tegenstroom (gangbaar)' }, { v: 'gelijk', t: 'Gelijkstroom' }], std: 'tegen' },
                        { k: 'U', label: 'Warmtedoorgang U', eh: 'W/(m²·K)', std: 3500, min: 10, snel: [{ t: 'Platen 3.500', v: 3500 }, { t: 'Buizen 1.000', v: 1000 }, { t: 'Spiraal in boiler 600', v: 600 }] }
                    ],
                    bereken: function (v, h) {
                        var d1 = v.T1i - v.T1u, d2 = v.T2u - v.T2i;
                        if (!(d1 > 0) || !(d2 > 0)) return { fout: 'Het primaire water moet afkoelen en het secundaire water moet opwarmen' };
                        var a = v.stroom === 'gelijk' ? v.T1i - v.T2i : v.T1i - v.T2u, b = v.stroom === 'gelijk' ? v.T1u - v.T2u : v.T1u - v.T2i;
                        if (!(a > 0) || !(b > 0)) return { fout: 'Deze temperaturen kruisen elkaar: de warme kant moet overal warmer zijn dan de koude kant' };
                        var lmtd = Math.abs(a - b) < 1e-9 ? a : (a - b) / Math.log(a / b);
                        var uit = [h.uit('Gemiddeld temperatuurverschil (LMTD)', lmtd, 'K', { dec: 1, hoofd: true })], st = ['LMTD = (' + h.fmt(a, 1) + ' − ' + h.fmt(b, 1) + ') / ln(' + h.fmt(a, 1) + ' / ' + h.fmt(b, 1) + ') = ' + h.f(lmtd, 1, 'K')];
                        var P = v.P != null ? v.P : (v.Q2 != null ? W.wh_l_K * v.Q2 * d2 / 1000 : null);
                        if (P != null) {
                            var A = P * 1000 / (v.U * lmtd);
                            uit.push(h.uit('Vermogen', P, 'kW', { dec: 1, hoofd: v.P == null }), h.uit('Debiet primair', P * 1000 / (W.wh_l_K * d1), 'l/h', { dec: 0 }), h.uit('Debiet secundair', P * 1000 / (W.wh_l_K * d2), 'l/h', { dec: 0 }), h.uit('Nodig oppervlak', A, 'm²', { dec: 2, hoofd: true }));
                            st.push('A = ' + h.f(P * 1000, 0) + ' W / (' + h.f(v.U, 0) + ' × ' + h.fmt(lmtd, 1) + ') = ' + h.f(A, 2, 'm²'));
                        }
                        return { uit: uit, stappen: st, opm: 'Richtwaarde voor een eerste keuze. De leverancier kiest de wisselaar met zijn eigen software, op drukverlies en vervuiling.' };
                    }
                },
                {
                    id: 'verw.leidingverlies', naam: 'Warmteverlies van een leiding', kort: 'Watt per meter met en zonder isolatie, en wat isoleren opbrengt',
                    zoek: 'warmteverlies leiding isolatie leidingisolatie buisisolatie w/m dikte besparing kelder stookplaats onverwarmde ruimte', soort: 'indicatief',
                    bron: 'Geïsoleerd: q = ΔT / (ln(D_iso / D) / (2π × λ) + 1 / (h × π × D_iso)) · blank: q = h × π × D × ΔT · h = 10 W/(m²·K) blank en 9 met isolatie · EPB-installatie-eisen (Energiebesluit bijlage XII, punt 7.1.2): kleinste lineaire warmteweerstand per diameter, met h = 8 in een technisch lokaal en 25 buiten',
                    uitleg: 'Een blanke leiding in de kelder verwarmt de kelder. De EPB-eis geldt bij renovatie voor circulatieleidingen en combilussen; voor andere leidingen is ze een aanbeveling. Leidingen tot 20 mm buitendiameter zijn vrijgesteld.',
                    velden: [
                        { k: 'D', label: 'Buitendiameter van de buis', eh: 'mm', std: 22, min: 5, snel: [{ t: '15', v: 15 }, { t: '22', v: 22 }, { t: '28', v: 28 }, { t: '35', v: 35 }, { t: '42', v: 42 }, { t: '54', v: 54 }, { t: '2": 60', v: 60.3 }] },
                        { k: 'Tw', label: 'Watertemperatuur', eh: '°C', std: 60 },
                        { k: 'Ta', label: 'Omgevingstemperatuur', eh: '°C', std: 12 },
                        { k: 'L', label: 'Lengte', eh: 'm', std: 10, min: 0 },
                        { k: 's', label: 'Dikte van de isolatie', eh: 'mm', std: 20, min: 0, snel: [{ t: 'Geen 0', v: 0 }, { t: '9', v: 9 }, { t: '13', v: 13 }, { t: '20', v: 20 }, { t: '30', v: 30 }, { t: '40', v: 40 }] },
                        { k: 'lam', label: 'λ van de isolatie', eh: 'W/(m·K)', std: 0.035, min: 0.01, max: 0.1, snel: [{ t: 'Rubber 0,036', v: 0.036 }, { t: 'PE-schuim 0,040', v: 0.04 }, { t: 'Minerale wol 0,035', v: 0.035 }, { t: 'PIR 0,025', v: 0.025 }] },
                        { k: 'uren', label: 'Uren per jaar warm', eh: 'h', std: 5000, min: 0, max: 8760 },
                        { k: 'prijs', label: 'Prijs van de warmte', eh: '€/kWh', std: 0.1, min: 0 },
                        { k: 'omg', label: 'Waar ligt de leiding? (voor de EPB-eis)', type: 'keuze', opties: [{ v: 'II', t: 'Technisch lokaal, koker, opbouw of verlaagd plafond' }, { v: 'I', t: 'Buiten, in de grond, in de vloer of in een onverwarmde ruimte' }, { v: 'III', t: 'Zichtbaar in een verwarmde ruimte (geen eis)' }], std: 'II' }
                    ],
                    bereken: function (v, h) {
                        if (!(v.Tw > v.Ta)) return { fout: 'Het water moet warmer zijn dan de omgeving. Voor koude leidingen: zie “Dauwpunt en condensatie”.' };
                        var epb = null;
                        if (v.omg !== 'III' && v.D > 20) {
                            var hh = v.omg === 'I' ? 25 : 8, eis = h.interp(v.D, EPB_ISO.d, EPB_ISO[(v.Tw > 55 ? 'II' : 'I') + '-' + v.omg]), heeft = v.s > 0 ? rLineair(v.D, v.s, v.lam, hh) : 1 / (hh * Math.PI * v.D / 1000), nodig = null;
                            for (var mm = 1; mm <= 300; mm++) if (rLineair(v.D, mm, v.lam, hh) >= eis) { nodig = mm; break; }
                            epb = { eis: eis, heeft: heeft, nodig: nodig, hh: hh };
                        }
                        var dT = v.Tw - v.Ta, D = v.D / 1000, q0 = 10 * Math.PI * D * dT, Di = D + 2 * v.s / 1000;
                        var q = v.s > 0 ? dT / (Math.log(Di / D) / (2 * Math.PI * v.lam) + 1 / (9 * Math.PI * Di)) : q0;
                        var E0 = q0 * v.L * v.uren / 1000, E = q * v.L * v.uren / 1000;
                        var rijen = [0, 9, 13, 20, 30, 40, 50].map(function (s) { var di = D + 2 * s / 1000, qq = s > 0 ? dT / (Math.log(di / D) / (2 * Math.PI * v.lam) + 1 / (9 * Math.PI * di)) : q0; return [s ? s + ' mm' : 'blank', h.fmt(qq, 1) + ' W/m', h.fmt(qq * v.L * v.uren / 1000, 0) + ' kWh', '€ ' + h.fmt(qq * v.L * v.uren / 1000 * v.prijs, 0)]; });
                        var uit = [h.uit('Verlies per meter', q, 'W/m', { dec: 1, hoofd: true }), h.uit('Verlies over de lengte', q * v.L, 'W', { dec: 0 }), h.uit('Per jaar', E, 'kWh', { dec: 0, hoofd: true, opm: '€ ' + h.fmt(E * v.prijs, 0) }), h.uit('Blanke leiding', q0, 'W/m', { dec: 1, opm: h.fmt(E0, 0) + ' kWh per jaar' }), h.uit('Isolatie bespaart', E0 - E, 'kWh', { dec: 0, kleur: 'groen', opm: '€ ' + h.fmt((E0 - E) * v.prijs, 0) + ' per jaar, ' + h.fmt(q0 > 0 ? (1 - q / q0) * 100 : 0, 0) + ' %' })];
                        var st = ['Blank: q = 10 × π × ' + h.fmt(D, 3) + ' × ' + h.f(dT, 0) + ' = ' + h.f(q0, 1, 'W/m'), 'Geïsoleerd: q = ' + h.f(dT, 0) + ' / (ln(' + h.fmt(Di * 1000, 0) + ' / ' + h.f(v.D, 0) + ') / (2π × ' + h.fmt(v.lam, 3) + ') + 1 / (9 × π × ' + h.fmt(Di, 3) + ')) = ' + h.f(q, 1, 'W/m')];
                        var waarsch = [];
                        if (epb) {
                            var ok = epb.heeft >= epb.eis - 1e-9;
                            uit.push(h.uit('EPB-eis voor een circulatieleiding', epb.eis, 'm·K/W', { dec: 2, opm: 'regime ' + (v.Tw > 55 ? 'boven' : 'tot') + ' 55 °C' }), h.uit('Deze isolatie haalt', epb.heeft, 'm·K/W', { dec: 2, kleur: ok ? 'groen' : 'rood', opm: ok ? 'voldoet' : (epb.nodig ? 'voldoet niet: minstens ' + epb.nodig + ' mm nodig bij deze λ' : 'voldoet niet') }));
                            st.push('EPB: R = ln(' + h.fmt(Di * 1000, 0) + ' / ' + h.f(v.D, 0) + ') / (2π × ' + h.fmt(v.lam, 3) + ') + 1 / (' + epb.hh + ' × π × ' + h.fmt(Di, 3) + ') = ' + h.f(epb.heeft, 2, 'm·K/W') + ', nodig ' + h.fmt(epb.eis, 2));
                            if (!ok) waarsch.push('Voor een circulatieleiding of combilus bij een renovatie volstaat deze isolatie niet voor de EPB-eis. Voor gewone leidingen is de eis een aanbeveling.');
                        } else if (v.omg !== 'III') uit.push(h.uit('EPB-eis voor een circulatieleiding', 'geen eis tot 20 mm buitendiameter', ''));
                        return {
                            uit: uit, stappen: st, waarsch: waarsch,
                            tabel: { kop: ['Isolatie', 'Verlies', 'Per jaar', 'Kost'], rijen: rijen, kies: [0, 9, 13, 20, 30, 40, 50].indexOf(v.s) },
                            opm: 'Isoleer ook de afsluiters, de pomp en de verdeler: één blanke afsluiter verliest evenveel als een meter blanke buis. Bij koud water en koelleidingen moet de isolatie dampdicht zijn.'
                        };
                    }
                }
            ] },
            { naam: 'Ketel en stookplaats', items: [
                {
                    id: 'verw.cascade', naam: 'Ketelcascade', kort: 'Aantal ketels, regelbereik en wat er overblijft als één ketel uitvalt',
                    zoek: 'cascade ketels stookplaats aantal ketels modulatie regelbereik reserve uitval appartementsgebouw school collectief', soort: 'exact',
                    bron: 'Aantal = warmtevraag / vermogen per ketel, naar boven afgerond · kleinste vermogen = één ketel op zijn laagste modulatie · dekking bij uitval = (n − 1) × vermogen / warmtevraag',
                    velden: [
                        { k: 'Qd', label: 'Warmtevraag van het gebouw', eh: 'kW', min: 0 },
                        { k: 'Pk', label: 'Vermogen per ketel', eh: 'kW', std: 100, min: 1, snel: [{ t: '45', v: 45 }, { t: '60', v: 60 }, { t: '80', v: 80 }, { t: '100', v: 100 }, { t: '150', v: 150 }] },
                        { k: 'n', label: 'Aantal ketels', opt: true, min: 1, max: 16, hint: 'leeg = het kleinste aantal dat volstaat' },
                        { k: 'mod', label: 'Laagste modulatie van één ketel', eh: '%', std: 20, min: 5, max: 100 },
                        { k: 'dT', label: 'ΔT over de ketels', eh: 'K', std: 20, min: 1 }
                    ],
                    bereken: function (v, h) {
                        if (!(v.Qd > 0)) return { fout: 'De warmtevraag moet groter zijn dan 0' };
                        var n = v.n != null ? Math.round(v.n) : Math.max(1, Math.ceil(v.Qd / v.Pk - 1e-9)), Pt = n * v.Pk, Pmin = v.Pk * v.mod / 100;
                        var uitval = n > 1 ? (n - 1) * v.Pk / v.Qd * 100 : 0, waarsch = [];
                        if (Pt < v.Qd) waarsch.push('Met ' + n + ' ketels van ' + h.fmt(v.Pk, 0) + ' kW kom je ' + h.fmt(v.Qd - Pt, 0) + ' kW tekort.');
                        if (n === 1) waarsch.push('Met één ketel is er geen reserve: bij een storing staat het hele gebouw zonder verwarming.');
                        if (Pt > v.Qd * 1.5) waarsch.push('De cascade is ruim overbemeten (' + h.fmt(Pt / v.Qd * 100, 0) + ' % van de vraag): meer stilstandsverlies en meer pendelen.');
                        return {
                            uit: [h.uit('Aantal ketels', n, '', { hoofd: true, opm: n + ' × ' + h.fmt(v.Pk, 0) + ' kW' }), h.uit('Totaal vermogen', Pt, 'kW', { dec: 0, hoofd: true, opm: h.fmt(Pt / v.Qd * 100, 0) + ' % van de warmtevraag' }), h.uit('Kleinste vermogen van de cascade', Pmin, 'kW', { dec: 1, opm: 'regelbereik 1 op ' + h.fmt(Pt / Pmin, 0) }), h.uit('Dekking als één ketel uitvalt', uitval, '%', { dec: 0, kleur: uitval >= 70 ? 'groen' : uitval >= 50 ? 'amber' : 'rood' }), h.uit('Debiet per ketel', v.Pk / (W.wh_l_K * v.dT), 'm³/h', { dec: 2 }), h.uit('Debiet van de cascade', Pt / (W.wh_l_K * v.dT), 'm³/h', { dec: 2 })],
                            stappen: ['n = ' + h.f(v.Qd, 0) + ' / ' + h.f(v.Pk, 0) + ' = ' + h.fmt(v.Qd / v.Pk, 2) + ' → ' + n + ' ketels', 'P_min = ' + h.f(v.Pk, 0) + ' × ' + h.f(v.mod, 0) + ' % = ' + h.f(Pmin, 1, 'kW')],
                            waarsch: waarsch,
                            opm: 'Bij 70 % van het vermogen blijft een gebouw in het Belgische klimaat bijna de hele winter warm. Zie ook “Evenwichtsfles en open verdeler” en “Verbrandingslucht en stookplaatsventilatie”.'
                        };
                    }
                },
                {
                    id: 'verw.condens', naam: 'Condensaat van een condensatieketel', kort: 'Hoeveel condenswater, en moet het geneutraliseerd worden?',
                    zoek: 'condensaat condenswater condensatieketel neutralisatie neutralisatiebox ph zuur afvoer hr ketel dwa a 251 granulaat condenspomp', soort: 'indicatief',
                    bron: 'Hoeveelheid: aardgas ±0,14 l/kWh, propaan ±0,11 l/kWh, stookolie ±0,08 l/kWh · pH: gas 3,7 tot 5,4, stookolie 1,8 tot 3,7 · neutralisatie: Duits werkblad DWA-A 251 (verdunning met 25 keer zoveel huishoudelijk afvalwater; bij 200 kW minstens 8 woningen of 80 kantoormedewerkers) · België heeft geen eigen regel, Buildwise raadt neutraliseren aan',
                    uitleg: 'De berekening geeft de grootste hoeveelheid, bij een lage retourtemperatuur. Hoe warmer de retour, hoe minder condensaat: boven ±57 °C (aardgas) of ±47 °C (stookolie) condenseert de ketel niet meer.',
                    velden: [
                        { k: 'br', label: 'Brandstof', type: 'keuze', opties: CONDENS.map(function (x) { return { v: x.v, t: x.t }; }), std: 'gas' },
                        { k: 'P', label: 'Vermogen van de ketel', eh: 'kW', min: 0 },
                        { k: 'uren', label: 'Vollasturen per jaar', eh: 'h', std: 1800, min: 0, snel: [{ t: 'Woning 1.800', v: 1800 }, { t: 'Met warm water 2.100', v: 2100 }, { t: 'Kantoor 1.500', v: 1500 }] },
                        { k: 'gebouw', label: 'Wat loost op dezelfde afvoer?', type: 'keuze', opties: [{ v: 'won', t: 'Woningen' }, { v: 'kant', t: 'Kantoor (medewerkers)' }], std: 'won' },
                        { k: 'n', label: 'Aantal woningen of medewerkers', std: 1, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var B = CONDENS.filter(function (x) { return x.v === v.br; })[0] || CONDENS[0];
                        if (!(v.P > 0)) return { fout: 'Het vermogen moet groter zijn dan 0' };
                        var lh = v.P * B.c, jaar = lh * v.uren, nodig = Math.ceil(v.P / 25 - 1e-9) * (v.gebouw === 'kant' ? 10 : 1);
                        var advies, kleur, waarsch = [], vast = v.P > 200 || !!B.altijd;
                        if (v.P > 200) { advies = 'neutraliseren'; kleur = 'rood'; waarsch.push('Boven 200 kW wordt het condensaat altijd geneutraliseerd.'); }
                        else if (B.altijd) { advies = 'neutraliseren'; kleur = 'rood'; waarsch.push('Condensaat van gewone stookolie wordt altijd geneutraliseerd.'); }
                        else if (v.n >= nodig) { advies = 'niet nodig als het condensaat met het afvalwater mengt'; kleur = 'groen'; }
                        else { advies = 'neutraliseren: te weinig afvalwater om te verdunnen'; kleur = 'amber'; }
                        var uit = [h.uit('Condensaat bij vollast', lh, 'l/h', { dec: 1, hoofd: true }), h.uit('Condensaat per jaar', jaar, 'l', { dec: 0, hoofd: true, opm: h.fmt(jaar / 1000, 1) + ' m³' }), h.uit('Neutralisatie', advies, '', { hoofd: true, kleur: kleur })];
                        if (!vast) uit.push(h.uit('Nodig om te verdunnen', nodig, v.gebouw === 'kant' ? 'medewerkers' : nodig === 1 ? 'woning' : 'woningen', { dec: 0, opm: v.gebouw === 'kant' ? '10 medewerkers per 25 kW' : '1 woning per 25 kW' }));
                        uit.push(h.uit('Zuurtegraad van het condensaat', B.ph, ''));
                        return {
                            uit: uit,
                            stappen: ['Vollast: ' + h.f(v.P, 1) + ' kW × ' + h.fmt(B.c, 2) + ' l/kWh = ' + h.f(lh, 1, 'l/h'), 'Per jaar: ' + h.fmt(lh, 1) + ' × ' + h.f(v.uren, 0) + ' h = ' + h.f(jaar, 0, 'l')],
                            waarsch: waarsch,
                            opm: 'Voer condensaat af in kunststof (PVC, PP of PE) of roestvast staal, met afschot en een sifon, en nooit in koper of verzinkt staal. Neutraliseren is het condensaat boven pH 6,5 brengen: controleer het granulaat bij elk onderhoud. Altijd neutraliseren bij lozing in een septische put of een kleine waterzuivering. De rioolbeheerder en de ketelfabrikant kunnen strenger zijn.'
                        };
                    }
                },
                {
                    id: 'verw.onderhoud', naam: 'Onderhoud en keuring: termijnen', kort: 'Naslag: hoe vaak moet een ketel onderhouden worden en wat wordt er gemeten?',
                    zoek: 'onderhoud keuring termijn verplicht ketel gas stookolie tweejaarlijks jaarlijks attest verbrandingsattest reinigingsattest vlaanderen brussel wallonie audit naslag', soort: 'naslag',
                    bron: 'Besluit van de Vlaamse Regering van 8 december 2006 over het onderhoud en het nazicht van centrale stooktoestellen (versie van 29 september 2026), leefmilieu.brussels en energie.wallonie.be',
                    velden: [],
                    bereken: function () {
                        return {
                            tabel: { kop: ['Vlaanderen', 'Hoe vaak', 'Door wie'], rijen: [
                                ['Gasketel vanaf 20 kW', 'om de 2 jaar', 'erkend technicus gasvormige brandstof'],
                                ['Stookolieketel vanaf 20 kW', 'elk jaar', 'erkend technicus vloeibare brandstof'],
                                ['Ketel op hout, pellets of kolen', 'elk jaar', 'geschoold vakman'],
                                ['Nieuwe of vervangen ketel of brander', 'keuring vóór de ingebruikname', 'erkend technicus'],
                                ['Airco met meer dan 70 kW koelvermogen', 'keuring om de 5 jaar', 'erkend airco-energiedeskundige']
                            ] },
                            tabel2: { kop: ['Meting bij het onderhoud', 'Gas', 'Stookolie'], rijen: [
                                ['Verbrandingsrendement', 'minstens 90 %, type B1 88 %', 'minstens 90 %'],
                                ['CO bij 0 % O₂', 'hoogstens 150 mg/kWh', 'hoogstens 150 mg/kWh'],
                                ['Rookindex', 'niet van toepassing', 'hoogstens 1'],
                                ['Trek bij natuurlijke trek', 'minstens 3 Pa onderdruk', 'minstens 5 Pa onderdruk'],
                                ['Brussel', 'om de 2 jaar', 'elk jaar'],
                                ['Wallonië', 'om de 3 jaar tot 100 kW, om de 2 jaar daarboven', 'elk jaar']
                            ] },
                            opm: 'De termijn mag drie maanden uitlopen zonder dat de volgende datum verschuift. De technicus meldt elke keuring en elk onderhoud binnen 30 dagen in de databank van het VEKA. Tekortkomingen moeten binnen drie maanden weggewerkt zijn. De verwarmingsaudit is sinds 1 juli 2024 afgeschaft.'
                        };
                    }
                }
            ] },
            { naam: 'Gas en stookolie', items: [
                {
                    id: 'verw.gas', naam: 'Gas: kW ↔ m³/h en gasmeter', kort: 'Gasdebiet uit de belasting en de juiste meter (G4, G6…)',
                    zoek: 'gas gasdebiet m3/h kw belasting calorische waarde bovenwaarde onderwaarde gasmeter g4 g6 g10 propaan verbruik', soort: 'exact',
                    bron: 'Q = P_belasting / H_i · aardgas H: H_s 11,6 / H_i 10,5 kWh/m³ · L: 9,8 / 8,8 · propaan 12,8 kWh/kg · meters: G4 max 6 m³/h, G6 10, G10 16, G16 25, G25 40',
                    uitleg: 'De ketel vermeldt de nominale belasting (Hi of Hs). Nuttig vermogen / rendement = belasting. Voor de meter telt de som van alle toestellen.',
                    velden: [
                        { k: 'gas', label: 'Gassoort', type: 'keuze', opties: Object.keys(GASSEN).map(function (k) { return { v: k, t: GASSEN[k].naam }; }), std: 'H' },
                        { k: 'P', label: 'Nominale belasting (Hi)', eh: 'kW', opt: true, snel: [{ t: '24', v: 24 }, { t: '30', v: 30 }, { t: '35', v: 35 }, { t: '45', v: 45 }, { t: '65', v: 65 }] },
                        { k: 'Pn', label: 'of nuttig vermogen', eh: 'kW', opt: true },
                        { k: 'eta', label: 'Rendement (bij nuttig vermogen)', std: 0.97, min: 0.5, max: 1.11 },
                        { k: 'Pextra', label: 'Andere gastoestellen samen (fornuis, geiser…)', eh: 'kW', std: 0 },
                        { k: 'uren', label: 'Vollasturen per jaar (optioneel)', eh: 'h', opt: true, snel: [{ t: '1.200', v: 1200 }, { t: '1.500', v: 1500 }, { t: '1.800', v: 1800 }] }
                    ],
                    bereken: function (v, h) {
                        var g = GASSEN[v.gas], P = v.P != null ? v.P : (v.Pn != null ? v.Pn / v.eta : null);
                        if (P == null) return { wacht: true, ontbreekt: ['belasting of nuttig vermogen'] };
                        var Hi = g.HiGas || g.Hi, Q = P / Hi, Qtot = (P + v.Pextra) / Hi;
                        var meter = METERS.filter(function (m) { return m.max >= Qtot; })[0];
                        var uit = [h.uit('Gasdebiet ketel', Q, g.HiGas ? 'm³/h' : 'm³/h', { dec: 2, hoofd: true }), h.uit('Debiet alle toestellen', Qtot, 'm³/h', { dec: 2 }), h.uit('Gasmeter', meter ? meter.n + ' (max ' + meter.max + ' m³/h)' : 'industriële meter', '', { hoofd: true })];
                        var st = ['Q = ' + h.f(P, 1) + ' kW / ' + h.fmt(Hi, 1) + ' kWh/m³ = ' + h.f(Q, 2, 'm³/h')];
                        if (g.kgl) { uit.push(h.uit('Massadebiet', P / g.Hi, 'kg/h', { dec: 2 }), h.uit('Vloeibaar', P / g.Hi / g.kgl, 'l/h', { dec: 2 })); }
                        if (v.uren != null) { var jaar = Q * v.uren; uit.push(h.uit('Jaarverbruik bij ' + h.fmt(v.uren) + ' vollasturen', jaar, 'm³', { dec: 0, opm: h.fmt(jaar * (g.Hs || g.HiGas), 0) + ' kWh (Hs)' })); }
                        return { uit: uit, stappen: st, opm: 'De factuur rekent in kWh bovenwaarde (Hs): 1 m³ H-gas ≈ ' + g.Hs + ' kWh.' };
                    }
                },
                {
                    id: 'verw.gasleiding', naam: 'Gasleiding dimensioneren', kort: 'Diameter bij een maximaal drukverlies (NBN D 51-003)',
                    zoek: 'gasleiding diameter dimensioneren drukverlies mbar renouard staal koper pe meerlagen gas 1 mbar', soort: 'indicatief',
                    bron: 'Formule van Renouard (lage druk): Δp [mbar] = 23 200 × d_r × L × Q^1,82 / D^4,82 (L in m, Q in m³/h, D in mm); NBN D 51-003: max. 1 mbar drukverlies tussen meter en toestel bij aardgas 20/25 mbar; snelheid ≤ 6 m/s',
                    velden: [
                        { k: 'gas', label: 'Gas', type: 'keuze', opties: [{ v: 'H', t: 'Aardgas H (d 0,6)' }, { v: 'L', t: 'Aardgas L (d 0,64)' }, { v: 'propaan', t: 'Propaan gasfase 37 mbar (d 1,55)' }], std: 'H' },
                        { k: 'P', label: 'Belasting van de toestellen op deze leiding', eh: 'kW', opt: true },
                        { k: 'Q', label: 'of gasdebiet', eh: 'm³/h', opt: true },
                        { k: 'L', label: 'Leidinglengte', eh: 'm' },
                        { k: 'toe', label: 'Toeslag bochten, kranen, T-stukken', eh: '%', std: 20 },
                        { k: 'dpmax', label: 'Toegelaten drukverlies', eh: 'mbar', std: 1, snel: [{ t: 'Aardgas 1,0', v: 1 }, { t: 'Deel van het net 0,5', v: 0.5 }, { t: 'Propaan 2,5', v: 2.5 }] },
                        { k: 'mat', label: 'Materiaal', type: 'keuze', opties: [{ v: 'staal', t: 'Staal draadbuis' }, { v: 'koper', t: 'Koper' }, { v: 'meerlagen', t: 'Meerlagen (gas-gekeurd)' }, { v: 'pe', t: 'PE (ondergronds)' }], std: 'staal' }
                    ],
                    bereken: function (v, h) {
                        var g = GASSEN[v.gas], Hi = g.HiGas || g.Hi;
                        var Q = v.Q != null ? v.Q : (v.P != null ? v.P / Hi : null);
                        if (Q == null) return { wacht: true, ontbreekt: ['belasting of debiet'] };
                        var Leq = v.L * (1 + v.toe / 100), mat = BUIZEN[v.mat], keus = null, rijen = [];
                        mat.maten.forEach(function (m) {
                            var dp = 23200 * g.dr * Leq * Math.pow(Q, 1.82) / Math.pow(m.d, 4.82);
                            var vel = Q / 3600 / (Math.PI * Math.pow(m.d / 1000, 2) / 4);
                            var ok = dp <= v.dpmax && vel <= 6;
                            if (ok && !keus) keus = { m: m, dp: dp, vel: vel };
                            rijen.push([m.n + ' (' + h.fmt(m.d, 1) + ' mm)', h.fmt(dp, 2) + ' mbar', h.fmt(vel, 1) + ' m/s', ok ? (keus && keus.m === m ? '✓ kleinste' : '✓') : dp > v.dpmax ? 'te veel drukverlies' : 'te snel']);
                        });
                        if (!keus) return { fout: 'Geen maat in de lijst voldoet: kortere leiding of hogere druk', tabel: { kop: ['Maat', 'Δp', 'Snelheid', ''], rijen: rijen } };
                        return {
                            uit: [h.uit('Leiding', keus.m.n + ' ' + mat.naam.split(' (')[0], '', { hoofd: true }), h.uit('Drukverlies', keus.dp, 'mbar', { dec: 2 }), h.uit('Gassnelheid', keus.vel, 'm/s', { dec: 1 }), h.uit('Gasdebiet', Q, 'm³/h', { dec: 2 }), h.uit('Equivalente lengte', Leq, 'm', { dec: 0 })],
                            stappen: ['Δp = 23 200 × ' + g.dr + ' × ' + h.fmt(Leq, 1) + ' × ' + h.fmt(Q, 2) + '^1,82 / ' + h.fmt(keus.m.d, 1) + '^4,82 = ' + h.f(keus.dp, 2, 'mbar')],
                            tabel: { kop: ['Maat', 'Δp', 'Snelheid', ''], rijen: rijen },
                            opm: 'Het totale drukverlies van meter tot elk toestel (alle deeltrajecten samen) mag 1 mbar niet overschrijden; de tabellen van NBN D 51-003 gaan voor.'
                        };
                    }
                },
                {
                    id: 'verw.stookolie', naam: 'Stookolie: verstuiver, verbruik en tank', kort: 'l/h en kW uit gph en pompdruk, jaarverbruik, autonomie',
                    zoek: 'stookolie mazout verstuiver nozzle gph pompdruk verbruik liter per uur tank autonomie brander', soort: 'exact',
                    bron: 'Q [l/h] = gph × 3,785 × √(p / 7 bar) (verstuivers zijn geijkt bij 7 bar, 100 psi) · 1 l stookolie = 10 kWh (Hi 35,9 MJ/l) · belasting = Q × 10 kWh/l',
                    velden: [
                        { k: 'gph', label: 'Verstuiver', eh: 'gph', std: 0.5, snel: [{ t: '0,40', v: 0.4 }, { t: '0,50', v: 0.5 }, { t: '0,60', v: 0.6 }, { t: '0,75', v: 0.75 }, { t: '1,00', v: 1 }, { t: '1,25', v: 1.25 }] },
                        { k: 'p', label: 'Pompdruk', eh: 'bar', std: 10, snel: [{ t: '7', v: 7 }, { t: '10', v: 10 }, { t: '12', v: 12 }, { t: '14', v: 14 }] },
                        { k: 'eta', label: 'Ketelrendement', std: 0.92, min: 0.5, max: 1.05 },
                        { k: 'uren', label: 'Branderuren per jaar', eh: 'h', std: 1500 },
                        { k: 'tank', label: 'Tankinhoud', eh: 'l', opt: true, snel: [{ t: '1.200', v: 1200 }, { t: '2.000', v: 2000 }, { t: '3.000', v: 3000 }, { t: '5.000', v: 5000 }] },
                        { k: 'prijs', label: 'Stookolieprijs', eh: '€/l', std: 1 }
                    ],
                    bereken: function (v, h) {
                        var Q = v.gph * 3.785 * Math.sqrt(v.p / 7), Pb = Q * 10, Pn = Pb * v.eta, jaar = Q * v.uren;
                        var uit = [h.uit('Verbruik brander', Q, 'l/h', { dec: 2, hoofd: true }), h.uit('Belasting', Pb, 'kW', { dec: 1 }), h.uit('Nuttig vermogen', Pn, 'kW', { dec: 1, hoofd: true }), h.uit('Jaarverbruik bij ' + h.fmt(v.uren) + ' branderuren', jaar, 'l', { dec: 0, opm: '€ ' + h.fmt(jaar * v.prijs, 0) })];
                        if (v.tank != null) uit.push(h.uit('Tank goed voor', v.tank / Q, 'branderuren', { dec: 0, opm: '≈ ' + h.fmt(v.tank / jaar * 12, 1) + ' maanden bij dit jaarverbruik' }));
                        return { uit: uit, stappen: ['Q = ' + h.f(v.gph, 2) + ' × 3,785 × √(' + h.f(v.p) + '/7) = ' + h.f(Q, 2, 'l/h'), 'Belasting = ' + h.fmt(Q, 2) + ' × 10 kWh/l = ' + h.f(Pb, 1, 'kW'), 'Nuttig = ' + h.fmt(Pb, 1) + ' × ' + h.f(v.eta) + ' = ' + h.f(Pn, 1, 'kW')] };
                    }
                },
                {
                    id: 'verw.tank', naam: 'Inhoud tank of put (peilstok)', kort: 'Liggende of staande cilinder en rechthoek, ook bij een vulhoogte',
                    zoek: 'tank inhoud peilstok liggende cilinder staande cilinder rechthoek liter vulhoogte stookolietank regenwaterput', soort: 'exact',
                    bron: 'Liggende cilinder deels gevuld: V = L × [r² × acos((r − h)/r) − (r − h) × √(2rh − h²)]',
                    velden: [
                        { k: 'vorm', label: 'Vorm', type: 'keuze', opties: [{ v: 'lig', t: 'Liggende cilinder' }, { v: 'sta', t: 'Staande cilinder' }, { v: 'rect', t: 'Rechthoekig' }] },
                        { k: 'D', label: 'Diameter (of breedte bij rechthoek)', eh: 'mm', ehs: ['mm', 'cm', 'm'] },
                        { k: 'L', label: 'Lengte (of diepte bij rechthoek)', eh: 'mm', ehs: ['mm', 'cm', 'm'] },
                        { k: 'H', label: 'Hoogte (staande cilinder of rechthoek)', eh: 'mm', ehs: ['mm', 'cm', 'm'], opt: true },
                        { k: 'h', label: 'Vulhoogte gemeten (optioneel)', eh: 'mm', ehs: ['mm', 'cm', 'm'], opt: true }
                    ],
                    bereken: function (v, h) {
                        var D = v.D / 1000, L = v.L / 1000, H = v.H != null ? v.H / 1000 : null, hh = v.h != null ? v.h / 1000 : null;
                        var Vt, Vh = null, st = [];
                        if (v.vorm === 'lig') {
                            var r = D / 2; Vt = Math.PI * r * r * L * 1000;
                            if (hh != null) { var x = Math.min(Math.max(hh, 0), D); Vh = L * (r * r * Math.acos((r - x) / r) - (r - x) * Math.sqrt(Math.max(0, 2 * r * x - x * x))) * 1000; st.push('V(h) = L × [r² × acos((r−h)/r) − (r−h) × √(2rh−h²)] = ' + h.f(Vh, 0, 'l')); }
                        } else if (v.vorm === 'sta') {
                            if (H == null) return { wacht: true, ontbreekt: ['hoogte'] };
                            Vt = Math.PI * D * D / 4 * H * 1000; if (hh != null) Vh = Vt * Math.min(hh, H) / H;
                        } else {
                            if (H == null) return { wacht: true, ontbreekt: ['hoogte'] };
                            Vt = D * L * H * 1000; if (hh != null) Vh = Vt * Math.min(hh, H) / H;
                        }
                        var uit = [h.uit('Totale inhoud', Vt, 'l', { dec: 0, hoofd: Vh == null })];
                        if (Vh != null) uit.unshift(h.uit('Inhoud bij vulhoogte', Vh, 'l', { dec: 0, hoofd: true, opm: h.fmt(Vh / Vt * 100, 0) + ' % gevuld' }), h.uit('Bij te vullen tot 90 %', Math.max(0, Vt * 0.9 - Vh), 'l', { dec: 0 }));
                        return { uit: uit, stappen: st };
                    }
                },
                {
                    id: 'verw.rookgas', naam: 'Rookgasanalyse en rendement', kort: 'Rendement, luchtovermaat en CO uit O₂, CO₂ en rookgastemperatuur',
                    zoek: 'rookgasanalyse rendement verbrandingsrendement siegert o2 co2 lambda luchtovermaat co ppm mg/kwh keuring stookolie gas', soort: 'indicatief',
                    bron: 'Siegert (bijlage II van het Vlaams besluit van 8/12/2006): verlies q_A = (T_rookgas − T_lucht) × (A₂ / (21 − O₂) + B) met aardgas 0,65 en 0,009 · propaan 0,63 en 0,008 · stookolie 0,68 en 0,007; λ = 21 / (21 − O₂); CO bij 0 % O₂ = CO × 21 / (21 − O₂). Eisen sinds 1/10/2019: CO hoogstens 150 mg/kWh, rendement minstens 90 % (gastoestel type B1: 88 %), stookolie rookindex hoogstens 1; trek bij natuurlijke trek minstens 5 Pa (stookolie) of 3 Pa (gas)',
                    velden: [
                        { k: 'brand', label: 'Brandstof', type: 'keuze', opties: [{ v: 'gas', t: 'Aardgas' }, { v: 'olie', t: 'Stookolie' }, { v: 'propaan', t: 'Propaan' }, { v: 'hout', t: 'Hout / pellets' }] },
                        { k: 'O2', label: 'O₂ in de rookgassen', eh: '%', opt: true, min: 0, max: 20.9 },
                        { k: 'CO2', label: 'of CO₂', eh: '%', opt: true, min: 0, max: 21 },
                        { k: 'Tg', label: 'Rookgastemperatuur', eh: '°C', std: 60 },
                        { k: 'Ta', label: 'Verbrandingsluchttemperatuur', eh: '°C', std: 20 },
                        { k: 'CO', label: 'CO gemeten (verdund)', eh: 'ppm', opt: true },
                        { k: 'b1', label: 'Gastoestel type B1 (atmosferisch, met trekonderbreker)', type: 'vink', std: false },
                        { k: 'trek', label: 'Trek in de schouw (onderdruk, bij natuurlijke trek)', eh: 'Pa', opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var K = { gas: { A2: 0.65, B: 0.009, co2max: 11.9, mgkwh: 1.074 }, olie: { A2: 0.68, B: 0.007, co2max: 15.4, mgkwh: 1.101 }, propaan: { A2: 0.63, B: 0.008, co2max: 13.8, mgkwh: 1.091 }, hout: { A2: 0.65, B: 0, co2max: 20.3, mgkwh: 1.1 } }[v.brand];
                        var gasvormig = v.brand === 'gas' || v.brand === 'propaan', etaMin = v.brand === 'hout' ? null : (gasvormig && v.b1 ? 88 : 90);
                        var O2 = v.O2;
                        if (O2 == null && v.CO2 != null) O2 = 21 * (1 - v.CO2 / K.co2max);
                        if (O2 == null) return { wacht: true, ontbreekt: ['O₂ of CO₂'] };
                        if (O2 >= 21) return { fout: 'O₂ moet kleiner zijn dan 21 %' };
                        var CO2 = K.co2max * (1 - O2 / 21), lam = 21 / (21 - O2), qA = (v.Tg - v.Ta) * (K.A2 / (21 - O2) + K.B), eta = 100 - qA;
                        var uit = [h.uit('Verbrandingsrendement', eta, '%', { dec: 1, hoofd: true, kleur: etaMin == null ? '' : eta >= etaMin ? 'groen' : 'rood', opm: etaMin == null ? '' : 'minstens ' + etaMin + ' %' }), h.uit('Rookgasverlies', qA, '%', { dec: 1 }), h.uit('Luchtovermaat λ', lam, '', { dec: 2, kleur: lam > 1.6 ? 'amber' : '' }), h.uit('CO₂', CO2, '%', { dec: 1 }), h.uit('O₂', O2, '%', { dec: 1 })];
                        var st = ['λ = 21 / (21 − ' + h.fmt(O2, 1) + ') = ' + h.fmt(lam, 2), 'q_A = (' + h.f(v.Tg) + ' − ' + h.f(v.Ta) + ') × (' + h.fmt(K.A2, 2) + ' / (21 − ' + h.fmt(O2, 1) + ') + ' + h.fmt(K.B, 3) + ') = ' + h.f(qA, 1, '%')];
                        var waarsch = [];
                        if (v.CO != null) {
                            var COr = v.CO * 21 / (21 - O2), mg = COr * K.mgkwh, grens = 150;
                            uit.push(h.uit('CO onverdund (0 % O₂)', COr, 'ppm', { dec: 0 }), h.uit('≈ CO', mg, 'mg/kWh', { dec: 0, kleur: mg > grens ? 'rood' : 'groen', opm: 'grens ' + grens + ' mg/kWh' }));
                            st.push('CO_onverdund = ' + h.f(v.CO) + ' × 21 / (21 − ' + h.fmt(O2, 1) + ') = ' + h.f(COr, 0, 'ppm') + ' × ' + h.fmt(K.mgkwh, 3) + ' ≈ ' + h.f(mg, 0, 'mg/kWh'));
                            if (mg > grens) waarsch.push('CO boven de keuringsgrens: brander afstellen, luchttoevoer en warmtewisselaar nakijken.');
                        }
                        if (v.trek != null && v.brand !== 'hout') {
                            var nodig = v.brand === 'olie' ? 5 : 3;
                            uit.push(h.uit('Trek', v.trek, 'Pa', { dec: 1, kleur: v.trek >= nodig ? (gasvormig && v.trek < 5 ? 'amber' : 'groen') : 'rood', opm: 'minstens ' + nodig + ' Pa onderdruk' }));
                            if (v.trek < nodig) waarsch.push('Te weinig trek: de rookgassen worden niet vlot afgevoerd. Schouw, aansluiting en luchttoevoer nakijken.');
                            else if (gasvormig && v.trek < 5) waarsch.push('Trek tussen 3 en 5 Pa: in orde, maar het komt als opmerking op het attest.');
                        }
                        if (etaMin != null && eta < etaMin) waarsch.push('Rendement onder ' + etaMin + ' %: keuring niet in orde (rookgastemperatuur te hoog of te veel lucht).');
                        if (lam < 1.1) waarsch.push('Weinig luchtovermaat (λ < 1,1): risico op onvolledige verbranding en CO.');
                        return { uit: uit, stappen: st, waarsch: waarsch, opm: 'Het rendement uit een rookgasmeting is het verbrandingsrendement (zonder stilstands- en stralingsverlies); condensatiewinst zit er niet in.' };
                    }
                },
                {
                    id: 'verw.gasmeter_klok', naam: 'Belasting meten aan de gasmeter', kort: 'Hoeveel kW verbruikt de ketel echt? Klok het gasverbruik',
                    zoek: 'gasmeter klokken belasting meten gasverbruik liter seconden kw controleren afstellen branderdruk nominale belasting ketel', soort: 'exact',
                    bron: 'Q = volume / tijd · omrekenen naar 0 °C en 1.013 mbar: Q_n = Q × (1.013 + p) / 1.013 × 273 / (273 + T) · belasting = Q_n × H_i (aardgas H 10,5 · L 8,8 kWh/m³)',
                    uitleg: 'Zet alle andere gastoestellen uit en laat de ketel op vol vermogen branden (schoorsteenvegerstand). Meet de tijd voor een vast volume op de meter: bij een G4 is één toer van het laatste rolletje 10 liter.',
                    velden: [
                        { k: 'gas', label: 'Gas', type: 'keuze', opties: [{ v: 'H', t: 'Aardgas H (rijk gas)' }, { v: 'L', t: 'Aardgas L (arm gas)' }, { v: 'propaan', t: 'Propaan (gasfase)' }], std: 'H' },
                        { k: 'V', label: 'Gemeten volume', eh: 'l', ehs: ['l', 'm³'], std: 20, min: 0, snel: [{ t: '10', v: 10 }, { t: '20', v: 20 }, { t: '50', v: 50 }, { t: '100', v: 100 }] },
                        { k: 't', label: 'Gemeten tijd', eh: 's', ehs: ['s', 'min'], min: 0 },
                        { k: 'p', label: 'Gasdruk aan de meter', eh: 'mbar', std: 21, min: 0, snel: [{ t: 'H 21', v: 21 }, { t: 'L 25', v: 25 }, { t: 'Propaan 37', v: 37 }] },
                        { k: 'T', label: 'Temperatuur van het gas', eh: '°C', std: 15, min: -20, max: 50 },
                        { k: 'Pn', label: 'Nominale belasting volgens het kenplaatje', eh: 'kW', opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        if (!(v.t > 0)) return { fout: 'De tijd moet groter zijn dan 0' };
                        var g = GASSEN[v.gas], Hi = g.HiGas || g.Hi, Hs = Hi * g.Hs / g.Hi;
                        var Q = v.V / 1000 / v.t * 3600, f = (1013 + v.p) / 1013 * 273.15 / (273.15 + v.T), Qn = Q * f, P = Qn * Hi;
                        var uit = [h.uit('Belasting (onderwaarde)', P, 'kW', { dec: 1, hoofd: true }), h.uit('Belasting (bovenwaarde)', Qn * Hs, 'kW', { dec: 1 }), h.uit('Gasdebiet op de meter', Q, 'm³/h', { dec: 3 }), h.uit('Omgerekend naar normaal', Qn, 'm³/h', { dec: 3, opm: 'factor ' + h.fmt(f, 3) })];
                        var st = ['Q = ' + h.f(v.V, 1) + ' l / ' + h.f(v.t, 1) + ' s × 3,6 = ' + h.f(Q, 3, 'm³/h'), 'Factor = (1.013 + ' + h.f(v.p, 0) + ') / 1.013 × 273 / (273 + ' + h.f(v.T, 0) + ') = ' + h.fmt(f, 3), 'Belasting = ' + h.fmt(Qn, 3) + ' × ' + h.fmt(Hi, 1) + ' = ' + h.f(P, 1, 'kW')];
                        var waarsch = [];
                        if (v.Pn > 0) {
                            var afw = (P - v.Pn) / v.Pn * 100;
                            uit.push(h.uit('Afwijking van het kenplaatje', afw, '%', { dec: 0, hoofd: true, kleur: Math.abs(afw) <= 5 ? 'groen' : Math.abs(afw) <= 10 ? 'amber' : 'rood' }), h.uit('Tijd die bij ' + h.fmt(v.Pn, 1) + ' kW hoort', v.V / 1000 / (v.Pn / Hi / f) * 3600, 's', { dec: 0 }));
                            if (afw > 5) waarsch.push('De ketel verbruikt meer dan het kenplaatje: branderdruk of gasklep nakijken en afstellen volgens de fabrikant.');
                            if (afw < -10) waarsch.push('De ketel haalt zijn belasting niet: controleer de gasdruk tijdens het branden, de gasfilter en de instelling van het maximumvermogen.');
                        }
                        return { uit: uit, stappen: st, waarsch: waarsch, opm: 'De verbrandingswaarde van aardgas schommelt enkele procenten. Meet minstens één volle minuut voor een betrouwbaar resultaat.' };
                    }
                }
            ] },
            { naam: 'Warmtepomp', items: [
                {
                    id: 'verw.wp', naam: 'Warmtepomp: vermogen, stroom en verbruik', kort: 'Elektrisch vermogen uit COP, jaarverbruik en vergelijking met gas',
                    zoek: 'warmtepomp cop scop elektrisch vermogen stroom verbruik kost vergelijking gas besparing co2', soort: 'indicatief',
                    bron: 'P_el = P_th / COP · E_el = Q_jaar / SCOP · kost gas = Q_jaar / η_ketel × prijs · CO₂: gas 0,202 kg/kWh, elektriciteit BE ±0,17 kg/kWh',
                    velden: [
                        { k: 'Pth', label: 'Thermisch vermogen', eh: 'kW' },
                        { k: 'cop', label: 'COP bij ontwerp', std: 2.8, min: 1, max: 8, snel: [{ t: 'A7/W35 4,5', v: 4.5 }, { t: 'A2/W35 3,5', v: 3.5 }, { t: 'A−7/W35 2,8', v: 2.8 }, { t: 'A−7/W55 2,0', v: 2 }] },
                        { k: 'net', label: 'Aansluiting', type: 'keuze', opties: [{ v: '1f', t: '1-fase 230 V' }, { v: '3f', t: '3-fase 400 V' }] },
                        { k: 'Q', label: 'Jaarlijkse warmtevraag (optioneel)', eh: 'kWh', opt: true, snel: [{ t: '10.000', v: 10000 }, { t: '15.000', v: 15000 }, { t: '20.000', v: 20000 }] },
                        { k: 'scop', label: 'SCOP (jaargemiddeld)', std: 3.5, min: 1, max: 8 },
                        { k: 'pe', label: 'Stroomprijs', eh: '€/kWh', std: 0.35 },
                        { k: 'pg', label: 'Gasprijs', eh: '€/kWh', std: 0.1 },
                        { k: 'etag', label: 'Rendement gasketel', std: 0.95 }
                    ],
                    bereken: function (v, h) {
                        var Pel = v.Pth / v.cop, U = v.net === '3f' ? 400 : 230, k = v.net === '3f' ? Math.sqrt(3) : 1, I = Pel * 1000 / (k * U * 0.9);
                        var uit = [h.uit('Elektrisch vermogen', Pel, 'kW', { dec: 2, hoofd: true }), h.uit('Stroom (cos φ 0,9)', I, 'A', { dec: 1 }), h.uit('Automaat (richtwaarde, curve C)', h.omhoogNaar(I * 1.25, R.AUTOMATEN) + ' A', '', { opm: 'aanloopstroom: fiche fabrikant' })];
                        var st = ['P_el = ' + h.f(v.Pth) + ' / ' + h.f(v.cop) + ' = ' + h.f(Pel, 2, 'kW')];
                        if (v.Q != null) {
                            var Eel = v.Q / v.scop, kwp = Eel * v.pe, kgas = v.Q / v.etag * v.pg;
                            uit.push(h.uit('Jaarverbruik warmtepomp', Eel, 'kWh', { dec: 0, hoofd: true }), h.uit('Kost warmtepomp / gas', '€ ' + h.fmt(kwp, 0) + ' / € ' + h.fmt(kgas, 0), '', { kleur: kwp < kgas ? 'groen' : 'amber' }), h.uit('Verschil per jaar', kgas - kwp, '€', { dec: 0 }), h.uit('CO₂ warmtepomp / gas', h.fmt(Eel * 0.17 / 1000, 1) + ' / ' + h.fmt(v.Q / v.etag * 0.202 / 1000, 1) + ' ton', ''));
                            st.push('E_el = ' + h.f(v.Q, 0) + ' / ' + h.f(v.scop) + ' = ' + h.f(Eel, 0, 'kWh'));
                        }
                        return { uit: uit, stappen: st };
                    }
                },
                {
                    id: 'verw.bivalent', naam: 'Bivalentiepunt', kort: 'Waar kruist het vermogen van de warmtepomp de warmtevraag?',
                    zoek: 'bivalentiepunt bivalent warmtepomp hybride ketel dekking buitentemperatuur vermogen', soort: 'indicatief',
                    bron: 'Warmtevraag lineair tussen de stookgrens en de ontwerptemperatuur; WP-vermogen lineair tussen de opgegeven punten; dekkingsgraad = richtwaarde voor het Belgische klimaat',
                    velden: [
                        { k: 'Qd', label: 'Warmteverlies bij ontwerp', eh: 'kW' },
                        { k: 'ted', label: 'Ontwerpbuitentemperatuur', eh: '°C', std: -8 },
                        { k: 'tgrens', label: 'Stookgrens', eh: '°C', std: 15 },
                        { k: 'Pmin', label: 'WP-vermogen bij −7 °C', eh: 'kW' },
                        { k: 'Pplus', label: 'WP-vermogen bij +7 °C', eh: 'kW' }
                    ],
                    bereken: function (v, h) {
                        function vraag(te) { return v.Qd * (v.tgrens - te) / (v.tgrens - v.ted); }
                        function wp(te) { return v.Pmin + (v.Pplus - v.Pmin) * (te + 7) / 14; }
                        var tb = null;
                        for (var te = v.ted; te <= v.tgrens; te += 0.1) { if (wp(te) >= vraag(te)) { tb = te; break; } }
                        var dek = tb == null ? 0 : h.interp(tb, [-8, -6, -4, -2, 0, 2, 4, 6, 8], [100, 99, 97, 94, 90, 84, 75, 62, 45]);
                        var rijen = [-10, -7, -4, -2, 0, 3, 7, 10].map(function (t) { return [t + ' °C', h.fmt(vraag(t), 1) + ' kW', h.fmt(wp(t), 1) + ' kW', wp(t) >= vraag(t) ? 'WP volstaat' : 'tekort ' + h.fmt(vraag(t) - wp(t), 1) + ' kW']; });
                        return {
                            uit: [h.uit('Bivalentiepunt', tb == null ? 'geen (WP te klein)' : h.fmt(tb, 1) + ' °C', '', { hoofd: true, kleur: tb == null ? 'rood' : tb <= -3 ? 'groen' : tb <= 2 ? 'amber' : 'rood' }), h.uit('Aandeel van de jaarwarmte door de WP (±)', dek, '%', { dec: 0 }), h.uit('Tekort bij ontwerp', Math.max(0, vraag(v.ted) - wp(v.ted)), 'kW', { dec: 1, opm: 'door de bijverwarming (ketel of weerstand)' })],
                            tabel: { kop: ['Buiten', 'Vraag', 'WP', ''], rijen: rijen },
                            opm: 'Streef naar een bivalentiepunt van −3 à −5 °C: dan levert de warmtepomp ±95 % van de jaarwarmte zonder overdimensionering.'
                        };
                    }
                },
                {
                    id: 'verw.wp_cop', naam: 'COP schatten uit de temperaturen', kort: 'Wat doet een lagere aanvoertemperatuur met het rendement?',
                    zoek: 'cop schatten warmtepomp aanvoertemperatuur brontemperatuur buitentemperatuur carnot rendement lage temperatuur lucht water bodem', soort: 'indicatief',
                    bron: 'COP ≈ kwaliteitsfactor × T_c / (T_c − T_v) in kelvin, met T_c = aanvoer + 3 K en T_v = bron − 7 K (lucht) of − 4 K (bodem, water) · kwaliteitsfactor 0,45 tot 0,55',
                    uitleg: 'Richtwaarde om regimes te vergelijken. De COP in de fiche van de fabrikant (EN 14511) gaat voor. Vuistregel: elke graad lagere aanvoer levert 2 tot 3 % op.',
                    velden: [
                        { k: 'bron', label: 'Bron', type: 'keuze', opties: [{ v: 7, t: 'Buitenlucht' }, { v: 4, t: 'Bodem of grondwater' }], std: 7 },
                        { k: 'Tb', label: 'Temperatuur van de bron', eh: '°C', std: 2, min: -25, max: 30, snel: [{ t: '−7', v: -7 }, { t: '2', v: 2 }, { t: '7', v: 7 }, { t: 'Bodem 0', v: 0 }, { t: 'Grondwater 10', v: 10 }] },
                        { k: 'Tv', label: 'Aanvoertemperatuur', eh: '°C', std: 35, min: 20, max: 80, snel: [{ t: 'Vloer 35', v: 35 }, { t: '45', v: 45 }, { t: '55', v: 55 }, { t: 'Warm water 60', v: 60 }] },
                        { k: 'eta', label: 'Kwaliteitsfactor', std: 0.5, min: 0.3, max: 0.65 }
                    ],
                    bereken: function (v, h) {
                        function cop(tv) { var Tc = tv + 3 + 273.15, Te = v.Tb - Number(v.bron) + 273.15; return Tc > Te ? v.eta * Tc / (Tc - Te) : null; }
                        var c = cop(v.Tv);
                        if (c == null) return { fout: 'De aanvoer moet warmer zijn dan de bron' };
                        var regimes = [30, 35, 40, 45, 50, 55, 60, 65];
                        var rijen = regimes.map(function (t) { var x = cop(t); return [t + ' °C', x ? h.fmt(x, 2) : '', x ? h.fmt(100 / x, 0) + ' %' : '']; });
                        return {
                            uit: [h.uit('COP (schatting)', c, '', { dec: 2, hoofd: true }), h.uit('Stroom voor 1 kWh warmte', 1 / c, 'kWh', { dec: 2 }), h.uit('Winst per graad lagere aanvoer', cop(v.Tv - 1) ? (cop(v.Tv - 1) / c - 1) * 100 : null, '%', { dec: 1 })],
                            stappen: ['T_c = ' + h.f(v.Tv, 0) + ' + 3 = ' + h.f(v.Tv + 3, 0, '°C') + ' en T_v = ' + h.f(v.Tb, 0) + ' − ' + Number(v.bron) + ' = ' + h.f(v.Tb - Number(v.bron), 0, '°C'), 'COP = ' + h.f(v.eta, 2) + ' × ' + h.fmt(v.Tv + 276.15, 1) + ' / ' + h.fmt(v.Tv + 3 - v.Tb + Number(v.bron), 1) + ' = ' + h.fmt(c, 2)],
                            tabel: { kop: ['Aanvoer', 'COP', 'Stroom per kWh warmte'], rijen: rijen, kies: regimes.indexOf(v.Tv) }
                        };
                    }
                }
            ] },
            { naam: 'Energie', items: [
                {
                    id: 'verw.brandstoffen', naam: 'Brandstoffen omrekenen', kort: 'kWh, m³ gas, liter stookolie, kg propaan, kg pellets, hout en CO₂',
                    zoek: 'brandstof omrekenen kwh m3 gas liter stookolie propaan pellets hout co2 energie-inhoud', soort: 'exact',
                    bron: 'Onderwaarden: aardgas H 10,5 kWh/m³ (Hs 11,6), L 8,8 (Hs 9,8), stookolie 10 kWh/l, propaan 12,8 kWh/kg (6,5 kWh/l vloeibaar), pellets 4,8 kWh/kg, hout droog 4,0 kWh/kg; CO₂: gas 0,202, olie 0,266, propaan 0,227, elektriciteit BE 0,17 kg/kWh, pellets/hout ±0 (biogeen)',
                    velden: [
                        { k: 'w', label: 'Hoeveelheid', std: 1 },
                        { k: 'van', label: 'Eenheid', type: 'keuze', opties: [{ v: 'kwh', t: 'kWh (warmte, onderwaarde)' }, { v: 'gasH', t: 'm³ aardgas H' }, { v: 'gasL', t: 'm³ aardgas L' }, { v: 'kwhs', t: 'kWh op de gasfactuur (bovenwaarde)' }, { v: 'olie', t: 'liter stookolie' }, { v: 'propkg', t: 'kg propaan' }, { v: 'propl', t: 'liter propaan (vloeibaar)' }, { v: 'pellet', t: 'kg pellets' }, { v: 'hout', t: 'kg hout (droog)' }, { v: 'el', t: 'kWh elektriciteit (weerstand)' }], std: 'gasH' }
                    ],
                    bereken: function (v, h) {
                        var F = { kwh: 1, gasH: 10.5, gasL: 8.8, kwhs: 10.5 / 11.6, olie: 10, propkg: 12.8, propl: 6.5, pellet: 4.8, hout: 4.0, el: 1 };
                        var CO2 = { kwh: null, gasH: 0.202, gasL: 0.202, kwhs: 0.202, olie: 0.266, propkg: 0.227, propl: 0.227, pellet: 0.02, hout: 0.02, el: 0.17 };
                        var kwh = v.w * F[v.van];
                        var rijen = Object.keys(F).filter(function (k) { return k !== v.van; }).map(function (k) { var t = this.velden[1].opties.filter(function (o) { return o.v === k; })[0].t; return [t, h.fmt(kwh / F[k], kwh / F[k] < 10 ? 2 : 0)]; }, this);
                        var co2 = CO2[v.van] != null ? kwh * CO2[v.van] : null;
                        return { uit: [h.uit('Energie-inhoud (onderwaarde)', kwh, 'kWh', { dec: 1, hoofd: true }), h.uit('CO₂ bij verbranding', co2, 'kg', { dec: 1 })], tabel: { kop: ['Evenveel energie als', 'Hoeveelheid'], rijen: rijen } };
                    }
                },
                {
                    id: 'verw.energieprijs', naam: 'Energieprijs per kWh warmte', kort: 'Gas, stookolie, warmtepomp, pellets en stroom naast elkaar',
                    zoek: 'energieprijs prijs per kwh warmte vergelijken gas stookolie warmtepomp elektrisch pellets propaan goedkoopste verwarmen kost', soort: 'exact',
                    bron: 'Prijs per kWh nuttige warmte = prijs per eenheid / (energie-inhoud × rendement) · gasfactuur in kWh bovenwaarde: × 11,6 / 10,5 · stookolie 10 kWh/l · propaan 6,5 kWh/l · pellets 4,8 kWh/kg · warmtepomp: stroomprijs / SCOP',
                    velden: [
                        { k: 'pg', label: 'Aardgas (prijs op de factuur)', eh: '€/kWh', std: 0.1, min: 0 },
                        { k: 'eg', label: 'Rendement gasketel (op onderwaarde)', std: 0.98, min: 0.5, max: 1.1 },
                        { k: 'po', label: 'Stookolie', eh: '€/l', std: 1, min: 0 },
                        { k: 'eo', label: 'Rendement stookolieketel', std: 0.9, min: 0.5, max: 1.05 },
                        { k: 'pe', label: 'Elektriciteit', eh: '€/kWh', std: 0.35, min: 0 },
                        { k: 'scop', label: 'SCOP warmtepomp', std: 3.5, min: 1, max: 8 },
                        { k: 'pp', label: 'Pellets', eh: '€/kg', std: 0.4, min: 0 },
                        { k: 'ppr', label: 'Propaan', eh: '€/l', std: 0.75, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var lijst = [
                            ['Aardgas', v.pg * 11.6 / 10.5 / v.eg, 'ketel ' + h.fmt(v.eg * 100, 0) + ' %'], ['Stookolie', v.po / 10 / v.eo, 'ketel ' + h.fmt(v.eo * 100, 0) + ' %'],
                            ['Warmtepomp', v.pe / v.scop, 'SCOP ' + h.fmt(v.scop, 1)], ['Elektrisch, rechtstreeks', v.pe, 'weerstand'],
                            ['Pellets', v.pp / 4.8 / 0.85, 'ketel 85 %'], ['Propaan', v.ppr / 6.5 / 0.95, 'ketel 95 %']
                        ].sort(function (a, b) { return a[1] - b[1]; });
                        var gas = v.pg * 11.6 / 10.5 / v.eg;
                        var rijen = lijst.map(function (x) { return [x[0], h.fmt(x[1] * 100, 1) + ' cent', x[2], gas > 0 ? h.fmt(x[1] / gas * 100, 0) + ' %' : '']; });
                        return {
                            uit: [h.uit('Goedkoopste warmte', lijst[0][0], '', { hoofd: true, opm: h.fmt(lijst[0][1] * 100, 1) + ' cent per kWh' }), h.uit('Aardgas', gas * 100, 'cent/kWh', { dec: 1, hoofd: true }), h.uit('Warmtepomp', v.pe / v.scop * 100, 'cent/kWh', { dec: 1, hoofd: true }), h.uit('SCOP waarbij de warmtepomp even duur is als gas', gas > 0 ? v.pe / gas : null, '', { dec: 2 })],
                            stappen: ['Gas: ' + h.f(v.pg, 3) + ' × 11,6 / 10,5 / ' + h.f(v.eg, 2) + ' = ' + h.f(gas * 100, 1, 'cent'), 'Warmtepomp: ' + h.f(v.pe, 3) + ' / ' + h.f(v.scop, 1) + ' = ' + h.f(v.pe / v.scop * 100, 1, 'cent')],
                            tabel: { kop: ['Warmtebron', 'Per kWh warmte', 'Rendement', 'Ten opzichte van gas'], rijen: rijen, kies: 0 },
                            opm: 'Vul de prijzen van je eigen facturen in, met alle heffingen en btw. Onderhoud, afschrijving en het capaciteitstarief zitten niet in deze vergelijking.'
                        };
                    }
                },
                {
                    id: 'verw.terugverdien', naam: 'Besparing en terugverdientijd', kort: 'Wat levert een nieuwe ketel of warmtepomp op?',
                    zoek: 'besparing terugverdientijd nieuwe ketel vervangen warmtepomp rendement investering premie verbruik condensatieketel renovatie', soort: 'indicatief',
                    bron: 'Nuttige warmte = verbruik × rendement oud · nieuw verbruik = nuttige warmte / rendement nieuw · terugverdientijd = (investering − premie) / besparing per jaar · zonder prijsstijging en zonder rente',
                    velden: [
                        { k: 'E', label: 'Verbruik nu', eh: 'kWh', std: 20000, min: 0, snel: [{ t: '15.000', v: 15000 }, { t: '20.000', v: 20000 }, { t: '30.000', v: 30000 }], hint: '1 m³ aardgas ≈ 11,6 kWh op de factuur, 1 liter stookolie ≈ 10 kWh' },
                        { k: 'p1', label: 'Energieprijs nu', eh: '€/kWh', std: 0.1, min: 0 },
                        { k: 'e1', label: 'Rendement van het oude toestel', std: 0.8, min: 0.3, max: 1.1, snel: [{ t: 'Oude ketel 0,70', v: 0.7 }, { t: 'HR 0,85', v: 0.85 }, { t: 'Condensatie 0,95', v: 0.95 }] },
                        { k: 'e2', label: 'Rendement of SCOP van het nieuwe toestel', std: 0.98, min: 0.3, max: 8, snel: [{ t: 'Condensatieketel 0,98', v: 0.98 }, { t: 'Warmtepomp 3,5', v: 3.5 }, { t: 'Hybride 1,8', v: 1.8 }] },
                        { k: 'p2', label: 'Energieprijs na de vervanging', eh: '€/kWh', std: 0.1, min: 0, snel: [{ t: 'Gas 0,10', v: 0.1 }, { t: 'Stroom 0,35', v: 0.35 }] },
                        { k: 'inv', label: 'Investering', eh: '€', std: 5000, min: 0 },
                        { k: 'premie', label: 'Premie', eh: '€', std: 0, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var Qn = v.E * v.e1, E2 = Qn / v.e2, k1 = v.E * v.p1, k2 = E2 * v.p2, besp = k1 - k2, netto = Math.max(0, v.inv - v.premie);
                        var uit = [h.uit('Besparing per jaar', besp, '€', { dec: 0, hoofd: true, kleur: besp > 0 ? 'groen' : 'rood' }), h.uit('Terugverdientijd', besp > 0 ? h.fmt(netto / besp, 1) + ' jaar' : 'verdient zich niet terug', '', { hoofd: true }), h.uit('Kost nu', k1, '€', { dec: 0 }), h.uit('Kost na de vervanging', k2, '€', { dec: 0 }), h.uit('Verbruik na de vervanging', E2, 'kWh', { dec: 0 }), h.uit('Nuttige warmte', Qn, 'kWh', { dec: 0 }), h.uit('Besparing over 15 jaar', besp * 15 - netto, '€', { dec: 0, opm: 'na aftrek van de investering' })];
                        return { uit: uit, stappen: ['Nuttige warmte = ' + h.f(v.E, 0) + ' × ' + h.f(v.e1, 2) + ' = ' + h.f(Qn, 0, 'kWh'), 'Nieuw verbruik = ' + h.fmt(Qn, 0) + ' / ' + h.f(v.e2, 2) + ' = ' + h.f(E2, 0, 'kWh'), 'Besparing = ' + h.fmt(k1, 0) + ' − ' + h.fmt(k2, 0) + ' = ' + h.fmt(besp, 0) + ' euro per jaar'], opm: 'Richtwaarde. Een toestel dat aan vervanging toe is, moet sowieso vervangen worden: vergelijk dan alleen de meerprijs van het zuinigere toestel met de besparing.' };
                    }
                }
            ] }
        ]
    });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-verwarming */
