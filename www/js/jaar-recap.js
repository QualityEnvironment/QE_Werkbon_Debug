/* ============================================================
   QE Werkbon — JAAROVERZICHT boekjaar 2025-2026 (v290)
   Eenmalige jaarterugblik vóór het bouwverlof. De data is af
   (1 juli 2025 – 30 juni 2026) en wordt hier GEBUNDELD — geen
   live-berekening nodig. Elke werknemer ziet zijn eigen jaar
   (streng bij veel ziekte, trots bij volle aanwezigheid). De
   toon + rendering zit in app.js; dit bestand is enkel data +
   opzoeken/rangschikken. Op window als QEJaar.
   Privacy: net als de maandrecap draait alles op de gedeelde
   Robaws-toegang; de app toont enkel je EIGEN kaart.
   ============================================================ */
(function () {
    'use strict';

    var BOEKJAAR = '1 juli 2025 – 30 juni 2026';

    // employeeId toegevoegd waar bekend (statische EMPLOYEES-map); de rest
    // matcht op naam. r = {naam, afdeling, employeeId?, gewerkte_dagen,
    // werkbare_dagen, gewerkte_uren, kilometers, ziektedagen, verzuim_pct,
    // ziekteperiodes, langste_ziekteperiode, sociaal_verlof_dagen}
    var DATA = [
        { naam: 'Thierry', afdeling: 'Monteurs', gewerkte_dagen: 49, werkbare_dagen: 186, gewerkte_uren: 370.5, kilometers: 2833, ziektedagen: 131, verzuim_pct: 70.4, ziekteperiodes: 10, langste_ziekteperiode: 67, sociaal_verlof_dagen: 2 },
        { naam: 'Wim Van De Poel', afdeling: 'Monteurs', employeeId: 4, gewerkte_dagen: 66, werkbare_dagen: 205, gewerkte_uren: 480.5, kilometers: 1496, ziektedagen: 122, verzuim_pct: 59.5, ziekteperiodes: 10, langste_ziekteperiode: 51, sociaal_verlof_dagen: 0 },
        { naam: 'Sascha', afdeling: 'Techniekers', employeeId: 9, gewerkte_dagen: 170, werkbare_dagen: 227, gewerkte_uren: 1389.8, kilometers: 3056, ziektedagen: 57, verzuim_pct: 25.1, ziekteperiodes: 6, langste_ziekteperiode: 45, sociaal_verlof_dagen: 0 },
        { naam: 'Joshua Van Der Smissen', afdeling: 'Monteurs', employeeId: 13, gewerkte_dagen: 172, werkbare_dagen: 225, gewerkte_uren: 1402.8, kilometers: 7726, ziektedagen: 46, verzuim_pct: 20.4, ziekteperiodes: 12, langste_ziekteperiode: 8, sociaal_verlof_dagen: 0 },
        { naam: 'Stefan Boers', afdeling: 'Monteurs', employeeId: 2, gewerkte_dagen: 144, werkbare_dagen: 225, gewerkte_uren: 1172.5, kilometers: 4800, ziektedagen: 29, verzuim_pct: 12.9, ziekteperiodes: 8, langste_ziekteperiode: 4, sociaal_verlof_dagen: 0 },
        { naam: 'Jelle Wintraecken', afdeling: 'Monteurs', employeeId: 3, gewerkte_dagen: 195, werkbare_dagen: 225, gewerkte_uren: 1551.0, kilometers: 6092, ziektedagen: 23, verzuim_pct: 10.2, ziekteperiodes: 8, langste_ziekteperiode: 4, sociaal_verlof_dagen: 0 },
        { naam: 'Hervé Coulibaly', afdeling: 'Monteurs', employeeId: 8, gewerkte_dagen: 187, werkbare_dagen: 210, gewerkte_uren: 1656.2, kilometers: 13056, ziektedagen: 15, verzuim_pct: 7.1, ziekteperiodes: 3, langste_ziekteperiode: 9, sociaal_verlof_dagen: 0 },
        { naam: 'Matte', afdeling: 'Monteurs', gewerkte_dagen: 55, werkbare_dagen: 79, gewerkte_uren: 444.5, kilometers: 3470, ziektedagen: 15, verzuim_pct: 19.0, ziekteperiodes: 3, langste_ziekteperiode: 8, sociaal_verlof_dagen: 0 },
        { naam: 'Keng', afdeling: 'Monteurs', employeeId: 11, gewerkte_dagen: 205, werkbare_dagen: 225, gewerkte_uren: 1701.8, kilometers: 12877, ziektedagen: 10, verzuim_pct: 4.4, ziekteperiodes: 2, langste_ziekteperiode: 5, sociaal_verlof_dagen: 0 },
        { naam: 'Yassine Baih', afdeling: 'Techniekers', employeeId: 30, gewerkte_dagen: 64, werkbare_dagen: 78, gewerkte_uren: 541.8, kilometers: 93, ziektedagen: 10, verzuim_pct: 12.8, ziekteperiodes: 1, langste_ziekteperiode: 10, sociaal_verlof_dagen: 0 },
        { naam: 'Vince', afdeling: 'Techniekers', employeeId: 16, gewerkte_dagen: 106, werkbare_dagen: 225, gewerkte_uren: 1082.7, kilometers: 0, ziektedagen: 8, verzuim_pct: 3.6, ziekteperiodes: 4, langste_ziekteperiode: 3, sociaal_verlof_dagen: 5 },
        { naam: 'Levi', afdeling: 'Monteurs', employeeId: 1, gewerkte_dagen: 217, werkbare_dagen: 225, gewerkte_uren: 1925.0, kilometers: 7834, ziektedagen: 6, verzuim_pct: 2.7, ziekteperiodes: 3, langste_ziekteperiode: 3, sociaal_verlof_dagen: 0 },
        { naam: 'Mohamed', afdeling: 'Monteurs', gewerkte_dagen: 4, werkbare_dagen: 9, gewerkte_uren: 33.0, kilometers: 50, ziektedagen: 5, verzuim_pct: 55.6, ziekteperiodes: 1, langste_ziekteperiode: 5, sociaal_verlof_dagen: 0 },
        { naam: 'Dax', afdeling: 'Techniekers', employeeId: 10, gewerkte_dagen: 219, werkbare_dagen: 225, gewerkte_uren: 1768.8, kilometers: 466, ziektedagen: 4, verzuim_pct: 1.8, ziekteperiodes: 1, langste_ziekteperiode: 4, sociaal_verlof_dagen: 0 },
        { naam: 'Jens', afdeling: 'Monteurs', employeeId: 5, gewerkte_dagen: 207, werkbare_dagen: 225, gewerkte_uren: 1659.0, kilometers: 6714, ziektedagen: 4, verzuim_pct: 1.8, ziekteperiodes: 2, langste_ziekteperiode: 3, sociaal_verlof_dagen: 0 },
        { naam: 'Nidal', afdeling: 'Monteurs', gewerkte_dagen: 11, werkbare_dagen: 42, gewerkte_uren: 89.5, kilometers: 1082, ziektedagen: 3, verzuim_pct: 7.1, ziekteperiodes: 1, langste_ziekteperiode: 3, sociaal_verlof_dagen: 0 },
        { naam: 'Olivier', afdeling: 'Techniekers', employeeId: 12, gewerkte_dagen: 212, werkbare_dagen: 225, gewerkte_uren: 1800.2, kilometers: 885, ziektedagen: 2, verzuim_pct: 0.9, ziekteperiodes: 1, langste_ziekteperiode: 2, sociaal_verlof_dagen: 0 },
        { naam: 'Mitch Van Rompay', afdeling: 'Monteurs', gewerkte_dagen: 17, werkbare_dagen: 22, gewerkte_uren: 135.8, kilometers: 365, ziektedagen: 1, verzuim_pct: 4.5, ziekteperiodes: 1, langste_ziekteperiode: 1, sociaal_verlof_dagen: 0 },
        { naam: 'Felicity', afdeling: 'Techniekers', employeeId: 21, gewerkte_dagen: 80, werkbare_dagen: 148, gewerkte_uren: null, kilometers: 0, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 6 },
        { naam: 'Ansar', afdeling: 'Monteurs', gewerkte_dagen: 125, werkbare_dagen: 138, gewerkte_uren: 1043.8, kilometers: 7350, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 0 },
        { naam: 'Bart', afdeling: 'Bureau', employeeId: 20, gewerkte_dagen: 31, werkbare_dagen: 39, gewerkte_uren: 321.2, kilometers: 0, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 0 },
        { naam: 'Bjorn', afdeling: 'Monteurs', employeeId: 19, gewerkte_dagen: 225, werkbare_dagen: 225, gewerkte_uren: 2150.2, kilometers: 613, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 0 },
        { naam: 'Bright', afdeling: 'Monteurs', gewerkte_dagen: 8, werkbare_dagen: 19, gewerkte_uren: 62.0, kilometers: 412, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 0 },
        { naam: 'Carmen', afdeling: 'Techniekers', gewerkte_dagen: 74, werkbare_dagen: 98, gewerkte_uren: 566.2, kilometers: 0, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 0 },
        { naam: 'Els', afdeling: 'Bureau', employeeId: 23, gewerkte_dagen: 42, werkbare_dagen: 42, gewerkte_uren: 374.5, kilometers: 0, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 0 },
        { naam: 'Ferhat Dogan', afdeling: 'Monteurs', gewerkte_dagen: 85, werkbare_dagen: 92, gewerkte_uren: 677.8, kilometers: 5227, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 0 },
        { naam: 'Glycera', afdeling: 'Techniekers', employeeId: 7, gewerkte_dagen: 130, werkbare_dagen: 225, gewerkte_uren: 1104.2, kilometers: 904, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 0 },
        { naam: 'Ritchy', afdeling: 'Monteurs', gewerkte_dagen: 5, werkbare_dagen: 17, gewerkte_uren: 40.0, kilometers: 54, ziektedagen: 0, verzuim_pct: 0.0, ziekteperiodes: 0, langste_ziekteperiode: 0, sociaal_verlof_dagen: 0 }
    ];

    // accenten strippen + lowercase, voor soepele naam-match (é → e)
    function norm(s) {
        s = String(s || '').toLowerCase().trim();
        try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
        return s;
    }
    function firstWord(s) { return norm(s).split(/\s+/)[0] || ''; }

    var QEJaar = {
        BOEKJAAR: BOEKJAAR,
        DATA: DATA,

        /** Zoek het record van de ingelogde werknemer: eerst op employeeId,
         *  anders soepel op naam (volledige naam of voornaam). */
        find: function (employeeId, name) {
            if (employeeId != null) {
                var byId = DATA.filter(function (r) { return r.employeeId != null && String(r.employeeId) === String(employeeId); })[0];
                if (byId) return byId;
            }
            var n = norm(name), fw = firstWord(name);
            if (!n) return null;
            // exacte / bevat-match op volledige naam
            var hit = DATA.filter(function (r) { var rn = norm(r.naam); return rn === n || rn.indexOf(n) !== -1 || n.indexOf(rn) !== -1; })[0];
            if (hit) return hit;
            // voornaam-match (uniek?)
            var fwHits = DATA.filter(function (r) { return firstWord(r.naam) === fw; });
            return fwHits.length === 1 ? fwHits[0] : null;
        },

        /** Rang van dit record binnen de "substantiële" werkers (werkbare_dagen
         *  >= minWork) op een veld. dir 'desc' = hoogste eerst (uren),
         *  'asc' = laagste eerst (verzuim). Retourneert {rank, total} of null. */
        rankOf: function (record, field, dir, minWork) {
            minWork = minWork || 100;
            var pool = DATA.filter(function (r) { return (r.werkbare_dagen || 0) >= minWork && r[field] != null; });
            if (pool.indexOf(record) === -1) return null;
            pool.sort(function (a, b) { return dir === 'asc' ? (a[field] - b[field]) : (b[field] - a[field]); });
            return { rank: pool.indexOf(record) + 1, total: pool.length };
        }
    };

    window.QEJaar = QEJaar;
})();
