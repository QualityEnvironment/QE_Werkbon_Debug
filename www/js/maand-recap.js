/* ============================================================
   QE Werkbon — MAANDRECAP (v285 / 1.x v280)
   "Spotify-Wrapped"-achtige maandterugblik met leuke stats.
   ------------------------------------------------------------
   DATA:  hergebruikt QEUren.computeMonth(ym).regs (de tijds-
          registratie-werkbonnen van de maand) en filtert op één
          werknemer. Elke reg heeft: date, employeeId, tijdClass,
          ingeklokt, uitgeklokt, workHours, overtimeHours,
          totalHours, totalKm.
   OPSLAG: IndexedDB (qe_werkbon_recaps) — 1× per maand berekend
          en gecachet, dus geen herhaalde API-calls. De ruwe data
          staat permanent in Robaws: na een app-data-wis wordt de
          recap gewoon 1× opnieuw berekend (get() = laden-of-
          genereren). shown-vlaggen in localStorage.
   Dit bestand raakt de motor niet aan; puur berekening + opslag.
   Geen DOM hier — de stories-UI zit in app.js. Op window.
   ============================================================ */
(function () {
    'use strict';

    var IDB_NAME = 'qe_werkbon_recaps';
    var IDB_STORE = 'recaps';
    var SCHEMA_VERSION = 1;               // bump zodra de stat-structuur wijzigt
    var LATE_AFTER_MIN = 8 * 60;          // "te laat" = ingeklokt na 08:00 (referentie; Levi kan dit aanpassen)

    var MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
        'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
    var WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function ymStr(y, m0) { return y + '-' + pad2(m0 + 1); }          // m0 = 0-based maand
    function keyOf(empId, ym) { return String(empId) + '|' + String(ym); }

    /** "HH:MM" -> minuten sinds middernacht (of null). */
    function toMin(hhmm) {
        var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim());
        if (!m) return null;
        var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
        if (isNaN(h) || isNaN(mi)) return null;
        return h * 60 + mi;
    }
    /** minuten -> "HH:MM". */
    function fromMin(min) {
        if (min == null || isNaN(min)) return '';
        min = Math.round(min);
        var h = Math.floor(min / 60), mi = min % 60;
        return pad2(h) + ':' + pad2(mi);
    }
    function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
    function weekdayOf(dateStr) {
        // middaguur -> geen DST-randgevallen
        var d = new Date(String(dateStr) + 'T12:00:00');
        return isNaN(d.getTime()) ? -1 : d.getDay();
    }

    function monthLabelOf(ym) {
        var p = String(ym).split('-');
        var m0 = parseInt(p[1], 10) - 1;
        return (MONTHS[m0] || '?') + ' ' + p[0];
    }

    /** Is een gecachete recap "provisioneel" — gegenereerd tíjdens de doelmaand —
     *  én is die maand intussen voorbij? Dan herberekenen we één keer voor de
     *  definitieve cijfers (bv. een recap getoond op de laatste dag, terwijl er
     *  die namiddag nog uren bijkwamen). */
    function isProvisionalStale(stats, ym) {
        try {
            var gen = String((stats && stats.generatedAt) || '').slice(0, 7);
            if (!gen || gen > ym) return false;   // ná de doelmaand gegenereerd → definitief
            var p = String(ym).split('-');
            var lastDay = new Date(parseInt(p[0], 10), parseInt(p[1], 10), 0); // laatste dag van ym
            return new Date() > new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59);
        } catch (e) { return false; }
    }

    // ---------- IndexedDB ----------
    function openDb() {
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(IDB_NAME, 1);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(IDB_STORE)) {
                        db.createObjectStore(IDB_STORE, { keyPath: 'key' });
                    }
                };
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error || new Error('IndexedDB open faalde')); };
            } catch (e) { reject(e); }
        });
    }
    function idbGet(key) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(IDB_STORE, 'readonly');
                    var rq = tx.objectStore(IDB_STORE).get(key);
                    rq.onsuccess = function () { resolve(rq.result || null); };
                    rq.onerror = function () { reject(rq.error); };
                } catch (e) { reject(e); }
            });
        });
    }
    function idbPut(rec) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(IDB_STORE, 'readwrite');
                    tx.objectStore(IDB_STORE).put(rec);
                    tx.oncomplete = function () { resolve(true); };
                    tx.onerror = function () { reject(tx.error); };
                    tx.onabort = function () { reject(tx.error || new Error('IndexedDB transactie afgebroken')); };
                } catch (e) { reject(e); }
            });
        });
    }
    function idbAll() {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                try {
                    var tx = db.transaction(IDB_STORE, 'readonly');
                    var rq = tx.objectStore(IDB_STORE).getAll();
                    rq.onsuccess = function () { resolve(rq.result || []); };
                    rq.onerror = function () { reject(rq.error); };
                } catch (e) { reject(e); }
            });
        });
    }

    // ---------- stats berekenen ----------
    /** Bereken de recap-stats voor één werknemer uit de maand-regs. */
    function computeStats(regs, ym, employeeId, employeeName) {
        var mine = (regs || []).filter(function (r) { return String(r.employeeId) === String(employeeId); });

        // per datum aggregeren (kan meerdere blokken/registraties per dag hebben)
        var byDate = {};
        mine.forEach(function (r) {
            var d = byDate[r.date] || (byDate[r.date] = {
                date: r.date, hours: 0, work: 0, ot: 0, km: 0,
                ins: [], outs: [], classes: []
            });
            d.hours += Number(r.totalHours) || 0;
            d.work += Number(r.workHours) || 0;
            d.ot += Number(r.overtimeHours) || 0;
            d.km += Number(r.totalKm) || 0;
            var im = toMin(r.ingeklokt); if (im != null) d.ins.push(im);
            var om = toMin(r.uitgeklokt); if (om != null) d.outs.push(om);
            if (r.tijdClass) d.classes.push(r.tijdClass);
        });

        var dates = Object.keys(byDate).sort();
        var worked = [], arrivals = [], departures = [];
        var totalHours = 0, workHours = 0, overtimeHours = 0, totalKm = 0;
        var lateCount = 0, sickCount = 0, verlofCount = 0, feestCount = 0, onwettigCount = 0, weekendDaysWorked = 0;
        var longestHours = 0, longestDate = '';
        var byWeekdayHours = [0, 0, 0, 0, 0, 0, 0];
        var earliest = null, latest = null;

        dates.forEach(function (dk) {
            var d = byDate[dk];
            var cls = d.classes;

            if (d.hours > 0.01) {
                worked.push(d);
                totalHours += d.hours; workHours += d.work; overtimeHours += d.ot; totalKm += d.km;
                var wd = weekdayOf(d.date);
                if (wd >= 0) byWeekdayHours[wd] += d.hours;
                if (wd === 0 || wd === 6) weekendDaysWorked++;
                if (d.hours > longestHours) { longestHours = d.hours; longestDate = d.date; }
                var arr = d.ins.length ? Math.min.apply(null, d.ins) : null;
                var dep = d.outs.length ? Math.max.apply(null, d.outs) : null;
                if (arr != null) {
                    arrivals.push(arr);
                    if (earliest == null || arr < earliest) earliest = arr;
                    // "te laat" — referentie 08:00 (klasse 'late' telt sowieso mee)
                    if (arr > LATE_AFTER_MIN || cls.indexOf('late') !== -1) lateCount++;
                } else if (cls.indexOf('late') !== -1) {
                    lateCount++;
                }
                if (dep != null) { departures.push(dep); if (latest == null || dep > latest) latest = dep; }
            } else {
                // niet-gewerkte dag → pas hier de afwezigheidsklassen tellen
                // (voorkomt dubbeltelling met een gemengde dag die óók uren droeg)
                if (cls.indexOf('sick') !== -1) sickCount++;
                if (cls.indexOf('verlof') !== -1 || cls.indexOf('sociaalverlof') !== -1) verlofCount++;
                if (cls.indexOf('feestdag') !== -1) feestCount++;
                if (cls.indexOf('onwettig') !== -1) onwettigCount++;
                totalKm += d.km; // km op een niet-gewerkte dag (zeldzaam) tellen we toch mee
            }
        });

        var workedDays = worked.length;
        var avgHoursPerDay = workedDays ? (totalHours / workedDays) : 0;
        var avgArrival = arrivals.length ? (arrivals.reduce(function (a, b) { return a + b; }, 0) / arrivals.length) : null;

        // favoriete werkdag = weekdag met de meeste uren
        var favWd = -1, favWdHours = 0;
        for (var i = 0; i < 7; i++) { if (byWeekdayHours[i] > favWdHours) { favWdHours = byWeekdayHours[i]; favWd = i; } }

        return {
            schema: SCHEMA_VERSION,
            ym: ym,
            monthLabel: monthLabelOf(ym),
            employeeId: String(employeeId),
            employeeName: employeeName || '',
            generatedAt: new Date().toISOString(),
            hasData: workedDays > 0,
            workedDays: workedDays,
            totalHours: round1(totalHours),
            workHours: round1(workHours),
            overtimeHours: round1(overtimeHours),
            avgHoursPerDay: round1(avgHoursPerDay),
            avgArrivalMin: avgArrival == null ? null : Math.round(avgArrival),
            avgArrivalStr: avgArrival == null ? '' : fromMin(avgArrival),
            earliestArrivalStr: earliest == null ? '' : fromMin(earliest),
            latestDepartureStr: latest == null ? '' : fromMin(latest),
            longestDayHours: round1(longestHours),
            longestDayDate: longestDate,
            longestDayLabel: longestDate ? (WEEKDAYS[weekdayOf(longestDate)] + ' ' + parseInt(longestDate.slice(8), 10)) : '',
            lateCount: lateCount,
            sickCount: sickCount,
            verlofCount: verlofCount,
            feestCount: feestCount,
            onwettigCount: onwettigCount,
            totalKm: Math.round(totalKm),
            weekendDaysWorked: weekendDaysWorked,
            favWeekday: favWd >= 0 ? WEEKDAYS[favWd] : '',
            favWeekdayHours: round1(favWdHours)
        };
    }

    // ---------- publieke API ----------
    var QERecap = {
        _busy: {},   // per-key in-flight guard

        monthLabel: monthLabelOf,

        /** Bereken (ALTIJD vers uit Robaws) + bewaar in IndexedDB. */
        generate: async function (employeeId, ym, employeeName) {
            if (!window.QEUren || typeof QEUren.computeMonth !== 'function') {
                throw new Error('QEUren niet beschikbaar');
            }
            var agg = await QEUren.computeMonth(ym);
            var regs = (agg && agg.regs) || [];
            var nm = employeeName;
            if (!nm) {
                try {
                    var hit = regs.filter(function (r) { return String(r.employeeId) === String(employeeId); })[0];
                    nm = hit ? hit.employeeName : '';
                } catch (e) {}
            }
            var stats = computeStats(regs, ym, employeeId, nm);
            try { await idbPut({ key: keyOf(employeeId, ym), ym: ym, employeeId: String(employeeId), stats: stats }); }
            catch (e) { console.warn('[Recap] IndexedDB-bewaren faalde (recap blijft in-memory):', e && e.message); }
            return stats;
        },

        /** Laad uit IndexedDB; ontbreekt hij, bereken + bewaar (na een wis). */
        get: async function (employeeId, ym, employeeName) {
            var k = keyOf(employeeId, ym);
            try {
                var rec = await idbGet(k);
                if (rec && rec.stats && rec.stats.schema === SCHEMA_VERSION && !isProvisionalStale(rec.stats, ym)) return rec.stats;
            } catch (e) { console.warn('[Recap] IndexedDB-lezen faalde, herbereken:', e && e.message); }
            if (this._busy[k]) return this._busy[k];
            var p = this.generate(employeeId, ym, employeeName);
            this._busy[k] = p;
            try { return await p; } finally { delete this._busy[k]; }
        },

        /** Alle bewaarde recaps van een werknemer (nieuwste eerst). */
        list: async function (employeeId) {
            var all = [];
            try { all = await idbAll(); } catch (e) { return []; }
            return all
                .filter(function (r) { return String(r.employeeId) === String(employeeId) && r.stats; })
                .map(function (r) { return r.stats; })
                .sort(function (a, b) { return String(b.ym).localeCompare(String(a.ym)); });
        },

        // ---- trigger-logica ----
        /** De doelmaand die na een uitklok getoond mag worden, of null.
         *  "Slim": op de laatste kalenderdag → deze maand; anders de vorige
         *  maand (vangnet: verschijnt bij de eerste uitklok van de nieuwe maand). */
        dueMonth: function (today) {
            var t = today || new Date();
            var y = t.getFullYear(), m = t.getMonth(), day = t.getDate();
            var lastDay = new Date(y, m + 1, 0).getDate();
            if (day >= lastDay) return ymStr(y, m);            // laatste kalenderdag → deze maand
            if (day <= 7) {                                     // eerste week van de nieuwe maand → vangnet: vorige maand
                var pm = new Date(y, m - 1, 1);
                return ymStr(pm.getFullYear(), pm.getMonth());
            }
            return null;                                        // midden in de maand → geen auto-trigger (wel via Terugblik)
        },
        _shownKey: function (employeeId, ym) { return 'qe_recap_shown_' + employeeId + '_' + ym; },
        isShown: function (employeeId, ym) {
            try { return localStorage.getItem(this._shownKey(employeeId, ym)) === '1'; } catch (e) { return false; }
        },
        markShown: function (employeeId, ym) {
            try { localStorage.setItem(this._shownKey(employeeId, ym), '1'); } catch (e) {}
        }
    };

    window.QERecap = QERecap;
})();
