/* QE Rekenmachine — rekenmotor (v408, 28 sep 2026; v411: eenheden voor vacuüm, aanhaalmoment, kracht en Kv/Cv)
 *
 * BRON = QE-Software/reken-kern.js. De kopie in Werkbon_v2_Debug_Updates/www/js/
 * wordt gemaakt met `node sync-reken.js` (projectroot). Nooit de kopie bewerken.
 *
 * Draait identiek in de browser (window.QEReken) en in Node (module.exports),
 * zonder DOM. De modules (reken-mod-*.js) registreren hun berekeningen hier;
 * reken-ui.js tekent ze.
 *
 * Berekening = declaratief object:
 *   { id, module, groep, naam, kort, zoek, soort: 'exact'|'indicatief'|'naslag',
 *     bron, uitleg, velden: [...], bereken(v, h) → { uit, stappen, waarsch, tabel, opm } }
 * Veld = { k, label, eh, ehs, std, opt, min, max, type: 'getal'|'keuze'|'vink'|'tekst'|'rijen',
 *          opties: [{v, t}], snel: [{t, v}], hint, kolommen (rijen) }
 * De motor zet de invoer om naar de eenheid `eh` van elk veld vóór bereken() draait.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.QEReken = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    // ---------------------------------------------------------------- eenheden
    // Per familie: basiseenheid + factor "1 eenheid = f basiseenheden".
    // Temperatuur is de enige niet-lineaire familie (aparte functie).
    var FAMILIES = {
        vermogen: { basis: 'W', naam: 'Vermogen', e: { 'W': 1, 'kW': 1000, 'MW': 1e6, 'kcal/h': 1.163, 'BTU/h': 0.29307107, 'pk': 735.49875, 'ton koeling': 3516.853 } },
        energie: { basis: 'kWh', naam: 'Energie', e: { 'kWh': 1, 'Wh': 0.001, 'MWh': 1000, 'J': 1 / 3.6e6, 'kJ': 1 / 3600, 'MJ': 1 / 3.6, 'GJ': 1000 / 3.6, 'kcal': 0.001163, 'BTU': 0.00029307107, 'therm': 29.3071 } },
        druk: { basis: 'Pa', naam: 'Druk', e: { 'Pa': 1, 'kPa': 1000, 'MPa': 1e6, 'bar': 1e5, 'mbar': 100, 'hPa': 100, 'psi': 6894.757, 'mWK': 9806.65, 'cmWK': 98.0665, 'mmWK': 9.80665, 'atm': 101325, 'kg/cm²': 98066.5, 'mmHg': 133.322, 'inH₂O': 249.089, 'Torr': 133.322, 'micron': 0.133322 } },
        debiet: { basis: 'm³/h', naam: 'Debiet', e: { 'm³/h': 1, 'l/h': 0.001, 'l/min': 0.06, 'l/s': 3.6, 'm³/s': 3600, 'm³/min': 60, 'cfm': 1.699011, 'gal/min (US)': 0.2271247, 'gal/min (UK)': 0.2727654 } },
        lengte: { basis: 'm', naam: 'Lengte', e: { 'm': 1, 'mm': 0.001, 'cm': 0.01, 'dm': 0.1, 'km': 1000, 'inch': 0.0254, 'ft': 0.3048, 'yd': 0.9144, 'mijl': 1609.344 } },
        oppervlakte: { basis: 'm²', naam: 'Oppervlakte', e: { 'm²': 1, 'mm²': 1e-6, 'cm²': 1e-4, 'dm²': 0.01, 'are': 100, 'ha': 10000, 'km²': 1e6, 'ft²': 0.09290304, 'inch²': 0.00064516 } },
        volume: { basis: 'l', naam: 'Volume', e: { 'l': 1, 'ml': 0.001, 'cl': 0.01, 'dl': 0.1, 'm³': 1000, 'cm³': 0.001, 'dm³': 1, 'gal (US)': 3.785411784, 'gal (UK)': 4.54609, 'ft³': 28.316846, 'inch³': 0.016387064 } },
        massa: { basis: 'kg', naam: 'Massa', e: { 'kg': 1, 'g': 0.001, 'ton': 1000, 'lb': 0.45359237, 'oz': 0.028349523 } },
        snelheid: { basis: 'm/s', naam: 'Snelheid', e: { 'm/s': 1, 'km/h': 1 / 3.6, 'm/min': 1 / 60, 'ft/min': 0.00508, 'ft/s': 0.3048, 'mph': 0.44704, 'knoop': 0.514444 } },
        tijd: { basis: 's', naam: 'Tijd', e: { 's': 1, 'min': 60, 'h': 3600, 'dag': 86400, 'week': 604800, 'ms': 0.001 } },
        stroom: { basis: 'A', naam: 'Stroom', e: { 'A': 1, 'mA': 0.001, 'kA': 1000, 'µA': 1e-6 } },
        spanning: { basis: 'V', naam: 'Spanning', e: { 'V': 1, 'mV': 0.001, 'kV': 1000 } },
        weerstand: { basis: 'Ω', naam: 'Weerstand', e: { 'Ω': 1, 'mΩ': 0.001, 'kΩ': 1000, 'MΩ': 1e6 } },
        vermogenopp: { basis: 'W/m²', naam: 'Vermogen per m²', e: { 'W/m²': 1, 'kW/m²': 1000, 'kcal/(h·m²)': 1.163, 'BTU/(h·ft²)': 3.15459 } },
        warmtedoorgang: { basis: 'W/(m²·K)', naam: 'U-waarde', e: { 'W/(m²·K)': 1, 'kcal/(h·m²·°C)': 1.163 } },
        dichtheid: { basis: 'kg/m³', naam: 'Dichtheid', e: { 'kg/m³': 1, 'g/cm³': 1000, 'kg/l': 1000, 'lb/ft³': 16.01846 } },
        lichtstroom: { basis: 'lm', naam: 'Lichtstroom', e: { 'lm': 1, 'klm': 1000 } },
        verlichting: { basis: 'lux', naam: 'Verlichtingssterkte', e: { 'lux': 1, 'fc': 10.76391 } },
        koppel: { basis: 'N·m', naam: 'Aanhaalmoment', e: { 'N·m': 1, 'cN·m': 0.01, 'kgf·m': 9.80665, 'kgf·cm': 0.0980665, 'lbf·ft': 1.3558179, 'lbf·in': 0.1129848 } },
        kracht: { basis: 'N', naam: 'Kracht', e: { 'N': 1, 'daN': 10, 'kN': 1000, 'kgf': 9.80665, 'lbf': 4.4482216 } },
        doorstroom: { basis: 'Kv (m³/h)', naam: 'Kv en Cv', e: { 'Kv (m³/h)': 1, 'Kv (l/min)': 0.06, 'Cv (US gpm)': 0.865 } },
        hardheid: { basis: '°fH', naam: 'Waterhardheid', e: { '°fH': 1, '°dH': 1.7848, '°e': 1.4285, 'mg/l CaCO₃': 0.1, 'mmol/l': 10, 'ppm CaCO₃': 0.1 } },
        temperatuur: { basis: '°C', naam: 'Temperatuur', e: { '°C': 1, 'K': 1, '°F': 1 }, speciaal: true },
        tempverschil: { basis: 'K', naam: 'Temperatuurverschil', e: { 'K': 1, '°C': 1, '°F': 5 / 9 } }
    };
    var EENHEID_FAMILIE = {};
    Object.keys(FAMILIES).forEach(function (f) {
        Object.keys(FAMILIES[f].e).forEach(function (e) { if (!EENHEID_FAMILIE[e]) EENHEID_FAMILIE[e] = f; });
    });
    // eenheden die in meerdere families voorkomen (°C, K) — de aanroeper geeft dan de familie mee
    EENHEID_FAMILIE['°C'] = 'temperatuur';
    EENHEID_FAMILIE['K'] = 'tempverschil';

    function tempNaar(w, van, naar) {
        var c = van === '°C' ? w : van === 'K' ? w - 273.15 : (w - 32) * 5 / 9;
        return naar === '°C' ? c : naar === 'K' ? c + 273.15 : c * 9 / 5 + 32;
    }

    /** Zet w van eenheid `van` om naar eenheid `naar` (zelfde familie). familie optioneel. */
    function conv(w, van, naar, familie) {
        if (van === naar || w == null || isNaN(w)) return w;
        var f = familie || EENHEID_FAMILIE[van];
        if (!f) throw new Error('Onbekende eenheid ' + van);
        if (f === 'temperatuur') return tempNaar(w, van, naar);
        var fam = FAMILIES[f];
        if (fam.e[van] == null || fam.e[naar] == null) throw new Error('Eenheid ' + van + ' → ' + naar + ' hoort niet bij ' + f);
        return w * fam.e[van] / fam.e[naar];
    }

    // ---------------------------------------------------------------- getallen
    var nf = {};
    function fmt(n, dec, opts) {
        if (n == null || n === '' || (typeof n === 'number' && !isFinite(n))) return '–';
        if (typeof n === 'string') return n;
        if (dec == null) {
            var a = Math.abs(n);
            dec = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
        }
        var key = dec + ':' + (opts && opts.min ? 'm' : '');
        if (!nf[key]) {
            try {
                nf[key] = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: opts && opts.min ? dec : 0, maximumFractionDigits: dec });
            } catch (e) { nf[key] = null; }
        }
        if (nf[key]) return nf[key].format(n).replace(/ /g, '.').replace(/\s/g, '.');
        var s = n.toFixed(dec);
        var d = s.split('.');
        d[0] = d[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        return d[1] ? d[0] + ',' + d[1].replace(/0+$/, '').replace(/^$/, '') : d[0];
    }
    /** "2,5" → 2.5, "1.250" → 1250, "1.250,5" → 1250.5, "1,250.5" → 1250.5; leeg/onzin → null */
    function getal(s) {
        if (typeof s === 'number') return isFinite(s) ? s : null;
        if (s == null) return null;
        s = String(s).trim().replace(/\s/g, '');
        if (!s) return null;
        s = s.replace(/[^0-9,.\-+eE]/g, '');
        var lk = s.lastIndexOf(','), lp = s.lastIndexOf('.');
        if (lk >= 0 && lp >= 0) {
            // beide tekens: het laatste is het decimaalteken, het andere scheidt duizendtallen
            if (lk > lp) s = s.replace(/\./g, '').replace(',', '.');
            else s = s.replace(/,/g, '');
        } else if (lk >= 0) {
            // één komma = decimaal ("2,5"); meerdere komma's = duizendtallen ("1,250,000")
            s = (s.split(',').length > 2) ? s.replace(/,/g, '') : s.replace(',', '.');
        } else if (lp >= 0) {
            // één punt = decimaal ("1.5"); meerdere punten = duizendtallen ("1.250.000")
            if (s.split('.').length > 2) s = s.replace(/\./g, '');
        }
        var n = parseFloat(s);
        return isFinite(n) ? n : null;
    }
    function rond(n, dec) { var f = Math.pow(10, dec == null ? 2 : dec); return Math.round(n * f) / f; }
    function omhoogNaar(n, lijst) { for (var i = 0; i < lijst.length; i++) if (lijst[i] >= n - 1e-9) return lijst[i]; return null; }
    function omlaagNaar(n, lijst) { var r = null; for (var i = 0; i < lijst.length; i++) if (lijst[i] <= n + 1e-9) r = lijst[i]; return r; }
    function interp(x, xs, ys) {
        if (x <= xs[0]) return ys[0];
        if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
        for (var i = 1; i < xs.length; i++) if (x <= xs[i]) {
            var t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
            return ys[i - 1] + t * (ys[i] - ys[i - 1]);
        }
        return ys[ys.length - 1];
    }

    // ---------------------------------------------------------------- registratie
    var modules = [];
    var berekeningen = [];
    var perId = {};

    function registreer(mod) {
        if (!mod || !mod.key) throw new Error('module zonder key');
        var bestaand = modules.filter(function (m) { return m.key === mod.key; })[0];
        if (bestaand) throw new Error('module ' + mod.key + ' bestaat al');
        var m = { key: mod.key, naam: mod.naam, emoji: mod.emoji || '', omschrijving: mod.omschrijving || '', volgorde: mod.volgorde == null ? 99 : mod.volgorde, groepen: [] };
        (mod.groepen || []).forEach(function (g) {
            var groep = { naam: g.naam, items: [] };
            (g.items || []).forEach(function (b) {
                if (!b.id || perId[b.id]) throw new Error('berekening zonder unieke id: ' + (b.id || '?'));
                b.module = m.key;
                b.groep = g.naam;
                b.soort = b.soort || 'exact';
                b.velden = b.velden || [];
                b.velden.forEach(function (f) {
                    f.type = f.type || 'getal';
                    if (f.type === 'getal' && f.eh && f.ehs && f.ehs.indexOf(f.eh) < 0) f.ehs.unshift(f.eh);
                });
                perId[b.id] = b;
                berekeningen.push(b);
                groep.items.push(b);
            });
            m.groepen.push(groep);
        });
        modules.push(m);
        modules.sort(function (a, b) { return a.volgorde - b.volgorde; });
        return m;
    }
    function vind(id) { return perId[id] || null; }
    function moduleVan(key) { return modules.filter(function (m) { return m.key === key; })[0] || null; }

    // ---------------------------------------------------------------- zoeken
    function norm(s) {
        return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/³/g, '3').replace(/²/g, '2').replace(/ø/g, 'o');
    }
    function zoek(q) {
        var alle = norm(q).split(/\s+/).filter(Boolean);
        // losse getallen ("kabel 32") tellen niet mee als zoekwoord
        var woorden = alle.filter(function (w) { return !/^[0-9.,]+$/.test(w); });
        if (!woorden.length) woorden = alle;
        if (!woorden.length) return [];
        var res = [];
        berekeningen.forEach(function (b) {
            var mod = moduleVan(b.module);
            var tekst = norm([b.naam, b.kort, b.zoek, b.groep, mod ? mod.naam : ''].join(' '));
            var naam = norm(b.naam);
            var score = 0;
            for (var i = 0; i < woorden.length; i++) {
                var w = woorden[i];
                if (tekst.indexOf(w) < 0) { score = 0; break; }
                score += naam.indexOf(w) >= 0 ? 3 : 1;
                if (naam.indexOf(w) === 0) score += 2;
            }
            if (score) res.push({ b: b, score: score });
        });
        res.sort(function (a, b) { return b.score - a.score || a.b.naam.localeCompare(b.b.naam, 'nl'); });
        return res.map(function (r) { return r.b; });
    }

    // ---------------------------------------------------------------- rekenen
    /** Maakt van ruwe invoer {k: waarde, k_eh: eenheid} de nette waarden in veld-eenheden. */
    function invoer(b, ruw) {
        ruw = ruw || {};
        var v = {}, fouten = [], ontbreekt = [];
        b.velden.forEach(function (f) {
            var r = ruw[f.k];
            if (f.type === 'keuze') {
                var ok = (f.opties || []).some(function (o) { return String(o.v) === String(r); });
                v[f.k] = ok ? r : (f.std != null ? f.std : (f.opties && f.opties.length ? f.opties[0].v : null));
                return;
            }
            if (f.type === 'vink') { v[f.k] = r == null ? !!f.std : !!(r === true || r === 'true' || r === 1 || r === '1' || r === 'on'); return; }
            if (f.type === 'tekst') { v[f.k] = r == null ? (f.std || '') : String(r); return; }
            if (f.type === 'rijen') {
                var rijen = Array.isArray(r) ? r : (f.std || []);
                v[f.k] = rijen.map(function (rij) {
                    var o = {};
                    (f.kolommen || []).forEach(function (c) {
                        var w = rij ? rij[c.k] : null;
                        if (c.type === 'keuze') {
                            var okk = (c.opties || []).some(function (op) { return String(op.v) === String(w); });
                            o[c.k] = okk ? w : (c.opties && c.opties.length ? c.opties[0].v : null);
                        } else if (c.type === 'tekst') o[c.k] = w == null ? '' : String(w);
                        else o[c.k] = getal(w);
                    });
                    return o;
                });
                return;
            }
            // getal
            var n = getal(r);
            if (n == null && r == null && f.std != null) n = f.std;
            if (n == null) {
                if (!f.opt) ontbreekt.push(f);
                v[f.k] = null;
                return;
            }
            var eh = ruw[f.k + '_eh'];
            if (eh && f.eh && eh !== f.eh) {
                try { n = conv(n, eh, f.eh, f.familie); } catch (e) { fouten.push('Eenheid ' + eh + ' onbekend bij ' + f.label); }
            }
            if (f.min != null && n < f.min) fouten.push(f.label + ' moet minstens ' + fmt(f.min) + (f.eh ? ' ' + f.eh : '') + ' zijn');
            if (f.max != null && n > f.max) fouten.push(f.label + ' mag hoogstens ' + fmt(f.max) + (f.eh ? ' ' + f.eh : '') + ' zijn');
            v[f.k] = n;
        });
        return { v: v, fouten: fouten, ontbreekt: ontbreekt };
    }

    // Vaste spatie tussen getal en eenheid. Bewust niet de smalle (U+202F): die is in Archivo 0,1 em breed en lijkt dan weggevallen.
    var NB = String.fromCharCode(160);
    var helpers = {
        fmt: fmt, getal: getal, rond: rond, conv: conv, omhoogNaar: omhoogNaar, omlaagNaar: omlaagNaar, interp: interp,
        uit: function (label, w, e, o) { o = o || {}; return { label: label, w: w, e: e || '', dec: o.dec, hoofd: !!o.hoofd, opm: o.opm || '', kleur: o.kleur || '' }; },
        f: function (n, dec, e) { return fmt(n, dec) + (e ? NB + e : ''); }
    };

    function reken(id, ruw) {
        var b = typeof id === 'string' ? vind(id) : id;
        if (!b) return { fout: 'Onbekende berekening' };
        if (b.soort === 'naslag') {
            try { return b.bereken ? (b.bereken({}, helpers) || {}) : {}; } catch (e) { return { fout: 'Fout: ' + e.message }; }
        }
        var inp = invoer(b, ruw);
        if (inp.fouten.length) return { fout: inp.fouten[0], fouten: inp.fouten };
        if (inp.ontbreekt.length) {
            return { wacht: true, ontbreekt: inp.ontbreekt.map(function (f) { return f.label; }) };
        }
        var r;
        try { r = b.bereken(inp.v, helpers) || {}; } catch (e) { return { fout: 'Rekenfout: ' + e.message }; }
        if (r.fout) return r;
        r.uit = r.uit || [];
        r.stappen = r.stappen || [];
        r.waarsch = r.waarsch || [];
        r.v = inp.v;
        return r;
    }

    // ---------------------------------------------------------------- gedeelde tabellen
    // Binnendiameters (mm) per buismaat — gebruikt door leidingen, waterinhoud, gasleiding, wachttijd.
    var BUIZEN = {
        koper: { naam: 'Koper (EN 1057)', maten: [
            { n: '10×1', d: 8 }, { n: '12×1', d: 10 }, { n: '15×1', d: 13 }, { n: '18×1', d: 16 }, { n: '22×1', d: 20 }, { n: '28×1,5', d: 25 },
            { n: '35×1,5', d: 32 }, { n: '42×1,5', d: 39 }, { n: '54×2', d: 50 }, { n: '64×2', d: 60 }, { n: '76,1×2', d: 72.1 }, { n: '88,9×2', d: 84.9 }, { n: '108×2,5', d: 103 }
        ], ruwheid: 0.0015 },
        staal: { naam: 'Staal draadbuis (EN 10255)', maten: [
            { n: '3/8" (DN10)', d: 12.5 }, { n: '1/2" (DN15)', d: 16 }, { n: '3/4" (DN20)', d: 21.6 }, { n: '1" (DN25)', d: 27.2 }, { n: '5/4" (DN32)', d: 35.9 },
            { n: '6/4" (DN40)', d: 41.8 }, { n: '2" (DN50)', d: 53 }, { n: '2½" (DN65)', d: 68.8 }, { n: '3" (DN80)', d: 80.8 }, { n: '4" (DN100)', d: 105.3 }
        ], ruwheid: 0.045 },
        staalpers: { naam: 'Dunwandig staal pers (VSH/Mapress)', maten: [
            { n: '12×1,2', d: 9.6 }, { n: '15×1,2', d: 12.6 }, { n: '18×1,2', d: 15.6 }, { n: '22×1,5', d: 19 }, { n: '28×1,5', d: 25 }, { n: '35×1,5', d: 32 },
            { n: '42×1,5', d: 39 }, { n: '54×1,5', d: 51 }, { n: '76,1×2', d: 72.1 }, { n: '88,9×2', d: 84.9 }, { n: '108×2', d: 104 }
        ], ruwheid: 0.01 },
        meerlagen: { naam: 'Meerlagenbuis (Begetube/Henco)', maten: [
            { n: '14×2', d: 10 }, { n: '16×2', d: 12 }, { n: '20×2', d: 16 }, { n: '26×3', d: 20 }, { n: '32×3', d: 26 }, { n: '40×3,5', d: 33 }, { n: '50×4', d: 42 }, { n: '63×4,5', d: 54 }, { n: '75×5', d: 65 }
        ], ruwheid: 0.007 },
        pex: { naam: 'PE-X / PE-RT', maten: [
            { n: '16×2', d: 12 }, { n: '20×2', d: 16 }, { n: '25×2,3', d: 20.4 }, { n: '32×2,9', d: 26.2 }
        ], ruwheid: 0.007 },
        ppr: { naam: 'PP-R (SDR 7,4 / PN20)', maten: [
            { n: '20×3,4', d: 13.2 }, { n: '25×4,2', d: 16.6 }, { n: '32×5,4', d: 21.2 }, { n: '40×6,7', d: 26.6 }, { n: '50×8,3', d: 33.4 }, { n: '63×10,5', d: 42 }, { n: '75×12,5', d: 50 }
        ], ruwheid: 0.007 },
        pe: { naam: 'PE 100 SDR 11 (PN16)', maten: [
            { n: '20×2', d: 16 }, { n: '25×2,3', d: 20.4 }, { n: '32×3', d: 26 }, { n: '40×3,7', d: 32.6 }, { n: '50×4,6', d: 40.8 }, { n: '63×5,8', d: 51.4 }, { n: '75×6,8', d: 61.4 }, { n: '90×8,2', d: 73.6 }, { n: '110×10', d: 90 }
        ], ruwheid: 0.007 },
        pvc: { naam: 'PVC afvoer (buitendiameter)', maten: [
            { n: '32', d: 28.4 }, { n: '40', d: 36.4 }, { n: '50', d: 46.4 }, { n: '75', d: 69.4 }, { n: '90', d: 84.4 }, { n: '110', d: 103.6 }, { n: '125', d: 118.6 }, { n: '160', d: 152.4 }, { n: '200', d: 190.2 }
        ], ruwheid: 0.007 }
    };
    var SECTIES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];
    var AUTOMATEN = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400];

    // Water (bij ±60 °C): cp 4,186 kJ/(kg·K); 1 kW verwarmt 860 l/h met 1 K → 1,163 Wh per l·K
    var WATER = { cp: 4.186, rho: 983, wh_l_K: 1.163 };
    var LUCHT = { rho: 1.2, cp: 1.005, wh_m3_K: 0.34 };

    function darcy(Q_m3h, d_mm, ruwheid_mm, nu, rho) {
        // drukverlies per meter (Pa/m) via Darcy-Weisbach + Swamee-Jain (turbulent) / 64/Re (laminair)
        var d = d_mm / 1000, A = Math.PI * d * d / 4, v = (Q_m3h / 3600) / A;
        var Re = v * d / nu, f;
        if (Re < 2300) f = Re > 0 ? 64 / Re : 0;
        else f = 0.25 / Math.pow(Math.log10((ruwheid_mm / 1000) / (3.7 * d) + 5.74 / Math.pow(Re, 0.9)), 2);
        return { v: v, Re: Re, f: f, dp: f * rho * v * v / (2 * d) };
    }

    return {
        versie: 1,
        FAMILIES: FAMILIES, EENHEID_FAMILIE: EENHEID_FAMILIE, BUIZEN: BUIZEN, SECTIES: SECTIES, AUTOMATEN: AUTOMATEN, WATER: WATER, LUCHT: LUCHT,
        conv: conv, fmt: fmt, getal: getal, rond: rond, norm: norm, omhoogNaar: omhoogNaar, omlaagNaar: omlaagNaar, interp: interp, darcy: darcy,
        registreer: registreer, vind: vind, moduleVan: moduleVan, zoek: zoek, reken: reken, invoer: invoer, helpers: helpers,
        get modules() { return modules; },
        get berekeningen() { return berekeningen; }
    };
});
/* QE-EIND reken-kern */
