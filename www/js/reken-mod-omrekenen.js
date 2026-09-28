/* QE Rekenmachine — module Omrekenen (v408)
 * BRON = QE-Software/reken-mod-omrekenen.js; kopie in de www via `node sync-reken.js`.
 * Eenheden per familie uit reken-kern.js; temperatuur apart; buismaten DN/duim/mm als naslag.
 */
(function (root) {
    'use strict';
    var R = root.QEReken;
    if (!R) throw new Error('reken-kern.js eerst laden');
    var F = R.FAMILIES;
    var VOLGORDE = [
        ['vermogen', 'kW, W, kcal/h, BTU/h, pk', 'vermogen kw watt kcal btu pk omrekenen'],
        ['energie', 'kWh, MJ, GJ, kcal, BTU', 'energie kwh mj gj kcal btu joule omrekenen'],
        ['druk', 'bar, mbar, Pa, kPa, psi, mWK, mmWK', 'druk bar mbar pascal kpa psi mwk mmwk atm omrekenen'],
        ['debiet', 'm³/h, l/h, l/min, l/s, cfm', 'debiet m3/h l/h l/min l/s cfm gallon omrekenen'],
        ['lengte', 'm, mm, cm, inch, ft', 'lengte meter mm inch duim voet omrekenen'],
        ['oppervlakte', 'm², cm², mm², are, ha', 'oppervlakte m2 cm2 are hectare omrekenen'],
        ['volume', 'l, m³, ml, gallon, ft³', 'volume liter m3 gallon omrekenen'],
        ['massa', 'kg, g, ton, lb', 'massa gewicht kg gram ton pond omrekenen'],
        ['snelheid', 'm/s, km/h, ft/min', 'snelheid m/s km/h omrekenen'],
        ['tijd', 's, min, h, dag', 'tijd seconden minuten uren dagen omrekenen'],
        ['stroom', 'A, mA, kA', 'stroom ampere milliampere omrekenen'],
        ['spanning', 'V, mV, kV', 'spanning volt millivolt kilovolt omrekenen'],
        ['weerstand', 'Ω, mΩ, kΩ, MΩ', 'weerstand ohm omrekenen'],
        ['vermogenopp', 'W/m², kcal/(h·m²), BTU/(h·ft²)', 'vermogen per m2 omrekenen'],
        ['warmtedoorgang', 'W/(m²·K), kcal/(h·m²·°C)', 'u-waarde warmtedoorgang omrekenen'],
        ['dichtheid', 'kg/m³, g/cm³, kg/l', 'dichtheid soortelijk gewicht omrekenen'],
        ['hardheid', '°fH, °dH, mg/l CaCO₃, mmol/l', 'waterhardheid franse duitse graden omrekenen'],
        ['lichtstroom', 'lm, klm', 'lumen omrekenen'],
        ['verlichting', 'lux, fc', 'lux footcandle omrekenen'],
        ['tempverschil', 'K, °C, °F (verschil)', 'temperatuurverschil kelvin omrekenen']
    ];
    var items = VOLGORDE.map(function (x) {
        var key = x[0], fam = F[key], eenheden = Object.keys(fam.e);
        return {
            id: 'omz.' + key, naam: fam.naam + ' omrekenen', kort: x[1], zoek: x[2] + ' eenheden ' + eenheden.join(' '), soort: 'exact',
            bron: 'Factoren t.o.v. ' + fam.basis + ': ' + eenheden.map(function (e) { return '1 ' + e + ' = ' + R.fmt(fam.e[e], fam.e[e] < 0.001 ? 8 : 6) + ' ' + fam.basis; }).join(' · '),
            velden: [{ k: 'w', label: 'Waarde', std: 1 }, { k: 'van', label: 'Van', type: 'keuze', opties: eenheden.map(function (e) { return { v: e, t: e }; }), std: eenheden[0] }],
            bereken: function (v, h) {
                var rijen = eenheden.filter(function (e) { return e !== v.van; }).map(function (e) { var w = R.conv(v.w, v.van, e, key); return [e, h.fmt(w, Math.abs(w) >= 1000 ? 1 : Math.abs(w) >= 1 ? 4 : 6)]; });
                return { uit: [h.uit(h.fmt(v.w) + ' ' + v.van, '=', '', { hoofd: true })], tabel: { kop: ['Eenheid', 'Waarde'], rijen: rijen } };
            }
        };
    });
    items.unshift({
        id: 'omz.temperatuur', naam: 'Temperatuur omrekenen', kort: '°C, °F en K', zoek: 'temperatuur celsius fahrenheit kelvin omrekenen', soort: 'exact',
        bron: '°F = °C × 9/5 + 32 · K = °C + 273,15',
        velden: [{ k: 'w', label: 'Waarde', std: 20 }, { k: 'van', label: 'Van', type: 'keuze', opties: [{ v: '°C', t: '°C' }, { v: '°F', t: '°F' }, { v: 'K', t: 'K' }], std: '°C' }],
        bereken: function (v, h) {
            var c = R.conv(v.w, v.van, '°C', 'temperatuur');
            return { uit: [h.uit('°C', c, '°C', { dec: 2, hoofd: v.van !== '°C' }), h.uit('°F', c * 9 / 5 + 32, '°F', { dec: 2, hoofd: v.van !== '°F' }), h.uit('K', c + 273.15, 'K', { dec: 2, hoofd: v.van !== 'K' })] };
        }
    });
    items.push({
        id: 'omz.buismaten', naam: 'Buismaten: DN, duim en mm', kort: 'Naslag: draadmaten, koper, meerlagen, PE en PVC naast elkaar',
        zoek: 'buismaten dn duim inch mm draad koper meerlagen pe pvc naslag tabel binnendiameter buitendiameter', soort: 'naslag',
        bron: 'EN 10255 (staal draadbuis), EN 1057 (koper), EN ISO 21003 (meerlagen), EN 12201 (PE), EN 1329 (PVC afvoer)',
        velden: [],
        bereken: function (v, h) {
            var B = R.BUIZEN;
            function kol(mat, i) { var m = B[mat].maten[i]; return m ? m.n + ' (' + h.fmt(m.d, 1) + ')' : ''; }
            var draad = [['1/4"', 'DN 8', '13,2', '9,2'], ['3/8"', 'DN 10', '17,2', '12,5'], ['1/2"', 'DN 15', '21,3', '16,0'], ['3/4"', 'DN 20', '26,9', '21,6'], ['1"', 'DN 25', '33,7', '27,2'], ['5/4"', 'DN 32', '42,4', '35,9'], ['6/4"', 'DN 40', '48,3', '41,8'], ['2"', 'DN 50', '60,3', '53,0'], ['2½"', 'DN 65', '76,1', '68,8'], ['3"', 'DN 80', '88,9', '80,8'], ['4"', 'DN 100', '114,3', '105,3']];
            var rijen2 = [];
            var n = Math.max(B.koper.maten.length, B.meerlagen.maten.length, B.pe.maten.length, B.pvc.maten.length);
            for (var i = 0; i < n; i++) rijen2.push([kol('koper', i), kol('meerlagen', i), kol('pe', i), kol('pvc', i)]);
            return {
                tabel: { kop: ['Draad', 'DN', 'Buiten Ø mm', 'Binnen Ø mm'], rijen: draad },
                tabel2: { kop: ['Koper (binnen Ø)', 'Meerlagen', 'PE SDR 11', 'PVC afvoer'], rijen: rijen2 },
                opm: 'Draadmaten (BSP) verwijzen naar de historische binnendiameter, niet naar de echte maat: 1/2" = 21,3 mm buiten. Koper- en kunststofmaten zijn buitendiameter × wanddikte.'
            };
        }
    });
    R.registreer({ key: 'omrekenen', naam: 'Omrekenen', emoji: '🔁', volgorde: 5, omschrijving: 'Eenheden, temperatuur en buismaten', groepen: [{ naam: 'Eenheden', items: items }] });
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-mod-omrekenen */
