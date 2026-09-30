/* QE Rekenmachine — module Airco & koeling (v411)
 * BRON = QE-Software/reken-mod-airco.js; kopie in de www via `node sync-reken.js`.
 * Koellast en toestelkeuze, koelmiddel (druk en temperatuur, oververhitting en onderkoeling, vulling, F-gassen,
 * minimale ruimte bij brandbaar koelmiddel), montage (flare, vacumeren, drukproef), condenswater en geluid.
 * Bronnen: verzadigingsdrukken op basis van NIST REFPROP (tabellen van de koelmiddelfabrikanten),
 * F-gassenverordening (EU) 2024/573, IEC 60335-2-40 bijlage GG (minimale vloeroppervlakte), Magnus (kookpunt van water),
 * VLAREM II (richtwaarden geluid).
 * De berekeningen "Koellast airco snel" en "Koelmiddel: extra vulling en F-gassen" stonden tot v410 bij Ventilatie;
 * ze houden hun id (vent.koellast, vent.koelmiddel) zodat favorieten en links blijven werken.
 */
(function (root) {
    'use strict';
    var R = root.QEReken;
    if (!R) throw new Error('reken-kern.js eerst laden');
    var VINK = String.fromCharCode(0x2713);

    // Verzadigingsdruk in bar absoluut bij −40 … +60 °C (stap 10 K). b = vloeistof (kookpunt), d = damp (dauwpunt).
    // Zuivere stoffen en azeotropen hebben één lijn. lfl in kg/m³ (IEC 60335-2-40), klasse volgens ISO 817.
    var T_AS = [-40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60];
    // Bronnen (nagekeken 29 sep 2026): NIST Chemistry WebBook (R32, R134a, R290, R600a, R744) en de dampdruktabellen van
    // TEGA op basis van REFPROP 10.0 (mengsels en HFO's), gekruist met Chemours, Arkema en Honeywell.
    // GWP volgens verordening (EU) 2024/573 (HFK's: AR4; HFO's en koolwaterstoffen: bijlage II en VI).
    var KM = [
        { v: 'R32', naam: 'R32', gwp: 675, klasse: 'A2L', lfl: 0.307, b: [1.7741, 2.7344, 4.0575, 5.8263, 8.131, 11.069, 14.746, 19.275, 24.783, 31.412, 39.332] },
        { v: 'R410A', naam: 'R410A', gwp: 2088, klasse: 'A1', b: [1.755, 2.703, 4.007, 5.746, 8.007, 10.88, 14.48, 18.89, 24.26, 30.71, 38.42], d: [1.749, 2.694, 3.993, 5.727, 7.981, 10.85, 14.43, 18.84, 24.19, 30.63, 38.34] },
        { v: 'R454B', naam: 'R454B', gwp: 465, klasse: 'A2L', lfl: 0.297, b: [1.67, 2.57, 3.807, 5.456, 7.599, 10.32, 13.72, 17.9, 22.96, 29.02, 36.23], d: [1.592, 2.454, 3.641, 5.227, 7.294, 9.929, 13.23, 17.3, 22.25, 28.23, 35.41] },
        { v: 'R290', naam: 'R290 (propaan)', gwp: 0.02, klasse: 'A3', lfl: 0.038, b: [1.1112, 1.6783, 2.4452, 3.4528, 4.7446, 6.366, 8.3646, 10.79, 13.694, 17.133, 21.167] },
        { v: 'R134a', naam: 'R134a', gwp: 1430, klasse: 'A1', b: [0.51209, 0.84378, 1.3273, 2.006, 2.928, 4.1461, 5.7171, 7.702, 10.166, 13.179, 16.818] },
        { v: 'R407C', naam: 'R407C', gwp: 1774, klasse: 'A1', b: [1.203, 1.871, 2.799, 4.047, 5.679, 7.764, 10.38, 13.59, 17.49, 22.16, 27.69], d: [0.857, 1.387, 2.147, 3.198, 4.607, 6.449, 8.803, 11.76, 15.41, 19.88, 25.29] },
        { v: 'R454C', naam: 'R454C', gwp: 146, klasse: 'A2L', lfl: 0.293, b: [1.308, 2.003, 2.953, 4.212, 5.837, 7.89, 10.43, 13.53, 17.24, 21.64, 26.8], d: [0.911, 1.439, 2.183, 3.196, 4.537, 6.271, 8.471, 11.21, 14.59, 18.7, 23.68] },
        { v: 'R513A', naam: 'R513A', gwp: 629, klasse: 'A1', b: [0.621, 0.997, 1.532, 2.269, 3.254, 4.536, 6.17, 8.21, 10.72, 13.76, 17.42], d: [0.618, 0.993, 1.529, 2.267, 3.253, 4.536, 6.17, 8.21, 10.72, 13.76, 17.41] },
        { v: 'R1234yf', naam: 'R1234yf', gwp: 0.5, klasse: 'A2L', lfl: 0.289, b: [0.624, 0.991, 1.509, 2.218, 3.158, 4.375, 5.917, 7.835, 10.18, 13.02, 16.42] },
        { v: 'R1234ze', naam: 'R1234ze(E)', gwp: 1.4, klasse: 'A2L', lfl: 0.303, b: [0.367, 0.611, 0.969, 1.474, 2.166, 3.084, 4.273, 5.783, 7.665, 9.972, 12.77] },
        { v: 'R600a', naam: 'R600a (isobutaan)', gwp: 0, klasse: 'A3', b: [0.28702, 0.46622, 0.72477, 1.0845, 1.5696, 2.2061, 3.0222, 4.0472, 5.3121, 6.849, 8.6916] },
        { v: 'R744', naam: 'R744 (CO₂)', gwp: 1, klasse: 'A1', b: [10.045, 14.278, 19.696, 26.487, 34.851, 45.022, 57.291, 72.137] }
    ];
    // F-gassenverordening (EU) 2024/573, artikel 5. hfk = bevat een gas uit bijlage I (drempels in ton CO₂-equivalent),
    // hfo = massa-aandeel van een gas uit bijlage II deel 1 (drempels in kg). Koolwaterstoffen en CO₂ vallen er niet onder.
    var FGAS = { R32: { hfk: 1 }, R410A: { hfk: 1 }, R454B: { hfk: 1, hfo: 0.311 }, R134a: { hfk: 1 }, R407C: { hfk: 1 }, R454C: { hfk: 1, hfo: 0.785 }, R513A: { hfk: 1, hfo: 0.56 }, R1234yf: { hfo: 1 }, R1234ze: { hfo: 1 } };
    function lekcontrole(K, kg, herm, woning) {
        var F = FGAS[K.v];
        if (!F) return { klasse: 0, t: 'geen F-gas: de verordening vraagt geen lekcontrole', co2: 0, hfo: 0, fgas: false };
        var co2 = F.hfk ? kg * K.gwp / 1000 : 0, hfo = (F.hfo || 0) * kg, klasse = 0, waarom = '';
        if (co2 >= 500 || hfo >= 100) klasse = 3; else if (co2 >= 50 || hfo >= 10) klasse = 2; else if (co2 >= (herm ? 10 : 5) || hfo >= (herm ? 2 : 1)) klasse = 1;
        if (klasse) waarom = co2 >= (herm ? 10 : 5) ? R.fmt(co2, 2) + ' t CO₂-equivalent' : R.fmt(hfo, 2) + ' kg HFO';
        if (klasse === 1 && herm && woning && kg < 3) { klasse = 0; waarom = 'hermetisch gesloten toestel in een woning met minder dan 3 kg'; }
        var t = ['geen verplichte lekcontrole', 'jaarlijks (om de 24 maanden met een lekdetectiesysteem)', 'om de 6 maanden (12 met een lekdetectiesysteem)', 'om de 3 maanden (6 met een lekdetectiesysteem)'][klasse];
        return { klasse: klasse, t: t, co2: co2, hfo: hfo, waarom: waarom, fgas: true };
    }
    function km(v) { return KM.filter(function (x) { return x.v === v; })[0] || KM[0]; }
    function lijn(K, soort) { return soort === 'd' && K.d ? K.d : K.b; }
    // ln(p) is bijna lineair in 1/T: tussen twee tabelpunten is de fout kleiner dan 0,3 %
    function pVan(K, T, soort) {
        var p = lijn(K, soort), n = p.length, xs = T_AS.slice(0, n);
        if (T < xs[0] - 10 || T > xs[n - 1] + 5) return null;
        var i = 1; while (i < n - 1 && T > xs[i]) i++;
        var x0 = 1 / (xs[i - 1] + 273.15), x1 = 1 / (xs[i] + 273.15), x = 1 / (T + 273.15);
        return Math.exp(Math.log(p[i - 1]) + (x - x0) / (x1 - x0) * (Math.log(p[i]) - Math.log(p[i - 1])));
    }
    function tVan(K, pabs, soort) {
        var p = lijn(K, soort), n = p.length, xs = T_AS.slice(0, n);
        if (!(pabs > 0)) return null;
        var i = 1; while (i < n - 1 && pabs > p[i]) i++;
        var x0 = 1 / (xs[i - 1] + 273.15), x1 = 1 / (xs[i] + 273.15);
        var x = x0 + (Math.log(pabs) - Math.log(p[i - 1])) / (Math.log(p[i]) - Math.log(p[i - 1])) * (x1 - x0);
        var T = 1 / x - 273.15;
        if (T < xs[0] - 10 || T > xs[n - 1] + 5) return null;
        return T;
    }
    var P_ATM = 1.013;
    function kmOpties(filter) { return KM.filter(filter || function () { return true; }).map(function (K) { return { v: K.v, t: K.naam + ' (' + K.klasse + ', GWP ' + (K.gwp < 1 ? 'lager dan 1' : R.fmt(K.gwp, 0)) + ')' }; }); }

    // kookpunt van water (°C) bij een druk in hPa: Magnus boven water, onder 6,112 hPa boven ijs
    function kookpuntWater(hPa) {
        var l = Math.log(hPa / 6.112);
        return hPa >= 6.112 ? 243.12 * l / (17.62 - l) : 272.62 * l / (22.46 - l);
    }

    var OPSTELLING = [{ v: 1.8, t: 'Wandtoestel (1,8 m)' }, { v: 0.6, t: 'Vloertoestel of console (0,6 m)' }, { v: 1.0, t: 'Raamtoestel (1,0 m)' }, { v: 2.2, t: 'Plafondtoestel of cassette (2,2 m)' }];

    R.registreer({
        key: 'airco', naam: 'Airco & koeling', emoji: '', volgorde: 5,
        omschrijving: 'Koellast, koelmiddel en F-gassen, oververhitting en onderkoeling, vacumeren en drukproef, condenswater en geluid',
        groepen: [
            { naam: 'Toestel kiezen', items: [
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
                    id: 'koel.verbruik', naam: 'Airco: verbruik en kost per jaar', kort: 'Koelen en verwarmen met SEER en SCOP',
                    zoek: 'airco verbruik kost per jaar seer scop koelen verwarmen lucht-lucht warmtepomp stroomverbruik energielabel', soort: 'indicatief',
                    bron: 'E = vermogen × vollasturen / SEER (koelen) of / SCOP (verwarmen) · richtwaarden België: koelen 250 tot 500 vollasturen per jaar, verwarmen 1.200 tot 1.800 · SEER en SCOP staan op het energielabel',
                    velden: [
                        { k: 'Pk', label: 'Koelvermogen', eh: 'kW', std: 3.5, min: 0, snel: [{ t: '2,5', v: 2.5 }, { t: '3,5', v: 3.5 }, { t: '5', v: 5 }, { t: '7,1', v: 7.1 }] },
                        { k: 'seer', label: 'SEER', std: 7, min: 1, snel: [{ t: 'A+ 5,6', v: 5.6 }, { t: 'A++ 6,1', v: 6.1 }, { t: 'A+++ 8,5', v: 8.5 }] },
                        { k: 'uk', label: 'Vollasturen koelen per jaar', eh: 'h', std: 350, min: 0 },
                        { k: 'Pv', label: 'Verwarmingsvermogen (0 = niet verwarmen)', eh: 'kW', std: 0, min: 0 },
                        { k: 'scop', label: 'SCOP', std: 4.6, min: 1, snel: [{ t: 'A+ 4,0', v: 4 }, { t: 'A++ 4,6', v: 4.6 }, { t: 'A+++ 5,1', v: 5.1 }] },
                        { k: 'uv', label: 'Vollasturen verwarmen per jaar', eh: 'h', std: 1400, min: 0 },
                        { k: 'prijs', label: 'Stroomprijs', eh: '€/kWh', std: 0.35, min: 0 },
                        { k: 'pg', label: 'Gasprijs (om te vergelijken)', eh: '€/kWh', std: 0.1, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var Ek = v.Pk * v.uk / v.seer, Qv = v.Pv * v.uv, Ev = Qv / v.scop, E = Ek + Ev;
                        var uit = [h.uit('Stroomverbruik per jaar', E, 'kWh', { dec: 0, hoofd: true, opm: '€ ' + h.fmt(E * v.prijs, 0) }), h.uit('Koelen', Ek, 'kWh', { dec: 0, opm: '€ ' + h.fmt(Ek * v.prijs, 0) + ' voor ' + h.fmt(v.Pk * v.uk, 0) + ' kWh koude' })];
                        var st = ['Koelen = ' + h.f(v.Pk, 1) + ' kW × ' + h.f(v.uk, 0) + ' h / ' + h.f(v.seer, 1) + ' = ' + h.f(Ek, 0, 'kWh')];
                        if (v.Pv > 0) {
                            uit.push(h.uit('Verwarmen', Ev, 'kWh', { dec: 0, opm: '€ ' + h.fmt(Ev * v.prijs, 0) + ' voor ' + h.fmt(Qv, 0) + ' kWh warmte' }), h.uit('Zelfde warmte met een gasketel (rendement 0,95)', Qv / 0.95 * v.pg, '€', { dec: 0, kleur: Qv / 0.95 * v.pg > Ev * v.prijs ? 'groen' : 'amber' }));
                            st.push('Verwarmen = ' + h.f(v.Pv, 1) + ' kW × ' + h.f(v.uv, 0) + ' h / ' + h.f(v.scop, 1) + ' = ' + h.f(Ev, 0, 'kWh'));
                        }
                        return { uit: uit, stappen: st };
                    }
                },
                {
                    id: 'koel.geluid', naam: 'Geluid van de buitenunit bij de buren', kort: 'Van het geluidsvermogen op de fiche naar het niveau op afstand',
                    zoek: 'geluid buitenunit warmtepomp airco buren decibel geluidsvermogen geluidsdruk afstand vlarem norm nacht 35 db lw lp', soort: 'indicatief',
                    bron: 'L_p = L_W − 20 × log(r) − 11 + 10 × log(Q) − afscherming · Q = 2 vrij op de grond of op een plat dak, 4 tegen een gevel, 8 in een hoek · toestel onder 5 kW elektrisch (niet ingedeeld): code van goede praktijk van het Departement Omgeving (2024): 45 dB(A) overdag en 40 dB(A) ’s nachts op de perceelsgrens · ingedeeld toestel (vanaf 5 kW elektrisch), nieuw, in woongebied: VLAREM II richtwaarde min 5 = 40 overdag, 35 ’s avonds, 30 ’s nachts',
                    uitleg: 'Het geluidsvermogen L_W staat op het energielabel en in de fiche. De geluidsdruk L_p is wat de buur hoort. Een muur vlak achter het toestel kaatst het geluid terug: tegen een gevel komt er 3 dB bij, in een hoek 6 dB. Bij een hoorbare toon (brom, fluit) telt de code 5 dB bij.',
                    velden: [
                        { k: 'Lw', label: 'Geluidsvermogen L_W van de buitenunit', eh: 'dB(A)', std: 58, min: 0, max: 120, snel: [{ t: 'Stil 52', v: 52 }, { t: '58', v: 58 }, { t: '62', v: 62 }, { t: 'Luid 68', v: 68 }] },
                        { k: 'r', label: 'Afstand tot de perceelgrens of het raam van de buur', eh: 'm', std: 5, min: 0.5 },
                        { k: 'Q', label: 'Opstelling', type: 'keuze', opties: [{ v: 2, t: 'Vrij op de grond of op een plat dak' }, { v: 4, t: 'Tegen een gevel' }, { v: 8, t: 'In een hoek tussen twee muren' }], std: 4 },
                        { k: 'scherm', label: 'Afscherming (geluidsscherm, omkasting)', eh: 'dB', std: 0, min: 0, max: 30, snel: [{ t: 'Geen 0', v: 0 }, { t: 'Scherm 5', v: 5 }, { t: 'Omkasting 10', v: 10 }] },
                        { k: 'grens', label: 'Toetsen aan', type: 'keuze', opties: [{ v: 40, t: 'Nacht, toestel onder 5 kW elektrisch: 40 dB(A)' }, { v: 45, t: 'Dag, toestel onder 5 kW elektrisch: 45 dB(A)' }, { v: 35, t: 'Avond, ingedeeld toestel in woongebied: 35 dB(A)' }, { v: 30, t: 'Nacht, ingedeeld toestel in woongebied: 30 dB(A)' }], std: 40 }
                    ],
                    bereken: function (v, h) {
                        var Q = Number(v.Q), grens = Number(v.grens);
                        var Lp = v.Lw - 20 * Math.log10(v.r) - 11 + 10 * Math.log10(Q) - v.scherm;
                        var rmin = Math.pow(10, (v.Lw - 11 + 10 * Math.log10(Q) - v.scherm - grens) / 20);
                        var rijen = [1, 2, 3, 5, 7.5, 10, 15, 20].map(function (r) { var l = v.Lw - 20 * Math.log10(r) - 11 + 10 * Math.log10(Q) - v.scherm; return [h.fmt(r, 1) + ' m', h.fmt(l, 1) + ' dB(A)', l <= grens ? VINK : 'te luid']; });
                        var waarsch = [];
                        if (Lp > grens) waarsch.push('Op ' + h.fmt(v.r, 1) + ' m is het ' + h.fmt(Lp - grens, 1) + ' dB luider dan de richtwaarde. Mogelijke oplossingen: een stiller toestel, een andere plaats (weg van gevel en hoek), een geluidsscherm of de nachtstand.');
                        return {
                            uit: [h.uit('Geluidsdruk op ' + h.fmt(v.r, 1) + ' m', Lp, 'dB(A)', { dec: 1, hoofd: true, kleur: Lp <= grens ? 'groen' : 'rood' }), h.uit('Afstand nodig voor ' + grens + ' dB(A)', rmin, 'm', { dec: 1, hoofd: true }), h.uit('Toeslag door de opstelling', 10 * Math.log10(Q) - 3, 'dB', { dec: 0, opm: 'ten opzichte van vrij op de grond' })],
                            stappen: ['L_p = ' + h.f(v.Lw, 1) + ' − 20 × log(' + h.f(v.r, 1) + ') − 11 + 10 × log(' + Q + ') − ' + h.f(v.scherm, 1) + ' = ' + h.f(Lp, 1, 'dB(A)')],
                            tabel: { kop: ['Afstand', 'Geluidsdruk', ''], rijen: rijen }, waarsch: waarsch,
                            opm: 'Richtwaarde. Weerkaatsing tegen andere muren, de nachtstand van het toestel en het achtergrondgeluid spelen mee. Het elektrisch vermogen van alle buitenunits samen bepaalt of de installatie ingedeeld is (VLAREM-rubriek voor koelinstallaties en warmtepompen: vanaf 5 kW). De gemeente kan strengere regels opleggen.'
                        };
                    }
                }
            ] },
            { naam: 'Koelmiddel', items: [
                {
                    id: 'koel.pt', naam: 'Koelmiddel: druk en temperatuur', kort: 'Verzadigingstemperatuur bij een druk, of de druk bij een temperatuur',
                    zoek: 'koelmiddel druk temperatuur verzadiging pt tabel manometer r32 r410a r290 r134a r407c r454b co2 verdampingstemperatuur condensatietemperatuur schuifregel', soort: 'indicatief',
                    bron: 'Verzadigingsdrukken op basis van NIST REFPROP, tussen de tabelpunten (om de 10 K) geïnterpoleerd op ln(p) tegen 1/T · manometerdruk = absolute druk − 1,013 bar',
                    uitleg: 'Vul de druk of de temperatuur in. Bij een mengsel met glijding (R407C, R454B, R454C) verschilt de temperatuur van de vloeistof en van de damp: kies damp voor de verdamper (oververhitting) en vloeistof voor de condensor (onderkoeling).',
                    velden: [
                        { k: 'km', label: 'Koelmiddel', type: 'keuze', opties: kmOpties(), std: 'R32' },
                        { k: 'p', label: 'Druk', eh: 'bar', ehs: ['bar', 'psi', 'kPa', 'MPa'], opt: true },
                        { k: 'abs', label: 'De druk is absoluut (geen manometerdruk)', type: 'vink', std: false },
                        { k: 'T', label: 'of temperatuur', eh: '°C', opt: true },
                        { k: 'soort', label: 'Lijn (bij een mengsel)', type: 'keuze', opties: [{ v: 'd', t: 'Damp (dauwpunt)' }, { v: 'b', t: 'Vloeistof (kookpunt)' }], std: 'd' }
                    ],
                    bereken: function (v, h) {
                        var K = km(v.km), uit = [], st = [];
                        if (v.p == null && v.T == null) return { wacht: true, ontbreekt: ['druk of temperatuur'] };
                        if (v.p != null) {
                            var pabs = v.abs ? v.p : v.p + P_ATM, T = tVan(K, pabs, v.soort);
                            if (T == null) return { fout: 'Deze druk valt buiten de tabel van ' + K.naam };
                            uit.push(h.uit('Verzadigingstemperatuur', T, '°C', { dec: 1, hoofd: true }), h.uit('Absolute druk', pabs, 'bar', { dec: 2 }), h.uit('Manometerdruk', pabs - P_ATM, 'bar', { dec: 2 }));
                            st.push('p_abs = ' + h.fmt(pabs, 2) + ' bar → T = ' + h.f(T, 1, '°C'));
                        } else {
                            var p = pVan(K, v.T, v.soort);
                            if (p == null) return { fout: 'Deze temperatuur valt buiten de tabel van ' + K.naam };
                            uit.push(h.uit('Manometerdruk', p - P_ATM, 'bar', { dec: 2, hoofd: true, opm: h.fmt((p - P_ATM) * 14.5038, 0) + ' psi' }), h.uit('Absolute druk', p, 'bar', { dec: 2 }));
                            st.push('T = ' + h.f(v.T, 1) + ' °C → p_abs = ' + h.f(p, 2, 'bar'));
                        }
                        var n = lijn(K, 'b').length;
                        var rijen = T_AS.slice(0, n).map(function (t, i) { var rij = [t + ' °C', h.fmt(K.b[i] - P_ATM, 2) + ' bar']; if (K.d) rij.push(h.fmt(K.d[i] - P_ATM, 2) + ' bar'); rij.push(h.fmt(K.b[i], 2) + ' bar'); return rij; });
                        return {
                            uit: uit, stappen: st, tabel: { kop: K.d ? ['Temperatuur', 'Manometer vloeistof', 'Manometer damp', 'Absoluut vloeistof'] : ['Temperatuur', 'Manometerdruk', 'Absolute druk'], rijen: rijen },
                            opm: K.klasse === 'A1' ? 'Werken aan het koelcircuit mag enkel door een gecertificeerde koeltechnicus.' : 'Brandbaar koelmiddel (' + K.klasse + '): geen open vuur, ventileren, en gereedschap dat voor dit koelmiddel geschikt is. Werken aan het koelcircuit mag enkel door een gecertificeerde koeltechnicus.'
                        };
                    }
                },
                {
                    id: 'koel.oververhitting', naam: 'Oververhitting en onderkoeling', kort: 'Uit de gemeten drukken en leidingtemperaturen',
                    zoek: 'oververhitting onderkoeling superheat subcooling zuigdruk persdruk zuiggas vloeistofleiding koelmiddel tekort te veel diagnose', soort: 'indicatief',
                    bron: 'Oververhitting = temperatuur van de zuigleiding − verdampingstemperatuur (damp) · onderkoeling = condensatietemperatuur (vloeistof) − temperatuur van de vloeistofleiding · richtwaarden: oververhitting 5 tot 10 K, onderkoeling 3 tot 8 K',
                    uitleg: 'Meet de druk met de manometers en de temperatuur met een klemvoeler op de blanke leiding, dicht bij het meetpunt. Bij een invertertoestel meet je in de testmodus op vast toerental. De waarden van de fabrikant gaan voor.',
                    velden: [
                        { k: 'km', label: 'Koelmiddel', type: 'keuze', opties: kmOpties(), std: 'R32' },
                        { k: 'pz', label: 'Zuigdruk (manometer)', eh: 'bar', ehs: ['bar', 'psi', 'kPa'], opt: true, min: -1 },
                        { k: 'Tz', label: 'Temperatuur van de zuigleiding', eh: '°C', opt: true },
                        { k: 'pp', label: 'Persdruk of vloeistofdruk (manometer)', eh: 'bar', ehs: ['bar', 'psi', 'kPa'], opt: true, min: -1 },
                        { k: 'Tv', label: 'Temperatuur van de vloeistofleiding', eh: '°C', opt: true }
                    ],
                    bereken: function (v, h) {
                        var K = km(v.km), uit = [], st = [], waarsch = [];
                        var heeftZ = v.pz != null && v.Tz != null, heeftP = v.pp != null && v.Tv != null;
                        if (!heeftZ && !heeftP) return { wacht: true, ontbreekt: ['zuigdruk met zuigtemperatuur, of persdruk met vloeistoftemperatuur'] };
                        if (heeftZ) {
                            var T0 = tVan(K, v.pz + P_ATM, 'd');
                            if (T0 == null) return { fout: 'De zuigdruk valt buiten de tabel van ' + K.naam };
                            var sh = v.Tz - T0;
                            uit.push(h.uit('Oververhitting', sh, 'K', { dec: 1, hoofd: true, kleur: sh < 3 ? 'rood' : sh > 12 ? 'amber' : 'groen' }), h.uit('Verdampingstemperatuur', T0, '°C', { dec: 1 }));
                            st.push('Verdamping bij ' + h.fmt(v.pz, 2) + ' bar manometer = ' + h.f(T0, 1, '°C'), 'Oververhitting = ' + h.f(v.Tz, 1) + ' − ' + h.fmt(T0, 1) + ' = ' + h.f(sh, 1, 'K'));
                            if (sh < 0) waarsch.push('Negatieve oververhitting kan niet: controleer het koelmiddel, de manometer en de plaats van de voeler.');
                            else if (sh < 3) waarsch.push('Weinig oververhitting: er kan vloeistof naar de compressor komen. Mogelijke oorzaken: te veel koelmiddel, te weinig lucht over de verdamper (vuile filter, ventilator), expansieventiel te ver open.');
                            else if (sh > 12) waarsch.push('Veel oververhitting: de verdamper krijgt te weinig koelmiddel. Mogelijke oorzaken: te weinig koelmiddel (lek), verstopt filter of expansieventiel, te veel warmtelast.');
                        }
                        if (heeftP) {
                            var Tc = tVan(K, v.pp + P_ATM, 'b');
                            if (Tc == null) return { fout: 'De persdruk valt buiten de tabel van ' + K.naam };
                            var sc = Tc - v.Tv;
                            uit.push(h.uit('Onderkoeling', sc, 'K', { dec: 1, hoofd: true, kleur: sc < 2 ? 'rood' : sc > 10 ? 'amber' : 'groen' }), h.uit('Condensatietemperatuur', Tc, '°C', { dec: 1 }));
                            st.push('Condensatie bij ' + h.fmt(v.pp, 2) + ' bar manometer = ' + h.f(Tc, 1, '°C'), 'Onderkoeling = ' + h.fmt(Tc, 1) + ' − ' + h.f(v.Tv, 1) + ' = ' + h.f(sc, 1, 'K'));
                            if (sc < 0) waarsch.push('Negatieve onderkoeling kan niet: controleer het koelmiddel, de manometer en de plaats van de voeler.');
                            else if (sc < 2) waarsch.push('Weinig onderkoeling: er zit damp in de vloeistofleiding. Mogelijke oorzaak: te weinig koelmiddel.');
                            else if (sc > 10) waarsch.push('Veel onderkoeling: vloeistof stapelt zich op in de condensor. Mogelijke oorzaken: te veel koelmiddel of een verstopping in de vloeistofleiding.');
                        }
                        return { uit: uit, stappen: st, waarsch: waarsch, opm: 'Beoordeel oververhitting en onderkoeling altijd samen, bij een stabiel draaiend toestel (minstens 10 minuten). Bijvullen gebeurt op gewicht volgens de fiche, niet op de manometer.' };
                    }
                },
                {
                    id: 'vent.koelmiddel', naam: 'Koelmiddel: extra vulling en F-gassen', kort: 'Bijvullen bij langere leidingen, CO₂-equivalent en lekcontrole',
                    zoek: 'koelmiddel bijvullen extra vulling leidinglengte r32 r410a gwp co2 equivalent f-gassen lekcontrole', soort: 'exact',
                    bron: 'Extra vulling = (leidinglengte − voorgevulde lengte) × g/m (fiche van de fabrikant; bij kleine splittoestellen meestal 20 g/m, voorgevuld tot 7 à 10 m) · CO₂-eq = kg × GWP · (EU) 2024/573 artikel 5: lekcontrole vanaf 5 t CO₂-eq (hermetisch gesloten 10 t) om de 12 maanden, vanaf 50 t om de 6 maanden, vanaf 500 t om de 3 maanden · HFO’s (R1234yf, R1234ze, ook als deel van een mengsel): vanaf 1 kg (hermetisch 2 kg), 10 kg en 100 kg · met een lekdetectiesysteem verdubbelt de termijn',
                    velden: [
                        { k: 'km', label: 'Koelmiddel', type: 'keuze', opties: kmOpties(), std: 'R32' },
                        { k: 'vul', label: 'Fabrieksvulling', eh: 'kg', std: 1.2, min: 0 },
                        { k: 'L', label: 'Leidinglengte', eh: 'm', std: 15, min: 0 },
                        { k: 'L0', label: 'Voorgevuld tot', eh: 'm', std: 10, min: 0, snel: [{ t: '5', v: 5 }, { t: '7', v: 7 }, { t: '7,5', v: 7.5 }, { t: '10', v: 10 }] },
                        { k: 'gm', label: 'Bijvullen per meter', eh: 'g/m', std: 20, min: 0, snel: [{ t: '10', v: 10 }, { t: '20', v: 20 }, { t: '40', v: 40 }] },
                        { k: 'herm', label: 'Hermetisch gesloten (fabrieksdicht, monoblok)', type: 'vink', std: false },
                        { k: 'woning', label: 'Opgesteld in een woning', type: 'vink', std: true }
                    ],
                    bereken: function (v, h) {
                        var K = km(v.km);
                        var extra = Math.max(0, v.L - v.L0) * v.gm / 1000, tot = v.vul + extra, co2 = tot * K.gwp / 1000, lek = lekcontrole(K, tot, v.herm, v.woning);
                        var uit = [h.uit('Bij te vullen', extra * 1000, 'g', { dec: 0, hoofd: true }), h.uit('Totale vulling', tot, 'kg', { dec: 2 }), h.uit('CO₂-equivalent', co2, 't', { dec: 2, hoofd: true, kleur: lek.klasse ? 'amber' : 'groen' })];
                        if (lek.hfo > 0) uit.push(h.uit('Waarvan HFO', lek.hfo, 'kg', { dec: 2 }));
                        uit.push(h.uit('Lekcontrole', lek.t, '', { opm: lek.waarom || '' }));
                        return { uit: uit, stappen: ['Extra = (' + h.f(v.L) + ' − ' + h.f(v.L0) + ') × ' + h.f(v.gm) + ' g/m = ' + h.f(extra * 1000, 0, 'g'), 'CO₂-eq = ' + h.fmt(tot, 2) + ' kg × ' + h.fmt(K.gwp, K.gwp < 10 ? 2 : 0) + ' = ' + h.f(co2, 2, 't')], opm: lek.fgas ? 'Registreer elke vulling en elke lekcontrole in het logboek van de installatie. Werken aan het koelcircuit mag enkel door een gecertificeerde koeltechnicus.' : 'Geen F-gas, maar wel een brandbaar of hogedrukkoelmiddel: volg de voorschriften van de fabrikant.' };
                    }
                },
                {
                    id: 'koel.ruimte', naam: 'Kleinste ruimte bij brandbaar koelmiddel', kort: 'Minimale vloeroppervlakte voor R32, R290 en andere A2L- of A3-koelmiddelen',
                    zoek: 'minimale vloeroppervlakte ruimte brandbaar koelmiddel r32 r290 propaan a2l a3 lfl vulling iec 60335-2-40 en 378 binnenunit monoblok', soort: 'indicatief',
                    bron: 'IEC 60335-2-40 bijlage GG: A_min = (m / (2,5 × LFL^(5/4) × h₀))² · voor A2L ook A_min ≥ m / (0,75 × LFL × h₀) · geen eis onder m₁ = 6 m³ × LFL (A2L) of 4 m³ × LFL (A3) · h₀ = hoogte van de opstelling · nagerekend met de tabellen van Daikin (2024) en Hitachi',
                    uitleg: 'Bij een lek mag de concentratie in de ruimte de onderste ontvlambaarheidsgrens (LFL) niet halen. De tabel in de handleiding van het toestel gaat voor: sommige fabrikanten rekenen strenger, en toestellen met extra beveiliging (lekdetectie, ventilatie) mogen in een kleinere ruimte.',
                    velden: [
                        { k: 'km', label: 'Koelmiddel', type: 'keuze', opties: kmOpties(function (K) { return K.lfl; }), std: 'R32' },
                        { k: 'm', label: 'Totale vulling van het circuit', eh: 'kg', std: 2, min: 0 },
                        { k: 'h0', label: 'Opstelling van de binnenunit', type: 'keuze', opties: OPSTELLING, std: 1.8 },
                        { k: 'A', label: 'Vloeroppervlakte van de ruimte', eh: 'm²', opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var K = km(v.km), h0 = Number(v.h0), a2l = K.klasse === 'A2L', m1 = (a2l ? 6 : 4) * K.lfl, m2 = (a2l ? 52 : 26) * K.lfl;
                        function kwadraat(m, hh) { return Math.pow(m / (2.5 * Math.pow(K.lfl, 1.25) * hh), 2); }
                        function lineair(m, hh) { return a2l ? m / (0.75 * K.lfl * hh) : 0; }
                        function amin(m, hh) { return m <= m1 ? 0 : Math.max(kwadraat(m, hh), lineair(m, hh)); }
                        function mmax(A, hh) { var a = 2.5 * Math.pow(K.lfl, 1.25) * hh * Math.sqrt(A); return Math.max(m1, a2l ? Math.min(a, 0.75 * K.lfl * hh * A) : a); }
                        var Amin = amin(v.m, h0);
                        var uit = [h.uit('Minimale vloeroppervlakte', v.m <= m1 ? 'geen eis' : h.fmt(Amin, 1) + ' m²', '', { hoofd: true, kleur: v.A != null && Amin > v.A ? 'rood' : 'groen', opm: v.m <= m1 ? 'vulling onder ' + h.fmt(m1, 2) + ' kg' : '' }), h.uit('Grens zonder eis (m₁)', m1, 'kg', { dec: 3 }), h.uit('Onderste ontvlambaarheidsgrens', K.lfl, 'kg/m³', { dec: 3 })];
                        var st = ['m₁ = ' + (a2l ? 6 : 4) + ' × ' + h.fmt(K.lfl, 3) + ' = ' + h.f(m1, 3, 'kg')];
                        if (v.m > m1) {
                            st.push('A = (' + h.f(v.m, 2) + ' / (2,5 × ' + h.fmt(K.lfl, 3) + '^1,25 × ' + h.fmt(h0, 1) + '))² = ' + h.f(kwadraat(v.m, h0), 2, 'm²'));
                            if (a2l) st.push('A = ' + h.f(v.m, 2) + ' / (0,75 × ' + h.fmt(K.lfl, 3) + ' × ' + h.fmt(h0, 1) + ') = ' + h.f(lineair(v.m, h0), 2, 'm²') + ': de grootste van de twee telt');
                        }
                        var waarsch = [];
                        if (v.A != null) {
                            uit.push(h.uit('Grootste vulling voor ' + h.fmt(v.A, 1) + ' m²', mmax(v.A, h0), 'kg', { dec: 2, hoofd: true }));
                            if (Amin > v.A) waarsch.push('De ruimte is te klein voor deze vulling. Kies een andere opstelling (hoger aan de wand), een toestel met minder koelmiddel of een toestel met extra beveiliging volgens de fabrikant.');
                        }
                        if (v.m > m2) waarsch.push('Vulling boven m₂ = ' + h.fmt(m2, 2) + ' kg: er gelden bijkomende eisen (ventilatie, lekdetectie). Volg de handleiding en EN 378.');
                        if (!a2l) waarsch.push('Koolwaterstof (A3): binnen opgestelde toestellen mogen maar heel weinig koelmiddel bevatten. Een monoblok buiten valt niet onder deze berekening.');
                        var rijen = OPSTELLING.map(function (o) { return [o.t, v.m <= m1 ? 'geen eis' : h.fmt(amin(v.m, o.v), 1) + ' m²']; });
                        return { uit: uit, stappen: st, waarsch: waarsch, tabel: { kop: ['Opstelling', 'Minimale vloeroppervlakte'], rijen: rijen, kies: OPSTELLING.map(function (o) { return o.v; }).indexOf(h0) } };
                    }
                }
            ] },
            { naam: 'Montage en controle', items: [
                {
                    id: 'koel.vacuum', naam: 'Vacumeren: druk en kookpunt van water', kort: 'Micron, mbar en Pa omrekenen, en zien of het vocht eruit is',
                    zoek: 'vacuum vacumeren vacuumpomp micron mbar pascal torr kookpunt water vocht droog koelcircuit 500 micron', soort: 'exact',
                    bron: '1 Torr = 1 mmHg = 133,322 Pa · 1 micron = 0,001 Torr = 0,1333 Pa · kookpunt van water uit de dampdruk (Magnus, onder 6,1 mbar boven ijs) · streefwaarde bij een koelcircuit: 500 micron (0,67 mbar) of lager, en daarna een standtijd zonder stijging',
                    velden: [
                        { k: 'p', label: 'Druk op de vacuümmeter', std: 500, min: 0 },
                        { k: 'eh', label: 'Eenheid', type: 'keuze', opties: [{ v: 'micron', t: 'micron' }, { v: 'mbar', t: 'mbar (hPa)' }, { v: 'Pa', t: 'Pa' }, { v: 'Torr', t: 'Torr (mmHg)' }], std: 'micron' },
                        { k: 'T', label: 'Omgevingstemperatuur', eh: '°C', std: 20 }
                    ],
                    bereken: function (v, h) {
                        var Pa = R.conv(v.p, v.eh, 'Pa', 'druk');
                        if (!(Pa > 0)) return { fout: 'De druk moet groter zijn dan 0' };
                        var hPa = Pa / 100, Tk = kookpuntWater(hPa), micron = Pa / 0.133322;
                        var oordeel = micron <= 500 ? 'diep genoeg' : micron <= 1000 ? 'bijna: nog even doorpompen' : micron <= 5000 ? 'nog vocht of een lek' : 'nog ver van het doel';
                        var waarsch = [];
                        if (Tk >= v.T) waarsch.push('Bij deze druk kookt water pas op ' + h.fmt(Tk, 0) + ' °C: het vocht in de leidingen verdampt nog niet bij ' + h.fmt(v.T, 0) + ' °C.');
                        var rijen = [[5000, ''], [2000, ''], [1000, ''], [500, 'streefwaarde'], [250, ''], [100, '']].map(function (x) { var pa = x[0] * 0.133322; return [h.fmt(x[0], 0), h.fmt(pa / 100, 2), h.fmt(pa, 0), h.fmt(kookpuntWater(pa / 100), 0) + ' °C', x[1]]; });
                        return {
                            uit: [h.uit('Kookpunt van water bij deze druk', Tk, '°C', { dec: 1, hoofd: true }), h.uit('Oordeel', oordeel, '', { hoofd: true, kleur: micron <= 500 ? 'groen' : micron <= 1000 ? 'amber' : 'rood' }), h.uit('In micron', micron, 'micron', { dec: 0 }), h.uit('In mbar', hPa, 'mbar', { dec: 3 }), h.uit('In Pa', Pa, 'Pa', { dec: 1 }), h.uit('In Torr', Pa / 133.322, 'Torr', { dec: 3 })],
                            stappen: ['p = ' + h.f(v.p) + ' ' + v.eh + ' = ' + h.f(hPa, 3, 'mbar'), 'Kookpunt van water bij ' + h.fmt(hPa, 3) + ' mbar = ' + h.f(Tk, 1, '°C')],
                            tabel: { kop: ['Micron', 'mbar', 'Pa', 'Water kookt op', ''], rijen: rijen, kies: 3 }, waarsch: waarsch,
                            opm: 'Sluit na het vacumeren de pomp af en wacht minstens 10 tot 15 minuten. Stijgt de druk en blijft ze dan stabiel: er zat nog vocht in. Blijft ze stijgen: er is een lek. Meet met een elektronische vacuümmeter, niet met de manometerset.'
                        };
                    }
                },
                {
                    id: 'koel.drukproef', naam: 'Drukproef: invloed van de temperatuur', kort: 'Welke druk hoort er te staan als de temperatuur veranderd is?',
                    zoek: 'drukproef druktest dichtheidsproef afpersen stikstof lektest temperatuur correctie druk daalt gasleiding koelcircuit perslucht', soort: 'exact',
                    bron: 'Wet van Gay-Lussac bij constant volume: p₂ / p₁ = T₂ / T₁ met absolute druk (manometer + 1,013 bar) en temperatuur in kelvin',
                    uitleg: 'Een gas onder druk volgt de temperatuur. Koelt de leiding ’s nachts af, dan daalt de druk zonder dat er een lek is. Vergelijk de gemeten druk met de verwachte druk.',
                    velden: [
                        { k: 'p1', label: 'Druk bij de start (manometer)', eh: 'bar', ehs: ['bar', 'mbar', 'psi', 'kPa'], std: 40, min: 0 },
                        { k: 'T1', label: 'Temperatuur bij de start', eh: '°C', std: 25, min: -50 },
                        { k: 'T2', label: 'Temperatuur bij de controle', eh: '°C', std: 15, min: -50 },
                        { k: 'p2', label: 'Druk bij de controle (manometer)', eh: 'bar', ehs: ['bar', 'mbar', 'psi', 'kPa'], opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var verw = (v.p1 + P_ATM) * (v.T2 + 273.15) / (v.T1 + 273.15) - P_ATM;
                        var uit = [h.uit('Verwachte druk zonder lek', verw, 'bar', { dec: 2, hoofd: true }), h.uit('Verandering door de temperatuur', verw - v.p1, 'bar', { dec: 2, opm: h.fmt((v.p1 + P_ATM) / (v.T1 + 273.15), 3) + ' bar per graad' })];
                        var st = ['p₂ = (' + h.f(v.p1, 2) + ' + 1,013) × (' + h.f(v.T2, 1) + ' + 273,15) / (' + h.f(v.T1, 1) + ' + 273,15) − 1,013 = ' + h.f(verw, 2, 'bar')];
                        var waarsch = [];
                        if (v.p2 != null) {
                            var d = v.p2 - verw, grens = Math.max(0.02, 0.005 * (v.p1 + P_ATM));
                            uit.push(h.uit('Verschil met de meting', d, 'bar', { dec: 2, hoofd: true, kleur: d < -grens ? 'rood' : 'groen', opm: d < -grens ? 'de druk is meer gedaald dan de temperatuur verklaart' : 'binnen de meetmarge' }));
                            if (d < -grens) waarsch.push('De druk ligt ' + h.fmt(-d, 2) + ' bar lager dan verwacht: zoek het lek met lekzoekspray of een lekdetector.');
                        }
                        return { uit: uit, stappen: st, waarsch: waarsch, opm: 'Meet de temperatuur van de leiding zelf, niet van de lucht. Gebruik droge stikstof, nooit zuurstof of perslucht met olie op een koelcircuit. De testdruk en de duur staan in de handleiding van het toestel of in de norm van de installatie.' };
                    }
                },
                {
                    id: 'koel.condens', naam: 'Condenswater van een airco', kort: 'Liter per uur en per dag, en de afvoer',
                    zoek: 'condens condenswater airco afvoer condenspomp liter per uur ontvochtigen binnenunit lekbak afschot', soort: 'indicatief',
                    bron: 'Latente warmte = koelvermogen × (1 − aandeel voelbare warmte) · condens = latente warmte / 2.450 kJ/kg · aandeel voelbaar: droge lucht 0,85, normaal 0,75, vochtig 0,65',
                    velden: [
                        { k: 'P', label: 'Koelvermogen', eh: 'kW', ehs: ['kW', 'W', 'BTU/h'], std: 3.5, min: 0 },
                        { k: 'shr', label: 'Aandeel voelbare warmte', std: 0.75, min: 0.4, max: 1, snel: [{ t: 'Droog 0,85', v: 0.85 }, { t: 'Normaal 0,75', v: 0.75 }, { t: 'Vochtig 0,65', v: 0.65 }] },
                        { k: 'uren', label: 'Draaiuren per dag', eh: 'h', std: 8, min: 0, max: 24 },
                        { k: 'H', label: 'Opvoerhoogte tot de afvoer (voor een condenspomp)', eh: 'm', opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var lat = v.P * (1 - v.shr), lh = lat * 3600 / 2450;
                        var uit = [h.uit('Condenswater', lh, 'l/h', { dec: 2, hoofd: true }), h.uit('Per dag', lh * v.uren, 'l', { dec: 1, hoofd: true }), h.uit('Latente warmte', lat, 'kW', { dec: 2 })];
                        if (v.H != null) uit.push(h.uit('Condenspomp kiezen', 'minstens ' + h.fmt(Math.max(5, Math.ceil(lh * 2)), 0) + ' l/h bij ' + h.fmt(v.H, 1) + ' m', '', { opm: 'twee keer het berekende debiet als reserve' }));
                        return { uit: uit, stappen: ['Latent = ' + h.f(v.P, 2) + ' kW × (1 − ' + h.f(v.shr, 2) + ') = ' + h.f(lat, 2, 'kW'), 'Condens = ' + h.fmt(lat, 2) + ' × 3.600 / 2.450 = ' + h.f(lh, 2, 'l/h')], opm: 'Afvoer met minstens 1 cm afschot per meter, binnendiameter minstens 16 mm, met een sifon als de afvoer op de riolering komt. Isoleer de condensleiding binnen tegen zweten.' };
                    }
                },
                {
                    id: 'koel.flare', naam: 'Koelleidingen en flaremoeren', kort: 'Naslag: maten in duim en mm, en het aanhaalmoment',
                    zoek: 'flare flaremoer aanhaalmoment koelleiding duim mm 1/4 3/8 1/2 5/8 momentsleutel naslag koperen leiding', soort: 'naslag',
                    bron: 'Installatiehandleidingen van Daikin, Mitsubishi Electric en Panasonic voor splittoestellen op R32 en R410A (nagekeken 29 sep 2026). De handleiding van het toestel gaat voor.',
                    velden: [],
                    bereken: function () {
                        return {
                            tabel: { kop: ['Leiding', 'Daikin', 'Mitsubishi Electric', 'Panasonic'], rijen: [
                                ['1/4" (6,35 mm)', '14 tot 17 N·m', '14 tot 18 N·m', '18 N·m'], ['3/8" (9,52 mm)', '33 tot 40 N·m', '34 tot 42 N·m', '42 N·m'], ['1/2" (12,7 mm)', '50 tot 60 N·m', '49 tot 61 N·m', '55 N·m'],
                                ['5/8" (15,88 mm)', '62 tot 75 N·m', '68 tot 82 N·m', '65 N·m'], ['3/4" (19,05 mm)', 'zie handleiding', 'zie handleiding', '100 N·m']
                            ] },
                            opm: 'Gebruik een flare-apparaat voor R32 en R410A, ontbraam de buis met de opening naar beneden, smeer de flare licht in met koelmachineolie en span aan met een momentsleutel en een tegensleutel. Te vast breekt de flare, te los lekt ze.'
                        };
                    }
                }
            ] }
        ]
    });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-airco */
