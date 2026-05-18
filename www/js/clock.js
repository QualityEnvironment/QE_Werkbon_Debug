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

    /**
     * v59: Test-modus. Wanneer true wordt de NFC-scan-flow GEBLOKKEERD —
     * scans tonen alleen een waarschuwing en doen verder niks. Op die manier
     * kunnen we eerst via de "Test tijdsregistratie aanmaken"-knop op het
     * Klok-scherm de Robaws-werkbon-API valideren zonder dat er bij elke
     * scan ongewenste werkbonnen worden aangemaakt.
     *
     * Zet op false zodra de test-werkbon perfect blijkt - dan worden scans
     * weer doorgestuurd naar _clockIn / _clockOut / _handleLadenLossen.
     */
    _testModeActive: false,  // v60: scan-flow weer live (Variant A format bevestigd)

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

    /** v72: TTL voor tag-config cache (5 min) — voorkomt dat we per scan
     * dubbele /employees calls doen. Reset bij login of expliciet herladen.
     */
    _tagConfigLoadedAt: 0,

    /** Haal NFC tags op van Robaws en cache lokaal */
    async loadTagConfig(force) {
        // v72: skip als cache nog vers is (5 min TTL)
        if (!force && this._tagConfig && (Date.now() - this._tagConfigLoadedAt) < 5 * 60 * 1000) {
            return this._tagConfig;
        }
        try {
            const config = await RobawsAPI.getNfcTagConfig();
            this._tagConfigLoadedAt = Date.now();
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

        // ── SCREEN-GUARD: scannen mag vanuit Planning / Klok / Uren tabs
        // (v126). Andere schermen (werkbon-invul, payment, etc.) blijven
        // geblokkeerd om onbedoelde inclock te voorkomen. Toewijzingsmodus
        // is een uitzondering — die mag overal werken.
        const ALLOWED_SCAN_SCREENS = ['screenPlanning', 'screenClock', 'screenDagoverzicht'];
        const onAllowedScreen = window.app
            && ALLOWED_SCAN_SCREENS.includes(window.app.currentScreen);
        if (!onAllowedScreen && !this._pendingAssignment) {
            if (window.app) {
                app.toast('Scannen kan vanaf Planning, Klok of Uren');
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

            // v111: GPS-verplichting uitgezet — de v99-check (_verifyGPSEnabled
            // met korte timeout) gaf te vaak een valse "locatie staat uit"-error
            // bij slechte ontvangst, koude GPS-fix of trage chip-respons, ook
            // als de gebruiker locatie wel had aanstaan. We laten de scan door
            // en proberen GPS verderop best-effort op te halen voor de
            // opmerking — als het lukt komt het mee, anders staat er
            // "GPS niet beschikbaar".

            // v59: Test-modus blokkeert scan-flow tot het werkbon-formaat klopt
            if (this._testModeActive) {
                if (window.app && typeof app.showScanResult === 'function') {
                    app.showScanResult(false,
                        'Scan geblokkeerd in test-modus.\n\n' +
                        'Gebruik eerst de oranje knop "Test tijdsregistratie" ' +
                        'op het Klok-scherm om het werkbon-formaat te valideren.',
                        null, 4000);
                } else if (window.app) {
                    app.toast('Test-modus actief — gebruik de test-knop', true);
                }
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

            // v126: helper om de loading-spinner te tonen
            const showLoad = () => {
                if (window.app && typeof app.showScanLoading === 'function') {
                    try { app.showScanLoading('Bezig met verwerken…'); } catch(_) {}
                }
            };

            try {
                // ── LADEN & LOSSEN ──
                if (tag.type === 'laden_lossen') {
                    showLoad();
                    scanResult = await this._handleLadenLossen(session, tag);
                    return;
                }

                // ── ACTIEVE SESSIE → UITCLOCKEN ──
                if (session.active) {
                    const userName = user.name || user.email;
                    const startTime = session.startTime || '?';
                    // v72: vervang native confirm() door custom modal — confirm()
                    // blokkeert de UI thread inclusief de _scanLock (8s timeout).
                    const confirmed = await this._showConfirmModal(
                        `${userName} uitklokken?`,
                        `Ingeklokt om ${startTime}. Wil je nu uitklokken?`,
                        'Uitklokken',
                        'Annuleren'
                    );
                    if (!confirmed) {
                        console.log('[Clock] Uitklokken geannuleerd door gebruiker');
                        return;
                    }

                    // v116: vóór uitklokken — controleer openstaande werkbons.
                    // Voor techniekers blokkeert dit ALTIJD bij >=1 openstaande.
                    // Voor monteurs met 1 openstaande werkbon biedt het de uren-
                    // overname + auto-submit aan. Bij blokkade: niet uitklokken.
                    let canProceed = true;
                    try {
                        if (window.app && typeof app.checkAndHandleOpenWorkordersBeforeClockOut === 'function') {
                            canProceed = await app.checkAndHandleOpenWorkordersBeforeClockOut(session);
                        }
                    } catch(e) {
                        console.warn('[Clock] openstaande-werkbon check faalde:', e && e.message);
                        // Bij onverwachte fout: laat uitklokken door zodat een
                        // bug in de check de werknemer niet vasthoudt.
                        canProceed = true;
                    }
                    if (!canProceed) {
                        console.log('[Clock] Uitklokken geblokkeerd — openstaande werkbon(s)');
                        scanResult = {
                            ok: false,
                            message: 'Niet uitgeklokt — openstaande werkbon',
                            refresh: false,
                        };
                        return;
                    }

                    showLoad();
                    scanResult = await this._clockOut(session, tag);
                    return;
                }

                // ── GEEN ACTIEVE SESSIE → INCLOCKEN ──
                showLoad();
                scanResult = await this._clockIn(session, tag);
            } finally {
                // v126: loading-spinner uit voor de SUCCES/MISLUKT overlay opent
                if (window.app && typeof app.hideScanLoading === 'function') {
                    try { app.hideScanLoading(); } catch(_) {}
                }
                // Toon SUCCES/MISLUKT overlay als de scan-flow iets opleverde
                if (scanResult && window.app && typeof app.showScanResult === 'function') {
                    const refresh = !!scanResult.refresh;
                    const askKm = !!scanResult.askKilometers;
                    const woId = scanResult.workOrderId;
                    const empId = scanResult.employeeId;
                    app.showScanResult(scanResult.ok, scanResult.message, async () => {
                        if (!refresh) return;
                        try { await this.syncWithRobaws(); } catch(_) {}
                        try { app.updateClockUI(); } catch(_) {}
                        try { if (app.currentScreen === 'screenClock') app.navigate('screenClock'); } catch(_) {}
                        // v83: na succesvol uitklokken — kilometers-prompt
                        if (askKm && scanResult.ok && woId && empId
                                && typeof app.promptKilometers === 'function') {
                            try { await app.promptKilometers(woId, empId); } catch(e) {
                                console.warn('[Clock] km prompt fout:', e && e.message);
                            }
                        }
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
    // INCLOCKEN (v58: maakt Tijdsregistratie-werkbon aan)
    // =============================================

    async _clockIn(session, tag) {
        const now = await this._getNow();
        const time = this._localTime(now);

        // v62: Robaws is leidend. Check eerst of er VANDAAG al een werkbon
        // bestaat voor deze user. Zo ja, hergebruik die ID. Zo nee, maak nieuwe.
        // v71: race-mitigation — als de eerste check NIETS oplevert, doe een
        // willekeurige korte delay (50-400ms) en check opnieuw, om te voorkomen
        // dat 2 toestellen tegelijk een werkbon aanmaken.
        const _user = RobawsAPI.getLoggedInUser();
        const _userId = _user ? (_user.robawsUserId || _user.userId) : null;
        if (!session.workOrderId && _userId) {
            try {
                let existing = await RobawsAPI.getTodaysOpenTimeRegistrationWorkOrder(_userId);
                if (existing && existing.id) {
                    session.workOrderId = existing.id;
                    console.log('[Clock] Bestaande werkbon van vandaag gevonden:', existing.id);
                } else {
                    // v71: jitter + double-check tegen race condition
                    const jitter = 50 + Math.floor(Math.random() * 350);
                    await new Promise(r => setTimeout(r, jitter));
                    existing = await RobawsAPI.getTodaysOpenTimeRegistrationWorkOrder(_userId);
                    if (existing && existing.id) {
                        session.workOrderId = existing.id;
                        console.log('[Clock] Werkbon gevonden in 2e check (race-fix):', existing.id);
                    }
                }
            } catch(e) {
                console.warn('[Clock] Kon Robaws niet checken voor bestaande werkbon:', e.message);
            }
        }

        // Eerste scan van de dag = werkbon aanmaken. Daarna nog een bureau-scan?
        // Dan starten we gewoon weer een sessie en posten op die werkbon een
        // extra time-entry bij het volgende clock-out.
        const isFirstScan = !session.workOrderId;

        let onTimeLabel = 'Op tijd';
        if (isFirstScan) {
            // Bepaal Op tijd / Te laat o.b.v. startuur werknemer
            const clockUser = RobawsAPI.getLoggedInUser();
            const clockUserId = clockUser ? String(clockUser.robawsEmployeeId) : null;
            if (clockUserId && this._startuurLoadedForUser !== clockUserId) {
                try {
                    const myRes = await RobawsAPI.get(`employees/${clockUserId}`);
                    if (myRes.code === 200 && myRes.data && myRes.data.extraFields) {
                        for (const [name, fdata] of Object.entries(myRes.data.extraFields)) {
                            if (name.toLowerCase().includes('startuur')) {
                                const val = fdata ? String(fdata.stringValue ?? fdata.value ?? '') : '';
                                if (val) {
                                    this._personalStartuur = val;
                                    this._startuurLoadedForUser = clockUserId;
                                    localStorage.setItem(`qe_startuur_${clockUserId}`, val);
                                }
                                break;
                            }
                        }
                    }
                } catch(e) { /* fallback default */ }
            }
            const expectedStart = this.getExpectedStartTime();
            const toMinutes = (hhmm) => {
                if (!hhmm) return 0;
                const m = String(hhmm).match(/^(\d{1,2}):(\d{1,2})/);
                if (!m) return 0;
                return (parseInt(m[1], 10) || 0) * 60 + (parseInt(m[2], 10) || 0);
            };
            const GRACE_MIN = 5;
            const isLate = toMinutes(time) > toMinutes(expectedStart) + GRACE_MIN;
            onTimeLabel = isLate ? 'Te laat' : 'Op tijd';
            console.log('[Clock] Startuur check:', time, 'vs verwacht:', expectedStart,
                '(grace ' + GRACE_MIN + 'min) ->', onTimeLabel);
        }

        // GPS
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

        // v70: opmerking krijgt "klok-in: " prefix + tijd, om bij clock-out
        // een 2e regel "klok-uit: ..." aan te kunnen toevoegen.
        const opmerking = `klok-in: ${tag.name} \u2014 ${gpsText} \u2014 ${time}`;

        // Sessie bijwerken
        const currentUser = RobawsAPI.getLoggedInUser();
        const empId = currentUser ? String(currentUser.robawsEmployeeId) : session.employeeId;
        const empName = currentUser ? currentUser.name : '';
        const userId = currentUser ? currentUser.robawsUserId : null;

        session.employeeId = empId;
        session.employeeName = empName;
        session.active = true;
        session.startTime = time;
        session.startISO = now.toISOString();
        session.tagType = tag.type;
        session.tagName = tag.name;
        session.gpsUrl = gpsText;
        session.gpsLat = gpsLat;
        session.gpsLng = gpsLng;

        // Eerste scan: werkbon aanmaken
        if (isFirstScan) {
            session.onTimeLabel = onTimeLabel;
            session.registrationType = onTimeLabel;  // v62: compat met oude UI
            session.dateStr = this._localDate();
            try {
                const wo = await RobawsAPI.createTimeRegistrationWorkOrder({
                    employeeId: empId,
                    employeeName: empName,
                    userId: userId,
                    dateStr: session.dateStr,
                    ingeklokt: time,
                    tijdLabel: onTimeLabel,
                    opmerking: opmerking,
                });
                session.workOrderId = wo.workOrderId;
                console.log('[Clock] Tijdsregistratie-werkbon aangemaakt:', wo.workOrderId);
            } catch (e) {
                console.error('[Clock] Kon werkbon niet aanmaken:', e.message);
                this._saveSession(session);
                return {
                    ok: false,
                    message: 'Inklokken mislukt:\n' + (e.message || 'Robaws onbereikbaar'),
                    refresh: false,
                };
            }
        }
        this._saveSession(session);

        const lateMsg = onTimeLabel === 'Te laat' ? ' (te laat!)' : '';
        const woRef = session.workOrderId ? ' (werkbon #' + session.workOrderId + ')' : '';
        const message = isFirstScan
            ? 'Ingeklokt om ' + time + ' - ' + tag.name + lateMsg + woRef
            : 'Extra sessie gestart om ' + time + ' - ' + tag.name + woRef;
        return { ok: true, message, refresh: true };
    },

    // =============================================
    // UITCLOCKEN (v58: post time-entry + zet Uitgeklokt)
    // =============================================

    async _clockOut(session, tag) {
        const now = await this._getNow();
        const endTimeRaw = this._localTime(now);

        if (!session.workOrderId) {
            return {
                ok: false,
                message: 'Geen werkbon gevonden voor vandaag',
                refresh: false,
            };
        }

        // Pauze ophalen (v56 logica)
        let pauseMinutes = this._personalPauze;
        let pauseSource = 'config';
        if (!pauseMinutes && pauseMinutes !== 0) {
            const user = RobawsAPI.getLoggedInUser();
            const userId = user ? String(user.robawsEmployeeId) : null;
            if (userId) {
                const cached = localStorage.getItem(`qe_pauze_${userId}`);
                if (cached) {
                    pauseMinutes = parseInt(cached, 10);
                    pauseSource = 'localStorage';
                }
            }
        }
        if (!pauseMinutes && pauseMinutes !== 0) {
            pauseMinutes = 60;
            pauseSource = 'fallback-60';
        }

        // Bepaal start- en eindtijd voor time-entry
        // - Start = MAX(actual scan-tijd, startuur werknemer); rond af op 5min indien te laat
        // - Eind  = afgerond naar dichtsbijzeijnde 5 min
        const expectedStart = this.getExpectedStartTime();
        const toMinutes = (hhmm) => {
            const m = String(hhmm || '').match(/^(\d{1,2}):(\d{1,2})/);
            if (!m) return 0;
            return (parseInt(m[1], 10) || 0) * 60 + (parseInt(m[2], 10) || 0);
        };
        const fromMinutes = (mins) => {
            const h = Math.floor(mins / 60) % 24;
            const m = mins % 60;
            return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        };
        const round5 = (mins) => Math.round(mins / 5) * 5;

        const actualStartMin = toMinutes(session.startTime);
        const expectedStartMin = toMinutes(expectedStart);
        // v74: kwartier-afronding voor werknemer-uren.
        //  - Clock-in: round UP naar volgend kwartier (6:02 → 6:15, 6:31 → 6:45)
        //  - Bureau-scan: max(round_up_15(actual), startuur werknemer) — kan nooit voor startuur
        //  - Camionet-scan: gewoon round_up_15(actual)
        // v94+: TOLERANTIE van 4 minuten — als je binnen 4 min van een kwartier zit,
        //  wordt afgerond naar dat kwartier (in beide richtingen). Voorbeeld:
        //   - 6:48 → 6:45 (3 min over → naar dichtsbijzijnde kwartier omlaag)
        //   - 6:50 → 7:00 (5 min over → normaal naar boven)
        //   - 15:28 → 15:30 (2 min onder → naar dichtsbijzijnde kwartier omhoog)
        //   - 15:25 → 15:15 (5 min onder → normaal naar beneden)
        const TOLERANCE = 4;
        const roundUp15 = (mins) => {
            const rem = mins % 15;
            // Binnen tolerantie van het lagere kwartier? → omlaag (gunstig voor werknemer bij in-klok)
            if (rem > 0 && rem <= TOLERANCE) return mins - rem;
            return Math.ceil(mins / 15) * 15;
        };
        const roundDown15 = (mins) => {
            const rem = mins % 15;
            const distUpper = (15 - rem) % 15;
            // Binnen tolerantie van het hogere kwartier? → omhoog (gunstig voor werknemer bij uit-klok)
            if (distUpper > 0 && distUpper <= TOLERANCE) return mins + distUpper;
            return Math.floor(mins / 15) * 15;
        };
        const useStartuurCorrection = (session.tagType === 'bureau');
        let entryStartMin;
        if (useStartuurCorrection) {
            // Bureau-scan: als de scan VÓÓR de werknemer-startuur ligt, gebruiken
            // we de startuur. Anders de gerondde scan-tijd (met v95 tolerantie).
            // Math.max neemt vanzelf de latere van de twee.
            entryStartMin = Math.max(roundUp15(actualStartMin), expectedStartMin);
        } else {
            // Camionet of L&L: gewoon afgeronde scan-tijd, géén startuur-correctie.
            entryStartMin = roundUp15(actualStartMin);
        }
        const entryEndMin = roundDown15(toMinutes(endTimeRaw));  // v74: round DOWN naar kwartier
        const entryStart = fromMinutes(entryStartMin);
        const entryEnd = fromMinutes(entryEndMin);

        console.log('[Clock] time-entry tijden (v74 kwartier-afronding):',
            'startuur=' + expectedStart,
            'actual=' + session.startTime + '/' + endTimeRaw,
            '-> entry ' + entryStart + ' -> ' + entryEnd,
            '(pauze ' + pauseMinutes + 'min, bron ' + pauseSource + ')');

        // v70/v72: bij clock-out 2e regel toevoegen met GPS+tijd.
        // v72: GPS-fetch met short timeout + cached fallback. Op slechte ontvangst
        // wachten we maximaal 3 sec; daarna gebruiken we de in-scan GPS uit de sessie
        // zodat de uit-scan niet 10s+ blokkeert.
        let outGpsText = '';
        try {
            const pos2 = await this._getGPS({ timeoutMs: 3000, maximumAge: 60000 });
            outGpsText = `https://maps.google.com/?q=${pos2.latitude.toFixed(6)},${pos2.longitude.toFixed(6)}`;
        } catch(_) {
            // Fallback: gebruik de GPS van de in-scan (zit nog in session)
            if (session.gpsLat != null && session.gpsLng != null) {
                outGpsText = `https://maps.google.com/?q=${session.gpsLat.toFixed(6)},${session.gpsLng.toFixed(6)}`;
            } else {
                outGpsText = 'GPS niet beschikbaar';
            }
        }
        const klokUitLine = `klok-uit: ${tag.name} \u2014 ${outGpsText} \u2014 ${endTimeRaw}`;

        // v77: Uitgeklokt-veld krijgt EXACTE klok-tijd (endTimeRaw), niet de
        // afgeronde tijd. De afgeronde tijd zit in de werknemer-uren rij
        // (time-entry endTime). Zo zie je in de werkbon zowel de werkelijke
        // scan-tijd als de betaalde uren.
        try {
            await RobawsAPI.setTimeRegistrationUitgeklokt(session.workOrderId, endTimeRaw, klokUitLine);
        } catch(e) {
            console.warn('[Clock] Uitgeklokt update faalde:', e.message);
        }

        // 2. POST time-entries voor monteur-uren (v83: split werkuren/overuren)
        //
        // Algoritme (zie v83 spec):
        //   klant_minutes = (entryEnd - entryStart) - pauze   (totale klok-tijd minus pauze)
        //   IF klant ≤ 8u: 1 entry werkuren met volledige tijdsblok
        //   IF klant > 8u: werkuren-blok van 8u (start → start+8u+pauze) + overuren-blok (rest → entryEnd)
        //   Compensatie: alleen wanneer klant < 8u EN er L&L op deze werkbon staat. Dan
        //   extra negatieve overuren-entry van -min(8 - klant, L&L_uren) zonder tijden.
        //
        // L&L wordt al direct bij scan-tijd gepost als losse time-entry met article 19786
        // (laden & lossen) en hourTypeId=1 (werkuren). Hoef ik hier niets meer aan te doen.
        const ART_MONTEUR = RobawsAPI.WERKUUR_ARTICLE_IDS.monteurProject;
        const HT_WERKUREN = RobawsAPI.HOUR_TYPE_IDS.werkuren;
        const HT_OVERUREN = RobawsAPI.HOUR_TYPE_IDS.overuren;
        const klantMinutes = entryEndMin - entryStartMin - (pauseMinutes || 0);
        const klantHours = Math.max(0, klantMinutes / 60);
        const EIGHT_HRS_MIN = 8 * 60;

        try {
            if (klantHours > 8) {
                // Splits in werkuren-blok (8u + pauze) + overuren-blok (rest)
                const werkurenEndMin = entryStartMin + EIGHT_HRS_MIN + (pauseMinutes || 0);
                const werkurenEnd = fromMinutes(werkurenEndMin);
                console.log('[Clock] Splits klant ' + klantHours.toFixed(2) + 'u: ' +
                    'werkuren ' + entryStart + '→' + werkurenEnd + ' (8u, pauze ' + pauseMinutes + 'min) + ' +
                    'overuren ' + werkurenEnd + '→' + entryEnd + ' (' + (klantHours-8).toFixed(2) + 'u)');

                // Werkuren-blok
                const r1 = await RobawsAPI.addWorkHoursTimeEntry({
                    workOrderId: session.workOrderId,
                    employeeId: session.employeeId,
                    startTime: entryStart,
                    endTime: werkurenEnd,
                    breakMinutes: pauseMinutes,
                    articleId: ART_MONTEUR,
                    hourTypeId: HT_WERKUREN,
                });
                if (r1.code !== 200 && r1.code !== 201) {
                    console.warn('[Clock] werkuren POST faalde:', r1.code, r1.data);
                    return { ok: false, message: 'Uitklokken mislukt:\nWerkuren POST (' + r1.code + ')', refresh: true };
                }

                // Overuren-blok
                const r2 = await RobawsAPI.addWorkHoursTimeEntry({
                    workOrderId: session.workOrderId,
                    employeeId: session.employeeId,
                    startTime: werkurenEnd,
                    endTime: entryEnd,
                    breakMinutes: 0,
                    articleId: ART_MONTEUR,
                    hourTypeId: HT_OVERUREN,
                });
                if (r2.code !== 200 && r2.code !== 201) {
                    console.warn('[Clock] overuren POST faalde:', r2.code, r2.data);
                    return { ok: false, message: 'Uitklokken mislukt:\nOveruren POST (' + r2.code + ')', refresh: true };
                }
                console.log('[Clock] werkuren + overuren posted');
            } else {
                // ≤ 8u: 1 enkele werkuren-entry over volledige tijdsblok
                const r = await RobawsAPI.addWorkHoursTimeEntry({
                    workOrderId: session.workOrderId,
                    employeeId: session.employeeId,
                    startTime: entryStart,
                    endTime: entryEnd,
                    breakMinutes: pauseMinutes,
                    articleId: ART_MONTEUR,
                    hourTypeId: HT_WERKUREN,
                });
                if (r.code !== 200 && r.code !== 201) {
                    console.warn('[Clock] werkuren POST faalde:', r.code, r.data);
                    return { ok: false, message: 'Uitklokken mislukt:\nWerkuren POST (' + r.code + ')', refresh: true };
                }
                console.log('[Clock] werkuren posted (klant ' + klantHours.toFixed(2) + 'u)');

                // v90+ (gebruikersvraag): ALS klant < 8u → ALTIJD compensatie:
                //   - Phantom werkuren (no-times) = (8 - klant)
                //   - Overuren-aftrek  (no-times) = -(8 - klant)
                //
                // v110: L&L wordt nu als OVERUREN geregistreerd (was werkuren) en
                // mag dus niet meer meetellen om het 8u werkuren-deficit te dekken.
                // Phantom wordt daarom de volle deficit (vroeger: max(0, deficit - L&L_uren)).
                if (klantHours < 8) {
                    const deficit = 8 - klantHours;

                    const phantomRounded = Math.round(deficit * 100) / 100;
                    if (phantomRounded > 0.005) {
                        console.log('[Clock] phantom werkuren: +' + phantomRounded + 'u (klant ' + klantHours.toFixed(2) + 'u)');
                        const rp = await RobawsAPI.addWorkHoursTimeEntry({
                            workOrderId: session.workOrderId,
                            employeeId: session.employeeId,
                            articleId: ART_MONTEUR,
                            hourTypeId: HT_WERKUREN,
                            hoursOverride: phantomRounded,
                        });
                        if (rp.code !== 200 && rp.code !== 201) {
                            console.warn('[Clock] phantom werkuren POST faalde (niet kritiek):', rp.code);
                        }
                    }

                    // Overuren-aftrek altijd
                    const compRounded = Math.round(-1 * deficit * 100) / 100;
                    console.log('[Clock] overuren-aftrek: ' + compRounded + 'u (klant ' + klantHours.toFixed(2) + 'u)');
                    const rc = await RobawsAPI.addWorkHoursTimeEntry({
                        workOrderId: session.workOrderId,
                        employeeId: session.employeeId,
                        articleId: ART_MONTEUR,
                        hourTypeId: HT_OVERUREN,
                        hoursOverride: compRounded,
                    });
                    if (rc.code !== 200 && rc.code !== 201) {
                        console.warn('[Clock] overuren-aftrek POST faalde (niet kritiek):', rc.code);
                    }
                }
            }
        } catch(e) {
            console.error('[Clock] time-entry POST exception:', e.message);
            return {
                ok: false,
                message: 'Uitklokken mislukt:\n' + e.message,
                refresh: false,
            };
        }

        // v63: bereken payable hours = (entry_eind - entry_start) - pauze
        // Dit is wat de werknemer betaald krijgt — dus dat tonen we ook in de UI.
        const payableMins = entryEndMin - entryStartMin - (pauseMinutes || 0);
        const payableHours = Math.max(0, Math.round(payableMins / 60 * 100) / 100);

        // Sessie bijwerken
        session.active = false;
        session.endTime = endTimeRaw;
        session.endISO = now.toISOString();
        session.completedSessions = session.completedSessions || [];
        session.completedSessions.push({
            startTime: entryStart,    // afgerond startuur (zo zien werknemers wat in time-entry staat)
            endTime: entryEnd,        // afgerond einduur
            entryStart: entryStart,
            entryEnd: entryEnd,
            pauseMinutes: pauseMinutes,
            tagName: session.tagName,
            type: session.onTimeLabel || 'Op tijd',
            hours: payableHours,      // payable uren — niet klok-tijd
            workOrderId: session.workOrderId,
        });
        this._saveSession(session);

        return {
            ok: true,
            message: 'Uitgeklokt om ' + entryEnd + '\n' +
                'Uren: ' + entryStart + ' - ' + entryEnd +
                ' (' + pauseMinutes + 'min pauze)',
            refresh: true,
            // v83: vraag de monteur om kilometers in te geven na clock-out.
            // De UI kan dit oppakken via scanResult.askKilometers en een modal tonen.
            askKilometers: true,
            workOrderId: session.workOrderId,
            employeeId: session.employeeId,
        };
    },

    // =============================================
    // LADEN & LOSSEN (v73: time-entry direct posten bij start)
    // =============================================

    async _handleLadenLossen(session, tag) {
        const now = await this._getNow();
        const time = this._localTime(now);

        const round5 = (mins) => Math.round(mins / 5) * 5;
        const toMinutes = (hhmm) => {
            const m = String(hhmm || '').match(/^(\d{1,2}):(\d{1,2})/);
            if (!m) return 0;
            return (parseInt(m[1], 10) || 0) * 60 + (parseInt(m[2], 10) || 0);
        };
        const fromMinutes = (mins) => {
            const h = Math.floor(mins / 60) % 24;
            const m = mins % 60;
            return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        };

        // Geval 1: lopende L&L → afsluiten via PUT op de open time-entry.
        if (session.llActive) {
            const llStart = session.llStartTime;
            // v76: L&L duur altijd naar BOVEN afgerond op kwartier, minimum 15 min.
            // Werknemer krijgt voor 7 min laden toch een volle kwartier.
            const startMinRaw = toMinutes(llStart);
            const endMinRaw = toMinutes(time);
            const actualDuration = Math.max(0, endMinRaw - startMinRaw);
            const billableDuration = Math.max(15, Math.ceil(actualDuration / 15) * 15);
            // Start blijft op 5 min afgerond (dichtbij de werkelijkheid).
            // End = start + billable_duration (zo blijft het kwartier-veelvoud).
            const startMinForDisplay = round5(startMinRaw);
            const endMinForDisplay = startMinForDisplay + billableDuration;
            const llEnd = fromMinutes(endMinForDisplay);
            const llStartRounded = fromMinutes(startMinForDisplay);
            try {
                if (session.llActiveTeId) {
                    // v73: PUT update met endTime
                    const r = await RobawsAPI.closeOpenLLTimeEntry(
                        session.workOrderId, session.llActiveTeId,
                        { startTime: llStartRounded, endTime: llEnd }
                    );
                    if (r.code !== 200 && r.code !== 201 && r.code !== 204) {
                        console.warn('[Clock] L&L PUT faalde:', r.code, r.data,
                            '— fallback POST nieuwe time-entry');
                        // Fallback: post een nieuwe complete entry
                        // v110: hourTypeId = overuren (was default = werkuren)
                        await RobawsAPI.addWorkHoursTimeEntry({
                            workOrderId: session.workOrderId,
                            employeeId: session.employeeId,
                            startTime: llStartRounded,
                            endTime: llEnd,
                            breakMinutes: 0,
                            articleId: RobawsAPI.WERKUUR_ARTICLE_IDS.ladenLossen,
                            hourTypeId: RobawsAPI.HOUR_TYPE_IDS.overuren,
                        });
                    }
                } else {
                    // Geen teId bekend (vroeger gestart vóór v73) → post een nieuwe
                    // v110: hourTypeId = overuren (was default = werkuren)
                    await RobawsAPI.addWorkHoursTimeEntry({
                        workOrderId: session.workOrderId,
                        employeeId: session.employeeId,
                        startTime: llStartRounded,
                        endTime: llEnd,
                        breakMinutes: 0,
                        articleId: RobawsAPI.WERKUUR_ARTICLE_IDS.ladenLossen,
                        hourTypeId: RobawsAPI.HOUR_TYPE_IDS.overuren,
                    });
                }
            } catch(e) {
                console.error('[Clock] L&L close exception:', e.message);
                return {
                    ok: false,
                    message: 'L&L afsluiten mislukt:\n' + e.message,
                    refresh: false,
                };
            }

            session.llActive = false;
            session.llActiveTeId = null;
            session.llEntries = session.llEntries || [];
            session.llEntries.push({ startTime: llStartRounded, endTime: llEnd });
            session.llStartTime = null;
            session.llStartISO = null;
            this._saveSession(session);

            return {
                ok: true,
                message: 'Laden & Lossen klaar\n' + llStartRounded + ' - ' + llEnd,
                refresh: true,
            };
        }

        // Geval 2: nieuwe L&L sub-sessie starten.
        // Eerst zorgen dat er een werkbon van vandaag is.
        if (!session.workOrderId) {
            const currentUser = RobawsAPI.getLoggedInUser();
            const empId = currentUser ? String(currentUser.robawsEmployeeId) : session.employeeId;
            const empName = currentUser ? currentUser.name : '';
            const userId = currentUser ? currentUser.robawsUserId : null;
            let gpsText = '';
            try {
                const pos = await this._getGPS({ timeoutMs: 3000, maximumAge: 60000 });
                gpsText = `https://maps.google.com/?q=${pos.latitude.toFixed(6)},${pos.longitude.toFixed(6)}`;
            } catch(_) { gpsText = 'GPS niet beschikbaar'; }
            try {
                const wo = await RobawsAPI.createTimeRegistrationWorkOrder({
                    employeeId: empId,
                    employeeName: empName,
                    userId: userId,
                    dateStr: this._localDate(),
                    ingeklokt: time,
                    tijdLabel: 'Op tijd',
                    opmerking: `klok-in: Laden & Lossen \u2014 ${gpsText} \u2014 ${time}`,
                });
                session.workOrderId = wo.workOrderId;
                session.employeeId = empId;
                session.employeeName = empName;
                session.dateStr = this._localDate();
                session.tagType = 'laden_lossen';
                session.tagName = 'Laden & Lossen';
                session.onTimeLabel = 'Op tijd';
                session.registrationType = 'Op tijd';
            } catch(e) {
                return {
                    ok: false,
                    message: 'Kon werkbon niet aanmaken:\n' + e.message,
                    refresh: false,
                };
            }
        }

        // v73: POST direct een open L&L time-entry met afgeronde startTime
        const llStartRounded = fromMinutes(round5(toMinutes(time)));
        let teId = null;
        try {
            teId = await RobawsAPI.postOpenLLTimeEntry({
                workOrderId: session.workOrderId,
                employeeId: session.employeeId,
                startTime: llStartRounded,
            });
        } catch(e) {
            console.error('[Clock] L&L start POST exception:', e.message);
            return {
                ok: false,
                message: 'L&L starten mislukt:\n' + e.message,
                refresh: false,
            };
        }

        // v73: zet session.active = true zodat UI in actief-branch komt en
        // het L&L-actief blok zichtbaar wordt. Hoofd-werkdag-state blijft
        // intact als die al actief was.
        if (!session.active) {
            session.active = true;
            session.startTime = session.startTime || llStartRounded;
            session.startISO = session.startISO || now.toISOString();
        }

        session.llActive = true;
        session.llActiveTeId = teId;
        session.llStartTime = llStartRounded;
        session.llStartISO = now.toISOString();
        this._saveSession(session);

        return {
            ok: true,
            message: 'Laden & Lossen gestart om ' + llStartRounded,
            refresh: true,
        };
    },


    // =============================================
    // GPS
    // =============================================

    _getGPS(opts) {
        const timeout = (opts && opts.timeoutMs) || 10000;
        const maxAge = (opts && opts.maximumAge) || 0;
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

    /**
     * v98+: Snelle check of locatie/GPS actief is. Returnt {ok, reason}.
     * Probeer eerst de Permissions API (kost geen GPS-fix), val anders terug
     * op getCurrentPosition met korte timeout.
     */
    async _verifyGPSEnabled() {
        if (!navigator.geolocation) {
            return { ok: false, reason: 'Geolocation niet beschikbaar in deze browser' };
        }
        // Permissions API (instant — kost geen GPS-fix)
        try {
            if (navigator.permissions && navigator.permissions.query) {
                const perm = await navigator.permissions.query({ name: 'geolocation' });
                if (perm.state === 'denied') {
                    return { ok: false, reason: 'Locatie-toestemming geweigerd in app-instellingen' };
                }
            }
        } catch(_) { /* Permissions API niet beschikbaar — skip */ }

        // Korte GPS-fix poging (3s timeout) — bij locatie-uit faalt dit meteen
        try {
            await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    () => resolve(),
                    err => reject(err),
                    { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 }
                );
            });
            return { ok: true };
        } catch (e) {
            const code = e && e.code;
            // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
            if (code === 1) return { ok: false, reason: 'Toestemming voor locatie geweigerd' };
            if (code === 2) return { ok: false, reason: 'Locatie staat uit op het toestel' };
            if (code === 3) return { ok: false, reason: 'GPS-fix timeout — sta even buiten' };
            return { ok: false, reason: (e && e.message) || 'Locatie niet beschikbaar' };
        }
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

        // v60: oude time-registrations sync-actions worden NIET meer
        // doorgestuurd. Die queue stamt uit de oude flow en zou anders calls
        // doen naar het time-registrations endpoint. We laten ze stil vallen.
        for (const item of pending) {
            const a = item.action;
            if (a === 'update' || a === 'create_complete' || a === 'create_open') {
                console.log('[Clock] Legacy pending-item gedropt (oude time-registrations flow):', a);
                continue;
            }
            // Onbekende of nieuwe actions — voor nu bewaren als unknown
            remaining.push(item);
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
        // v60: time-registrations endpoint wordt NIET meer gebruikt.
        // "Mijn week" haalt nu Tijdsregistratie-werkbonnen op via dezelfde
        // endpoint als loadDagoverzicht, en mapt de extraFields naar het
        // verwachte history-format (startDate/endDate/type/hours).
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return [];

        try {
            const today = new Date();
            const cutoff = new Date(today);
            cutoff.setDate(today.getDate() - days);

            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const monthPrefix = `${yyyy}-${mm}`;
            const userId = user.robawsUserId || user.userId;
            if (!userId) return [];

            // Haal alle Tijdsregistratie-werkbonnen voor de huidige maand
            const wos = await RobawsAPI.getMyTimeRegistrationWorkOrders(userId, monthPrefix);

            // Eventueel ook vorige maand erbij als de cutoff terug gaat
            let extraWos = [];
            if (cutoff.getMonth() !== today.getMonth() || cutoff.getFullYear() !== today.getFullYear()) {
                const pyyyy = cutoff.getFullYear();
                const pmm = String(cutoff.getMonth() + 1).padStart(2, '0');
                try {
                    extraWos = await RobawsAPI.getMyTimeRegistrationWorkOrders(userId, `${pyyyy}-${pmm}`);
                } catch(_) {}
            }

            const allWos = wos.concat(extraWos);

            // Filter op cutoff en map naar het oude format (startDate/endDate/type/hours)
            const cutoffISO = cutoff.toISOString().substring(0, 10);
            return allWos
                .filter(wo => (wo.date || '') >= cutoffISO)
                .map(wo => {
                    const ef = wo.extraFields || {};
                    const tijd = (ef.Tijd && ef.Tijd.stringValue) || 'Op tijd';
                    const ingeklokt = (ef.Ingeklokt && ef.Ingeklokt.stringValue) || null;
                    const uitgeklokt = (ef.Uitgeklokt && ef.Uitgeklokt.stringValue) || null;
                    const dateStr = wo.date || '';
                    const startDate = ingeklokt ? `${dateStr}T${ingeklokt}:00` : dateStr;
                    const endDate = uitgeklokt ? `${dateStr}T${uitgeklokt}:00` : null;
                    return {
                        id: wo.id,
                        startDate,
                        endDate,
                        type: tijd,
                        hours: null,  // wordt nu niet getoond in history-tegel
                        remarks: wo.remark || '',
                    };
                })
                .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
        } catch (e) {
            console.warn('[Clock] Kon geschiedenis niet ophalen:', e.message);
            return [];
        }
    },

    // =============================================
    // SYNC LOKALE SESSIE MET ROBAWS
    // =============================================

    /**
     * v62: Robaws is leidend voor "ingeklokt"-status. Zoek de werkbon van
     * vandaag (status="Tijdsregistratie" + assignedUserId=user) en bouw
     * de lokale sessie op vanuit die werkbon. Als er geen werkbon is,
     * wis de lokale sessie. Geen calls meer naar time-registrations.
     */
    async syncWithRobaws() {
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return;
        const userId = user.robawsUserId || user.userId;
        if (!userId) return;

        let wo;
        try {
            wo = await RobawsAPI.getTodaysOpenTimeRegistrationWorkOrder(userId);
        } catch (e) {
            console.warn('[Clock] Robaws sync mislukt — lokale sessie behouden:', e.message);
            return;
        }

        const sessionKey = this._getSessionKey();

        if (!wo) {
            // Geen werkbon vandaag in Robaws → wis lokale sessie
            const session = this.getSession();
            if (session) {
                console.log('[Clock] Geen werkbon van vandaag in Robaws — lokale sessie gewist');
                if (sessionKey) localStorage.removeItem(sessionKey);
            }
            return;
        }

        // Bouw sessie volledig op vanuit de Robaws-werkbon
        const ef = wo.extraFields || {};
        const ingeklokt  = (ef.Ingeklokt && ef.Ingeklokt.stringValue) || null;
        const uitgeklokt = (ef.Uitgeklokt && ef.Uitgeklokt.stringValue) || null;
        const tijdLabel  = (ef.Tijd && ef.Tijd.stringValue) || 'Op tijd';

        // Active: ingeklokt-tijd staat, maar uitgeklokt nog leeg
        const isActive = !!ingeklokt && !uitgeklokt;

        const session = this.getSession() || this._newSession();
        session.workOrderId      = wo.id;
        session.dateStr          = (wo.date || '').substring(0, 10);
        session.employeeId       = String(user.robawsEmployeeId);
        session.employeeName     = user.name || user.email;
        session.onTimeLabel      = tijdLabel;
        session.registrationType = tijdLabel;  // compat met oude UI
        session.startTime        = ingeklokt || session.startTime;
        session.active           = isActive;
        // v71: strip klok-in:/klok-uit: prefix EN GPS-deel om enkel tag-naam te krijgen.
        // Sinds v70 begint elke regel met "klok-in: <tag> — <gps> — <tijd>".
        // We pakken regel 1, strippen prefix, en splitsen op em-dash.
        const _firstLine = String(wo.remark || '').split(/\r?\n/)[0] || '';
        const _stripped  = _firstLine.replace(/^\s*klok-(in|uit):\s*/i, '');
        session.tagName          = _stripped.split(' \u2014 ')[0].trim() || session.tagName || 'Bureau';
        if (uitgeklokt) {
            session.endTime = uitgeklokt;
        }

        // Wis legacy completedSessions die uit oude time-registrations komen
        // (alleen items zonder workOrderId of die niet matchen met vandaag's werkbon)
        if (Array.isArray(session.completedSessions)) {
            session.completedSessions = session.completedSessions.filter(c => c && c.workOrderId === wo.id);
        }

        // Als de werkbon afgesloten is (Uitgeklokt gevuld), zet completedSessions
        if (uitgeklokt && (!session.completedSessions || session.completedSessions.length === 0)) {
            session.completedSessions = [{
                startTime: ingeklokt,
                endTime: uitgeklokt,
                type: tijdLabel,
                workOrderId: wo.id,
                tagName: session.tagName,
            }];
        }

        // v77: detecteer open L&L time-entry. Een entry is "open" als:
        //   (a) endTime is null/ontbreekt, OF
        //   (b) endTime is {hour:0, minute:0} EN hours is 0
        // Dit voorkomt dat een midnight-entry of een net-aangemaakte open entry
        // ten onrechte als afgesloten wordt beschouwd.
        try {
            const teRes = await RobawsAPI.get(`work-orders/${wo.id}/time-entries?limit=100`);
            if (teRes.code === 200 && teRes.data && teRes.data.items) {
                const llArt = String(RobawsAPI.WERKUUR_ARTICLE_IDS.ladenLossen);
                const llItems = teRes.data.items.filter(te => {
                    const aId = te.articleId || (te.article && te.article.id);
                    return String(aId) === llArt;
                });
                console.log('[Clock] L&L detect: found', llItems.length, 'L&L entries op werkbon', wo.id);
                const openLL = llItems.find(te => {
                    const ee = te.endTime;
                    const eeIsNull = !ee || (ee.hour == null && ee.minute == null);
                    const eeIsZero = ee && ee.hour === 0 && ee.minute === 0;
                    const hoursZero = !te.hours || parseFloat(te.hours) === 0;
                    return eeIsNull || (eeIsZero && hoursZero);
                });
                if (openLL) {
                    session.llActive = true;
                    session.llActiveTeId = openLL.id;
                    if (openLL.startTime && (openLL.startTime.hour != null)) {
                        session.llStartTime = String(openLL.startTime.hour).padStart(2,'0') +
                            ':' + String(openLL.startTime.minute || 0).padStart(2,'0');
                    }
                    console.log('[Clock] L&L ACTIEF gedetecteerd: te#' + openLL.id +
                        ' start=' + session.llStartTime);
                } else {
                    session.llActive = false;
                    session.llActiveTeId = null;
                    session.llStartTime = null;
                }
            }
        } catch(e) {
            console.warn('[Clock] L&L detectie mislukt:', e.message);
        }

        this._saveSession(session);
        console.log('[Clock] Sessie gesynced vanuit Robaws-werkbon', wo.id,
            '— actief:', isActive, ', start:', ingeklokt, ', eind:', uitgeklokt,
            ', L&L actief:', !!session.llActive);
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
    /**
     * v71 shim: getAllAttendanceToday is bewust verwijderd in v62 (samen met
     * de time-registrations endpoint). De admin-sectie van het Klok-scherm
     * roept hem nog aan. Voor nu return een lege array zodat het scherm niet
     * crasht. Een toekomstige versie kan dit herimplementeren via
     * getMyTimeRegistrationWorkOrders voor alle users (vereist admin-rechten
     * en respect voor rate-limit).
     */
    async getAllAttendanceToday() {
        console.warn('[Clock] getAllAttendanceToday: niet geïmplementeerd in werkbon-flow — return []');
        return [];
    },


    /** v72: custom confirm modal — blokkeert UI niet zoals native confirm().
     *  Returns Promise<boolean>. Auto-cancel na 30s als gebruiker niet reageert.
     */
    _showConfirmModal(title, message, okLabel, cancelLabel) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);' +
                'display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
            overlay.innerHTML = `
                <div style="background:#fff;border-radius:12px;padding:20px;max-width:420px;width:100%;
                    box-shadow:0 8px 24px rgba(0,0,0,0.2)">
                    <h3 style="margin:0 0 8px;font-size:17px;color:#001E45">${title}</h3>
                    <p style="margin:0 0 18px;font-size:14px;color:#444">${message}</p>
                    <div style="display:flex;gap:10px;justify-content:flex-end">
                        <button id="qeModalCancel" style="padding:10px 18px;font-size:14px;border:1px solid #ccc;
                            background:#f5f5f5;border-radius:8px;cursor:pointer">${cancelLabel || 'Annuleren'}</button>
                        <button id="qeModalOk" style="padding:10px 18px;font-size:14px;border:none;
                            background:#001E45;color:#fff;border-radius:8px;cursor:pointer;font-weight:600">${okLabel || 'OK'}</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const cleanup = (val) => {
                clearTimeout(autoCancelTimer);
                try { document.body.removeChild(overlay); } catch(_) {}
                resolve(val);
            };
            overlay.querySelector('#qeModalOk').onclick = () => cleanup(true);
            overlay.querySelector('#qeModalCancel').onclick = () => cleanup(false);
            overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
            const autoCancelTimer = setTimeout(() => cleanup(false), 30000);
        });
    },

};