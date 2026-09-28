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

    R.registreer({
        key: 'verwarming', naam: 'Verwarming', emoji: '🔥', volgorde: 1,
        omschrijving: 'Warmteverlies, ketel, radiatoren en vloerverwarming, pomp en leidingen, expansievat, gas en stookolie, warmtepomp',
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
                        return {
                            uit: [h.uit('Voorstel', beste ? 'type ' + beste.t + ' · hoogte ' + v.hoogte + ' mm · lengte ' + beste.L + ' cm (' + h.fmt(beste.P, 0) + ' W)' : 'te groot voor één radiator', '', { hoofd: true }), h.uit('Te dekken vermogen (incl. reserve)', P, 'W', { dec: 0 }), h.uit('Regimefactor', f, '', { dec: 2, opm: 'ΔT_ln ' + h.fmt(dt, 1) + ' K' })],
                            stappen: ['Lengte = P / (W/m bij ΔT 50 × factor ' + h.fmt(f, 2) + '), afgerond naar de eerstvolgende standaardlengte'],
                            tabel: { kop: ['Type', 'Vermogen/m', 'Lengte', 'Vermogen', 'Inhoud'], rijen: rijen },
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
                        var dL = A * v.L * v.dT, uit = [h.uit('Uitzetting ΔL', dL, 'mm', { dec: 1, hoofd: true })], st = ['ΔL = ' + A + ' × ' + h.f(v.L) + ' × ' + h.f(v.dT) + ' = ' + h.f(dL, 1, 'mm')];
                        if (v.d != null && C) { var LB = C * Math.sqrt(v.d * dL); uit.push(h.uit('Compensatiearm (U-bocht / haakse arm)', LB, 'mm', { dec: 0 })); st.push('L_B = ' + C + ' × √(' + h.f(v.d) + ' × ' + h.fmt(dL, 1) + ') = ' + h.f(LB, 0, 'mm')); }
                        else if (v.d != null) uit.push(h.uit('Compensatiearm', 'volgens leverancier (staal: lassen/vaste punten)', ''));
                        return { uit: uit, stappen: st };
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
                    bron: 'Siegert: verlies q_A = (T_rookgas − T_lucht) × (A₂ / (21 − O₂) + B); λ = 21 / (21 − O₂); CO onverdund = CO × 21 / (21 − O₂). Vlaanderen (besluit 8/12/2006): gas: rendement ≥ 90 %, CO ≤ 150 mg/kWh; stookolie: rendement ≥ 90 %, CO ≤ 155 mg/kWh, roetindex ≤ 1',
                    velden: [
                        { k: 'brand', label: 'Brandstof', type: 'keuze', opties: [{ v: 'gas', t: 'Aardgas' }, { v: 'olie', t: 'Stookolie' }, { v: 'propaan', t: 'Propaan' }, { v: 'hout', t: 'Hout / pellets' }] },
                        { k: 'O2', label: 'O₂ in de rookgassen', eh: '%', opt: true, min: 0, max: 20.9 },
                        { k: 'CO2', label: 'of CO₂', eh: '%', opt: true, min: 0, max: 21 },
                        { k: 'Tg', label: 'Rookgastemperatuur', eh: '°C', std: 60 },
                        { k: 'Ta', label: 'Verbrandingsluchttemperatuur', eh: '°C', std: 20 },
                        { k: 'CO', label: 'CO gemeten (verdund)', eh: 'ppm', opt: true }
                    ],
                    bereken: function (v, h) {
                        var K = { gas: { A2: 0.66, B: 0.009, co2max: 11.9, mgkwh: 1.07 }, olie: { A2: 0.68, B: 0.007, co2max: 15.4, mgkwh: 1.1 }, propaan: { A2: 0.63, B: 0.008, co2max: 13.8, mgkwh: 1.08 }, hout: { A2: 0.65, B: 0, co2max: 20.3, mgkwh: 1.1 } }[v.brand];
                        var O2 = v.O2;
                        if (O2 == null && v.CO2 != null) O2 = 21 * (1 - v.CO2 / K.co2max);
                        if (O2 == null) return { wacht: true, ontbreekt: ['O₂ of CO₂'] };
                        if (O2 >= 21) return { fout: 'O₂ moet kleiner zijn dan 21 %' };
                        var CO2 = K.co2max * (1 - O2 / 21), lam = 21 / (21 - O2), qA = (v.Tg - v.Ta) * (K.A2 / (21 - O2) + K.B), eta = 100 - qA;
                        var uit = [h.uit('Verbrandingsrendement', eta, '%', { dec: 1, hoofd: true, kleur: eta >= 90 ? 'groen' : 'rood' }), h.uit('Rookgasverlies', qA, '%', { dec: 1 }), h.uit('Luchtovermaat λ', lam, '', { dec: 2, kleur: lam > 1.6 ? 'amber' : '' }), h.uit('CO₂', CO2, '%', { dec: 1 }), h.uit('O₂', O2, '%', { dec: 1 })];
                        var st = ['λ = 21 / (21 − ' + h.fmt(O2, 1) + ') = ' + h.fmt(lam, 2), 'q_A = (' + h.f(v.Tg) + ' − ' + h.f(v.Ta) + ') × (' + K.A2 + ' / (21 − ' + h.fmt(O2, 1) + ') + ' + K.B + ') = ' + h.f(qA, 1, '%')];
                        var waarsch = [];
                        if (v.CO != null) {
                            var COr = v.CO * 21 / (21 - O2), mg = COr * K.mgkwh, grens = v.brand === 'olie' ? 155 : 150;
                            uit.push(h.uit('CO onverdund (0 % O₂)', COr, 'ppm', { dec: 0 }), h.uit('≈ CO', mg, 'mg/kWh', { dec: 0, kleur: mg > grens ? 'rood' : 'groen', opm: 'grens ' + grens + ' mg/kWh' }));
                            st.push('CO_onverdund = ' + h.f(v.CO) + ' × 21 / (21 − ' + h.fmt(O2, 1) + ') = ' + h.f(COr, 0, 'ppm') + ' × ' + K.mgkwh + ' ≈ ' + h.f(mg, 0, 'mg/kWh'));
                            if (mg > grens) waarsch.push('CO boven de keuringsgrens: brander afstellen, luchttoevoer en warmtewisselaar nakijken.');
                        }
                        if (eta < 90) waarsch.push('Rendement onder 90 %: keuring niet in orde (rookgastemperatuur te hoog of te veel lucht).');
                        if (lam < 1.1) waarsch.push('Weinig luchtovermaat (λ < 1,1): risico op onvolledige verbranding en CO.');
                        return { uit: uit, stappen: st, waarsch: waarsch, opm: 'Het rendement uit een rookgasmeting is het verbrandingsrendement (zonder stilstands- en stralingsverlies); condensatiewinst zit er niet in.' };
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
                }
            ] }
        ]
    });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-verwarming */
