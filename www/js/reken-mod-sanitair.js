/* QE Rekenmachine — module Sanitair (v408)
 * BRON = QE-Software/reken-mod-sanitair.js; kopie in de www via `node sync-reken.js`.
 * Normen/bronnen: NBN EN 806-3 (drinkwaterleidingen, LU-methode, vereenvoudigd), NBN EN 12056-2
 * (afvoer, systeem I, DU en K), NBN EN 12056-3 (regenwater), Vlaamse Hemelwaterverordening 2023,
 * EN 1825 (vetafscheiders), Vlarem II (septische put/IBA), Belgaqua.
 */
(function (root) {
    'use strict';
    var R = root.QEReken;
    if (!R) throw new Error('reken-kern.js eerst laden');
    var W = R.WATER, BUIZEN = R.BUIZEN;
    var E_WATER = { 40: 0.0079, 45: 0.0099, 50: 0.0121, 55: 0.0145, 60: 0.0171, 65: 0.0198, 70: 0.0228, 75: 0.0258, 80: 0.029, 90: 0.0359 };

    // EN 806-3: belastingseenheden (LU) en minimumdebiet per tappunt
    var TAP = [
        { v: 'wastafel', t: 'Wastafel', lu: 1, q: 0.1 }, { v: 'wc', t: 'WC met spoelbak', lu: 1, q: 0.1 }, { v: 'bidet', t: 'Bidet', lu: 1, q: 0.1 },
        { v: 'douche', t: 'Douche', lu: 2, q: 0.15 }, { v: 'regendouche', t: 'Regendouche / grote douchekop', lu: 4, q: 0.3 }, { v: 'bad', t: 'Bad', lu: 4, q: 0.3 },
        { v: 'gootsteen', t: 'Keukenspoelbak', lu: 2, q: 0.2 }, { v: 'vaatwasser', t: 'Vaatwasser', lu: 2, q: 0.2 }, { v: 'wasmachine', t: 'Wasmachine', lu: 2, q: 0.2 },
        { v: 'urinoir', t: 'Urinoir', lu: 1, q: 0.1 }, { v: 'buitenkraan', t: 'Buitenkraan / tuinkraan', lu: 5, q: 0.3 }, { v: 'uitgietbak', t: 'Uitgietbak / wasbak berging', lu: 2, q: 0.2 }
    ];
    // EN 12056-2, systeem I: DU (l/s) per toestel + minimale aansluitmaat
    var DU = [
        { v: 'wastafel', t: 'Wastafel / bidet', du: 0.5, dn: 40 }, { v: 'douche', t: 'Douche zonder stop', du: 0.6, dn: 50 }, { v: 'douchestop', t: 'Douche met stop', du: 0.8, dn: 50 },
        { v: 'bad', t: 'Bad', du: 0.8, dn: 50 }, { v: 'gootsteen', t: 'Keukenspoelbak', du: 0.8, dn: 50 }, { v: 'vaatwasser', t: 'Vaatwasser', du: 0.8, dn: 50 },
        { v: 'wasmachine', t: 'Wasmachine (tot 6 kg)', du: 0.8, dn: 50 }, { v: 'wasmachine12', t: 'Wasmachine (tot 12 kg)', du: 1.5, dn: 50 }, { v: 'wc', t: 'WC 6 l', du: 2.0, dn: 90 }, { v: 'wc9', t: 'WC 9 l', du: 2.5, dn: 90 },
        { v: 'urinoir', t: 'Urinoir', du: 0.5, dn: 50 }, { v: 'vloer50', t: 'Vloerafvoer DN50', du: 0.8, dn: 50 }, { v: 'vloer70', t: 'Vloerafvoer DN70', du: 1.5, dn: 70 }, { v: 'vloer100', t: 'Vloerafvoer DN100', du: 2.0, dn: 100 }
    ];
    // valleidingen (EN 12056-2 tabel 11): capaciteit l/s, primair / met secundaire ontluchting
    var VAL = [{ dn: 70, p: 1.5, s: 2.0 }, { dn: 80, p: 2.0, s: 2.6 }, { dn: 90, p: 2.7, s: 3.5 }, { dn: 100, p: 4.0, s: 5.2 }, { dn: 125, p: 5.8, s: 7.6 }, { dn: 150, p: 9.5, s: 12.4 }, { dn: 200, p: 16, s: 21 }];
    // liggende leidingen: PVC binnendiameters (mm) per nominale maat
    var LIG = [{ dn: 50, d: 46.4 }, { dn: 75, d: 69.4 }, { dn: 90, d: 84.4 }, { dn: 110, d: 103.6 }, { dn: 125, d: 118.6 }, { dn: 160, d: 152.4 }, { dn: 200, d: 190.2 }];
    function manningHalf(d_mm, S) {   // capaciteit bij vullingsgraad h/d = 0,5, n = 0,010 (kunststof) → l/s
        var d = d_mm / 1000, A = Math.PI * d * d / 4, Rh = d / 4;
        return 0.5 * (1 / 0.010) * A * Math.pow(Rh, 2 / 3) * Math.sqrt(S) * 1000;
    }
    function buisOpties() {
        var o = [];
        Object.keys(BUIZEN).forEach(function (k) { if (k === 'pvc' || k === 'staal' || k === 'staalpers') return; BUIZEN[k].maten.forEach(function (m) { o.push({ v: k + '|' + m.n, t: BUIZEN[k].naam.split(' (')[0] + ' ' + m.n + ' (' + R.fmt(m.d, 1) + ' mm)' }); }); });
        return o;
    }
    function buis(key) { var p = key.split('|'), mat = BUIZEN[p[0]]; var m = mat ? mat.maten.filter(function (x) { return x.n === p[1]; })[0] : null; return m ? { mat: mat, m: m } : null; }

    // v411 — DIN 4708-2: bezetting per woninggrootte en behoefte per tappunt in Wh (planningsgids Viessmann)
    var DIN4708_P = [{ v: 2, t: '1 tot 2 kamers (2,0 personen)' }, { v: 2.3, t: '2,5 kamers (2,3)' }, { v: 2.7, t: '3 kamers (2,7)' }, { v: 3.1, t: '3,5 kamers (3,1)' }, { v: 3.5, t: '4 kamers (3,5)' }, { v: 3.9, t: '4,5 kamers (3,9)' }, { v: 4.3, t: '5 kamers (4,3)' }, { v: 4.6, t: '5,5 kamers (4,6)' }, { v: 5, t: '6 kamers (5,0)' }, { v: 5.4, t: '6,5 kamers (5,4)' }, { v: 5.6, t: '7 kamers (5,6)' }];
    var DIN4708_TAP = [{ v: 'nb1', t: 'Bad 140 l', wv: 5820 }, { v: 'nb2', t: 'Bad 160 l', wv: 6510 }, { v: 'kb', t: 'Klein bad 120 l', wv: 4890 }, { v: 'gb', t: 'Groot bad 200 l', wv: 8720 }, { v: 'dn', t: 'Douche in plaats van bad', wv: 5820 }, { v: 'brs', t: 'Extra douche, spaarkop', wv: 1630 }, { v: 'brn', t: 'Extra douche, gewone kop', wv: 3660 }, { v: 'brl', t: 'Extra douche, luxe', wv: 7320 }, { v: 'wt', t: 'Wastafel', wv: 700 }, { v: 'bd', t: 'Bidet', wv: 810 }, { v: 'sp', t: 'Keukenspoelbak', wv: 1160 }];
    R.registreer({
        key: 'sanitair', naam: 'Sanitair', emoji: '🚿', volgorde: 2,
        omschrijving: 'Warm water en boilers, collectief warm water, leidingen en druk, afvoeren, regenwater en infiltratie, hardheid en lekken',
        groepen: [
            { naam: 'Warm water', items: [
                {
                    id: 'san.boiler', naam: 'Boilerinhoud kiezen', kort: 'Dagbehoefte aan warm water en de boiler die erbij past',
                    zoek: 'boiler inhoud kiezen liter personen warm water behoefte warmtepompboiler elektrische boiler indirect', soort: 'indicatief',
                    bron: 'Richtwaarden warmwaterbehoefte per persoon per dag (op 60 °C): zuinig 30 l, normaal 45 l, comfort 60 l; bad ±100 l op 40 °C = 60 l op 60 °C · elektrische boiler laadt ’s nachts (inhoud ≈ dagbehoefte), indirecte boiler herlaadt snel (≈ 60 %), warmtepompboiler traag (≈ 110 %)',
                    velden: [
                        { k: 'pers', label: 'Personen', std: 4, min: 1 },
                        { k: 'comfort', label: 'Gebruik', type: 'keuze', opties: [{ v: 30, t: 'Zuinig (korte douches) — 30 l/persoon' }, { v: 45, t: 'Normaal — 45 l/persoon' }, { v: 60, t: 'Comfort (lange douches, regendouche) — 60 l/persoon' }], std: 45 },
                        { k: 'baden', label: 'Baden per dag', std: 0, min: 0 },
                        { k: 'extra', label: 'Extra (keuken, wasbak…)', eh: 'l/dag', std: 10 }
                    ],
                    bereken: function (v, h) {
                        var dag = v.pers * Number(v.comfort) + v.baden * 60 + v.extra;
                        var maten = [50, 80, 100, 120, 150, 200, 250, 300, 400, 500];
                        var el = h.omhoogNaar(dag * 1.0, maten), ind = h.omhoogNaar(dag * 0.6, maten), wpb = h.omhoogNaar(dag * 1.1, maten);
                        var E = dag * W.wh_l_K * 50 / 1000;
                        return {
                            uit: [h.uit('Dagbehoefte (op 60 °C)', dag, 'l', { dec: 0, hoofd: true }), h.uit('Elektrische boiler (nachtlading)', el, 'l', { hoofd: true }), h.uit('Indirecte boiler op de ketel', ind, 'l'), h.uit('Warmtepompboiler', wpb, 'l'), h.uit('Energie per dag (ΔT 50 K)', E, 'kWh', { dec: 1, opm: '± ' + h.fmt(E * 365, 0) + ' kWh per jaar' })],
                            stappen: ['Dagbehoefte = ' + v.pers + ' × ' + Number(v.comfort) + ' + ' + v.baden + ' × 60 + ' + h.f(v.extra) + ' = ' + h.f(dag, 0, 'l')],
                            opm: 'Ochtendpiek: reken op de helft van de dagbehoefte binnen één uur. Zie ook “Douches uit een boiler”.'
                        };
                    }
                },
                {
                    id: 'san.douches', naam: 'Douches uit een boiler', kort: 'Hoeveel mengwater en hoeveel douches uit één boiler?',
                    zoek: 'douche boiler liter mengwater hoeveel douches minuten warm water op', soort: 'exact',
                    bron: 'V_meng = V × (T_boiler − T_koud) / (T_douche − T_koud) · douche = debiet × minuten',
                    velden: [
                        { k: 'V', label: 'Boilerinhoud', eh: 'l', std: 150 },
                        { k: 'Tb', label: 'Boilertemperatuur', eh: '°C', std: 60 },
                        { k: 'Tk', label: 'Koudwatertemperatuur', eh: '°C', std: 10 },
                        { k: 'Td', label: 'Douchetemperatuur', eh: '°C', std: 38 },
                        { k: 'q', label: 'Douchedebiet', eh: 'l/min', std: 9, snel: [{ t: 'Spaarkop 6', v: 6 }, { t: 'Normaal 9', v: 9 }, { t: 'Regendouche 15', v: 15 }] },
                        { k: 'min', label: 'Minuten per douche', eh: 'min', std: 8 }
                    ],
                    bereken: function (v, h) {
                        if (v.Tb <= v.Td || v.Td <= v.Tk) return { fout: 'Boiler > douche > koud water' };
                        var Vm = v.V * (v.Tb - v.Tk) / (v.Td - v.Tk), perDouche = v.q * v.min, n = Vm / perDouche;
                        return {
                            uit: [h.uit('Mengwater op ' + h.fmt(v.Td) + ' °C', Vm, 'l', { dec: 0, hoofd: true }), h.uit('Douches van ' + h.fmt(v.min) + ' min', Math.floor(n * 10) / 10, '', { hoofd: true }), h.uit('Douchetijd in totaal', Vm / v.q, 'min', { dec: 0 }), h.uit('Energie per douche', perDouche * (v.Td - v.Tk) * W.wh_l_K / 1000, 'kWh', { dec: 2 })],
                            stappen: ['V_meng = ' + h.f(v.V) + ' × (' + h.f(v.Tb) + ' − ' + h.f(v.Tk) + ') / (' + h.f(v.Td) + ' − ' + h.f(v.Tk) + ') = ' + h.f(Vm, 0, 'l'), 'Douches = ' + h.fmt(Vm, 0) + ' / (' + h.f(v.q) + ' × ' + h.f(v.min) + ') = ' + h.fmt(n, 1)],
                            opm: 'In de praktijk iets minder: de boiler mengt bij het tappen en de laatste liters zijn lauw.'
                        };
                    }
                },
                {
                    id: 'san.mengwater', naam: 'Mengwater', kort: 'Verhouding warm en koud voor een gewenste temperatuur',
                    zoek: 'mengwater mengkraan thermostatisch verhouding warm koud temperatuur mengen', soort: 'exact',
                    bron: 'Aandeel warm = (T_gewenst − T_koud) / (T_warm − T_koud)',
                    velden: [
                        { k: 'Tw', label: 'Warm water', eh: '°C', std: 60 },
                        { k: 'Tk', label: 'Koud water', eh: '°C', std: 10 },
                        { k: 'Tg', label: 'Gewenste temperatuur', eh: '°C', std: 38 },
                        { k: 'Q', label: 'Gewenst debiet (optioneel)', eh: 'l/min', opt: true }
                    ],
                    bereken: function (v, h) {
                        if (v.Tw <= v.Tk || v.Tg < v.Tk || v.Tg > v.Tw) return { fout: 'Gewenste temperatuur moet tussen koud en warm liggen' };
                        var x = (v.Tg - v.Tk) / (v.Tw - v.Tk);
                        var uit = [h.uit('Aandeel warm water', x * 100, '%', { dec: 0, hoofd: true }), h.uit('Aandeel koud water', (1 - x) * 100, '%', { dec: 0 })];
                        if (v.Q != null) uit.push(h.uit('Warm', v.Q * x, 'l/min', { dec: 1 }), h.uit('Koud', v.Q * (1 - x), 'l/min', { dec: 1 }));
                        return { uit: uit, stappen: ['x = (' + h.f(v.Tg) + ' − ' + h.f(v.Tk) + ') / (' + h.f(v.Tw) + ' − ' + h.f(v.Tk) + ') = ' + h.fmt(x, 3)] };
                    }
                },
                {
                    id: 'san.doorstromer', naam: 'Doorstromer / combi: vermogen ↔ tapdebiet', kort: 'kW voor een tapdebiet bij een temperatuursprong',
                    zoek: 'doorstromer geiser combi tapdebiet l/min kw temperatuursprong elektrische doorstromer warm water vermogen', soort: 'exact',
                    bron: 'P = Q × ΔT × 4,186 / 60 / η [kW, l/min, K] · elektrische doorstromer 21–27 kW = 3-fase 400 V',
                    velden: [
                        { k: 'Q', label: 'Tapdebiet', eh: 'l/min', opt: true, snel: [{ t: 'Wastafel 5', v: 5 }, { t: 'Douche 9', v: 9 }, { t: 'Bad 15', v: 15 }] },
                        { k: 'P', label: 'of vermogen', eh: 'kW', opt: true },
                        { k: 'Tin', label: 'Ingang', eh: '°C', std: 10 },
                        { k: 'Tuit', label: 'Uitgang', eh: '°C', std: 40 },
                        { k: 'soort', label: 'Toestel', type: 'keuze', opties: [{ v: 0.98, t: 'Elektrisch (η 0,98)' }, { v: 0.9, t: 'Gas (η 0,90)' }] }
                    ],
                    bereken: function (v, h) {
                        var dT = v.Tuit - v.Tin, eta = Number(v.soort);
                        if (dT <= 0) return { fout: 'Uitgang moet warmer zijn dan de ingang' };
                        if (v.Q == null && v.P == null) return { wacht: true, ontbreekt: ['tapdebiet of vermogen'] };
                        var P = v.P != null ? v.P : v.Q * dT * 4.186 / 60 / eta, Q = v.Q != null ? v.Q : v.P * eta * 60 / (dT * 4.186);
                        var uit = [h.uit('Vermogen', P, 'kW', { dec: 1, hoofd: v.P == null }), h.uit('Tapdebiet bij ΔT ' + h.fmt(dT) + ' K', Q, 'l/min', { dec: 1, hoofd: v.Q == null })];
                        if (eta > 0.95) uit.push(h.uit('Stroom 3-fase 400 V', P * 1000 / (Math.sqrt(3) * 400), 'A', { dec: 1 }), h.uit('Stroom 1-fase 230 V', P * 1000 / 230, 'A', { dec: 1, opm: P > 8 ? 'te veel voor 1-fase: 3-fase nodig' : '' }));
                        return { uit: uit, stappen: ['P = Q × ΔT × 4,186 / 60 / η = ' + h.fmt(Q, 1) + ' × ' + h.fmt(dT) + ' × 4,186 / 60 / ' + eta + ' = ' + h.f(P, 1, 'kW')] };
                    }
                },
                {
                    id: 'san.wachttijd', naam: 'Wachttijd en waterverlies aan de kraan', kort: 'Inhoud van de warmwaterleiding, wachttijd en verlies per jaar',
                    zoek: 'wachttijd warm water leiding inhoud waterverlies circulatie comfort 3 liter 30 seconden', soort: 'exact',
                    bron: 'Inhoud = π × d_i² / 4 × L · comfortregel: ≤ 3 l of ≤ 30 s tussen opwekker en kraan; anders circulatie of decentrale opwekker',
                    velden: [
                        { k: 'buis', label: 'Leiding', type: 'keuze', opties: buisOpties(), std: 'koper|15×1' },
                        { k: 'L', label: 'Lengte opwekker → kraan', eh: 'm' },
                        { k: 'q', label: 'Tapdebiet', eh: 'l/min', std: 6 },
                        { k: 'n', label: 'Tappingen per dag', std: 10 },
                        { k: 'prijs', label: 'Energieprijs', eh: '€/kWh', std: 0.12, snel: [{ t: 'Gas 0,12', v: 0.12 }, { t: 'Elektrisch 0,35', v: 0.35 }] }
                    ],
                    bereken: function (v, h) {
                        var b = buis(v.buis); if (!b) return { fout: 'Onbekende buis' };
                        var V = Math.PI * Math.pow(b.m.d / 1000, 2) / 4 * v.L * 1000, t = V / v.q * 60;
                        var Etap = V * 45 * W.wh_l_K / 1000, Ejaar = Etap * v.n * 365, water = V * v.n * 365 / 1000;
                        return {
                            uit: [h.uit('Inhoud leiding', V, 'l', { dec: 2, hoofd: true, kleur: V > 3 ? 'rood' : 'groen' }), h.uit('Wachttijd bij ' + h.fmt(v.q) + ' l/min', t, 's', { dec: 0, hoofd: true, kleur: t > 30 ? 'rood' : 'groen' }), h.uit('Energieverlies per tapping (afkoelen)', Etap, 'kWh', { dec: 3 }), h.uit('Per jaar', Ejaar, 'kWh', { dec: 0, opm: '€ ' + h.fmt(Ejaar * v.prijs, 0) + ' · ' + h.fmt(water, 1) + ' m³ water weggespoeld' })],
                            stappen: ['V = π × ' + h.fmt(b.m.d, 1) + '² / 4 × ' + h.f(v.L) + ' m = ' + h.f(V, 2, 'l'), 't = ' + h.fmt(V, 2) + ' / ' + h.f(v.q) + ' × 60 = ' + h.f(t, 0, 's')],
                            waarsch: V > 3 || t > 30 ? ['Buiten de comfortregel (3 l / 30 s): overweeg een circulatieleiding, een kleinere diameter of een opwekker dichter bij de kraan.'] : []
                        };
                    }
                },
                {
                    id: 'san.circulatie', naam: 'Circulatieleiding warm water', kort: 'Warmteverlies, circulatiedebiet en jaarkost',
                    zoek: 'circulatie circulatieleiding warm water pomp verlies isolatie retour legionella', soort: 'indicatief',
                    bron: 'Verlies per meter: geïsoleerd (isolatie = buisdiameter) ±10 W/m, dun 15 W/m, ongeïsoleerd 30 W/m bij 55 °C; Q = P / (1,163 × ΔT)',
                    velden: [
                        { k: 'L', label: 'Lengte kring (aanvoer + retour)', eh: 'm' },
                        { k: 'iso', label: 'Isolatie', type: 'keuze', opties: [{ v: 10, t: 'Goed geïsoleerd (10 W/m)' }, { v: 15, t: 'Dun geïsoleerd (15 W/m)' }, { v: 30, t: 'Ongeïsoleerd (30 W/m)' }], std: 10 },
                        { k: 'dT', label: 'Toegelaten afkoeling in de kring', eh: 'K', std: 5 },
                        { k: 'uren', label: 'Draaiuren per dag', eh: 'h', std: 24, snel: [{ t: 'Continu 24', v: 24 }, { t: 'Timer 12', v: 12 }, { t: 'Timer 6', v: 6 }] },
                        { k: 'prijs', label: 'Energieprijs', eh: '€/kWh', std: 0.12 }
                    ],
                    bereken: function (v, h) {
                        var P = v.L * Number(v.iso), Q = P / (W.wh_l_K * v.dT), Ejaar = P * v.uren * 365 / 1000;
                        return { uit: [h.uit('Warmteverlies kring', P, 'W', { dec: 0, hoofd: true }), h.uit('Circulatiedebiet', Q, 'l/h', { dec: 0, hoofd: true }), h.uit('Verlies per jaar', Ejaar, 'kWh', { dec: 0, opm: '€ ' + h.fmt(Ejaar * v.prijs, 0) })], stappen: ['P = ' + h.f(v.L) + ' × ' + Number(v.iso) + ' = ' + h.f(P, 0, 'W'), 'Q = ' + h.fmt(P, 0) + ' / (1,163 × ' + h.f(v.dT) + ') = ' + h.f(Q, 0, 'l/h')], opm: 'Retour ≥ 55 °C houden (legionella); kleine circulatiepomp met timer.' };
                    }
                },
                {
                    id: 'san.expansie', naam: 'Expansievat sanitair (boiler)', kort: 'Doorstroomd expansievat op de koudwatertoevoer van een boiler',
                    zoek: 'expansievat sanitair boiler drinkwater doorstroomd voordruk veiligheidsgroep 6 bar', soort: 'indicatief',
                    bron: 'V_n = V × e(θ_max) × (p_e + 1) / (p_e − p_0); p_0 = netdruk na de drukverminderaar; p_e = druk veiligheidsventiel − 0,5 bar (0,9 × bij ≥ 8 bar)',
                    velden: [
                        { k: 'V', label: 'Boilerinhoud', eh: 'l', std: 200 },
                        { k: 'tmax', label: 'Maximale boilertemperatuur', type: 'keuze', opties: [50, 55, 60, 65, 70, 80, 90].map(function (t) { return { v: t, t: t + ' °C' }; }), std: 65 },
                        { k: 'p0', label: 'Netdruk (na drukverminderaar)', eh: 'bar', std: 3, snel: [{ t: '2,5', v: 2.5 }, { t: '3', v: 3 }, { t: '4', v: 4 }] },
                        { k: 'psv', label: 'Veiligheidsventiel / veiligheidsgroep', type: 'keuze', opties: [{ v: 6, t: '6 bar' }, { v: 7, t: '7 bar' }, { v: 8, t: '8 bar' }, { v: 10, t: '10 bar' }], std: 7 }
                    ],
                    bereken: function (v, h) {
                        var e = E_WATER[Number(v.tmax)], psv = Number(v.psv), pe = psv >= 8 ? psv * 0.9 : psv - 0.5;
                        if (pe <= v.p0) return { fout: 'Netdruk te hoog voor dit veiligheidsventiel: drukverminderaar lager zetten' };
                        var Ve = v.V * e, Vn = Ve * (pe + 1) / (pe - v.p0), keuze = h.omhoogNaar(Vn, [8, 12, 18, 25, 35, 50, 80]);
                        return { uit: [h.uit('Expansievat', keuze ? keuze + ' l' : '> 80 l', '', { hoofd: true, opm: 'berekend ' + h.fmt(Vn, 1) + ' l · voordruk = ' + h.fmt(v.p0, 1) + ' bar' }), h.uit('Uitzetting', Ve, 'l', { dec: 1 })], stappen: ['V_e = ' + h.f(v.V) + ' × ' + h.fmt(e, 4) + ' = ' + h.f(Ve, 1, 'l'), 'V_n = ' + h.fmt(Ve, 1) + ' × (' + h.fmt(pe, 1) + ' + 1) / (' + h.fmt(pe, 1) + ' − ' + h.fmt(v.p0, 1) + ') = ' + h.f(Vn, 1, 'l')], opm: 'Een doorstroomd vat met drinkwaterkeur (Belgaqua) op de koude toevoer, ná de veiligheidsgroep richting boiler; het vat vervangt het drupverlies van de veiligheidsgroep.' };
                    }
                },
                {
                    id: 'san.legionella', naam: 'Legionella: temperaturen en regels', kort: 'Naslag: wat groeit, wat doodt, welke regels gelden',
                    zoek: 'legionella temperatuur boiler 60 graden spoelen risico regels vlaanderen naslag', soort: 'naslag',
                    bron: 'Vlaams Legionellabesluit (hoogrisico-inrichtingen), WHO, Belgaqua — richtwaarden',
                    velden: [],
                    bereken: function (v, h) {
                        return {
                            tabel: { kop: ['Temperatuur', 'Wat gebeurt er'], rijen: [['< 20 °C', 'Bacterie sluimert, groeit niet'], ['20–45 °C', 'Groei; optimum 37 °C — vermijd lauw stilstaand water'], ['50 °C', 'Groei stopt; afdoding heel traag'], ['55 °C', 'Afdoding in ±5 à 6 uur'], ['60 °C', 'Afdoding in ±30 min (90 % in ±2 min)'], ['66 °C', 'Afdoding in ±2 min'], ['70 °C', 'Afdoding in seconden (thermische desinfectie)']] },
                            opm: 'Regels: boiler op ≥ 60 °C, circulatieretour ≥ 55 °C, thermostatische mengkraan aan de tappunten (verbranding), leidingen zonder dode einden, weinig gebruikte tappunten wekelijks spoelen, koud water < 25 °C (leidingen niet naast warm/verwarming). Warmtepompboilers: wekelijkse anti-legionellacyclus op 60 °C. Voor hotels, sportcentra, zorg: het Vlaams Legionellabesluit vraagt een beheersplan.'
                        };
                    }
                },
                {
                    id: 'san.laadtijd', naam: 'Boiler laden: tijd en vermogen', kort: 'Hoe lang duurt het opwarmen, of welk vermogen is er nodig?',
                    zoek: 'boiler laden laadtijd opwarmtijd indirecte boiler spiraal ketel vermogen liter opwarmen buffervat tijd', soort: 'exact',
                    bron: 'E = V × 1,163 Wh × ΔT · tijd = E / vermogen · vermogen = E / tijd',
                    uitleg: 'Vul het vermogen in om de laadtijd te kennen, of de gewenste laadtijd om het vermogen te kennen. Bij een indirecte boiler telt het vermogen van de spiraal, niet dat van de ketel.',
                    velden: [
                        { k: 'V', label: 'Inhoud', eh: 'l', std: 200, min: 1, snel: [{ t: '120', v: 120 }, { t: '150', v: 150 }, { t: '200', v: 200 }, { t: '300', v: 300 }, { t: '500', v: 500 }] },
                        { k: 'Tk', label: 'Begintemperatuur', eh: '°C', std: 10 },
                        { k: 'Tw', label: 'Eindtemperatuur', eh: '°C', std: 60 },
                        { k: 'P', label: 'Vermogen', eh: 'kW', ehs: ['kW', 'W'], opt: true, min: 0, snel: [{ t: 'Weerstand 2,2', v: 2.2 }, { t: 'Spiraal 15', v: 15 }, { t: 'Ketel 24', v: 24 }] },
                        { k: 't', label: 'of gewenste laadtijd', eh: 'min', ehs: ['min', 'h'], opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var dT = v.Tw - v.Tk;
                        if (!(dT > 0)) return { fout: 'De eindtemperatuur moet hoger zijn dan de begintemperatuur' };
                        var E = v.V * W.wh_l_K * dT / 1000, uit = [h.uit('Energie', E, 'kWh', { dec: 2, hoofd: v.P == null && v.t == null })], st = ['E = ' + h.f(v.V, 0) + ' l × 1,163 × ' + h.f(dT, 0) + ' K = ' + h.f(E, 2, 'kWh')];
                        function tijd(min) { min = Math.round(min); return Math.floor(min / 60) + ' u ' + (min % 60 < 10 ? '0' : '') + (min % 60); }
                        if (v.P > 0) { uit.unshift(h.uit('Laadtijd', tijd(E / v.P * 60), '', { hoofd: true, opm: h.fmt(E / v.P * 60, 0) + ' minuten' })); uit.push(h.uit('Debiet door de spiraal bij ΔT 15 K', v.P * 1000 / (W.wh_l_K * 15), 'l/h', { dec: 0 })); st.push('Tijd = ' + h.fmt(E, 2) + ' / ' + h.f(v.P, 1) + ' = ' + h.f(E / v.P, 2, 'uur')); }
                        else if (v.t > 0) { uit.unshift(h.uit('Nodig vermogen', E / (v.t / 60), 'kW', { dec: 1, hoofd: true })); st.push('P = ' + h.fmt(E, 2) + ' / ' + h.f(v.t / 60, 2) + ' uur = ' + h.f(E / (v.t / 60), 1, 'kW')); }
                        var rijen = [2.2, 3, 6, 10, 15, 24, 35].map(function (p) { return [h.fmt(p, 1) + ' kW', tijd(E / p * 60)]; });
                        return { uit: uit, stappen: st, tabel: { kop: ['Vermogen', 'Laadtijd'], rijen: rijen, kies: v.P != null ? [2.2, 3, 6, 10, 15, 24, 35].indexOf(v.P) : -1 } };
                    }
                },
                {
                    id: 'san.wpboiler', naam: 'Warmtepompboiler: opwarmtijd en verbruik', kort: 'Hoe lang duurt het opwarmen en wat kost het per jaar?',
                    zoek: 'warmtepompboiler warmtepomp boiler opwarmtijd verbruik cop kost per jaar elektrische boiler gasboiler vergelijken sanitair warm water', soort: 'indicatief',
                    bron: 'E = V × 1,163 Wh × ΔT · opwarmtijd = E / thermisch vermogen · elektrisch verbruik = (tapenergie + stilstandsverlies) / COP · vergelijking: elektrische boiler rendement 0,98, gasboiler 0,80',
                    velden: [
                        { k: 'V', label: 'Inhoud van de boiler', eh: 'l', std: 200, min: 1, snel: [{ t: '100', v: 100 }, { t: '150', v: 150 }, { t: '200', v: 200 }, { t: '270', v: 270 }] },
                        { k: 'Tk', label: 'Koud water', eh: '°C', std: 10 },
                        { k: 'Tw', label: 'Boilertemperatuur', eh: '°C', std: 55, snel: [{ t: '50', v: 50 }, { t: '55', v: 55 }, { t: '60', v: 60 }] },
                        { k: 'P', label: 'Thermisch vermogen van de warmtepomp', eh: 'kW', std: 1.7, min: 0.1 },
                        { k: 'cop', label: 'COP voor warm water', std: 3, min: 1, max: 6 },
                        { k: 'dag', label: 'Warm water per dag (op boilertemperatuur)', eh: 'l', std: 150, min: 0 },
                        { k: 'verlies', label: 'Stilstandsverlies', eh: 'kWh/dag', std: 0.8, min: 0 },
                        { k: 'pe', label: 'Stroomprijs', eh: '€/kWh', std: 0.35, min: 0 },
                        { k: 'pg', label: 'Gasprijs', eh: '€/kWh', std: 0.1, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var dT = v.Tw - v.Tk;
                        if (!(dT > 0)) return { fout: 'De boilertemperatuur moet hoger zijn dan het koude water' };
                        var Evol = v.V * W.wh_l_K * dT / 1000, t = Evol / v.P, Edag = v.dag * W.wh_l_K * dT / 1000 + v.verlies, Ejaar = Edag * 365;
                        var wp = Ejaar / v.cop, el = Ejaar / 0.98, gas = Ejaar / 0.8;
                        var u = Math.floor(t), m = Math.round((t - u) * 60); if (m === 60) { u++; m = 0; }
                        return {
                            uit: [h.uit('Opwarmtijd van een koude boiler', u + ' u ' + (m < 10 ? '0' : '') + m, '', { hoofd: true }), h.uit('Stroomverbruik per jaar', wp, 'kWh', { dec: 0, hoofd: true, opm: '€ ' + h.fmt(wp * v.pe, 0) }), h.uit('Warmte per dag', Edag, 'kWh', { dec: 1 }), h.uit('Elektrische boiler per jaar', el, 'kWh', { dec: 0, opm: '€ ' + h.fmt(el * v.pe, 0) }), h.uit('Gasboiler per jaar', gas, 'kWh', { dec: 0, opm: '€ ' + h.fmt(gas * v.pg, 0) }), h.uit('Besparing tegenover een elektrische boiler', (el - wp) * v.pe, '€', { dec: 0 })],
                            stappen: ['E = ' + h.f(v.V, 0) + ' l × 1,163 × ' + h.f(dT, 0) + ' K = ' + h.f(Evol, 1, 'kWh'), 'Opwarmtijd = ' + h.fmt(Evol, 1) + ' / ' + h.f(v.P, 1) + ' = ' + h.f(t, 1, 'uur'), 'Per dag = ' + h.f(v.dag, 0) + ' l × 1,163 × ' + h.f(dT, 0) + ' K + ' + h.f(v.verlies, 1) + ' = ' + h.f(Edag, 1, 'kWh'), 'Stroom = ' + h.fmt(Ejaar, 0) + ' / ' + h.f(v.cop, 1) + ' = ' + h.f(wp, 0, 'kWh')],
                            opm: 'De COP daalt bij koude aanzuiglucht en bij een hogere boilertemperatuur. Zet een warmtepompboiler in een ruimte van minstens 20 m³ of werk met luchtkanalen naar buiten.'
                        };
                    }
                },
                {
                    id: 'san.zonneboiler', naam: 'Zonneboiler', kort: 'Collectoroppervlak, boilerinhoud en opbrengst',
                    zoek: 'zonneboiler zonnecollector collector vlakke plaat vacuumbuis oppervlakte boilervat dekking opbrengst thermisch zonne-energie', soort: 'indicatief',
                    bron: 'Richtwaarden voor België: vlakke plaat 1,25 m² per persoon en ±400 kWh per m² per jaar, vacuümbuis 0,9 m² per persoon en ±500 kWh per m² · boilervat 50 tot 70 l per m² collector en minstens 1,5 × de dagbehoefte · een zonneboiler dekt 50 tot 60 % van het warm water',
                    velden: [
                        { k: 'pers', label: 'Personen', std: 4, min: 1 },
                        { k: 'lpd', label: 'Warm water per persoon (op 60 °C)', eh: 'l/dag', std: 45, min: 1 },
                        { k: 'type', label: 'Collector', type: 'keuze', opties: [{ v: 'vlak', t: 'Vlakke plaat' }, { v: 'buis', t: 'Vacuümbuis' }], std: 'vlak' },
                        { k: 'orient', label: 'Oriëntatie', type: 'keuze', opties: [{ v: 1, t: 'Zuid, helling 30 tot 50°' }, { v: 0.95, t: 'Zuidoost of zuidwest' }, { v: 0.8, t: 'Oost of west' }], std: 1 },
                        { k: 'prijs', label: 'Prijs van de warmte die je uitspaart', eh: '€/kWh', std: 0.12, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var f = Number(v.orient), perP = v.type === 'buis' ? 0.9 : 1.25, kwhm2 = v.type === 'buis' ? 500 : 400;
                        var dag = v.pers * v.lpd, A = v.pers * perP / f, vat = h.omhoogNaar(Math.max(1.5 * dag, 60 * A), [150, 200, 300, 400, 500, 750, 1000]);
                        var nood = dag * W.wh_l_K * 50 * 365 / 1000, opbr = Math.min(A * kwhm2 * f, nood * 0.65);
                        return {
                            uit: [h.uit('Collectoroppervlak', A, 'm²', { dec: 1, hoofd: true }), h.uit('Boilervat', vat ? vat + ' l' : 'groter dan 1.000 l', '', { hoofd: true }), h.uit('Opbrengst per jaar (±)', opbr, 'kWh', { dec: 0, opm: '€ ' + h.fmt(opbr * v.prijs, 0) + ' uitgespaard' }), h.uit('Dekking van het warm water (±)', opbr / nood * 100, '%', { dec: 0 }), h.uit('Warmte voor warm water per jaar', nood, 'kWh', { dec: 0 }), h.uit('Dagbehoefte', dag, 'l', { dec: 0 })],
                            stappen: ['A = ' + v.pers + ' × ' + h.fmt(perP, 2) + ' / ' + h.fmt(f, 2) + ' = ' + h.f(A, 1, 'm²'), 'Behoefte = ' + h.f(dag, 0) + ' l × 1,163 × 50 K × 365 = ' + h.f(nood, 0, 'kWh'), 'Opbrengst = ' + h.fmt(A, 1) + ' × ' + kwhm2 + ' × ' + h.fmt(f, 2) + ' (hoogstens 65 % van de behoefte)'],
                            opm: 'Sinds 1 juli 2025 geeft Mijn VerbouwPremie geen premie meer voor een zonneboiler. Vergelijk daarom ook met een warmtepompboiler.'
                        };
                    }
                },
                {
                    id: 'san.nl', naam: 'Collectief warm water: behoeftekental N', kort: 'Appartementsgebouw: welk vermogenskental moet de boiler hebben?',
                    zoek: 'collectief warm water appartementsgebouw behoeftekental bedarfskennzahl din 4708 nl kental vermogenskental boiler stookplaats vme woningen', soort: 'indicatief',
                    bron: 'DIN 4708-2: N = Σ(n × p × v × w_v) / (3,5 × 5.820) · eenheidswoning: 4 kamers, 3,5 personen en één bad van 140 l (5.820 Wh) · waarden gelezen in de planningsgids van Viessmann',
                    uitleg: 'Elke regel is een groep gelijke woningen met één soort tappunt. Bij een gewone uitrusting telt alleen het bad; een douche in de plaats van een bad telt als een bad. Een tweede tappunt dat tegelijk gebruikt kan worden, zet je op een eigen regel. Kamers zijn de woon- en slaapkamers samen.',
                    velden: [
                        { k: 'rijen', label: 'Woningen', type: 'rijen', kolommen: [{ k: 'n', label: 'Woningen', type: 'getal' }, { k: 'p', label: 'Grootte van de woning', type: 'keuze', opties: DIN4708_P }, { k: 'v', label: 'Per woning', type: 'getal' }, { k: 'tap', label: 'Tappunt', type: 'keuze', opties: DIN4708_TAP.map(function (x) { return { v: x.v, t: x.t }; }) }], std: [{ n: 12, p: 3.5, tap: 'nb1', v: 1 }, { n: 6, p: 2.7, tap: 'dn', v: 1 }] },
                        { k: 'klein', label: 'Vooral woningen met 1 of 2 kamers (bezetting + 0,5)', type: 'vink', std: false }
                    ],
                    bereken: function (v, h) {
                        var som = 0, won = {}, pers = 0, rijen = [];
                        (v.rijen || []).forEach(function (r, i) {
                            var n = r.n || 0, aantal = r.v == null ? 1 : r.v, p = Number(r.p) + (v.klein ? 0.5 : 0), T = DIN4708_TAP.filter(function (x) { return x.v === r.tap; })[0] || DIN4708_TAP[0];
                            if (!(n > 0) || !(aantal > 0)) return;
                            var deel = n * p * aantal * T.wv;
                            som += deel;
                            rijen.push([h.fmt(n, 0) + ' × ' + h.fmt(p, 1) + ' personen', (aantal === 1 ? '' : h.fmt(aantal, 0) + ' × ') + T.t + ' · ' + h.fmt(T.wv, 0) + ' Wh', h.fmt(deel / 20370, 1)]);
                        });
                        if (!rijen.length) return { wacht: true, ontbreekt: ['minstens één regel met woningen'] };
                        var N = som / 20370;
                        return {
                            uit: [h.uit('Behoeftekental N', N, '', { dec: 1, hoofd: true }), h.uit('Boiler kiezen met N_L van minstens', Math.ceil(N * 10 - 1e-9) / 10, '', { dec: 1, hoofd: true, opm: 'bij de aanvoertemperatuur en het ketelvermogen van deze installatie' }), h.uit('Som van de behoeften', som / 1000, 'kWh', { dec: 0 })],
                            stappen: ['Σ(n × p × v × w_v) = ' + h.f(som, 0, 'Wh'), 'N = ' + h.fmt(som, 0) + ' / (3,5 × 5.820) = ' + h.f(N, 1)],
                            tabel: { kop: ['Woningen', 'Tappunt', 'Aandeel in N'], rijen: rijen },
                            opm: 'N is het aantal eenheidswoningen waarmee het gebouw overeenkomt. Het vermogenskental N_L staat in de fiche van de boiler en hangt af van de aanvoertemperatuur en van het vermogen waarmee de boiler geladen wordt. Een hotel, een sporthal of een rusthuis volgt deze methode niet: daar telt het piekuur.'
                        };
                    }
                }
            ] },
            { naam: 'Leidingen en druk', items: [
                {
                    id: 'san.drinkwater', naam: 'Drinkwaterleidingen (EN 806-3)', kort: 'Belastingseenheden → piekdebiet → diameter',
                    zoek: 'drinkwater leiding diameter dimensioneren en 806 belastingseenheden lu piekdebiet koper meerlagen ppr tappunten', soort: 'indicatief',
                    bron: 'NBN EN 806-3 (vereenvoudigde methode): LU per tappunt, piekdebiet Q_D uit ΣLU (woningen: ≈ 0,1 × √ΣLU l/s, nooit kleiner dan het grootste tappunt), snelheid ≤ 2 m/s (aftakkingen ≤ 4 m/s toegelaten voor korte stukken)',
                    velden: [
                        { k: 'rijen', label: 'Tappunten op deze leiding', type: 'rijen', kolommen: [{ k: 'tap', label: 'Tappunt', type: 'keuze', opties: TAP }, { k: 'n', label: 'Aantal', type: 'getal' }], std: [{ tap: 'wastafel', n: 2 }, { tap: 'wc', n: 2 }, { tap: 'douche', n: 1 }, { tap: 'bad', n: 1 }, { tap: 'gootsteen', n: 1 }, { tap: 'vaatwasser', n: 1 }, { tap: 'wasmachine', n: 1 }] },
                        { k: 'mat', label: 'Materiaal', type: 'keuze', opties: [{ v: 'koper', t: 'Koper' }, { v: 'meerlagen', t: 'Meerlagen' }, { v: 'pex', t: 'PE-X' }, { v: 'ppr', t: 'PP-R' }, { v: 'pe', t: 'PE (aanvoer)' }], std: 'koper' },
                        { k: 'vmax', label: 'Maximale snelheid', eh: 'm/s', std: 2, snel: [{ t: 'Stil 1,5', v: 1.5 }, { t: 'Norm 2,0', v: 2 }] }
                    ],
                    bereken: function (v, h) {
                        var lu = 0, qmax = 0, nTot = 0, rijen = [];
                        v.rijen.forEach(function (r) {
                            var t = TAP.filter(function (x) { return x.v === r.tap; })[0]; if (!t || !r.n) return;
                            lu += t.lu * r.n; nTot += r.n; qmax = Math.max(qmax, t.q);
                            rijen.push([t.t, h.fmt(r.n), h.fmt(t.lu, 1) + ' LU', h.fmt(t.lu * r.n, 1) + ' LU']);
                        });
                        if (!lu) return { wacht: true, ontbreekt: ['minstens één tappunt'] };
                        var QD = Math.max(qmax, 0.1 * Math.sqrt(lu));
                        var mat = BUIZEN[v.mat], keus = null;
                        mat.maten.forEach(function (m) { var vel = QD / 1000 / (Math.PI * Math.pow(m.d / 1000, 2) / 4); if (vel <= v.vmax && !keus) keus = { m: m, vel: vel }; });
                        var dmin = Math.sqrt(4 * QD / 1000 / (Math.PI * v.vmax)) * 1000;
                        return {
                            uit: [h.uit('Leiding', keus ? keus.m.n + ' ' + mat.naam.split(' (')[0] : 'groter dan de lijst', '', { hoofd: true }), h.uit('Piekdebiet Q_D', QD, 'l/s', { dec: 2, hoofd: true, opm: h.fmt(QD * 60, 0) + ' l/min' }), h.uit('Som belastingseenheden', lu, 'LU', { opm: nTot + ' tappunten' }), h.uit('Minimale binnendiameter', dmin, 'mm', { dec: 1 }), h.uit('Snelheid in de gekozen buis', keus ? keus.vel : null, 'm/s', { dec: 2 })],
                            stappen: ['Q_D = max(grootste tappunt ' + h.fmt(qmax, 2) + ' l/s, 0,1 × √' + h.fmt(lu) + ') = ' + h.f(QD, 2, 'l/s'), 'd_min = √(4 × Q / (π × v)) = ' + h.f(dmin, 1, 'mm')],
                            tabel: { kop: ['Tappunt', 'Aantal', 'LU', 'Samen'], rijen: rijen },
                            opm: 'Aansluitleiding per tappunt: 12 of 15 mm koper / 16 mm meerlagen (bad, regendouche: 18 / 20 mm). Warm en koud apart rekenen; de warmwaterleiding zo kort mogelijk.'
                        };
                    }
                },
                {
                    id: 'san.druk', naam: 'Waterdruk en hoogte', kort: 'Beschikbare druk aan het tappunt, drukverminderaar of hydrofoor nodig?',
                    zoek: 'waterdruk druk hoogte verdieping bar mwk drukverminderaar hydrofoor regendouche zolder', soort: 'exact',
                    bron: '1 bar = 10,2 m waterkolom · p_tap = p_net − h / 10,2 − Δp_leiding · Belgaqua: drukverminderaar aanbevolen boven 5 bar (verplicht boven 10 bar); comfort tappunt ≥ 1 bar, regendouche 1,5–2 bar',
                    velden: [
                        { k: 'pnet', label: 'Druk aan de watermeter', eh: 'bar', std: 3, snel: [{ t: '2', v: 2 }, { t: '3', v: 3 }, { t: '4', v: 4 }, { t: '6', v: 6 }] },
                        { k: 'h', label: 'Hoogte tappunt boven de meter', eh: 'm', std: 6, snel: [{ t: 'Gelijkvloers 1', v: 1 }, { t: '1e verdieping 4', v: 4 }, { t: '2e verdieping 7', v: 7 }, { t: 'Zolder 10', v: 10 }] },
                        { k: 'dpl', label: 'Drukverlies leidingen en toestellen (schatting)', eh: 'bar', std: 0.5, snel: [{ t: 'Kort 0,3', v: 0.3 }, { t: 'Normaal 0,5', v: 0.5 }, { t: 'Lang + ontharder 1,0', v: 1 }] },
                        { k: 'pmin', label: 'Nodige druk aan het tappunt', eh: 'bar', std: 1, snel: [{ t: 'Kraan 1,0', v: 1 }, { t: 'Regendouche 1,5', v: 1.5 }, { t: 'Comfort 2,0', v: 2 }] }
                    ],
                    bereken: function (v, h) {
                        var ptap = v.pnet - v.h / 10.2 - v.dpl, tekort = v.pmin - ptap, hmax = (v.pnet - v.dpl - v.pmin) * 10.2;
                        var waarsch = [];
                        if (tekort > 0) waarsch.push('Tekort van ' + h.fmt(tekort, 2) + ' bar: hydrofoor/drukverhoging (opvoerhoogte ≥ ' + h.fmt(tekort * 10.2, 0) + ' m extra) of minder drukverlies.');
                        if (v.pnet > 5) waarsch.push('Netdruk boven 5 bar: drukverminderaar (instellen op 3 à 4 bar) beschermt toestellen en beperkt waterslag.');
                        return { uit: [h.uit('Druk aan het tappunt', ptap, 'bar', { dec: 2, hoofd: true, kleur: ptap >= v.pmin ? 'groen' : 'rood' }), h.uit('Hoogteverlies', v.h / 10.2, 'bar', { dec: 2 }), h.uit('Maximale hoogte voor ' + h.fmt(v.pmin) + ' bar', hmax, 'm', { dec: 1 })], stappen: ['p_tap = ' + h.f(v.pnet) + ' − ' + h.f(v.h) + '/10,2 − ' + h.f(v.dpl) + ' = ' + h.f(ptap, 2, 'bar')], waarsch: waarsch };
                    }
                },
                {
                    id: 'san.waterslag', naam: 'Waterslag', kort: 'Drukstoot bij snel sluiten (Joukowsky)',
                    zoek: 'waterslag drukstoot joukowsky magneetventiel wasmachine kloppen leidingen demper', soort: 'exact',
                    bron: 'Δp = ρ × c × Δv; golfsnelheid c: koper/staal ±1.300 m/s, meerlagen ±600, PVC ±450, PE ±300 m/s',
                    velden: [
                        { k: 'v', label: 'Stroomsnelheid vóór het sluiten', eh: 'm/s', std: 2 },
                        { k: 'mat', label: 'Leiding', type: 'keuze', opties: [{ v: 1300, t: 'Koper / staal (c 1.300 m/s)' }, { v: 600, t: 'Meerlagen (600)' }, { v: 450, t: 'PVC (450)' }, { v: 300, t: 'PE / PE-X (300)' }], std: 1300 },
                        { k: 'pnet', label: 'Bedrijfsdruk', eh: 'bar', std: 3 }
                    ],
                    bereken: function (v, h) {
                        var dp = 1000 * Number(v.mat) * v.v / 1e5;
                        return { uit: [h.uit('Drukstoot', dp, 'bar', { dec: 1, hoofd: true, kleur: dp > 10 ? 'rood' : dp > 5 ? 'amber' : 'groen' }), h.uit('Piekdruk', v.pnet + dp, 'bar', { dec: 1 })], stappen: ['Δp = 1000 × ' + Number(v.mat) + ' × ' + h.f(v.v) + ' = ' + h.f(dp * 1e5, 0, 'Pa') + ' = ' + h.f(dp, 1, 'bar')], opm: 'Snel sluitende kranen (magneetventielen van wasmachine/vaatwasser, eengreepskranen): snelheid ≤ 2 m/s houden, waterslagdemper vlak bij het toestel, drukverminderaar op het net.' };
                    }
                },
                {
                    id: 'san.pomp', naam: 'Regenwaterpomp / hydrofoor kiezen', kort: 'Opvoerhoogte en debiet voor een pomp op een put',
                    zoek: 'regenwaterpomp hydrofoor pomp kiezen opvoerhoogte zuighoogte debiet druk put', soort: 'indicatief',
                    bron: 'H = zuighoogte + persh oogte + gewenste druk × 10,2 + leidingverlies · P_as = ρ × g × Q × H / η',
                    velden: [
                        { k: 'hz', label: 'Zuighoogte (waterpeil → pomp)', eh: 'm', std: 3 },
                        { k: 'hp', label: 'Pershoogte (pomp → hoogste tappunt)', eh: 'm', std: 6 },
                        { k: 'p', label: 'Gewenste druk aan het tappunt', eh: 'bar', std: 2 },
                        { k: 'L', label: 'Leidinglengte', eh: 'm', std: 30 },
                        { k: 'Q', label: 'Gewenst debiet', eh: 'l/min', std: 40, snel: [{ t: 'WC + wasmachine 20', v: 20 }, { t: 'Met tuinkraan 40', v: 40 }, { t: 'Twee tappunten 60', v: 60 }] }
                    ],
                    bereken: function (v, h) {
                        var verlies = v.L * 0.05, H = v.hz + v.hp + v.p * 10.2 + verlies, P = 1000 * 9.81 * (v.Q / 60000) * H / 0.45;
                        return { uit: [h.uit('Opvoerhoogte pomp', H, 'm', { dec: 0, hoofd: true, opm: h.fmt(H / 10.2, 1) + ' bar' }), h.uit('Debiet', v.Q, 'l/min', { hoofd: true, opm: h.fmt(v.Q * 0.06, 1) + ' m³/h' }), h.uit('Motorvermogen (richtwaarde)', P, 'W', { dec: 0 })], stappen: ['H = ' + h.f(v.hz) + ' + ' + h.f(v.hp) + ' + ' + h.f(v.p) + ' × 10,2 + ' + h.fmt(verlies, 1) + ' (leiding 0,05 m/m) = ' + h.f(H, 1, 'm')], waarsch: v.hz > 7 ? ['Zuighoogte boven 7 m: een zelfaanzuigende pomp haalt dat niet; dompelpomp in de put gebruiken.'] : [] };
                    }
                }
            ] },
            { naam: 'Afvoer en regenwater', items: [
                {
                    id: 'san.afvoer', naam: 'Afvoerleidingen (EN 12056-2)', kort: 'DU-eenheden → afvoerdebiet → diameter van aansluit-, val- en liggende leiding',
                    zoek: 'afvoer riolering diameter dimensioneren en 12056 du valleiding liggende leiding helling ontluchting wc 110 90 75 50', soort: 'indicatief',
                    bron: 'NBN EN 12056-2, systeem I (vullingsgraad 50 %): Q_ww = K × √ΣDU (K = 0,5 woningen, 0,7 scholen/restaurants, 1,0 openbare toiletten, 1,2 industrie); liggende leidingen: Manning n = 0,010 bij h/d = 0,5; valleidingen: tabel 11; WC minstens DN 90 (aanbevolen 110)',
                    velden: [
                        { k: 'rijen', label: 'Toestellen', type: 'rijen', kolommen: [{ k: 'toestel', label: 'Toestel', type: 'keuze', opties: DU }, { k: 'n', label: 'Aantal', type: 'getal' }], std: [{ toestel: 'wc', n: 2 }, { toestel: 'wastafel', n: 2 }, { toestel: 'douche', n: 1 }, { toestel: 'bad', n: 1 }, { toestel: 'gootsteen', n: 1 }, { toestel: 'vaatwasser', n: 1 }, { toestel: 'wasmachine', n: 1 }] },
                        { k: 'K', label: 'Gebruik', type: 'keuze', opties: [{ v: 0.5, t: 'Woning (K 0,5)' }, { v: 0.7, t: 'School, restaurant, hotel (0,7)' }, { v: 1, t: 'Openbare toiletten, labo (1,0)' }, { v: 1.2, t: 'Industrie (1,2)' }], std: 0.5 },
                        { k: 'helling', label: 'Helling liggende leiding', type: 'keuze', opties: [{ v: 0.01, t: '1 cm/m (1 %)' }, { v: 0.015, t: '1,5 cm/m' }, { v: 0.02, t: '2 cm/m (2 %)' }], std: 0.02 },
                        { k: 'ontl', label: 'Valleiding met secundaire ontluchting', type: 'vink', std: false }
                    ],
                    bereken: function (v, h) {
                        var som = 0, duMax = 0, dnMin = 40, rijen = [], wc = false;
                        v.rijen.forEach(function (r) {
                            var t = DU.filter(function (x) { return x.v === r.toestel; })[0]; if (!t || !r.n) return;
                            som += t.du * r.n; duMax = Math.max(duMax, t.du); dnMin = Math.max(dnMin, t.dn); if (/^wc/.test(t.v)) wc = true;
                            rijen.push([t.t, h.fmt(r.n), h.fmt(t.du, 1) + ' l/s', h.fmt(t.du * r.n, 1) + ' l/s']);
                        });
                        if (!som) return { wacht: true, ontbreekt: ['minstens één toestel'] };
                        var Qww = Number(v.K) * Math.sqrt(som), Q = Math.max(Qww, duMax);
                        // liggend: capaciteit = Manning bij h/d 0,5 óf de grens voor korte aftakkingen (EN 12056-2 tabel B.1: DN 50 ≤ 0,8 l/s, DN 70/75 ≤ 1,5, DN 90 ≤ 2,0, DN 100/110 ≤ 2,5)
                        var B1 = { 50: 0.8, 75: 1.5, 90: 2.0, 110: 2.5 };
                        var S = Number(v.helling), lig = null;
                        LIG.forEach(function (m) { if (!lig && Math.max(manningHalf(m.d, S), B1[m.dn] || 0) >= Q && m.dn >= (wc ? 90 : 50)) lig = m; });
                        var val = VAL.filter(function (x) { return (v.ontl ? x.s : x.p) >= Q && x.dn >= (wc ? 90 : 50); })[0];
                        var waarsch = [];
                        if (wc && lig && lig.dn < 110) waarsch.push('Met een WC is DN 90 het minimum; DN 110 is de gangbare keuze (minder verstoppingen).');
                        return {
                            uit: [h.uit('Liggende leiding (' + h.fmt(S * 100, 1) + ' %)', lig ? 'DN ' + lig.dn : 'groter dan DN 200', '', { hoofd: true, opm: lig ? 'capaciteit ' + h.fmt(Math.max(manningHalf(lig.d, S), B1[lig.dn] || 0), 1) + ' l/s' + (B1[lig.dn] > manningHalf(lig.d, S) ? ' als korte aftakking (≤ 4 m, ≤ 3 bochten)' : ' bij h/d 0,5') : '' }), h.uit('Valleiding', val ? 'DN ' + val.dn : 'groter dan DN 200', '', { hoofd: true, opm: val ? 'capaciteit ' + h.fmt(v.ontl ? val.s : val.p, 1) + ' l/s' : '' }), h.uit('Afvoerdebiet Q_ww', Qww, 'l/s', { dec: 2, opm: Q > Qww ? 'grootste toestel (' + h.fmt(duMax, 1) + ' l/s) is bepalend' : '' }), h.uit('Som DU', som, 'l/s', { dec: 1 }), h.uit('Grootste aansluitmaat nodig', 'DN ' + dnMin, '')],
                            stappen: ['Q_ww = ' + h.fmt(Number(v.K), 1) + ' × √' + h.fmt(som, 1) + ' = ' + h.f(Qww, 2, 'l/s'), 'Liggend: Q_cap = 0,5 × (1/n) × A × R^(2/3) × √S met n = 0,010'],
                            tabel: { kop: ['Toestel', 'Aantal', 'DU', 'Samen'], rijen: rijen }, waarsch: waarsch,
                            opm: 'Helling liggende leidingen 1–2 cm/m (nooit minder dan 0,5 cm/m bij DN 110); elke valleiding tot boven het dak ontluchten of een beluchter; sifons minimaal 50 mm waterslot.'
                        };
                    }
                },
                {
                    id: 'san.regenwater', naam: 'Regenwater: goot, regenpijp en put', kort: 'Afvoerdebiet van een dak, goot- en pijpcapaciteit, hemelwaterput',
                    zoek: 'regenwater dak goot regenpijp afvoer en 12056-3 hemelwaterput verordening infiltratie liter dakoppervlak', soort: 'indicatief',
                    bron: 'NBN EN 12056-3: Q = r × A × C (r België 0,03 l/(s·m²) = 108 mm/h; 0,05 bij extra veiligheid); halfronde goot Q_N = 2,78 × 10⁻⁵ × A_E^1,25; regenpijp Q = 2,5 × 10⁻⁴ × k_b^−0,167 × d_i^2,667 × f^1,667 (f = 0,33) · Vlaamse Hemelwaterverordening 2023, artikel 7 (woning): put van 5.000 l bij een dak kleiner dan 80 m², 7.500 l vanaf 80 m², 10.000 l vanaf 120 m², en 100 l per m² vanaf 200 m²',
                    velden: [
                        { k: 'A', label: 'Dakoppervlak (horizontale projectie)', eh: 'm²' },
                        { k: 'r', label: 'Regenintensiteit', type: 'keuze', opties: [{ v: 0.03, t: '0,03 l/(s·m²) — standaard België' }, { v: 0.05, t: '0,05 l/(s·m²) — veiligheidsmarge / binnenafvoer' }], std: 0.03 },
                        { k: 'C', label: 'Afvoercoëfficiënt', std: 1, min: 0.1, max: 1, snel: [{ t: 'Pannen/plat 1,0', v: 1 }, { t: 'Groendak 0,5', v: 0.5 }, { t: 'Grind 0,7', v: 0.7 }] },
                        { k: 'goot', label: 'Goot (halfrond, breedte)', type: 'keuze', opties: [{ v: 100, t: '100 mm' }, { v: 125, t: '125 mm' }, { v: 150, t: '150 mm' }, { v: 180, t: '180 mm' }, { v: 200, t: '200 mm' }], std: 125 },
                        { k: 'pijp', label: 'Regenpijp', type: 'keuze', opties: [{ v: 60, t: 'Ø 60' }, { v: 70, t: 'Ø 70' }, { v: 80, t: 'Ø 80' }, { v: 90, t: 'Ø 90' }, { v: 100, t: 'Ø 100' }, { v: 125, t: 'Ø 125' }], std: 80 },
                        { k: 'npijp', label: 'Aantal regenpijpen', std: 1, min: 1 }
                    ],
                    bereken: function (v, h) {
                        var Q = Number(v.r) * v.A * v.C;
                        var g = Number(v.goot), AE = Math.PI * g * g / 8, Qgoot = 2.78e-5 * Math.pow(AE, 1.25);
                        var di = Number(v.pijp) - 4, Qpijp = 2.5e-4 * Math.pow(0.25, -0.167) * Math.pow(di, 2.667) * Math.pow(0.33, 1.667);
                        var nodig = Math.ceil(Q / Qpijp);
                        var put = v.A < 80 ? 5000 : v.A < 120 ? 7500 : v.A < 200 ? 10000 : Math.ceil(v.A * 100 / 500) * 500;
                        var waarsch = [];
                        if (Qgoot < Q / v.npijp) waarsch.push('Goot van ' + g + ' mm kan ' + h.fmt(Qgoot, 2) + ' l/s per afvoer: te klein voor ' + h.fmt(Q / v.npijp, 2) + ' l/s — bredere goot of meer regenpijpen.');
                        if (v.npijp < nodig) waarsch.push('Minstens ' + nodig + ' regenpijpen Ø ' + Number(v.pijp) + ' nodig (of een grotere maat).');
                        return {
                            uit: [h.uit('Regenwaterdebiet van het dak', Q, 'l/s', { dec: 2, hoofd: true, opm: h.fmt(Q * 3600, 0) + ' l/h bij een piekbui' }), h.uit('Capaciteit goot ' + g + ' mm (per afvoer)', Qgoot, 'l/s', { dec: 2, kleur: Qgoot >= Q / v.npijp ? 'groen' : 'rood' }), h.uit('Capaciteit regenpijp Ø ' + Number(v.pijp), Qpijp, 'l/s', { dec: 2, opm: h.fmt(Qpijp * v.npijp, 2) + ' l/s met ' + v.npijp + ' pijp(en)', kleur: Qpijp * v.npijp >= Q ? 'groen' : 'rood' }), h.uit('Hemelwaterput (verordening 2023)', put, 'l', { hoofd: true }), h.uit('Jaarlijkse opbrengst (±800 mm)', v.A * 0.8 * v.C, 'm³', { dec: 0 })],
                            stappen: ['Q = ' + h.fmt(Number(v.r), 3) + ' × ' + h.f(v.A) + ' × ' + h.f(v.C) + ' = ' + h.f(Q, 2, 'l/s'), 'Goot: A_E = π × ' + g + '² / 8 = ' + h.fmt(AE, 0) + ' mm² → Q_N = 2,78e−5 × A_E^1,25 = ' + h.fmt(Qgoot, 2) + ' l/s', 'Regenpijp: d_i ≈ ' + di + ' mm, f = 0,33 → ' + h.fmt(Qpijp, 2) + ' l/s'],
                            waarsch: waarsch, opm: 'Gootcapaciteit = korte goot zonder helling (EN 12056-3); met helling en een lengte tot ±10 m ligt ze 10–20 % hoger. De put krijgt een pomp en leidingen naar elk toilet, de wasmachine en de tuin. Staat er al een put, dan is bij een verbouwing geen tweede verplicht. Voor de infiltratie: zie “Hemelwater: infiltratie”. De gemeente kan strenger zijn.'
                        };
                    }
                },
                {
                    id: 'san.regenwatergebruik', naam: 'Regenwater gebruiken: opbrengst en besparing', kort: 'Hoeveel leidingwater spaart de hemelwaterput uit?',
                    zoek: 'regenwater hergebruik hemelwaterput opbrengst besparing toilet wasmachine tuin dekking autonomie leidingwater liter per jaar', soort: 'indicatief',
                    bron: 'Opbrengst = dakoppervlak × neerslag × rendement (België ±800 mm per jaar; pannendak met filter ±0,8) · verbruik volgens de VMM (2023): 93 l per persoon per dag, waarvan 19 % voor het toilet (±18 l) en 16 % voor de wasmachine (±15 l) · de put dekt wat het kleinste is: de opbrengst of de vraag',
                    velden: [
                        { k: 'A', label: 'Dakoppervlak (horizontale projectie)', eh: 'm²', min: 0 },
                        { k: 'pers', label: 'Personen', std: 4, min: 1 },
                        { k: 'wc', label: 'Toiletten op regenwater', type: 'vink', std: true },
                        { k: 'was', label: 'Wasmachine op regenwater', type: 'vink', std: true },
                        { k: 'tuin', label: 'Tuin en schoonmaak', eh: 'l/dag', std: 30, min: 0 },
                        { k: 'put', label: 'Inhoud van de put', eh: 'l', std: 5000, min: 0, snel: [{ t: '5.000', v: 5000 }, { t: '7.500', v: 7500 }, { t: '10.000', v: 10000 }] },
                        { k: 'regen', label: 'Neerslag per jaar', eh: 'mm', std: 800, min: 0 },
                        { k: 'rend', label: 'Rendement (dak en filter)', std: 0.8, min: 0.1, max: 1, snel: [{ t: 'Pannen 0,8', v: 0.8 }, { t: 'Plat dak met grind 0,6', v: 0.6 }, { t: 'Groendak 0,3', v: 0.3 }] },
                        { k: 'pw', label: 'Waterprijs', eh: '€/m³', std: 5, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var opbr = v.A * v.regen * v.rend, dag = v.pers * ((v.wc ? 18 : 0) + (v.was ? 15 : 0)) + v.tuin, vraag = dag * 365, benut = Math.min(opbr, vraag);
                        var waarsch = [];
                        if (vraag > 0 && opbr < vraag * 0.8) waarsch.push('Het dak levert minder dan de vraag: de put staat geregeld leeg. Sluit een groter dak aan of voorzie een automatische bijvulling.');
                        if (dag > 0 && v.put / dag < 14) waarsch.push('De put overbrugt maar ' + h.fmt(v.put / dag, 0) + ' dagen zonder regen. Reken op drie tot vier weken.');
                        return {
                            uit: [h.uit('Besparing per jaar', benut / 1000 * v.pw, '€', { dec: 0, hoofd: true, opm: h.fmt(benut / 1000, 0) + ' m³ leidingwater minder' }), h.uit('Opbrengst van het dak', opbr / 1000, 'm³', { dec: 0, hoofd: true }), h.uit('Vraag naar regenwater', vraag / 1000, 'm³', { dec: 0, opm: h.fmt(dag, 0) + ' l per dag' }), h.uit('Dekking van de vraag', vraag > 0 ? benut / vraag * 100 : 0, '%', { dec: 0 }), h.uit('Voorraad bij een volle put', dag > 0 ? v.put / dag : null, 'dagen', { dec: 0 })],
                            stappen: ['Opbrengst = ' + h.f(v.A, 0) + ' m² × ' + h.f(v.regen, 0) + ' mm × ' + h.f(v.rend, 2) + ' = ' + h.f(opbr, 0, 'l'), 'Vraag = ' + h.f(dag, 0) + ' l × 365 = ' + h.f(vraag, 0, 'l')],
                            waarsch: waarsch,
                            opm: 'Richtwaarde op jaarbasis. In een droge zomer staat de put leeg terwijl de tuin het meeste vraagt. Regenwaterleidingen krijgen een eigen kleur of merkteken en mogen nooit met het drinkwaternet verbonden zijn (Belgaqua).'
                        };
                    }
                },
                {
                    id: 'san.infiltratie', naam: 'Hemelwater: infiltratie', kort: 'Oppervlakte en buffervolume van de infiltratievoorziening',
                    zoek: 'infiltratie infiltratievoorziening hemelwater regenwater wadi infiltratiekom infiltratiekratten buffervolume verharding oprit hemelwaterverordening 2023', soort: 'indicatief',
                    bron: 'Vlaamse Hemelwaterverordening 2023, artikel 8: infiltratieoppervlakte minstens 8 % van de afwaterende oppervlakte en buffervolume minstens 33 l per m² · met een conforme hemelwaterput mag 30 m² per woning van de afwaterende oppervlakte af · vrijgesteld: eigendom kleiner dan 120 m² · artikel 9: kan infiltreren niet, dan vanaf 1.000 m² een buffer van 43 l per m² met een vertraagde afvoer van hoogstens 5 l per seconde en per hectare',
                    uitleg: 'De afwaterende oppervlakte is alles wat naar de voorziening afwatert: daken en verhardingen. Waterdoorlatende verharding met minder dan 2 % helling telt niet mee. Enkel het deel boven de hoogste grondwaterstand telt als buffer en als infiltratieoppervlakte.',
                    velden: [
                        { k: 'A', label: 'Afwaterende oppervlakte (dak en verharding)', eh: 'm²', min: 0 },
                        { k: 'put', label: 'Er is een hemelwaterput volgens de verordening', type: 'vink', std: true },
                        { k: 'won', label: 'Woningen aangesloten op de put', std: 1, min: 1, max: 100 },
                        { k: 'perceel', label: 'Oppervlakte van het eigendom', eh: 'm²', opt: true, min: 0 },
                        { k: 'Ai', label: 'Oppervlakte die je voor de voorziening hebt', eh: 'm²', opt: true, min: 0 }
                    ],
                    bereken: function (v, h) {
                        if (v.perceel != null && v.perceel < 120) return { uit: [h.uit('Infiltratievoorziening', 'niet verplicht', '', { hoofd: true, opm: 'eigendom kleiner dan 120 m²' })], opm: 'De hemelwaterput en de gescheiden afvoer blijven wel verplicht.' };
                        var aftrek = v.put ? 30 * Math.round(v.won) : 0, An = Math.max(0, v.A - aftrek), Ainf = 0.08 * An, V = 33 * An;
                        var uit = [h.uit('Infiltratieoppervlakte minstens', Ainf, 'm²', { dec: 1, hoofd: true }), h.uit('Buffervolume minstens', V, 'l', { dec: 0, hoofd: true, opm: h.fmt(V / 1000, 2) + ' m³' }), h.uit('Oppervlakte in rekening', An, 'm²', { dec: 0, opm: aftrek ? h.fmt(v.A, 0) + ' − ' + aftrek + ' m² voor de put' : '' })];
                        var st = ['A = ' + h.f(v.A, 0) + ' − ' + aftrek + ' = ' + h.f(An, 0, 'm²'), 'Infiltratieoppervlakte = 8 % × ' + h.fmt(An, 0) + ' = ' + h.f(Ainf, 1, 'm²'), 'Buffervolume = 33 l × ' + h.fmt(An, 0) + ' = ' + h.f(V, 0, 'l')];
                        var waarsch = [];
                        if (An > 0) {
                            var opp = v.Ai != null && v.Ai > 0 ? v.Ai : Ainf, diep = V / 1000 / opp;
                            uit.push(h.uit('Gemiddelde diepte bij ' + h.fmt(opp, 1) + ' m²', diep * 100, 'cm', { dec: 0 }));
                            if (v.Ai != null && v.Ai > 0 && v.Ai < Ainf) waarsch.push('De voorziene oppervlakte is kleiner dan de ' + h.fmt(Ainf, 1) + ' m² die de verordening vraagt.');
                            if (diep > 0.5) waarsch.push('Dieper dan 50 cm: toon dan met een meting aan dat het grondwater lager staat, of maak de voorziening groter en ondieper.');
                        }
                        if (v.A >= 1000) waarsch.push('Vanaf 1.000 m² afwaterende oppervlakte en dieper dan 50 cm vraagt de verordening een meting van het grondwaterpeil en minstens drie infiltratieproeven.');
                        return { uit: uit, stappen: st, waarsch: waarsch, opm: 'De voorziening ligt bovengronds (kom, wadi, gracht), tenzij je motiveert waarom dat niet kan. De noodoverlaat ligt minder dan 30 cm onder het maaiveld. De gemeente of de provincie kan strenger zijn.' };
                    }
                },
                {
                    id: 'san.septisch', naam: 'Septische put en IBA', kort: 'Richtwaarden per inwonerequivalent',
                    zoek: 'septische put iba inwonerequivalent ie vlarem individuele behandeling afvalwater liter', soort: 'indicatief',
                    bron: 'Vlarem II (richtwaarden): septische put ≥ 3.000 l tot 10 IE, daarna ±300 l per extra IE; IBA gedimensioneerd per IE (5–10 IE particulier), certificering Certipro',
                    velden: [{ k: 'pers', label: 'Personen (inwonerequivalenten)', std: 4, min: 1 }, { k: 'zone', label: 'Zone', type: 'keuze', opties: [{ v: 'centraal', t: 'Centraal gebied (riolering) — septische put' }, { v: 'collectief', t: 'Collectief te optimaliseren buitengebied — septische put' }, { v: 'individueel', t: 'Individueel te optimaliseren buitengebied — IBA verplicht' }] }],
                    bereken: function (v, h) {
                        var V = v.pers <= 10 ? 3000 : 3000 + (v.pers - 10) * 300;
                        return { uit: [h.uit(v.zone === 'individueel' ? 'IBA voor' : 'Septische put', v.zone === 'individueel' ? v.pers + ' IE' : h.fmt(V, 0) + ' l', '', { hoofd: true }), h.uit('Inwonerequivalenten', v.pers, 'IE')], opm: 'Zoneringsplan (VMM) bepaalt de verplichting; bij riolering moet de septische put vaak overbrugd worden zodra de zuivering aangesloten is — vraag het na bij de gemeente of Aquafin.' };
                    }
                },
                {
                    id: 'san.vetafscheider', naam: 'Vetafscheider (EN 1825)', kort: 'Nominale grootte uit maaltijden per dag',
                    zoek: 'vetafscheider en 1825 nominale grootte ns keuken restaurant horeca maaltijden', soort: 'indicatief',
                    bron: 'EN 1825-2 (maaltijdenmethode): Q_S = M × V_M × F / (3600 × t); NS = Q_S × f_d × f_t × f_r; restaurant V_M 50 l, F 8,5 · hotel 100 l, F 5 · kantine 5 l, F 20 · ziekenhuis 20 l, F 22',
                    velden: [
                        { k: 'M', label: 'Maaltijden per dag', std: 200 },
                        { k: 'soort', label: 'Keuken', type: 'keuze', opties: [{ v: 'rest', t: 'Restaurant' }, { v: 'hotel', t: 'Hotel' }, { v: 'kantine', t: 'Kantine / bedrijfsrestaurant' }, { v: 'zh', t: 'Ziekenhuis / zorg' }] },
                        { k: 't', label: 'Bedrijfsuren per dag', eh: 'h', std: 8 },
                        { k: 'ft', label: 'Afvalwater warmer dan 60 °C', type: 'vink', std: false },
                        { k: 'fr', label: 'Reinigingsmiddelen', type: 'keuze', opties: [{ v: 1, t: 'Geen of zelden (1,0)' }, { v: 1.3, t: 'Regelmatig (1,3)' }, { v: 1.5, t: 'Ziekenhuis / desinfectie (1,5)' }], std: 1.3 }
                    ],
                    bereken: function (v, h) {
                        var K = { rest: [50, 8.5], hotel: [100, 5], kantine: [5, 20], zh: [20, 22] }[v.soort];
                        var Qs = v.M * K[0] * K[1] / (3600 * v.t), NS = Qs * 1.0 * (v.ft ? 1.3 : 1) * Number(v.fr);
                        var keuze = h.omhoogNaar(NS, [1, 2, 4, 7, 10, 15, 20, 25, 30]);
                        return { uit: [h.uit('Vetafscheider NS', keuze, '', { hoofd: true, opm: 'berekend NS ' + h.fmt(NS, 2) }), h.uit('Afvalwaterdebiet Q_S', Qs, 'l/s', { dec: 2 })], stappen: ['Q_S = ' + h.fmt(v.M) + ' × ' + h.fmt(K[0]) + ' × ' + h.fmt(K[1], 1) + ' / (3600 × ' + h.f(v.t) + ') = ' + h.f(Qs, 2, 'l/s'), 'NS = ' + h.fmt(Qs, 2) + ' × 1,0 × ' + (v.ft ? '1,3' : '1,0') + ' × ' + h.fmt(Number(v.fr), 2) + ' = ' + h.fmt(NS, 2)] };
                    }
                },
                {
                    id: 'san.opvoer', naam: 'Pompput en opvoerinstallatie', kort: 'Pompdebiet, opvoerhoogte en persleiding voor afvalwater onder het rioolniveau',
                    zoek: 'pompput opvoerinstallatie vuilwaterpomp fecalienpomp kelder persleiding opvoerhoogte terugstuwniveau afvalwater onder riool en 12056-4', soort: 'indicatief',
                    bron: 'NBN EN 12056-4: snelheid in de persleiding tussen 0,7 en 2,3 m/s · persleiding minstens DN 80 voor fecaliën zonder versnijder, DN 32 met versnijder · nuttige inhoud van de put groter dan de inhoud van de persleiding · drukverlies Darcy-Weisbach met ruwheid 0,25 mm',
                    uitleg: 'De persleiding loopt eerst met een lus tot boven het terugstuwniveau (het straatpeil) en sluit dan aan op de riolering. De opvoerhoogte telt van het laagste waterpeil in de put tot de top van die lus.',
                    velden: [
                        { k: 'Q', label: 'Afvalwaterdebiet dat toekomt', eh: 'l/s', std: 1.5, min: 0, hint: 'uit “Afvoerleidingen (EN 12056-2)”' },
                        { k: 'hgeo', label: 'Hoogte van het waterpeil tot de top van de lus', eh: 'm', std: 3, min: 0 },
                        { k: 'L', label: 'Lengte van de persleiding', eh: 'm', std: 12, min: 0 },
                        { k: 'd', label: 'Persleiding', type: 'keuze', opties: [{ v: 26, t: 'DN 32 (PE 32, binnen 26 mm) met versnijder' }, { v: 32.6, t: 'DN 40 (PE 40, binnen 32,6 mm) met versnijder' }, { v: 40.8, t: 'DN 50 (PE 50, binnen 40,8 mm) grijs water' }, { v: 51.4, t: 'DN 65 (PE 63, binnen 51,4 mm) grijs water' }, { v: 73.6, t: 'DN 80 (PE 90, binnen 73,6 mm) fecaliën' }, { v: 90, t: 'DN 100 (PE 110, binnen 90 mm) fecaliën' }], std: 73.6 },
                        { k: 'bochten', label: 'Bochten in de persleiding', std: 5, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var d = Number(v.d), A = Math.PI * d * d / 4 / 1e6, Qmin = 0.7 * A * 1000, Qp = Math.max(v.Q, Qmin);
                        var r = R.darcy(Qp * 3.6, d, 0.25, 1.31e-6, 1000), zeta = v.bochten * 0.5 + 2.5 + 0.5 + 1.0;
                        var hL = r.dp * v.L / 9806.65, hZ = zeta * r.v * r.v / (2 * 9.81), H = v.hgeo + hL + hZ, inhoud = A * v.L * 1000;
                        var waarsch = [];
                        if (r.v > 2.3) waarsch.push('Snelheid ' + h.fmt(r.v, 1) + ' m/s ligt boven 2,3 m/s: kies een grotere persleiding.');
                        if (Qp > v.Q) waarsch.push('Het pompdebiet is verhoogd tot ' + h.fmt(Qp, 1) + ' l/s om 0,7 m/s in de persleiding te halen. Zo spoelt de leiding zichzelf schoon.');
                        return {
                            uit: [h.uit('Pomp kiezen', h.fmt(Qp, 1) + ' l/s bij ' + h.fmt(H, 1) + ' m', '', { hoofd: true, opm: h.fmt(Qp * 3.6, 1) + ' m³/h' }), h.uit('Opvoerhoogte', H, 'm', { dec: 1, hoofd: true }), h.uit('Snelheid in de persleiding', r.v, 'm/s', { dec: 2, kleur: r.v > 2.3 ? 'rood' : 'groen' }), h.uit('Verlies in de leiding', hL, 'm', { dec: 2 }), h.uit('Verlies in bochten, klep en afsluiter', hZ, 'm', { dec: 2 }), h.uit('Nuttige inhoud van de put minstens', Math.max(20, inhoud), 'l', { dec: 0, opm: 'inhoud van de persleiding: ' + h.fmt(inhoud, 0) + ' l' })],
                            stappen: ['Q_min = 0,7 m/s × ' + h.fmt(A * 1e4, 1) + ' cm² = ' + h.f(Qmin, 2, 'l/s'), 'H = ' + h.f(v.hgeo, 1) + ' + ' + h.fmt(hL, 2) + ' + ' + h.fmt(hZ, 2) + ' = ' + h.f(H, 1, 'm')],
                            waarsch: waarsch,
                            opm: 'Voorzie een terugslagklep en een afsluiter in de persleiding, een ontluchting van de put tot boven het dak en een alarm bij hoog water. Toestellen boven het straatpeil sluit je rechtstreeks op de riolering aan, niet op de pompput.'
                        };
                    }
                }
            ] },
            { naam: 'Water', items: [
                {
                    id: 'san.hardheid', naam: 'Waterhardheid en ontharder', kort: '°fH, °dH, mg/l omrekenen; capaciteit en zoutverbruik van een ontharder',
                    zoek: 'waterhardheid hardheid franse duitse graden fh dh ontharder waterverzachter hars zout capaciteit regeneratie kalk', soort: 'indicatief',
                    bron: '1 °fH = 10 mg/l CaCO₃ = 0,56 °dH = 0,1 mmol/l · capaciteit hars ±5,5 °fH·m³ per liter hars · zout ±0,15 kg per liter hars per regeneratie · Vlaanderen: 20–45 °fH (Antwerpen ±35 °fH = hard)',
                    velden: [
                        { k: 'hard', label: 'Hardheid van het leidingwater', eh: '°fH', ehs: ['°fH', '°dH', 'mg/l CaCO₃', 'mmol/l'], std: 35 },
                        { k: 'rest', label: 'Gewenste resthardheid', eh: '°fH', std: 8, snel: [{ t: '5', v: 5 }, { t: '8', v: 8 }, { t: '10', v: 10 }] },
                        { k: 'pers', label: 'Personen', std: 4, min: 0 },
                        { k: 'lpd', label: 'Verbruik per persoon', eh: 'l/dag', std: 120 },
                        { k: 'hars', label: 'Harsvolume ontharder', eh: 'l', std: 20, snel: [{ t: '10', v: 10 }, { t: '15', v: 15 }, { t: '20', v: 20 }, { t: '25', v: 25 }] }
                    ],
                    bereken: function (v, h) {
                        var klasse = v.hard < 7 ? 'zeer zacht' : v.hard < 15 ? 'zacht' : v.hard < 30 ? 'middelhard' : v.hard < 42 ? 'hard' : 'zeer hard';
                        var m3dag = v.pers * v.lpd / 1000, cap = v.hars * 5.5, tussen = cap / Math.max(1, v.hard - v.rest), dagen = tussen / Math.max(m3dag, 1e-9);
                        var regJaar = 365 / dagen, zout = regJaar * v.hars * 0.15;
                        return {
                            uit: [h.uit('Hardheid', h.fmt(v.hard, 1) + ' °fH = ' + h.fmt(v.hard * 0.56, 1) + ' °dH = ' + h.fmt(v.hard * 10, 0) + ' mg/l CaCO₃', '', { hoofd: true, opm: klasse }), h.uit('Water tussen twee regeneraties', tussen, 'm³', { dec: 1, hoofd: true }), h.uit('Om de', dagen, 'dagen', { dec: 1 }), h.uit('Regeneraties per jaar', regJaar, '', { dec: 0 }), h.uit('Zoutverbruik per jaar', zout, 'kg', { dec: 0 }), h.uit('Kalk per jaar zonder ontharder', m3dag * 365 * v.hard * 10 / 1000, 'kg CaCO₃', { dec: 1 })],
                            stappen: ['Capaciteit = ' + h.f(v.hars) + ' l × 5,5 = ' + h.fmt(cap, 0) + ' °fH·m³', 'Water = ' + h.fmt(cap, 0) + ' / (' + h.fmt(v.hard, 1) + ' − ' + h.f(v.rest) + ') = ' + h.f(tussen, 1, 'm³')],
                            opm: 'Zet de resthardheid niet op 0: 5–10 °fH beschermt de leidingen (Belgaqua raadt af om drinkwater onder 15 °fH te ontharden zonder mengklep).'
                        };
                    }
                },
                {
                    id: 'san.verbruik', naam: 'Waterverbruik en warmwaterkost', kort: 'm³ per jaar, waterfactuur en de energie voor warm water',
                    zoek: 'waterverbruik m3 per jaar personen waterfactuur kost warm water energie', soort: 'indicatief',
                    bron: 'België: ±100–120 l per persoon per dag, waarvan ±35 % warm; waterprijs incl. afvoer en zuivering ±€ 5/m³; warm water ΔT 50 K = 58 Wh per liter',
                    velden: [
                        { k: 'pers', label: 'Personen', std: 4, min: 1 },
                        { k: 'lpd', label: 'Verbruik per persoon', eh: 'l/dag', std: 110 },
                        { k: 'warm', label: 'Aandeel warm water', eh: '%', std: 35 },
                        { k: 'pw', label: 'Waterprijs', eh: '€/m³', std: 5 },
                        { k: 'pe', label: 'Energieprijs warm water', eh: '€/kWh', std: 0.12, snel: [{ t: 'Gas 0,12', v: 0.12 }, { t: 'Elektrisch 0,35', v: 0.35 }, { t: 'WP-boiler 0,12', v: 0.12 }] },
                        { k: 'eta', label: 'Rendement opwekking', std: 0.85, min: 0.3, max: 4, snel: [{ t: 'Gas 0,85', v: 0.85 }, { t: 'Elektrisch 0,95', v: 0.95 }, { t: 'WP-boiler 2,8', v: 2.8 }] }
                    ],
                    bereken: function (v, h) {
                        var m3 = v.pers * v.lpd * 365 / 1000, warm = m3 * v.warm / 100 * 1000, E = warm * 50 * W.wh_l_K / 1000 / v.eta;
                        return { uit: [h.uit('Waterverbruik per jaar', m3, 'm³', { dec: 0, hoofd: true, opm: '€ ' + h.fmt(m3 * v.pw, 0) }), h.uit('Warm water per jaar', warm / 1000, 'm³', { dec: 0 }), h.uit('Energie voor warm water', E, 'kWh', { dec: 0, hoofd: true, opm: '€ ' + h.fmt(E * v.pe, 0) + ' per jaar' }), h.uit('Per dag', v.pers * v.lpd, 'l')], stappen: ['m³ = ' + v.pers + ' × ' + h.f(v.lpd) + ' × 365 / 1000 = ' + h.f(m3, 0), 'E = ' + h.fmt(warm, 0) + ' l × 50 K × 1,163 Wh / ' + h.f(v.eta) + ' = ' + h.f(E, 0, 'kWh')] };
                    }
                },
                {
                    id: 'san.lek', naam: 'Lekverlies: druppelende kraan of lopend toilet', kort: 'Liter per dag en euro per jaar',
                    zoek: 'lek lekverlies druppelende kraan lopend toilet waterverlies liter per dag kost per jaar waterfactuur spoelbak vlotter', soort: 'indicatief',
                    bron: 'Gemeten: volume / tijd · druppels: ±20 druppels per milliliter · schatting: richtwaarden van De Watergroep (lekkende kraan 4 l per uur, dun straaltje 16, slecht werkende spoelbak van het toilet 25, waterstraal 63) · warm water: 1,163 Wh per liter en per graad',
                    uitleg: 'Het juiste cijfer krijg je door te meten: vang het water een minuut op in een maatbeker, of lees de watermeter twee keer af terwijl niemand water gebruikt.',
                    velden: [
                        { k: 'meth', label: 'Hoe ken je het lek?', type: 'keuze', opties: [{ v: 'druppel', t: 'Druppels per minuut geteld' }, { v: 'meten', t: 'Opgevangen in een maatbeker' }, { v: 'toilet', t: 'Schatting op het zicht' }], std: 'druppel' },
                        { k: 'dpm', label: 'Druppels per minuut', std: 60, min: 0 },
                        { k: 'ml', label: 'Opgevangen volume', eh: 'ml', ehs: ['ml', 'cl', 'l'], opt: true, min: 0 },
                        { k: 't', label: 'in een tijd van', eh: 's', ehs: ['s', 'min', 'h'], opt: true, min: 0 },
                        { k: 'wc', label: 'Schatting: soort lek', type: 'keuze', opties: [{ v: 4, t: 'Lekkende kraan (4 l per uur)' }, { v: 16, t: 'Dun waterstraaltje (16 l per uur)' }, { v: 25, t: 'Lopend toilet, slecht werkende spoelbak (25 l per uur)' }, { v: 63, t: 'Waterstraal (63 l per uur)' }], std: 25 },
                        { k: 'pw', label: 'Waterprijs', eh: '€/m³', std: 5, min: 0 },
                        { k: 'warm', label: 'Het is warm water', type: 'vink', std: false },
                        { k: 'pe', label: 'Prijs van de warmte', eh: '€/kWh', std: 0.12, min: 0 }
                    ],
                    bereken: function (v, h) {
                        var lh, st = [];
                        if (v.meth === 'meten') {
                            if (v.ml == null || v.t == null) return { wacht: true, ontbreekt: ['volume en tijd'] };
                            if (!(v.t > 0)) return { fout: 'De tijd moet groter zijn dan 0' };
                            lh = v.ml / 1000 / v.t * 3600; st.push('Debiet = ' + h.f(v.ml, 0) + ' ml / ' + h.f(v.t, 0) + ' s = ' + h.f(lh, 2, 'l/h'));
                        } else if (v.meth === 'toilet') { lh = Number(v.wc); st.push('Richtwaarde: ' + h.f(lh, 0, 'l/h')); }
                        else { lh = v.dpm * 0.05 * 60 / 1000; st.push('Debiet = ' + h.f(v.dpm, 0) + ' druppels × 0,05 ml × 60 = ' + h.f(lh, 2, 'l/h')); }
                        var dag = lh * 24, jaar = dag * 365 / 1000, kost = jaar * v.pw;
                        var uit = [h.uit('Verlies per jaar', jaar, 'm³', { dec: 1, hoofd: true, opm: '€ ' + h.fmt(kost, 0) + ' water' }), h.uit('Per dag', dag, 'l', { dec: 1, hoofd: true }), h.uit('Per uur', lh, 'l', { dec: 2 })];
                        if (v.warm) { var E = jaar * 1000 * W.wh_l_K * 45 / 1000; uit.push(h.uit('Verloren warmte per jaar', E, 'kWh', { dec: 0, opm: '€ ' + h.fmt(E * v.pe, 0) + ' bij ΔT 45 K' }), h.uit('Water en warmte samen', kost + E * v.pe, '€', { dec: 0 })); }
                        st.push('Per jaar = ' + h.fmt(lh, 2) + ' × 24 × 365 / 1.000 = ' + h.f(jaar, 1, 'm³'));
                        return { uit: uit, stappen: st, opm: 'Zo vind je een verborgen lek: lees de watermeter af voor het slapengaan en de volgende ochtend, zonder water te gebruiken. Elk verschil is een lek. Een lopend toilet zie je met een vel toiletpapier tegen de achterwand van de pot: wordt het nat, dan lekt de spoelbak.' };
                    }
                }
            ] }
        ]
    });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-sanitair */
