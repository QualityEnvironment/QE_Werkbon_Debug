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

    R.registreer({
        key: 'sanitair', naam: 'Sanitair', emoji: '🚿', volgorde: 2,
        omschrijving: 'Warm water en boilers, drinkwaterleidingen en druk, afvoeren en regenwater, hardheid en verbruik',
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
                            rijen.push([t.t, h.fmt(r.n), t.lu + ' LU', h.fmt(t.lu * r.n) + ' LU']);
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
                            rijen.push([t.t, h.fmt(r.n), t.du + ' l/s', h.fmt(t.du * r.n, 1) + ' l/s']);
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
                            stappen: ['Q_ww = ' + Number(v.K) + ' × √' + h.fmt(som, 1) + ' = ' + h.f(Qww, 2, 'l/s'), 'Liggend: Q_cap = 0,5 × (1/n) × A × R^(2/3) × √S met n = 0,010'],
                            tabel: { kop: ['Toestel', 'Aantal', 'DU', 'Samen'], rijen: rijen }, waarsch: waarsch,
                            opm: 'Helling liggende leidingen 1–2 cm/m (nooit minder dan 0,5 cm/m bij DN 110); elke valleiding tot boven het dak ontluchten of een beluchter; sifons minimaal 50 mm waterslot.'
                        };
                    }
                },
                {
                    id: 'san.regenwater', naam: 'Regenwater: goot, regenpijp en put', kort: 'Afvoerdebiet van een dak, goot- en pijpcapaciteit, hemelwaterput',
                    zoek: 'regenwater dak goot regenpijp afvoer en 12056-3 hemelwaterput verordening infiltratie liter dakoppervlak', soort: 'indicatief',
                    bron: 'NBN EN 12056-3: Q = r × A × C (r België 0,03 l/(s·m²) = 108 mm/h; 0,05 bij extra veiligheid); halfronde goot Q_N = 2,78 × 10⁻⁵ × A_E^1,25; regenpijp Q = 2,5 × 10⁻⁴ × k_b^−0,167 × d_i^2,667 × f^1,667 (f = 0,33) · Vlaamse Hemelwaterverordening 2023: put ≥ 5.000 l (dak ≤ 80 m²), 7.500 l (80–120 m²), 10.000 l (120–200 m²), 100 l/m² erboven; buffer 33 l/m² verharding',
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
                        var put = v.A <= 80 ? 5000 : v.A <= 120 ? 7500 : v.A <= 200 ? 10000 : Math.ceil(v.A * 100 / 500) * 500;
                        var waarsch = [];
                        if (Qgoot < Q / v.npijp) waarsch.push('Goot van ' + g + ' mm kan ' + h.fmt(Qgoot, 2) + ' l/s per afvoer: te klein voor ' + h.fmt(Q / v.npijp, 2) + ' l/s — bredere goot of meer regenpijpen.');
                        if (v.npijp < nodig) waarsch.push('Minstens ' + nodig + ' regenpijpen Ø ' + Number(v.pijp) + ' nodig (of een grotere maat).');
                        return {
                            uit: [h.uit('Regenwaterdebiet van het dak', Q, 'l/s', { dec: 2, hoofd: true, opm: h.fmt(Q * 3600, 0) + ' l/h bij een piekbui' }), h.uit('Capaciteit goot ' + g + ' mm (per afvoer)', Qgoot, 'l/s', { dec: 2, kleur: Qgoot >= Q / v.npijp ? 'groen' : 'rood' }), h.uit('Capaciteit regenpijp Ø ' + Number(v.pijp), Qpijp, 'l/s', { dec: 2, opm: h.fmt(Qpijp * v.npijp, 2) + ' l/s met ' + v.npijp + ' pijp(en)', kleur: Qpijp * v.npijp >= Q ? 'groen' : 'rood' }), h.uit('Hemelwaterput (verordening 2023)', put, 'l', { hoofd: true }), h.uit('Jaarlijkse opbrengst (±800 mm)', v.A * 0.8 * v.C, 'm³', { dec: 0 })],
                            stappen: ['Q = ' + Number(v.r) + ' × ' + h.f(v.A) + ' × ' + h.f(v.C) + ' = ' + h.f(Q, 2, 'l/s'), 'Goot: A_E = π × ' + g + '² / 8 = ' + h.fmt(AE, 0) + ' mm² → Q_N = 2,78e−5 × A_E^1,25 = ' + h.fmt(Qgoot, 2) + ' l/s', 'Regenpijp: d_i ≈ ' + di + ' mm, f = 0,33 → ' + h.fmt(Qpijp, 2) + ' l/s'],
                            waarsch: waarsch, opm: 'Gootcapaciteit = korte goot zonder helling (EN 12056-3); met helling en een lengte tot ±10 m ligt ze 10–20 % hoger. Verordening 2023 (indicatief): ook infiltratie voorzien (buffer 33 l/m², ±8 m² infiltratieoppervlak per 100 m²) tenzij de gemeente anders beslist; controleer altijd het geldende reglement.'
                        };
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
                        return { uit: [h.uit('Vetafscheider NS', keuze, '', { hoofd: true, opm: 'berekend NS ' + h.fmt(NS, 2) }), h.uit('Afvalwaterdebiet Q_S', Qs, 'l/s', { dec: 2 })], stappen: ['Q_S = ' + v.M + ' × ' + K[0] + ' × ' + K[1] + ' / (3600 × ' + h.f(v.t) + ') = ' + h.f(Qs, 2, 'l/s'), 'NS = ' + h.fmt(Qs, 2) + ' × 1,0 × ' + (v.ft ? '1,3' : '1,0') + ' × ' + Number(v.fr) + ' = ' + h.fmt(NS, 2)] };
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
                }
            ] }
        ]
    });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-sanitair */
