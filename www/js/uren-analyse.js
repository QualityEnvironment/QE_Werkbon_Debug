/* =====================================================================
 * uren-analyse.js  —  Klok-uren analyse & maandrapport (client-side)
 * ---------------------------------------------------------------------
 * Port van klok-werkbonnen-v3.php (sync + export-month-xlsx) naar JS.
 * Draait volledig in de app (WebView). Genereert:
 *   - een in-app overzicht (samenvattingstabel per werknemer + groep)
 *   - een multi-sheet .xlsx (Overzicht-grid + tab per werknemer) via QEXlsx
 *
 * API-CALLS GEMINIMALISEERD:
 *   1x  RobawsAPI.getActiveEmployees()   (5-min cache, meestal 0 calls)
 *   1x  /mobility-types                  (module-cache, 1 call ooit)
 *   Kx  /work-orders?...&include=timeEntries,commuteEntries&sort=date:desc
 *       -> vroegtijdig stoppen zodra een pagina volledig vóór de maand valt
 *   Uursoorten worden NIET opgehaald: id 2 = overuren, rest = werkuren
 *   (bevestigd WO 1343), zoals de PHP-fallback.
 * ===================================================================== */
(function () {
  'use strict';

  // ---- config (spiegelt de .env defaults van de PHP-tool) ----
  var ABSENCE_CLASSES = ['sick', 'feestdag', 'rustdag', 'verlof', 'sociaalverlof'];
  var OVERTIME_HOURTYPE_IDS = { 2: true }; // 1 = werkuren, 2 = overuren

  var MONTHS_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  var DAYS_NL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

  // module-cache voor mobility-types (id -> naam)
  var _mobilityById = null;

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  function col(n) { return window.QEXlsx.colLetter(n); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function daysInMonth(ym) {
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    return new Date(y, m, 0).getDate();
  }
  // dag d (1-based) van maand ym -> JS Date (lokale middag, DST-veilig)
  function dateOf(ym, d) {
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  function isWeekend(dt) { var w = dt.getDay(); return w === 0 || w === 6; }

  function monthLabel(ym) {
    return MONTHS_NL[parseInt(ym.slice(5, 7), 10) - 1] + ' ' + ym.slice(0, 4);
  }

  /** stringValue / value / booleanValue uit een extraField-object halen */
  function efValue(extra, key) {
    if (!extra || !extra[key] || typeof extra[key] !== 'object') return null;
    var f = extra[key];
    if (f.stringValue != null) return String(f.stringValue);
    if (f.value != null) return String(f.value);
    if (f.booleanValue != null) return f.booleanValue ? '1' : '0';
    return null;
  }

  /** "Tijd"-veld -> class */
  function classifyTijd(tijd) {
    if (!tijd) return 'unknown';
    var low = String(tijd).toLowerCase();
    if (low.indexOf('ziek') !== -1) return 'sick';
    if (low.indexOf('feest') !== -1) return 'feestdag';
    if (low.indexOf('rust') !== -1) return 'rustdag';
    if (low.indexOf('sociaal') !== -1) return 'sociaalverlof';
    if (low.indexOf('verlof') !== -1) return 'verlof';
    if (low.indexOf('laat') !== -1) return 'late';
    if (low.indexOf('tijd') !== -1) return 'ontime';
    return 'unknown';
  }

  /** mobility-naam -> bucket (grid: CMP / CZP / P / OTHER) */
  function classifyMobility(name) {
    var low = String(name || '').toLowerCase();
    if (low.indexOf('zonder') !== -1) return 'CZP';
    if (low.indexOf('chauffeur') !== -1) return 'CMP';
    if (low.indexOf('passagier') !== -1) return 'P';
    return 'OTHER';
  }
  /** mobility-naam -> afkorting voor kolomtitels (CMP / CZP / P / X) */
  function mobAbbr(name) {
    var b = classifyMobility(name);
    return b === 'OTHER' ? 'X' : b;
  }

  /** rol (getActiveEmployees) -> groep */
  function groupFromRole(role) {
    if (role === 'bureel') return 'Bureau';
    if (role === 'monteur') return 'Monteurs';
    return 'Techniekers';
  }

  /** planningGroup -> groep (fallback wanneer we een volledig employee-object hebben) */
  function classifyEmpGroup(planningGroup, role) {
    if (planningGroup) {
      var pg = String(planningGroup).toLowerCase();
      if (pg.indexOf('bureel') !== -1 || pg.indexOf('bureau') !== -1) return 'Bureau';
      if (pg.indexOf('technieker') !== -1) return 'Techniekers';
      if (pg.indexOf('monteur') !== -1) return 'Monteurs';
    }
    return groupFromRole(role);
  }

  /** werkbon-title "Tijdsregistratie [gecontroleerd] Naam - DD/MM/YYYY" -> Naam */
  function nameFromTitle(title) {
    if (!title) return null;
    var clean = String(title).trim().replace(/^Tijdsregistratie(?:\s+gecontroleerd)?\s+/i, '');
    var m = clean.match(/^(.+?)\s+-\s+\d{2}[\/\-]\d{2}[\/\-]\d{2,4}/);
    return m ? m[1].trim() : null;
  }

  function fmtTimeObj(t) {
    if (!t || typeof t !== 'object') return null;
    return pad2(t.hour || 0) + ':' + pad2(t.minute || 0);
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  // ---------------------------------------------------------------
  // 1. mobility-types (id -> naam) — 1 call, gecached
  // ---------------------------------------------------------------
  async function loadMobilityTypes(meta) {
    if (_mobilityById) return _mobilityById;
    var map = {};
    try {
      var r = await RobawsAPI.get('mobility-types?limit=100');
      if (meta) meta.calls++;
      if (r && r.code === 200 && r.data) {
        var items = r.data.items || [];
        for (var i = 0; i < items.length; i++) {
          map[String(items[i].id)] = items[i].name || '';
        }
      }
    } catch (e) { /* val terug op defaults hieronder */ }
    _mobilityById = map;
    return map;
  }
  // default Robaws mobility-type-ids (negatief) wanneer naam onbekend blijft
  var MOBILITY_DEFAULTS = {
    '-1': 'chauffeur met passagier',
    '-2': 'passagier',
    '-3': 'chauffeur zonder passagiers'
  };
  function mobilityName(ce, byId) {
    if (ce.mobilityTypeName) return ce.mobilityTypeName;
    var id = String(ce.mobilityTypeId != null ? ce.mobilityTypeId : '');
    if (byId[id]) return byId[id];
    if (MOBILITY_DEFAULTS[id]) return MOBILITY_DEFAULTS[id];
    return 'mobility#' + id;
  }

  // ---------------------------------------------------------------
  // 2. employees (id -> {name, role, email}) — hergebruikt app-cache
  // ---------------------------------------------------------------
  async function loadEmployees(meta) {
    var byId = {};
    try {
      var list = await RobawsAPI.getActiveEmployees(); // 5-min cache
      if (meta) meta.empSource = 'active';
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.employeeId != null) {
          byId[String(e.employeeId)] = { name: e.name, role: e.role, email: e.email || '' };
        }
      }
    } catch (e) { /* geen employees -> namen komen uit titel */ }
    return byId;
  }

  // ---------------------------------------------------------------
  // 3. work-orders van de maand ophalen (vroegtijdig stoppen)
  // ---------------------------------------------------------------
  async function fetchMonthWorkOrders(ym, meta) {
    var emStart = ym + '-01';
    var emEnd = ym + '-' + pad2(daysInMonth(ym));
    var regs = [];
    var seen = {};
    var offset = 0, limit = 100, iter = 0, maxIter = 250;
    while (iter < maxIter) {
      iter++;
      var url = 'work-orders?limit=' + limit + '&offset=' + offset +
        '&sort=date:desc&include=timeEntries,commuteEntries';
      var r = await RobawsAPI.get(url, { bypassCache: true });
      if (meta) meta.calls++;
      if (!r || r.code !== 200 || !r.data) break;
      var items = r.data.items || [];
      if (!items.length) break;

      var pageMax = ''; // hoogste datum op deze pagina
      for (var i = 0; i < items.length; i++) {
        var wo = items[i];
        var d = wo.date || '';
        if (!d) continue;
        if (d > pageMax) pageMax = d;
        if (seen[wo.id]) continue;
        seen[wo.id] = true;
        if (d < emStart || d > emEnd) continue; // buiten de maand
        var st = String(wo.status || '').toLowerCase();
        if (st.indexOf('tijdsregistratie') === -1) continue;
        regs.push(wo);
      }
      // desc-sortering: zodra de nieuwste datop op de pagina vóór de maand valt,
      // is al de rest ouder -> stoppen.
      if (pageMax && pageMax < emStart) break;
      if (items.length < limit) break;
      offset += limit;
    }
    if (meta) { meta.woPages = iter; meta.woMatched = regs.length; }
    return regs;
  }

  // ---------------------------------------------------------------
  // 4. werkbon -> registratie-record (spiegelt PHP "PROCESS")
  // ---------------------------------------------------------------
  function toRegistration(wo, empById, mobById) {
    var extra = (wo.extraFields && typeof wo.extraFields === 'object') ? wo.extraFields : {};
    var tijd = efValue(extra, 'Tijd');
    var ingeklokt = efValue(extra, 'Ingeklokt');
    var uitgeklokt = efValue(extra, 'Uitgeklokt');
    var fiets = efValue(extra, 'Fietsvergoeding') === '1';
    var rsTW = efValue(extra, 'Rechtstreeks - Thuis / Werf') === '1';
    var rsWT = efValue(extra, 'Rechtstreeks - Werf / Thuis') === '1';
    var tijdClass = classifyTijd(tijd);

    // time-entries
    var te = Array.isArray(wo.timeEntries) ? wo.timeEntries : [];
    var employeeId = 0, totalHours = 0, workHours = 0, overtimeHours = 0;
    for (var i = 0; i < te.length; i++) {
      var t = te[i];
      var eid = parseInt(t.employeeId || 0, 10);
      if (!employeeId && eid) employeeId = eid;
      var hrs = (typeof t.hours === 'number' || (t.hours != null && !isNaN(t.hours))) ? parseFloat(t.hours) : 0;
      totalHours += hrs;
      var htId = parseInt(t.hourTypeId || 0, 10);
      if (OVERTIME_HOURTYPE_IDS[htId]) overtimeHours += hrs;
      else workHours += hrs;
    }

    // fallback employeeId via titel
    var title = String(wo.title || '');
    if (!employeeId) {
      var nm = nameFromTitle(title);
      if (nm) {
        var needle = nm.toLowerCase();
        for (var key in empById) {
          if (!empById.hasOwnProperty(key)) continue;
          var first = String(empById[key].name || '').trim().split(' ')[0].toLowerCase();
          if (first === needle) { employeeId = parseInt(key, 10); break; }
        }
      }
    }
    var employeeName = (empById[String(employeeId)] && empById[String(employeeId)].name)
      || nameFromTitle(title) || 'Onbekend';

    // commute-entries
    var ce = Array.isArray(wo.commuteEntries) ? wo.commuteEntries : [];
    var commuteEntries = [], totalKm = 0;
    for (var j = 0; j < ce.length; j++) {
      var c = ce[j];
      var mtName = mobilityName(c, mobById);
      var dist = (c.distance != null && !isNaN(c.distance)) ? parseFloat(c.distance) : 0;
      var rdist = (c.returnDistance != null && !isNaN(c.returnDistance)) ? parseFloat(c.returnDistance) : 0;
      totalKm += dist + rdist;
      commuteEntries.push({
        mobilityTypeId: parseInt(c.mobilityTypeId || 0, 10),
        mobilityTypeName: mtName,
        distance: dist, returnDistance: rdist, totalKm: dist + rdist
      });
    }

    return {
      id: parseInt(wo.id, 10),
      date: String(wo.date),
      status: String(wo.status || ''),
      title: title,
      employeeId: employeeId,
      employeeName: employeeName,
      tijd: tijd || '',
      tijdClass: tijdClass,
      ingeklokt: ingeklokt || '',
      uitgeklokt: uitgeklokt || '',
      totalHours: totalHours,
      workHours: workHours,
      overtimeHours: overtimeHours,
      totalKm: totalKm,
      commuteEntries: commuteEntries,
      fietsvergoeding: fiets,
      rechtstreeksTW: rsTW,
      rechtstreeksWT: rsWT
    };
  }

  // ---------------------------------------------------------------
  // 5. aggregatie per werknemer · dag (spiegelt PHP export STAP 2)
  // ---------------------------------------------------------------
  function aggregate(regs, ym, empById) {
    var dim = daysInMonth(ym);

    // verzamel voorkomende mobility-namen (voor per-emp tab kolommen)
    var mobSet = {};
    regs.forEach(function (r) {
      (r.commuteEntries || []).forEach(function (c) {
        mobSet[c.mobilityTypeName || 'onbekend'] = true;
      });
    });
    var mobilityTypes = Object.keys(mobSet).sort(function (a, b) {
      return mobAbbr(a).localeCompare(mobAbbr(b));
    });

    var byEmp = {};
    regs.forEach(function (r) {
      var eid = parseInt(r.employeeId, 10) || 0;
      var day = parseInt(r.date.slice(8, 10), 10);
      if (!byEmp[eid]) {
        byEmp[eid] = {
          id: eid, name: r.employeeName, days: {},
          tot_work: 0, tot_over: 0, tot_tot: 0, tot_km: 0,
          count_days: 0, count_late: 0, count_sick: 0,
          count_fiets: 0, count_rsTW: 0, count_rsWT: 0
        };
      }
      var E = byEmp[eid];
      if (!E.days[day]) {
        E.days[day] = {
          hours: 0, workHours: 0, overtimeHours: 0, kmTot: 0, kmByMob: {},
          tijd: r.tijd || '', ingeklokt: r.ingeklokt || '', uitgeklokt: r.uitgeklokt || '',
          status: r.status || '', class: 'ontime', fiets: false, rsTW: false, rsWT: false
        };
        E.count_days++;
      }
      var D = E.days[day];
      D.hours += r.totalHours;
      D.workHours += r.workHours;
      D.overtimeHours += r.overtimeHours;
      D.kmTot += (r.totalKm || 0);
      (r.commuteEntries || []).forEach(function (c) {
        var mt = c.mobilityTypeName || 'onbekend';
        var km = (c.distance || 0) + (c.returnDistance || 0);
        D.kmByMob[mt] = (D.kmByMob[mt] || 0) + km;
      });
      if (!D.ingeklokt && r.ingeklokt) D.ingeklokt = r.ingeklokt;
      if (r.uitgeklokt) D.uitgeklokt = r.uitgeklokt;
      if (r.tijd) D.tijd = r.tijd;
      // class-prioriteit: sick > feestdag > rustdag > sociaalverlof > verlof > late > ontime
      var c = r.tijdClass;
      if (c === 'sick') D.class = 'sick';
      else if (c === 'feestdag' && D.class !== 'sick') D.class = 'feestdag';
      else if (c === 'rustdag' && ['sick', 'feestdag'].indexOf(D.class) === -1) D.class = 'rustdag';
      else if (c === 'sociaalverlof' && ['sick', 'feestdag', 'rustdag'].indexOf(D.class) === -1) D.class = 'sociaalverlof';
      else if (c === 'verlof' && ['sick', 'feestdag', 'rustdag', 'sociaalverlof'].indexOf(D.class) === -1) D.class = 'verlof';
      else if (c === 'late' && ['sick', 'feestdag', 'rustdag', 'sociaalverlof', 'verlof'].indexOf(D.class) === -1) D.class = 'late';

      E.tot_work += r.workHours;
      E.tot_over += r.overtimeHours;
      E.tot_tot += r.totalHours;
      E.tot_km += (r.totalKm || 0);
      if (r.tijdClass === 'late') E.count_late++;
      if (r.tijdClass === 'sick') E.count_sick++;
      if (r.fietsvergoeding) { E.count_fiets++; D.fiets = true; }
      if (r.rechtstreeksTW) { E.count_rsTW++; D.rsTW = true; }
      if (r.rechtstreeksWT) { E.count_rsWT++; D.rsWT = true; }
    });

    // sorteer werknemers alfabetisch -> geordende lijst
    var empList = Object.keys(byEmp).map(function (k) { return byEmp[k]; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'nl', { sensitivity: 'base' }); });

    // groepeer via rol/planningGroup
    var groups = { Bureau: [], Techniekers: [], Monteurs: [] };
    empList.forEach(function (p) {
      var meta = empById[String(p.id)] || null;
      var g = classifyEmpGroup(meta && meta.planningGroup, meta && meta.role);
      groups[g].push(p);
    });

    return { ym: ym, dim: dim, byEmp: byEmp, empList: empList, groups: groups, mobilityTypes: mobilityTypes };
  }

  // ---------------------------------------------------------------
  // PUBLIC: computeMonth(ym) -> aggregated data + meta
  // ---------------------------------------------------------------
  async function computeMonth(ym) {
    if (!/^\d{4}-\d{2}$/.test(ym)) ym = new Date().toISOString().slice(0, 7);
    var meta = { calls: 0, woPages: 0, woMatched: 0, empSource: null };
    var mobById = await loadMobilityTypes(meta);
    var empById = await loadEmployees(meta);
    var woList = await fetchMonthWorkOrders(ym, meta);
    var regs = woList.map(function (wo) { return toRegistration(wo, empById, mobById); });
    var agg = aggregate(regs, ym, empById);
    agg.meta = meta;
    agg.monthLabel = monthLabel(ym);
    agg.regs = regs;
    return agg;
  }

  // ===============================================================
  // 6. EXCEL: buildSheets(agg) -> { sheetName: rows[][] }  (QEXlsx-cellen)
  //    Spiegelt export-month-xlsx (formule-gebaseerd).
  // ===============================================================
  function buildSheets(agg) {
    var ym = agg.ym, dim = agg.dim, byEmp = agg.byEmp, empList = agg.empList,
      groups = agg.groups, mobilityTypes = agg.mobilityTypes;
    var emStart = ym + '-01';

    var firstDayCol = col(2);
    var lastDayCol = col(dim + 1);
    var gridTotalCol = col(dim + 2);

    var Nemp = empList.length;
    var gridBase = Nemp + 8;

    var gridRows = [];
    var blockAddr = {};

    function buildGroupGrid(groupTitle, groupEmps) {
      if (!groupEmps.length) return;
      gridRows.push([{ v: '📅 ' + groupTitle.toUpperCase(), t: 's', s: 4 }]);

      // header 1 — dagnummers
      var h1 = [{ v: 'WERKNEMER', t: 's', s: 1 }];
      for (var d = 1; d <= dim; d++) {
        var wk = isWeekend(dateOf(ym, d));
        h1.push({ v: d, t: 's', s: wk ? 8 : 1 });
      }
      h1.push({ v: 'TOTAAL', t: 's', s: 3 });
      gridRows.push(h1);
      // header 2 — dagnamen
      var h2 = [{ v: '', t: 's', s: 1 }];
      for (var d2 = 1; d2 <= dim; d2++) {
        var dt = dateOf(ym, d2), wk2 = isWeekend(dt);
        var dn = DAYS_NL[dt.getDay()].slice(0, 2).toUpperCase();
        h2.push({ v: dn, t: 's', s: wk2 ? 8 : 1 });
      }
      h2.push({ v: '', t: 's', s: 3 });
      gridRows.push(h2);

      groupEmps.forEach(function (p) {
        // km per bucket per dag
        var kmCmp = {}, kmCzp = {}, kmP = {}, totCmp = 0, totCzp = 0, totP = 0;
        for (var d = 1; d <= dim; d++) {
          kmCmp[d] = kmCzp[d] = kmP[d] = 0;
          var cell = p.days[d];
          if (cell) {
            for (var mt in cell.kmByMob) {
              if (!cell.kmByMob.hasOwnProperty(mt)) continue;
              var km = cell.kmByMob[mt], b = classifyMobility(mt);
              if (b === 'CMP') { kmCmp[d] += km; totCmp += km; }
              else if (b === 'CZP') { kmCzp[d] += km; totCzp += km; }
              else if (b === 'P') { kmP[d] += km; totP += km; }
            }
          }
        }

        var nameRow = gridBase + gridRows.length;
        var rowOpm = nameRow + 1, rowUT = nameRow + 2, rowWU = nameRow + 3, rowOV = nameRow + 4,
          rowCmp = nameRow + 5, rowCzp = nameRow + 6, rowP = nameRow + 7,
          rowFts = nameRow + 8, rowRTW = nameRow + 9, rowRWT = nameRow + 10;

        // NAAM-rij
        var row = [{ v: p.name, t: 's', s: 24 }];
        for (var dd = 1; dd <= dim; dd++) row.push({ v: '', t: 's', s: 25 });
        row.push({ v: '', t: 's', s: 3 });
        gridRows.push(row);

        // OPMERKING-rij
        row = [{ v: 'Opmerking', t: 's', s: 18 }];
        for (var d3 = 1; d3 <= dim; d3++) {
          var wk3 = isWeekend(dateOf(ym, d3)), cell3 = p.days[d3], blank = wk3 ? 20 : 19;
          if (cell3 && !wk3) {
            switch (cell3.class) {
              case 'sick': row.push({ v: 'Ziek', t: 's', s: 23 }); break;
              case 'feestdag': row.push({ v: 'Feestdag', t: 's', s: 26 }); break;
              case 'rustdag': row.push({ v: 'Rustdag', t: 's', s: 27 }); break;
              case 'verlof': row.push({ v: 'Verlof', t: 's', s: 28 }); break;
              case 'sociaalverlof': row.push({ v: 'Soc. verlof', t: 's', s: 29 }); break;
              default: row.push({ v: '', t: 's', s: blank });
            }
          } else row.push({ v: '', t: 's', s: blank });
        }
        row.push({ v: '', t: 's', s: 3 });
        gridRows.push(row);

        // UREN TOT-rij (statisch)
        row = [{ v: 'Uren tot', t: 's', s: 16 }];
        var utTotal = 0;
        for (var d4 = 1; d4 <= dim; d4++) {
          var wk4 = isWeekend(dateOf(ym, d4)), cell4 = p.days[d4];
          var worked4 = cell4 && ABSENCE_CLASSES.indexOf(cell4.class) === -1 && Math.abs(cell4.hours) > 0.001;
          if (worked4) {
            var val = round2(cell4.hours);
            var style = wk4 ? 20 : (cell4.class === 'late' ? 10 : 9);
            row.push({ v: val, t: 'n', s: style });
            utTotal += val;
          } else row.push({ v: '', t: 's', s: wk4 ? 20 : 17 });
        }
        row.push({ f: 'SUM(' + firstDayCol + rowUT + ':' + lastDayCol + rowUT + ')', t: 'n', s: 3, v: round2(utTotal) });
        gridRows.push(row);

        // WERKUREN-rij (statisch 8)
        row = [{ v: 'Werkuren', t: 's', s: 18 }];
        var wuTotal = 0;
        for (var d5 = 1; d5 <= dim; d5++) {
          var wk5 = isWeekend(dateOf(ym, d5)), cell5 = p.days[d5];
          var worked5 = cell5 && ABSENCE_CLASSES.indexOf(cell5.class) === -1 && Math.abs(cell5.hours) > 0.001;
          if (worked5) { row.push({ v: 8, t: 'n', s: wk5 ? 20 : 19 }); wuTotal += 8; }
          else row.push({ v: '', t: 's', s: wk5 ? 20 : 19 });
        }
        row.push({ f: 'SUM(' + firstDayCol + rowWU + ':' + lastDayCol + rowWU + ')', t: 'n', s: 3, v: wuTotal });
        gridRows.push(row);

        // OVERUREN-rij (formule = Uren tot - Werkuren)
        row = [{ v: 'Overuren', t: 's', s: 16 }];
        for (var d6 = 1; d6 <= dim; d6++) {
          var wk6 = isWeekend(dateOf(ym, d6)), cell6 = p.days[d6], L = col(d6 + 1);
          var worked6 = cell6 && ABSENCE_CLASSES.indexOf(cell6.class) === -1 && Math.abs(cell6.hours) > 0.001;
          var f = 'IF(' + L + rowUT + '="","",' + L + rowUT + '-' + L + rowWU + ')';
          if (worked6) row.push({ f: f, t: 'n', s: wk6 ? 20 : 17, v: round2(cell6.hours - 8) });
          else row.push({ f: f, t: 'n', s: wk6 ? 20 : 17 });
        }
        row.push({ f: 'SUM(' + firstDayCol + rowOV + ':' + lastDayCol + rowOV + ')', t: 'n', s: 3, v: round2(utTotal - wuTotal) });
        gridRows.push(row);

        // KM CMP / CZP / P
        var kmDefs = [
          ['KM CMP', kmCmp, rowCmp, totCmp, 18, 19],
          ['KM CZP', kmCzp, rowCzp, totCzp, 16, 17],
          ['KM P', kmP, rowP, totP, 18, 19]
        ];
        kmDefs.forEach(function (def) {
          var label = def[0], dayArr = def[1], rowNum = def[2], totCache = def[3], lblStyle = def[4], dataStyle = def[5];
          var r2 = [{ v: label, t: 's', s: lblStyle }];
          for (var d = 1; d <= dim; d++) {
            var wk = isWeekend(dateOf(ym, d)), v = dayArr[d] || 0;
            if (v > 0) r2.push({ v: round2(v), t: 'n', s: wk ? 20 : dataStyle });
            else r2.push({ v: '', t: 's', s: wk ? 20 : dataStyle });
          }
          r2.push({ f: 'SUM(' + firstDayCol + rowNum + ':' + lastDayCol + rowNum + ')', t: 'n', s: 3, v: round2(totCache) });
          gridRows.push(r2);
        });

        // WW Fiets / R T/W / R W/T (JA/NEE, COUNTIF)
        var jnDefs = [
          ['WW Fiets', 'fiets', rowFts, 16, 22, 21],
          ['R T/W', 'rsTW', rowRTW, 18, 19, 20],
          ['R W/T', 'rsWT', rowRWT, 16, 22, 21]
        ];
        jnDefs.forEach(function (def) {
          var label = def[0], key = def[1], rowNum = def[2], lblStyle = def[3], dataStyle = def[4], wkStyle = def[5];
          var r3 = [{ v: label, t: 's', s: lblStyle }];
          var cnt = 0;
          for (var d = 1; d <= dim; d++) {
            var wk = isWeekend(dateOf(ym, d)), cell = p.days[d];
            if (cell) {
              var v = cell[key] ? 'JA' : 'NEE';
              if (cell[key]) cnt++;
              r3.push({ v: v, t: 's', s: wk ? wkStyle : dataStyle });
            } else r3.push({ v: '', t: 's', s: wk ? wkStyle : dataStyle });
          }
          r3.push({ f: 'COUNTIF(' + firstDayCol + rowNum + ':' + lastDayCol + rowNum + ',"JA")&" dgn"', t: 's', s: 3, v: cnt + ' dgn' });
          gridRows.push(r3);
        });

        blockAddr[p.id] = {
          name: p.name, rowOpm: rowOpm, rowUT: rowUT, rowWU: rowWU, rowOV: rowOV,
          rowCmp: rowCmp, rowCzp: rowCzp, rowP: rowP, rowFts: rowFts,
          cacheUT: round2(utTotal), cacheWU: wuTotal, cacheOV: round2(utTotal - wuTotal),
          cacheCmp: round2(totCmp), cacheCzp: round2(totCzp), cacheP: round2(totP),
          cacheDays: p.count_days,
          cacheOntime: p.count_days - p.count_late - p.count_sick,
          cacheLate: p.count_late, cacheSick: p.count_sick, cacheFiets: p.count_fiets
        };
      });
    }

    buildGroupGrid('Bureau', groups.Bureau);
    if (groups.Bureau.length && groups.Techniekers.length) { gridRows.push([]); gridRows.push([]); }
    buildGroupGrid('Techniekers', groups.Techniekers);
    if ((groups.Bureau.length || groups.Techniekers.length) && groups.Monteurs.length) { gridRows.push([]); gridRows.push([]); }
    buildGroupGrid('Monteurs', groups.Monteurs);

    // ---- samenvattingstabel ----
    var kmBuckets = ['CMP', 'CZP', 'P'], nKm = kmBuckets.length;
    var summaryRows = [];
    summaryRows.push([{ v: 'Klok-overzicht maandrapport · ' + agg.monthLabel, t: 's', s: 1 }]);
    summaryRows.push([]);
    var header = [
      { v: 'Werknemer', t: 's', s: 1 }, { v: 'Dagen', t: 's', s: 1 },
      { v: 'Werkuren', t: 's', s: 1 }, { v: 'Overuren', t: 's', s: 1 }, { v: 'Totaal uren', t: 's', s: 1 }
    ];
    kmBuckets.forEach(function (b) { header.push({ v: 'KM ' + b, t: 's', s: 1 }); });
    header.push({ v: 'Km totaal', t: 's', s: 1 });
    header.push({ v: 'Op tijd', t: 's', s: 1 });
    header.push({ v: 'Te laat', t: 's', s: 1 });
    header.push({ v: 'Ziek', t: 's', s: 1 });
    header.push({ v: 'Fietsdagen', t: 's', s: 1 });
    summaryRows.push(header);

    var sColDagen = col(2), sColWU = col(3), sColOV = col(4), sColUT = col(5),
      sColCmp = col(6), sColCzp = col(7), sColP = col(8),
      sColKmTot = col(6 + nKm), sColOnt = col(7 + nKm), sColLate = col(8 + nKm),
      sColZiek = col(9 + nKm), sColFts = col(10 + nKm);

    var firstEmpRow = 4, rowIdx = 4;
    var g = { D: 0, WU: 0, OV: 0, UT: 0, Cmp: 0, Czp: 0, P: 0, Ont: 0, Late: 0, Sick: 0, Fts: 0 };
    empList.forEach(function (p) {
      var a = blockAddr[p.id];
      if (!a) return;
      var sr = rowIdx;
      var row = [{ v: a.name, t: 's', s: 7 }];
      row.push({ f: 'COUNT(' + firstDayCol + a.rowUT + ':' + lastDayCol + a.rowUT + ')+COUNTIF(' + firstDayCol + a.rowOpm + ':' + lastDayCol + a.rowOpm + ',"?*")', t: 'n', s: 0, v: a.cacheDays });
      row.push({ f: gridTotalCol + a.rowWU, t: 'n', s: 2, v: a.cacheWU });
      row.push({ f: gridTotalCol + a.rowOV, t: 'n', s: 2, v: a.cacheOV });
      row.push({ f: gridTotalCol + a.rowUT, t: 'n', s: 2, v: a.cacheUT });
      row.push({ f: gridTotalCol + a.rowCmp, t: 'n', s: 2, v: a.cacheCmp });
      row.push({ f: gridTotalCol + a.rowCzp, t: 'n', s: 2, v: a.cacheCzp });
      row.push({ f: gridTotalCol + a.rowP, t: 'n', s: 2, v: a.cacheP });
      row.push({ f: 'SUM(' + sColCmp + sr + ':' + sColP + sr + ')', t: 'n', s: 2, v: round2(a.cacheCmp + a.cacheCzp + a.cacheP) });
      row.push({ v: a.cacheOntime, t: 'n', s: 0 });
      row.push({ v: a.cacheLate, t: 'n', s: 0 });
      row.push({ f: 'COUNTIF(' + firstDayCol + a.rowOpm + ':' + lastDayCol + a.rowOpm + ',"Ziek")', t: 'n', s: 0, v: a.cacheSick });
      row.push({ f: 'COUNTIF(' + firstDayCol + a.rowFts + ':' + lastDayCol + a.rowFts + ',"JA")', t: 'n', s: 0, v: a.cacheFiets });
      summaryRows.push(row);
      rowIdx++;
      g.D += a.cacheDays; g.WU += a.cacheWU; g.OV += a.cacheOV; g.UT += a.cacheUT;
      g.Cmp += a.cacheCmp; g.Czp += a.cacheCzp; g.P += a.cacheP;
      g.Ont += a.cacheOntime; g.Late += a.cacheLate; g.Sick += a.cacheSick; g.Fts += a.cacheFiets;
    });
    var lastEmpRow = rowIdx - 1;
    function mkSum(c, cache) { return { f: 'SUM(' + c + firstEmpRow + ':' + c + lastEmpRow + ')', t: 'n', s: 3, v: cache }; }
    var totRow = [{ v: 'TOTAAL', t: 's', s: 3 }];
    totRow.push(mkSum(sColDagen, g.D));
    totRow.push(mkSum(sColWU, g.WU));
    totRow.push(mkSum(sColOV, round2(g.OV)));
    totRow.push(mkSum(sColUT, round2(g.UT)));
    totRow.push(mkSum(sColCmp, round2(g.Cmp)));
    totRow.push(mkSum(sColCzp, round2(g.Czp)));
    totRow.push(mkSum(sColP, round2(g.P)));
    totRow.push(mkSum(sColKmTot, round2(g.Cmp + g.Czp + g.P)));
    totRow.push(mkSum(sColOnt, g.Ont));
    totRow.push(mkSum(sColLate, g.Late));
    totRow.push(mkSum(sColZiek, g.Sick));
    totRow.push(mkSum(sColFts, g.Fts));
    summaryRows.push(totRow);

    var sheets = {};
    sheets['Overzicht'] = summaryRows.concat([[], [], []], gridRows);

    // ---- tab per werknemer ----
    empList.forEach(function (p) {
      var rows = [];
      rows.push([{ v: p.name + ' · ' + agg.monthLabel, t: 's', s: 1 }]);
      rows.push([]);
      var hdr = [
        { v: 'Datum', t: 's', s: 1 }, { v: 'Dag', t: 's', s: 1 }, { v: 'Status', t: 's', s: 1 },
        { v: 'Tijd', t: 's', s: 1 }, { v: 'Ingeklokt', t: 's', s: 1 }, { v: 'Uitgeklokt', t: 's', s: 1 },
        { v: 'Werkuren', t: 's', s: 1 }, { v: 'Overuren', t: 's', s: 1 }, { v: 'Totaal uren', t: 's', s: 1 }
      ];
      mobilityTypes.forEach(function (mt) { hdr.push({ v: 'KM ' + mobAbbr(mt), t: 's', s: 1 }); });
      hdr.push({ v: 'Km totaal', t: 's', s: 1 });
      hdr.push({ v: 'Fiets', t: 's', s: 1 });
      rows.push(hdr);

      var nMob = mobilityTypes.length;
      var colWU = col(7), colOV = col(8), colUT = col(9),
        kmFirstCol = col(10), kmLastCol = col(9 + nMob), colKmTot = col(10 + nMob), colFiets = col(11 + nMob);
      var firstDataRow = 4;
      var tWU = 0, tOV = 0, tUT = 0, tKm = 0, tFiets = 0;

      for (var d = 1; d <= dim; d++) {
        var rd = 3 + d, dt = dateOf(ym, d);
        var dateStr = pad2(dt.getDate()) + '/' + pad2(dt.getMonth() + 1) + '/' + dt.getFullYear();
        var dayName = DAYS_NL[dt.getDay()], wk = isWeekend(dt), cell = p.days[d];
        var styleBase = wk ? 5 : 0;
        var worked = cell && ABSENCE_CLASSES.indexOf(cell.class) === -1 && Math.abs(cell.hours) > 0.001;
        var row = [
          { v: dateStr, t: 's', s: styleBase },
          { v: dayName, t: 's', s: styleBase },
          { v: cell ? cell.status : '', t: 's', s: styleBase },
          { v: cell ? cell.tijd : '', t: 's', s: styleBase },
          { v: cell ? cell.ingeklokt : '', t: 's', s: styleBase },
          { v: cell ? cell.uitgeklokt : '', t: 's', s: styleBase }
        ];
        var fOver = 'IF(' + colUT + rd + '="","",' + colUT + rd + '-' + colWU + rd + ')';
        if (worked) {
          row.push({ v: 8, t: 'n', s: 2 });
          row.push({ f: fOver, t: 'n', s: 2, v: round2(cell.hours - 8) });
          row.push({ v: round2(cell.hours), t: 'n', s: 6 });
          tWU += 8; tOV += round2(cell.hours - 8); tUT += round2(cell.hours);
        } else {
          row.push({ v: '', t: 's', s: styleBase });
          row.push({ f: fOver, t: 'n', s: 2 });
          row.push({ v: '', t: 's', s: styleBase });
        }
        var rowKm = 0;
        mobilityTypes.forEach(function (mt) {
          var km = cell ? (cell.kmByMob[mt] || 0) : 0;
          if (km > 0) { row.push({ v: round2(km), t: 'n', s: 2 }); rowKm += km; }
          else row.push({ v: '', t: 's', s: styleBase });
        });
        if (nMob > 0) {
          row.push({ f: 'IF(SUM(' + kmFirstCol + rd + ':' + kmLastCol + rd + ')=0,"",SUM(' + kmFirstCol + rd + ':' + kmLastCol + rd + '))', t: 'n', s: 6, v: rowKm > 0 ? round2(rowKm) : '' });
        } else row.push({ v: '', t: 's', s: styleBase });
        tKm += rowKm;
        var isFiets = cell && cell.fiets;
        if (isFiets) tFiets++;
        row.push({ v: isFiets ? 'X' : '', t: 's', s: styleBase });
        rows.push(row);
      }
      var lastDataRow = 3 + dim;
      rows.push([]);

      var totaalRow = [
        { v: 'MAANDTOTAAL', t: 's', s: 3 }, { v: p.count_days + ' dgn', t: 's', s: 3 },
        { v: '', t: 's', s: 3 }, { v: '', t: 's', s: 3 }, { v: '', t: 's', s: 3 }, { v: '', t: 's', s: 3 },
        { f: 'SUM(' + colWU + firstDataRow + ':' + colWU + lastDataRow + ')', t: 'n', s: 3, v: tWU },
        { f: 'SUM(' + colOV + firstDataRow + ':' + colOV + lastDataRow + ')', t: 'n', s: 3, v: round2(tOV) },
        { f: 'SUM(' + colUT + firstDataRow + ':' + colUT + lastDataRow + ')', t: 'n', s: 3, v: round2(tUT) }
      ];
      mobilityTypes.forEach(function (mt, i) {
        var c = col(10 + i), typeTot = 0;
        for (var dk in p.days) { if (p.days.hasOwnProperty(dk)) typeTot += (p.days[dk].kmByMob[mt] || 0); }
        totaalRow.push({ f: 'SUM(' + c + firstDataRow + ':' + c + lastDataRow + ')', t: 'n', s: 3, v: round2(typeTot) });
      });
      if (nMob > 0) totaalRow.push({ f: 'SUM(' + colKmTot + firstDataRow + ':' + colKmTot + lastDataRow + ')', t: 'n', s: 3, v: round2(tKm) });
      else totaalRow.push({ v: round2(tKm), t: 'n', s: 3 });
      totaalRow.push({ f: 'COUNTIF(' + colFiets + firstDataRow + ':' + colFiets + lastDataRow + ',"X")&" dgn"', t: 's', s: 3, v: tFiets + ' dgn' });
      rows.push(totaalRow);

      var sheetName = safeSheetName(p.name);
      if (sheetName.toLowerCase() === 'overzicht') sheetName += ' (emp)';
      var base = sheetName, n = 2;
      while (sheets[sheetName]) { sheetName = base.slice(0, 27) + ' (' + n + ')'; n++; }
      sheets[sheetName] = rows;
    });

    return sheets;
  }

  function safeSheetName(name) {
    var s = String(name || 'Blad').replace(/[\\\/\?\*\[\]:]/g, ' ').trim();
    if (!s) s = 'Blad';
    return s.slice(0, 31);
  }

  // ===============================================================
  // 7. IN-APP OVERZICHT (HTML)  — samenvatting per groep + TOTAAL
  // ===============================================================
  function renderOverviewHTML(agg) {
    var groups = agg.groups;
    var order = ['Bureau', 'Techniekers', 'Monteurs'];
    var gtot = { days: 0, wu: 0, ov: 0, ut: 0, cmp: 0, czp: 0, p: 0, ont: 0, late: 0, sick: 0, fiets: 0 };

    function empBuckets(p) {
      var cmp = 0, czp = 0, pp = 0;
      for (var d in p.days) {
        if (!p.days.hasOwnProperty(d)) continue;
        var km = p.days[d].kmByMob || {};
        for (var mt in km) {
          if (!km.hasOwnProperty(mt)) continue;
          var b = classifyMobility(mt);
          if (b === 'CMP') cmp += km[mt]; else if (b === 'CZP') czp += km[mt]; else if (b === 'P') pp += km[mt];
        }
      }
      return { cmp: cmp, czp: czp, p: pp };
    }
    function num(n) { var r = round2(n); return (Math.round(r) === r) ? String(r) : r.toFixed(2); }

    var html = '';
    if (!agg.empList.length) {
      return '<div class="ua-empty">Geen tijdsregistraties gevonden voor ' + escapeHtml(agg.monthLabel) + '.</div>';
    }

    order.forEach(function (gName) {
      var list = groups[gName];
      if (!list || !list.length) return;
      html += '<div class="ua-group"><div class="ua-group-title">' + escapeHtml(gName) + '</div>';
      html += '<div class="ua-table-wrap"><table class="ua-table"><thead><tr>' +
        '<th class="ua-l">Werknemer</th><th>Dagen</th><th>Werk</th><th>Over</th><th>Totaal</th>' +
        '<th>KM CMP</th><th>KM CZP</th><th>KM P</th><th>Km tot</th>' +
        '<th>Op tijd</th><th>Te laat</th><th>Ziek</th><th>Fiets</th></tr></thead><tbody>';
      list.forEach(function (p) {
        var km = empBuckets(p);
        var ont = p.count_days - p.count_late - p.count_sick;
        var kmTot = km.cmp + km.czp + km.p;
        html += '<tr>' +
          '<td class="ua-l">' + escapeHtml(p.name) + '</td>' +
          '<td>' + p.count_days + '</td>' +
          '<td>' + num(p.tot_work) + '</td>' +
          '<td>' + num(p.tot_over) + '</td>' +
          '<td class="ua-strong">' + num(p.tot_tot) + '</td>' +
          '<td>' + num(km.cmp) + '</td><td>' + num(km.czp) + '</td><td>' + num(km.p) + '</td>' +
          '<td>' + num(kmTot) + '</td>' +
          '<td>' + ont + '</td>' +
          '<td' + (p.count_late ? ' class="ua-warn"' : '') + '>' + p.count_late + '</td>' +
          '<td' + (p.count_sick ? ' class="ua-sick"' : '') + '>' + p.count_sick + '</td>' +
          '<td>' + p.count_fiets + '</td></tr>';
        gtot.days += p.count_days; gtot.wu += p.tot_work; gtot.ov += p.tot_over; gtot.ut += p.tot_tot;
        gtot.cmp += km.cmp; gtot.czp += km.czp; gtot.p += km.p;
        gtot.ont += ont; gtot.late += p.count_late; gtot.sick += p.count_sick; gtot.fiets += p.count_fiets;
      });
      html += '</tbody></table></div></div>';
    });

    html += '<div class="ua-table-wrap"><table class="ua-table ua-total"><tbody><tr>' +
      '<td class="ua-l">TOTAAL</td><td>' + gtot.days + '</td><td>' + num(gtot.wu) + '</td>' +
      '<td>' + num(gtot.ov) + '</td><td class="ua-strong">' + num(gtot.ut) + '</td>' +
      '<td>' + num(gtot.cmp) + '</td><td>' + num(gtot.czp) + '</td><td>' + num(gtot.p) + '</td>' +
      '<td>' + num(gtot.cmp + gtot.czp + gtot.p) + '</td>' +
      '<td>' + gtot.ont + '</td><td>' + gtot.late + '</td><td>' + gtot.sick + '</td><td>' + gtot.fiets + '</td>' +
      '</tr></tbody></table></div>';

    var m = agg.meta || {};
    html += '<div class="ua-meta">' + agg.empList.length + ' werknemers · ' +
      (m.woMatched || 0) + ' registraties · ' + (m.calls || 0) + ' API-calls · ' +
      (m.woPages || 0) + ' pagina’s</div>';
    return html;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ===============================================================
  // PUBLIC API
  // ===============================================================
  window.QEUren = {
    computeMonth: computeMonth,
    buildSheets: buildSheets,
    renderOverviewHTML: renderOverviewHTML,
    // helpers (handig voor tests / de tab)
    monthLabel: monthLabel,
    fileNameFor: function (ym) { return 'klok-maandrapport-' + ym + '.xlsx'; },
    _internals: { classifyTijd: classifyTijd, classifyMobility: classifyMobility, efValue: efValue, nameFromTitle: nameFromTitle }
  };
})();
