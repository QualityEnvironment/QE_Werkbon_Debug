/* ============================================================
   QE Werkbon 2.0 — MARBLE UI-RUNTIME (v266)
   1-op-1 replica-laag van het prototype "QE Werkbon 2.0 Marble":
   - schermkoppen (datum-regel + 34px titel) + schermovergangen (mbIn)
   - topbar: klok-status + i-knop (tutorial)
   - TUTORIAL: uitleg per scherm + volledige rondleiding (oranje ring)
   - LOGIN-WIPE: navy overlay met logo + begroeting na inloggen
   - LOADER-overlay (ring + QE-logo + puntjes) voor blokkerende acties
   - SUCCES-overlay (navy cirkel + vinkje) — QEMarble.flash()
   Puur design-laag: wrapt app-functies, verandert GEEN motor-logica.
   Laden NA app.js. MOTOR-SYNC: dit bestand bestaat alleen in de
   Marble-www; bij motor-syncs uit 1.x gewoon laten staan.
   ============================================================ */
(function () {
    'use strict';

    var QE_LOGO_SVG = '<svg width="{SZ}" height="{SZ}" viewBox="0 0 200 200">' +
        '<rect x="44" y="35" width="110" height="110" rx="2" fill="#F99D3E"></rect>' +
        '<path d="M91.9 147 L96.8 143.3 L103.5 140 L110.1 138.4 L116.8 138 L123.4 139.4 L130 141.3 L136.6 144 L143.2 146.6 L149.8 148.6 L156.4 150 L163 151 L164.7 152 L163 153.3 L156.4 155.6 L149.8 157 L143.2 156.6 L136.6 155 L130 152.3 L123.4 150 L116.8 148 L110.1 147.3 L103.5 147.3 L96.8 148 Z" fill="#6A2C91"></path>' +
        '<circle cx="80.5" cy="89.8" r="37" fill="none" stroke="#6A2C91" stroke-width="21"></circle></svg>';
    function logo(sz) { return QE_LOGO_SVG.replace(/\{SZ\}/g, String(sz)); }

    /* ---------- HAPTIEK (v275) — exact volgens de Marble-handoff,
       sectie "4 · Haptiek & geluid". Eén centrale bron zodat de
       trilfeedback overal consistent aanvoelt. Knoppen/tabs/chips
       krijgen bewust GEEN trilling (rustig ontwerp). navigator.vibrate
       werkt alleen op Android; iOS/desktop negeren het stil. ---------- */
    var HAPTICS = {
        nfcRead:      [40, 40, 40],  // NFC-tag gelezen — dubbele korte tik (2×40ms)
        clockConfirm: [60],          // in-/uitklokken bevestigd — één stevige tik
        fridayClock:  [90],          // vrijdag-uitklok — stevige tik
        success:      [30, 40, 60],  // werkbon verstuurd / betaling geslaagd
        error:        [120],         // fout / geweigerde actie — lange buzz
        timer:        [40]           // timer start/stop — korte tik
    };
    function haptic(kind) {
        try {
            var p = HAPTICS[kind];
            if (p && navigator.vibrate) navigator.vibrate(p);
        } catch (e) { /* haptiek is nooit kritisch */ }
    }

    /* ---------- schermkoppen: kleine grijze regel + 34px titel ---------- */
    var HEADS = {
        screenPlanning:    { sub: 'DATUM', title: 'Planning' },
        screenClock:       { sub: 'Tijdsregistratie', title: 'Klok' },
        screenUitgevoerd:  { sub: 'Laatste 7 dagen', title: 'Uitgevoerd' },
        screenProfile:     { sub: '', title: 'Profiel' },
        screenAdmin:       { sub: 'Werknemers beheren via Robaws', title: 'Beheer' },
        screenUrenAnalyse: { sub: 'Alle werknemers', title: 'Uren-analyse' },
        screenAfwezigheid: { sub: 'Alleen bureel — weekends worden overgeslagen', title: 'Afwezigheid melden' },
        screenAanvragen:   { sub: 'Verlof · Materiaal · Materieel', title: 'Aanvragen' },
        screenRecap:       { sub: 'Terugblik per maand', title: 'Maandrecap' },
        screenVerlofDetail:{ sub: 'Details & communicatie', title: 'Verlofaanvraag' },
        screenGoedkeuren:  { sub: 'Verlof · Facturen · Materieel', title: 'Goedkeuren' },
        screenFactuurDetail:{ sub: 'Aankoopfactuur goedkeuren', title: 'Factuur' },
        screenMaterieelDetail:{ sub: 'Reserveren & beschikbaarheid', title: 'Materieel' },
        screenMaterieelAanvragen:{ sub: 'Jouw materieel-aanvragen', title: 'Vorige aanvragingen' }
        // screenDagoverzicht: kop wordt door loadDagoverzicht zelf gerenderd (maand + pijltjes)
        // detail/werkbon/betaal-schermen: hebben hun eigen kop
    };
    function dutchDate(d) {
        var days = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
        var months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
        return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }
    function injectHead(screenId) {
        var cfg = HEADS[screenId];
        var scr = document.getElementById(screenId);
        if (!scr) return;
        if (!cfg) return;
        var head = scr.querySelector(':scope > .mb-head');
        if (!head) {
            head = document.createElement('div');
            head.className = 'mb-head';
            scr.insertBefore(head, scr.firstChild);
            scr.classList.add('mb-headed');
        }
        var sub = cfg.sub === 'DATUM' ? dutchDate(new Date()) : cfg.sub;
        head.innerHTML = (sub ? '<div class="mb-head-sub">' + sub + '</div>' : '') +
            '<div class="mb-head-title">' + cfg.title + '</div>';
    }

    /* ---------- topbar: klok-statustekst rechts ---------- */
    function syncHeaderStatus() {
        var el = document.getElementById('headerClockStatus');
        if (!el || !window.QEClock) return;
        try {
            var user = (window.RobawsAPI && RobawsAPI.getLoggedInUser) ? RobawsAPI.getLoggedInUser() : null;
            if (!user) { el.textContent = ''; return; }
            var session = QEClock.getSession();
            var active = session && session.active;
            var clockTime = QEClock.getClockTime();
            if (session && session.llActive) {
                el.textContent = 'L&L actief'; el.style.color = 'var(--purple2)';
            } else if (active) {
                el.textContent = 'Ingeklokt · ' + (session.startTime || '');
                el.style.color = QEClock.isLate() ? 'var(--amber)' : 'var(--green2)';
            } else if (clockTime) {
                el.textContent = 'Uit · ' + clockTime; el.style.color = 'var(--g1)';
            } else {
                el.textContent = 'Niet ingeklokt'; el.style.color = 'var(--amber)';
            }
        } catch (e) { /* status is decoratief */ }
    }

    /* ---------- overlays bouwen ---------- */
    function buildOverlays() {
        var host = document.createElement('div');
        host.id = 'mbOverlays';
        host.innerHTML =
            /* loader */
            '<div id="mbLoader" class="mb-fullveil" style="display:none">' +
            '  <div class="mb-loaderring">' +
            '    <svg width="96" height="96" viewBox="0 0 96 96" class="mb-spinsvg">' +
            '      <circle cx="48" cy="48" r="44" fill="none" stroke="var(--l1)" stroke-width="2"></circle>' +
            '      <circle cx="48" cy="48" r="44" fill="none" stroke="#F99D3E" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="66 210"></circle>' +
            '    </svg>' +
            '    <div class="mb-loaderlogo">' + logo(38) + '</div>' +
            '  </div>' +
            '  <div class="mb-loadertxt"><span id="mbLoaderTxt">Laden</span><span class="mb-dot">.</span><span class="mb-dot mb-dot2">.</span><span class="mb-dot mb-dot3">.</span></div>' +
            '  <div class="mb-gradline"></div>' +
            '  <div class="mb-loadersub">Even geduld — sluit de app niet</div>' +
            '</div>' +
            /* succes */
            '<div id="mbSucces" class="mb-fullveil mb-succes" style="display:none">' +
            '  <div class="mb-succircle">' + '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11" stroke-dasharray="60" class="mb-checkpath"></path></svg>' + '</div>' +
            '  <div class="mb-suctitle" id="mbSucTitle"></div>' +
            '  <div class="mb-sucsub" id="mbSucSub"></div>' +
            '  <div class="mb-gradline"></div>' +
            '</div>' +
            /* login-wipe */
            '<div id="mbWipe" style="display:none">' +
            '  <div class="mb-wipeinner">' +
            '    <div class="mb-wipelogo">' + logo(72) + '</div>' +
            '    <div class="mb-wipehi" id="mbWipeHi">Goeiemorgen</div>' +
            '    <div class="mb-wipesub" id="mbWipeSub"></div>' +
            '    <div class="mb-wipeline"></div>' +
            '  </div>' +
            '</div>' +
            /* dagoverzicht na uitklokken — weekdag (prototype "DAGOVERZICHT") */
            '<div id="mbDay" style="display:none">' +
            '  <div class="mb-daycircle"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#F9B25E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11" stroke-dasharray="60" class="mb-checkpath"></path></svg></div>' +
            '  <div class="mb-daytitle">Dag afgerond</div>' +
            '  <div class="mb-daysub" id="mbDaySub"></div>' +
            '  <div class="mb-dayline"></div>' +
            '  <div class="mb-dayhint">Tik om te sluiten</div>' +
            '</div>' +
            /* vrijdag: einde van de werkweek (prototype "VRIJDAG") */
            '<div id="mbFri" style="display:none">' +
            '  <div id="mbFriDeco"></div>' +
            '  <div class="mb-frisun">' +
            '    <div class="mb-frisun-glow"></div>' +
            '    <div class="mb-frisun-rays"><svg width="190" height="190" viewBox="0 0 190 190"><g stroke="#F9B25E" stroke-width="2" stroke-linecap="round"><path d="M95 6v20M95 164v20M6 95h20M164 95h20M32 32l14 14M144 144l14 14M158 32l-14 14M46 144l-14 14"></path></g></svg></div>' +
            '    <div class="mb-frisun-ball"></div>' +
            '    <div class="mb-frisun-hor"></div>' +
            '  </div>' +
            '  <div class="mb-fritit" id="mbFriTitle">Prettig weekend</div>' +
            '  <div class="mb-frisub" id="mbFriSub"></div>' +
            '  <div class="mb-dayline mb-friline"></div>' +
            '  <div class="mb-dayhint mb-frihint">Tik om te sluiten</div>' +
            '</div>' +
            /* tutorial */
            '<div id="mbTut" style="display:none">' +
            '  <div id="mbTutScrim"></div>' +
            '  <div id="mbTutRing"></div>' +
            '  <div id="mbTutSheet">' +
            '    <div class="mb-tuthdr">' +
            '      <span class="mb-tutkicker" id="mbTutKicker"></span>' +
            '      <button class="mb-tutclose" onclick="QEMarble.tutClose()">✕</button>' +
            '    </div>' +
            '    <div id="mbTutBody"><div class="mb-tuttitle" id="mbTutTitle"></div><div class="mb-tuttext" id="mbTutText"></div></div>' +
            '    <div class="mb-tutdots" id="mbTutDots"></div>' +
            '    <button class="mb-tuttour" id="mbTutTourBtn" onclick="QEMarble.startTour()">Volledige rondleiding door de app</button>' +
            '    <div class="mb-tutbtns">' +
            '      <button class="mb-tutprev" id="mbTutPrev" onclick="QEMarble.tutPrev()">Vorige</button>' +
            '      <button class="mb-tutnext" id="mbTutNext" onclick="QEMarble.tutNext()">Volgende</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(host);
        document.getElementById('mbTut').addEventListener('click', function (e) {
            if (e.target && (e.target.id === 'mbTut' || e.target.id === 'mbTutScrim')) QEMarble.tutClose();
        });
    }

    /* ---------- TUTORIAL-INHOUD (1:1 uit het Marble-prototype) ----------
       anchor = CSS-selector (optioneel), closest = optionele parent-selector,
       tab = detail-tab die eerst geopend moet worden. */
    var TUTS = {
        screenPlanning: { name: 'PLANNING', steps: [
            ['Je dagplanning', 'Hier staan de werkorders van vandaag, in volgorde van je route. Met de chips bovenaan wissel je van dag. Tik op een werkorder om hem te openen.', '#dateStrip'],
            ['Klok-status', 'De kaart bovenaan toont of je in- of uitgeklokt bent. Tik erop om naar het klokscherm te gaan.', '#clockStatusBar'],
            ['Bellen & navigeren', 'De knoppen op elke kaart bellen de klant of openen Google Maps — zonder de werkorder te openen.', '#workorderList'],
            ['Badges', '"Regie" betekent tijd & materiaal aanrekenen. "In bewerking" wil zeggen dat je al uren of materiaal registreerde.', '#workorderList']
        ] },
        screenDetail: { name: 'WERKORDER', steps: [
            ['Vier tabbladen', 'Info toont de klant en de taak, Uren registreert je tijd, Materiaal je artikels, en Foto’s je bewijsfoto’s.', '#detailTabs'],
            ['Info', 'Navigeer naar het werfadres, bel of mail de klant, pas het BTW-tarief aan (bewaard in Robaws). Onderaan staan opmerking-velden.', '#tabInfo', 'tabInfo'],
            ['Uren', 'Start de timer bij aankomst en stop bij vertrek — er wordt op kwartieren afgerond. Handmatig een blok toevoegen kan ook.', '#tabUren', 'tabUren'],
            ['Materiaal', 'Kies onderhoud via de stappen (type → vermogen → zone), voeg verplaatsingskosten toe bij regie, of zoek artikels vrij.', '#tabMaterial', 'tabMaterial'],
            ['Foto’s', 'Maak foto’s van je werk. Bij een onderhoud is minstens één foto van het attest verplicht — anders kan de werkbon niet verstuurd worden.', '#tabFotos', 'tabFotos'],
            ['Werkbon', 'Klaar? Tik onderaan op de oranje knop voor het overzicht, de handtekening en de betaling.']
        ] },
        screenWerkbon: { name: 'WERKBON', steps: [
            ['Controle', 'Controleer de uren (afgerond voor facturatie), materialen en het totaal incl. BTW.'],
            ['Geen factuur', 'Voor garantie of terugkomwerk vink je "Geen factuur maken" aan — de werkbon wordt dan zonder factuur verstuurd.', '#wbNoInvoice', 'label'],
            ['Betaalwijze', 'QR is het snelst: de klant scant en de betaling wordt direct bevestigd. Terminal stuurt het bedrag naar Mollie Tap. Cash en factuur kunnen ook.', '#wbPaymentMethodSection'],
            ['Ondertekenen', 'De knop onderaan opent de handtekening; daarna wordt alles naar Robaws gestuurd.']
        ] },
        screenClock: { name: 'KLOK', steps: [
            ['NFC in- en uitklokken', 'Houd je telefoon tegen een NFC-tag: bureau, camionet of laden & lossen. De kaart toont je status en kleurt mee.', '#clockHeroCard'],
            ['Afronding', 'Kwartieren met 4 min tolerantie: 06:48 → 06:45, maar 06:50 → 07:00. Uitklokken rondt naar beneden met dezelfde tolerantie.'],
            ['Je startuur', 'Vroeger inklokken dan je startuur telt pas vanaf je startuur — behalve in de camionet op vraag van de projectleider.'],
            ['Weeklog', 'Onderaan zie je je afgeronde registraties. Weekend telt altijd als overuren.', '#clockCompletedSection']
        ] },
        screenDagoverzicht: { name: 'MIJN UREN', steps: [
            ['Maandoverzicht', 'De cijfers bovenaan tellen je maand op; met de pijltjes blader je naar vorige maanden.', '#mbUrenStats'],
            ['Dagdetail', 'Elke rij is een dag met het type uren. Ziekte of verlof staat er ook tussen.'],
            ['Aanpassing vragen', 'Klopt iets niet? Tik op de registratie — je aanvraag gaat naar Vince.']
        ] },
        screenUitgevoerd: { name: 'UITGEVOERD', steps: [
            ['Afgewerkte werkbonnen', 'De laatste 7 dagen, met uren, artikels en betaalstatus.', '#uitgevoerdList'],
            ['Correcties', 'Tik op een werkbon om uren of materiaal te corrigeren. Het origineel blijft staan; het verschil komt in een correctie-werkbon.']
        ] },
        screenProfile: { name: 'PROFIEL', steps: [
            ['Instellingen', 'Standaard terminal, je actieve rol en je PIN — tik op de groep om ze open te klappen.', '#pgHeadInstel'],
            ['Toegankelijkheid', 'Tekst en knoppen groter, hoog contrast, minder beweging en kleurenblind-modus — allemaal hier.', '#pgHeadToegank'],
            ['Werknemers', 'Beheer, afwezigheid melden en (voor Levi & Vince) de uren-analyse.', '#pgHeadWerkn'],
            ['App bijwerken', 'Controleer op updates. Uitloggen staat helemaal onderaan.', '#pgHeadApp']
        ] },
        screenAdmin: { name: 'BEHEER', steps: [
            ['Werknemers', 'Per werknemer zie je rol en status. PIN reset stuurt een nieuwe PIN, Rol wisselt de app-flow, Stopzet deactiveert de login.'],
            ['Robaws', 'Alles wordt rechtstreeks in Robaws bewaard — nieuwe werknemers voeg je toe in Robaws-web.']
        ] },
        screenUrenAnalyse: { name: 'UREN-ANALYSE', steps: [
            ['Maandmatrix', 'Per werknemer: werkuren, overuren, kilometers en afwezigheden — rechtstreeks uit de klok-registraties.', '#uaContent'],
            ['Excel-export', 'De knop onderaan genereert het maandbestand voor de boekhouding. Alleen Levi & Vince zien dit scherm.', '#uaActions']
        ] }
    };
    var TOUR_BASE = ['screenPlanning', 'screenClock', 'screenDagoverzicht', 'screenUitgevoerd', 'screenProfile'];

    var tut = { open: false, screen: null, step: 0, full: false };

    function activeScreenId() {
        var el = document.querySelector('.screen.active');
        return el ? el.id : 'screenPlanning';
    }
    function tourList() {
        var list = TOUR_BASE.slice();
        var admin = document.getElementById('adminCard');
        var ana = document.getElementById('urenAnalyseCard');
        if (admin && admin.style.display !== 'none') list.push('screenAdmin');
        if (ana && ana.style.display !== 'none') list.push('screenUrenAnalyse');
        return list;
    }
    function tutRender() {
        var box = document.getElementById('mbTut');
        if (!tut.open) { box.style.display = 'none'; return; }
        var cfg = TUTS[tut.screen];
        if (!cfg) { tutCloseFn(); return; }
        var step = cfg.steps[tut.step] || cfg.steps[0];
        box.style.display = 'block';
        var order = tourList(), pos = order.indexOf(tut.screen);
        document.getElementById('mbTutKicker').textContent = tut.full
            ? ('APP-RONDLEIDING · ' + (pos + 1) + '/' + order.length + ' · ' + cfg.name)
            : ('UITLEG · ' + cfg.name);
        var body = document.getElementById('mbTutBody');
        body.style.animation = 'none'; void body.offsetWidth; body.style.animation = '';
        document.getElementById('mbTutTitle').textContent = step[0];
        document.getElementById('mbTutText').textContent = step[1];
        /* dots */
        var dots = '';
        for (var i = 0; i < cfg.steps.length; i++) {
            dots += '<span class="mb-tutdot' + (i === tut.step ? ' on' : '') + '" onclick="QEMarble.tutGo(' + i + ')"></span>';
        }
        document.getElementById('mbTutDots').innerHTML = dots;
        document.getElementById('mbTutTourBtn').style.display = tut.full ? 'none' : 'block';
        var atLast = tut.step >= cfg.steps.length - 1;
        document.getElementById('mbTutPrev').style.display = (tut.step > 0 || (tut.full && pos > 0)) ? 'inline-block' : 'none';
        document.getElementById('mbTutNext').textContent = !atLast ? 'Volgende'
            : (tut.full ? (pos < order.length - 1 ? 'Volgende onderdeel' : 'Klaar') : 'Klaar');
        /* detail-tab wisselen indien nodig */
        if (step[3] && /^tab/.test(step[3])) {
            try {
                var tb = document.querySelector('#detailTabs [data-tab="' + step[3] + '"]');
                if (tb && !tb.classList.contains('active') && window.app && app.switchTab) app.switchTab(tb);
            } catch (e) {}
        }
        measureRing(step);
    }
    function measureRing(step) {
        var ring = document.getElementById('mbTutRing');
        var scrim = document.getElementById('mbTutScrim');
        var sel = step[2];
        var el = sel ? document.querySelector(sel) : null;
        if (el && step[3] && !/^tab/.test(step[3])) { el = el.closest(step[3]) || el; }
        if (!el || el.offsetParent === null) { ring.style.display = 'none'; scrim.style.display = 'block'; return; }
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
        setTimeout(function () {
            var r = el.getBoundingClientRect();
            if (!r.width && !r.height) { ring.style.display = 'none'; scrim.style.display = 'block'; return; }
            scrim.style.display = 'none';
            ring.style.display = 'block';
            ring.style.top = (r.top - 6) + 'px';
            ring.style.left = (r.left - 6) + 'px';
            ring.style.width = (r.width + 12) + 'px';
            ring.style.height = (r.height + 12) + 'px';
        }, 260);
    }
    function tutOpenFn() {
        var id = activeScreenId();
        tut = { open: true, screen: TUTS[id] ? id : 'screenPlanning', step: 0, full: false };
        if (!TUTS[id]) {
            /* geen uitleg voor dit scherm → toon planning-uitleg niet zomaar; meld kort */
            if (window.app && app.showToast) { app.showToast('Geen uitleg voor dit scherm'); tut.open = false; return; }
        }
        tutRender();
    }
    function tutCloseFn() { tut.open = false; tut.full = false; tutRender(); }
    function tutNextFn() {
        var cfg = TUTS[tut.screen]; if (!cfg) return tutCloseFn();
        if (tut.step < cfg.steps.length - 1) { tut.step++; tutRender(); return; }
        if (tut.full) {
            var order = tourList(), i = order.indexOf(tut.screen);
            if (i >= 0 && i < order.length - 1) {
                tut.screen = order[i + 1]; tut.step = 0;
                if (window.app && app.navigate) app.navigate(tut.screen);
                setTimeout(tutRender, 350);
                return;
            }
        }
        tutCloseFn();
    }
    function tutPrevFn() {
        if (tut.step > 0) { tut.step--; tutRender(); return; }
        if (tut.full) {
            var order = tourList(), i = order.indexOf(tut.screen);
            if (i > 0) {
                tut.screen = order[i - 1];
                tut.step = (TUTS[tut.screen] ? TUTS[tut.screen].steps.length : 1) - 1;
                if (window.app && app.navigate) app.navigate(tut.screen);
                setTimeout(tutRender, 350);
            }
        }
    }
    function startTourFn() {
        tut = { open: true, screen: 'screenPlanning', step: 0, full: true };
        if (window.app && app.navigate) app.navigate('screenPlanning');
        setTimeout(tutRender, 350);
    }

    /* ---------- loader ---------- */
    var loaderCount = 0;
    function showLoader(txt) {
        loaderCount++;
        var el = document.getElementById('mbLoader');
        document.getElementById('mbLoaderTxt').textContent = txt || 'Laden';
        el.style.display = 'flex';
    }
    function hideLoader() {
        loaderCount = Math.max(0, loaderCount - 1);
        if (loaderCount === 0) document.getElementById('mbLoader').style.display = 'none';
    }

    /* ---------- succes-overlay ---------- */
    var flashT = null;
    function flash(title, sub, ms, onDone, hap) {
        var el = document.getElementById('mbSucces');
        document.getElementById('mbSucTitle').textContent = title || 'Gelukt';
        document.getElementById('mbSucSub').textContent = sub || '';
        el.style.display = 'none'; void el.offsetWidth;
        el.style.display = 'flex';
        haptic(hap || 'success');
        var done = false;
        var close = function () {
            if (done) return; done = true;
            el.style.display = 'none';
            el.onclick = null;
            if (typeof onDone === 'function') { try { onDone(); } catch (e) {} }
        };
        el.onclick = close;
        clearTimeout(flashT);
        flashT = setTimeout(close, ms || 1800);
    }

    /* ---------- uitklok-overlays (dagoverzicht / vrijdag) ---------- */
    var dayT = null, friT = null;
    function daySummary(sub, onDone) {
        var el = document.getElementById('mbDay');
        document.getElementById('mbDaySub').textContent = sub || '';
        el.style.display = 'none'; void el.offsetWidth;
        el.style.display = 'flex';
        haptic('clockConfirm');  // uitklokken bevestigd
        var done = false;
        var close = function () {
            if (done) return; done = true;
            el.style.display = 'none'; el.onclick = null;
            if (typeof onDone === 'function') { try { onDone(); } catch (e) {} }
        };
        el.onclick = close;
        clearTimeout(dayT);
        dayT = setTimeout(close, 5000);
    }
    function friday(sub, onDone) {
        var el = document.getElementById('mbFri');
        var deco = document.getElementById('mbFriDeco');
        var name = '';
        try { name = (window.app && app.currentUser && app.currentUser.name) ? app.currentUser.name.split(' ')[0] : ''; } catch (e) {}
        document.getElementById('mbFriTitle').textContent = 'Prettig weekend' + (name ? ', ' + name : '');
        document.getElementById('mbFriSub').textContent = sub || 'Dat was ’m voor deze week';
        /* sterren + confetti in merkkleuren (deterministisch, zoals het prototype) */
        var html = '';
        var i;
        for (i = 0; i < 16; i++) {
            html += '<span class="mb-star" style="left:' + ((i * 61) % 96 + 2) + '%;top:' + ((i * 37) % 34 + 3) + '%;' +
                'animation-duration:' + (1.8 + (i % 4) * 0.5) + 's;animation-delay:' + ((i % 5) * 0.35) + 's"></span>';
        }
        var colors = ['#F99D3E', '#B491CE', '#F9B25E', 'rgba(255,255,255,0.85)'];
        for (i = 0; i < 18; i++) {
            html += '<span class="mb-conf" style="left:' + (3 + i * 5.4) + '%;width:' + (i % 3 === 0 ? 5 : 7) + 'px;height:' + (i % 2 === 0 ? 12 : 9) + 'px;' +
                'background:' + colors[i % 4] + ';animation-duration:' + (3.4 + (i % 5) * 0.55) + 's;animation-delay:' + ((i * 0.47) % 3.2) + 's"></span>';
        }
        deco.innerHTML = html;
        el.style.display = 'none'; void el.offsetWidth;
        el.style.display = 'flex';
        haptic('fridayClock');  // vrijdag-uitklok — stevige tik
        /* de weekend-jingle speelt de motor zelf al (app._playWeekendJingle, cap 15 s) */
        var done = false;
        var close = function () {
            if (done) return; done = true;
            el.style.display = 'none'; el.onclick = null; deco.innerHTML = '';
            if (typeof onDone === 'function') { try { onDone(); } catch (e) {} }
        };
        el.onclick = close;
        clearTimeout(friT);
        friT = setTimeout(close, 12000);
    }

    /* ---------- inklapbare blokken (prototype-chevrons) ---------- */
    function toggleCollapse(bodyId, chevId) {
        var body = document.getElementById(bodyId);
        if (!body) return;
        var open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        if (!open) {
            body.style.animation = 'none'; void body.offsetWidth;
            body.style.animation = 'mbUp 0.3s cubic-bezier(0.22, 1, 0.36, 1)';
        }
        var chev = chevId ? document.getElementById(chevId) : null;
        if (chev) chev.textContent = open ? '▾' : '▴';
    }

    /* ---------- login-wipe ---------- */
    function greet() {
        var h = new Date().getHours();
        var name = '';
        try { name = (window.app && app.currentUser && app.currentUser.name) ? app.currentUser.name.split(' ')[0] : ''; } catch (e) {}
        var g = h < 12 ? 'Goeiemorgen' : (h < 18 ? 'Goeiemiddag' : 'Goeieavond');
        return name ? (g + ', ' + name) : g;
    }
    function playWipe(midCb) {
        var el = document.getElementById('mbWipe');
        document.getElementById('mbWipeHi').textContent = greet();
        document.getElementById('mbWipeSub').textContent = dutchDate(new Date());
        el.style.display = 'none'; void el.offsetWidth;
        el.style.display = 'flex';
        setTimeout(function () { if (midCb) midCb(); }, 480);
        setTimeout(function () { el.style.display = 'none'; }, 1520);
    }

    /* ---------- schermovergang (mbIn her-triggeren) ---------- */
    function animateScreen(screenId) {
        var scr = document.getElementById(screenId);
        if (!scr) return;
        scr.style.animation = 'none';
        void scr.offsetWidth;
        scr.style.animation = '';
    }

    /* ---------- app-functies wrappen ---------- */
    function patchApp() {
        if (!window.app) return;
        /* navigatie: kop injecteren + overgang + status + tutorial mee laten bewegen */
        if (app.navigate && !app.navigate._mb) {
            var origNav = app.navigate.bind(app);
            app.navigate = function (screenId, pushHistory) {
                origNav(screenId, pushHistory);
                injectHead(screenId);
                animateScreen(screenId);
                syncHeaderStatus();
                if (tut.open && !tut.full && tut.screen !== screenId) tutCloseFn();
                else if (tut.open) setTimeout(tutRender, 300);
            };
            app.navigate._mb = true;
        }
        /* login-succes: Marble-wipe i.p.v. liquid-melt */
        if (app._enterAppWithMelt && !app._enterAppWithMelt._mb) {
            app._enterAppWithMelt = function () {
                var self = this;
                playWipe(function () { self.showApp(); injectHead('screenPlanning'); });
            };
            app._enterAppWithMelt._mb = true;
        }
        /* login: blokkerende Marble-loader tijdens aanmelden */
        if (app.loginSubmitPin && !app.loginSubmitPin._mb) {
            var origLogin = app.loginSubmitPin.bind(app);
            app.loginSubmitPin = function () {
                showLoader('Aanmelden');
                var p = origLogin();
                if (p && p.finally) return p.finally(hideLoader);
                hideLoader();
                return p;
            };
            app.loginSubmitPin._mb = true;
        }
        /* klok-status in de topbar meesturen met elke klok-UI-update */
        if (app.updateClockUI && !app.updateClockUI._mb) {
            var origClock = app.updateClockUI.bind(app);
            app.updateClockUI = function () {
                origClock();
                syncHeaderStatus();
            };
            app.updateClockUI._mb = true;
        }
        /* showApp (sessieherstel zonder login-flow): kop op planning zetten */
        if (app.showApp && !app.showApp._mb) {
            var origShow = app.showApp.bind(app);
            app.showApp = function () {
                origShow();
                injectHead('screenPlanning');
                syncHeaderStatus();
            };
            app.showApp._mb = true;
        }
        /* v269: de OUDE celebratie-laag (qe-celebrations.js) wordt hier
           doorverwezen naar de Marble-overlays. clock.js roept bij een
           uitklok QECeleb.clockOut rechtstreeks aan (vóór showScanResult),
           dus zonder deze wrap bleef de oude uitklok-animatie draaien. */
        if (window.QECeleb) {
            if (QECeleb.clockOut && !QECeleb.clockOut._mb) {
                QECeleb.clockOut = function (opts) {
                    opts = opts || {};
                    var sub = 'Uitgeklokt — ' + (opts.timeText || '') +
                        (opts.hoursText ? ' · ' + opts.hoursText : '');
                    if (opts.weekend) friday(sub, opts.onDone);
                    else daySummary(sub, opts.onDone);
                };
                QECeleb.clockOut._mb = true;
            }
            if (QECeleb.paymentSuccess && !QECeleb.paymentSuccess._mb) {
                QECeleb.paymentSuccess = function (opts) {
                    opts = opts || {};
                    var sub = (opts.amountText ? opts.amountText + ' — ' : '') +
                        'automatisch geboekt in Robaws' +
                        (opts.methodLabel ? ' · ' + opts.methodLabel : '');
                    flash('Betaald', sub, 2600, opts.onDone);
                };
                QECeleb.paymentSuccess._mb = true;
            }
        }
        /* scan-resultaten: succes → Marble-overlays (prototype), fout → het
           bestaande rode kaartje (met details + langere duur). Uitklokken
           krijgt het dagoverzicht, op vrijdagmiddag het weekend-scherm. */
        if (app.showScanResult && !app.showScanResult._mb) {
            var origScan = app.showScanResult.bind(app);
            app.showScanResult = function (success, message, onDone, duration) {
                if (!success) return origScan(success, message, onDone, duration);
                var loading = document.getElementById('scanLoading');
                if (loading) { try { loading.remove(); } catch (e) {} }
                var msg = String(message || '');
                var oneLine = msg.replace(/\s*\n\s*/g, ' · ');
                if (/^Uitgeklokt om/i.test(msg)) {
                    if (/weekend/i.test(msg)) friday(oneLine.replace(/\s*·\s*\S*\s*Fijn weekend!?/i, ''), onDone);
                    else daySummary(oneLine, onDone);
                    return;
                }
                var m = msg.match(/^Ingeklokt om\s*(\S+)/i);
                // inklok → clockConfirm-tik (60ms); overige successen → success-patroon
                flash(m ? ('Ingeklokt — ' + m[1]) : 'Gelukt',
                    m ? oneLine.replace(/^Ingeklokt om\s*\S+\s*·?\s*/i, '') : oneLine,
                    duration, onDone, m ? 'clockConfirm' : 'success');
            };
            app.showScanResult._mb = true;
        }
    }

    /* ---------- init ---------- */
    function init() {
        buildOverlays();
        patchApp();
        injectHead(activeScreenId());
        syncHeaderStatus();
        setInterval(syncHeaderStatus, 30000);
        /* datum-regel op planning elke minuut verversen rond middernacht is overkill;
           bij elke navigate wordt hij toch opnieuw gezet. */
    }

    window.QEMarble = {
        init: init,
        tutOpen: tutOpenFn,
        tutClose: tutCloseFn,
        tutNext: tutNextFn,
        tutPrev: tutPrevFn,
        tutGo: function (i) { tut.step = i; tutRender(); },
        startTour: startTourFn,
        showLoader: showLoader,
        hideLoader: hideLoader,
        flash: flash,
        daySummary: daySummary,
        friday: friday,
        haptic: haptic,
        toggleCollapse: toggleCollapse,
        syncHeaderStatus: syncHeaderStatus,
        animateScreen: animateScreen
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
