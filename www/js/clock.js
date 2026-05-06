/**
 * QE Clock v2 — Tijdsregistratie via Robaws
 *
 * Volledig systeem gebaseerd op Robaws time-registrations API.
 * Geen lokale database meer — alles via Robaws + localStorage cache.
 *
 * NFC Tags (3 soorten, beheerd in Robaws extra velden groep "QE Tags"):
 *   - Bureau Tag:           inclocken/uitclocken op kantoor
 *   - Camionet Tags:        inclocken vanuit de wagen (per nummerplaat)
 *   - Bureau Laden & Lossen: aparte tag voor laden/lossen sessies
 *
 * Tijdsregistratie types (Robaws statussen):
 *   - "Op tijd"        eerste scan van de dag, binnen verwachte starttijd
 *   - "Te laat"        eerste scan van de dag, na verwachte starttijd
 *   - "Extra uren"     elke scan NA de eerste in/uit cyclus
 *   - "Laden & Lossen" gestart door de aparte L&L bureau-tag
 *
 * Flow:
 *   1. Scan NFC → identificeer tag (bureau/camionet/L&L)
 *   2. Eerste scan dag → start registratie, bepaal "Op tijd"/"Te laat"
 *   3. GPS locatie ophalen → in opmerkingen van registratie
 *   4. Tweede scan → stop registratie, upload naar Robaws
 *   5. Volgende scans → "Extra uren" registratie
 *   6. L&L tag → "Laden & Lossen" registratie
 *
 * Verwachte starttijd: ALTIJD per werknemer via extra veld "Startuur werknemer"
 * Fallback alleen als veld niet ingevuld: 07:00
 */

window.QEClock = {

    // =============================================
    // CONFIGURATIE
    // =============================================

    /** Fallback starttijd als er ECHT niets te vinden is in Robaws */
    DEFAULT_START_TIME: '07:00',

    /**
     * Verschil (in ms) tussen internet-tijd en lokale klok.
     * _serverOffset = serverTime - localTime
     * Dus gecorrigeerde tijd = new Date(Date.now() + _serverOffset)
     */
    _serverOffset: 0,
    _serverOffsetLoaded: false,

    // =============================================
    // HELPERS
    // =============================================

    /**
     * Haal de echte Brussel-tijd op via internet.
     * Gebruikt WorldTimeAPI als primaire bron, met fallback naar eigen Robaws API
     * response headers. Slaat het verschil (offset) op t.o.v. de lokale klok.
     * Moet minstens 1x aangeroepen worden bij app-start.
     */
    async _loadServerTimeOffset() {
        try {
            const localBefore = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);

            // Primaire bron: WorldTimeAPI (geeft Brussel-tijd direct)
            const res = await fetch('https://worldtimeapi.org/api/timezone/Europe/Brussels', {
                signal: controller.signal,
                cache: 'no-store',
            });
            clearTimeout(timeout);
            const localAfter = Date.now();
            const localMid = (localBefore + localAfter) / 2; // corrigeer voor latency

            if (res.ok) {
                const data = await res.json();
                // data.datetime = "2026-05-05T08:07:00.123456+02:00"
                const serverTime = new Date(data.datetime).getTime();
                this._serverOffset = serverTime - localMid;
                this._serverOffsetLoaded = true;
                console.log('[Clock] Internet-tijd geladen (WorldTimeAPI). Offset:', this._serverOffset, 'ms',
                    '(' + (this._serverOffset > 0 ? '+' : '') + Math.round(this._serverOffset / 1000) + 's)');
                return;
            }
        } catch (e) {
            console.warn('[Clock] WorldTimeAPI niet bereikbaar:', e.message);
        }

        // Fallback: gebruik Robaws API response Date header
        try {
            const localBefore = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch('https://app.robaws.com/api/v2/', {
                method: 'HEAD',
                signal: controller.signal,
                cache: 'no-store',
                headers: RobawsAPI.getHeaders(),
            });
            clearTimeout(timeout);
            const localAfter = Date.now();
            const localMid = (localBefore + localAfter) / 2;

            const dateHeader = res.headers.get('Date');
            if (dateHeader) {
                const serverTime = new Date(dateHeader).getTime();
                this._serverOffset = serverTime - localMid;
                this._serverOffsetLoaded = true;
                console.log('[Clock] Internet-tijd geladen (Robaws header). Offset:', this._serverOffset, 'ms',
                    '(' + (this._serverOffset > 0 ? '+' : '') + Math.round(this._serverOffset / 1000) + 's)');
                return;
            }
        } catch (e) {
            console.warn('[Clock] Robaws Date header niet bereikbaar:', e.message);
        }

        // Geen internet? Offset blijft 0 (= lokale klok)
        console.warn('[Clock] ⚠️ Kon geen internet-tijd ophalen — lokale klok wordt gebruikt');
        this._serverOffsetLoaded = false; // Probeer opnieuw bij volgende scan
    },

    /**
     * Geeft de huidige Brussel-tijd als Date object.
     * Gecorrigeerd met de internet-offset zodat aanpassingen aan de
     * telefoonklok geen effect hebben.
     */
    _now() {
        return new Date(Date.now() + this._serverOffset);
    },

    /**
     * Geeft de huidige Brussel-tijd als Date object (async versie).
     * Laadt eerst de offset als die nog niet geladen is.
     */
    async _getNow() {
        if (!this._serverOffsetLoaded) {
            await this._loadServerTimeOffset();
        }
        return this._now();
    },

    /** Lokale datum als YYYY-MM-DD */
    _localDate(d) {
        const dt = d || this._now();
        return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    },

    /** Lokale tijd als HH:MM */
    _localTime(d) {
        const dt = d || this._now();
        return dt.toTimeString().slice(0, 5);
    },

    /** Bereken uren verschil tussen twee ISO datums */
    _calcHours(startISO, endISO) {
        const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
        return Math.round((ms / 3600000) * 100) / 100; // 2 decimalen
    },

    // =============================================
    // NFC TAG CONFIGURATIE (uit Robaws)
    // =============================================

    /** Gecachte tag configuratie */
    _tagConfig: null,

    /** Haal NFC tags op van Robaws en cache lokaal */
    async loadTagConfig() {
        try {
            const config = await RobawsAPI.getNfcTagConfig();
            this._tagConfig = config;
            // Persoonlijk startuur apart opslaan PER USER
            const currentUser = RobawsAPI.getLoggedInUser();
            const currentUserId = currentUser ? String(currentUser.robawsEmployeeId) : null;
            if (config.startuur && currentUserId) {
                this._personalStartuur = config.startuur;
                this._startuurLoadedForUser = currentUserId;
                localStorage.setItem(`qe_startuur_${currentUserId}`, config.startuur);
                console.log('[Clock] Persoonlijk startuur voor', currentUser.name, ':', config.startuur);
            }
            // Persoonlijke pauze (minuten) opslaan
            if (config.pauze && currentUserId) {
                this._personalPauze = parseInt(config.pauze, 10) || 0;
                localStorage.setItem(`qe_pauze_${currentUserId}`, String(this._personalPauze));
                console.log('[Clock] Persoonlijke pauze voor', currentUser.name, ':', this._personalPauze, 'min');
            }
            localStorage.setItem('qe_nfc_tags', JSON.stringify(config));
            console.log('[Clock] NFC tags geladen:', JSON.stringify(config));
            return config;
        } catch (e) {
            console.warn('[Clock] Kon NFC tags niet ophalen:', e.message);
            // Gebruik cache (BUG-fix: JSON.parse zonder try crashte clock-flow)
            try {
                const cached = localStorage.getItem('qe_nfc_tags');
                if (cached) {
                    this._tagConfig = JSON.parse(cached);
                    return this._tagConfig;
                }
            } catch(_) {
                console.warn('[Clock] NFC tags cache corrupt — wissen');
                try { localStorage.removeItem('qe_nfc_tags'); } catch(__) {}
            }
            return null;
        }
    },

    /** Haal gecachte tag config op */
    getTagConfig() {
        if (this._tagConfig) return this._tagConfig;
        try {
            const cached = localStorage.getItem('qe_nfc_tags');
            if (cached) {
                this._tagConfig = JSON.parse(cached);
                return this._tagConfig;
            }
        } catch(e) {
            console.warn('[Clock] NFC tags cache corrupt — wissen');
            try { localStorage.removeItem('qe_nfc_tags'); } catch(_) {}
        }
        return null;
    },

    /**
     * Identificeer een gescande NFC tag.
     * @returns {Object|null} - { type: 'bureau'|'camionet'|'laden_lossen', name: string } of null
     */
    identifyTag(tagId) {
        const config = this.getTagConfig();
        if (!config) return null;

        // BUG-fix: case-insensitive vergelijking. Android levert tag-id soms
        // in uppercase, Robaws cache kan in lowercase zitten — strict ===
        // gaf onterecht "Onbekende tag".
        const norm = (v) => String(v || '').trim().toLowerCase();
        const target = norm(tagId);

        // Bureau tag
        if (config.bureau && norm(config.bureau.tagId) === target) {
            return { type: 'bureau', name: 'Bureau' };
        }

        // Laden & Lossen tag
        if (config.ladenLossen && norm(config.ladenLossen.tagId) === target) {
            return { type: 'laden_lossen', name: 'Laden & Lossen' };
        }

        // Camionet tags
        for (const cam of (config.camionetten || [])) {
            if (norm(cam.tagId) === target) {
                return { type: 'camionet', name: cam.name };
            }
        }

        return null; // Onbekende tag
    },

    /** Persoonlijk startuur van de ingelogde werknemer */
    _personalStartuur: null,
    _startuurLoadedForUser: null, // bijhouden voor WELKE user het geladen is

    /** Persoonlijke pauze in minuten (uit Robaws extra veld "Pauze") */
    _personalPauze: null,

    /** Haal verwachte starttijd op voor de ingelogde gebruiker */
    getExpectedStartTime() {
        const user = RobawsAPI.getLoggedInUser();
        const userId = user ? String(user.robawsEmployeeId) : null;

        // Alleen gebruiken als het voor de HUIDIGE user geladen is
        if (this._personalStartuur && this._startuurLoadedForUser === userId) {
            return this._personalStartuur;
        }

        // Probeer uit localStorage voor deze specifieke user
        if (userId) {
            const cached = localStorage.getItem(`qe_startuur_${userId}`);
            if (cached) {
                this._personalStartuur = cached;
                this._startuurLoadedForUser = userId;
                return cached;
            }
        }

        // Fallback — dit zou eigenlijk nooit bereikt moeten worden
        return this.DEFAULT_START_TIME;
    },

    // =============================================
    // ACTIEVE SESSIE (localStorage)
    // =============================================

    /**
     * Actieve clock sessie voor vandaag.
     * Opgeslagen in localStorage als:
     * {
     *   date: "2026-05-03",
     *   employeeId: "1",
     *   active: true/false,
     *   startTime: "06:45",
     *   startISO: "2026-05-03T04:45:00.000Z",
     *   tagType: "bureau|camionet|laden_lossen",
     *   tagName: "Bureau|2-ABA-191|Laden & Lossen",
     *   registrationType: "Op tijd|Te laat|Extra uren|Laden & Lossen",
     *   robawsId: null|"3",  // Robaws registratie ID na upload
     *   gpsLat: null|51.243,
     *   gpsLng: null|4.525,
     *   completedSessions: [  // eerder voltooide sessies vandaag
     *     { startTime, endTime, type, robawsId, tagName }
     *   ]
     * }
     */
    _getSessionKey() {
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return null;
        return `qe_clock_v2_${this._localDate()}_${user.email}`;
    },

    getSession() {
        const key = this._getSessionKey();
        if (!key) return null;
        const stored = localStorage.getItem(key);
        if (!stored) return null;
        // BUG-fix: JSON.parse zonder try/catch deed hele clock-flow crashen
        // bij corrupte localStorage (bv. partial write na crash).
        let session;
        try {
            session = JSON.parse(stored);
        } catch(e) {
            console.warn('[Clock] sessie corrupt — wissen:', e.message);
            try { localStorage.removeItem(key); } catch(_) {}
            return null;
        }
        // Controleer of het vandaag is
        if (session.date !== this._localDate()) {
            localStorage.removeItem(key);
            return null;
        }
        return session;
    },

    _saveSession(session) {
        const key = this._getSessionKey();
        if (!key) return;
        localStorage.setItem(key, JSON.stringify(session));
    },

    _newSession() {
        const user = RobawsAPI.getLoggedInUser();
        return {
            date: this._localDate(),
            employeeId: user ? String(user.robawsEmployeeId) : null,
            active: false,
            startTime: null,
            startISO: null,
            tagType: null,
            tagName: null,
            registrationType: null,
            robawsId: null,
            gpsLat: null,
            gpsLng: null,
            completedSessions: [],
        };
    },

    /** Is er een actieve (lopende) sessie? */
    isActive() {
        const session = this.getSession();
        return session ? session.active : false;
    },

    /** Is er al minstens 1 voltooide sessie vandaag? */
    hasCompletedToday() {
        const session = this.getSession();
        return session ? (session.completedSessions || []).length > 0 : false;
    },

    // =============================================
    // NFC SCAN (aangeroepen vanuit Java/MainActivity)
    // =============================================

    _scanLock: false,

    /**
     * Pluk de échte foutboodschap uit een Robaws response, ongeacht de shape.
     */
    _extractRobawsError(result) {
        if (!result) return 'onbekende fout';
        const code = result.code != null ? result.code : '?';
        const d = result.data;
        if (d == null) return 'code ' + code;
        if (typeof d === 'string') {
            const t = d.trim();
            return t ? 'code ' + code + ': ' + t.slice(0, 200) : 'code ' + code;
        }
        if (typeof d !== 'object') return 'code ' + code + ': ' + String(d);
        const direct = d.message || d.error || d.detail || d.title || d.reason || d.errorMessage;
        if (direct && typeof direct === 'string') return code + ': ' + direct;
        if (Array.isArray(d.errors) && d.errors.length) {
            const parts = d.errors.map(e => {
                if (!e) return '';
                if (typeof e === 'string') return e;
                return e.message || e.error || e.detail || e.field || JSON.stringify(e);
            }).filter(Boolean);
            if (parts.length) return code + ': ' + parts.join('; ').slice(0, 250);
        }
        if (d.errors && typeof d.errors === 'object') {
            const parts = [];
            for (const [field, val] of Object.entries(d.errors)) {
                if (Array.isArray(val)) parts.push(field + ': ' + val.join(', '));
                else if (val) parts.push(field + ': ' + val);
            }
            if (parts.length) return code + ': ' + parts.join('; ').slice(0, 250);
        }
        try { const j = JSON.stringify(d); if (j && j !== '{}') return code + ': ' + j.slice(0, 200); } catch(_) {}
        return 'code ' + code;
    },

    async onNfcScan(tagId) {
        // BUG-fix: tagId normaliseren (lowercase + trim) zodat hex-casing
        // verschillen tussen Android en Robaws-cache geen mismatch geven.
        const normalizedTagId = String(tagId || '').trim().toLowerCase();
        if (!normalizedTagId) return;
        console.log('[Clock] NFC scan:', normalizedTagId);

        // ── SCREEN-GUARD: alleen scannen wanneer gebruiker op het Klok-scherm
        // staat. Voorkomt onbedoelde inclock terwijl iemand een werkbon invult.
        // Toewijzingsmodus is een uitzondering — die mag overal werken.
        const onClockScreen = window.app && window.app.currentScreen === 'screenClock';
        if (!onClockScreen && !this._pendingAssignment) {
            if (window.app) {
                app.toast('Open eerst het Klok-scherm om te scannen');
                try { app.navigate('screenClock'); } catch(_) {}
            }
            return;
        }

        // Debounce: voorkom dubbele scans binnen 3 seconden.
        // BUG-fix: vroeger werd de lock alleen via setTimeout vrijgegeven —
        // bij langzame Robaws-call kon een tweede scan starten terwijl de
        // eerste flow nog liep. Nu wikkelen we alles in try/finally en
        // geven de lock pas vrij na afronding (met max 8s safety-timeout).
        if (this._scanLock) {
            console.log('[Clock] Scan genegeerd (debounce)');
            return;
        }
        this._scanLock = true;
        const lockTimeoutId = setTimeout(() => { this._scanLock = false; }, 8000);

        try {
            const user = RobawsAPI.getLoggedInUser();
            if (!user) {
                if (window.app) app.toast('Log eerst in om te clocken');
                return;
            }

            // ── TOEWIJZINGSMODUS: tag wordt toegewezen aan gekozen locatie ──
            if (this._pendingAssignment) {
                await this._handleAssignmentScan(normalizedTagId);
                return;
            }

            // Zorg dat tag config geladen is
            if (!this.getTagConfig()) {
                await this.loadTagConfig();
            }

            // Identificeer de tag (probeer gewone én lowercase variant)
            let tag = this.identifyTag(normalizedTagId);
            if (!tag) tag = this.identifyTag(tagId); // raw fallback
            if (!tag) {
                // Tag-config nog niet zichtbaar? Forceer 1 reload + retry
                await this.loadTagConfig();
                tag = this.identifyTag(normalizedTagId) || this.identifyTag(tagId);
            }

            if (!tag) {
                if (window.app) app.toast('Onbekende NFC tag — wijs deze eerst toe via Tag beheer', true);
                return;
            }

            // Haal of maak sessie — controleer dat employeeId klopt met ingelogde user
            let session = this.getSession() || this._newSession();
            if (session.employeeId && String(session.employeeId) !== String(user.robawsEmployeeId)) {
                console.warn('[Clock] Sessie van andere werknemer gevonden, nieuwe sessie aanmaken');
                session = this._newSession();
            }

            // Resultaat van scan-flow voor SUCCES/MISLUKT overlay
            let scanResult = null;

            try {
                // ── LADEN & LOSSEN ──
                if (tag.type === 'laden_lossen') {
                    scanResult = await this._handleLadenLossen(session, tag);
                    return;
                }

                // ── ACTIEVE SESSIE → UITCLOCKEN ──
                if (session.active) {
                    const userName = user.name || user.email;
                    const startTime = session.startTime || '?';
                    const confirmed = confirm(`${userName} uitklokken?\n\nIngeklokt om ${startTime}\nWil je nu uitklokken?`);
                    if (!confirmed) {
                        console.log('[Clock] Uitklokken geannuleerd door gebruiker');
                        return;
                    }
                    scanResult = await this._clockOut(session, tag);
                    return;
                }

                // ── GEEN ACTIEVE SESSIE → INCLOCKEN ──
                scanResult = await this._clockIn(session, tag);
            } finally {
                // Toon SUCCES/MISLUKT overlay als de scan-flow iets opleverde
                if (scanResult && window.app && typeof app.showScanResult === 'function') {
                    const refresh = !!scanResult.refresh;
                    app.showScanResult(scanResult.ok, scanResult.message, async () => {
                        if (!refresh) return;
                        try { await this.syncWithRobaws(); } catch(_) {}
                        try { app.updateClockUI(); } catch(_) {}
                        try { if (app.currentScreen === 'screenClock') app.navigate('screenClock'); } catch(_) {}
                    });
                }
            }
        } finally {
            // Lock altijd vrijgeven, ook bij errors
            clearTimeout(lockTimeoutId);
            this._scanLock = false;
        }
    },

    // =============================================
    // INCLOCKEN
    // =============================================

    async _clockIn(session, tag) {
        const now = await this._getNow();
        const time = this._localTime(now);
        const isFirstOfDay = (session.completedSessions || []).length === 0;

        // Bepaal type
        let type;
        if (!isFirstOfDay) {
            type = 'Extra uren';
        } else {
            // ALTIJD startuur ophalen van Robaws voor de huidige user bij eerste scan van de dag
            const clockUser = RobawsAPI.getLoggedInUser();
            const clockUserId = clockUser ? String(clockUser.robawsEmployeeId) : null;
            if (clockUserId && this._startuurLoadedForUser !== clockUserId) {
                try {
                    const myRes = await RobawsAPI.get(`employees/${clockUserId}`);
                    if (myRes.code === 200 && myRes.data && myRes.data.extraFields) {
                        for (const [name, data] of Object.entries(myRes.data.extraFields)) {
                            if (name.toLowerCase().includes('startuur')) {
                                const val = data ? String(data.stringValue ?? data.value ?? '') : '';
                                if (val) {
                                    this._personalStartuur = val;
                                    this._startuurLoadedForUser = clockUserId;
                                    localStorage.setItem(`qe_startuur_${clockUserId}`, val);
                                    console.log('[Clock] Startuur opgehaald voor', clockUser.name, ':', val);
                                }
                                break;
                            }
                        }
                    }
                } catch(e) {
                    console.warn('[Clock] Kon startuur niet ophalen:', e.message);
                }
            }
            const expectedStart = this.getExpectedStartTime();
            // BUG-fix: vroeger werd HH:MM als string vergeleken — "7:00" > "09:00"
            // gaf true (lex-vergelijking op '7' vs '0'). Nu numerieke vergelijking
            // in minuten met een grace-period van 5 min, zodat 07:00:30 niet
            // direct als "te laat" telt.
            const toMinutes = (hhmm) => {
                if (!hhmm) return 0;
                const m = String(hhmm).match(/^(\d{1,2}):(\d{1,2})/);
                if (!m) return 0;
                return (parseInt(m[1], 10) || 0) * 60 + (parseInt(m[2], 10) || 0);
            };
            const GRACE_MIN = 5;
            const isLate = toMinutes(time) > toMinutes(expectedStart) + GRACE_MIN;
            console.log('[Clock] Startuur check:', time, 'vs verwacht:', expectedStart, '(grace ' + GRACE_MIN + 'min) →', isLate ? 'TE LAAT' : 'OP TIJD');
            type = isLate ? 'Te laat' : 'Op tijd';
        }

        // GPS ophalen
        let gpsLat = null, gpsLng = null, gpsText = '';
        try {
            const pos = await this._getGPS();
            gpsLat = pos.latitude;
            gpsLng = pos.longitude;
            gpsText = `https://maps.google.com/?q=${gpsLat.toFixed(6)},${gpsLng.toFixed(6)}`;
        } catch (e) {
            console.warn('[Clock] GPS niet beschikbaar:', e.message);
            gpsText = 'GPS niet beschikbaar';
        }

        // Opmerkingen opbouwen
        const remarks = `${tag.name} — ${gpsText} — ${time}`;

        // Sessie bijwerken
        session.active = true;
        session.startTime = time;
        session.startISO = now.toISOString();
        session.tagType = tag.type;
        session.tagName = tag.name;
        session.registrationType = type;
        session.robawsId = null;
        session.gpsLat = gpsLat;
        session.gpsLng = gpsLng;
        session.pendingRemarks = remarks;
        this._saveSession(session);

        // Upload naar Robaws — gebruik ALTIJD de huidige user, niet de sessie
        const currentUser = RobawsAPI.getLoggedInUser();
        const empId = currentUser ? String(currentUser.robawsEmployeeId) : session.employeeId;
        session.employeeId = empId; // zorg dat sessie altijd juiste ID heeft
        this._saveSession(session);

        try {
            const result = await RobawsAPI.createTimeRegistration({
                employeeId: empId,
                startDate: session.startISO,
                type: type,
                remarks: remarks,
            });
            if (result.code === 200 || result.code === 201) {
                session.robawsId = result.data ? String(result.data.id) : null;
                this._saveSession(session);
                console.log('[Clock] Registratie aangemaakt in Robaws, ID:', session.robawsId);
            } else {
                console.warn('[Clock] Robaws registratie aanmaken mislukt:', result.code);
                // BUG-fix: niet-2xx response → wel pending-sync zetten zodat
                // de sessie niet stilzwijgend in Robaws ontbreekt.
                this._addPendingSync({
                    action: 'create_open',
                    employeeId: empId,
                    startISO: session.startISO,
                    type: type,
                    remarks: remarks,
                    sessionStartedAt: session.startedAt,
                });
            }
        } catch (e) {
            console.warn('[Clock] Robaws niet bereikbaar bij inclocken:', e.message);
            // BUG-fix: vroeger werd er bij offline-fout helemaal NIETS in
            // de pending-sync queue gezet → de hele inclock-sessie verdween
            // en bereikte Robaws nooit. Nu queue-en we hem zodat syncPending()
            // hem later kan aanmaken.
            try {
                this._addPendingSync({
                    action: 'create_open',
                    employeeId: empId,
                    startISO: session.startISO,
                    type: type,
                    remarks: remarks,
                    sessionStartedAt: session.startedAt,
                });
            } catch(_) {}
        }

        // Resultaat voor SUCCES/MISLUKT overlay (onNfcScan toont hem)
        // Belangrijk: we tracken niet de exacte Robaws-status hier — bij
        // een Robaws-fout zou de fetch een fout gooien die in de catch
        // hierboven afgehandeld wordt. Voor de overlay nemen we aan dat
        // de scan zelf werkte (sessie is opgeslagen, registratie is in
        // Robaws of de pending queue).
        const lateMsg = type === 'Te laat' ? ' (te laat!)' : '';
        const message = 'Ingeklokt om ' + time + ' — ' + tag.name + lateMsg;
        return { ok: true, message, refresh: true };
    },

    // =============================================
    // UITCLOCKEN
    // =============================================

    async _clockOut(session, tag) {
        const now = await this._getNow();
        const endTime = this._localTime(now);
        const endISO = now.toISOString();
        const rawHours = this._calcHours(session.startISO, endISO);

        // Pauze aftrekken: dynamisch uit Robaws extra veld "Pauze" (in minuten)
        // Alleen bij normale registraties (niet bij Laden & Lossen of Extra uren)
        let pauseHours = 0;
        const isNormalShift = session.registrationType === 'Op tijd' || session.registrationType === 'Te laat';
        if (isNormalShift) {
            // Haal pauze op: eerst uit geladen config, dan localStorage cache
            let pauseMinutes = this._personalPauze;
            if (!pauseMinutes && pauseMinutes !== 0) {
                const user = RobawsAPI.getLoggedInUser();
                const userId = user ? String(user.robawsEmployeeId) : null;
                if (userId) {
                    const cached = localStorage.getItem(`qe_pauze_${userId}`);
                    if (cached) pauseMinutes = parseInt(cached, 10);
                }
            }
            // Fallback: 45 minuten als er geen waarde is
            if (!pauseMinutes && pauseMinutes !== 0) pauseMinutes = 45;
            pauseHours = pauseMinutes / 60;
        }
        const hours = Math.max(0, Math.round((rawHours - pauseHours) * 100) / 100);
        console.log('[Clock] Uren berekend:', rawHours, '- pauze', pauseHours, '=', hours);

        // Sessie afronden
        session.active = false;
        const completedEntry = {
            startTime: session.startTime,
            endTime: endTime,
            type: session.registrationType,
            robawsId: session.robawsId,
            tagName: session.tagName,
            hours: hours,
        };
        session.completedSessions = session.completedSessions || [];
        session.completedSessions.push(completedEntry);
        this._saveSession(session);

        // Update in Robaws (endDate + hours + breakDuration toevoegen)
        const breakMinutes = Math.round(pauseHours * 60);
        if (session.robawsId) {
            // SECURITY: pre-flight ownership-check — voorkomt dat we per
            // ongeluk andermans registratie afsluiten als de lokale sessie
            // ooit een verkeerde robawsId heeft opgevangen.
            try {
                const me = RobawsAPI.getLoggedInUser();
                const existing = await RobawsAPI.get(`time-registrations/${session.robawsId}`);
                const ownerId = existing.data && (existing.data.employeeId
                    || (existing.data.employee && existing.data.employee.id));
                if (me && ownerId && String(ownerId) !== String(me.robawsEmployeeId)) {
                    console.error('[Clock] Sessie verwees naar andermans registratie',
                        session.robawsId, '— sessie wordt gewist');
                    const sessionKey = this._getSessionKey();
                    if (sessionKey) localStorage.removeItem(sessionKey);
                    if (window.app) {
                        app.toast('Deze registratie hoort bij iemand anders — sessie gereset', true);
                    }
                    return {
                        ok: false,
                        message: 'Deze registratie hoort bij iemand anders\n(werknemer ' + ownerId + '). Sessie is gereset — scan opnieuw om correct in te klokken.',
                        refresh: true,
                    };
                }
            } catch(e) {
                console.warn('[Clock] Pre-flight ownership-check mislukt:', e.message);
            }
            try {
                const updateData = {
                    endDate: endISO,
                    hours: hours,
                };
                if (breakMinutes > 0) updateData.breakDuration = breakMinutes;
                await RobawsAPI.updateTimeRegistration(session.robawsId, updateData);
                console.log('[Clock] Registratie afgesloten in Robaws:', session.robawsId);
            } catch (e) {
                console.warn('[Clock] Robaws update mislukt:', e.message);
                // Sla op als pending sync
                this._addPendingSync({
                    action: 'update',
                    id: session.robawsId,
                    endDate: endISO,
                    hours: hours,
                    breakDuration: breakMinutes,
                });
            }
        } else {
            // Was nooit geüpload → sla volledige registratie op als pending
            this._addPendingSync({
                action: 'create_complete',
                employeeId: session.employeeId,
                startDate: session.startISO,
                endDate: endISO,
                hours: hours,
                type: session.registrationType,
                remarks: session.pendingRemarks || '',
            });
        }

        const pauseMin = Math.round(pauseHours * 60);
        const pauseText = pauseMin > 0 ? ' (' + pauseMin + 'min pauze)' : '';
        return {
            ok: true,
            message: 'Uitgeklokt om ' + endTime + ' — ' + hours + 'u gewerkt' + pauseText,
            refresh: true,
        };
    },

    // =============================================
    // LADEN & LOSSEN
    // =============================================

    async _handleLadenLossen(session, tag) {
        // Check of er al een actieve L&L sessie loopt
        if (session.active && session.registrationType === 'Laden & Lossen') {
            // Stop de L&L sessie
            await this._clockOut(session, tag);
            return;
        }

        // Start nieuwe L&L sessie
        const now = await this._getNow();
        const time = this._localTime(now);

        // GPS
        let gpsLat = null, gpsLng = null, gpsText = '';
        try {
            const pos = await this._getGPS();
            gpsLat = pos.latitude;
            gpsLng = pos.longitude;
            gpsText = `https://maps.google.com/?q=${gpsLat.toFixed(6)},${gpsLng.toFixed(6)}`;
        } catch (e) {
            gpsText = 'GPS niet beschikbaar';
        }

        const remarks = `Laden & Lossen — ${gpsText} — ${time}`;

        // Als er een andere actieve sessie loopt, sluit die eerst
        if (session.active) {
            await this._clockOut(session, tag);
            session = this.getSession() || this._newSession();
        }

        // Start L&L sessie
        session.active = true;
        session.startTime = time;
        session.startISO = now.toISOString();
        session.tagType = 'laden_lossen';
        session.tagName = 'Laden & Lossen';
        session.registrationType = 'Laden & Lossen';
        session.robawsId = null;
        session.gpsLat = gpsLat;
        session.gpsLng = gpsLng;
        session.pendingRemarks = remarks;
        this._saveSession(session);

        // Upload naar Robaws
        try {
            const result = await RobawsAPI.createTimeRegistration({
                employeeId: session.employeeId,
                startDate: session.startISO,
                type: 'Laden & Lossen',
                remarks: remarks,
            });
            if (result.code === 200 || result.code === 201) {
                session.robawsId = result.data ? String(result.data.id) : null;
                this._saveSession(session);
            }
        } catch (e) {
            console.warn('[Clock] Robaws L&L registratie mislukt:', e.message);
        }

        return {
            ok: true,
            message: 'Laden & Lossen gestart om ' + time,
            refresh: true,
        };
    },

    // =============================================
    // GPS
    // =============================================

    _getGPS() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation niet beschikbaar'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                err => reject(err),
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
            );
        });
    },

    // =============================================
    // TAG TOEWIJZEN: eerst locatie kiezen, dan scannen
    // =============================================

    /** Wachtende toewijzing: { fieldName, locationName } of null */
    _pendingAssignment: null,

    /** Start toewijzingsmodus: fullscreen scan-overlay */
    startTagAssignment(fieldName, locationName) {
        this._pendingAssignment = { fieldName, locationName };

        // Maak fullscreen overlay
        const overlay = document.createElement('div');
        overlay.id = 'nfcScanOverlay';
        overlay.className = 'nfc-scan-overlay';
        overlay.innerHTML = `
            <div class="nfc-location-badge">${locationName}</div>
            <div class="nfc-icon-wrap">
                <div class="nfc-ripple"></div>
                <div class="nfc-ripple"></div>
                <div class="nfc-ripple"></div>
                <div class="nfc-icon">📱</div>
            </div>
            <h3>Wacht op NFC scan...</h3>
            <p>Houd de NFC tag tegen de achterkant van je telefoon</p>
            <button class="nfc-cancel-btn" onclick="QEClock.cancelTagAssignment()">Annuleren</button>
        `;
        document.body.appendChild(overlay);
    },

    /** Annuleer de wachtende toewijzing */
    cancelTagAssignment() {
        this._pendingAssignment = null;
        this._removeNfcOverlay();
    },

    /** Verwijder de scan overlay */
    _removeNfcOverlay() {
        const overlay = document.getElementById('nfcScanOverlay');
        if (overlay) overlay.remove();
    },

    /** Toon succes-overlay (kort) en ruim dan op */
    _showAssignmentSuccess(locationName) {
        const overlay = document.getElementById('nfcScanOverlay');
        if (overlay) {
            overlay.className = 'nfc-scan-overlay nfc-success';
            overlay.innerHTML = `
                <div class="nfc-success-icon">✅</div>
                <h3 style="margin-top:16px">Tag toegewezen!</h3>
                <p>${locationName}</p>
            `;
            setTimeout(() => {
                this._removeNfcOverlay();
                if (window.app && app.currentScreen === 'screenClock') app.onNavigateToClock();
            }, 1500);
        }
    },

    /** Toon fout in de overlay */
    _showAssignmentError(message) {
        const overlay = document.getElementById('nfcScanOverlay');
        if (overlay) {
            overlay.style.background = 'rgba(198,40,40,0.9)';
            overlay.innerHTML = `
                <div style="font-size:72px;margin-bottom:16px">❌</div>
                <h3>Toewijzing mislukt</h3>
                <p>${message}</p>
                <button class="nfc-cancel-btn" onclick="QEClock._removeNfcOverlay()" style="margin-top:20px">Sluiten</button>
            `;
        }
    },

    /** Verwerk een scan terwijl er een toewijzing wacht */
    async _handleAssignmentScan(tagId) {
        const assignment = this._pendingAssignment;
        this._pendingAssignment = null;

        // Toon "bezig" status in overlay
        const overlay = document.getElementById('nfcScanOverlay');
        if (overlay) {
            overlay.innerHTML = `
                <div class="spinner" style="border-top-color:#fff;width:48px;height:48px;border-width:4px;margin-bottom:20px"></div>
                <h3>Tag opslaan...</h3>
                <p>${assignment.locationName}</p>
            `;
        }

        try {
            await RobawsAPI.saveNfcTagId(assignment.fieldName, tagId);
            await this.loadTagConfig();
            this._showAssignmentSuccess(assignment.locationName);
        } catch (e) {
            this._showAssignmentError(e.message);
        }
    },

    // =============================================
    // OFFLINE SYNC
    // =============================================

    _pendingSyncKey() {
        const user = RobawsAPI.getLoggedInUser();
        if (!user || !user.email) return null;
        return `qe_clock_pending_${user.email}`;
    },

    _readPendingSync() {
        const key = this._pendingSyncKey();
        if (!key) return { key: null, items: [] };
        let items = [];
        try {
            const raw = localStorage.getItem(key);
            if (raw) items = JSON.parse(raw);
            if (!Array.isArray(items)) items = [];
        } catch(e) { items = []; }
        return { key, items };
    },

    _addPendingSync(item) {
        // BUG-fix: parse zonder try/catch crashte bij corrupte storage.
        // SECURITY: queue is per-user en heeft ownerEmployeeId zodat user B
        // nooit user A's pending acties uitvoert.
        const { key, items } = this._readPendingSync();
        if (!key) return;
        const user = RobawsAPI.getLoggedInUser();
        const myId = user ? String(user.robawsEmployeeId) : null;
        const safe = { ...item, ownerEmployeeId: myId, employeeId: myId, timestamp: this._now().toISOString() };
        items.push(safe);
        try { localStorage.setItem(key, JSON.stringify(items)); } catch(e) {
            console.warn('[Clock] localStorage vol bij pending-sync:', e.message);
        }
    },

    async syncPending() {
        const { key, items: pending } = this._readPendingSync();
        if (!key || pending.length === 0) return;

        const user = RobawsAPI.getLoggedInUser();
        const myId = user ? String(user.robawsEmployeeId) : null;
        // SECURITY: alleen items van DEZE user verwerken — legacy items
        // zonder ownerEmployeeId droppen (zouden van andere user kunnen zijn)
        const myItems = pending.filter(it => it.ownerEmployeeId && String(it.ownerEmployeeId) === myId);
        if (myItems.length === 0) {
            try { localStorage.setItem(key, JSON.stringify([])); } catch(_) {}
            return;
        }
        // Hergebruik 'pending' als myItems voor de loop hieronder
        pending.length = 0;
        pending.push(...myItems);
        if (pending.length === 0) return;

        console.log('[Clock] Syncing', pending.length, 'pending items');
        const remaining = [];

        for (const item of pending) {
            try {
                if (item.action === 'update' && item.id) {
                    await RobawsAPI.updateTimeRegistration(item.id, {
                        endDate: item.endDate,
                        hours: item.hours,
                    });
                    console.log('[Clock] Pending update gesynchroniseerd:', item.id);
                } else if (item.action === 'create_complete') {
                    await RobawsAPI.createTimeRegistration({
                        employeeId: item.employeeId,
                        startDate: item.startDate,
                        endDate: item.endDate,
                        hours: item.hours,
                        type: item.type,
                        remarks: item.remarks,
                    });
                    console.log('[Clock] Pending registratie gesynchroniseerd');
                } else if (item.action === 'create_open') {
                    // Open registratie zonder endDate — werknemer was offline
                    // tijdens inclock. Maak hem nu alsnog aan en update lokale
                    // sessie met de Robaws-id zodat clock-out hem kan vinden.
                    const result = await RobawsAPI.createTimeRegistration({
                        employeeId: item.employeeId,
                        startDate: item.startISO,
                        type: item.type,
                        remarks: item.remarks,
                    });
                    if (result && (result.code === 200 || result.code === 201) && result.data) {
                        const newId = String(result.data.id);
                        // Probeer de bijbehorende lokale sessie te vinden en updaten
                        const session = this.getSession();
                        if (session && session.startISO === item.startISO && !session.robawsId) {
                            session.robawsId = newId;
                            this._saveSession(session);
                        }
                        console.log('[Clock] Pending open-registratie gesynchroniseerd, ID:', newId);
                    } else {
                        throw new Error('Robaws gaf code ' + (result && result.code));
                    }
                }
            } catch (e) {
                console.warn('[Clock] Sync mislukt voor item:', e.message);
                remaining.push(item);
            }
        }

        try { localStorage.setItem(key, JSON.stringify(remaining)); } catch(e) {}
        if (remaining.length === 0) {
            console.log('[Clock] Alle pending items gesynchroniseerd ✓');
        } else {
            console.warn('[Clock] Nog', remaining.length, 'items niet gesynchroniseerd');
        }
    },

    // =============================================
    // GESCHIEDENIS (Robaws)
    // =============================================

    /** Haal tijdsregistraties op voor de afgelopen X dagen */
    async getHistory(days = 7) {
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return [];

        try {
            const res = await RobawsAPI.get(`time-registrations?employeeId=${user.robawsEmployeeId}&limit=100`);
            if (res.code !== 200 || !res.data || !res.data.items) return [];

            // Filter op laatste X dagen + dubbele check employeeId
            const cutoff = this._now();
            cutoff.setDate(cutoff.getDate() - days);
            const cutoffStr = cutoff.toISOString();
            const empId = String(user.robawsEmployeeId);

            return res.data.items
                .filter(item => {
                    if (!(item.startDate >= cutoffStr)) return false;
                    // SECURITY-fix: strikt employeeId match
                    const itemEmpId = item.employeeId || (item.employee && item.employee.id);
                    if (!itemEmpId) return false;
                    return String(itemEmpId) === empId;
                })
                .sort((a, b) => b.startDate.localeCompare(a.startDate));
        } catch (e) {
            console.warn('[Clock] Kon geschiedenis niet ophalen:', e.message);
            return [];
        }
    },

    // =============================================
    // SYNC LOKALE SESSIE MET ROBAWS
    // =============================================

    /**
     * Synchroniseer de lokale sessie met de werkelijke Robaws data.
     * Als registraties in Robaws verwijderd zijn, worden ze ook lokaal verwijderd.
     * Wordt aangeroepen bij het openen van het klokscherm.
     */
    async syncWithRobaws() {
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return;

        // BUG-fix: vroeger werd bij een mislukte Robaws-fetch (timeout, 5xx,
        // pagination-glitch) de lokale sessie GEWIST omdat getTimeRegistrations
        // stilletjes [] terugaf. Volgende NFC scan dacht "niets ingeklokt" en
        // maakte een 2e Robaws registratie aan → dubbele registraties.
        // Fix: getTimeRegistrations gooit nu een fout bij niet-200 responses,
        // wat hier door de catch wordt opgevangen. Alleen bij een SUCCESVOLLE
        // fetch met écht 0 items wordt de lokale sessie gewist.
        let robawsRegs;
        try {
            const today = this._localDate();
            robawsRegs = await RobawsAPI.getTimeRegistrations(user.robawsEmployeeId, today);
            console.log('[Clock] Robaws sync: gevonden', robawsRegs.length, 'registraties voor vandaag');
        } catch (e) {
            console.warn('[Clock] Robaws sync mislukt — lokale sessie BEHOUDEN:', e.message);
            return;
        }

        try {
            // SECURITY: extra paranoid check — drop registraties die niet
            // aan de ingelogde werknemer toebehoren. Laatste verdedigingslinie.
            const myEmpId = String(user.robawsEmployeeId);
            robawsRegs = robawsRegs.filter(r => {
                const empId = r.employeeId || (r.employee && r.employee.id);
                if (!empId) return false;
                if (String(empId) !== myEmpId) {
                    console.warn('[Clock] Registratie van andere werknemer genegeerd in sync:', r.id);
                    return false;
                }
                return true;
            });

            // Geen registraties in Robaws? Wis de lokale sessie volledig
            // (alleen na bevestigde succesvolle fetch — zie boven)
            if (robawsRegs.length === 0) {
                const session = this.getSession();
                if (session && (session.active || (session.completedSessions || []).length > 0)) {
                    console.log('[Clock] Robaws heeft geen registraties — lokale sessie gewist');
                    const key = this._getSessionKey();
                    if (key) localStorage.removeItem(key);
                }
                return;
            }

            // ── SESSIE VOLLEDIG HERBOUWEN vanuit Robaws ──
            // Robaws is de enige bron van waarheid. Lokale waarden worden
            // altijd overschreven met wat Robaws teruggeeft.
            let session = this.getSession() || this._newSession();

            // 1. Herbouw completedSessions (afgesloten registraties)
            const completedFromRobaws = robawsRegs
                .filter(r => r.endDate)
                .map(r => ({
                    startTime: new Date(r.startDate).toTimeString().slice(0, 5),
                    endTime: new Date(r.endDate).toTimeString().slice(0, 5),
                    type: r.type || 'Op tijd',
                    robawsId: String(r.id),
                    tagName: (r.remarks || '').split(' — ')[0] || '',
                    hours: r.hours || this._calcHours(r.startDate, r.endDate),
                }));
            session.completedSessions = completedFromRobaws;

            // 2. Open registratie (zonder endDate) = actieve sessie
            const openReg = robawsRegs.find(r => !r.endDate);
            if (openReg) {
                const robawsStart = new Date(openReg.startDate).toTimeString().slice(0, 5);
                const robawsType = openReg.type || 'Op tijd';
                const robawsId = String(openReg.id);
                // ALTIJD updaten vanuit Robaws — ook als de sessie al actief was
                if (session.startTime !== robawsStart || session.registrationType !== robawsType || String(session.robawsId) !== robawsId) {
                    console.log('[Clock] Sessie bijgewerkt vanuit Robaws:', session.startTime, '->', robawsStart, session.registrationType, '->', robawsType);
                }
                session.active = true;
                session.robawsId = robawsId;
                session.startTime = robawsStart;
                session.startISO = openReg.startDate;
                session.registrationType = robawsType;
                // tagName alleen updaten als er remarks zijn (anders behouden we lokale waarde)
                if (openReg.remarks) {
                    session.tagName = (openReg.remarks).split(' — ')[0] || session.tagName;
                }
            } else {
                // Geen open registratie meer → sessie niet actief
                session.active = false;
                session.robawsId = null;
                // Starttime en type bepalen op basis van eerste registratie
                const firstReg = robawsRegs.find(r => r.type === 'Op tijd' || r.type === 'Te laat');
                if (firstReg) {
                    session.registrationType = firstReg.type;
                } else if (completedFromRobaws.length > 0) {
                    session.registrationType = completedFromRobaws[0].type;
                }
                const earliest = robawsRegs.reduce((a, b) => a.startDate < b.startDate ? a : b);
                session.startTime = new Date(earliest.startDate).toTimeString().slice(0, 5);
            }

            this._saveSession(session);
            console.log('[Clock] Lokale sessie gesynchroniseerd met Robaws:', JSON.stringify({
                active: session.active,
                startTime: session.startTime,
                type: session.registrationType,
                robawsId: session.robawsId
            }));
        } catch (e) {
            console.warn('[Clock] Robaws sync mislukt:', e.message);
            // Bij fout: gewoon doorgaan met lokale data
        }
    },

    // =============================================
    // ADMIN: ALLE WERKNEMERS VANDAAG (Robaws)
    // =============================================

    async getAllAttendanceToday() {
        // SECURITY: defense-in-depth — alleen kantoor-rol mag het overzicht
        const me = RobawsAPI.getLoggedInUser();
        if (!me || me.role !== 'bureel') {
            console.warn('[Clock] getAllAttendanceToday geweigerd: rol =', me && me.role);
            return [];
        }
        try {
            const allRegs = await RobawsAPI.getAllTimeRegistrationsToday();

            // Groepeer per werknemer
            const byEmployee = {};
            for (const reg of allRegs) {
                const empId = reg.employeeId;
                if (!byEmployee[empId]) byEmployee[empId] = [];
                byEmployee[empId].push(reg);
            }

            // Haal werknemersnamen op (uit cache of Robaws)
            const result = [];
            for (const [empId, regs] of Object.entries(byEmployee)) {
                const firstReg = regs[0];
                // Probeer naam op te halen
                let name = `Werknemer ${empId}`;
                try {
                    const empRes = await RobawsAPI.get(`employees/${empId}`);
                    if (empRes.code === 200 && empRes.data) {
                        name = empRes.data.fullName || empRes.data.name || name;
                    }
                } catch(e) {}

                const firstOfDay = regs.find(r => r.type === 'Op tijd' || r.type === 'Te laat');
                const clockTime = firstOfDay ? new Date(firstOfDay.startDate).toTimeString().slice(0,5) : null;
                const isLate = firstOfDay ? firstOfDay.type === 'Te laat' : false;
                const llSessions = regs.filter(r => r.type === 'Laden & Lossen');
                const extraSessions = regs.filter(r => r.type === 'Extra uren');

                result.push({
                    employeeId: empId,
                    name,
                    clockTime,
                    isLate,
                    type: firstOfDay ? firstOfDay.type : null,
                    totalRegistrations: regs.length,
                    ladenLossen: llSessions.length,
                    extraUren: extraSessions.length,
                    registrations: regs,
                });
            }

            return result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } catch (e) {
            console.warn('[Clock] Admin overzicht ophalen mislukt:', e.message);
            return [];
        }
    },

    // =============================================
    // TAG BEHEER SCHERM (voor kantoorpersoneel)
    // =============================================

    /** Render tag beheer HTML voor het klokscherm */
    renderTagAdmin() {
        const config = this.getTagConfig();
        if (!config) return '<p class="text-grey text-sm">NFC configuratie niet geladen</p>';

        let html = '';

        // Bureau tag
        html += this._renderTagRow('🏢', 'Bureau', config.bureau, 'NFC Bureau Tag');

        // L&L tag
        html += this._renderTagRow('📦', 'Laden & Lossen', config.ladenLossen, 'NFC Bureau Tag Laden & Lossen');

        // Camionetten
        for (const cam of (config.camionetten || [])) {
            html += this._renderTagRow('🚐', cam.name, cam, cam.fieldName);
        }

        return html;
    },

    /** Hulpje: uniek ID voor elke tag-rij zodat onclick via data-attributen werkt */
    _tagRowCounter: 0,

    _renderTagRow(icon, name, tagData, fieldName) {
        const tagId = tagData && tagData.tagId ? tagData.tagId : null;
        const statusColor = tagId ? 'var(--qe-green)' : 'var(--qe-orange)';
        const statusText = tagId ? tagId.substring(0, 16) + (tagId.length > 16 ? '...' : '') : 'Niet ingesteld';
        const rowId = 'tagRow_' + (this._tagRowCounter++);

        // Sla fieldName en name op als data-attributen (veilig, geen escaping issues)
        const clearBtn = tagId ? `<button data-action="clear" data-field="${this._htmlAttr(fieldName)}" style="font-size:11px;color:#E53935;background:none;border:none;cursor:pointer;padding:4px" title="Verwijder tag">✕</button>` : '';
        const scanBtn = `<button data-action="assign" data-field="${this._htmlAttr(fieldName)}" data-name="${this._htmlAttr(name)}" style="font-size:11px;color:var(--qe-purple);background:none;border:1px solid var(--qe-purple);border-radius:6px;cursor:pointer;padding:4px 8px">📱 Scan</button>`;

        return `<div id="${rowId}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0">
            <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:20px">${icon}</span>
                <div>
                    <div style="font-size:14px;font-weight:500">${name}</div>
                    <div style="font-size:11px;color:${statusColor};font-family:monospace">${statusText}</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px">${scanBtn}${clearBtn}</div>
        </div>`;
    },

    /** Escape string voor gebruik in HTML attributen */
    _htmlAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    /** Bind click events op tag admin knoppen (aanroepen na innerHTML) */
    bindTagAdminEvents() {
        const container = document.getElementById('clockTagList');
        if (!container) return;
        container.querySelectorAll('button[data-action="assign"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const fieldName = btn.getAttribute('data-field');
                const locName = btn.getAttribute('data-name');
                QEClock.startTagAssignment(fieldName, locName);
            });
        });
        container.querySelectorAll('button[data-action="clear"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const fieldName = btn.getAttribute('data-field');
                QEClock._clearTag(fieldName);
            });
        });
    },

    async _clearTag(fieldName) {
        if (!confirm('Weet je zeker dat je deze tag wilt verwijderen?')) return;
        try {
            await RobawsAPI.saveNfcTagId(fieldName, '');
            await this.loadTagConfig();
            if (window.app) {
                app.toast('Tag verwijderd ✓');
                if (app.currentScreen === 'screenClock') app.onNavigateToClock();
            }
        } catch (e) {
            if (window.app) app.toast('Kon tag niet verwijderen: ' + e.message, true);
        }
    },

    // =============================================
    // STATUS HELPERS (voor UI)
    // =============================================

    /** Is al ingeclockt vandaag? */
    isClockedIn() {
        return this.isActive();
    },

    /** Is te laat? (voor statusbar) */
    isLate() {
        const session = this.getSession();
        if (!session) {
            // Nog niet gescand — check of het voorbij starttijd is
            const now = this._localTime();
            return now > this.getExpectedStartTime();
        }
        // Check eerste registratie
        if (session.registrationType === 'Te laat') return true;
        const completed = session.completedSessions || [];
        return completed.some(s => s.type === 'Te laat');
    },

    /** Geeft de inclocktijd (eerste scan van vandaag) */
    getClockTime() {
        const session = this.getSession();
        if (!session) return null;
        const completed = session.completedSessions || [];
        if (completed.length > 0) return completed[0].startTime;
        if (session.startTime) return session.startTime;
        return null;
    },

    /** Geeft het type van de huidige/eerste registratie */
    getRegistrationType() {
        const session = this.getSession();
        if (!session) return null;
        return session.registrationType;
    },

    /** Geeft de tag naam van de actieve sessie */
    getActiveTagName() {
        const session = this.getSession();
        if (!session || !session.active) return null;
        return session.tagName;
    },
};
