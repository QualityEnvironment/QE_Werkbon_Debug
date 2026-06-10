/**
 * QE Werkbon App — Main Application Logic
 * Quality Environment bvba
 */

const app = {
    // === STATE ===
    currentUser: null,       // { name, email, robawsEmployeeId, role }
    currentDate: new Date(),
    currentScreen: 'screenPlanning',
    screenHistory: [],
    workorders: [],
    currentWO: null,         // Active werkorder

    // Per werkorder data (keyed by WO id)
    woData: {},

    /**
     * Brussel-aware "YYYY-MM-DD" string. Vervangt
     * `new Date().toISOString().split('T')[0]` dat UTC gebruikte
     * en daardoor rond middernacht de verkeerde dag teruggaf.
     * Delegeert naar RobawsAPI._localDateStr (laden vóór app.js).
     */
    // v166: Centrale styling voor het "Tijd"-veld (extraFields.Tijd). Gebruikt
    // in zowel het uren-overzicht als het aanpassings-scherm. Eén plek om kleuren,
    // iconen en labels te beheren — voorkomt drift wanneer er nieuwe types
    // worden toegevoegd in Robaws.
    _TIJD_STYLES: {
        'Op tijd':              { color: '#2e7d32', bg: '#f1f8e9', icon: '',   label: 'Werkuren' },
        'Te laat':              { color: '#e65100', bg: '#fff3e0', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 4 3 19h18z"/><path d="M12 10v4M12 17h.01"/></svg>', label: 'Te laat' },
        'Ziek':                 { color: '#b71c1c', bg: '#ffebee', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 4a2 2 0 0 1 2 2v7a4 4 0 1 1-4 0V6a2 2 0 0 1 2-2z"/></svg>', label: 'Ziek' },
        'Verlof':               { color: '#1565c0', bg: '#e3f2fd', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>', label: 'Verlof' },
        'Betaalde feestdag':    { color: '#b8860b', bg: '#fff8e1', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 13h16M12 9v11"/><path d="M12 9C9 9 7.5 7.5 8 6s3-1 4 3c1-4 3.5-4.5 4-3s-1 3-4 3z"/></svg>', label: 'Betaalde feestdag' },
        'Inhaal rustdag':       { color: '#00695c', bg: '#e0f2f1', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M20 14A8 8 0 0 1 10 4a7 7 0 1 0 10 10z"/></svg>', label: 'Inhaal rustdag' },
        'Sociaal verlof':       { color: '#6a1b9a', bg: '#f3e5f5', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6M21 20a6 6 0 0 0-4.5-5.8"/></svg>', label: 'Sociaal verlof' },
    },

    _getTijdStyle(tijd) {
        return this._TIJD_STYLES[tijd] || this._TIJD_STYLES['Op tijd'];
    },

    /** v166: true voor types die als afwezigheid tellen (Ziek + 4 verloftypes).
     *  Bij deze types wordt 8u forfaitair geboekt en krijgt de uren-kaart
     *  een afzonderlijke kleur (override op werkuren/overuren styling). */
    _isAbsenceTijd(tijd) {
        return tijd === 'Ziek' || tijd === 'Verlof'
            || tijd === 'Betaalde feestdag' || tijd === 'Inhaal rustdag'
            || tijd === 'Sociaal verlof';
    },

    _localDateStr(d, offsetDays) {
        if (typeof RobawsAPI !== 'undefined' && RobawsAPI._localDateStr) {
            return RobawsAPI._localDateStr(d, offsetDays);
        }
        // Mini-fallback (zou nooit gebruikt mogen worden):
        const base = (d instanceof Date) ? d : new Date();
        const t = new Date(base.getTime() + (offsetDays ? offsetDays * 86400000 : 0));
        const y = t.getFullYear();
        const m = String(t.getMonth() + 1).padStart(2, '0');
        const day = String(t.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },

    // Auto-save: sla woData op na elke wijziging
    _saveWoData() {
        try {
            // Sla alleen id/hours/materials/notes op (geen foto-data — te groot)
            // Foto's worden in IndexedDB bewaard (zie _idb* helpers).
            const slim = {};
            for (const [id, d] of Object.entries(this.woData)) {
                slim[id] = {
                    hours: d.hours || [],
                    materials: d.materials || [],
                    notes: d.notes || '',
                    photoCount: (d.photos || []).length,
                    checklist: d.checklist || null,
                    onderhoud: d.onderhoud || false,
                };
            }
            localStorage.setItem('qe_woData', JSON.stringify(slim));
        } catch (e) { /* localStorage vol — niet erg */ }
    },
    _restoreWoData() {
        try {
            const stored = localStorage.getItem('qe_woData');
            if (stored) {
                const slim = JSON.parse(stored);
                for (const [id, d] of Object.entries(slim)) {
                    if (!this.woData[id]) {
                        this.woData[id] = { hours: d.hours || [], materials: d.materials || [], photos: [], notes: d.notes || '', checklist: d.checklist || null, onderhoud: d.onderhoud || false };
                    }
                }
            }
            // v102+: foto's worden LAZY hersteld in openWorkorder() per WO,
            // niet bij init. Voorkomt geheugendruk + langere init-tijd op toestellen
            // met veel foto's in cache.
        } catch (e) {}
    },

    /**
     * v102+: Lazy-load foto's uit IndexedDB voor een specifieke WO.
     * Wordt aangeroepen in openWorkorder. Zo blijven foto's na refresh maar
     * laden we niet alle foto-data tegelijk in RAM.
     */
    async _restorePhotosForWO(woId) {
        try {
            const db = await this._idbOpen();
            const photos = await new Promise((resolve, reject) => {
                const tx = db.transaction(this._IDB_STORE, 'readonly');
                const idx = tx.objectStore(this._IDB_STORE).index('woId');
                const req = idx.getAll(IDBKeyRange.only(String(woId)));
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
            if (!this.woData[woId]) {
                this.woData[woId] = { hours: [], materials: [], photos: [], notes: '', checklist: null, onderhoud: false };
            }
            this.woData[woId].photos = this.woData[woId].photos || [];
            for (const ph of photos) {
                if (!this.woData[woId].photos.some(p => String(p.id) === String(ph.id))) {
                    this.woData[woId].photos.push({ id: ph.id, data: ph.data, name: ph.name });
                }
            }
            if (photos.length > 0) {
                console.log('[App] ' + photos.length + ' foto(s) hersteld voor WO ' + woId);
            }
        } catch (e) {
            console.warn('[App] _restorePhotosForWO faalde:', e && e.message);
        }
    },

    // ========================================
    // v101+: INDEXEDDB voor foto-persistentie
    // ========================================
    _IDB_NAME: 'qe_werkbon_db',
    _IDB_VERSION: 1,
    _IDB_STORE: 'photos',
    _idbCached: null,

    _idbOpen() {
        if (this._idbCached) return Promise.resolve(this._idbCached);
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB niet beschikbaar')); return; }
            const req = indexedDB.open(this._IDB_NAME, this._IDB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(this._IDB_STORE)) {
                    const store = db.createObjectStore(this._IDB_STORE, { keyPath: 'id' });
                    store.createIndex('woId', 'woId', { unique: false });
                }
            };
            req.onsuccess = () => { this._idbCached = req.result; resolve(req.result); };
            req.onerror = () => reject(req.error);
        });
    },

    async _idbSavePhoto(woId, photo) {
        const db = await this._idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this._IDB_STORE, 'readwrite');
            const store = tx.objectStore(this._IDB_STORE);
            store.put({
                id: String(photo.id),
                woId: String(woId),
                data: photo.data,
                name: photo.name,
                addedAt: Date.now(),
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async _idbDeletePhoto(photoId) {
        const db = await this._idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this._IDB_STORE, 'readwrite');
            tx.objectStore(this._IDB_STORE).delete(String(photoId));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async _idbDeleteAllForWO(woId) {
        const db = await this._idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this._IDB_STORE, 'readwrite');
            const store = tx.objectStore(this._IDB_STORE);
            const idx = store.index('woId');
            const req = idx.openCursor(IDBKeyRange.only(String(woId)));
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            req.onerror = () => reject(req.error);
        });
    },

    async _idbGetAllPhotos() {
        const db = await this._idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this._IDB_STORE, 'readonly');
            const req = tx.objectStore(this._IDB_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    // Ingediende uren bijhouden (keyed by WO id)
    submittedHours: {},

    // Lokaal bijhouden welke WO ids al een werkbon hebben (voor filteren)
    submittedWOs: [],

    // Timer state
    timer: {
        running: false,
        type: null,        // 'klant' | 'pauze'
        startTime: null,
        elapsed: 0,
        interval: null,
    },

    // Hour types (uurcodes)
    hourTypes: [],
    selectedUurcode: null,
    verplaatsingCode: null,  // apart bijgehouden voor verplaatsingsuren

    // Voorkom dubbele werkbon/factuur
    _submitInProgress: false,

    // Search debounce
    searchTimeout: null,

    // Artikelgroepen
    articleGroups: null,
    currentGroupId: null,
    groupBreadcrumb: [],

    // ========================================
    // INITIALIZATION
    // ========================================
    async init() {
        // BUG-fix: globale handler voor unhandled promise-rejections.
        // Voorkomt dat fouten stilletjes verloren gaan en helpt bij debug.
        if (!window._qeRejectionHandlerInstalled) {
            window.addEventListener('unhandledrejection', (e) => {
                try {
                    console.error('[QE] Unhandled promise rejection:',
                        e.reason && e.reason.message ? e.reason.message : e.reason);
                } catch(_) {}
            });
            window._qeRejectionHandlerInstalled = true;
        }

        // Android back-knop: bij elke navigate wordt window.history.pushState
        // aangeroepen, waardoor de WebView weet dat er een back-stack is.
        // De Java-laag (MainActivity.onBackPressed) doet dan webView.goBack()
        // i.p.v. de app te sluiten — wat een popstate-event triggert in JS.
        // Hier handelen we dat event af door de modal te sluiten of binnen
        // de app naar het vorige scherm te navigeren.
        if (!window._qeBackHandlerInstalled) {
            window.addEventListener('popstate', () => {
                // 1. Modal heeft prioriteit: sluit hem en compenseer de pop
                const modal = document.getElementById('modalOverlay');
                if (modal && modal.classList.contains('show')) {
                    this.closeModal();
                    try { history.pushState({ qeApp: true }, '', location.pathname); } catch(_) {}
                    return;
                }
                // 2. Speciale schermen die niet via gewone goBack mogen (zelfde
                //    logica als app.goBack — factuur is al aangemaakt)
                if (this.currentScreen === 'screenPayment' || this.currentScreen === 'screenOverschrijving') {
                    this.screenHistory = [];
                    try { history.replaceState({ qeApp: true }, '', location.pathname); } catch(_) {}
                    this.navigate('screenPlanning', false);
                    this.loadPlanning();
                    return;
                }
                // 3. Schermhistorie? Pop en navigeer (window.history is al gepop't door Android)
                if (this.screenHistory.length > 0) {
                    const prev = this.screenHistory.pop();
                    this.navigate(prev, false);
                    return;
                }
                // 4. Geen history meer: blijf op huidig scherm. Bij volgende
                //    back is webView.canGoBack() false en sluit Java de app.
            });
            // Initiële history-entry zodat de eerste back-knop een entry heeft
            try { history.replaceState({ qeApp: true }, '', location.pathname); } catch(_) {}
            window._qeBackHandlerInstalled = true;
        }

        // v118: seedDefaultPins() VERWIJDERD — Robaws is nu de enige bron
        // van PIN-validatie. Eventuele oude qe_pin_* keys in localStorage
        // worden bij volgende online login automatisch opgeruimd
        // (zie robaws-api.js login).
        // Ingediende werkorders + openstaande betalingen herstellen uit localStorage
        this._loadSubmittedWOs();
        // Herstel onafgemaakte werkorder-data (uren, materialen, notities)
        this._restoreWoData();
        // Eenmalige opschoning: oude automatische pending-payments wegen (werden
        // foutief vol-gezet bij elke factuur). Vanaf nu alleen bij expliciet "niet gelukt".
        if (!localStorage.getItem('qe_pending_cleanup_v2')) {
            try { localStorage.removeItem('qe_pending_payments'); } catch (e) {}
            localStorage.setItem('qe_pending_cleanup_v2', '1');
        }
        // v79: Force logout bij OTA update — versie-detectie in JS zelf.
        // Dit werkt onafhankelijk van MainActivity.java (zodat ook v78-gebruikers
        // die de OTA naar v79 ontvangen direct uitgelogd worden, zonder APK-rebuild).
        // We vergelijken de huidige versie met de laatst gezien versie in localStorage.
        // Mismatch → qe_user wissen vóór de auth-check, zodat showLogin() opkomt.
        try {
            const verRes = await fetch('version.json?_=' + Date.now());
            const verJson = await verRes.json();
            const currentVer = String(verJson.version || '');
            const lastVer = localStorage.getItem('qe_last_seen_version');
            const hasUser = !!localStorage.getItem('qe_user');
            if (currentVer && hasUser && (lastVer == null || lastVer !== currentVer)) {
                console.log('[App] OTA update gedetecteerd (v' + lastVer + ' → v' + currentVer + ') — forced logout');
                try { localStorage.removeItem('qe_user'); } catch(_) {}
            }
            if (currentVer) {
                try { localStorage.setItem('qe_last_seen_version', currentVer); } catch(_) {}
            }
        } catch(e) {
            console.warn('[App] Versie-check faalde (geen OTA forced logout):', e && e.message);
        }

        // Check of er al een sessie is. De auth-check leest qe_user uit localStorage
        // via api-bridge.js — als de OTA-detectie hierboven qe_user heeft gewist,
        // valt deze automatisch terug op showLogin().
        try {
            const res = await fetch('api/auth.php?action=check');
            const data = await res.json();
            if (data.loggedIn && data.user) {
                this.currentUser = data.user;
                this.showApp();
            } else {
                this.showLogin();
            }
        } catch (e) {
            this.showLogin();
        }

        // Offline detection
        window.addEventListener('online', () => this.updateOnlineStatus());
        window.addEventListener('offline', () => this.updateOnlineStatus());
        this.updateOnlineStatus();

        // Timer herstellen als app weer zichtbaar wordt (na achtergrond)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                // Timer herstart
                if (this.timer.running) {
                    clearInterval(this.timer.interval);
                    this.timer.interval = setInterval(() => this.updateTimerDisplay(), 1000);
                    this.updateTimerDisplay();
                }
                // v158: Mollie polling — direct Worker check bij visibility return.
                // Onafhankelijk van Java's onResume (die soms niet fire't bij
                // Tap-return). Page Visibility API is de meest betrouwbare
                // signaal voor "WebView is weer zichtbaar".
                if (typeof this.onAppResumed === 'function') {
                    try { this.onAppResumed(); } catch(_) {}
                }
            }
        });

        // v158: Focus event als extra trigger — sommige Android-WebView versies
        // fire'n alleen focus en geen visibilitychange bij activity-resume.
        window.addEventListener('focus', () => {
            if (typeof this.onAppResumed === 'function') {
                try { this.onAppResumed(); } catch(_) {}
            }
        });

        // v158: pageshow vangt het geval op waarbij de pagina uit de bfcache
        // gehaald wordt (gebeurt bij sommige back-navigation paden).
        window.addEventListener('pageshow', (e) => {
            if (e.persisted && typeof this.onAppResumed === 'function') {
                try { this.onAppResumed(); } catch(_) {}
            }
        });
    },

    // ========================================
    // LOGIN
    // ========================================
    showLogin() {
        document.getElementById('loginScreen').classList.remove('hidden');
    },

    /**
     * v98+: zet een fetch/JSON-fout om naar een duidelijke Nederlandse
     * foutmelding voor de monteur. Geeft hint of het aan internet,
     * aan Robaws of aan onze app ligt.
     */
    _friendlyError(e) {
        const msg = (e && e.message) || String(e || '');
        if (!navigator.onLine) {
            return 'Geen internet — controleer wifi/4G en probeer opnieuw';
        }
        if (/Failed to fetch|NetworkError|Network request failed/i.test(msg)) {
            return 'Geen verbinding met de server — controleer internet';
        }
        if (/SyntaxError|Unexpected token|JSON/i.test(msg)) {
            return 'Server gaf een ongeldig antwoord — probeer opnieuw';
        }
        if (/timeout|aborted/i.test(msg)) {
            return 'Server reageert niet (timeout) — probeer opnieuw';
        }
        if (/40[134]/i.test(msg)) {
            return 'Toegang geweigerd door server (' + msg + ')';
        }
        if (/50\d/i.test(msg)) {
            return 'Serverfout (' + msg + ') — neem contact op met Levi';
        }
        return 'Fout: ' + (msg || 'onbekend');
    },

    // PIN-flow stap 1: e-mail controleren, daarna PIN-stap tonen
    async loginCheckEmail() {
        const email = document.getElementById('loginEmail').value.trim().toLowerCase();
        const errorEl = document.getElementById('loginError');
        const btn = document.getElementById('loginBtn');
        errorEl.textContent = '';

        if (!email) { errorEl.textContent = 'Vul je e-mailadres in'; return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errorEl.textContent = 'Ongeldig e-mailadres';
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Even kijken...';
        try {
            const res = await fetch('api/auth.php?action=check-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }
            const data = await res.json();
            if (!data.known) {
                errorEl.textContent = 'Onbekend e-mailadres';
                return;
            }

            this._loginEmail = email;
            this._loginNeedsPinSetup = !data.hasPin;

            // Toon stap 2
            document.getElementById('loginStepEmail').style.display = 'none';
            document.getElementById('loginStepPin').style.display = 'block';
            document.getElementById('loginEmailDisplay').textContent = email;
            document.getElementById('loginPin').value = '';
            document.getElementById('loginPinConfirm').value = '';
            document.getElementById('loginPinError').textContent = '';

            if (this._loginNeedsPinSetup) {
                document.getElementById('loginCardTitle').textContent = 'PIN instellen';
                document.getElementById('loginPinSubtitle').textContent = 'Eerste keer inloggen — kies een PIN (4–6 cijfers):';
                document.getElementById('loginPinLabel').textContent = 'Nieuwe PIN';
                document.getElementById('loginPinConfirmGroup').style.display = 'block';
                document.getElementById('loginPinBtn').textContent = 'PIN instellen & inloggen';
            } else {
                document.getElementById('loginCardTitle').textContent = 'Inloggen';
                document.getElementById('loginPinSubtitle').textContent = 'Voer je PIN in';
                document.getElementById('loginPinLabel').textContent = 'PIN';
                document.getElementById('loginPinConfirmGroup').style.display = 'none';
                document.getElementById('loginPinBtn').textContent = 'Inloggen';
            }
            setTimeout(() => document.getElementById('loginPin').focus(), 50);
        } catch (e) {
            console.warn('[App] login email check fout:', e);
            errorEl.textContent = this._friendlyError(e);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Volgende';
        }
    },

    loginBack() {
        document.getElementById('loginStepPin').style.display = 'none';
        document.getElementById('loginStepEmail').style.display = 'block';
        document.getElementById('loginCardTitle').textContent = 'Inloggen';
    },

    async loginSubmitPin() {
        const errorEl = document.getElementById('loginPinError');
        const btn = document.getElementById('loginPinBtn');
        const pin = document.getElementById('loginPin').value.trim();
        errorEl.textContent = '';

        if (!/^\d{4,6}$/.test(pin)) {
            errorEl.textContent = 'PIN moet 4 tot 6 cijfers zijn';
            return;
        }

        let body = { email: this._loginEmail };
        if (this._loginNeedsPinSetup) {
            const confirm = document.getElementById('loginPinConfirm').value.trim();
            if (pin !== confirm) {
                errorEl.textContent = 'PINs komen niet overeen';
                return;
            }
            body.newPin = pin;
        } else {
            body.pin = pin;
        }

        btn.disabled = true;
        btn.textContent = 'Bezig...';
        try {
            const res = await fetch('api/auth.php?action=login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            // v132: ook bij non-OK status de body lezen — APIBridge stuurt
            // 401 met de echte foutmelding in `error`. Vroeger werd dat
            // overschreven door een generieke "Toegang geweigerd (HTTP 401)".
            let data = null;
            try { data = await res.json(); } catch(_) {}
            if (!res.ok) {
                const msg = (data && data.error) ? data.error : ('HTTP ' + res.status);
                console.warn('[App] login PIN fout (server):', res.status, msg);
                errorEl.textContent = msg;
                return;
            }
            if (!data || data.error || !data.success) {
                errorEl.textContent = (data && data.error) || 'Verkeerde PIN — probeer opnieuw';
                return;
            }
            this.currentUser = data.user;
            this.showApp();
        } catch (e) {
            console.warn('[App] login PIN fout:', e);
            errorEl.textContent = this._friendlyError(e);
        } finally {
            btn.disabled = false;
            btn.textContent = this._loginNeedsPinSetup ? 'PIN instellen & inloggen' : 'Inloggen';
        }
    },

    // Behouden voor backward-compat (oude knoppen of code paths)
    doLogin() { return this.loginCheckEmail(); },

    async logout() {
        // BUG-fix: voorheen werd location.reload() direct uitgevoerd
        // zonder de fetch te awaiten en zonder user-gebonden localStorage
        // te wissen. Daardoor lekte woData/favorites/pending payments
        // van de vorige user naar de volgende op hetzelfde toestel.
        try { await fetch('api/auth.php?action=logout'); } catch(e) {}

        // Wis enkel sleutels die user-gebonden zijn. Sleutels die voor
        // het apparaat zelf bedoeld zijn (NFC-tag mappings, app versie
        // info) blijven staan.
        try {
            const userBoundPrefixes = [
                'qe_user',                  // huidige sessie
                'qe_wo_data',               // werkbon-state per WO
                'qe_fav_materials',         // favorieten van vorige user
                'qe_last_payment',          // betaling-state
                'qe_last_overschrijving',
                'qe_last_wo_create_res',    // debug payloads
                'qe_last_wo_put_req',
                'qe_last_wo_put_res',
                'qe_last_wo_verify',
                'qe_clock_pending',         // offline klok-queue
                'qe_pending_payments',
                'qe_submitted_wos',
                'qe_timer_state',
                'qe_timer_correction',
                'qe_active_role_override',  // v117: test-rolwissel uit profiel

                'qe_clock_pending_',       // v72: per-user pending sync queue (prefix-match)
            ];
            const planItemPrefix = 'planItem_';
            const clockSessionPrefix = 'qe_clock_v2_';
            const empCachePrefix = 'qe_emp_cache_'; // mag staan voor offline login
            const avatarPrefix = 'qe_avatar_';      // mag staan
            const pinPrefix = 'qe_pin_';            // mag staan voor offline PIN-check

            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (userBoundPrefixes.includes(k)) { toRemove.push(k); continue; }
                if (k.startsWith(planItemPrefix)) { toRemove.push(k); continue; }
                if (k.startsWith(clockSessionPrefix)) { toRemove.push(k); continue; }
                // empCache, avatar, pin: NIET wissen — die zijn nodig voor
                // snelle herlogin en offline-fallback.
                void empCachePrefix; void avatarPrefix; void pinPrefix;
            }
            for (const k of toRemove) {
                try { localStorage.removeItem(k); } catch(e) {}
            }
        } catch(e) { console.warn('[logout] cleanup fout:', e); }

        this.currentUser = null;
        location.reload();
    },

    showApp() {
        document.getElementById('loginScreen').classList.add('hidden');
        const roleLabel = this.currentUser.roleName || (this.isMonteur() ? 'Monteur' : 'Technieker');
        document.getElementById('headerUser').textContent = `${this.currentUser.name} — ${roleLabel}`;
        // Body-class zetten zodat CSS elementen kan verbergen voor monteurs
        document.body.classList.toggle('monteur-mode', this.isMonteur());
        document.body.classList.toggle('technieker-mode', !this.isMonteur());
        // Avatar in header laden
        this.refreshAvatar();
        this.buildDateStrip();
        this.updateHeaderDate();
        this.loadPlanning();

        // Achtergrond: sync artikelen als nodig + verwerk offline wachtrij
        this.backgroundSync();
        // Kloksysteem: internet-tijd laden + tags laden + pending sync
        if (typeof QEClock !== 'undefined') {
            // Laad internet-tijd offset (Brussel) zodat toesteltijd niet gemanipuleerd kan worden
            if (QEClock._loadServerTimeOffset) QEClock._loadServerTimeOffset().catch(e => console.warn('[App] Internet-tijd laden fout:', e));
            if (QEClock.loadTagConfig) QEClock.loadTagConfig().catch(e => console.warn('[App] NFC tags laden fout:', e));
            if (QEClock.syncPending) QEClock.syncPending().catch(e => console.warn('[App] Klok sync fout:', e));
        }
        // Start polling voor nieuwe planning-items
        this.startPlanningPoll();
        // Dark mode herstellen
        if (localStorage.getItem('qe_dark_mode') === '1') document.body.classList.add('dark-mode');
    },

    // ========================================
    // PROFIEL / AVATAR
    // ========================================
    _initial(name) {
        return (name || '?').trim().charAt(0).toUpperCase() || '?';
    },

    /**
     * Force-refresh avatar uit Robaws (skip cache). Wordt aangeroepen bij login
     * zodat een gewijzigde profielfoto op een ander toestel ook hier opduikt.
     * Wist NOOIT de cache als Robaws faalt.
     */
    async refreshAvatarFromRobaws() {
        if (!this.currentUser || !this.currentUser.email) return;
        try {
            const email = this.currentUser.email.toLowerCase();
            const backup = localStorage.getItem('qe_avatar_' + email);
            try { localStorage.removeItem('qe_avatar_' + email); } catch(_) {}
            const res = await fetch('api/profile.php?action=get-avatar');
            const data = await res.json();
            if (data && data.dataUrl) {
                this._avatarDataUrl = data.dataUrl;
                const imgHeader = document.getElementById('headerAvatarImg');
                const fbHeader = document.getElementById('headerAvatarFallback');
                if (imgHeader) { imgHeader.src = data.dataUrl; imgHeader.style.display = ''; }
                if (fbHeader) fbHeader.style.display = 'none';
                console.log('[App] Avatar ververst uit Robaws');
            } else if (backup) {
                try { localStorage.setItem('qe_avatar_' + email, backup); } catch(_) {}
            }
        } catch (e) {
            console.warn('[App] refreshAvatarFromRobaws faalde — cache behouden:', e.message);
        }
    },

    async refreshAvatar() {
        const name = this.currentUser?.name || '';
        const initial = this._initial(name);
        const fbHeader = document.getElementById('headerAvatarFallback');
        const imgHeader = document.getElementById('headerAvatarImg');
        if (fbHeader) fbHeader.textContent = initial;
        try {
            const res = await fetch('api/profile.php?action=get-avatar');
            const data = await res.json();
            if (data && data.dataUrl) {
                if (imgHeader) { imgHeader.src = data.dataUrl; imgHeader.style.display = ''; }
                if (fbHeader) fbHeader.style.display = 'none';
                this._avatarDataUrl = data.dataUrl;
            } else {
                if (imgHeader) imgHeader.style.display = 'none';
                if (fbHeader) fbHeader.style.display = '';
                this._avatarDataUrl = null;
            }
        } catch (e) {
            if (imgHeader) imgHeader.style.display = 'none';
            if (fbHeader) fbHeader.style.display = '';
        }
    },

    openProfile() {
        const name = this.currentUser?.name || '';
        const roleLabel = this.currentUser?.roleName || (this.isMonteur() ? 'Monteur' : 'Technieker');
        const email = this.currentUser?.email || '';
        document.getElementById('profileName').textContent = name;
        document.getElementById('profileMeta').textContent = `${roleLabel} • ${email}`;
        const fb = document.getElementById('profilePhotoFallback');
        const img = document.getElementById('profilePhotoImg');
        fb.textContent = this._initial(name);
        if (this._avatarDataUrl) {
            img.src = this._avatarDataUrl;
            img.style.display = '';
            fb.style.display = 'none';
        } else {
            img.style.display = 'none';
            fb.style.display = '';
        }
        // Reset PIN-velden
        ['profileOldPin', 'profileNewPin', 'profileNewPinConfirm'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const msg = document.getElementById('profilePinMsg');
        if (msg) { msg.textContent = ''; msg.style.color = ''; }
        // Dark mode toggle synchroniseren
        const dmToggle = document.getElementById('darkModeToggle');
        if (dmToggle) dmToggle.checked = document.body.classList.contains('dark-mode');
        // App-versie tonen — Web (= www/git versie uit version.json)
        // en APK-versie (uit native bridge, vereist v106+ APK; degradeert sierlijk).
        const versionEl = document.getElementById('appVersionInfo');
        if (versionEl) {
            // Helper om APK-versie te lezen (graceful fallback)
            const apkVer = (() => {
                try {
                    if (window.QEBridge && typeof QEBridge.getApkVersionName === 'function') {
                        const n = QEBridge.getApkVersionName();
                        if (n) return n;
                    }
                } catch(_e) {}
                return null;
            })();
            fetch('version.json?t=' + Date.now()).then(r => r.json()).then(d => {
                versionEl.innerHTML = apkVer
                    ? `Web-versie: ${d.version}<br>App-versie: ${apkVer}`
                    : `Versie: ${d.version}`;
            }).catch(() => {
                const v = (window.QEBridge && QEBridge.getAppVersion) ? QEBridge.getAppVersion() : 0;
                const line1 = v > 0 ? `Versie: ${v}` : 'Versie onbekend';
                versionEl.innerHTML = apkVer
                    ? `Web-versie: ${v > 0 ? v : '?'}<br>App-versie: ${apkVer}`
                    : line1;
            });
        }
        const updateStatus = document.getElementById('updateStatus');
        if (updateStatus) updateStatus.style.display = 'none';

        // v117: rol-switcher card vullen + tonen (alleen voor bureel/technieker)
        this.renderRoleSwitch();

        // === DEBUG NFC TESTER — verwijder dit blok na security audit ===
        // Toont alleen een knop als debug-nfc.html bestaat (= debug-build).
        // In de productie-versie bestaat die file niet en gebeurt er niets.
        this._maybeShowNfcTesterButton();
        // === EINDE DEBUG NFC TESTER ===

        this.navigate('screenProfile');
    },

    // === DEBUG NFC TESTER — verwijder deze methode na security audit ===
    _maybeShowNfcTesterButton() {
        // Alleen voor Levi tonen — security audit is admin-only.
        const email = (this.currentUser && this.currentUser.email || '').toLowerCase();
        if (email !== 'levi@qe.be') {
            const existing = document.getElementById('btnDebugNfcTester');
            if (existing && existing.parentElement) existing.parentElement.remove();
            this._nfcTesterChecked = true;
            this._nfcTesterAvailable = false;
            return;
        }
        if (this._nfcTesterChecked) {
            const btn = document.getElementById('btnDebugNfcTester');
            if (btn) btn.style.display = this._nfcTesterAvailable ? 'block' : 'none';
            return;
        }
        let done = false;
        const finish = (exists, why) => {
            if (done) return;
            done = true;
            this._nfcTesterChecked = true;
            this._nfcTesterAvailable = exists;
            console.log('[DebugNFC] available=' + exists + ' (' + why + ')');
            if (exists) this._injectNfcTesterButton();
        };
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'debug-nfc.html', true);
            xhr.timeout = 5000;
            xhr.onload = () => {
                const text = xhr.responseText || '';
                console.log('[DebugNFC] xhr.status=' + xhr.status + ' text.length=' + text.length);
                const exists = text.length > 100 && text.indexOf('NFC Security Tester') !== -1;
                finish(exists, exists ? 'xhr-found' : 'xhr-no-marker');
            };
            xhr.onerror = () => finish(false, 'xhr-error');
            xhr.ontimeout = () => finish(false, 'xhr-timeout');
            xhr.send();
        } catch(e) {
            finish(false, 'xhr-exception: ' + e.message);
        }
    },
    _injectNfcTesterButton() {
        const profile = document.getElementById('screenProfile');
        if (!profile || document.getElementById('btnDebugNfcTester')) return;
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cssText = 'margin-bottom:12px;background:rgba(198,40,40,0.08);border:2px solid #C62828';
        card.innerHTML = `
            <div style="font-size:14px;font-weight:600;color:#C62828">🔓 NFC Security Tester</div>
            <div style="font-size:12px;color:var(--qe-grey);margin:4px 0 8px">Debug-tool om NFC-tags te scannen en kraakbaarheid te beoordelen.</div>
            <button id="btnDebugNfcTester" class="btn btn-full"
                style="background:#C62828;color:#fff;padding:12px"
                onclick="window.location='debug-nfc.html'">🔓 Open NFC tester</button>
        `;
        // .card:has() werkt niet in oudere WebViews — gebruik manuele loop
        let pinCard = null;
        const cards = profile.querySelectorAll('.card');
        for (const c of cards) {
            if (c.querySelector('#profileOldPin')) { pinCard = c; break; }
        }
        if (pinCard) profile.insertBefore(card, pinCard);
        else profile.appendChild(card);
    },
    // === EINDE DEBUG NFC TESTER ===

    checkForUpdate() {
        const btn = document.getElementById('btnCheckUpdate');
        const status = document.getElementById('updateStatus');
        if (btn) { btn.disabled = true; btn.textContent = 'Zoeken...'; }
        if (status) { status.style.display = 'block'; status.style.color = 'var(--qe-grey)'; status.textContent = 'Controleren op updates...'; }

        if (window.QEBridge && QEBridge.checkForUpdate) {
            QEBridge.checkForUpdate();
            // Poll elke seconde of de versie veranderd is
            const startVersion = QEBridge.getAppVersion ? QEBridge.getAppVersion() : 0;
            let checks = 0;
            const poll = setInterval(() => {
                checks++;
                const newVersion = QEBridge.getAppVersion ? QEBridge.getAppVersion() : 0;
                if (newVersion > startVersion) {
                    clearInterval(poll);
                    if (status) { status.style.color = 'var(--qe-green)'; status.textContent = ` Bijgewerkt naar versie ${newVersion}!`; }
                    if (btn) { btn.disabled = false; btn.textContent = 'Controleren'; }
                    const versionEl = document.getElementById('appVersionInfo');
                    if (versionEl) versionEl.textContent = `Huidige versie: ${newVersion}`;
                } else if (checks >= 30) {
                    clearInterval(poll);
                    if (status) { status.style.color = 'var(--qe-grey)'; status.textContent = 'Geen update beschikbaar'; }
                    if (btn) { btn.disabled = false; btn.textContent = 'Controleren'; }
                }
            }, 1000);
        } else {
            if (status) { status.style.color = '#c62828'; status.textContent = 'Updates niet beschikbaar in deze versie'; }
            if (btn) { btn.disabled = false; btn.textContent = 'Controleren'; }
        }
    },

    profilePickPhoto(source) {
        const id = source === 'camera' ? 'profilePhotoInputCamera' : 'profilePhotoInputGallery';
        const el = document.getElementById(id);
        if (el) el.click();
    },

    async profileHandlePhoto(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = () => reject(r.error);
                r.readAsDataURL(file);
            });
            // Direct lokaal tonen
            const img = document.getElementById('profilePhotoImg');
            const fb = document.getElementById('profilePhotoFallback');
            img.src = dataUrl;
            img.style.display = '';
            fb.style.display = 'none';
            // Upload
            this.toast('Foto uploaden…');
            const res = await fetch('api/profile.php?action=set-avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataUrl, filename: file.name || 'profielfoto.jpg' })
            });
            const data = await res.json();
            if (data && data.success) {
                this._avatarDataUrl = dataUrl;
                const himg = document.getElementById('headerAvatarImg');
                const hfb = document.getElementById('headerAvatarFallback');
                if (himg) { himg.src = dataUrl; himg.style.display = ''; }
                if (hfb) hfb.style.display = 'none';
                this.toast('Profielfoto bijgewerkt');
            } else {
                this.toast('Upload mislukt: ' + (data?.error || 'onbekend'));
            }
        } catch (e) {
            console.error(e);
            this.toast('Foto verwerken mislukt');
        } finally {
            input.value = '';
        }
    },

    async profileChangePin() {
        const oldPin = document.getElementById('profileOldPin').value.trim();
        const newPin = document.getElementById('profileNewPin').value.trim();
        const confirmPin = document.getElementById('profileNewPinConfirm').value.trim();
        const msg = document.getElementById('profilePinMsg');
        msg.style.color = 'var(--qe-red, #c00)';
        if (!/^\d{4,6}$/.test(oldPin)) { msg.textContent = 'Huidige PIN moet 4-6 cijfers zijn'; return; }
        if (!/^\d{4,6}$/.test(newPin)) { msg.textContent = 'Nieuwe PIN moet 4-6 cijfers zijn'; return; }
        if (newPin !== confirmPin) { msg.textContent = 'PINs komen niet overeen'; return; }
        try {
            const res = await fetch('api/auth.php?action=change-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: this.currentUser.email, oldPin, newPin })
            });
            const data = await res.json();
            if (data && data.success) {
                msg.style.color = 'var(--qe-green, #0a0)';
                msg.textContent = 'PIN gewijzigd';
                ['profileOldPin', 'profileNewPin', 'profileNewPinConfirm'].forEach(id => {
                    document.getElementById(id).value = '';
                });
            } else {
                msg.textContent = data?.error || 'PIN wijzigen mislukt';
            }
        } catch (e) {
            msg.textContent = 'Netwerkfout';
        }
    },

    // ========================================
    // ROLLEN
    // ========================================
    // Monteurs hebben een beperkte versie van de app: enkel uren + materiaal
    // registreren, geen prijzen, geen handtekening, geen betaling/factuur,
    // geen klantrapport. Alle andere rollen (Technieker, Projectleider, ...)
    // krijgen de volledige flow.
    /**
     * v117: actieve rol = basis-rol uit EMPLOYEES tenzij er een test-override
     * is geactiveerd via het profielscherm. Bewaard in localStorage onder
     * 'qe_active_role_override'. Geldigheid:
     *   - monteur: kan NIET overriden (altijd monteur)
     *   - technieker: kan overriden naar 'monteur' (niet 'bureel')
     *   - bureel: kan overriden naar 'monteur' of 'technieker'
     * Bij logout wordt de override gewist.
     */
    _activeRole() {
        if (!this.currentUser) return null;
        const base = this.currentUser.role;
        if (base === 'monteur') return 'monteur'; // monteur: geen override toegestaan
        let override = null;
        try { override = localStorage.getItem('qe_active_role_override'); } catch(_) {}
        if (!override) return base;
        // Valideer override is toegestaan voor deze user
        if (base === 'technieker' && (override === 'technieker' || override === 'monteur')) return override;
        if (base === 'bureel' && (override === 'bureel' || override === 'technieker' || override === 'monteur')) return override;
        return base;
    },
    isMonteur() {
        return this._activeRole() === 'monteur';
    },
    isTechnieker() {
        return !this.isMonteur();
    },

    /** Rendert de rol-switcher card in het profielscherm. */
    renderRoleSwitch() {
        const card = document.getElementById('roleSwitchCard');
        const sel = document.getElementById('roleSwitchSelect');
        const note = document.getElementById('roleSwitchNote');
        if (!card || !sel || !this.currentUser) return;

        const base = this.currentUser.role;
        // Monteurs zien deze card niet
        if (base === 'monteur') {
            card.style.display = 'none';
            return;
        }
        card.style.display = '';

        // Opties op basis van basis-rol
        let options;
        if (base === 'bureel') {
            options = [
                { value: 'bureel',     label: 'Bureel (standaard)' },
                { value: 'technieker', label: 'Technieker' },
                { value: 'monteur',    label: 'Monteur' },
            ];
        } else {
            // technieker
            options = [
                { value: 'technieker', label: 'Technieker (standaard)' },
                { value: 'monteur',    label: 'Monteur' },
            ];
        }

        const active = this._activeRole();
        sel.innerHTML = options.map(o =>
            `<option value="${o.value}" ${o.value === active ? 'selected' : ''}>${o.label}</option>`
        ).join('');

        // Indicator zichtbaar als override actief is
        if (active !== base) {
            note.style.display = '';
            note.textContent = 'Test-modus: app gedraagt zich als ' + active +
                ' (basis-rol: ' + base + ').';
        } else {
            note.style.display = 'none';
            note.textContent = '';
        }
    },

    /** Schakelt naar een andere actieve rol. */
    switchActiveRole(newRole) {
        if (!this.currentUser) return;
        const base = this.currentUser.role;
        // Validatie
        if (base === 'monteur') {
            this.toast('Monteurs kunnen niet van rol wisselen');
            return;
        }
        const allowed = (base === 'bureel')
            ? ['bureel', 'technieker', 'monteur']
            : ['technieker', 'monteur'];
        if (!allowed.includes(newRole)) {
            this.toast('Deze rol is niet toegestaan voor jou');
            return;
        }

        try {
            if (newRole === base) {
                localStorage.removeItem('qe_active_role_override');
            } else {
                localStorage.setItem('qe_active_role_override', newRole);
            }
        } catch(_) {}

        this.renderRoleSwitch();
        this.toast('Actieve rol: ' + newRole);

        // Sommige UI-elementen renderen op basis van rol — herlaad de planning
        // zodat bv. monteur-knoppen verschijnen/verdwijnen waar nodig.
        if (this.currentScreen === 'screenPlanning') {
            this.loadPlanning();
        }
    },

    // ========================================
    // v116/v167: UITKLOK-CHECK — openstaande werkbons
    // ========================================
    // Wordt aangeroepen door clock.js vóór `_clockOut`. Gedrag:
    //  - Geen openstaande werkbons → laat uitklokken door (return true).
    //  - Bureel + ≥1 openstaande → blokkeer (return false).
    //  - Technieker + ≥1 openstaande → vraag bevestiging:
    //        Ja → laat uitklokken door (return true). Werkbon blijft open.
    //        Nee → blokkeer (return false). (v167)
    //  - Monteur + >1 openstaande → blokkeer (return false).
    //  - Monteur + 1 openstaande → vraag overname:
    //        Ja → werknemer-aanvink-modal → vul uren in op die werkbon
    //             → auto-submit via executeMonteurSubmitFlow → return true.
    //        Nee → blokkeer (return false).
    async checkAndHandleOpenWorkordersBeforeClockOut(session) {
        if (!this.currentUser) return true; // safety: geen user → laat door

        // v126: loading-spinner tijdens de planning-fetch
        if (typeof this.showScanLoading === 'function') {
            try { this.showScanLoading('Openstaande werkbons checken…'); } catch(_) {}
        }
        const hideLoad = () => {
            if (typeof this.hideScanLoading === 'function') {
                try { this.hideScanLoading(); } catch(_) {}
            }
        };

        // 1. Vandaag-planning ophalen (met hasWerkbon-vlag)
        let openItems = [];
        try {
            const today = RobawsAPI._localDateStr();
            const empId = this.currentUser.robawsEmployeeId;
            const userId = this.currentUser.robawsUserId;
            const planning = await RobawsAPI.getPlanning(empId, today, userId);
            const items = (planning && planning.items) || [];
            openItems = items.filter(w => !w.hasWerkbon);
        } catch(e) {
            console.warn('[ClockOut-check] planning fetch faalde:', e && e.message);
            // Bij API-fout: laat uitklokken toch toe — we willen geen
            // werknemer-blokkade op infrastructuur-issues.
            hideLoad();
            return true;
        }

        if (openItems.length === 0) { hideLoad(); return true; }

        const isMonteur = this.isMonteur();

        // Vanaf hier komen er modals — spinner verbergen zodat die zichtbaar zijn
        hideLoad();

        // Bureel: altijd blokkeren bij open (geen werkbon-overname mogelijk)
        const activeRole = this._activeRole();
        if (activeRole === 'bureel') {
            await this._showMessageModal(
                'Openstaande werkbon',
                `Je hebt nog ${openItems.length} openstaande ${openItems.length === 1 ? 'werkbon' : 'werkbons'}. ` +
                'Werk die eerst af voor je uitklokt.'
            );
            return false;
        }

        // v167: Technieker mag dag eindigen met open werkbons — via bevestigingsdialog.
        // De werkbons blijven open zoals ze zijn; de technieker kan ze morgen verder afmaken.
        if (activeRole === 'technieker') {
            const accepted = await this._showTechniekerEndDayConfirm(openItems);
            return accepted;   // true = dag beëindigen, false = blijf ingeklokt
        }

        // Monteur + >1 open → blokkeren
        if (openItems.length > 1) {
            await this._showMessageModal(
                'Te veel openstaande werkbons',
                `Je hebt ${openItems.length} openstaande werkbons. Auto-overname werkt alleen bij ` +
                '1 openstaande werkbon. Werk de extra eerst manueel af.'
            );
            return false;
        }

        // Monteur + exact 1 open → vraag overname
        const wo = openItems[0];
        const accepted = await this._showKlokOvernameConfirm(wo);
        if (!accepted) {
            await this._showMessageModal(
                'Niet uitgeklokt',
                'Je mag niet uitklokken met een openstaande werkbon. Vul hem eerst af.'
            );
            return false;
        }

        // Werknemer-aanvink
        const employees = await this._showEmployeeCheckList(wo);
        if (!employees || employees.length === 0) {
            // Gebruiker heeft geannuleerd of geen werknemers → niet uitklokken
            return false;
        }

        // Vul uren in op de werkbon's woData
        this._fillKlokurenForMonteur(wo, employees, session);

        // Set currentWO + automatische uurcode (monteurProject)
        this.currentWO = wo;
        this.selectedUurcode = {
            id: RobawsAPI.WERKUUR_ARTICLE_IDS.monteurProject,
            name: 'Werkuur monteur - Project',
            salePrice: 65,
        };

        // Auto-submit. executeMonteurSubmitFlow navigeert intern naar planning;
        // dat is OK — daarna mag uitklokken alsnog doorgaan.
        try {
            await this.executeMonteurSubmitFlow();
        } catch(e) {
            console.warn('[ClockOut-check] monteur auto-submit faalde:', e && e.message);
            await this._showMessageModal(
                'Werkbon niet verzonden',
                'De werkbon kon niet automatisch verstuurd worden. ' +
                'Vul hem manueel af voor je uitklokt.'
            );
            return false;
        }
        return true; // OK om uit te klokken
    },

    /** Vul uren-blokken in op woData voor elke aangevinkte werknemer.
     *  Eén blok per werknemer met dezelfde start/eind/duur/pauze. */
    _fillKlokurenForMonteur(wo, employees, session) {
        const woId = wo.id;
        if (!this.woData[woId]) {
            this.woData[woId] = { hours: [], materials: [], photos: [], notes: '' };
        }

        // v74 kwartier-afronding zoals _clockOut hem berekent (4 min tolerantie)
        const TOL = 4;
        const roundUp15 = (mins) => {
            const r = mins % 15;
            if (r > 0 && r <= TOL) return mins - r;
            return Math.ceil(mins / 15) * 15;
        };
        const roundDown15 = (mins) => {
            const r = mins % 15;
            const d = (15 - r) % 15;
            if (d > 0 && d <= TOL) return mins + d;
            return Math.floor(mins / 15) * 15;
        };
        const toMin = (hhmm) => {
            const parts = String(hhmm).split(':');
            return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
        };
        const fromMin = (mins) => {
            const h = Math.floor(mins / 60) % 24;
            const m = mins % 60;
            return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
        };

        // Start = session start tijd, eind = huidige tijd
        const startTime = session && session.startTime ? session.startTime : '08:00';
        const now = new Date();
        const endTimeRaw = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');

        const entryStartMin = roundUp15(toMin(startTime));
        const entryEndMin   = roundDown15(toMin(endTimeRaw));
        const entryStart = fromMin(entryStartMin);
        const entryEnd   = fromMin(entryEndMin);

        // Pauze: persoonlijke pauze van de uitklokkende monteur
        const pauze = (window.QEClock && QEClock._personalPauze != null)
            ? QEClock._personalPauze : 60;

        const grossMin = Math.max(0, entryEndMin - entryStartMin);
        const netMin = Math.max(0, grossMin - pauze);

        const baseId = Date.now();
        employees.forEach((emp, idx) => {
            this.woData[woId].hours.push({
                id: baseId + idx,
                type: 'klant',
                startTime: entryStart,
                endTime: entryEnd,
                duration: netMin,
                pauze: pauze,
                employeeId: String(emp.id),
                employeeName: emp.name,
            });
        });

        this._saveWoData();
        console.log('[ClockOut-check] uren ingevuld op werkbon', woId,
            entryStart, '->', entryEnd, 'voor', employees.map(e => e.name).join(', '));
    },

    /** Modal die de monteur vraagt of hij de geklokte uren wil overnemen. */
    async _showKlokOvernameConfirm(wo) {
        return new Promise(resolve => {
            const clientName = (wo.client && wo.client.name) || wo.summary || 'Werkbon';
            document.getElementById('modalContent').innerHTML = `
                <h3>${this.icon('clock', { size: 18, style: 'vertical-align:-3px' })} Geklokte uren overnemen?</h3>
                <p style="font-size:14px;color:var(--qe-grey);margin:8px 0 14px">
                    Je hebt nog een openstaande werkbon:
                </p>
                <div style="background:#f8f9fa;border-radius:10px;padding:14px;margin-bottom:14px;border-left:4px solid var(--qe-purple)">
                    <div style="font-weight:600;font-size:15px">${this.escapeHtml(clientName)}</div>
                    ${wo.summary && clientName !== wo.summary
                        ? `<div style="font-size:12px;color:var(--qe-grey);margin-top:4px">${this.escapeHtml(wo.summary)}</div>`
                        : ''}
                </div>
                <p style="font-size:14px;line-height:1.45;margin-bottom:14px">
                    Wil je de geklokte uren overnemen naar deze werkbon en automatisch versturen?
                    Daarna word je uitgeklokt.
                </p>
                <button onclick="window._klokOvResp(true)" class="btn btn-primary btn-full"
                    style="padding:14px;font-size:15px;margin-bottom:8px">
                    ✓ Ja, overnemen + uitklokken
                </button>
                <button onclick="window._klokOvResp(false)" class="btn btn-outline btn-full"
                    style="padding:12px;font-size:14px">
                    Nee, blijf ingeklokt
                </button>
            `;
            this.openModal();
            window._klokOvResp = (val) => {
                this.closeModal();
                delete window._klokOvResp;
                resolve(val);
            };
        });
    },

    /** v167: Bevestigingsdialog voor techniekers die uit willen klokken met
     *  openstaande werkbons. Anders dan monteurs (die overname doen) mogen
     *  techniekers de werkbons gewoon open laten staan voor de volgende dag.
     *  Returns: true = dag beëindigen, false = blijf ingeklokt. */
    async _showTechniekerEndDayConfirm(openItems) {
        return new Promise(resolve => {
            const count = openItems.length;
            const woordvorm = count === 1 ? 'werkbon' : 'werkbons';
            const lijst = openItems.slice(0, 5).map(wo => {
                const clientName = (wo.client && wo.client.name) || wo.summary || 'Werkbon';
                return `<div style="font-size:13px;padding:4px 0;color:#374151">• ${this.escapeHtml(clientName)}</div>`;
            }).join('');
            const meer = count > 5 ? `<div style="font-size:12px;color:var(--qe-grey);padding-top:4px">… en ${count - 5} meer</div>` : '';

            document.getElementById('modalContent').innerHTML = `
                <h3>${this.icon('flag', { size: 18, style: 'vertical-align:-3px' })} Dag beëindigen?</h3>
                <p style="font-size:14px;color:var(--qe-grey);margin:8px 0 14px">
                    Je hebt nog ${count} openstaande ${woordvorm}:
                </p>
                <div style="background:#fff8e1;border-radius:10px;padding:14px;margin-bottom:14px;border-left:4px solid #f59e0b">
                    ${lijst}
                    ${meer}
                </div>
                <p style="font-size:14px;line-height:1.45;margin-bottom:14px">
                    Deze blijven open staan en kan je morgen afwerken. Wil je toch al uitklokken?
                </p>
                <button onclick="window._techEndResp(true)" class="btn btn-primary btn-full"
                    style="padding:14px;font-size:15px;margin-bottom:8px">
                    ✓ Ja, beëindig dag
                </button>
                <button onclick="window._techEndResp(false)" class="btn btn-outline btn-full"
                    style="padding:12px;font-size:14px">
                    Nee, blijf ingeklokt
                </button>
            `;
            this.openModal();
            window._techEndResp = (val) => {
                this.closeModal();
                delete window._techEndResp;
                resolve(val);
            };
        });
    },

    /** Modal met checkbox-lijst van werknemers gelinkt aan de werkbon.
     *  Returns: array van { id, name } of null bij annuleren. */
    async _showEmployeeCheckList(wo) {
        const empIds = (wo.employeeIds || []).map(String);
        let employees = [];
        try {
            employees = empIds.length > 0 ? await this._getEmployeeNames(empIds) : [];
        } catch(e) {
            console.warn('[ClockOut-check] _getEmployeeNames faalde:', e && e.message);
        }
        // Fallback: alleen huidige user
        if (employees.length === 0 && this.currentUser) {
            employees = [{
                id: String(this.currentUser.robawsEmployeeId),
                name: this.currentUser.name || 'Ik',
            }];
        }

        return new Promise(resolve => {
            const checkboxes = employees.map(e => `
                <label style="display:flex;align-items:center;gap:12px;padding:12px 14px;
                    border:1px solid #ddd;border-radius:10px;margin-bottom:8px;cursor:pointer;
                    background:#fff">
                    <input type="checkbox" class="emp-check"
                        data-id="${this.escapeHtml(String(e.id))}"
                        data-name="${this.escapeHtml(e.name)}"
                        checked
                        style="width:22px;height:22px;cursor:pointer">
                    <span style="font-size:15px;font-weight:500">${this.escapeHtml(e.name)}</span>
                </label>
            `).join('');

            document.getElementById('modalContent').innerHTML = `
                <h3>${this.icon('user', { size: 18, style: 'vertical-align:-3px' })} Voor wie zijn de uren?</h3>
                <p style="font-size:13px;color:var(--qe-grey);margin:8px 0 14px;line-height:1.4">
                    Vink aan wie er vandaag op deze werkbon werkte.
                    Iedereen krijgt dezelfde uren.
                </p>
                ${checkboxes}
                <button onclick="window._klokEmpResp(true)" class="btn btn-primary btn-full"
                    style="padding:14px;font-size:15px;margin-top:14px">
                    ✓ Bevestigen
                </button>
                <button onclick="window._klokEmpResp(false)" class="btn btn-outline btn-full"
                    style="padding:12px;font-size:14px;margin-top:8px">
                    Annuleren
                </button>
            `;
            this.openModal();
            window._klokEmpResp = (ok) => {
                if (!ok) {
                    this.closeModal();
                    delete window._klokEmpResp;
                    resolve(null);
                    return;
                }
                const checked = Array.from(document.querySelectorAll('.emp-check:checked'))
                    .map(cb => ({ id: cb.dataset.id, name: cb.dataset.name }));
                this.closeModal();
                delete window._klokEmpResp;
                resolve(checked);
            };
        });
    },

    /** Simpele info-modal met 1 OK-knop. */
    async _showMessageModal(title, message) {
        return new Promise(resolve => {
            document.getElementById('modalContent').innerHTML = `
                <h3>${this.escapeHtml(title)}</h3>
                <p style="margin:14px 0;font-size:14px;line-height:1.5;color:var(--qe-darkblue)">
                    ${this.escapeHtml(message)}
                </p>
                <button onclick="window._klokMsgResp()" class="btn btn-primary btn-full"
                    style="padding:14px;font-size:15px;margin-top:8px">
                    OK
                </button>
            `;
            this.openModal();
            window._klokMsgResp = () => {
                this.closeModal();
                delete window._klokMsgResp;
                resolve();
            };
        });
    },

    async backgroundSync() {
        try {
            // Quick sync: alleen als >1 uur geleden of nooit
            const syncRes = await fetch('api/sync.php?action=quick', { method: 'POST' });
            const syncData = await syncRes.json();
            if (syncData.success) {
                console.log(`Sync voltooid: ${syncData.articles} artikelen, ${syncData.groups} groepen`);
            }
        } catch (e) {
            console.log('Sync overgeslagen (offline?)');
        }

        // Verwerk offline werkbonnen als we online zijn
        if (navigator.onLine) {
            this.processOfflineQueue();
        }
    },

    async processOfflineQueue() {
        try {
            const res = await fetch('api/werkbon-queue.php?action=process', { method: 'POST' });
            const data = await res.json();
            if (data.processed > 0) {
                this.toast(`${data.processed} werkbon(nen) uit wachtrij verstuurd`);
            }
            if (data.failed > 0) {
                console.warn('Werkbon queue fouten:', data.errors);
            }
        } catch (e) { /* skip */ }
    },

    // ========================================
    // NAVIGATION
    // ========================================
    navigate(screenId, pushHistory = true) {
        if (pushHistory && this.currentScreen !== screenId) {
            this.screenHistory.push(this.currentScreen);
            // Voeg ook een entry toe aan window.history zodat de Android
            // back-knop deze stap kan terugzetten (zie popstate-handler in init).
            try { history.pushState({ qeApp: true, screen: screenId }, '', location.pathname); } catch(_) {}
        }

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screenEl = document.getElementById(screenId);
        if (!screenEl) { console.warn('[App] Scherm niet gevonden:', screenId); return; }
        screenEl.classList.add('active');
        this.currentScreen = screenId;

        // Update nav
        document.querySelectorAll('.nav-item').forEach(n => {
            n.classList.toggle('active', n.dataset.screen === screenId);
        });

        // Update header
        const titles = {
            screenPlanning: 'Dagplanning',
            screenDetail: this.currentWO?.client?.name || 'Werkorder',
            screenWerkbon: 'Werkbon overzicht',
            screenInstHistory: 'Installatie historiek',
            screenOrderDetail: 'Order detail',
            screenPayment: 'Betaling',
            screenUitgevoerd: 'Uitgevoerd',
            screenCorrectie: 'Werkbon corrigeren',
            screenProfile: 'Mijn profiel',
            screenDagoverzicht: 'Mijn registraties',
            screenAanpassing: 'Aanpassing aanvragen',
            screenOverschrijving: 'Overschrijving',
            screenClock: 'Klok',
        };
        document.getElementById('headerTitle').textContent = titles[screenId] || '';

        const backBtn = document.getElementById('headerBack');
        // Geen back-button op hoofdschermen EN op betaalschermen (factuur is al aangemaakt, mag niet herhaald worden)
        const noBackScreens = ['screenPlanning', 'screenUitgevoerd', 'screenDagoverzicht', 'screenClock', 'screenPayment', 'screenOverschrijving'];
        backBtn.classList.toggle('visible', !noBackScreens.includes(screenId));

        // Scroll to top
        window.scrollTo(0, 0);

        if (screenId === 'screenUitgevoerd') this.loadUitgevoerd();
        if (screenId === 'screenDagoverzicht') this.loadDagoverzicht(0);
        if (screenId === 'screenClock') this.onNavigateToClock();

        // v137: toon FAB enkel op planning-tab + niet voor monteurs
        this._updateNewWoFabVisibility();
    },

    /**
     * v176: refresh ALLEEN het huidige scherm i.p.v. de hele app.
     * Wordt aangeroepen vanuit de native SwipeRefreshLayout (zie MainActivity.java).
     * Stopt de native spinner via QEBridge.refreshDone() in een finally-block,
     * zodat de spinner ook stopt als de refresh-loader gooit.
     */
    async refreshCurrentScreen() {
        const screen = this.currentScreen;
        console.log('[Refresh] Refresh huidig scherm:', screen);
        try {
            switch (screen) {
                case 'screenPlanning':
                    await this.loadPlanning();
                    break;
                case 'screenDagoverzicht':
                    await this.loadDagoverzicht();
                    break;
                case 'screenUitgevoerd':
                    await this.loadUitgevoerd();
                    break;
                case 'screenClock':
                    if (typeof this.onNavigateToClock === 'function') {
                        await this.onNavigateToClock();
                    }
                    break;
                case 'screenDetail':
                    // Werkbon-detail: herlaad als we de WO nog hebben
                    if (this.currentWO && this.currentWO.id) {
                        await this.openWorkorder(this.currentWO.id);
                    }
                    break;
                case 'screenOrderDetail':
                    if (this._lastOrderDetailId) {
                        await this.openOrderDetail(this._lastOrderDetailId);
                    }
                    break;
                case 'screenInstHistory':
                    if (this._lastInstHistoryId) {
                        await this.openInstallationHistory(this._lastInstHistoryId);
                    }
                    break;
                case 'screenProfile':
                    // Profiel heeft geen dynamische data — niets te refreshen
                    break;
                default:
                    // Geen specifieke loader voor dit scherm: stilletjes niets doen.
                    console.log('[Refresh] Geen refresh-handler voor', screen);
            }
        } catch (e) {
            console.error('[Refresh] Refresh van', screen, 'mislukt:', e);
        } finally {
            // Stop het native SwipeRefresh-spinner ongeacht succes/fout.
            try {
                if (window.QEBridge && typeof QEBridge.refreshDone === 'function') {
                    QEBridge.refreshDone();
                }
            } catch (_) { /* native bridge mogelijk niet beschikbaar — geen probleem */ }
        }
    },

    /** v137: bepaalt of de + Nieuwe-werkbon FAB zichtbaar moet zijn. */
    _updateNewWoFabVisibility() {
        const fab = document.getElementById('newWoFab');
        if (!fab) return;
        const onPlanning = this.currentScreen === 'screenPlanning';
        const allowed    = this.currentUser && this._activeRole() !== 'monteur';
        fab.style.display = (onPlanning && allowed) ? 'flex' : 'none';
    },

    goBack() {
        // Vanaf betaalscherm/overschrijving: factuur is al aangemaakt, ga altijd naar planning
        if (this.currentScreen === 'screenPayment' || this.currentScreen === 'screenOverschrijving') {
            this.screenHistory = [];
            try { history.replaceState({ qeApp: true }, '', location.pathname); } catch(_) {}
            this.navigate('screenPlanning', false);
            this.loadPlanning();
            return;
        }
        // Trigger window.history.back() zodat zowel UI back-button als Android
        // back-button via dezelfde popstate-handler lopen (alles in sync).
        if (this.screenHistory.length > 0) {
            history.back();
        } else {
            this.navigate('screenPlanning', false);
        }
    },

    // ========================================
    // DATE STRIP — vorige werkdag + vandaag + volgende werkdag (weekend skippen)
    // v112: 3 chips i.p.v. 2 — monteurs moeten ook werkbonnen van gisteren
    // (of vorige vrijdag, op maandag) kunnen inzien en invullen.
    // ========================================
    buildDateStrip() {
        const strip = document.getElementById('dateStrip');
        const today = new Date();

        // v112: skip weekend voor "vorige werkdag"
        //   - maandag → vrijdag (3 dagen terug)
        //   - zondag  → vrijdag (2 dagen terug)
        //   - zaterdag → vrijdag (1 dag terug)
        //   - andere dagen → −1 dag
        const prev = new Date(today);
        prev.setDate(today.getDate() - 1);
        while (prev.getDay() === 0 || prev.getDay() === 6) {
            prev.setDate(prev.getDate() - 1);
        }

        // v92+: skip weekend voor "volgende werkdag"
        //   - vrijdag → maandag (3 dagen verder)
        //   - zaterdag → maandag (2 dagen verder)
        //   - zondag → maandag (1 dag verder)
        //   - andere dagen → +1 dag
        const next = new Date(today);
        next.setDate(today.getDate() + 1);
        while (next.getDay() === 0 || next.getDay() === 6) {
            next.setDate(next.getDate() + 1);
        }

        const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
        const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

        const dates = [prev, today, next];

        // Bepaal label voor "vorige werkdag" — Gisteren als het echt -1 dag is,
        // anders de weekdag-naam (bv. "Vrijdag" als vandaag maandag is).
        const yesterdayReal = new Date(today);
        yesterdayReal.setDate(today.getDate() - 1);
        const prevIsRealYesterday = prev.toDateString() === yesterdayReal.toDateString();

        // Bepaal het label voor de "volgende werkdag" — afhankelijk van of het morgen
        // letterlijk is, of een andere weekdag (bv. ma als het vandaag vr is)
        const tomorrowReal = new Date(today);
        tomorrowReal.setDate(today.getDate() + 1);
        const nextIsRealTomorrow = next.toDateString() === tomorrowReal.toDateString();
        const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];

        strip.innerHTML = dates.map(d => {
            const dateStr = this._localDateStr(d);
            const isToday = d.toDateString() === today.toDateString();
            const isActive = d.toDateString() === this.currentDate.toDateString();
            const isPrev = d.toDateString() === prev.toDateString();
            const label = isToday
                ? 'Vandaag'
                : isPrev
                    ? (prevIsRealYesterday ? 'Gisteren' : dayNames[d.getDay()])
                    : (nextIsRealTomorrow ? 'Morgen' : dayNames[d.getDay()]);

            return `
                <div class="date-chip ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}"
                     onclick="app.selectDate('${dateStr}')"
                     data-date="${dateStr}">
                    <div class="d-day">${days[d.getDay()]}</div>
                    <div class="d-num">${d.getDate()}</div>
                    <div class="d-month">${months[d.getMonth()]}</div>
                    <div class="d-label">${label}</div>
                </div>
            `;
        }).join('');
    },

    selectDate(dateStr) {
        this.currentDate = new Date(dateStr + 'T12:00:00');
        this.buildDateStrip();
        this.updateHeaderDate();
        this.loadPlanning();
    },

    updateHeaderDate() {
        const opts = { weekday: 'long', day: 'numeric', month: 'long' };
        document.getElementById('headerDate').textContent = this.currentDate.toLocaleDateString('nl-BE', opts);
    },

    // ========================================
    // PLANNING LADEN
    // ========================================
    async loadPlanning() {
        // Clock status bar updaten (direct met lokale data)
        this.updateClockUI();
        // Startuur ophalen van Robaws als dat nog niet gebeurd is voor deze user
        if (window.QEClock) {
            const user = RobawsAPI.getLoggedInUser();
            const userId = user ? String(user.robawsEmployeeId) : null;
            if (userId && QEClock._startuurLoadedForUser !== userId) {
                QEClock.loadTagConfig().then(() => this.updateClockUI())
                    .catch(e => console.warn('[Clock] Tag config error:', e));
            }
            QEClock.syncWithRobaws().then(() => this.updateClockUI())
                .catch(e => console.warn('[Clock] Sync error:', e));
        }

        const list = document.getElementById('workorderList');
        list.innerHTML = this._skelList(4);

        const dateStr = this._localDateStr(this.currentDate);

        try {
            const url = `api/planning.php?date=${dateStr}`;
            console.log('[QE] Fetching:', url);
            const res = await fetch(url);
            const text = await res.text();
            console.log('[QE] Response:', res.status, text.substring(0, 300));

            let data;
            try {
                data = JSON.parse(text);
            } catch (parseErr) {
                throw new Error('Server gaf geen geldige JSON terug. Check of PHP correct werkt.');
            }

            if (data.error) {
                throw new Error(data.error);
            }

            // Filter: verberg dagplanningen die in Robaws al ≥1 werkbon hebben.
            // Robaws is de enige bron van waarheid — géén lokale cache meer,
            // anders blijven planningen voor altijd verborgen na een test-werkbon.
            const allItems = data.items || [];
            this.workorders = allItems.filter(wo => !wo.hasWerkbon);
            document.getElementById('woCount').textContent = this.workorders.length;

            if (this.workorders.length === 0) {
                const isToday = dateStr === this._localDateStr();
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">${this.icon('clipboard', { size: 44, stroke: 1.6 })}</div>
                        <h3>Geen werkorders</h3>
                        <p>Geen werkorders voor ${isToday ? 'vandaag' : 'morgen'}</p>
                    </div>
                `;
                this.renderPendingPaymentsBanner();
                return;
            }

            list.innerHTML = this.workorders.map(wo => this.renderWorkorderCard(wo)).join('');
            this.renderPendingPaymentsBanner();

            // Route-knop tonen als er meerdere werkorders met adres zijn
            const addressCount = this.workorders.filter(wo => wo.address || wo.client?.address).length;
            const routeBtn = document.getElementById('routePlanBtn');
            if (routeBtn) routeBtn.style.display = addressCount >= 2 ? '' : 'none';

            // Klanthistoriek laden op achtergrond (badge update)
            this._loadClientHistory();

            // Init WO data
            this.workorders.forEach(wo => {
                if (!this.woData[wo.id]) {
                    this.woData[wo.id] = {
                        hours: [],
                        materials: [],
                        photos: [],
                        notes: '',
                    };
                }
            });
        } catch (err) {
            console.error('Planning laden mislukt:', err);
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">${this.icon('alert', { size: 44, stroke: 1.6 })}</div>
                    <h3>Fout bij laden</h3>
                    <p style="font-size:12px;color:var(--qe-grey);word-break:break-all;margin-bottom:8px">${this.escapeHtml(err.message)}</p>
                    <button class="btn btn-primary btn-sm" onclick="app.loadPlanning()">Opnieuw proberen</button>
                </div>
            `;
        }
    },

    // v187: inline lijn-icoon helper (vervangt emoji-iconen, geen externe webfont nodig)
    icon(name, opts) {
        opts = opts || {};
        const s = opts.size || 18;
        const sw = opts.stroke || 2;
        const cls = opts.cls ? ` class="${opts.cls}"` : '';
        const st = opts.style ? ` style="${opts.style}"` : '';
        const P = {
            'map-pin': '<path d="M12 21s-6-5.7-6-10a6 6 0 0 1 12 0c0 4.3-6 10-6 10z"/><circle cx="12" cy="11" r="2.3"/>',
            'phone': '<path d="M5 4h3.5l1.5 4.5L8 10a11 11 0 0 0 5 5l1.6-2 4.4 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 1-2z"/>',
            'mail': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
            'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
            'calendar': '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 10h16"/>',
            'clipboard': '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/>',
            'cash': '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v6M18 9v6"/>',
            'percent': '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
            'user': '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
            'navigation': '<path d="M3 11 21 3l-8 18-2-7-8-3z"/>',
            'check': '<path d="M5 12l4 4 10-10"/>',
            'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
            'alert': '<path d="M12 4 3 19h18z"/><path d="M12 10v4M12 17h.01"/>',
            'package': '<path d="M12 3 21 7.5v9L12 21 3 16.5v-9z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
            'minus': '<path d="M5 12h14"/>',
            'tool': '<path d="M15.5 5.5a3.5 3.5 0 0 0-4.4 4.4l-5.3 5.3a1.5 1.5 0 1 0 2.1 2.1l5.3-5.3a3.5 3.5 0 0 0 4.4-4.4L15.2 9 13 8.8 12.8 6.6z"/>',
            'car': '<path d="M6 11l1.5-4h9L18 11M5 16h14M7 11h10a2 2 0 0 1 2 2v3H5v-3a2 2 0 0 1 2-2z"/><circle cx="8" cy="16.5" r="1.4"/><circle cx="16" cy="16.5" r="1.4"/>',
            'coffee': '<path d="M5 8h11v4a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 9h2a2 2 0 0 1 0 4h-2"/><path d="M7 3v2M10 3v2M13 3v2"/>',
            'edit': '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/>',
            'file': '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 12h5M9.5 15.5h5"/>',
            'folder': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
            'refresh': '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
            'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/>',
            'download': '<path d="M12 4v10M8 11l4 4 4-4"/><path d="M5 19h14"/>',
            'card': '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 14.5h4"/>',
            'bank': '<path d="M4 10h16M4 10 12 4l8 6M6 10v7M10 10v7M14 10v7M18 10v7M4 19h16"/>',
            'flag': '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
            'phone-off': '<path d="M9 3.5 4 4l1 5-2 1.5a11 11 0 0 0 5 5.5"/><path d="M3 3l18 18"/>',
            'thermometer': '<path d="M12 4a2 2 0 0 1 2 2v7a4 4 0 1 1-4 0V6a2 2 0 0 1 2-2z"/>',
            'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
            'gift': '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 13h16M12 9v11"/><path d="M12 9C9 9 7.5 7.5 8 6s3-1 4 3c1-4 3.5-4.5 4-3s-1 3-4 3z"/>',
            'moon': '<path d="M20 14A8 8 0 0 1 10 4a7 7 0 1 0 10 10z"/>',
            'users': '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6M21 20a6 6 0 0 0-4.5-5.8"/>',
            'hourglass': '<path d="M7 4h10M7 20h10M8 4c0 5 8 3 8 8s-8 3-8 8M16 4c0 5-8 3-8 8s8 3 8 8"/>',
            'paperclip': '<path d="M20 11l-8 8a4.5 4.5 0 0 1-6.4-6.4l8.5-8.5a3 3 0 0 1 4.3 4.3l-8.5 8.5a1.5 1.5 0 0 1-2.1-2.1l7.8-7.8"/>',
            'image': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 16-5-5L5 20"/>',
            'star': '<path d="M12 4l2.3 4.7 5.2.8-3.8 3.7.9 5.1-4.6-2.4-4.6 2.4.9-5.1L4.5 9.5l5.2-.8z"/>',
            'camera': '<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.2"/>',
            'mail-send': '<path d="M3 6h18v12H3z"/><path d="m3 7 9 6 9-6"/>',
            'x': '<path d="M6 6l12 12M18 6 6 18"/>',
            'home': '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>',
            'flame': '<path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 .5-3-1-5 1-7.5z"/>',
            'droplet': '<path d="M12 4c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z"/>',
            'bolt': '<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
            'wind': '<path d="M3 9h10a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 14h13a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 11.5h7"/>'
        };
        return `<svg${cls}${st} width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
    },

    // v187: skeleton-lijst tijdens laden (vervangt de spinner -> rustiger overgang)
    _skelList(n) {
        let r = '';
        for (let i = 0; i < (n || 4); i++) {
            r += `<div class="qe-skel-row"><div class="qe-skel" style="width:42px;height:34px"></div><div style="flex:1"><div class="qe-skel" style="width:55%;height:12px;margin-bottom:8px"></div><div class="qe-skel" style="width:78%;height:10px"></div></div></div>`;
        }
        return `<div class="qe-skel-list">${r}</div>`;
    },

    // v187: tellende getallen (uren-overzicht)
    _animateCountUps(root) {
        try {
            const els = (root || document).querySelectorAll('.qe-countup[data-count]');
            els.forEach((el) => {
                const target = parseFloat(el.getAttribute('data-count')) || 0;
                const dec = parseInt(el.getAttribute('data-dec') || '0', 10);
                if (!target) { el.textContent = target.toFixed(dec); return; }
                const dur = 750; let t0 = null;
                const step = (ts) => {
                    if (!t0) t0 = ts;
                    const p = Math.min((ts - t0) / dur, 1);
                    const e = 1 - Math.pow(1 - p, 3);
                    el.textContent = (target * e).toFixed(dec);
                    if (p < 1) requestAnimationFrame(step); else el.textContent = target.toFixed(dec);
                };
                requestAnimationFrame(step);
            });
        } catch (e) { /* animatie mag de UI nooit breken */ }
    },

    renderWorkorderCard(wo) {
        const start = wo.startDate ? new Date(wo.startDate) : null;
        const timeStr = start ? start.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
        const clientName = wo.client?.name || wo.summary || 'Onbekend';
        const address = wo.address || wo.client?.address || '';

        // Type detection
        let type = 'onderhoud';
        let typeLabel = 'Onderhoud';
        const summary = (wo.summary || '').toLowerCase();
        if (summary.includes('herstel') || summary.includes('repair') || summary.includes('panne')) {
            type = 'herstelling'; typeLabel = 'Herstelling';
        } else if (summary.includes('install') || summary.includes('plaatsing')) {
            type = 'installatie'; typeLabel = 'Installatie';
        }

        const data = this.woData[wo.id];
        const hasMaterials = data?.materials?.length > 0;
        const hasHours = data?.hours?.length > 0;

        const orderNr = wo.orderLogicId || '';

        // Klanthistoriek badge
        const clientId = wo.client?.id || wo.clientId;
        const histCount = this._clientHistoryCache?.[clientId] || 0;
        const histBadge = histCount > 0
            ? `<span style="margin-left:6px;font-size:10px;padding:2px 6px;border-radius:8px;background:rgba(106,44,145,0.12);color:var(--qe-purple);font-weight:600" title="${histCount} eerder${histCount > 1 ? 'e' : ''} bezoek${histCount > 1 ? 'en' : ''}">${histCount}× bezocht</span>`
            : '';

        const tel = wo.client?.tel || wo.client?.phone || '';
        // v181: regie (tijd & materiaal) zichtbaar maken in de planning-lijst
        const isRegie = !!wo.timeAndMaterial;
        const regieChip = isRegie
            ? `<span class="wo-regie-tag">${this.icon('cash', { size: 13 })} Regie</span>`
            : '';

        return `
            <div class="card card-clickable" onclick="app.openWorkorder('${wo.id}')">
                <div class="wo-card">
                    <div class="wo-time">
                        <div class="t-hour">${timeStr}</div>
                    </div>
                    <div class="wo-info">
                        <h3>${this.escapeHtml(clientName)}</h3>
                        ${wo.summary ? `<div style="font-size:13px;color:var(--qe-darkblue);font-weight:500;margin:2px 0">${this.escapeHtml(wo.summary)}</div>` : ''}
                        ${address ? `<div class="wo-address">${this.icon('map-pin', { size: 14 })} ${this.escapeHtml(address)}</div>` : ''}
                        <span class="wo-type ${type}">${typeLabel}</span>${regieChip}
                        ${orderNr ? `<span style="margin-left:6px;font-size:11px;color:var(--qe-purple);font-weight:500">${this.escapeHtml(orderNr)}</span>` : ''}
                        ${histBadge}
                        ${hasMaterials || hasHours ? `<span style="margin-left:6px;font-size:11px;color:var(--qe-green)">${this.icon('check', { size: 12, style: 'vertical-align:-2px' })} In bewerking</span>` : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;align-items:center;flex-shrink:0">
                        ${tel ? `<a href="tel:${this.escapeHtml(tel)}" class="wo-nav-btn" onclick="event.stopPropagation()" title="Bel klant" style="text-decoration:none">${this.icon('phone', { size: 17 })}</a>` : ''}
                        ${address ? `<button class="wo-nav-btn" onclick="event.stopPropagation(); app.navigateToAddress('${this.escapeHtml(address).replace(/'/g, "\\'")}')" title="Navigeer">${this.icon('navigation', { size: 17 })}</button>` : ''}
                    </div>
                </div>
            </div>
        `;
    },

    // Klanthistoriek: tel eerdere werkbonnen per klant
    _clientHistoryCache: {},
    async _loadClientHistory() {
        // Verzamel unieke client IDs
        const clientIds = [...new Set(this.workorders.map(wo => wo.client?.id || wo.clientId).filter(Boolean))];
        if (clientIds.length === 0) return;

        try {
            // Haal ingediende werkorders op (uit lokale submittedWOs + Robaws als beschikbaar)
            // Lokale tellingen uit submittedWOs
            const localCounts = {};
            for (const woId of this.submittedWOs) {
                const wo = this.workorders.find(w => w.id === woId);
                const cid = wo?.client?.id || wo?.clientId;
                if (cid) localCounts[cid] = (localCounts[cid] || 0) + 1;
            }

            // Probeer ook Robaws werkbonnen te tellen (via sales-orders of work-orders)
            // v173: parallelliseren met Promise.all i.p.v. sequentiële await-loop.
            // Voorheen: N klanten × ~300ms = 1.5-3 sec achtergrond-blokkade.
            // Nu: alle tellingen tegelijk = ~500ms voor de hele batch.
            const countResults = await Promise.all(
                clientIds.map(cid =>
                    fetch(`api/werkbon-queue.php?action=countByClient&clientId=${cid}`)
                        .then(r => r.json())
                        .then(data => ({ cid, count: data.count }))
                        .catch(() => ({ cid, count: undefined }))
                )
            );
            for (const { cid, count } of countResults) {
                this._clientHistoryCache[cid] = (count !== undefined)
                    ? count
                    : (localCounts[cid] || 0);
            }

            // Re-render werkorder kaarten met badges
            const list = document.getElementById('workorderList');
            if (list && this.workorders.length > 0) {
                list.innerHTML = this.workorders.map(wo => this.renderWorkorderCard(wo)).join('');
            }
        } catch(e) { /* Niet erg als dit faalt */ }
    },

    // ========================================
    // WERKORDER DETAIL
    // ========================================
    // v185: detail-only data (eindklant, line-items, documenten) lazy laden bij
    // het openen van een werkbon i.p.v. tijdens elke planning-lijst-load. Parallel,
    // en met v184-cache (clients/{id}) instant bij heropenen. Mapping identiek aan
    // de oude getPlanning-enrichment zodat clientInfo / _renderPlanLineItems /
    // _renderPlanDocuments dezelfde shape krijgen. Idempotent: al-geladen data wordt
    // overgeslagen.
    async _loadWorkorderDetailData(wo) {
        if (!wo) return;
        const woIdAtStart = wo.id;
        const needEndClient = wo.endClientId
            && String(wo.endClientId) !== String(wo.clientId || '')
            && !wo.endClient;
        const [ecRes, liRes, docRes] = await Promise.all([
            needEndClient ? RobawsAPI.get(`clients/${wo.endClientId}`).catch(() => null) : Promise.resolve(null),
            wo.lineItems ? Promise.resolve(null) : RobawsAPI.get(`planning-items/${wo.id}/line-items`).catch(() => null),
            wo.documents ? Promise.resolve(null) : RobawsAPI.get(`planning-items/${wo.id}/documents`).catch(() => null),
        ]);
        // Ondertussen een andere werkbon geopend? Resultaat niet toepassen.
        if (!this.currentWO || String(this.currentWO.id) !== String(woIdAtStart)) return;

        if (ecRes && ecRes.code === 200 && ecRes.data) {
            const ec = ecRes.data;
            wo.endClient = {
                id: ec.id, name: ec.name || '', email: ec.email || '',
                tel: ec.tel || '', address: RobawsAPI.formatAddress(ec.address),
            };
        }
        if (liRes && liRes.code === 200 && liRes.data) {
            const lineItems = liRes.data.items || liRes.data || [];
            wo.lineItems = lineItems.map(li => ({
                id: li.id,
                description: li.description || '',
                quantity: li.quantity || 1,
                unitType: li.unitType || null,
                type: li.type || 'LINE',
                articleId: li.articleId || (li.article && li.article.id) || null,
            }));
        }
        if (docRes && docRes.code === 200 && docRes.data) {
            const docs = Array.isArray(docRes.data) ? docRes.data : (docRes.data.items || []);
            wo.documents = docs.map(d => ({
                id: d.id,
                name: d.name || 'Bestand',
                contentType: d.contentType || '',
                size: d.size || 0,
                url: d.url || d.previewUrl || null,
            }));
        }
    },

    async openWorkorder(woId) {
        this.currentWO = this.workorders.find(w => String(w.id) === String(woId));
        if (!this.currentWO) return;

        if (!this.woData[woId]) {
            this.woData[woId] = { hours: [], materials: [], photos: [], notes: '' };
        }

        this.navigate('screenDetail');

        // Titel bovenaan (zichtbaar bij elk tabblad)
        const summary = this.currentWO.summary || '';
        const clientName = this.currentWO.client?.name || 'Onbekend';
        document.getElementById('detailTitle').textContent = summary || clientName;
        document.getElementById('detailSubtitle').textContent = summary ? clientName : '';
        // v181: regie (tijd & materiaal) heel zichtbaar bovenaan tonen
        const _regieBanner = document.getElementById('detailRegieBanner');
        if (_regieBanner) _regieBanner.style.display = this.currentWO.timeAndMaterial ? 'block' : 'none';

        // v185: detail-data (eindklant + line-items + documenten) lazy laden.
        // Stond vroeger in getPlanning (= bij elke lijst-load, per item); nu enkel
        // bij het openen van DEZE werkbon, parallel + met v184-cache bij heropenen.
        await this._loadWorkorderDetailData(this.currentWO);

        // Fill client info — gebruik dagplanning data waar beschikbaar
        const client = this.currentWO.client || {};
        // Adres: dagplanning-adres heeft voorrang boven klant-adres
        const displayAddress = this.currentWO.address || client.address || '';
        // Beschrijving van dagplanning tonen als die er is
        const planDescription = this.currentWO.description || '';
        // Start/eind tijd van dagplanning
        const planStart = this.currentWO.startDate ? new Date(this.currentWO.startDate).toLocaleTimeString('nl-BE', {hour:'2-digit', minute:'2-digit'}) : '';
        const planEnd = this.currentWO.endDate ? new Date(this.currentWO.endDate).toLocaleTimeString('nl-BE', {hour:'2-digit', minute:'2-digit'}) : '';
        const planTimeStr = planStart && planEnd ? `${planStart} - ${planEnd}` : (planStart || '');

        // v103+: structuur
        //   1) Werfadres (dagplanning) + navigatieknop
        //   2) BTW tarief (altijd van Klant/Eigenaar)
        //   3) Klant (Eigenaar) — eigen adres
        //   4) ── scheiding ──
        //   5) Eindklant (Bewoner) — eigen adres (alleen als verschillend van klant)
        const endClient = this.currentWO.endClient || null;
        const hasEndClient = endClient && (endClient.id || endClient.name)
            && String(endClient.id || '') !== String(client.id || '');

        const navLink = displayAddress
            ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(displayAddress)}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;background:var(--qe-purple);color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;white-space:nowrap">${this.icon('navigation', { size: 14, style: 'vertical-align:-2px' })} Navigeer</a>`
            : '';

        const partyRows = (party) => {
            if (!party) return '';
            return `
                <div class="info-row">
                    <span class="info-icon">${this.icon('map-pin')}</span>
                    <span class="info-label">Adres</span>
                    <span class="info-value">${this.escapeHtml(party.address || '-')}</span>
                </div>
                <div class="info-row">
                    <span class="info-icon">${this.icon('phone')}</span>
                    <span class="info-label">Telefoon</span>
                    <span class="info-value">${party.tel ? `<a href="tel:${party.tel}">${this.escapeHtml(party.tel)}</a>` : '-'}</span>
                </div>
                <div class="info-row">
                    <span class="info-icon">${this.icon('mail')}</span>
                    <span class="info-label">Email</span>
                    <span class="info-value">${party.email ? `<a href="mailto:${party.email}">${this.escapeHtml(party.email)}</a>` : '-'}</span>
                </div>`;
        };

        document.getElementById('clientInfo').innerHTML = `
            <!-- Werfadres + navigeer-knop -->
            ${displayAddress ? `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:rgba(0,0,0,0.04);border-radius:8px;margin-bottom:10px">
                <div style="flex:1;min-width:0">
                    <div style="font-size:11px;color:var(--qe-grey);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:2px">Werfadres</div>
                    <div style="font-size:14px;font-weight:500">${this.escapeHtml(displayAddress)}</div>
                </div>
                ${navLink}
            </div>` : ''}

            ${planTimeStr ? `<div class="info-row">
                <span class="info-icon">${this.icon('clock')}</span>
                <span class="info-label">Gepland</span>
                <span class="info-value">${this.escapeHtml(planTimeStr)}</span>
            </div>` : ''}
            ${planDescription ? `<div class="info-row">
                <span class="info-icon">${this.icon('clipboard')}</span>
                <span class="info-label">Omschrijving</span>
                <span class="info-value">${planDescription.replace(/<[^>]*>/g, '') || '-'}</span>
            </div>` : ''}

            <!-- BTW altijd van klant + aanpas-knop direct eronder -->
            <div class="info-row btw-row" style="background:rgba(106,44,145,0.06);border-radius:8px;padding:8px 12px;margin:10px 0 6px">
                <span class="info-icon">${this.icon('percent')}</span>
                <span class="info-label">BTW tarief</span>
                <span class="info-value" id="clientVatDisplay" style="font-weight:600;color:var(--qe-purple)">${client.vatTariffName ? this.escapeHtml(client.vatTariffName) : (client.vatPercentage !== null && client.vatPercentage !== undefined ? client.vatPercentage + '%' : 'Niet ingesteld')}</span>
            </div>
            ${client.id ? `<button class="btw-change-btn" onclick="app.openChangeVatTariff()"
                style="width:100%;margin:0 0 10px;padding:10px;border:2px solid var(--qe-purple);border-radius:10px;
                background:transparent;color:var(--qe-purple);font-size:14px;font-weight:600;cursor:pointer;
                display:flex;align-items:center;justify-content:center;gap:6px">
                ${this.icon('percent', { size: 15 })} BTW tarief aanpassen
            </button>` : ''}

            <!-- Klant (Eigenaar) -->
            <div style="font-size:11px;color:var(--qe-grey);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-weight:600">
                Klant <span style="font-style:italic;text-transform:none;color:var(--qe-purple);letter-spacing:normal;font-weight:500">(Eigenaar)</span>
            </div>
            <div class="info-row">
                <span class="info-icon">${this.icon('user')}</span>
                <span class="info-label">Naam</span>
                <span class="info-value">${this.escapeHtml(client.name || 'Onbekend')}</span>
            </div>
            ${partyRows(client)}

            <!-- Eindklant (Bewoner) — alleen indien aanwezig en verschillend -->
            ${hasEndClient ? `
                <div style="height:1px;background:#e0e0e0;margin:14px 0 10px"></div>
                <div style="font-size:11px;color:var(--qe-grey);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-weight:600">
                    Eindklant <span style="font-style:italic;text-transform:none;color:var(--qe-orange);letter-spacing:normal;font-weight:500">(Bewoner)</span>
                </div>
                <div class="info-row">
                    <span class="info-icon">${this.icon('user')}</span>
                    <span class="info-label">Naam</span>
                    <span class="info-value">${this.escapeHtml(endClient.name || '-')}</span>
                </div>
                ${partyRows(endClient)}
            ` : ''}
        `;

        // Taakomschrijving tonen (detail van dagplanning — HTML uit Robaws)
        const descSection = document.getElementById('planDescriptionSection');
        const descCard = document.getElementById('planDescriptionCard');
        if (planDescription) {
            descCard.innerHTML = planDescription;
            descSection.style.display = '';
            // Inline afbeeldingen zijn niet bereikbaar via de API (403) — verberg ze netjes
            descCard.querySelectorAll('img').forEach(img => {
                const src = (img.getAttribute('src') || '').trim();
                if (!src || img.hasAttribute('data-robaws-id')) {
                    img.style.display = 'none';
                }
                img.onerror = () => { img.style.display = 'none'; };
            });
        } else {
            descSection.style.display = 'none';
        }

        // Planning line-items tonen (mee te nemen materialen — geen prijzen!)
        this._renderPlanLineItems();

        // Planning documenten/bestanden tonen
        this._renderPlanDocuments();

        // v181: ENKEL installaties die aan de dagplanning gelinkt zijn — geen
        // fallback meer naar alle klant-installaties. Geen gelinkte installaties?
        // Dan tonen we ook niets (lege staat).
        const installationIds = this.currentWO.installationIds || [];
        if (installationIds.length > 0) {
            this.loadInstallations(null, installationIds);
        } else {
            this._loadedInstallations = [];
            const instEl = document.getElementById('installationInfo');
            if (instEl) instEl.innerHTML = '<p class="text-grey text-sm">Geen installaties gekoppeld aan deze dagplanning</p>';
            const docEl = document.getElementById('documentList');
            if (docEl) docEl.innerHTML = '<p class="text-grey text-sm">Geen documenten beschikbaar</p>';
        }

        // Restore saved data
        const data = this.woData[woId];
        document.getElementById('workNotes').value = data.notes || '';
        const notesUren = document.getElementById('workNotesUren');
        if (notesUren) notesUren.value = data.notes || '';
        // Herstel pauze waarde (oud veld, nu per uurblok)
        const pauzeEl = document.getElementById('pauzeMinuten');
        if (pauzeEl) {
            const pauzeEntry = data.hours.find(h => h.type === 'pauze');
            pauzeEl.value = pauzeEntry ? pauzeEntry.duration : 0;
        }
        this.renderHoursList();
        this._restoreOnderhoud();
        this.renderMaterials();
        this.renderPhotos();
        this.initOnderhoudPicker();
        this.initVerplaatsingPicker();
        this.renderFavoriteMaterials();
        this.renderNoteTemplates();
        this.initChecklist();
        this._restoreTimerState();

        // Load uurcodes
        this.loadHourTypes();

        // Reset tab to first
        this.switchTab(document.querySelector('#detailTabs .tab-btn'));
    },

    async loadHourTypes() {
        const select = document.getElementById('urcodeSelect');
        const info = document.getElementById('urcodeInfo');
        select.innerHTML = '<option value="">Laden...</option>';

        try {
            const res = await fetch('api/hour-types.php');
            const data = await res.json();
            const allItems = data.items || [];

            // Scheid verplaatsing uurcode van werkuur uurcodes
            this.verplaatsingCode = allItems.find(ht => ht.isVerplaatsing) || null;
            this.hourTypes = allItems.filter(ht => !ht.isVerplaatsing);

            if (this.hourTypes.length === 0) {
                select.innerHTML = '<option value="">Geen uurcodes beschikbaar</option>';
                return;
            }

            select.innerHTML = '<option value="">-- Kies uurcode --</option>' +
                this.hourTypes.map(ht => `<option value="${ht.id}">${this.escapeHtml(ht.name)}</option>`).join('');

            // Auto-selecteer eerste uurcode
            if (this.hourTypes.length > 0) {
                const first = this.hourTypes[0];
                select.value = first.id;
                this.selectedUurcode = first;
            }

            let infoText = data.roleName ? `Werknemersrol: ${data.roleName}` : '';
            if (this.verplaatsingCode) {
                infoText += ` — Verplaatsing: ${this.verplaatsingCode.name}`;
            }
            info.textContent = infoText;
        } catch (err) {
            console.error('[App] Uurcodes laden mislukt:', err);
            select.innerHTML = '<option value="">Fout bij laden uurcodes</option>';
        }
    },

    selectUurcode(id) {
        this.selectedUurcode = this.hourTypes.find(ht => String(ht.id) === String(id)) || null;
    },

    async loadInstallations(clientId, installationIds = []) {
        const container = document.getElementById('installationInfo');
        container.innerHTML = '<div class="spinner"></div>';

        try {
            // Haal installaties op: bij voorkeur via specifieke IDs (van dagplanning)
            let url;
            if (installationIds.length > 0) {
                url = `api/installations.php?action=byIds&ids=${installationIds.join(',')}`;
            } else {
                url = `api/installations.php?action=byClient&clientId=${clientId}`;
            }
            const res = await fetch(url);
            const data = await res.json();
            const installations = data.items || [];

            if (installations.length === 0) {
                container.innerHTML = '<p class="text-grey text-sm">Geen installaties gevonden</p>';
                return;
            }

            // Sla installaties op voor later gebruik
            this._loadedInstallations = installations;

            container.innerHTML = installations.map(inst => `
                <div class="card" style="margin-bottom:8px">
                    <div class="card-clickable" onclick="app.openInstallationHistory('${inst.id}')" style="cursor:pointer;padding:0">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                            <div style="font-weight:500">${this.escapeHtml(inst.name || inst.brand || 'Installatie')}</div>
                            <span style="font-size:12px;color:var(--qe-purple);font-weight:500">Historiek ▸</span>
                        </div>
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:80px;font-size:13px">Merk</span>
                            <span style="font-size:13px">${this.escapeHtml(inst.brand || '-')}</span>
                        </div>
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:80px;font-size:13px">Model</span>
                            <span style="font-size:13px">${this.escapeHtml(inst.model || '-')}</span>
                        </div>
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:80px;font-size:13px">Serienr.</span>
                            <span style="font-size:13px">${this.escapeHtml(inst.serialNumber || '-')}</span>
                        </div>
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:80px;font-size:13px">Bouwjaar</span>
                            <span style="font-size:13px">${this.escapeHtml(String(inst.bouwjaar || '-'))}</span>
                        </div>
                        ${inst.volgendOnderhoud ? `
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:80px;font-size:13px">Volgend OH</span>
                            <span style="font-size:13px">${this.escapeHtml(inst.volgendOnderhoud)}</span>
                        </div>` : ''}
                    </div>
                    <button class="btn btn-outline btn-sm btn-full" onclick="event.stopPropagation(); app.editInstallation('${inst.id}')"
                        style="margin-top:8px;border-color:var(--qe-purple);color:var(--qe-purple);font-size:12px">
                        ${this.icon('edit', { size: 16, style: 'vertical-align:-3px' })} Installatie bewerken
                    </button>
                </div>
            `).join('');

            if (installations[0]) this.loadDocuments(installations[0].id);
        } catch (err) {
            container.innerHTML = '<p class="text-grey text-sm">Kon installaties niet laden</p>';
        }
    },

    editInstallation(installationId) {
        const inst = (this._loadedInstallations || []).find(i => String(i.id) === String(installationId));
        if (!inst) { this.toast('Installatie niet gevonden'); return; }

        document.getElementById('modalContent').innerHTML = `
            <h3>Installatie bewerken</h3>
            <p style="font-size:13px;color:var(--qe-grey);margin-bottom:12px">${this.escapeHtml(inst.name || 'Installatie')}</p>
            <div class="form-group"><label>Merk</label><input type="text" class="form-input" id="editInstBrand" value="${this.escapeHtml(inst.brand || '')}"></div>
            <div class="form-group"><label>Model</label><input type="text" class="form-input" id="editInstModel" value="${this.escapeHtml(inst.model || '')}"></div>
            <div class="form-group"><label>Serienummer</label><input type="text" class="form-input" id="editInstSerial" value="${this.escapeHtml(inst.serialNumber || '')}"></div>
            <div class="form-group"><label>Bouwjaar</label><input type="number" class="form-input" id="editInstYear" value="${inst.bouwjaar || ''}" placeholder="bijv. 2019"></div>
            <button class="btn btn-primary btn-full" onclick="app._saveInstallation(${installationId})" style="margin-bottom:8px">✓ Opslaan in Robaws</button>
            <button class="btn btn-outline btn-full" onclick="app.closeModal()">Annuleren</button>
        `;
        this.openModal();
    },

    async _saveInstallation(installationId) {
        try {
            // Haal actuele data op (PUT = FULL REPLACE in Robaws)
            const result = await RobawsAPI.get(`installations/${installationId}`);
            if (result.code !== 200) throw new Error('Installatie niet gevonden');
            const data = result.data;

            // Update velden
            data.brand = document.getElementById('editInstBrand').value.trim();
            data.model = document.getElementById('editInstModel').value.trim();
            data.serialNumber = document.getElementById('editInstSerial').value.trim();
            const year = document.getElementById('editInstYear').value.trim();
            if (year) data.bouwjaar = parseInt(year);

            const putResult = await RobawsAPI.put(`installations/${installationId}`, data);
            if (putResult.code !== 200 && putResult.code !== 204) {
                throw new Error('Kon installatie niet bijwerken');
            }

            // Update lokale cache
            const cached = (this._loadedInstallations || []).find(i => i.id === installationId);
            if (cached) {
                cached.brand = data.brand;
                cached.model = data.model;
                cached.serialNumber = data.serialNumber;
                cached.bouwjaar = data.bouwjaar;
            }

            this.closeModal();
            this.toast('Installatie bijgewerkt ');
            // Herlaad installaties in de UI
            const installationIds = this.currentWO?.installationIds || [];
            const clientId = this.currentWO?.client?.id;
            if (installationIds.length > 0) this.loadInstallations(null, installationIds);
            else if (clientId) this.loadInstallations(clientId, []);
        } catch (err) {
            this.toast('Fout: ' + err.message);
        }
    },

    async loadDocuments(installationId) {
        const container = document.getElementById('documentList');
        try {
            const res = await fetch(`api/installations.php?action=documents&id=${installationId}`);
            const data = await res.json();
            const docs = data.items || [];

            if (docs.length === 0) {
                container.innerHTML = '<p class="text-grey text-sm">Geen documenten beschikbaar</p>';
                return;
            }

            container.innerHTML = docs.map(doc => `
                <div class="card" style="padding:10px 12px;margin-bottom:6px">
                    <a href="${doc.url}" target="_blank" style="text-decoration:none;color:var(--qe-darkblue);display:flex;align-items:center;gap:8px">
                        <span>${this.icon('file', { size: 18 })}</span>
                        <span style="font-size:14px">${this.escapeHtml(doc.name || 'Document')}</span>
                    </a>
                </div>
            `).join('');
        } catch (err) {
            container.innerHTML = '<p class="text-grey text-sm">Kon documenten niet laden</p>';
        }
    },

    // ========================================
    // TABS
    // ========================================
    switchTab(btn) {
        const tabId = btn.dataset.tab;
        document.querySelectorAll('#detailTabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(tabId).classList.add('active');
        if (tabId && tabId.toLowerCase().indexOf('materi') !== -1) this._warmArticleCache();
    },

    // Warm de artikel-catalogus (1x laden) zodat zoeken + onderhoud-prijzen instant zijn.
    _warmArticleCache() {
        try {
            if (window.RobawsAPI && RobawsAPI._loadAllArticles && !RobawsAPI._articleCache && !RobawsAPI._articleCacheLoading) {
                RobawsAPI._loadAllArticles().catch(() => {});
            }
        } catch (e) {}
    },

    // ========================================
    // TIMER / UREN
    // ========================================
    _timerLabels: { klant: 'Werkuren', verplaatsing: 'Verplaatsingsuren', pauze: 'Pauze' },

    // GPS locatie ophalen (fire-and-forget)
    _getGpsLocation(callback) {
        if (!navigator.geolocation) { callback(null); return; }
        navigator.geolocation.getCurrentPosition(
            pos => callback({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
            () => callback(null),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    },

    toggleTimer(type) {
        if (!this.timer.running) {
            this.timer.running = true;
            this.timer.type = type;
            // Sanity: als elapsed ongeldig is (null, NaN, negatief, >24u), reset naar 0
            if (!this.timer.elapsed || this.timer.elapsed < 0 || this.timer.elapsed > 86400000) {
                this.timer.elapsed = 0;
            }
            this.timer.startTime = Date.now() - this.timer.elapsed;
            this.timer.interval = setInterval(() => this.updateTimerDisplay(), 1000);

            // GPS check-in
            this._getGpsLocation(loc => {
                if (loc) this.timer.gpsStart = loc;
                this._saveTimerState();
            });

            document.getElementById('timerLabel').textContent = this._timerLabels[type] || type;
            document.getElementById('btnTimerStart').style.display = 'none';
            document.getElementById('btnTimerVerplaatsing').style.display = 'none';
            document.getElementById('btnTimerPause').style.display = '';
            document.getElementById('btnTimerStop').style.display = '';
            this._saveTimerState();
            this.updateTimerDisplay();
        } else if (this.timer.type === type) {
            // Pauzeren
            clearInterval(this.timer.interval);
            this.timer.elapsed = Date.now() - this.timer.startTime;
            this.timer.running = false;
            document.getElementById('btnTimerStart').style.display = '';
            // Verplaatsings-uren gedeactiveerd — knop blijft verborgen
            document.getElementById('btnTimerPause').style.display = 'none';
            this._saveTimerState();
        } else {
            // Wissel van type: sla huidige op en start nieuw
            this.saveTimerEntry();
            this.timer.type = type;
            this.timer.startTime = Date.now();
            this.timer.elapsed = 0;
            document.getElementById('timerLabel').textContent = this._timerLabels[type] || type;
            this._saveTimerState();
        }
    },

    stopTimer() {
        if (this.timer.running || this.timer.elapsed > 0) {
            clearInterval(this.timer.interval);
            const elapsed = this.timer.running ? (Date.now() - this.timer.startTime) : this.timer.elapsed;
            // Alleen correctie-modal tonen als er minstens 1 minuut getimed is
            if (elapsed >= 1000) {
                this._showTimerCorrection();
            } else {
                // Te kort — gewoon resetten
                this._resetTimerUI();
                this._clearTimerState();
            }
        }
    },

    async _showTimerCorrection() {
        const startDate = new Date(this.timer.startTime);
        const endDate = new Date();
        const type = this.timer.type || 'klant';
        const label = this._timerLabels[type] || type;

        // Toon eerst loading zodat de modal direct verschijnt
        document.getElementById('modalContent').innerHTML =
            `<h3>${label} — controleer tijden</h3><div class="spinner" style="margin:20px auto"></div>`;
        this.openModal();

        const hourOpts = (sel) => Array.from({length: 24}, (_, i) =>
            `<option value="${i}" ${i === sel ? 'selected' : ''}>${String(i).padStart(2,'0')}</option>`).join('');
        const minOpts = (sel) => Array.from({length: 60}, (_, m) =>
            `<option value="${m}" ${m === sel ? 'selected' : ''}>${String(m).padStart(2,'0')}</option>`).join('');
        const pauzeOpts = [0, 15, 30, 45, 60].map(m =>
            `<option value="${m}" ${m === 0 ? 'selected' : ''}>${m} min</option>`).join('');

        // Werknemers ophalen — zelfde flow als addManualHours, met fallback
        // naar de ingelogde gebruiker als de dagplanning er geen heeft.
        const empIds = this.currentWO ? (this.currentWO.employeeIds || []) : [];
        let employees = [];
        if (empIds.length > 0) {
            try { employees = await this._getEmployeeNames(empIds); }
            catch(e) { console.warn('[App] Werknemers ophalen voor timer-popup mislukt:', e); }
        }
        if (employees.length === 0 && this.currentUser) {
            employees = [{ id: String(this.currentUser.robawsEmployeeId), name: this.currentUser.name || 'Ik' }];
        }
        const currentEmpId = this.currentUser ? String(this.currentUser.robawsEmployeeId) : '';
        const employeeSelect = employees.length > 0 ? `
            <div class="form-group" style="margin-bottom:12px">
                <label>${this.icon('user', { size: 14, style: 'vertical-align:-2px' })} Werknemer</label>
                <select class="form-input" id="tcEmployee">
                    ${employees.map(e => `<option value="${e.id}" ${String(e.id) === currentEmpId ? 'selected' : ''}>${this.escapeHtml(e.name)}</option>`).join('')}
                </select>
            </div>` : '';

        document.getElementById('modalContent').innerHTML = `
            <h3>${label} — controleer tijden</h3>
            <p style="font-size:13px;color:var(--qe-grey);margin-bottom:12px">Pas aan indien nodig</p>
            ${employeeSelect}
            <div class="form-group" style="margin-bottom:10px">
                <label>Van</label>
                <div style="display:flex;gap:8px;align-items:center">
                    <select class="form-input" id="tcFromH" style="flex:1">${hourOpts(startDate.getHours())}</select>
                    <span style="font-size:20px;font-weight:600">:</span>
                    <select class="form-input" id="tcFromM" style="flex:1">${minOpts(startDate.getMinutes())}</select>
                </div>
            </div>
            <div class="form-group" style="margin-bottom:10px">
                <label>Tot</label>
                <div style="display:flex;gap:8px;align-items:center">
                    <select class="form-input" id="tcToH" style="flex:1">${hourOpts(endDate.getHours())}</select>
                    <span style="font-size:20px;font-weight:600">:</span>
                    <select class="form-input" id="tcToM" style="flex:1">${minOpts(endDate.getMinutes())}</select>
                </div>
            </div>
            <div class="form-group" style="margin-bottom:12px">
                <label>${this.icon('coffee', { size: 14, style: 'vertical-align:-2px' })} Pauze</label>
                <select class="form-input" id="tcPauze">${pauzeOpts}</select>
            </div>
            <button class="btn btn-primary btn-full" onclick="app._saveTimerCorrection('${type}')">✓ Opslaan</button>
            <button class="btn btn-outline btn-full" style="margin-top:8px" onclick="app._discardTimer()">Verwijderen</button>
        `;
    },

    _saveTimerCorrection(type) {
        const fh = parseInt(document.getElementById('tcFromH').value);
        const fm = parseInt(document.getElementById('tcFromM').value);
        const th = parseInt(document.getElementById('tcToH').value);
        const tm = parseInt(document.getElementById('tcToM').value);
        const pauze = parseInt(document.getElementById('tcPauze')?.value || 0);
        const from = String(fh).padStart(2,'0') + ':' + String(fm).padStart(2,'0');
        const to = String(th).padStart(2,'0') + ':' + String(tm).padStart(2,'0');
        const totalDuration = (th * 60 + tm) - (fh * 60 + fm);
        if (totalDuration <= 0) { this.toast('Eindtijd moet na starttijd zijn'); return; }
        const duration = Math.max(0, totalDuration - pauze);

        // Werknemer ophalen (uit dropdown of ingelogde user)
        const empSelect = document.getElementById('tcEmployee');
        const employeeId = empSelect ? empSelect.value : (this.currentUser ? String(this.currentUser.robawsEmployeeId) : null);
        const employeeName = empSelect ? empSelect.options[empSelect.selectedIndex].text : (this.currentUser ? this.currentUser.name : '');

        // GPS check-out bij stop
        this._getGpsLocation(loc => {
            if (loc && this.currentWO) {
                const lastHour = this.woData[this.currentWO.id].hours[this.woData[this.currentWO.id].hours.length - 1];
                if (lastHour) lastHour.gpsEnd = loc;
                this._saveWoData();
            }
        });

        if (this.currentWO) {
            this.woData[this.currentWO.id].hours.push({
                id: Date.now(), type, startTime: from, endTime: to,
                duration, pauze,
                employeeId, employeeName,
                gpsStart: this.timer.gpsStart || null,
            });
            this.renderHoursList();
        }
        this.closeModal();
        this._resetTimerUI();
        this._clearTimerState();
        const pauzeTxt = pauze > 0 ? ` (${pauze}min pauze)` : '';
        this.toast(`${this._timerLabels[type] || type}: ${from} - ${to}${pauzeTxt}`);
    },

    _discardTimer() {
        this.closeModal();
        this._resetTimerUI();
        this._clearTimerState();
    },

    _resetTimerUI() {
        this.timer = { running: false, elapsed: 0, type: null, startTime: null, interval: null };
        document.getElementById('timerValue').textContent = '00:00:00';
        document.getElementById('timerLabel').textContent = 'Werkuren';
        document.getElementById('btnTimerStart').style.display = '';
        // Verplaatsings-uren gedeactiveerd — knop blijft verborgen
        document.getElementById('btnTimerPause').style.display = 'none';
        document.getElementById('btnTimerStop').style.display = 'none';
    },

    // Timer-state opslaan in localStorage zodat hij doortelt als de app
    // op de achtergrond draait of zelfs gesloten wordt.
    _saveTimerState() {
        // Niet opslaan als startTime ongeldig is
        if (this.timer.running && !this.timer.startTime) return;
        const state = {
            running: this.timer.running,
            type: this.timer.type,
            startTime: this.timer.startTime,
            elapsed: this.timer.elapsed || 0,
            woId: this.currentWO?.id || null,
        };
        localStorage.setItem('qe_timer', JSON.stringify(state));
    },
    _clearTimerState() {
        localStorage.removeItem('qe_timer');
    },
    _restoreTimerState() {
        try {
            const stored = localStorage.getItem('qe_timer');
            if (!stored) return;
            const state = JSON.parse(stored);
            // Alleen herstellen als we dezelfde werkorder open hebben
            if (state.woId && this.currentWO && String(state.woId) === String(this.currentWO.id)) {
                // Sanity check: startTime moet een geldig recent timestamp zijn
                // (niet null, niet 0, niet ouder dan 24 uur)
                const now = Date.now();
                const maxAge = 24 * 60 * 60 * 1000; // 24 uur
                if (state.running && (!state.startTime || state.startTime < now - maxAge || state.startTime > now + 60000)) {
                    // Ongeldige startTime — timer wissen
                    this._clearTimerState();
                    return;
                }
                // Sanity check: elapsed mag niet groter zijn dan 24 uur
                if (state.elapsed && state.elapsed > maxAge) {
                    this._clearTimerState();
                    return;
                }

                this.timer.type = state.type;
                this.timer.startTime = state.startTime;
                this.timer.elapsed = state.elapsed || 0;
                this.timer.running = state.running;
                if (state.running) {
                    this.timer.interval = setInterval(() => this.updateTimerDisplay(), 1000);
                    document.getElementById('timerLabel').textContent = this._timerLabels[state.type] || state.type;
                    document.getElementById('btnTimerStart').style.display = 'none';
                    document.getElementById('btnTimerVerplaatsing').style.display = 'none';
                    document.getElementById('btnTimerPause').style.display = '';
                    document.getElementById('btnTimerStop').style.display = '';
                    this.updateTimerDisplay();
                }
            }
        } catch(e) {
            // Bij een parse-fout: timer wissen
            this._clearTimerState();
        }
    },

    saveTimerEntry() {
        const elapsed = this.timer.running ? (Date.now() - this.timer.startTime) : this.timer.elapsed;
        if (elapsed < 1000) return;
        const duration = Math.max(1, Math.ceil(elapsed / 60000));
        const start = new Date(this.timer.startTime);

        const entry = {
            id: Date.now(),
            type: this.timer.type || 'klant',
            startTime: start.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }),
            endTime: new Date().toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }),
            duration,
        };

        if (this.currentWO) {
            this.woData[this.currentWO.id].hours.push(entry);
            this.renderHoursList();
        }
    },

    updateTimerDisplay() {
        let elapsed = Date.now() - this.timer.startTime;
        // Sanity: als elapsed negatief of groter dan 24 uur is, reset timer
        if (elapsed < 0 || elapsed > 86400000) {
            this.timer.startTime = Date.now();
            elapsed = 0;
            this._saveTimerState();
        }
        const secs = Math.floor(elapsed / 1000);
        const h = Math.floor(secs / 3600).toString().padStart(2, '0');
        const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        document.getElementById('timerValue').textContent = `${h}:${m}:${s}`;
    },

    // Synchroniseer opmerkingen tussen Info-tab en Uren-tab
    syncWorkNotes(value) {
        if (!this.currentWO) return;
        this.woData[this.currentWO.id].notes = value;
        // Sync beide textareas
        const a = document.getElementById('workNotes');
        const b = document.getElementById('workNotesUren');
        if (a && a.value !== value) a.value = value;
        if (b && b.value !== value) b.value = value;
        this._saveWoData();
    },

    // Notitie-templates — standaardzinnen met één tik invoegen
    NOTE_TEMPLATES: [
        { cat: 'Onderhoud', items: [
            { label: 'Onderhoud uitgevoerd', text: 'Jaarlijks onderhoud uitgevoerd volgens de voorschriften.' },
            { label: 'Ketel gereinigd', text: 'Ketel en brander gereinigd.' },
            { label: 'Verbrandingsmeting OK', text: 'Verbrandingsmeting uitgevoerd — waarden conform.' },
            { label: 'Bijgevuld / op druk', text: 'Installatie bijgevuld en op druk gebracht.' },
            { label: 'Filters vervangen', text: 'Filters gereinigd of vervangen.' },
        ] },
        { cat: 'Herstelling', items: [
            { label: 'Storing verholpen', text: 'Storing verholpen — installatie getest en werkt naar behoren.' },
            { label: 'Onderdeel vervangen', text: 'Defect onderdeel vervangen.' },
            { label: 'Onderdeel besteld', text: 'Onderdeel besteld — vervolgafspraak volgt.' },
            { label: 'Lek gedicht', text: 'Lek opgespoord en gedicht.' },
            { label: 'Tijdelijke oplossing', text: 'Tijdelijke oplossing toegepast — definitieve herstelling volgt.' },
        ] },
        { cat: 'Vaststelling & advies', items: [
            { label: 'Werkt correct', text: 'Installatie gecontroleerd en werkt correct.' },
            { label: 'Vervanging aangeraden', text: 'Installatie verouderd — vervanging aangeraden.' },
            { label: 'Offerte opmaken', text: 'Offerte op te maken voor herstelling of vervanging.' },
        ] },
        { cat: 'Klant & administratief', items: [
            { label: 'Klant ingelicht', text: 'Klant ingelicht over de toestand van de installatie.' },
            { label: 'Klant akkoord', text: 'Klant akkoord met de uitgevoerde werken.' },
            { label: 'Klant afwezig', text: 'Klant was niet aanwezig tijdens de interventie.' },
            { label: 'Onder garantie', text: 'Interventie onder garantie — geen kosten voor de klant.' },
            { label: 'Vervolgbezoek nodig', text: 'Vervolgbezoek nodig om de werken af te ronden.' },
        ] },
    ],

    renderNoteTemplates() {
        const bar = document.getElementById('noteTemplatesBar');
        if (!bar) return;
        bar.style.display = 'block';
        bar.innerHTML = this.NOTE_TEMPLATES.map((grp, g) => {
            const rows = grp.items.map((t, i) =>
                `<div onclick="app.insertNoteTemplate(${g}, ${i})" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 2px;border-bottom:1px solid var(--qe-hairline);cursor:pointer">
                    <span style="font-size:13px;color:var(--qe-darkblue)">${this.escapeHtml(t.label)}</span>
                    <span style="color:var(--qe-orange);font-size:18px;line-height:1;flex-shrink:0">+</span>
                </div>`
            ).join('');
            return `<div style="font-size:12px;font-weight:600;color:var(--qe-grey);margin:${g === 0 ? '0' : '14px'} 0 2px">${this.escapeHtml(grp.cat)}</div>${rows}`;
        }).join('');
    },

    insertNoteTemplate(groupIdx, itemIdx) {
        const grp = this.NOTE_TEMPLATES[groupIdx];
        const tpl = grp && grp.items ? grp.items[itemIdx] : null;
        if (!tpl || !this.currentWO) return;
        const text = (typeof tpl === 'string') ? tpl : tpl.text;
        const ta = document.getElementById('workNotes');
        const current = ta.value;
        // Voeg toe met een nieuwe regel als er al tekst staat
        const newVal = current ? current.trimEnd() + '\n' + text : text;
        ta.value = newVal;
        this.syncWorkNotes(newVal);
        this.toast('Tekst toegevoegd');
    },

    // addQuickMinutes — gedeactiveerd, vervangen door addManualHours met pauze
    addQuickMinutes() {
        this.addManualHours('klant');
    },

    saveQuickMinutes() {
        // Legacy — niet meer gebruikt
    },

    /** Haal werknemersnamen op voor de employeeIds van de dagplanning */
    async _getEmployeeNames(employeeIds) {
        if (!employeeIds || employeeIds.length === 0) return [];
        const employees = [];
        for (const empId of employeeIds) {
            // Probeer eerst uit EMPLOYEES (snel, geen API call nodig)
            let name = null;
            const knownUsers = RobawsAPI.EMPLOYEES || {};
            for (const [email, userData] of Object.entries(knownUsers)) {
                if (String(userData.employeeId) === String(empId)) {
                    name = userData.name;
                    break;
                }
            }
            // Fallback: ophalen via API als niet in KNOWN_USERS
            if (!name) {
                try {
                    const res = await RobawsAPI.get(`employees/${empId}`);
                    if (res.code === 200 && res.data) {
                        name = [res.data.firstName, res.data.lastName].filter(Boolean).join(' ');
                    }
                } catch(e) {
                    console.warn('[App] Kon werknemer', empId, 'niet ophalen:', e.message);
                }
            }
            employees.push({ id: empId, name: name || `Werknemer ${empId}` });
        }
        return employees;
    },

    async addManualHours(type) {
        const label = type === 'klant' ? 'Uren toevoegen' : 'Verplaatsingstijd toevoegen';
        const now = new Date();
        const nowH = now.getHours();
        const nowM = now.getMinutes();

        // Toon loading eerst
        document.getElementById('modalContent').innerHTML = `<h3>${label}</h3><div class="spinner" style="margin:20px auto"></div>`;
        this.openModal();

        // Genereer hour-options (00-23) en minute-options (00-59)
        const hourOpts = (sel) => Array.from({length: 24}, (_, i) =>
            `<option value="${i}" ${i === sel ? 'selected' : ''}>${String(i).padStart(2,'0')}</option>`).join('');
        const minOpts = (sel) => Array.from({length: 60}, (_, m) =>
            `<option value="${m}" ${m === sel ? 'selected' : ''}>${String(m).padStart(2,'0')}</option>`).join('');

        // Pauze opties per 15 min
        const pauzeOpts = [0, 15, 30, 45, 60].map(m =>
            `<option value="${m}" ${m === 0 ? 'selected' : ''}>${m} min</option>`).join('');

        // Werknemers ophalen: dagplanning employeeIds, of fallback naar ingelogde user
        const empIds = this.currentWO ? (this.currentWO.employeeIds || []) : [];
        let employees = [];
        if (empIds.length > 0) {
            try {
                employees = await this._getEmployeeNames(empIds);
            } catch(e) {
                console.warn('[App] Fout bij ophalen werknemers:', e);
            }
        }
        // Fallback: als geen werknemers van dagplanning, gebruik ingelogde user
        if (employees.length === 0 && this.currentUser) {
            employees = [{ id: String(this.currentUser.robawsEmployeeId), name: this.currentUser.name || 'Ik' }];
        }

        const currentEmpId = this.currentUser ? String(this.currentUser.robawsEmployeeId) : '';
        const employeeSelect = employees.length > 0 ? `
            <div class="form-group" style="margin-bottom:12px">
                <label>${this.icon('user', { size: 14, style: 'vertical-align:-2px' })} Werknemer</label>
                <select class="form-input" id="hourEmployee">
                    ${employees.map(e => `<option value="${e.id}" ${String(e.id) === currentEmpId ? 'selected' : ''}>${e.name}</option>`).join('')}
                </select>
            </div>` : '';

        // v112: Pincode-stijl tijdinvoer — losse uren-/minuten-inputs met
        // numeriek toetsenbord. Smart auto-pad:
        //  - Uren: cijfers 0-2 wachten op een 2e (kan 00-23 worden),
        //          cijfers 3-9 worden meteen "0X" en focus springt verder.
        //  - Minuten: cijfers 0-5 wachten op een 2e (kan 00-59 worden),
        //             cijfers 6-9 worden meteen "0X" en focus springt verder.
        //  - Bij blur: padding leading zero + clamp naar geldige range.
        const pinInput = (id, value, nextId, mode) => `
            <input type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="2"
                class="form-input pin-time"
                id="${id}"
                value="${String(value).padStart(2,'0')}"
                onfocus="this.select()"
                oninput="app._pinTimeInput(this, '${mode}'${nextId ? ", '" + nextId + "'" : ''})"
                onblur="app._pinTimeBlur(this, '${mode}')"
                style="flex:1;text-align:center;font-size:20px;font-weight:600;letter-spacing:2px;padding:14px 8px">
        `;

        document.getElementById('modalContent').innerHTML = `
            <h3>${label}</h3>
            ${employeeSelect}
            <div class="form-group" style="margin-bottom:12px">
                <label>Van</label>
                <div style="display:flex;gap:8px;align-items:center">
                    ${pinInput('fromH', nowH, 'fromM', 'hour')}
                    <span style="font-size:24px;font-weight:700">:</span>
                    ${pinInput('fromM', nowM, 'toH', 'minute')}
                </div>
            </div>
            <div class="form-group" style="margin-bottom:12px">
                <label>Tot</label>
                <div style="display:flex;gap:8px;align-items:center">
                    ${pinInput('toH', (nowH + 1) % 24, 'toM', 'hour')}
                    <span style="font-size:24px;font-weight:700">:</span>
                    ${pinInput('toM', nowM, null, 'minute')}
                </div>
            </div>
            <div class="form-group" style="margin-bottom:12px">
                <label>${this.icon('coffee', { size: 14, style: 'vertical-align:-2px' })} Pauze</label>
                <select class="form-input" id="hourPauze">${pauzeOpts}</select>
            </div>
            <button class="btn btn-primary btn-full mt-16" onclick="app.saveManualHours('${type}')">Opslaan</button>
            <button class="btn btn-outline btn-full" style="margin-top:8px" onclick="app.closeModal()">Annuleren</button>
        `;
    },

    /**
     * v112: helper voor de pincode-stijl tijdinvoer. Smart auto-pad:
     *   - mode='hour':   cijfers 3-9 worden meteen "0X" en focus springt
     *                    door. Cijfers 0-2 wachten op een 2e cijfer.
     *   - mode='minute': cijfers 6-9 worden meteen "0X" en focus springt
     *                    door. Cijfers 0-5 wachten op een 2e cijfer.
     * Bij 2 cijfers: range-validatie (uur max 23, minuut max 59).
     * Bij ongeldig 2-cijferig getal: trim naar 1 cijfer met leading zero,
     * zodat de gebruiker opnieuw kan typen.
     */
    _pinTimeInput(input, mode, nextFieldId) {
        // Strip niet-numerieke karakters
        let v = (input.value || '').replace(/[^0-9]/g, '');
        if (v !== input.value) input.value = v;
        if (v.length === 0) return;

        const max = (mode === 'hour') ? 23 : 59;
        const padThreshold = (mode === 'hour') ? 3 : 6;

        if (v.length === 1) {
            const d = parseInt(v, 10);
            if (d >= padThreshold) {
                // Cijfer kan niet als eerste van een 2-cijferig getal werken
                // → forceer "0X" en spring door naar volgend veld
                input.value = '0' + v;
                if (nextFieldId) {
                    const next = document.getElementById(nextFieldId);
                    if (next) { next.focus(); next.select(); }
                } else {
                    input.blur();
                }
            }
            // else: wachten op 2e cijfer
            return;
        }

        if (v.length === 2) {
            const num = parseInt(v, 10);
            if (num > max) {
                // 2e cijfer maakt het ongeldig → strip 2e cijfer en pad
                // het 1e met leading zero zodat de gebruiker opnieuw kan typen
                input.value = '0' + v[0];
                // Nu staat er bv. "07" — als die ook > max is, clamp.
                if (parseInt(input.value, 10) > max) {
                    input.value = String(max).padStart(2, '0');
                }
                // Spring door (we hebben nu 2 geldige cijfers)
                if (nextFieldId) {
                    const next = document.getElementById(nextFieldId);
                    if (next) { next.focus(); next.select(); }
                } else {
                    input.blur();
                }
                return;
            }
            // Geldig 2-cijferig getal → spring door
            if (nextFieldId) {
                const next = document.getElementById(nextFieldId);
                if (next) { next.focus(); next.select(); }
            } else {
                input.blur();
            }
        }
    },

    /**
     * v112: bij verlaten van een pin-input: leading zero padding en
     * range-clamp. Lege input wordt "00".
     */
    _pinTimeBlur(input, mode) {
        let v = (input.value || '').replace(/[^0-9]/g, '');
        if (v.length === 0) {
            input.value = '00';
            return;
        }
        if (v.length === 1) v = '0' + v;
        const max = (mode === 'hour') ? 23 : 59;
        let num = parseInt(v, 10);
        if (num > max) num = max;
        input.value = String(num).padStart(2, '0');
    },

    saveManualHours(type) {
        // v112: pin-inputs kunnen lege strings of buiten-range waarden geven.
        // Parse defensief en valideer uren 0-23, minuten 0-59.
        const parseHM = (raw, max) => {
            const n = parseInt(raw, 10);
            if (isNaN(n)) return null;
            if (n < 0 || n > max) return null;
            return n;
        };
        const fh = parseHM(document.getElementById('fromH').value, 23);
        const fm = parseHM(document.getElementById('fromM').value, 59);
        const th = parseHM(document.getElementById('toH').value,   23);
        const tm = parseHM(document.getElementById('toM').value,   59);
        if (fh == null || fm == null || th == null || tm == null) {
            this.toast('Vul geldige tijden in (00:00–23:59)');
            return;
        }
        const from = String(fh).padStart(2,'0') + ':' + String(fm).padStart(2,'0');
        const to = String(th).padStart(2,'0') + ':' + String(tm).padStart(2,'0');
        const pauze = parseInt(document.getElementById('hourPauze')?.value || 0);

        const totalDuration = (th * 60 + tm) - (fh * 60 + fm);
        if (totalDuration <= 0) { this.toast('Eindtijd moet na starttijd zijn'); return; }
        const duration = Math.max(0, totalDuration - pauze); // Pauze aftrekken

        // Werknemer ophalen (als beschikbaar)
        const empSelect = document.getElementById('hourEmployee');
        const employeeId = empSelect ? empSelect.value : (this.currentUser ? String(this.currentUser.robawsEmployeeId) : null);
        const employeeName = empSelect ? empSelect.options[empSelect.selectedIndex].text : (this.currentUser ? this.currentUser.name : '');

        if (this.currentWO) {
            this.woData[this.currentWO.id].hours.push({
                id: Date.now(), type, startTime: from, endTime: to,
                duration, pauze,
                employeeId, employeeName,
            });
            this.renderHoursList();
        }
        this.closeModal();
        this.toast(`Uren opgeslagen voor ${employeeName}${pauze > 0 ? ` (${pauze} min pauze)` : ''}`);
    },

    renderHoursList() {
        if (!this.currentWO) return;
        const data = this.woData[this.currentWO.id];
        const container = document.getElementById('hoursList');
        const summary = document.getElementById('dayHoursSummary');

        if (data.hours.length === 0) {
            container.innerHTML = '<p class="text-grey text-sm text-center">Nog geen uren geregistreerd</p>';
            summary.style.display = 'none';
            return;
        }

        const icons = { klant: this.icon('tool', { size: 18 }), verplaatsing: this.icon('car', { size: 18 }), pauze: this.icon('coffee', { size: 18 }) };
        const labels = { klant: 'Werkuren', verplaatsing: 'Verplaatsing', pauze: 'Pauze' };

        container.innerHTML = data.hours.map(h => {
            const empLabel = h.employeeName ? `<div style="font-size:11px;color:var(--qe-purple);font-weight:500">${this.icon('user', { size: 13, style: 'vertical-align:-2px' })} ${this.escapeHtml(h.employeeName)}</div>` : '';
            const pauzeLabel = h.pauze && h.pauze > 0 ? `<span style="font-size:11px;color:var(--qe-grey);margin-left:4px">(${this.icon('coffee', { size: 12, style: 'vertical-align:-2px' })} ${h.pauze}m)</span>` : '';
            return `
            <div class="hour-entry">
                <div class="he-type ${h.type}">${icons[h.type] || this.icon('tool', { size: 18 })}</div>
                <div class="he-info">
                    ${empLabel}
                    <div class="he-label">${labels[h.type] || h.type}${pauzeLabel}</div>
                    <div class="he-time">${h.startTime} - ${h.endTime}</div>
                </div>
                <div class="he-duration">${this.formatMinutes(h.duration)}</div>
                <button class="mat-remove" onclick="app.removeHour(${h.id})">✕</button>
            </div>`;
        }).join('');

        const totals = { klant: 0, verplaatsing: 0, pauze: 0 };
        let totalPauzeMin = 0;
        data.hours.forEach(h => {
            totals[h.type] = (totals[h.type] || 0) + h.duration;
            if (h.pauze) totalPauzeMin += h.pauze;
        });
        // Oude losse pauze entries ook meetellen
        totals.pauze = totals.pauze + totalPauzeMin;

        document.getElementById('totalKlantUren').textContent = this.formatMinutes(totals.klant);
        const verplEl = document.getElementById('totalVerplaatsing');
        if (verplEl) verplEl.textContent = this.formatMinutes(totals.verplaatsing);
        const verplRow = document.getElementById('rowVerplaatsing');
        if (verplRow) verplRow.style.display = totals.verplaatsing > 0 ? '' : 'none';
        document.getElementById('totalPauze').textContent = this.formatMinutes(totalPauzeMin > 0 ? totalPauzeMin : totals.pauze);
        document.getElementById('totalGewerkt').textContent = this.formatMinutes(totals.klant + totals.verplaatsing);
        summary.style.display = 'block';
        this._saveWoData();
    },

    removeHour(id) {
        if (!this.currentWO) return;
        this.woData[this.currentWO.id].hours = this.woData[this.currentWO.id].hours.filter(h => h.id !== id);
        this.renderHoursList();
    },

    adjustPauze(delta) {
        const input = document.getElementById('pauzeMinuten');
        if (!input) return;
        let val = parseInt(input.value) || 0;
        val = Math.max(0, val + delta);
        input.value = val;
        this.setPauze(val);
    },

    setPauze(mins) {
        if (!this.currentWO) return;
        const data = this.woData[this.currentWO.id];
        // Verwijder bestaande pauze entries
        data.hours = data.hours.filter(h => h.type !== 'pauze');
        const minutes = parseInt(mins) || 0;
        if (minutes > 0) {
            data.hours.push({
                id: Date.now(),
                type: 'pauze',
                startTime: '--:--',
                endTime: '--:--',
                duration: minutes,
            });
        }
        this.renderHoursList();
    },

    // ========================================
    // v138: ONDERHOUD-vinkje verwijderd — alle data.onderhoud blijft false.
    // Functies bestaan nog als no-ops voor backwards-compat met bestaande oproepen.
    // ========================================
    toggleOnderhoud(checked) {
        // No-op — feature verwijderd in v138.
        if (this.currentWO && this.woData[this.currentWO.id]) {
            this.woData[this.currentWO.id].onderhoud = false;
        }
    },

    _restoreOnderhoud() {
        // No-op — section is hidden in HTML. Force onderhoud = false.
        if (this.currentWO && this.woData[this.currentWO.id]) {
            this.woData[this.currentWO.id].onderhoud = false;
        }
    },

    // ========================================
    // MATERIALEN
    // ========================================
    async searchMaterials(query) {
        clearTimeout(this.searchTimeout);
        const container = document.getElementById('materialSearchResults');

        if (query.length < 2) { container.style.display = 'none'; return; }

        // BUG-fix: vroegere implementatie liet oudere fetches doorlopen,
        // waardoor out-of-order responses een nieuwer zoekresultaat
        // konden overschrijven. Nu gebruiken we een AbortController per
        // zoek-request en een query-id om alleen het laatste resultaat te
        // tonen.
        if (this._searchAbort) {
            try { this._searchAbort.abort(); } catch(e) {}
        }
        const ctrl = new AbortController();
        this._searchAbort = ctrl;
        const myQueryId = (this._searchQueryId = (this._searchQueryId || 0) + 1);

        this.searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(
                    `api/articles.php?action=search&name=${encodeURIComponent(query)}&limit=20`,
                    { signal: ctrl.signal }
                );
                const data = await res.json();
                // Alleen renderen als dit nog steeds de meest recente query is
                if (myQueryId !== this._searchQueryId) return;
                const items = data.items || [];

                if (items.length === 0) {
                    container.innerHTML = '<p class="text-grey text-sm text-center" style="padding:12px">Geen artikelen gevonden</p>';
                } else {
                    container.innerHTML = items.map(art => `
                        <div class="card card-clickable" style="padding:10px 12px;margin-bottom:4px" onclick='app.addMaterial(${JSON.stringify(art).replace(/'/g, "&#39;")})'>
                            <div style="display:flex;justify-content:space-between;align-items:baseline">
                                <div style="font-size:14px;font-weight:500;flex:1">${this.escapeHtml(art.name)}</div>
                                ${art.articleNumber ? `<span style="font-size:11px;color:var(--qe-purple);font-weight:500;margin-left:8px">#${this.escapeHtml(art.articleNumber)}</span>` : ''}
                            </div>
                            <div style="font-size:13px;color:var(--qe-grey);display:flex;justify-content:space-between">
                                <span>${art.unit || 'stuk'}</span>
                                <span class="monteur-hide" style="font-weight:500;color:var(--qe-darkblue)">${this.formatPrice(art.salePrice ?? art.unitPrice ?? 0)}</span>
                            </div>
                        </div>
                    `).join('');
                }
                container.style.display = 'block';
            } catch (err) {
                if (err && err.name === 'AbortError') return; // genegeerd
                container.innerHTML = '<p class="text-grey text-sm text-center" style="padding:12px">Zoeken mislukt</p>';
                container.style.display = 'block';
            }
        }, 400);
    },

    addMaterial(article) {
        if (!this.currentWO) return;
        const data = this.woData[this.currentWO.id];
        const existing = data.materials.find(m => m.id === article.id);
        if (existing) { existing.quantity++; } else { data.materials.push({ ...article, quantity: 1 }); }

        document.getElementById('materialSearch').value = '';
        document.getElementById('materialSearchResults').style.display = 'none';
        this.renderMaterials();
        this.toast(`${article.name} toegevoegd`);
        // Bijhouden voor veelgebruikte materialen (custom-artikels niet)
        if (!article.isCustom) this._trackFavoriteMaterial(article);
    },

    /**
     * v93: Open modal om een EENMALIG artikel toe te voegen aan de werkbon.
     * Het artikel bestaat (nog) niet in Robaws — bij submit wordt automatisch
     * een taak voor Felicity (userId 6) aangemaakt met de details.
     */
    openCustomArticleModal() {
        if (!this.currentWO) { this.toast('Geen werkbon actief'); return; }

        let m = document.getElementById('customArticleModal');
        if (m) m.remove();
        m = document.createElement('div');
        m.id = 'customArticleModal';
        m.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99998;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';

        const card = document.createElement('div');
        card.style.cssText = 'background:#fff;border-radius:16px;max-width:420px;width:100%;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.3);box-sizing:border-box';

        card.innerHTML =
            '<div style="font-size:18px;font-weight:700;color:#1A237E;margin-bottom:6px">' + this.icon('edit', { size: 16, style: 'vertical-align:-3px' }) + ' Eenmalig artikel</div>' +
            '<div style="font-size:12px;color:#666;margin-bottom:16px">Voor artikels die nog niet in Robaws staan. Felicity krijgt een taakje om het artikel aan te maken.</div>' +
            '<div style="margin-bottom:12px">' +
                '<label style="font-size:12px;color:#666;display:block;margin-bottom:4px">Omschrijving</label>' +
                '<input id="caDesc" type="text" placeholder="Bijv. Speciale flens 50mm" autocomplete="off" ' +
                'style="width:100%;padding:12px;font-size:15px;border:2px solid #cfd8dc;border-radius:10px;box-sizing:border-box">' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
                '<div>' +
                    '<label style="font-size:12px;color:#666;display:block;margin-bottom:4px">Verkoopprijs (€)</label>' +
                    '<input id="caPrice" type="number" step="0.01" min="0" value="0" ' +
                    'style="width:100%;padding:12px;font-size:15px;border:2px solid #cfd8dc;border-radius:10px;box-sizing:border-box;text-align:center">' +
                '</div>' +
                '<div>' +
                    '<label style="font-size:12px;color:#666;display:block;margin-bottom:4px">Aantal</label>' +
                    '<input id="caQty" type="number" step="0.01" min="0.01" value="1" ' +
                    'style="width:100%;padding:12px;font-size:15px;border:2px solid #cfd8dc;border-radius:10px;box-sizing:border-box;text-align:center">' +
                '</div>' +
            '</div>' +
            '<div id="caError" style="font-size:12px;color:#c62828;margin-bottom:8px;display:none"></div>' +
            '<button id="caSubmit" style="width:100%;padding:14px;background:#E65100;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:8px">' +
                'Toevoegen' +
            '</button>' +
            '<button id="caCancel" style="width:100%;padding:12px;background:#f5f5f5;color:#444;border:none;border-radius:10px;font-size:14px;cursor:pointer">Annuleren</button>';

        m.appendChild(card);
        document.body.appendChild(m);

        const descEl = document.getElementById('caDesc');
        const priceEl = document.getElementById('caPrice');
        const qtyEl = document.getElementById('caQty');
        const errEl = document.getElementById('caError');

        setTimeout(() => { try { descEl.focus(); } catch(_) {} }, 100);

        document.getElementById('caSubmit').addEventListener('click', () => {
            const desc = (descEl.value || '').trim();
            const price = parseFloat(priceEl.value) || 0;
            const qty = parseFloat(qtyEl.value) || 1;
            if (!desc) {
                errEl.textContent = 'Omschrijving is verplicht';
                errEl.style.display = 'block';
                return;
            }
            if (price <= 0) {
                errEl.textContent = 'Verkoopprijs moet groter dan 0 zijn';
                errEl.style.display = 'block';
                return;
            }
            const data = this.woData[this.currentWO.id];
            data.materials = data.materials || [];
            data.materials.push({
                id: '__custom_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                name: desc,
                salePrice: price,
                unitPrice: price,
                quantity: qty,
                unit: 'stuk',
                isCustom: true,
            });
            m.remove();
            this.renderMaterials();
            this.toast('Eenmalig artikel toegevoegd — Felicity krijgt taak bij verzenden');
        });
        document.getElementById('caCancel').addEventListener('click', () => m.remove());
    },

    // Veelgebruikte materialen bijhouden in localStorage
    _trackFavoriteMaterial(article) {
        try {
            const key = 'qe_fav_materials';
            const stored = JSON.parse(localStorage.getItem(key) || '[]');
            const existing = stored.find(a => String(a.id) === String(article.id));
            if (existing) {
                existing.count = (existing.count || 1) + 1;
            } else {
                stored.push({ id: article.id, name: article.name, salePrice: article.salePrice, unitPrice: article.unitPrice, unit: article.unit || 'stuk', count: 1 });
            }
            // Bewaar max 20
            stored.sort((a, b) => (b.count || 0) - (a.count || 0));
            localStorage.setItem(key, JSON.stringify(stored.slice(0, 20)));
        } catch (e) {}
    },

    renderFavoriteMaterials() {
        const container = document.getElementById('favoriteMaterialsList');
        const wrapper = document.getElementById('favoriteMaterials');
        if (!container || !wrapper) return;
        try {
            const stored = JSON.parse(localStorage.getItem('qe_fav_materials') || '[]');
            const top10 = stored.sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 10);
            if (top10.length === 0) { wrapper.style.display = 'none'; return; }
            container.innerHTML = top10.map(a => `
                <button class="btn btn-outline btn-sm" onclick='app.addMaterial(${JSON.stringify(a).replace(/'/g, "&#39;")})'
                    style="padding:5px 10px;font-size:12px;white-space:nowrap">
                    ${this.escapeHtml((a.name || '').substring(0, 25))}${(a.name || '').length > 25 ? '...' : ''}
                </button>
            `).join('');
            wrapper.style.display = '';
        } catch (e) { wrapper.style.display = 'none'; }
    },

    updateMaterialQty(articleId, delta) {
        if (!this.currentWO) return;
        const data = this.woData[this.currentWO.id];
        const idStr = String(articleId);
        const mat = data.materials.find(m => String(m.id) === idStr);
        if (!mat) return;
        mat.quantity = Math.max(0, mat.quantity + delta);
        if (mat.quantity === 0) data.materials = data.materials.filter(m => String(m.id) !== idStr);
        this.renderMaterials();
    },

    removeMaterial(articleId) {
        if (!this.currentWO) return;
        // Vergelijk als string zodat zowel numerieke als string-ids werken
        const idStr = String(articleId);
        this.woData[this.currentWO.id].materials = this.woData[this.currentWO.id].materials.filter(m => String(m.id) !== idStr);
        this.renderMaterials();
    },

    // Materiaal ontbreekt — melding naar kantoor
    openMissingMaterialReport() {
        if (!this.currentWO) return;
        const client = this.currentWO.client || {};
        const orderNr = this.currentWO.orderLogicId || this.currentWO.salesOrderId || '—';

        document.getElementById('modalContent').innerHTML = `
            <h3 style="font-size:16px;margin-bottom:12px">${this.icon('alert', { size: 18, style: 'vertical-align:-3px' })} Materiaal ontbreekt</h3>
            <p style="font-size:13px;color:var(--qe-grey);margin-bottom:12px">Laat het kantoor weten welk materiaal je nodig hebt. Er wordt een e-mail gestuurd.</p>
            <div class="form-group">
                <label>Welk materiaal ontbreekt?</label>
                <input type="text" class="form-input" id="missingMatName" placeholder="Naam of beschrijving van het materiaal">
            </div>
            <div class="form-group">
                <label>Aantal nodig</label>
                <input type="number" class="form-input" id="missingMatQty" value="1" min="1" style="width:80px">
            </div>
            <div class="form-group">
                <label>Extra opmerking (optioneel)</label>
                <textarea class="form-input" id="missingMatNote" rows="2" placeholder="Bijv. dringend, specifiek merk..."></textarea>
            </div>
            <button class="btn btn-primary btn-full" onclick="app._sendMissingMaterial()">${this.icon('mail-send', { size: 16, style: 'vertical-align:-3px' })} Verstuur melding</button>
        `;
        this.openModal();
    },

    _sendMissingMaterial() {
        const name = document.getElementById('missingMatName').value.trim();
        const qty = document.getElementById('missingMatQty').value || '1';
        const note = document.getElementById('missingMatNote').value.trim();

        if (!name) { this.toast('Vul het materiaal in'); return; }

        const client = this.currentWO?.client || {};
        const orderNr = this.currentWO?.orderLogicId || this.currentWO?.salesOrderId || '—';
        const techName = this.currentUser?.name || 'Onbekend';

        // Bouw e-mail via mailto: link
        const subject = `Materiaal ontbreekt — ${name} — Order ${orderNr}`;
        const body = [
            `Beste,`,
            ``,
            `Technieker ${techName} meldt dat volgend materiaal ontbreekt:`,
            ``,
            `Materiaal: ${name}`,
            `Aantal: ${qty}`,
            `Klant: ${client.name || 'Onbekend'}`,
            `Order: ${orderNr}`,
            note ? `Opmerking: ${note}` : '',
            ``,
            `Met vriendelijke groeten,`,
            techName,
        ].filter(l => l !== undefined).join('\n');

        window.open(`mailto:info@qe.be?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);

        // Sla ook op in localStorage als backup
        try {
            const reports = JSON.parse(localStorage.getItem('qe_missing_materials') || '[]');
            reports.push({ name, qty, note, orderNr, client: client.name, tech: techName, date: new Date().toISOString() });
            localStorage.setItem('qe_missing_materials', JSON.stringify(reports));
        } catch(e) {}

        this.closeModal();
        this.toast('Melding verstuurd naar kantoor');
    },

    renderMaterials() {
        if (!this.currentWO) return;
        const data = this.woData[this.currentWO.id];
        const container = document.getElementById('selectedMaterials');
        document.getElementById('materialCount').textContent = data.materials.length;

        if (data.materials.length === 0) {
            container.innerHTML = '<p class="text-grey text-sm text-center">Nog geen materialen toegevoegd</p>';
            return;
        }

        container.innerHTML = data.materials.map(mat => {
            const price = mat.salePrice || mat.unitPrice || 0;
            return `
                <div class="material-item">
                    <div class="mat-info">
                        <div class="mat-name">${this.escapeHtml(mat.name)}</div>
                        <div class="mat-price">${this.formatPrice(price)} / ${mat.unit || 'stuk'} = ${this.formatPrice(price * mat.quantity)}</div>
                    </div>
                    <div class="mat-qty">
                        <button class="qty-btn" onclick="app.updateMaterialQty('${String(mat.id).replace(/'/g,'&#39;')}', -1)">−</button>
                        <span class="qty-value">${mat.quantity}</span>
                        <button class="qty-btn" onclick="app.updateMaterialQty('${String(mat.id).replace(/'/g,'&#39;')}', 1)">+</button>
                    </div>
                    <button class="mat-remove" onclick="app.removeMaterial('${String(mat.id).replace(/'/g,'&#39;')}')">✕</button>
                </div>
            `;
        }).join('');
        this._saveWoData();
    },

    // ========================================
    // BTW TARIEF AANPASSEN
    // ========================================
    _vatTariffsCache: null,

    async openChangeVatTariff() {
        if (!this.currentWO?.client?.id) { this.toast('Geen klant beschikbaar'); return; }

        document.getElementById('modalContent').innerHTML = `
            <h3>BTW tarief aanpassen</h3>
            <p style="font-size:13px;color:var(--qe-grey);margin-bottom:12px">
                Klant: <strong>${this.escapeHtml(this.currentWO.client.name)}</strong>
            </p>
            <div style="text-align:center;padding:16px"><div class="spinner"></div><div style="font-size:13px;color:var(--qe-grey);margin-top:8px">BTW tarieven laden...</div></div>
        `;
        this.openModal();

        // Laad alle beschikbare BTW tarieven uit Robaws
        try {
            if (!this._vatTariffsCache) {
                const result = await RobawsAPI.get('vat-tariffs?limit=50');
                if (result.code !== 200) throw new Error('Kon BTW tarieven niet ophalen');
                this._vatTariffsCache = (result.data.items || []).filter(t => t.name);
            }
            // v181: techniekers mogen enkel kiezen tussen 3 tarieven —
            // 21% (id 1), 6% (id 4), Verlegd (id 2). Andere tarieven verbergen.
            // (Levi bevestigde deze IDs; de oude hardcoded comment "2=12%"
            //  elders klopt dus niet voor dit tarief — apart na te kijken.)
            const ALLOWED_VAT_IDS = ['1', '4', '2'];
            const tariffs = ALLOWED_VAT_IDS
                .map(id => this._vatTariffsCache.find(t => String(t.id) === id))
                .filter(Boolean);
            const currentVatId = this.currentWO.client.vatTariffId;

            document.getElementById('modalContent').innerHTML = `
                <h3>BTW tarief aanpassen</h3>
                <p style="font-size:13px;color:var(--qe-grey);margin-bottom:12px">
                    Klant: <strong>${this.escapeHtml(this.currentWO.client.name)}</strong>
                </p>
                <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
                    ${tariffs.map(t => {
                        const isActive = String(t.id) === String(currentVatId);
                        return `<button class="btn ${isActive ? 'btn-primary' : 'btn-outline'} btn-sm btn-full"
                            id="vatOpt_${t.id}"
                            onclick="app._selectVatTariff('${t.id}')"
                            style="padding:12px;font-size:14px;text-align:left;display:flex;justify-content:space-between;align-items:center">
                            <span>${this.escapeHtml(t.name)}</span>
                            <span style="font-size:12px;opacity:0.7">${t.percentage !== undefined && t.percentage !== null ? t.percentage + '%' : ''}</span>
                        </button>`;
                    }).join('')}
                </div>
                <button class="btn btn-primary btn-full" id="btnSaveVat" onclick="app._saveVatTariff()" ${!currentVatId ? 'disabled' : ''} style="margin-bottom:8px">
                    ✓ Opslaan
                </button>
                <button class="btn btn-outline btn-full" onclick="app.closeModal()">Annuleren</button>
            `;
            this._selectedVatTariffId = currentVatId ? String(currentVatId) : null;
        } catch (err) {
            document.getElementById('modalContent').innerHTML = `
                <h3>BTW tarief aanpassen</h3>
                <p style="color:var(--qe-red);margin-bottom:12px">Kon BTW tarieven niet laden: ${this.escapeHtml(err.message)}</p>
                <button class="btn btn-outline btn-full" onclick="app.closeModal()">Sluiten</button>
            `;
        }
    },

    _selectedVatTariffId: null,

    _selectVatTariff(tariffId) {
        this._selectedVatTariffId = String(tariffId);
        // Update visuele selectie
        const tariffs = this._vatTariffsCache || [];
        tariffs.forEach(t => {
            const btn = document.getElementById(`vatOpt_${t.id}`);
            if (btn) {
                const isSelected = String(t.id) === String(tariffId);
                btn.className = `btn ${isSelected ? 'btn-primary' : 'btn-outline'} btn-sm btn-full`;
            }
        });
        const saveBtn = document.getElementById('btnSaveVat');
        if (saveBtn) saveBtn.disabled = false;
    },

    async _saveVatTariff() {
        if (!this._selectedVatTariffId || !this.currentWO?.client?.id) return;
        const clientId = this.currentWO.client.id;
        const newVatId = this._selectedVatTariffId;

        const saveBtn = document.getElementById('btnSaveVat');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Opslaan...'; }

        try {
            // Haal actuele klantdata op uit Robaws (PUT = FULL REPLACE)
            const clientResult = await RobawsAPI.get(`clients/${clientId}`);
            if (clientResult.code !== 200) throw new Error('Klant niet gevonden');
            const clientData = clientResult.data;

            // Update alleen vatTariffId
            clientData.vatTariffId = newVatId;

            // Schrijf terug naar Robaws
            const putResult = await RobawsAPI.put(`clients/${clientId}`, clientData);
            if (putResult.code !== 200 && putResult.code !== 204) {
                throw new Error('Kon klant niet bijwerken (code ' + putResult.code + ')');
            }

            // Update lokaal in currentWO
            this.currentWO.client.vatTariffId = newVatId;
            const selectedTariff = (this._vatTariffsCache || []).find(t => String(t.id) === String(newVatId));
            if (selectedTariff) {
                this.currentWO.client.vatPercentage = selectedTariff.percentage ?? null;
                this.currentWO.client.vatTariffName = selectedTariff.name || null;
            }

            // Update de display
            const display = document.getElementById('clientVatDisplay');
            if (display) {
                display.textContent = selectedTariff ? selectedTariff.name : 'Bijgewerkt';
            }

            this.closeModal();
            this.toast('BTW tarief bijgewerkt ');
        } catch (err) {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Opslaan'; }
            this.toast('Fout: ' + err.message);
        }
    },

    // ========================================
    // ONDERHOUD PICKER — 3-staps flow
    // ========================================
    _ohCatIdx: null,    // gekozen categorie-index
    _ohSizeIdx: null,   // gekozen vermogen-index
    _ohZone: null,      // gekozen zone
    _ohArticle: null,   // het resultaat-artikel
    _ohAutoZone: null,  // auto-gedetecteerde zone

    initOnderhoudPicker() {
        if (!window.ONDERHOUD_DATA || !window.ONDERHOUD_DATA.CATEGORIES) return;
        const container = document.getElementById('onderhoudCategories');
        if (!container) return;
        this._warmArticleCache();
        // Categorie-knoppen renderen
        container.innerHTML = ONDERHOUD_DATA.CATEGORIES.map((cat, i) => `
            <button class="btn btn-outline btn-sm" onclick="app.onderhoudPickCat(${i})"
                    style="padding:10px 8px;font-size:13px;display:flex;align-items:center;gap:6px;justify-content:center">
                <span>${cat.icon}</span> ${cat.label}
            </button>
        `).join('');
        // Reset alles naar stap 1
        this._ohCatIdx = null;
        this._ohSizeIdx = null;
        this._ohZone = null;
        this._ohArticle = null;
        this._ohAutoZone = null;
        document.getElementById('onderhoudStep1').style.display = '';
        document.getElementById('onderhoudStep2').style.display = 'none';
        document.getElementById('onderhoudStep3').style.display = 'none';
        document.getElementById('onderhoudResult').style.display = 'none';
    },

    onderhoudPickCat(catIdx) {
        const cat = ONDERHOUD_DATA.CATEGORIES[catIdx];
        if (!cat) return;
        this._ohCatIdx = catIdx;

        // Als er maar 1 size is en die is NIET single, skip stap 2
        if (cat.sizes.length === 1 && !cat.sizes[0].single) {
            this._ohSizeIdx = 0;
            document.getElementById('onderhoudStep1').style.display = 'none';
            this._ohShowStep3(cat, cat.sizes[0]);
            return;
        }

        // Toon stap 2: vermogen kiezen
        document.getElementById('onderhoudCatLabel').innerHTML = cat.icon + ' ' + this.escapeHtml(cat.label);
        const sizesDiv = document.getElementById('onderhoudSizes');
        sizesDiv.innerHTML = cat.sizes.map((s, i) => `
            <button class="btn btn-outline btn-sm btn-full" onclick="app.onderhoudPickSize(${i})"
                    style="padding:10px 12px;text-align:left;font-size:14px">
                ${s.label}
            </button>
        `).join('');
        document.getElementById('onderhoudStep1').style.display = 'none';
        document.getElementById('onderhoudStep2').style.display = '';
        document.getElementById('onderhoudStep3').style.display = 'none';
        document.getElementById('onderhoudResult').style.display = 'none';
    },

    onderhoudPickSize(sizeIdx) {
        const cat = ONDERHOUD_DATA.CATEGORIES[this._ohCatIdx];
        const size = cat.sizes[sizeIdx];
        this._ohSizeIdx = sizeIdx;

        if (size.single) {
            // Geen zone nodig — direct resultaat tonen
            this._ohArticle = {
                id: size.articleId,
                name: `Onderhoud ${cat.label} ${size.label}`,
                salePrice: size.price,
                unitPrice: size.price,
                unit: 'stuk'
            };
            const info = document.getElementById('onderhoudResultInfo');
            info.innerHTML = `<strong>${this.escapeHtml(this._ohArticle.name)}</strong>` +
                `<br><span class="monteur-hide">Prijs: <span id="onderhoudResultPrice">${size.price ? this.formatPrice(size.price) : '…'}</span></span>`;
            document.getElementById('onderhoudStep2').style.display = 'none';
            document.getElementById('onderhoudResult').style.display = '';
            this._ohPricePromise = this._ohApplyLivePrice(size.price);
            return;
        }

        this._ohShowStep3(cat, size);
    },

    _ohShowStep3(cat, size) {
        document.getElementById('onderhoudSizeLabel').innerHTML =
            cat.icon + ' ' + this.escapeHtml(cat.label + ' — ' + size.label);
        document.getElementById('onderhoudStep1').style.display = 'none';
        document.getElementById('onderhoudStep2').style.display = 'none';
        document.getElementById('onderhoudStep3').style.display = '';
        document.getElementById('onderhoudResult').style.display = 'none';
        document.getElementById('onderhoudGemeente').value = '';
        document.getElementById('onderhoudGemeenteResults').style.display = 'none';

        // Auto-detectie: probeer zone af te leiden van adres (dagplanning → klant)
        const address = this.currentWO?.address || this.currentWO?.client?.address || '';
        const autoZone = ONDERHOUD_DATA.detectZoneFromAddress(address);
        const autoDiv = document.getElementById('onderhoudAutoZone');
        if (autoZone) {
            this._ohAutoZone = autoZone;
            const verpl = ONDERHOUD_DATA.ZONE_VERPLAATSING[autoZone] || '?';
            const zoneData = size.zones[autoZone];
            const priceStr = zoneData && zoneData.price ? ` — ${this.formatPrice(zoneData.price)}` : '';
            document.getElementById('onderhoudAutoZoneText').innerHTML =
                `Zone ${autoZone} (€${verpl} verplaatsing)<span class="monteur-hide">${priceStr}</span>`;
            autoDiv.style.display = '';
        } else {
            this._ohAutoZone = null;
            autoDiv.style.display = 'none';
        }
    },

    onderhoudAcceptAutoZone() {
        if (this._ohAutoZone) this.onderhoudSelectZone(this._ohAutoZone);
    },

    onderhoudSearchGemeente(query) {
        const container = document.getElementById('onderhoudGemeenteResults');
        if (!query || query.length < 2) { container.style.display = 'none'; return; }
        const results = ONDERHOUD_DATA.searchGemeenten(query);
        if (results.length === 0) {
            container.innerHTML = '<div style="padding:8px;font-size:13px;color:var(--qe-grey);text-align:center">Geen gemeente gevonden</div>';
            container.style.display = 'block';
            return;
        }
        container.innerHTML = results.map(r => `
            <div class="card card-clickable" style="padding:8px 12px;margin-bottom:3px"
                 onclick="app.onderhoudSelectZone(${r.zone})">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:14px;text-transform:capitalize">${this.escapeHtml(r.gemeente)}</span>
                    <span style="font-size:12px;color:var(--qe-purple);font-weight:500">Zone ${r.zone} — €${r.verplaatsing}</span>
                </div>
            </div>
        `).join('');
        container.style.display = 'block';
    },

    onderhoudSelectZone(zone) {
        const cat = ONDERHOUD_DATA.CATEGORIES[this._ohCatIdx];
        const size = cat.sizes[this._ohSizeIdx];
        const zoneData = size.zones[zone];
        if (!zoneData) return;
        this._ohZone = zone;
        // v199: start met de bekende prijs; de ACTUELE prijs wordt live uit Robaws gehaald (op id).
        this._ohArticle = {
            id: zoneData.id,
            name: `Onderhoud ${cat.label.replace(' (AG)', '')} ${size.label} - ZONE ${zone}`,
            salePrice: zoneData.price,
            unitPrice: zoneData.price,
            unit: 'stuk'
        };
        const verpl = ONDERHOUD_DATA.ZONE_VERPLAATSING[zone] || '?';
        const info = document.getElementById('onderhoudResultInfo');
        info.innerHTML = `<strong>${this.escapeHtml(this._ohArticle.name)}</strong>` +
            `<br><span style="font-size:12px;color:var(--qe-grey)">Zone ${zone} — verplaatsing €${verpl}</span>` +
            `<br><span class="monteur-hide">Prijs: <span id="onderhoudResultPrice">${zoneData.price ? this.formatPrice(zoneData.price) : '…'}</span></span>`;
        document.getElementById('onderhoudStep3').style.display = 'none';
        document.getElementById('onderhoudResult').style.display = '';
        this._ohPricePromise = this._ohApplyLivePrice(zoneData.price);
    },

    onderhoudBack(toStep) {
        document.getElementById('onderhoudStep1').style.display = toStep === 1 ? '' : 'none';
        document.getElementById('onderhoudStep2').style.display = toStep === 2 ? '' : 'none';
        document.getElementById('onderhoudStep3').style.display = 'none';
        document.getElementById('onderhoudResult').style.display = 'none';
        this._ohArticle = null;
    },

    async onderhoudAddToMaterials() {
        if (!this._ohArticle || !this.currentWO) return;
        // v199: wacht op de live prijs uit Robaws zodat de ACTUELE prijs wordt toegevoegd
        try { if (this._ohPricePromise) await this._ohPricePromise; } catch (e) {}
        this.addMaterial(this._ohArticle);

        // Verplaatsingskosten worden NIET apart toegevoegd bij onderhoud —
        // de verplaatsing zit al verrekend in de onderhoudsprijs (zone-gebaseerd).

        // Reset naar stap 1
        this.initOnderhoudPicker();
    },

    // v199: haalt de ACTUELE onderhoudsprijs op uit Robaws (op artikel-id) i.p.v. de
    // opgeslagen statische prijs. Werkt async: werkt het scherm bij zodra de prijs binnen is.
    async _ohApplyLivePrice(fallback) {
        const art = this._ohArticle;
        if (!art || art.id == null) return;
        let price = fallback;
        try {
            if (window.RobawsAPI && RobawsAPI.get) {
                const r = await RobawsAPI.get('articles/' + art.id);
                const a = (r && r.data) ? r.data : null;
                const p = a ? (a.salePrice != null ? a.salePrice : a.unitPrice) : null;
                if (p != null) price = p;
            }
        } catch (e) {}
        if (this._ohArticle && String(this._ohArticle.id) === String(art.id)) {
            this._ohArticle.salePrice = price;
            this._ohArticle.unitPrice = price;
            const el = document.getElementById('onderhoudResultPrice');
            if (el) el.textContent = this.formatPrice(price);
        }
    },

    // ========================================
    // VERPLAATSINGSKOSTEN PICKER (regie)
    // ========================================
    initVerplaatsingPicker() {
        if (!window.ONDERHOUD_DATA) return;
        // Auto-detectie: probeer zone af te leiden van adres (dagplanning → klant)
        const address = this.currentWO?.address || this.currentWO?.client?.address || '';
        const autoZone = ONDERHOUD_DATA.detectZoneFromAddress(address);
        const autoDiv = document.getElementById('verplAutoZone');
        if (autoZone) {
            const price = ONDERHOUD_DATA.ZONE_VERPLAATSING[autoZone] || 0;
            document.getElementById('verplAutoZoneText').innerHTML =
                `Zone ${autoZone} — €${price}`;
            autoDiv.style.display = '';
            autoDiv.dataset.zone = autoZone;
        } else {
            autoDiv.style.display = 'none';
        }
        // Reset zoekresultaten
        document.getElementById('verplGemeente').value = '';
        document.getElementById('verplGemeenteResults').style.display = 'none';
    },

    verplAcceptAutoZone() {
        const zone = parseInt(document.getElementById('verplAutoZone').dataset.zone);
        if (zone) this.verplSelectZone(zone);
    },

    verplSearchGemeente(query) {
        const container = document.getElementById('verplGemeenteResults');
        if (!query || query.length < 2) { container.style.display = 'none'; return; }
        const results = ONDERHOUD_DATA.searchGemeenten(query);
        if (results.length === 0) {
            container.innerHTML = '<div style="padding:8px;font-size:13px;color:var(--qe-grey);text-align:center">Geen gemeente gevonden</div>';
            container.style.display = 'block';
            return;
        }
        container.innerHTML = results.map(r => `
            <div class="card card-clickable" style="padding:8px 12px;margin-bottom:3px"
                 onclick="app.verplSelectZone(${r.zone})">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:14px;text-transform:capitalize">${this.escapeHtml(r.gemeente)}</span>
                    <span style="font-size:12px;color:var(--qe-purple);font-weight:500">Zone ${r.zone} — €${r.verplaatsing}</span>
                </div>
            </div>
        `).join('');
        container.style.display = 'block';
    },

    verplSelectZone(zone) {
        if (!this.currentWO || !window.ONDERHOUD_DATA) return;
        const price = ONDERHOUD_DATA.ZONE_VERPLAATSING[zone] || 0;
        const articleData = (ONDERHOUD_DATA.VERPLAATSING_ARTICLES && ONDERHOUD_DATA.VERPLAATSING_ARTICLES[zone]) || {};
        const articleId = articleData.id || `verpl-zone-${zone}`;

        const article = {
            id: articleId,
            name: `Verplaatsingskosten Zone ${zone}`,
            salePrice: price,
            unitPrice: price,
            unit: 'stuk'
        };
        this.addMaterial(article);
        // Reset picker
        this.initVerplaatsingPicker();
    },

    // ========================================
    // ARTIKELGROEPEN BROWSER
    // ========================================
    _allArticlesCache: null,

    async _loadAllArticlesXampp(onProgress) {
        if (this._allArticlesCache) return this._allArticlesCache;
        // Haal alle artikelen op via PHP (met session cache op server)
        const res = await fetch('api/articles-all.php');
        const data = await res.json();
        this._allArticlesCache = data.articles || [];
        return this._allArticlesCache;
    },

    async showArticleGroups() {
        const container = document.getElementById('articleGroupBrowser');
        if (!container) return;

        container.style.display = 'block';

        // Laad groepen (nu instant vanuit SQLite)
        if (!this.articleGroups) {
            container.innerHTML = `
                <div style="text-align:center;padding:32px 16px">
                    <div class="spinner"></div>
                    <div style="font-size:13px;color:var(--qe-grey);margin-top:8px">Groepen laden...</div>
                </div>`;
            try {
                const res = await fetch('api/article-groups.php');
                const data = await res.json();
                const groups = data.groups || [];

                const rootGroups = [];
                const childMap = {};
                groups.forEach(g => {
                    g.children = [];
                    if (!g.parentId) rootGroups.push(g);
                    else {
                        if (!childMap[g.parentId]) childMap[g.parentId] = [];
                        childMap[g.parentId].push(g);
                    }
                });
                function addChildren(group) {
                    group.children = childMap[group.id] || [];
                    group.children.forEach(addChildren);
                }
                rootGroups.forEach(addChildren);

                this.articleGroups = { all: groups, tree: rootGroups };
            } catch (err) {
                container.innerHTML = '<p class="text-grey text-sm text-center">Groepen laden mislukt</p>';
                return;
            }
        }

        this.currentGroupId = null;
        this.groupBreadcrumb = [];
        this.renderGroupBrowser();
    },

    hideArticleGroups() {
        const container = document.getElementById('articleGroupBrowser');
        if (container) container.style.display = 'none';
        this.currentGroupId = null;
        this.groupBreadcrumb = [];
    },

    // Slimme iconen per groepsnaam (Robaws API geeft geen afbeeldingen)
    getGroupIcon(name) {
        const n = (name || '').toLowerCase();
        if (n.includes('verplaatsing') || n.includes('transport')) return { icon: this.icon('car', { size: 28 }), bg: 'linear-gradient(135deg,#e3f2fd,#bbdefb)' };
        if (n.includes('koper') || n.includes('koperen') || n.includes('leiding')) return { icon: this.icon('tool', { size: 28 }), bg: 'linear-gradient(135deg,#fff3e0,#ffe0b2)' };
        if (n.includes('mannesmann') || n.includes('buis') || n.includes('pijp')) return { icon: this.icon('tool', { size: 28 }), bg: 'linear-gradient(135deg,#efebe9,#d7ccc8)' };
        if (n.includes('onderhoud') || n.includes('service')) return { icon: this.icon('tool', { size: 28 }), bg: 'linear-gradient(135deg,#e8f5e9,#c8e6c9)' };
        if (n.includes('expansie') || n.includes('vat')) return { icon: this.icon('package', { size: 28 }), bg: 'linear-gradient(135deg,#fce4ec,#f8bbd0)' };
        if (n.includes('thermostaat') || n.includes('regeling') || n.includes('temp')) return { icon: this.icon('thermometer', { size: 28 }), bg: 'linear-gradient(135deg,#e8eaf6,#c5cae9)' };
        if (n.includes('bosch') || n.includes('junker')) return { icon: this.icon('flame', { size: 28 }), bg: 'linear-gradient(135deg,#fff8e1,#ffecb3)' };
        if (n.includes('ketel') || n.includes('cv')) return { icon: this.icon('flame', { size: 28 }), bg: 'linear-gradient(135deg,#fbe9e7,#ffccbc)' };
        if (n.includes('atag') || n.includes('remeha') || n.includes('vaillant')) return { icon: this.icon('home', { size: 28 }), bg: 'linear-gradient(135deg,#f3e5f5,#e1bee7)' };
        if (n.includes('radiat') || n.includes('convect')) return { icon: this.icon('package', { size: 28 }), bg: 'linear-gradient(135deg,#e0f7fa,#b2ebf2)' };
        if (n.includes('pomp') || n.includes('circul')) return { icon: this.icon('droplet', { size: 28 }), bg: 'linear-gradient(135deg,#e1f5fe,#b3e5fc)' };
        if (n.includes('ventiel') || n.includes('kraan') || n.includes('afsluit')) return { icon: this.icon('tool', { size: 28 }), bg: 'linear-gradient(135deg,#eceff1,#cfd8dc)' };
        if (n.includes('elektr') || n.includes('kabel') || n.includes('draad')) return { icon: this.icon('bolt', { size: 28 }), bg: 'linear-gradient(135deg,#fffde7,#fff9c4)' };
        if (n.includes('sanitair') || n.includes('douche') || n.includes('bad')) return { icon: this.icon('droplet', { size: 28 }), bg: 'linear-gradient(135deg,#e0f2f1,#b2dfdb)' };
        if (n.includes('gas') || n.includes('brandstof')) return { icon: this.icon('flame', { size: 28 }), bg: 'linear-gradient(135deg,#fff3e0,#ffe0b2)' };
        if (n.includes('filter') || n.includes('zuiver')) return { icon: this.icon('wind', { size: 28 }), bg: 'linear-gradient(135deg,#f1f8e9,#dcedc8)' };
        if (n.includes('isolatie') || n.includes('isoleer')) return { icon: this.icon('package', { size: 28 }), bg: 'linear-gradient(135deg,#efebe9,#d7ccc8)' };
        return { icon: this.icon('package', { size: 28 }), bg: 'linear-gradient(135deg,rgba(249,157,62,0.12),rgba(106,44,145,0.1))' };
    },

    renderGroupBrowser() {
        const container = document.getElementById('articleGroupBrowser');
        if (!container || !this.articleGroups) return;

        let groups;
        if (!this.currentGroupId) {
            groups = this.articleGroups.tree;
        } else {
            const current = this.articleGroups.all.find(g => String(g.id) === String(this.currentGroupId));
            groups = current ? (current.children || []) : [];
        }

        let html = '';

        // === HEADER BAR ===
        html += `<div style="display:flex;align-items:center;padding:10px 0 8px;border-bottom:1px solid #eee;margin-bottom:12px">`;
        if (this.groupBreadcrumb.length > 0) {
            html += `<button onclick="app.navigateGroupBack()" style="background:none;border:none;font-size:20px;padding:0 8px 0 0;cursor:pointer;color:var(--qe-purple)">‹</button>`;
        }
        html += `<div style="flex:1;min-width:0">`;
        html += `<div style="font-size:16px;font-weight:600;color:var(--qe-darkblue);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">`;
        html += this.groupBreadcrumb.length > 0
            ? this.escapeHtml(this.groupBreadcrumb[this.groupBreadcrumb.length - 1].name)
            : 'Artikelgroepen';
        html += `</div>`;
        if (this.groupBreadcrumb.length > 1) {
            const path = this.groupBreadcrumb.slice(0, -1).map(c => c.name).join(' › ');
            html += `<div style="font-size:11px;color:var(--qe-grey);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.escapeHtml(path)}</div>`;
        }
        html += `</div>`;
        html += `<button onclick="app.hideArticleGroups()" style="background:none;border:none;font-size:22px;padding:0 0 0 8px;cursor:pointer;color:var(--qe-grey);line-height:1">✕</button>`;
        html += `</div>`;

        // === SUBGROEPEN GRID ===
        if (groups.length > 0) {
            html += `<div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-bottom:12px">`;
            groups.forEach(g => {
                const hasChildren = g.children && g.children.length > 0;
                const escapedName = this.escapeHtml(g.name).replace(/'/g, "\\'");
                const { icon, bg } = this.getGroupIcon(g.name);
                html += `<div onclick="app.openGroup('${g.id}', '${escapedName}')" style="
                    cursor:pointer;background:#fff;border-radius:12px;overflow:hidden;
                    box-shadow:0 2px 6px rgba(0,30,69,0.08);border:1px solid #f0f0f0;
                    transition:transform 0.15s;text-align:center;
                " onmousedown="this.style.transform='scale(0.96)'" onmouseup="this.style.transform=''">
                    <div style="width:100%;height:68px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:30px">${icon}</div>
                    <div style="padding:8px 6px 6px">
                        <div style="font-size:12px;font-weight:600;color:var(--qe-darkblue);line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${this.escapeHtml(g.name)}</div>
                        ${hasChildren ? `<div style="font-size:10px;color:var(--qe-purple);margin-top:3px;font-weight:500">${g.children.length} subgroepen ›</div>` : ''}
                    </div>
                </div>`;
            });
            html += `</div>`;
        }

        // === ARTIKELEN IN HUIDIGE GROEP ===
        if (this.currentGroupId) {
            html += `<div style="border-top:1px solid #eee;padding-top:10px;margin-top:4px">
                <div style="font-size:13px;font-weight:600;color:var(--qe-darkblue);margin-bottom:8px">Artikelen</div>
                <div id="groupArticles"><div class="spinner" style="margin:8px auto"></div></div>
            </div>`;
        } else if (groups.length === 0) {
            html += `<div style="text-align:center;padding:20px;color:var(--qe-grey)">
                <div style="margin-bottom:8px;color:var(--qe-hint)">${this.icon('folder', { size: 28 })}</div>
                <div style="font-size:14px">Geen groepen gevonden</div>
            </div>`;
        }

        container.innerHTML = html;

        if (this.currentGroupId) {
            this.loadGroupArticles(this.currentGroupId);
        }
    },

    async openGroup(groupId, groupName) {
        this.groupBreadcrumb.push({ id: groupId, name: groupName });
        this.currentGroupId = groupId;
        this.renderGroupBrowser();
    },

    navigateGroupBack() {
        if (this.groupBreadcrumb.length <= 1) {
            this.currentGroupId = null;
            this.groupBreadcrumb = [];
        } else {
            this.groupBreadcrumb.pop();
            this.currentGroupId = this.groupBreadcrumb[this.groupBreadcrumb.length - 1].id;
        }
        this.renderGroupBrowser();
    },

    navigateGroup(groupId, breadcrumbIndex) {
        if (groupId === null) {
            this.currentGroupId = null;
            this.groupBreadcrumb = [];
        } else {
            this.currentGroupId = groupId;
            this.groupBreadcrumb = this.groupBreadcrumb.slice(0, breadcrumbIndex + 1);
        }
        this.renderGroupBrowser();
    },

    async loadGroupArticles(groupId) {
        const container = document.getElementById('groupArticles');
        if (!container) return;

        container.innerHTML = '<div class="spinner" style="margin:8px auto"></div>';

        let articles = [];
        try {
            const res = await fetch(`api/articles-by-group.php?groupId=${groupId}`);
            const data = await res.json();
            articles = data.articles || [];
        } catch (e) {
            container.innerHTML = '<p class="text-grey text-sm text-center">Laden mislukt</p>';
            return;
        }

        if (articles.length === 0) {
            container.innerHTML = '<p style="text-align:center;font-size:13px;color:var(--qe-grey);padding:8px">Geen artikelen in deze groep</p>';
            return;
        }

        // Bepaal icoon op basis van huidige groep
        const currentGroupName = this.groupBreadcrumb.length > 0
            ? this.groupBreadcrumb[this.groupBreadcrumb.length - 1].name : '';
        const { icon: groupIcon } = this.getGroupIcon(currentGroupName);

        container.innerHTML = articles.map(art => {
            return `
            <div class="card card-clickable" style="padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;border-left:3px solid var(--qe-orange)" onclick='app.addMaterial(${JSON.stringify({
                id: art.id,
                name: art.name,
                salePrice: art.salePrice,
                costPrice: art.costPrice,
                unitPrice: art.salePrice,
                unit: art.unitType || 'stuk',
            }).replace(/'/g, "&#39;")})'>
                <div style="width:40px;height:40px;border-radius:8px;background:#f5f5f5;margin-right:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${groupIcon}</div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.escapeHtml(art.name)}</div>
                    <div style="font-size:12px;color:var(--qe-grey);display:flex;justify-content:space-between;margin-top:2px">
                        <span>${art.unitType || 'stuk'}</span>
                        <span class="monteur-hide" style="font-weight:600;color:var(--qe-purple)">${this.formatPrice(art.salePrice)}</span>
                    </div>
                </div>
                <div style="margin-left:8px;color:var(--qe-orange);font-size:18px;flex-shrink:0">+</div>
            </div>`;
        }).join('');
    },

    // ========================================
    // FOTO'S
    // ========================================
    takePhoto() { document.getElementById('photoInput').click(); },
    pickPhoto() { document.getElementById('galleryInput').click(); },

    handlePhotos(input) {
        if (!input.files || !input.files.length || !this.currentWO) return;
        const files = Array.from(input.files);
        let loaded = 0;
        let failed = 0;

        // BUG-fix: vroeger werd loaded counter alleen verhoogd in de
        // onload-callback. Bij FileReader-fouten of img-decode-fouten
        // bleef de teller hangen → toast nooit getoond. Nu krijgt elke
        // foto een gegarandeerde callback-aanroep (success of fail).
        files.forEach((file, i) => {
            this.compressPhoto(file, (dataUrl) => {
                if (dataUrl) {
                    const name = file.name || `foto_${Date.now()}_${i}.jpg`;
                    const photo = {
                        id: Date.now() + i,
                        data: dataUrl,
                        name: name,
                    };
                    try {
                        this.woData[this.currentWO.id].photos.push(photo);
                    } catch (errPush) {
                        console.error('[App] photo push faalde:', errPush);
                    }
                    // v103+: foto's worden NIET meer in IndexedDB bewaard
                    // (veroorzaakte camera-crash). Native MainActivity slaat
                    // camera-foto's nu op in de Pictures/QE galerij, zodat
                    // monteurs ze handmatig terug kunnen toevoegen na refresh.
                } else {
                    failed++;
                }
                loaded++;
                if (loaded === files.length) {
                    this.renderPhotos();
                    if (failed > 0) {
                        this.toast(`${files.length - failed} foto('s) toegevoegd, ${failed} mislukt`);
                    } else {
                        this.toast(`${files.length} foto('s) toegevoegd`);
                    }
                }
            });
        });
        input.value = '';
    },

    compressPhoto(file, callback) {
        const maxWidth = 1600;
        const maxHeight = 1600;
        const quality = 0.7;
        // Veiligheid: cap inputbestand op 30 MB om OOM te voorkomen
        if (file && file.size > 30 * 1024 * 1024) {
            console.warn('[compressPhoto] bestand te groot:', file.size);
            try { callback(null); } catch(e) {}
            return;
        }

        // BUG-fix: gebruik createImageBitmap met imageOrientation:'from-image'
        // wanneer beschikbaar, zodat EXIF-rotatie van iPhone-foto's correct
        // wordt toegepast. Anders komen foto's gedraaid op de werkbon.
        const finishWithBitmap = (bitmap) => {
            try {
                let w = bitmap.width;
                let h = bitmap.height;
                if (w > maxWidth) { h = h * (maxWidth / w); w = maxWidth; }
                if (h > maxHeight) { w = w * (maxHeight / h); h = maxHeight; }
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(w);
                canvas.height = Math.round(h);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                bitmap.close && bitmap.close();
                callback(canvas.toDataURL('image/jpeg', quality));
            } catch(e) {
                callback(null);
            }
        };

        if (typeof createImageBitmap === 'function') {
            try {
                createImageBitmap(file, { imageOrientation: 'from-image' })
                    .then(finishWithBitmap)
                    .catch(() => fallbackPath());
                return;
            } catch(e) { /* val terug */ }
        }
        fallbackPath();

        function fallbackPath() {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        let w = img.width;
                        let h = img.height;
                        if (w > maxWidth) { h = h * (maxWidth / w); w = maxWidth; }
                        if (h > maxHeight) { w = w * (maxHeight / h); h = maxHeight; }
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.round(w);
                        canvas.height = Math.round(h);
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        callback(canvas.toDataURL('image/jpeg', quality));
                    } catch(err) { callback(null); }
                };
                img.onerror = () => callback(null);
                img.src = e.target.result;
            };
            reader.onerror = () => callback(null);
            reader.readAsDataURL(file);
        }
    },

    removePhoto(photoId) {
        if (!this.currentWO) return;
        this.woData[this.currentWO.id].photos = this.woData[this.currentWO.id].photos.filter(p => p.id !== photoId);
        this.renderPhotos();
        this._saveWoData();
    },

    // Planning line-items — knop tonen met aantal
    _renderPlanLineItems() {
        const section = document.getElementById('planLineItemsSection');
        const items = this.currentWO?.lineItems || [];

        if (items.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        document.getElementById('planItemsCount').textContent = `${items.length} artikel${items.length !== 1 ? 'en' : ''}`;
    },

    // Taakomschrijving fullscreen openen in apart scherm
    openFullDescription() {
        if (!this.currentWO) return;
        const desc = this.currentWO.description || '';
        if (!desc) return;

        const clientName = this.currentWO.client?.name || this.currentWO.summary || '';
        this.navigate('screenFullDescription');
        document.getElementById('fullDescSubtitle').textContent = clientName;

        const content = document.getElementById('fullDescContent');
        content.innerHTML = desc;

        // Verberg onlaadbare inline afbeeldingen
        content.querySelectorAll('img').forEach(img => {
            const src = (img.getAttribute('src') || '').trim();
            if (!src || img.hasAttribute('data-robaws-id')) {
                img.style.display = 'none';
            }
            img.onerror = () => { img.style.display = 'none'; };
        });
    },

    // Open apart scherm met alle planning items
    openPlanItems() {
        if (!this.currentWO) return;
        const items = this.currentWO.lineItems || [];
        const clientName = this.currentWO.client?.name || this.currentWO.summary || '';

        this.navigate('screenPlanItems');
        document.getElementById('planItemsSubtitle').textContent = clientName;

        const content = document.getElementById('planItemsContent');
        if (items.length === 0) {
            content.innerHTML = '<div class="empty-state"><div class="empty-icon">' + this.icon('package', { size: 44, stroke: 1.6 }) + '</div><h3>Geen items</h3></div>';
            return;
        }

        content.innerHTML = items.map((li, i) => {
            const desc = li.description || 'Artikel';
            const qty = li.quantity || 1;
            const unit = li.unitType || 'stuk';
            const checkId = `planItem_${this.currentWO?.id || 'x'}_${i}`;
            const checked = localStorage.getItem(checkId) === '1';
            return `
                <div class="card" style="display:flex;align-items:center;gap:14px;padding:16px;margin-bottom:10px;${checked ? 'opacity:0.5;' : ''}" id="planItemCard_${i}">
                    <label style="width:40px;height:40px;border-radius:10px;background:${checked ? 'var(--qe-green)' : 'rgba(106,44,145,0.08)'};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;cursor:pointer;transition:background 0.2s">
                        <input type="checkbox" ${checked ? 'checked' : ''} onchange="app.togglePlanItem(${i}, this.checked)" style="display:none">
                        <span style="font-size:20px;color:${checked ? 'var(--qe-green)' : 'var(--qe-grey)'}">${checked ? this.icon('check-circle', { size: 20 }) : this.icon('package', { size: 20 })}</span>
                    </label>
                    <div style="flex:1;min-width:0">
                        <div style="font-size:15px;font-weight:600;color:var(--qe-darkblue);line-height:1.3;${checked ? 'text-decoration:line-through;' : ''}">${this.escapeHtml(desc)}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-size:18px;font-weight:700;color:var(--qe-purple)">${qty}</div>
                        <div style="font-size:11px;color:var(--qe-grey)">${this.escapeHtml(unit)}</div>
                    </div>
                </div>`;
        }).join('');
    },

    togglePlanItem(index, checked) {
        const checkId = `planItem_${this.currentWO?.id || 'x'}_${index}`;
        localStorage.setItem(checkId, checked ? '1' : '0');
        const card = document.getElementById(`planItemCard_${index}`);
        if (card) {
            card.style.opacity = checked ? '0.5' : '1';
            const icon = card.querySelector('label span');
            if (icon) icon.innerHTML = checked ? this.icon('check-circle', { size: 20 }) : this.icon('package', { size: 20 });
            const label = card.querySelector('label');
            if (label) label.style.background = checked ? 'var(--qe-green)' : 'rgba(106,44,145,0.08)';
            const desc = card.querySelector('div[style*="font-weight:600"]');
            if (desc) desc.style.textDecoration = checked ? 'line-through' : 'none';
        }
    },

    // Planning documenten/bestanden tonen
    _renderPlanDocuments() {
        const section = document.getElementById('planDocumentsSection');
        const list = document.getElementById('planDocumentsList');
        const docs = this.currentWO?.documents || [];

        if (docs.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        // v181: knop om alle bestanden in 1 keer te downloaden (bij >1 bestand)
        const bulkBtn = docs.length > 1
            ? `<button class="btn btn-primary btn-sm btn-full" style="margin-bottom:8px" onclick="app.downloadAllPlanDocuments()">${this.icon('download', { size: 16, style: 'vertical-align:-3px' })} Alle ${docs.length} bestanden downloaden</button>`
            : '';
        list.innerHTML = bulkBtn + docs.map(doc => {
            const icon = this._getFileIcon(doc.contentType);
            const sizeStr = doc.size > 0 ? this._formatFileSize(doc.size) : '';
            return `
                <div class="card" style="display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:8px;cursor:pointer"
                     onclick="app.downloadPlanDocument('${doc.id}', '${this.escapeHtml(doc.name).replace(/'/g, "\\'")}')">
                    <span style="font-size:24px">${icon}</span>
                    <div style="flex:1;min-width:0">
                        <div style="font-size:14px;font-weight:500;color:var(--qe-darkblue);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHtml(doc.name)}</div>
                        ${sizeStr ? `<div style="font-size:12px;color:var(--qe-grey)">${sizeStr}</div>` : ''}
                    </div>
                    <span style="color:var(--qe-purple)">${this.icon('download', { size: 20 })}</span>
                </div>`;
        }).join('');
    },

    _getFileIcon(contentType) {
        if (!contentType) return this.icon('file', { size: 18 });
        if (contentType.includes('image')) return this.icon('image', { size: 18 });
        if (contentType.includes('pdf')) return this.icon('file', { size: 18 });
        if (contentType.includes('word') || contentType.includes('document')) return this.icon('file', { size: 18 });
        if (contentType.includes('sheet') || contentType.includes('excel')) return this.icon('file', { size: 18 });
        return this.icon('file', { size: 18 });
    },

    _formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    },

    async downloadPlanDocument(docId, fileName) {
        this.toast('Bestand ophalen...');
        try {
            // Download via Android native bridge (Java HTTP, geen browser redirect)
            const result = await RobawsAPI.getDocumentUrl(docId);
            const { blobUrl, contentType, blob } = result;

            if (contentType.includes('image')) {
                this.showModal(`
                    <div style="text-align:center">
                        <h3 style="margin-bottom:12px">${this.escapeHtml(fileName)}</h3>
                        <img src="${blobUrl}" style="max-width:100%;max-height:70vh;border-radius:8px" />
                        <br><br>
                        <button class="btn btn-primary" onclick="app._saveBlobToDevice('${docId}', '${this.escapeHtml(fileName).replace(/'/g, "\\'")}')">${this.icon('download', { size: 16, style: 'vertical-align:-3px' })} Opslaan</button>
                    </div>
                `);
            } else if (contentType.includes('pdf')) {
                this.showModal(`
                    <div style="text-align:center">
                        <h3 style="margin-bottom:12px">${this.escapeHtml(fileName)}</h3>
                        <iframe src="${blobUrl}" style="width:100%;height:70vh;border:none;border-radius:8px"></iframe>
                        <br><br>
                        <button class="btn btn-primary" onclick="app._saveBlobToDevice('${docId}', '${this.escapeHtml(fileName).replace(/'/g, "\\'")}')">${this.icon('download', { size: 16, style: 'vertical-align:-3px' })} Opslaan</button>
                    </div>
                `);
            } else {
                // Overige bestanden: direct opslaan naar Downloads via native bridge
                await this._saveBlobNative(blob, fileName, contentType);
                URL.revokeObjectURL(blobUrl);
                return;
            }
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        } catch(e) {
            console.warn('Document download mislukt:', e);
            this.toast('Downloaden mislukt: ' + e.message, true);
        }
    },

    // Sla een blob op via de Android native bridge (QEBridge.saveBase64File)
    async _saveBlobNative(blob, fileName, mimeType) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                try {
                    // reader.result = "data:...;base64,xxxxx"
                    const base64 = reader.result.split(',')[1] || '';
                    if (typeof QEBridge !== 'undefined' && QEBridge.saveBase64File) {
                        const ok = QEBridge.saveBase64File(base64, fileName, mimeType || 'application/octet-stream');
                        if (ok) resolve(); else reject(new Error('Opslaan mislukt'));
                    } else {
                        // Geen native bridge: probeer via <a> download
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = fileName;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
                        resolve();
                    }
                } catch(e) { reject(e); }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    },

    // Knop in modal: herdownload en sla op
    async _saveBlobToDevice(docId, fileName) {
        this.toast('Opslaan...');
        try {
            const result = await RobawsAPI.getDocumentUrl(docId);
            await this._saveBlobNative(result.blob, fileName, result.contentType);
            URL.revokeObjectURL(result.blobUrl);
        } catch(e) {
            this.toast('Opslaan mislukt: ' + e.message, true);
        }
    },

    // v181: download ALLE dagplanning-bestanden in 1 keer (lus + native opslaan).
    async downloadAllPlanDocuments() {
        const docs = (this.currentWO && this.currentWO.documents) || [];
        if (docs.length === 0) { this.toast('Geen bestanden'); return; }
        let ok = 0, fail = 0;
        this.toast(docs.length + ' bestanden downloaden…');
        for (const doc of docs) {
            try {
                const result = await RobawsAPI.getDocumentUrl(doc.id);
                await this._saveBlobNative(result.blob, doc.name || ('bestand_' + doc.id), result.contentType);
                try { URL.revokeObjectURL(result.blobUrl); } catch(_) {}
                ok++;
            } catch (e) {
                console.warn('[PlanDocs] download faalde voor', doc && doc.name, e && e.message);
                fail++;
            }
        }
        this.toast(fail === 0
            ? ('✓ ' + ok + ' bestand(en) opgeslagen in Downloads')
            : (ok + ' opgeslagen, ' + fail + ' mislukt'));
    },

    renderPhotos() {
        if (!this.currentWO) return;
        const data = this.woData[this.currentWO.id];
        const count = data.photos.length;
        const countEl = document.getElementById('photoCount');
        countEl.textContent = count > 0 ? `${count} foto('s) toegevoegd` : '';

        document.getElementById('photoGrid').innerHTML = data.photos.map(p => `
            <div class="photo-thumb">
                <img src="${p.data}" alt="${this.escapeHtml(p.name)}">
                <button class="photo-delete" onclick="app.removePhoto(${p.id})">✕</button>
            </div>
        `).join('');
    },

    // ========================================
    // WERKBON OVERZICHT
    // ========================================
    // Slimme validatie vóór werkbon-preview
    _validateWerkbon() {
        if (!this.currentWO) return [];
        const data = this.woData[this.currentWO.id];
        const client = this.currentWO.client || {};
        const warnings = [];

        // v138: uren-verplichting alleen voor monteurs. Techniekers/bureel mogen
        // zonder uren versturen (bv. korte oproep zonder factureerbare tijd).
        const isMonteur = this.isMonteur();
        const noHours = !data.hours || data.hours.filter(h => h.type === 'klant').length === 0;
        if (noHours) {
            if (isMonteur) {
                warnings.push({ level: 'error', msg: 'Geen werkuren geregistreerd' });
            } else {
                warnings.push({ level: 'info', msg: 'Geen werkuren — werkbon wordt zonder uren verstuurd' });
            }
        }
        // Uurcode-check alleen relevant als er WEL werkuren zijn
        if (!noHours && !this.selectedUurcode) {
            warnings.push({ level: 'error', msg: 'Geen uurcode geselecteerd' });
        }

        // Waarschuwingen
        if (!client.vatTariffId && !client.vatPercentage) {
            warnings.push({ level: 'warn', msg: 'BTW tarief niet ingesteld voor klant' });
        }
        if ((!data.notes || data.notes.trim().length === 0)) {
            warnings.push({ level: 'warn', msg: 'Geen opmerkingen ingevuld' });
        }
        if (data.materials.length === 0) {
            warnings.push({ level: 'info', msg: 'Geen materialen toegevoegd' });
        }
        if (data.photos.length === 0) {
            warnings.push({ level: 'info', msg: 'Geen foto\u2019s genomen' });
        }

        // Checklist controle
        if (window.ONDERHOUD_DATA) {
            const clKey = ONDERHOUD_DATA.detectChecklist(this.currentWO.summary || '');
            if (clKey && ONDERHOUD_DATA.CHECKLISTS[clKey]) {
                const cl = ONDERHOUD_DATA.CHECKLISTS[clKey];
                const saved = data.checklist || {};
                const done = Object.values(saved).filter(v => v).length;
                if (done < cl.items.length) {
                    warnings.push({ level: 'warn', msg: `Checklist niet volledig (${done}/${cl.items.length} afgevinkt)` });
                }
            }
        }

        // Handtekening verplicht bij onderhoudsjobs
        const summaryLower = (this.currentWO.summary || '').toLowerCase();
        const isOnderhoud = summaryLower.includes('onderhoud') || summaryLower.includes('keuring')
            || summaryLower.includes('controle') || summaryLower.includes('schouw');
        if (isOnderhoud) {
            const sigData = this.getSignatureData ? this.getSignatureData() : null;
            const sigName = document.getElementById('wbSignatureName')?.value?.trim();
            if (!sigData || !sigName) {
                warnings.push({ level: 'warn', msg: 'Handtekening klant is verplicht bij onderhoudsjobs' });
            }
        }

        return warnings;
    },

    showWerkbonPreview() {
        if (!this.currentWO) return;
        this.woData[this.currentWO.id].notes = document.getElementById('workNotes').value;
        const data = this.woData[this.currentWO.id];
        const client = this.currentWO.client || {};

        // Validatie-check
        const warnings = this._validateWerkbon();
        const hasErrors = warnings.some(w => w.level === 'error');
        if (warnings.length > 0) {
            const icons = { error: this.icon('alert', { size: 18 }), warn: this.icon('alert', { size: 18 }), info: this.icon('info', { size: 18 }) };
            const colors = { error: 'var(--qe-red)', warn: 'var(--qe-orange)', info: 'var(--qe-grey)' };
            document.getElementById('modalContent').innerHTML = `
                <h3>Werkbon checklist</h3>
                <div style="margin-bottom:16px">
                    ${warnings.map(w => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--qe-grey-light)">
                        <span>${icons[w.level]}</span>
                        <span style="font-size:14px;color:${colors[w.level]}">${this.escapeHtml(w.msg)}</span>
                    </div>`).join('')}
                </div>
                ${hasErrors ? `
                    <p style="font-size:13px;color:var(--qe-red);margin-bottom:12px;font-weight:500">Los de fouten op voordat je de werkbon verstuurt.</p>
                    <button class="btn btn-outline btn-full" onclick="app.closeModal()">Terug</button>
                ` : `
                    <p style="font-size:13px;color:var(--qe-grey);margin-bottom:12px">Er zijn waarschuwingen, maar je kunt toch doorgaan.</p>
                    <button class="btn btn-primary btn-full" onclick="app.closeModal(); app._showWerkbonPreviewDirect();" style="margin-bottom:8px">Toch doorgaan</button>
                    <button class="btn btn-outline btn-full" onclick="app.closeModal()">Terug naar werkbon</button>
                `}
            `;
            this.openModal();
            if (hasErrors) return;
            return; // Modal toont "toch doorgaan" knop
        }
        this._showWerkbonPreviewDirect();
    },

    _showWerkbonPreviewDirect() {
        if (!this.currentWO) return;
        const data = this.woData[this.currentWO.id];
        const client = this.currentWO.client || {};

        // Ordernummer, klantnaam, datum
        const orderNr = this.currentWO.orderLogicId || this.currentWO.salesOrderId || '—';
        document.getElementById('wbOrderNr').textContent = orderNr;
        document.getElementById('wbClientName').textContent = client.name || 'Onbekend';
        document.getElementById('wbDate').textContent = this.currentDate.toLocaleDateString('nl-BE');

        // BTW badge op het overzicht
        const vatPctBadge = client.vatPercentage ?? null;
        const vatNameBadge = client.vatTariffName || (vatPctBadge !== null ? `${vatPctBadge}%` : null);
        const btwBadge = document.getElementById('wbBtwBadge');
        if (vatNameBadge) {
            btwBadge.textContent = `BTW: ${vatNameBadge}`;
            btwBadge.style.display = 'inline-block';
        } else {
            btwBadge.textContent = 'BTW: onbekend';
            btwBadge.style.display = 'inline-block';
        }

        // Uren
        const hoursContent = document.getElementById('wbHoursContent');
        if (data.hours.length === 0) {
            hoursContent.innerHTML = '<p class="text-grey text-sm">Geen uren geregistreerd</p>';
        } else {
            const totals = { klant: 0, verplaatsing: 0 };
            let totalPauze = 0;
            data.hours.forEach(h => {
                totals[h.type] = (totals[h.type] || 0) + h.duration;
                if (h.pauze) totalPauze += h.pauze;
            });
            const urcodeLabel = this.selectedUurcode ? this.selectedUurcode.name : 'Geen uurcode';

            // Groepeer uren per werknemer voor overzicht
            const byEmployee = {};
            data.hours.filter(h => h.type === 'klant').forEach(h => {
                const name = h.employeeName || this.currentUser?.name || 'Onbekend';
                if (!byEmployee[name]) byEmployee[name] = { duration: 0, pauze: 0 };
                byEmployee[name].duration += h.duration;
                byEmployee[name].pauze += (h.pauze || 0);
            });
            const empRows = Object.entries(byEmployee).map(([name, d]) =>
                `<div class="day-hours-row"><span>${this.icon('user', { size: 13, style: 'vertical-align:-2px' })} ${this.escapeHtml(name)}</span><span style="font-weight:500">${this.formatMinutes(d.duration)}${d.pauze > 0 ? ` <span style="font-size:11px;color:var(--qe-grey)">(${this.icon('coffee', { size: 12, style: 'vertical-align:-2px' })} ${d.pauze}m)</span>` : ''}</span></div>`
            ).join('');

            hoursContent.innerHTML = `
                ${this.selectedUurcode ? `<div style="font-size:12px;color:var(--qe-purple);margin-bottom:8px">Uurcode: ${this.escapeHtml(urcodeLabel)}</div>` : ''}
                ${empRows}
                ${totals.verplaatsing > 0 ? `<div class="day-hours-row"><span>Verplaatsing</span><span style="font-weight:500">${this.formatMinutes(totals.verplaatsing)}</span></div>` : ''}
                <div class="day-hours-row total"><span>Totaal werkuren</span><span>${this.formatMinutes(totals.klant)}</span></div>
            `;
        }

        // Materialen tabel
        const tbody = document.getElementById('wbMaterialRows');
        let subtotal = 0;
        let rows = '';

        // Werkuren als lijn toevoegen (uurcode × uren)
        // Bij onderhoud: werkuren worden NIET gefactureerd (verkoopprijs = € 0,00)
        if (this.selectedUurcode && data.hours.length > 0) {
            const totals = { klant: 0, verplaatsing: 0 };
            data.hours.forEach(h => { totals[h.type] = (totals[h.type] || 0) + h.duration; });

            if (totals.klant > 0) {
                // Afronden: wachturen per heel uur, overige per half uur
                const roundedMinutes = this.roundHoursForInvoice(totals.klant, this.selectedUurcode);
                const urenDecimal = Math.round(roundedMinutes / 60 * 100) / 100;
                const uurPrijsReal = this.selectedUurcode.salePrice || this.selectedUurcode.unitPrice || 0;
                const uurPrijs = data.onderhoud ? 0 : uurPrijsReal;
                const urenTotal = uurPrijs * urenDecimal;
                subtotal += urenTotal;
                const rawStr = totals.klant !== roundedMinutes ? ` <span style="font-size:11px;color:var(--qe-grey)">(${this.formatMinutes(totals.klant)} → afgerond)</span>` : '';
                const onderhoudTag = data.onderhoud ? ' <span style="font-size:11px;color:var(--qe-orange);font-weight:600">(onderhoud — niet factureren)</span>' : '';
                rows += `<tr style="background:rgba(106,44,145,0.05)"><td>${this.escapeHtml(this.selectedUurcode.name)}${rawStr}${onderhoudTag}</td><td class="text-right">${urenDecimal}u</td><td class="text-right">${this.formatPrice(uurPrijs)}</td><td class="text-right" style="font-weight:500">${this.formatPrice(urenTotal)}</td></tr>`;
            }
        }

        // Materialen
        if (data.materials.length > 0) {
            data.materials.forEach(mat => {
                const price = mat.salePrice || mat.unitPrice || 0;
                const total = price * mat.quantity;
                subtotal += total;
                rows += `<tr><td>${this.escapeHtml(mat.name)}</td><td class="text-right">${mat.quantity}</td><td class="text-right">${this.formatPrice(price)}</td><td class="text-right" style="font-weight:500">${this.formatPrice(total)}</td></tr>`;
            });
        }

        if (!rows) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-grey text-sm text-center" style="padding:16px">Geen materialen of uren</td></tr>';
        } else {
            tbody.innerHTML = rows;
        }

        // Totalen — alleen het juiste BTW tarief tonen (of beide als onbekend)
        document.getElementById('wbSubtotal').textContent = this.formatPrice(subtotal);

        const clientBtwInfo = document.getElementById('wbClientBtwInfo');
        const vatPct = client.vatPercentage ?? null;
        const vatName = client.vatTariffName || null;
        const btwRowsEl = document.getElementById('wbBtwRows');

        // v198: apart "tabje" met de transactiekost (1,5% bij kaartbetaling) + totaal incl. transactiekost
        const FEE_RATE = 0.015;
        const txBox = (totalIncl, btwLabel) => {
            const gross = totalIncl / (1 - FEE_RATE);
            const fee = gross - totalIncl;
            return `
                <div style="margin-top:10px;padding:10px 12px;background:#fff3e0;border-radius:10px">
                    <div style="font-size:11px;color:#e65100;font-weight:600;margin-bottom:4px">Bij kaartbetaling (Viva)${btwLabel ? ' — ' + btwLabel : ''}</div>
                    <div class="total-row"><span>Transactiekosten (1,5%)</span><span>${this.formatPrice(fee)}</span></div>
                    <div class="total-row subtotal" style="font-weight:700;color:#e65100"><span>Totaal incl. transactiekosten</span><span>${this.formatPrice(gross)}</span></div>
                </div>`;
        };

        if (vatPct !== null && vatName) {
            // Klant heeft een bekend BTW tarief — toon alleen dat tarief
            clientBtwInfo.innerHTML = `<span style="font-weight:600;color:var(--qe-purple)">Klant BTW: ${this.escapeHtml(vatName)}</span>`;
            clientBtwInfo.style.background = 'rgba(106,44,145,0.08)';
            clientBtwInfo.style.display = 'block';

            const pct = vatPct / 100;
            const btwBedrag = subtotal * pct;
            btwRowsEl.innerHTML = `
                <div class="total-row" style="font-weight:600;color:var(--qe-purple)">
                    <span>BTW ${vatPct}%</span>
                    <span>${this.formatPrice(btwBedrag)}</span>
                </div>
                <div class="total-row subtotal" style="font-weight:700;color:var(--qe-purple)">
                    <span>Totaal incl. ${vatPct}% BTW</span>
                    <span>${this.formatPrice(subtotal + btwBedrag)}</span>
                </div>` + txBox(subtotal + btwBedrag, '');
        } else {
            // Onbekend BTW tarief — toon beide zodat technieker kan vergelijken
            clientBtwInfo.innerHTML = '<span style="color:var(--qe-orange);font-weight:600">Klant BTW: niet ingesteld in Robaws</span>';
            clientBtwInfo.style.background = 'rgba(249,157,62,0.1)';
            clientBtwInfo.style.display = 'block';

            const btw6 = subtotal * 0.06;
            const btw21 = subtotal * 0.21;
            btwRowsEl.innerHTML = `
                <div class="total-row"><span>BTW 6%</span><span>${this.formatPrice(btw6)}</span></div>
                <div class="total-row"><span>BTW 21%</span><span>${this.formatPrice(btw21)}</span></div>
                <div class="total-row subtotal"><span>Totaal incl. 6% BTW</span><span style="font-weight:500">${this.formatPrice(subtotal + btw6)}</span></div>
                <div class="total-row subtotal"><span>Totaal incl. 21% BTW</span><span style="font-weight:500">${this.formatPrice(subtotal + btw21)}</span></div>` + txBox(subtotal + btw6, '6% BTW') + txBox(subtotal + btw21, '21% BTW');
        }

        // Opmerkingen & foto's
        const notesCard = document.getElementById('wbNotesCard');
        if (data.notes) { document.getElementById('wbNotes').textContent = data.notes; notesCard.style.display = 'block'; }
        else notesCard.style.display = 'none';

        const photosSection = document.getElementById('wbPhotos');
        if (data.photos.length > 0) {
            document.getElementById('wbPhotoCount').textContent = data.photos.length;
            document.getElementById('wbPhotoGrid').innerHTML = data.photos.map(p => `<div class="photo-thumb"><img src="${p.data}" alt="Foto"></div>`).join('');
            photosSection.style.display = 'block';
        } else photosSection.style.display = 'none';

        // Reset handtekening sectie
        const sigSection = document.getElementById('wbSignatureSection');
        if (sigSection) sigSection.style.display = 'none';
        const sigName = document.getElementById('wbSignatureName');
        if (sigName) sigName.value = '';
        // v169: reset email-veld
        const sigEmail = document.getElementById('wbSignatureEmail');
        if (sigEmail) sigEmail.value = '';

        // Reset betaalmethode
        this._selectedPaymentMethod = null;
        const pmSection = document.getElementById('wbPaymentMethodSection');
        const pmEmailSection = document.getElementById('wbOverschrijvingEmail');
        const btn = document.getElementById('btnSubmitWerkbon');

        if (this.isMonteur()) {
            // Monteurs: eenvoudige flow zonder betaalmethode
            if (pmSection) pmSection.style.display = 'none';
            if (pmEmailSection) pmEmailSection.style.display = 'none';
            if (btn) {
                btn.innerHTML = 'Uren & materiaal versturen';
                btn.onclick = () => this.executeMonteurSubmitFlow();
                btn.disabled = false;
            }
        } else {
            // Techniekers: betaalmethode keuze tonen
            if (pmSection) pmSection.style.display = '';
            if (pmEmailSection) pmEmailSection.style.display = 'none';
            // Deselecteer alle betaalmethode-knoppen
            document.querySelectorAll('.payment-method-btn').forEach(b => {
                b.style.background = '';
                b.style.color = '';
                b.style.borderColor = '';
            });
            if (btn) {
                btn.innerHTML = 'Ondertekenen & Versturen';
                btn.onclick = () => this.startSubmitFlow();
                btn.disabled = true; // Pas actief na betaalmethode selectie
            }
        }

        // Bewaar vatTariffId op currentWO voor factuur-aanmaak
        // Robaws vat-tariff IDs: 1=21%, 2=Verlegd (0%), 3=0%, 4=6%   // v182: 2 = verlegd, niet 12%
        // BUG-fix: Robaws kan vatPercentage als string ("6") teruggeven.
        // De vorige === vergelijkingen faalden dan stilletjes en de
        // factuur kreeg de default 6% (vatTariffId='4'), waardoor
        // 21%-klanten een verkeerd tarief op hun factuur kregen.
        const vatPctNum = (client.vatPercentage === null || client.vatPercentage === undefined)
            ? null
            : Number(client.vatPercentage);
        if (vatPctNum === 6) this.currentWO.vatTariffId = '4';
        else if (vatPctNum === 21) this.currentWO.vatTariffId = '1';
        else if (vatPctNum === 0) this.currentWO.vatTariffId = '3';
        // v182: 12% -> id 2 mapping VERWIJDERD (id 2 = Verlegd/0%, niet 12%).

        this.navigate('screenWerkbon');
    },

    async submitWerkbon() {
        if (!this.currentWO) return;
        const data = this.woData[this.currentWO.id];

        // Validatie: uurcode moet gekozen zijn als er werkuren zijn
        const hasWorkHours = data.hours.some(h => h.type === 'klant');
        if (hasWorkHours && !this.selectedUurcode) {
            this.toast('Kies eerst een uurcode in het Uren tabblad');
            return;
        }

        try {
            // Garandeer dat we een Robaws userId hebben — voorkomt werkbonnen
            // zonder verantwoordelijke (zie executeSubmitFlow voor uitleg).
            try {
                if (this.currentUser && !this.currentUser.robawsUserId) {
                    await RobawsAPI.ensureUserId();
                }
            } catch(e) { /* server-side fallback in robaws-api.js */ }

            const res = await fetch('api/werkbon.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    salesOrderId: this.currentWO.salesOrderId || null,
                    planningItemId: this.currentWO.id,
                    clientId: this.currentWO.clientId,
                    installationIds: this.currentWO.installationIds || [],
                    employeeId: this.currentUser.robawsEmployeeId,
                    userId: this.currentUser.robawsUserId,
                    clientName: (this.currentWO.client && this.currentWO.client.name) || '',
                    summary: this.currentWO.summary || 'Werkbon via QE App',
                    date: this._localDateStr(this.currentDate),
                    materials: data.materials.map(m => ({
                        articleId: m.id,
                        name: m.name,
                        quantity: m.quantity,
                        unitPrice: m.salePrice ?? m.unitPrice ?? 0,
                    })),
                    hours: this._roundHoursForSubmit(data.hours),
                    notes: data.notes,
                    uurcode: this.selectedUurcode,
                    verplaatsingCode: this.verplaatsingCode,
                }),
            });
            const result = await res.json();

            if (result.success) {
                // Foto's uploaden naar het aangemaakte work order
                if (data.photos.length > 0 && result.workOrderId) {
                    this.toast('Foto\'s uploaden...');
                    try {
                        await fetch('api/upload-photo.php', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                workOrderId: result.workOrderId,
                                photos: data.photos.map(p => ({ data: p.data, name: p.name })),
                            }),
                        });
                    } catch (photoErr) { /* niet kritisch */ }
                }

                this.toast('Werkbon verstuurd ');
                // Bewaar uren voor daguren overzicht vóór reset
                const woId = this.currentWO.id;
                if (!this.submittedHours[woId]) this.submittedHours[woId] = [];
                this.submittedHours[woId].push(...data.hours);
                this.woData[woId] = { hours: [], materials: [], photos: [], notes: '' };
                this._saveWoData();
                // Markeer als ingediend zodat deze niet meer in planning verschijnt
                this.submittedWOs.push(String(woId));
                this.navigate('screenPlanning', false);
                this.screenHistory = [];
            } else {
                this.toast('Fout: ' + (result.error || 'Onbekende fout'));
            }
        } catch (err) {
            // Offline? Zet in wachtrij!
            if (!navigator.onLine) {
                await this.queueWerkbonOffline(data);
            } else {
                this.toast('Versturen mislukt — controleer je verbinding');
            }
        }
    },

    async queueWerkbonOffline(data) {
        try {
            const payload = {
                workOrderId: this.currentWO.salesOrderId || null,
                salesOrderId: this.currentWO.salesOrderId || null,
                planningItemId: this.currentWO.id,
                clientId: this.currentWO.clientId,
                installationIds: this.currentWO.installationIds || [],
                employeeId: this.currentUser.robawsEmployeeId,
                userId: this.currentUser.robawsUserId,
                clientName: (this.currentWO.client && this.currentWO.client.name) || '',
                summary: this.currentWO.summary || 'Werkbon via QE App',
                date: this._localDateStr(this.currentDate),
                materials: data.materials.map(m => ({
                    articleId: m.id,
                    name: m.name,
                    quantity: m.quantity,
                    unitPrice: m.salePrice ?? m.unitPrice ?? 0,
                    costPrice: m.costPrice || 0,
                })),
                hours: this._roundHoursForSubmit(data.hours),
                notes: data.notes,
                uurcode: this.selectedUurcode,
                verplaatsingCode: this.verplaatsingCode,
            };

            const res = await fetch('api/werkbon-queue.php?action=add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await res.json();

            if (result.success) {
                this.toast('Werkbon in wachtrij geplaatst (wordt verstuurd bij verbinding)');
                const woId = this.currentWO.id;
                this.woData[woId] = { hours: [], materials: [], photos: [], notes: '' };
                this.submittedWOs.push(String(woId));
                this.navigate('screenPlanning', false);
                this.screenHistory = [];
            } else {
                this.toast('Kon werkbon niet in wachtrij plaatsen');
            }
        } catch (e) {
            this.toast('Werkbon kon niet opgeslagen worden');
        }
    },

    // ========================================
    // HANDTEKENING & BETAALFLOW
    // ========================================

    // Signature canvas state
    signatureCtx: null,
    signatureDrawing: false,
    signatureHasContent: false,

    initSignatureCanvas() {
        const oldCanvas = document.getElementById('signatureCanvas');
        if (!oldCanvas) return;

        // BUG-fix: bij elke aanroep werden eerder nieuwe event-listeners
        // aangehangen zonder de oude te verwijderen → memory leak +
        // dubbele draw-events. Door het canvas-element te clonen verdwijnen
        // alle bestaande listeners in één keer.
        const canvas = oldCanvas.cloneNode(true);
        oldCanvas.parentNode.replaceChild(canvas, oldCanvas);

        // BUG-fix: DPR was hardcoded 2 → wazig op moderne telefoons (DPR 3)
        // en oversampled op tablets (DPR 1). Gebruik de echte device pixel
        // ratio, gecapt op 3 voor geheugen.
        const dpr = Math.min(window.devicePixelRatio || 1, 3);

        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.strokeStyle = '#001E45';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.signatureCtx = ctx;
        this.signatureHasContent = false;

        // Touch events
        const getPos = (e) => {
            const r = canvas.getBoundingClientRect();
            const touch = e.touches ? e.touches[0] : e;
            return { x: touch.clientX - r.left, y: touch.clientY - r.top };
        };

        const self = this;
        const start = (e) => {
            e.preventDefault();
            self.signatureDrawing = true;
            const p = getPos(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
        };
        const move = (e) => {
            if (!self.signatureDrawing) return;
            e.preventDefault();
            const p = getPos(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            self.signatureHasContent = true;
        };
        const end = () => { self.signatureDrawing = false; };

        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);
        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', end);
        canvas.addEventListener('mouseleave', end);
    },

    /** v170: Vul het email-veld in met de facturatie-email van de klant.
     *  Cascade: invoiceEmail / billingEmail → extraFields.Facturatie / Facturatie email
     *           → email. User kan na het invullen nog manueel aanpassen. */
    async fillKlantEmail() {
        const inputEl = document.getElementById('wbSignatureEmail');
        const btnEl = document.getElementById('btnFillKlantEmail');
        if (!inputEl) return;

        const clientId = this.currentWO && this.currentWO.clientId;
        if (!clientId) {
            this.toast('Geen klant gekoppeld aan deze werkbon');
            return;
        }

        // Loading state
        const origBtn = btnEl ? btnEl.textContent : '';
        if (btnEl) { btnEl.textContent = ''; btnEl.disabled = true; }

        try {
            const res = await RobawsAPI.get(`clients/${clientId}`);
            if (res.code !== 200 || !res.data) {
                this.toast('Klant niet gevonden');
                return;
            }
            const c = res.data;

            // Cascade: zoek dedicated billing-email eerst, dan algemene email.
            // Robaws kan billing-email in verschillende velden zetten — we
            // proberen alle bekende paden.
            const candidates = [
                c.invoiceEmail,
                c.billingEmail,
                c.billing && c.billing.email,
                c.invoiceContact && c.invoiceContact.email,
                c.extraFields && c.extraFields['Facturatie email']
                    && c.extraFields['Facturatie email'].stringValue,
                c.extraFields && c.extraFields['facturatieEmail']
                    && c.extraFields['facturatieEmail'].stringValue,
                c.extraFields && c.extraFields['Facturatie e-mail']
                    && c.extraFields['Facturatie e-mail'].stringValue,
                c.email,                          // fallback laatste optie
            ];

            const found = candidates.find(v => {
                if (!v || typeof v !== 'string') return false;
                const t = v.trim();
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
            });

            if (!found) {
                this.toast('Geen email gevonden bij deze klant');
                return;
            }

            inputEl.value = found.trim();
            this.toast('Email ingevuld: ' + inputEl.value);
        } catch (e) {
            console.warn('[fillKlantEmail] fout:', e && e.message);
            this.toast('Kon email niet ophalen');
        } finally {
            if (btnEl) { btnEl.textContent = origBtn || ''; btnEl.disabled = false; }
        }
    },

    clearSignature() {
        const canvas = document.getElementById('signatureCanvas');
        if (!canvas || !this.signatureCtx) return;
        this.signatureCtx.clearRect(0, 0, canvas.width, canvas.height);
        this.signatureHasContent = false;
    },

    getSignatureData() {
        const canvas = document.getElementById('signatureCanvas');
        if (!canvas || !this.signatureHasContent) return null;
        return canvas.toDataURL('image/png');
    },

    // ========================================
    // BETAALMETHODE SELECTIE
    // ========================================
    _selectedPaymentMethod: null,

    selectPaymentMethod(method) {
        this._selectedPaymentMethod = method;
        // Visueel: markeer geselecteerde knop
        document.querySelectorAll('.payment-method-btn').forEach(b => {
            if (b.dataset.method === method) {
                b.style.background = 'var(--qe-purple)';
                b.style.color = '#fff';
                b.style.borderColor = 'var(--qe-purple)';
            } else {
                b.style.background = '';
                b.style.color = '';
                b.style.borderColor = '';
            }
        });
        // E-mail veld verbergen (overschrijving toont nu QR scherm i.p.v. email)
        const emailSection = document.getElementById('wbOverschrijvingEmail');
        if (emailSection) {
            emailSection.style.display = 'none';
        }
        // Activeer de verstuurknop
        const btn = document.getElementById('btnSubmitWerkbon');
        if (btn) btn.disabled = false;
    },

    // v197: "Geen factuur maken" — verbergt de betaalmethode-keuze en activeert
    // de verstuurknop (geen betaling nodig zonder factuur).
    toggleNoInvoice(checked) {
        const pm = document.getElementById('wbPaymentMethodSection');
        if (pm) pm.style.display = checked ? 'none' : '';
        const btn = document.getElementById('btnSubmitWerkbon');
        if (btn) btn.disabled = checked ? false : !this._selectedPaymentMethod;
    },

    // ========================================
    // UNIFIED SUBMIT FLOW
    // ========================================
    startSubmitFlow() {
        if (!this.currentWO) return;

        if (this.isMonteur()) {
            return this.executeMonteurSubmitFlow();
        }

        // Valideer betaalmethode (niet nodig als "Geen factuur maken" aanstaat)
        const _noInvoice = document.getElementById('wbNoInvoice') && document.getElementById('wbNoInvoice').checked;
        if (!_noInvoice && !this._selectedPaymentMethod) {
            this.toast('Kies eerst een betaalmethode');
            return;
        }

        // Overschrijving ter plaatse: geen extra validatie nodig (QR scherm wordt getoond)

        const section = document.getElementById('wbSignatureSection');
        const btn = document.getElementById('btnSubmitWerkbon');

        if (section.style.display === 'none') {
            section.style.display = 'block';
            section.scrollIntoView({ behavior: 'smooth' });
            btn.innerHTML = 'Ondertekenen & Versturen';
            btn.onclick = () => this.executeSubmitFlow();
            setTimeout(() => this.initSignatureCanvas(), 100);
        } else {
            this.executeSubmitFlow();
        }
    },

    _buildWerkbonPayload(data) {
        return {
            salesOrderId: this.currentWO.salesOrderId || null,
            planningItemId: this.currentWO.id,
            clientId: this.currentWO.clientId,
            installationIds: this.currentWO.installationIds || [],
            employeeId: this.currentUser.robawsEmployeeId,
            userId: this.currentUser.robawsUserId,
            clientName: (this.currentWO.client && this.currentWO.client.name) || '',
            summary: this.currentWO.summary || 'Werkbon via QE App',
            date: this._localDateStr(this.currentDate),
            // Regie-vinkje overnemen van de sales order (niet hardcoded true)
            timeAndMaterial: this.currentWO.timeAndMaterial ?? false,
            // v93: filter eenmalige artikels uit — die hebben geen Robaws articleId.
            // Felicity krijgt taakje om die zelf toe te voegen.
            materials: data.materials.filter(m => !m.isCustom).map(m => ({
                articleId: m.id,
                name: m.name,
                quantity: m.quantity,
                unitPrice: m.salePrice ?? m.unitPrice ?? 0,
            })),
            hours: this._roundHoursForSubmit(data.hours),
            notes: data.notes,
            uurcode: this.selectedUurcode,
            verplaatsingCode: this.verplaatsingCode,
            paymentMethod: this._selectedPaymentMethod,
            onderhoud: data.onderhoud || false,
        };
    },

    /**
     * v112: Foto's uploaden naar een sales-invoice in Robaws.
     * Werkt rechtstreeks vanuit JS (geen server-side proxy) want de
     * Robaws-credentials zitten reeds in RobawsAPI. Wordt vanuit
     * executeSubmitFlow aangeroepen ná invoice-creation, zodat dezelfde
     * foto's die op de werkbon staan ook bij de factuur-bestanden te
     * vinden zijn.
     */
    async _uploadPhotosToInvoice(photos, invoiceId) {
        if (!photos || !photos.length || !invoiceId) return;
        const auth = btoa(RobawsAPI.API_KEY + ':' + RobawsAPI.API_SECRET);
        const BASE = RobawsAPI.BASE_URL || 'https://app.robaws.com/api/v2';
        for (let i = 0; i < photos.length; i++) {
            const p = photos[i];
            const name = (p && p.name) || ('foto_' + (i + 1) + '.jpg');
            try {
                let base64 = (p && p.data) || '';
                if (base64.includes(',')) base64 = base64.split(',')[1];
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
                let mime = 'image/jpeg';
                if (/\.png$/i.test(name)) mime = 'image/png';
                else if (/\.heic$/i.test(name)) mime = 'image/heic';
                else if (/\.webp$/i.test(name)) mime = 'image/webp';
                const blob = new Blob([bytes], { type: mime });
                const fd = new FormData();
                fd.append('file', blob, name);
                const res = await fetch(BASE + '/sales-invoices/' + invoiceId + '/documents', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Basic ' + auth,
                        'X-Tenant': RobawsAPI.TENANT,
                    },
                    body: fd,
                });
                console.log('[Photo→Invoice] ' + name + ' → HTTP ' + res.status);
            } catch (e) {
                console.warn('[Photo→Invoice] upload mislukt voor ' + name + ':', e && e.message);
            }
        }
    },

    async _uploadPhotosAndSignature(data, workOrderId, signatureName, signatureData) {
        // Foto's
        if (data.photos.length > 0 && workOrderId) {
            try {
                await fetch('api/upload-photo.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        workOrderId,
                        photos: data.photos.map(p => ({ data: p.data, name: p.name })),
                    }),
                });
            } catch (e) { /* foto's niet kritisch */ }
        }
        // Handtekening
        if (signatureData) {
            this.toast('Handtekening uploaden...');
            try {
                await fetch('api/sign-werkbon.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workOrderId, signatureName, signatureData }),
                });
            } catch (e) {
                console.error('Handtekening upload mislukt:', e);
            }
        }
    },

    _markWOSubmitted(data) {
        const woId = this.currentWO.id;
        if (!this.submittedHours[woId]) this.submittedHours[woId] = [];
        this.submittedHours[woId].push(...data.hours);
        this.woData[woId] = { hours: [], materials: [], photos: [], notes: '' };
        if (!this.submittedWOs.includes(String(woId))) this.submittedWOs.push(String(woId));
        this._saveSubmittedWOs();
    },

    async executeSubmitFlow() {
        if (!this.currentWO) return;

        // === GUARD: voorkom dubbele factuur/werkbon ===
        const woId = String(this.currentWO.id);
        if (this.submittedWOs.includes(woId)) {
            this.toast('Deze werkbon is al verstuurd');
            return;
        }
        if (this._submitInProgress) {
            this.toast('Bezig met versturen...');
            return;
        }
        this._submitInProgress = true;

        const data = this.woData[this.currentWO.id];
        const hasWorkHours = data.hours.some(h => h.type === 'klant');
        if (hasWorkHours && !this.selectedUurcode) {
            this.toast('Kies eerst een uurcode in het Uren tabblad');
            return;
        }

        const signatureName = document.getElementById('wbSignatureName')?.value?.trim() || '';
        const signatureData = this.getSignatureData();

        if (!signatureData) {
            this.toast('Laat de klant eerst tekenen');
            return;
        }
        if (!signatureName) {
            this.toast('Vul de naam van de ondertekenaar in');
            return;
        }

        const paymentMethod = this._selectedPaymentMethod;
        const btn = document.getElementById('btnSubmitWerkbon');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:0 auto"></div> Verwerken...';

        try {
            // === STAP 0: Garandeer dat we een Robaws userId hebben.
            // Login probeert dit al, maar bij /users-fout of bij oude sessies
            // kan robawsUserId nog null zijn. Hier doen we een laatste lookup
            // zodat de werkbon NOOIT zonder verantwoordelijke arriveert.
            try {
                if (this.currentUser && !this.currentUser.robawsUserId) {
                    await RobawsAPI.ensureUserId();
                }
            } catch(e) { /* val terug op server-side fallback in robaws-api.js */ }

            // === STAP 1: Werkbon versturen (met betaalmethode) ===
            this.toast('Werkbon versturen...');
            const payload = this._buildWerkbonPayload(data);
            const werkbonRes = await fetch('api/werkbon.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const werkbonResult = await werkbonRes.json();

            if (!werkbonResult.success) {
                throw new Error(werkbonResult.error || 'Werkbon versturen mislukt');
            }

            const workOrderId = werkbonResult.workOrderId;

            // v93/v94: Eenmalige artikels → toevoegen als line-item op WERKBON (zonder articleId)
            // + taak voor Felicity (userId 6) zodat zij het echte artikel in Robaws aanmaakt.
            const customArticles = (data.materials || []).filter(m => m.isCustom);
            if (customArticles.length > 0 && workOrderId) {
                for (const m of customArticles) {
                    try {
                        const li = {
                            type: 'LINE',
                            description: m.name || 'Eenmalig artikel',
                            quantity: parseFloat(m.quantity || 1),
                            price: parseFloat(m.salePrice || m.unitPrice || 0),
                        };
                        const r = await RobawsAPI.post(`work-orders/${workOrderId}/line-items`, li);
                        if (r.code !== 200 && r.code !== 201) {
                            console.warn('[App] custom article werkbon line-item POST faalde:', r.code, r.data);
                        } else {
                            console.log('[App] custom article toegevoegd aan werkbon:', m.name);
                        }
                    } catch (e) {
                        console.warn('[App] custom article werkbon line-item exception:', e && e.message);
                    }
                }
                // Felicity-taak
                try {
                    const lines = customArticles.map(m => {
                        const price = parseFloat(m.salePrice || m.unitPrice || 0).toFixed(2);
                        const qty = parseFloat(m.quantity || 1);
                        return `• ${m.name} — ${qty}× à €${price}`;
                    });
                    const desc = 'Eenmalige artikels op deze werkbon — gelieve het echte artikel ' +
                        'in Robaws aan te maken en de line-item op werkbon + factuur te corrigeren.' +
                        '\n\n' + lines.join('\n');
                    await RobawsAPI.createTaskForWorkOrder(workOrderId, {
                        title: '✏️ Eenmalig artikel toevoegen aan Robaws',
                        description: desc,
                        assignedUserId: 6, // Felicity
                    });
                    console.log('[App] Felicity-taak aangemaakt voor', customArticles.length, 'eenmalige artikels');
                } catch (e) {
                    console.warn('[App] Felicity-taak aanmaken mislukt (niet kritiek):', e && e.message);
                }
            }

            // === STAP 2: Foto's + handtekening ===
            await this._uploadPhotosAndSignature(data, workOrderId, signatureName, signatureData);

            // v197: "Geen factuur maken" → werkbon is verstuurd, factuur-stap overslaan
            // (garantie / terugkomwerk door gebreken).
            if (document.getElementById('wbNoInvoice') && document.getElementById('wbNoInvoice').checked) {
                this._markWOSubmitted(data);
                this._submitInProgress = false;
                this.toast('Werkbon verstuurd — geen factuur aangemaakt');
                this.navigate('screenPlanning', false);
                this.screenHistory = [];
                this.loadPlanning();
                return;
            }

            // === STAP 3: Factuur aanmaken (met betaalmethode + notities als tekstlijn) ===
            this.toast('Factuur aanmaken...');
            const invoicePayload = {
                workOrderId,
                vatTariffId: this.currentWO.vatTariffId || '4',
                clientId: this.currentWO.clientId || this.currentWO.endClientId,
                companyId: this.currentWO.companyId,
                salesOrderId: this.currentWO.salesOrderId || null,
                paymentMethod: paymentMethod,
                notes: data.notes || '',
                // Verantwoordelijke + installatie-adres voor factuur
                userId: this.currentUser.robawsUserId,
                installationIds: this.currentWO.installationIds || [],
                // Materialen direct meesturen (WO material-entries ≠ line-items in Robaws)
                // v93: filter custom-artikels uit — Felicity-taak handelt die af.
                materials: data.materials.filter(m => !m.isCustom).map(m => ({
                    articleId: m.id,
                    name: m.name,
                    quantity: m.quantity || 1,
                    unitPrice: m.salePrice ?? m.unitPrice ?? 0,
                })),
                // Uren meesturen voor facturatie — alleen 'klant' uren factureren!
                // Bij onderhoud: werkuren worden NIET gefactureerd (verkoopprijs = 0)
                // Verplaatsingsuren en pauze worden NOOIT gefactureerd
                hours: data.onderhoud ? [] : data.hours.filter(h => h.duration > 0 && h.type === 'klant').map(h => ({
                    type: 'klant',
                    duration: h.duration,
                    articleId: h.articleId || (this.selectedUurcode ? this.selectedUurcode.id : null),
                    salePrice: h.salePrice || (this.selectedUurcode ? this.selectedUurcode.salePrice : 0),
                })),
                onderhoud: data.onderhoud || false,
            };

            // Overschrijving ter plaatse: geen email meer nodig (QR scherm wordt getoond)

            const invoiceRes = await fetch('api/create-invoice.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(invoicePayload),
            });
            const invoiceResult = await invoiceRes.json();

            if (!invoiceResult.success) {
                this.toast('Werkbon verstuurd, maar factuur aanmaken mislukt');
                this._markWOSubmitted(data);
                this.navigate('screenPlanning', false);
                this.screenHistory = [];
                this.loadPlanning();
                return;
            }

            // Waarschuw als er line-item fouten waren
            if (invoiceResult.errors && invoiceResult.errors.length > 0) {
                console.warn('[Factuur] Errors bij toevoegen lijnen:', invoiceResult.errors);
            }

            // v94: Eenmalige artikels ook toevoegen als line-item op de FACTUUR
            // (zonder articleId — Felicity corrigeert later naar het echte artikel).
            const customArticlesForInvoice = (data.materials || []).filter(m => m.isCustom);
            const invoiceId = (invoiceResult && invoiceResult.invoice && invoiceResult.invoice.id) || null;

            // v170: Transactiekost 1.5% voor card payments toevoegen aan factuur.
            // Math: gross = net / (1 - 0.015), fee = gross - net. Zo ontvangt QE
            // netto exact het originele factuurbedrag nadat Mollie z'n 1.5%
            // afhoudt. Robaws verwacht `price` excl. BTW → we delen door
            // (1 + btw-rate). VatTariffId-map: 1=21%, 2=12%, 3=0%, 4=6%.
            let transactionFeeAdded = false;
            const CARD_PAYMENT_METHODS = ['Mollie Tap', 'Viva wallet'];
            if (invoiceId && CARD_PAYMENT_METHODS.includes(paymentMethod)) {
                const originalTotal = parseFloat(invoiceResult.invoice.totalInclVat || 0);
                if (originalTotal > 0) {
                    const FEE_RATE = 0.015;
                    const grossTotal = originalTotal / (1 - FEE_RATE);
                    const feeInclVat = grossTotal - originalTotal;

                    const vatTariffId = String(this.currentWO.vatTariffId || '4');
                    const vatRateMap = { '1': 0.21, '2': 0.00, '3': 0.00, '4': 0.06 };  // v182: id 2 = Verlegd (0%)
                    const vatRate = vatRateMap[vatTariffId] || 0;
                    const feeExclVat = feeInclVat / (1 + vatRate);
                    const roundedFeeExclVat = Math.round(feeExclVat * 100) / 100;

                    try {
                        const li = {
                            type: 'LINE',
                            description: `Transactiekosten ${paymentMethod} (1,5%)`,
                            quantity: 1,
                            price: roundedFeeExclVat,
                            vatTariffId,
                        };
                        if (this.currentWO.salesOrderId) li.orderId = String(this.currentWO.salesOrderId);
                        const r = await RobawsAPI.post(`sales-invoices/${invoiceId}/line-items`, li);
                        if (r.code === 200 || r.code === 201) {
                            console.log('[transactiekosten] +€' + feeInclVat.toFixed(4) +
                                ' (incl BTW) = €' + roundedFeeExclVat.toFixed(2) +
                                ' excl × ' + (vatRate * 100).toFixed(0) + '% toegevoegd aan factuur',
                                invoiceId, '(' + paymentMethod + ')');
                            transactionFeeAdded = true;
                        } else {
                            console.warn('[transactiekosten] POST faalde:', r.code, r.data);
                        }
                    } catch (e) {
                        console.warn('[transactiekosten] exception:', e && e.message);
                    }
                }
            }

            if (customArticlesForInvoice.length > 0 && invoiceId) {
                const vatTariffId = this.currentWO.vatTariffId || '4';
                for (const m of customArticlesForInvoice) {
                    try {
                        const li = {
                            type: 'LINE',
                            description: m.name || 'Eenmalig artikel',
                            quantity: parseFloat(m.quantity || 1),
                            price: parseFloat(m.salePrice || m.unitPrice || 0),
                            vatTariffId: String(vatTariffId),
                        };
                        if (this.currentWO.salesOrderId) li.orderId = String(this.currentWO.salesOrderId);
                        const r = await RobawsAPI.post(`sales-invoices/${invoiceId}/line-items`, li);
                        if (r.code !== 200 && r.code !== 201) {
                            console.warn('[App] custom article factuur line-item POST faalde:', r.code, r.data);
                        } else {
                            console.log('[App] custom article toegevoegd aan factuur:', m.name);
                        }
                    } catch (e) {
                        console.warn('[App] custom article factuur line-item exception:', e && e.message);
                    }
                }

            }

            // v109/v170: factuur ververst na elk type bijkomende line-items.
            // Triggers wanneer: custom articles toegevoegd, OF transactiekost toegevoegd.
            // De factuur in Robaws is altijd correct; deze refetch is om
            // het lokale invoiceResult-object in sync te brengen voor het betaalscherm.
            if (invoiceId && (customArticlesForInvoice.length > 0 || transactionFeeAdded)) {
                try {
                    const refreshed = await RobawsAPI.get(`sales-invoices/${invoiceId}`);
                    if (refreshed.code === 200 && refreshed.data) {
                        const fresh = refreshed.data;
                        const merged = { ...invoiceResult.invoice };
                        for (const k of ['totalInclVat', 'totalExclVat', 'totalVat',
                                         'amount', 'amountInclVat', 'amountExclVat',
                                         'totalCost', 'totalPrice', 'lineItems']) {
                            if (fresh[k] !== undefined) merged[k] = fresh[k];
                        }
                        invoiceResult.invoice = merged;
                        const reason = transactionFeeAdded
                            ? (customArticlesForInvoice.length > 0 ? 'eenmalige artikels + transactiekost' : 'transactiekost')
                            : 'eenmalige artikels';
                        console.log(`[App] Factuur ververst na ${reason} — nieuw totaal:`, merged.totalInclVat);
                    } else {
                        console.warn('[App] Refetch factuur gaf code', refreshed.code);
                    }
                } catch (e) {
                    console.warn('[App] Refetch factuur faalde:', e && e.message);
                }
            }

            // v112: dezelfde foto's die op de werkbon staan ook uploaden naar
            // de factuur-bestanden. Loopt parallel met de werkbon-flow zodat
            // bv. de boekhouding ze direct bij de factuur ziet hangen.
            if (invoiceId && data.photos && data.photos.length > 0) {
                try {
                    await this._uploadPhotosToInvoice(data.photos, invoiceId);
                } catch (e) {
                    console.warn('[App] Foto-upload naar factuur faalde (niet kritiek):', e && e.message);
                }
            }

            this._markWOSubmitted(data);

            // v169: Werkbon PDF mailen naar klant indien email-veld ingevuld
            // bij de handtekening. Fire-and-forget — blokkeert de betaalflow niet.
            // Robaws-template: zie RobawsAPI.EMAIL_TEMPLATE_WERKBON (default "Werkbon naar klant")
            const klantEmail = document.getElementById('wbSignatureEmail')?.value?.trim() || '';
            if (klantEmail && workOrderId) {
                RobawsAPI.sendWorkOrderByEmail(workOrderId, klantEmail).then(r => {
                    if (r.ok) {
                        console.log('[werkbon-email] verstuurd naar', klantEmail, '(id ' + r.emailId + ')');
                        this.toast('Werkbon gemaild naar ' + klantEmail);
                    } else {
                        console.warn('[werkbon-email] faalde:', r.error);
                        this.toast('Mail niet verstuurd: ' + (r.error || 'onbekend'));
                    }
                }).catch(e => {
                    console.warn('[werkbon-email] exception:', e && e.message);
                });
            }

            // v88: Sla "laatste betaling" context op zodat Olivier op de Uitgevoerd-tab
            // de methode kan switchen als de Viva-terminal faalt.
            try {
                const ctx = {
                    workOrderId: workOrderId,
                    salesOrderId: this.currentWO.salesOrderId || null,
                    invoiceId: (invoiceResult && invoiceResult.invoice && invoiceResult.invoice.id) || null,
                    invoiceLogicId: (invoiceResult && invoiceResult.invoice && invoiceResult.invoice.logicId) || null,
                    paymentMethod: paymentMethod,
                    invoiceResult: invoiceResult,  // bewaard voor reopen Viva/Overschrijving betaalscherm
                    timestamp: Date.now(),
                };
                localStorage.setItem('qe_last_payment_context', JSON.stringify(ctx));
            } catch(e) { /* localStorage quota — niet kritiek */ }

            // === STAP 4: Betaalmethode-specifieke afhandeling ===
            if (paymentMethod === 'Mollie Tap') {
                // v139: direct Mollie payment aanmaken + Tap app launchen
                this.payWithMollieTap(invoiceResult).catch(e => {
                    console.warn('[Mollie] flow faalde:', e);
                    this.toast('Mollie betaling kon niet starten: ' + (e && e.message || e));
                    this.showPaymentScreen(invoiceResult);  // fallback naar manueel
                });
            } else if (paymentMethod === 'Viva wallet') {
                // Viva Wallet → toon betaalscherm met terminal/QR
                this.showPaymentScreen(invoiceResult);
            } else if (paymentMethod === 'Overschrijving' || paymentMethod === 'Overschrijving ter plaatse') {
                // Overschrijving ter plaatse → toon betaalscherm met QR code
                // (legacy "Overschrijving ter plaatse" string ook ondersteund voor backward compat)
                this.showOverschrijvingScreen(invoiceResult);
            } else if (paymentMethod === 'Cash') {
                // Contant → afrekenscherm met totaal, ontvangen bedrag en wisselgeld
                this.showCashScreen(invoiceResult);
            } else {
                // v85: Via factuur → factuur is aangemaakt, werkbon + order
                // staan nu op 'gefactureerd' (zie robaws-api stap 6). Geen extra UI.
                this.toast(`Werkbon verstuurd — betaling: ${paymentMethod} `);
                this.navigate('screenPlanning', false);
                this.screenHistory = [];
                this.loadPlanning();
            }

        } catch (err) {
            if (!navigator.onLine) {
                await this.queueWerkbonOffline(data);
            } else {
                this.toast('Fout: ' + err.message);
            }
        } finally {
            this._submitInProgress = false;
            btn.disabled = false;
            btn.innerHTML = 'Ondertekenen & Versturen';
            btn.onclick = () => this.startSubmitFlow();
        }
    },

    finishSubmit(data) {
        this._markWOSubmitted(data);
        this.navigate('screenPlanning', false);
        this.screenHistory = [];
        this.loadPlanning();
    },

    // ========================================
    // MONTEUR FLOW — enkel uren + materiaal, geen handtekening/factuur/betaling
    // ========================================
    async executeMonteurSubmitFlow() {
        if (!this.currentWO) return;

        // === GUARD: voorkom dubbele werkbon ===
        const woId = String(this.currentWO.id);
        if (this.submittedWOs.includes(woId)) {
            this.toast('Deze werkbon is al verstuurd');
            return;
        }
        if (this._submitInProgress) {
            this.toast('Bezig met versturen...');
            return;
        }
        this._submitInProgress = true;

        const data = this.woData[this.currentWO.id];
        const hasWorkHours = data.hours.some(h => h.type === 'klant');
        if (hasWorkHours && !this.selectedUurcode) {
            this.toast('Kies eerst een uurcode in het Uren tabblad');
            return;
        }

        const btn = document.getElementById('btnSubmitWerkbon');
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:0 auto"></div> Versturen...';

        try {
            // Garandeer dat we een Robaws userId hebben (zie executeSubmitFlow)
            try {
                if (this.currentUser && !this.currentUser.robawsUserId) {
                    await RobawsAPI.ensureUserId();
                }
            } catch(e) { /* server-side fallback */ }

            // Werkbon versturen — zelfde endpoint, geen handtekening/factuur/betaling
            this.toast('Werkbon versturen...');
            const werkbonRes = await fetch('api/werkbon.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    salesOrderId: this.currentWO.salesOrderId || null,
                    planningItemId: this.currentWO.id,
                    clientId: this.currentWO.clientId,
                    installationIds: this.currentWO.installationIds || [],
                    employeeId: this.currentUser.robawsEmployeeId,
                    userId: this.currentUser.robawsUserId,
                    clientName: (this.currentWO.client && this.currentWO.client.name) || '',
                    summary: this.currentWO.summary || 'Werkbon via QE App',
                    date: this._localDateStr(this.currentDate),
                    timeAndMaterial: this.currentWO.timeAndMaterial ?? false,
                    materials: data.materials.map(m => ({
                        articleId: m.id,
                        name: m.name,
                        quantity: m.quantity,
                        unitPrice: m.salePrice ?? m.unitPrice ?? 0,
                    })),
                    hours: this._roundHoursForSubmit(data.hours),
                    notes: data.notes || '',
                    uurcode: this.selectedUurcode,
                    verplaatsingCode: this.verplaatsingCode,
                    onderhoud: data.onderhoud || false,
                }),
            });
            const werkbonResult = await werkbonRes.json();

            if (!werkbonResult.success) {
                throw new Error(werkbonResult.error || 'Werkbon versturen mislukt');
            }

            // Foto's uploaden als er zijn
            const workOrderId = werkbonResult.workOrderId;
            if (data.photos.length > 0 && workOrderId) {
                try {
                    await fetch('api/upload-photo.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            workOrderId,
                            photos: data.photos.map(p => ({ data: p.data, name: p.name })),
                        }),
                    });
                } catch (e) { /* foto's niet kritisch */ }
            }

            this.toast('Werkbon verstuurd ');

            // Data resetten en terug naar planning
            const woId = this.currentWO.id;
            if (!this.submittedHours[woId]) this.submittedHours[woId] = [];
            this.submittedHours[woId].push(...data.hours);
            this.woData[woId] = { hours: [], materials: [], photos: [], notes: '' };
            if (!this.submittedWOs.includes(String(woId))) this.submittedWOs.push(String(woId));
            this._saveSubmittedWOs();

            this.navigate('screenPlanning', false);
            this.screenHistory = [];
            this.loadPlanning();
        } catch (err) {
            if (!navigator.onLine) {
                await this.queueWerkbonOffline(data);
            } else {
                this.toast('Fout: ' + err.message);
            }
        } finally {
            this._submitInProgress = false;
            btn.disabled = false;
            btn.innerHTML = 'Uren & materiaal versturen';
            btn.onclick = () => this.executeMonteurSubmitFlow();
        }
    },

    // ========================================
    // TERMINAL CONFIGURATIE
    // ========================================
    // Alle beschikbare Viva Wallet terminals
    vivaTerminals: [
        { id: '16704613', type: 'SoftPos', device: 'SoftPos', desc: 'Nieuwste (mrt 2026)' },
        { id: '16666866', type: 'SoftPos', device: 'SoftPos', desc: 'Nov 2025' },
        { id: '16592089', type: 'ApplePos', device: 'ApplePos', desc: 'iPhone (jun 2025)' },
        { id: '16581459', type: 'SoftPos', device: 'SoftPos', desc: 'Mei 2025' },
        { id: '16553680', type: 'SoftPos', device: 'SoftPos', desc: 'Mrt 2025' },
        { id: '16494739', type: 'SoftPos', device: 'SoftPos', desc: 'Sep 2024' },
        { id: '16421051', type: 'SoftPos', device: 'SoftPos', desc: 'Apr 2024' },
        { id: '16348027', type: 'SoftPos', device: 'Samsung SM-S918B', desc: 'Galaxy S24 Ultra' },
        { id: '16336588', type: 'SoftPos', device: 'Samsung SM-A236B', desc: 'Galaxy A23' },
        { id: '16303015', type: 'SoftPos', device: 'Samsung SM-F946B', desc: 'Galaxy Z Fold5' },
        { id: '16266227', type: 'SoftPos', device: 'Samsung SM-A326B', desc: 'Galaxy A32' },
        { id: '16235654', type: 'SoftPos', device: 'Samsung SM-A536B', desc: 'Galaxy A53 (1)' },
        { id: '16235347', type: 'SoftPos', device: 'Samsung SM-A536B', desc: 'Galaxy A53 (2)' },
        { id: '16235346', type: 'SoftPos', device: 'Samsung SM-A127F', desc: 'Galaxy A12' },
        { id: '16235322', type: 'SoftPos', device: 'Samsung SM-A528B', desc: 'Galaxy A52s' },
        { id: '16234512', type: 'SoftPos', device: 'Samsung SM-A536B', desc: 'Galaxy A53 (3)' },
        { id: '16234508', type: 'SoftPos', device: 'Samsung SM-F711B', desc: 'Galaxy Z Flip3' },
        { id: '16226858', type: 'SoftPos', device: 'Samsung SM-F916B', desc: 'Galaxy Z Fold2' },
        { id: '16111122', type: 'Datecs BlueLite', device: 'Datecs BlueLite', desc: 'Pinautomaat (1)' },
        { id: '16058633', type: 'Datecs BlueLite', device: 'Datecs BlueLite', desc: 'Pinautomaat (2)' },
    ],

    getSelectedTerminal() {
        try {
            const tid = localStorage.getItem('qe_viva_terminal_id');
            if (tid) return this.vivaTerminals.find(t => t.id === tid) || null;
        } catch(e) {}
        return null;
    },

    setSelectedTerminal(terminalId) {
        try {
            localStorage.setItem('qe_viva_terminal_id', terminalId);
        } catch(e) {}
    },

    showTerminalPicker(callback) {
        const selected = this.getSelectedTerminal();
        const overlay = document.createElement('div');
        overlay.id = 'terminalPickerOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center';

        const grouped = {};
        this.vivaTerminals.forEach(t => {
            const grp = t.type;
            if (!grouped[grp]) grouped[grp] = [];
            grouped[grp].push(t);
        });

        let listHtml = '';
        for (const [type, terminals] of Object.entries(grouped)) {
            const icon = this.icon('phone', { size: 18 });
            listHtml += `<div style="font-size:12px;font-weight:600;color:var(--qe-grey);padding:8px 0 4px;text-transform:uppercase;letter-spacing:0.5px">${icon} ${type}</div>`;
            terminals.forEach(t => {
                const isSelected = selected && selected.id === t.id;
                listHtml += `
                    <div onclick="app.selectTerminal('${t.id}', this)"
                        class="terminal-option${isSelected ? ' selected' : ''}"
                        style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;cursor:pointer;
                        border:2px solid ${isSelected ? 'var(--qe-purple)' : '#eee'};margin-bottom:6px;
                        background:${isSelected ? '#f3e8ff' : '#fff'};transition:all 0.15s">
                        <div style="width:40px;height:40px;border-radius:10px;background:${isSelected ? 'var(--qe-purple)' : '#f0f0f0'};
                            display:flex;align-items:center;justify-content:center;font-size:18px;color:${isSelected ? '#fff' : '#666'};flex-shrink:0">
                            ${isSelected ? '✓' : icon}
                        </div>
                        <div style="flex:1;min-width:0">
                            <div style="font-size:14px;font-weight:600;color:var(--qe-darkblue)">${this.escapeHtml(t.desc)}</div>
                            <div style="font-size:12px;color:var(--qe-grey)">${this.escapeHtml(t.device)} — TID ${t.id}</div>
                        </div>
                    </div>`;
            });
        }

        overlay.innerHTML = `
            <div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:80vh;overflow:hidden;
                display:flex;flex-direction:column;animation:slideUp 0.25s ease-out">
                <div style="padding:20px 20px 12px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between">
                    <div>
                        <h3 style="margin:0;font-size:18px;color:var(--qe-darkblue)">Selecteer je terminal</h3>
                        <div style="font-size:13px;color:var(--qe-grey);margin-top:2px">Kies het toestel waarmee je betaalt</div>
                    </div>
                    <button onclick="document.getElementById('terminalPickerOverlay').remove()"
                        style="width:32px;height:32px;border-radius:50%;border:none;background:#f0f0f0;font-size:18px;cursor:pointer;color:#666">✕</button>
                </div>
                <div id="terminalList" style="padding:12px 16px;overflow-y:auto;flex:1">
                    ${listHtml}
                </div>
                <div style="padding:12px 16px 24px;border-top:1px solid #eee">
                    <button id="btnConfirmTerminal" onclick="app.confirmTerminalSelection()"
                        style="width:100%;padding:14px;border:none;border-radius:12px;
                        background:linear-gradient(135deg,var(--qe-purple),var(--qe-dark));
                        color:#fff;font-size:16px;font-weight:600;cursor:pointer;
                        opacity:${selected ? '1' : '0.5'};pointer-events:${selected ? 'auto' : 'none'}">
                        Bevestigen
                    </button>
                </div>
            </div>
        `;

        this._terminalPickerCallback = callback;
        this._selectedTerminalId = selected ? selected.id : null;
        document.body.appendChild(overlay);

        // Sluit bij klik buiten modal
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    selectTerminal(terminalId, el) {
        this._selectedTerminalId = terminalId;

        // Update UI
        document.querySelectorAll('.terminal-option').forEach(opt => {
            opt.style.border = '2px solid #eee';
            opt.style.background = '#fff';
            const icon = opt.querySelector('div > div:first-child');
            if (icon) { icon.style.background = '#f0f0f0'; icon.style.color = '#666'; }
        });
        el.style.border = '2px solid var(--qe-purple)';
        el.style.background = '#f3e8ff';
        const selIcon = el.querySelector('div > div:first-child');
        if (selIcon) { selIcon.style.background = 'var(--qe-purple)'; selIcon.style.color = '#fff'; selIcon.textContent = ''; }

        // Enable confirm knop
        const btn = document.getElementById('btnConfirmTerminal');
        if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
    },

    confirmTerminalSelection() {
        if (!this._selectedTerminalId) return;
        this.setSelectedTerminal(this._selectedTerminalId);
        const terminal = this.vivaTerminals.find(t => t.id === this._selectedTerminalId);
        const overlay = document.getElementById('terminalPickerOverlay');
        if (overlay) overlay.remove();

        this.toast(`Terminal ingesteld: ${terminal ? terminal.desc : this._selectedTerminalId}`);

        if (this._terminalPickerCallback) {
            this._terminalPickerCallback(this._selectedTerminalId);
            this._terminalPickerCallback = null;
        }
    },

    // ========================================
    // BETALING SCHERM
    // ========================================
    // ========================================
    // OVERSCHRIJVING BETAALSCHERM
    // ========================================
    showOverschrijvingScreen(invoiceResult) {
        // Sla factuurdata op zodat het scherm later hertoegankelijk is
        try { localStorage.setItem('qe_last_overschrijving', JSON.stringify(invoiceResult)); } catch(e){}
        this.navigate('screenOverschrijving', false);
        this.screenHistory = [];
        const container = document.getElementById('overschrijvingContent');
        if (window.EPCQR) {
            EPCQR.showPaymentScreen(invoiceResult, container);
        } else {
            // Fallback als EPCQR niet geladen is
            const inv = invoiceResult.invoice || {};
            const pay = invoiceResult.payment || {};
            container.innerHTML = `
                <div style="text-align:center;padding:20px">
                    <h2>Overschrijving</h2>
                    <p style="font-size:24px;font-weight:700">€ ${parseFloat(pay.amount || inv.totalInclVat || 0).toFixed(2)}</p>
                    <p>Factuur: ${inv.logicId || ''}</p>
                    <p>OGM: ${pay.formattedOgm || inv.formattedOgm || ''}</p>
                    <p>IBAN: ${pay.iban || ''}</p>
                    <button onclick="app.closePaymentScreen()" class="btn btn-primary btn-full" style="margin-top:20px;padding:14px">
                        ✓ Klaar — Terug naar planning
                    </button>
                </div>`;
        }
    },

    closePaymentScreen() {
        this.navigate('screenPlanning', false);
        this.screenHistory = [];
        this.loadPlanning();
    },

    /** Heropen het laatste betaalscherm (overschrijving of Viva Wallet) */
    reopenLastPaymentScreen(type) {
        try {
            const key = type === 'viva' ? 'qe_last_payment' : 'qe_last_overschrijving';
            const stored = localStorage.getItem(key);
            if (!stored) {
                this.toast('Geen betaalgegevens gevonden');
                return;
            }
            const invoiceResult = JSON.parse(stored);
            if (type === 'viva') {
                this.showPaymentScreen(invoiceResult);
            } else {
                this.showOverschrijvingScreen(invoiceResult);
            }
        } catch (e) {
            this.toast('Kon betaalscherm niet openen');
        }
    },

    /**
     * v88: Open modal met de 4 betaalmethoden — gebruiker kan de methode van
     * de laatste betaling aanpassen (bv. Viva-terminal faalde, klant geeft cash).
     * Bij verandering: PUT updates Betaling-veld op werkbon + order + factuur,
     * en opent eventueel het nieuwe betaalscherm.
     */
    /**
     * v89-fix: betaalmethode-keuze NIET via overlay-modal maar via een NAVIGATE
     * naar een dedicated screen. De overlay-modal renderde alleen de header in
     * een aantal Android WebViews — vermoedelijk een interactie tussen de
     * scan-result-overlay en deze modal. Een full-screen via this.navigate
     * gebruikt het bestaande screen-systeem dat 100% betrouwbaar werkt.
     */
    openChangePaymentMethodModal() {
        let ctx;
        try {
            const raw = localStorage.getItem('qe_last_payment_context');
            if (!raw) { this.toast('Geen laatste betaling gevonden'); return; }
            ctx = JSON.parse(raw);
        } catch (e) {
            this.toast('Kon betaling niet laden');
            return;
        }

        const inv = (ctx.invoiceResult && ctx.invoiceResult.invoice) || {};
        const amount = parseFloat(inv.totalInclVat || 0).toFixed(2);
        const cur = ctx.paymentMethod || '';

        // Zoek of maak het screen op-the-fly als het nog niet bestaat
        let screen = document.getElementById('screenChangePm');
        if (!screen) {
            screen = document.createElement('div');
            screen.id = 'screenChangePm';
            screen.className = 'screen';
            // App-content container vinden — gebruik de gangbare locatie
            const appContent = document.querySelector('.app-content') || document.body;
            appContent.appendChild(screen);
            // Registreer ook in screen-titles zodat de header wordt geüpdate
            try { this.screenTitles = this.screenTitles || {}; } catch(_) {}
        }

        const mkBtnHtml = (key, icon, label) => {
            const isCurrent = (key === cur) || (key === 'Overschrijving' && cur === 'Overschrijving ter plaatse');
            const bg = isCurrent ? '#e3f2fd' : '#ffffff';
            const border = isCurrent ? '#1565C0' : '#cfd8dc';
            const tag = isCurrent ? ' <span style="font-size:10px;background:#1565C0;color:#fff;padding:2px 6px;border-radius:8px;font-weight:600;margin-left:6px">HUIDIG</span>' : '';
            return '<div onclick="app.changeLastPaymentMethod(\'' + key + '\')" ' +
                'style="display:flex;align-items:center;gap:12px;padding:18px 16px;margin-bottom:10px;' +
                'border:2px solid ' + border + ';border-radius:12px;background:' + bg + ';' +
                'cursor:pointer;font-size:16px;color:#212121">' +
                '<span style="font-size:24px">' + icon + '</span>' +
                '<span style="flex:1;font-weight:500">' + label + tag + '</span>' +
                '<span style="font-size:18px;color:#888">›</span>' +
                '</div>';
        };

        screen.innerHTML =
            '<div style="padding:16px;max-width:600px;margin:0 auto">' +
                '<div style="font-size:22px;font-weight:700;color:#1A237E;margin-bottom:6px">Betaalmethode aanpassen</div>' +
                '<div style="font-size:14px;color:#666;margin-bottom:6px">Factuur <strong>' + (ctx.invoiceLogicId || inv.logicId || '') + '</strong></div>' +
                '<div style="font-size:18px;color:#1A237E;font-weight:700;margin-bottom:18px">€ ' + amount + '</div>' +
                '<div style="font-size:13px;color:#666;margin-bottom:14px">Kies een methode hieronder:</div>' +
                mkBtnHtml('Mollie Tap',    this.icon('card', { size: 20 }), 'Bancontact / kaart (Mollie Tap)') +
                mkBtnHtml('Viva wallet',   this.icon('card', { size: 20 }), 'Viva Wallet (legacy)') +
                mkBtnHtml('Cash',          this.icon('cash', { size: 20 }), 'Cash') +
                mkBtnHtml('Overschrijving',this.icon('bank', { size: 20 }), 'Overschrijving ter plaatse') +
                mkBtnHtml('Via factuur',   this.icon('file', { size: 20 }), 'Via factuur') +
                '<div id="changePmStatus" style="font-size:13px;text-align:center;margin-top:12px;padding:10px;display:none;border-radius:8px"></div>' +
                '<button onclick="app.goBack()" style="width:100%;padding:14px;margin-top:14px;background:#f5f5f5;color:#444;border:none;border-radius:10px;font-size:15px;cursor:pointer">Annuleren</button>' +
            '</div>';

        // Navigate naar het screen (gebruikt het bestaande systeem dat back-knop, history, etc. afhandelt)
        try {
            this.navigate('screenChangePm');
        } catch (e) {
            // Fallback: rauw zichtbaar maken als navigate faalt
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            screen.classList.add('active');
            screen.style.display = 'block';
        }
    },

    /**
     * v88: Handelt de klik op een betaalmethode in de change-modal af.
     *  - Zelfde methode als huidig → reopen het oude betaalscherm (Viva/Overschrijving)
     *    of sluit modal (Cash/Via factuur).
     *  - Andere methode → PUT Betaling-veld update op werkbon + order + factuur,
     *    werk localStorage context bij, en open eventueel het nieuwe betaalscherm.
     */
    async changeLastPaymentMethod(newMethod) {
        const statusEl = document.getElementById('changePmStatus');
        let ctx;
        try {
            ctx = JSON.parse(localStorage.getItem('qe_last_payment_context') || '{}');
        } catch (e) { ctx = {}; }
        if (!ctx.workOrderId) {
            this.toast('Geen laatste betaling gevonden');
            this.goBack();
            return;
        }

        const cur = ctx.paymentMethod || '';
        const sameMethod = (newMethod === cur)
            || (newMethod === 'Overschrijving' && cur === 'Overschrijving ter plaatse');

        if (sameMethod) {
            // Zelfde methode → gewoon het oude betaalscherm openen (als er één is)
            if (newMethod === 'Mollie Tap' && ctx.invoiceResult) {
                // v141: retry de Mollie Tap betaling
                this.payWithMollieTap(ctx.invoiceResult).catch(e => {
                    this.toast('Mollie retry faalde: ' + (e && e.message || e));
                });
            } else if (newMethod === 'Viva wallet' && ctx.invoiceResult) {
                this.showPaymentScreen(ctx.invoiceResult);
            } else if (newMethod === 'Overschrijving' && ctx.invoiceResult) {
                this.showOverschrijvingScreen(ctx.invoiceResult);
            } else {
                this.toast('Geen betaalscherm voor ' + newMethod);
                this.goBack();
            }
            return;
        }

        // Andere methode → PUT updates op alle 3 docs
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#444';
            statusEl.style.background = '#fff8e1';
            statusEl.textContent = 'Bijwerken in Robaws…';
        }

        try {
            const res = await RobawsAPI.setBetalingOnAllDocs({
                workOrderId: ctx.workOrderId,
                salesOrderId: ctx.salesOrderId,
                invoiceId: ctx.invoiceId,
            }, newMethod);
            if (!res.ok) {
                console.warn('[App] Betaling update partial fail:', res.results);
                if (statusEl) {
                    statusEl.style.color = '#c62828';
                    statusEl.style.background = '#ffebee';
                    const failed = [];
                    if (res.results.workOrder && !res.results.workOrder.ok) failed.push('werkbon');
                    if (res.results.salesOrder && !res.results.salesOrder.ok) failed.push('order');
                    if (res.results.invoice && !res.results.invoice.ok) failed.push('factuur');
                    statusEl.textContent = 'Niet alles is bijgewerkt: ' + failed.join(', ');
                }
                return;
            }
            // Update lokale context
            ctx.paymentMethod = newMethod;
            ctx.timestamp = Date.now();
            localStorage.setItem('qe_last_payment_context', JSON.stringify(ctx));

            this.toast('Betaalmethode → ' + newMethod);

            // Open nieuw betaalscherm waar relevant — anders terug naar Uitgevoerd
            if (newMethod === 'Mollie Tap' && ctx.invoiceResult) {
                // v141: start direct de Mollie Tap betaling
                this.payWithMollieTap(ctx.invoiceResult).catch(e => {
                    this.toast('Mollie betaling kon niet starten: ' + (e && e.message || e));
                });
            } else if (newMethod === 'Viva wallet' && ctx.invoiceResult) {
                this.showPaymentScreen(ctx.invoiceResult);
            } else if (newMethod === 'Overschrijving' && ctx.invoiceResult) {
                this.showOverschrijvingScreen(ctx.invoiceResult);
            } else {
                // Cash / Via factuur — terug naar Uitgevoerd, knop-label is nu geüpdate
                this.navigate('screenUitgevoerd');
                this.loadUitgevoerd();
            }
        } catch (e) {
            console.error('[App] changeLastPaymentMethod error:', e);
            if (statusEl) {
                statusEl.style.color = '#c62828';
                statusEl.style.background = '#ffebee';
                statusEl.textContent = 'Fout: ' + (e && e.message);
            }
        }
    },

    // ========================================
    // CLOCK-IN SYSTEEM (NFC + GPS)
    // ========================================

    /** Update de clock status bar op het planning scherm */
    updateClockUI() {
        if (!window.QEClock) return;
        const bar = document.getElementById('clockStatusBar');
        if (!bar) return;

        const user = RobawsAPI.getLoggedInUser();
        if (!user) { bar.style.display = 'none'; return; }

        bar.style.display = 'block';
        const icon = document.getElementById('clockStatusIcon');
        const text = document.getElementById('clockStatusText');
        const sub = document.getElementById('clockStatusSub');

        const session = QEClock.getSession();
        const isActive = session && session.active;
        const clockTime = QEClock.getClockTime();
        const isLate = QEClock.isLate();

        // v79: planning statusbar moet 4 staten kunnen tonen:
        //   - Nog niet ingeklokt (NFC niet gescand vandaag)
        //   - Ingeklokt (actief, hoofd-shift loopt)
        //   - L&L actief (📦 prominent)
        //   - Uitgeklokt (🏁 finish-vlag)
        const llActive = session && session.llActive;
        const llStartTxt = session && session.llStartTime ? session.llStartTime : '';
        if (llActive) {
            // L&L actief — krijgt voorrang in de statusbar
            bar.style.cssText = 'display:block;padding:12px 16px;border-radius:12px;margin-bottom:12px;cursor:pointer;' +
                'background:linear-gradient(135deg,#e3f2fd,#bbdefb);border-left:4px solid #1565c0';
            icon.innerHTML = this.icon('package', { size: 22 });
            text.textContent = 'Bezig met Laden & Lossen';
            text.style.color = '#0d47a1';
            sub.textContent = llStartTxt ? ('Gestart om ' + llStartTxt) : 'Actief';
            sub.style.color = '#1565c0';
        } else if (isActive) {
            // Ingeklokt (hoofd-shift)
            const lateClass = isLate ? 'background:linear-gradient(135deg,#fff3e0,#ffccbc)' : 'background:linear-gradient(135deg,#e8f5e9,#c8e6c9)';
            bar.style.cssText = `display:block;padding:12px 16px;border-radius:12px;margin-bottom:12px;cursor:pointer;${lateClass}`;
            icon.innerHTML = isLate ? this.icon('alert', { size: 22 }) : this.icon('check-circle', { size: 22 });
            const activeTag = QEClock.getActiveTagName();
            const cleanTag = this._publicRemark(activeTag);
            text.textContent = `Actief sinds ${session.startTime}`;
            text.style.color = isLate ? '#e65100' : '#2e7d32';
            sub.textContent = isLate ? 'Te laat!' : (cleanTag || 'Ingeklokt');
            sub.style.color = isLate ? '#e65100' : '#2e7d32';
        } else if (clockTime) {
            // Uitgeklokt — 🏁 finish-vlag
            bar.style.cssText = 'display:block;padding:12px 16px;border-radius:12px;margin-bottom:12px;cursor:pointer;' +
                'background:linear-gradient(135deg,#e8eaf6,#c5cae9);border-left:4px solid #001E45';
            icon.innerHTML = this.icon('flag', { size: 22 });
            text.textContent = `Uitgeklokt — ${clockTime}`;
            text.style.color = '#001E45';
            sub.textContent = 'Klaar voor vandaag';
            sub.style.color = '#3f51b5';
        } else {
            // Nog niet ingeclockt
            const isLateNow = QEClock.isLate();
            const bg = isLateNow ? 'background:linear-gradient(135deg,#fce4ec,#ffcdd2)' : 'background:linear-gradient(135deg,#e3f2fd,#bbdefb)';
            bar.style.cssText = `display:block;padding:12px 16px;border-radius:12px;margin-bottom:12px;cursor:pointer;${bg}`;
            icon.innerHTML = isLateNow ? this.icon('alert', { size: 22 }) : this.icon('clock', { size: 22 });
            text.textContent = isLateNow ? 'Nog niet ingeklokt!' : 'Nog niet ingeklokt';
            text.style.color = isLateNow ? '#c62828' : '#1565c0';
            sub.textContent = `Verwacht: ${QEClock.getExpectedStartTime()}`;
            sub.style.color = isLateNow ? '#c62828' : '#1565c0';
        }
    },

    /** Navigatie-hook: laad clock scherm data wanneer het scherm geopend wordt */
    onNavigateToClock() {
        if (!window.QEClock) return;

        // NFC tags ophalen van Robaws (async) — daarna tag admin renderen
        QEClock.loadTagConfig().then(() => {
            this._renderClockTagAdmin();
        }).catch(e => {
            console.warn('[Clock] Tag config error:', e);
            this._renderClockTagAdmin();
        });
        // Pending items synchroniseren
        QEClock.syncPending().catch(e => console.warn('[Clock] Sync error:', e));

        // Synchroniseer lokale sessie met Robaws (async) — herlaad UI daarna
        QEClock.syncWithRobaws().then(() => {
            this._renderClockSessionUI();
            this.updateClockUI(); // ook statusbar updaten
        }).catch(e => console.warn('[Clock] Robaws sync error:', e));

        // Render direct met lokale data (wordt overschreven na sync)
        this._renderClockSessionUI();

        // ── Mijn week (uit Robaws) ──
        this._loadClockHistory();

        // ── Admin secties (alleen kantoor) ──
        const user = RobawsAPI.getLoggedInUser();
        const adminSection = document.getElementById('clockAdminSection');
        const tagAdminSection = document.getElementById('clockTagAdmin');
        if (user && user.role === 'bureel') {
            adminSection.style.display = 'block';
            this.loadClockAdmin();
            if (tagAdminSection) tagAdminSection.style.display = 'block';
        } else {
            adminSection.style.display = 'none';
            if (tagAdminSection) tagAdminSection.style.display = 'none';
        }
    },

    /** Render de sessie-UI op het klokscherm (status, actieve sessie, voltooide sessies) */
    _renderClockSessionUI() {
        if (!window.QEClock) return;

        const session = QEClock.getSession();
        const isActive = session && session.active;
        const clockTime = QEClock.getClockTime();

        // ── Grote status bovenaan ──
        const bigStatus = document.getElementById('clockBigStatus');
        const bigText = document.getElementById('clockBigText');
        const bigTime = document.getElementById('clockBigTime');

        // v78: L&L active block wordt onafhankelijk gerenderd, ook als main session inactief.
        const llActiveHtml = session && session.llActive ? `
            <div style="margin-top:10px;padding:14px 16px;background:#e3f2fd;border-left:4px solid #1565c0;border-radius:8px;display:flex;align-items:center;gap:12px">
                <span style="color:#e65100">${this.icon('package', { size: 26 })}</span>
                <div>
                    <div style="font-size:15px;font-weight:700;color:#0d47a1">Bezig met Laden &amp; Lossen</div>
                    <div style="font-size:12px;color:#1565c0;opacity:0.9;margin-top:2px">Gestart om ${session.llStartTime || '?'} — scan de L&amp;L tag opnieuw om te stoppen</div>
                </div>
            </div>` : '';

        if (isActive) {
            const isLate = session.registrationType === 'Te laat';
            const isLL = session.registrationType === 'Laden & Lossen';
            bigStatus.innerHTML = isLL ? this.icon('package', { size: 52 }) : (isLate ? this.icon('alert', { size: 52 }) : this.icon('check-circle', { size: 52 }));
            bigText.textContent = isLL ? 'Laden & Lossen' : 'Ingeklokt';
            bigText.style.color = isLate ? '#e65100' : 'var(--qe-green)';
            const _cleanTag = this._publicRemark(session.tagName);
            bigTime.textContent = `${session.startTime} — ${_cleanTag}${isLate ? ' (te laat)' : ''}`;

            document.getElementById('clockNfcCard').style.display = 'none';
            const activeEl = document.getElementById('clockActiveSession');
            if (activeEl) {
                activeEl.style.display = 'block';
                document.getElementById('clockActiveContent').innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                        <h3 style="margin:0;font-size:16px;color:var(--qe-darkblue)">${this.icon('refresh', { size: 16, style: 'vertical-align:-3px' })} Actieve registratie</h3>
                        <span style="background:${isLL ? '#e3f2fd' : '#e8f5e9'};color:${isLL ? '#1565c0' : '#2e7d32'};font-size:11px;padding:2px 8px;border-radius:8px;font-weight:600">${session.registrationType}</span>
                    </div>
                    <div style="display:flex;gap:16px;margin-bottom:8px">
                        <div><span style="font-size:12px;color:var(--qe-grey)">Start</span><br><span style="font-size:15px;font-weight:600">${session.startTime}</span></div>
                        <div><span style="font-size:12px;color:var(--qe-grey)">Verwacht</span><br><span style="font-size:15px;font-weight:600">${QEClock.getExpectedStartTime()}</span></div>
                        <div><span style="font-size:12px;color:var(--qe-grey)">Locatie</span><br><span style="font-size:15px;font-weight:600">${this._publicRemark(session.tagName)}</span></div>
                    </div>
                    <p style="font-size:13px;color:var(--qe-grey);margin:0">Scan opnieuw een NFC tag om uit te clocken</p>
                    ${llActiveHtml}
                `;
            }
        } else {
            const isLateNow = QEClock.isLate();
            if (clockTime) {
                bigStatus.innerHTML = this.icon('flag', { size: 52 });
                bigText.textContent = 'Uitgeklokt';
                bigText.style.color = 'var(--qe-darkblue)';
                bigTime.textContent = `Eerste scan: ${clockTime}`;
            } else {
                bigStatus.innerHTML = isLateNow ? this.icon('alert', { size: 52 }) : this.icon('clock', { size: 52 });
                bigText.textContent = isLateNow ? 'Nog niet ingeklokt!' : 'Nog niet ingeklokt';
                bigText.style.color = isLateNow ? '#c62828' : 'var(--qe-darkblue)';
                bigTime.textContent = `Verwacht: ${QEClock.getExpectedStartTime()}`;
            }

            // Toon NFC instructie
            const nfcCard = document.getElementById('clockNfcCard');
            nfcCard.style.display = 'block';
            if (window.QEBridge && !QEBridge.isNfcEnabled()) {
                nfcCard.innerHTML = `
                    <div style="text-align:center;padding:20px">
                        <div style="margin-bottom:8px;color:var(--qe-grey)">${this.icon('phone-off', { size: 34 })}</div>
                        <div style="font-size:15px;font-weight:600;margin-bottom:4px">NFC niet beschikbaar</div>
                        <div style="font-size:13px;color:var(--qe-grey)">Zet NFC aan in je telefoon-instellingen</div>
                        ${llActiveHtml}
                    </div>`;
            } else {
                nfcCard.innerHTML = `
                    <div style="margin-bottom:8px;color:var(--qe-purple)">${this.icon('phone', { size: 34 })}</div>
                    <div style="font-size:15px;font-weight:600;margin-bottom:4px">Houd je telefoon tegen de NFC tag</div>
                    <div style="font-size:13px;color:var(--qe-grey)">Bureau, camionet of laden & lossen</div>
                    ${llActiveHtml}
                `;
            }
            // v78: actieve sessie card alleen tonen als L&L actief is (zonder main shift)
            const activeEl = document.getElementById('clockActiveSession');
            if (activeEl) {
                if (session && session.llActive) {
                    activeEl.style.display = 'block';
                    document.getElementById('clockActiveContent').innerHTML = llActiveHtml ||
                        '<p style="color:var(--qe-grey)">Geen actieve sessie</p>';
                } else {
                    activeEl.style.display = 'none';
                }
            }
        }

        // ── Voltooide sessies vandaag ──
        const completedSection = document.getElementById('clockCompletedSection');
        const completedList = document.getElementById('clockCompletedList');
        const completed = session ? (session.completedSessions || []) : [];
        if (completed.length > 0) {
            completedSection.style.display = 'block';
            completedList.innerHTML = completed.map(s => {
                const typeIcon = s.type === 'Te laat' ? this.icon('alert', { size: 16 }) : (s.type === 'Laden & Lossen' ? this.icon('package', { size: 16 }) : (s.type === 'Extra uren' ? this.icon('refresh', { size: 16 }) : this.icon('check-circle', { size: 16 })));
                const bg = s.type === 'Te laat' ? '#fff8e1' : '#f1f8e9';
                return `<div class="card" style="padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;background:${bg}">
                    <div style="display:flex;align-items:center;gap:10px">
                        <span>${typeIcon}</span>
                        <div>
                            <div style="font-size:14px;font-weight:500">${s.type}</div>
                            <div style="font-size:11px;color:var(--qe-grey)">${this._publicRemark(s.tagName)}</div>
                        </div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:14px;font-weight:600">${s.startTime} → ${s.endTime}</div>
                        <div style="font-size:11px;color:var(--qe-grey)">${s.hours} uur</div>
                    </div>
                </div>`;
            }).join('');
        } else {
            completedSection.style.display = 'none';
        }

        // ── Pending sync count ──
        // v71: pending queue is per user (qe_clock_pending_<email>), niet global
        const _pcUser = RobawsAPI.getLoggedInUser();
        const _pcKey = _pcUser ? `qe_clock_pending_${_pcUser.email}` : null;
        let pendingCount = 0;
        try { pendingCount = _pcKey ? (JSON.parse(localStorage.getItem(_pcKey) || '[]').length) : 0; } catch(_) {}
        const pendingEl = document.getElementById('clockPendingCount');
        if (pendingEl) {
            pendingEl.textContent = pendingCount > 0
                ? `${pendingCount} registratie(s) wachten op synchronisatie`
                : 'Alles gesynchroniseerd ✓';
        }
    },

    /** Render tag admin HTML + bind events (aangeroepen na loadTagConfig) */
    _renderClockTagAdmin() {
        const user = RobawsAPI.getLoggedInUser();
        if (!user || user.role !== 'bureel') return;
        const tagList = document.getElementById('clockTagList');
        if (!tagList) return;
        tagList.innerHTML = QEClock.renderTagAdmin();
        QEClock.bindTagAdminEvents();
    },

    /** Herlaad tag admin sectie */
    async refreshTagAdmin() {
        await QEClock.loadTagConfig();
        this._renderClockTagAdmin();
    },

    /** Laad clock geschiedenis uit Robaws */
    async _loadClockHistory() {
        const historyEl = document.getElementById('clockHistory');
        if (!historyEl) return;
        historyEl.innerHTML = '<div class="spinner" style="margin:8px auto"></div>';

        try {
            const history = await QEClock.getHistory(7);
            if (history.length === 0) {
                historyEl.innerHTML = '<p class="text-grey text-sm text-center">Geen registraties deze week</p>';
                return;
            }

            const days = ['Zo','Ma','Di','Wo','Do','Vr','Za'];
            historyEl.innerHTML = history.map(h => {
                const startDt = new Date(h.startDate);
                const dayName = days[startDt.getDay()];
                const dateShort = h.startDate.substring(5, 10);
                const startTime = startDt.toTimeString().slice(0, 5);
                const endTime = h.endDate ? new Date(h.endDate).toTimeString().slice(0, 5) : '...';
                const typeIcon = h.type === 'Te laat' ? this.icon('alert', { size: 16 }) : (h.type === 'Laden & Lossen' ? this.icon('package', { size: 16 }) : (h.type === 'Extra uren' ? this.icon('refresh', { size: 16 }) : this.icon('check-circle', { size: 16 })));
                const bg = h.type === 'Te laat' ? '#fff8e1' : (h.type === 'Laden & Lossen' ? '#e3f2fd' : '#f1f8e9');
                const hours = h.hours ? `${h.hours}u` : '';

                return `<div class="card" style="padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;background:${bg}">
                    <div style="display:flex;align-items:center;gap:10px">
                        <span>${typeIcon}</span>
                        <div>
                            <div style="font-size:14px;font-weight:500">${dayName} ${dateShort}</div>
                            <div style="font-size:11px;color:var(--qe-grey)">${h.type}</div>
                        </div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:14px;font-weight:600">${startTime} → ${endTime}</div>
                        <div style="font-size:11px;color:var(--qe-grey)">${hours}</div>
                    </div>
                </div>`;
            }).join('');
        } catch (e) {
            historyEl.innerHTML = '<p class="text-grey text-sm text-center">Kon geschiedenis niet laden</p>';
        }
    },

    /** Laad team aanwezigheid vandaag (admin, uit Robaws) */
    async loadClockAdmin() {
        const list = document.getElementById('clockAdminList');
        if (!list) return;
        list.innerHTML = '<div class="spinner"></div>';

        try {
            const attendance = await QEClock.getAllAttendanceToday();
            if (attendance.length === 0) {
                list.innerHTML = '<p class="text-grey text-sm text-center">Geen registraties vandaag</p>';
                return;
            }

            list.innerHTML = attendance.map(a => {
                const icon = a.isLate ? '⚠️' : (a.clockTime ? '✅' : '⏳');
                const bg = a.isLate ? '#fff8e1' : (a.clockTime ? '#f1f8e9' : '#fff');
                const timeText = a.clockTime
                    ? `<span style="font-weight:600">${a.clockTime}</span> <span style="font-size:11px;color:var(--qe-grey)">${a.type || ''}</span>`
                    : '<span style="color:var(--qe-grey)">—</span>';
                const extraInfo = [];
                if (a.ladenLossen > 0) extraInfo.push(`📦 ${a.ladenLossen}x L&L`);
                if (a.extraUren > 0) extraInfo.push(`🔄 ${a.extraUren}x extra`);
                const extraHtml = extraInfo.length > 0 ? `<div style="font-size:11px;color:var(--qe-orange)">${extraInfo.join(' · ')}</div>` : '';

                return `<div class="card" style="padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;background:${bg}">
                    <div style="display:flex;align-items:center;gap:10px">
                        <span>${icon}</span>
                        <div>
                            <div style="font-size:14px;font-weight:500">${a.name}</div>
                            ${extraHtml}
                        </div>
                    </div>
                    <div style="text-align:right">${timeText}</div>
                </div>`;
            }).join('');
        } catch (e) {
            list.innerHTML = `<p class="text-grey text-sm text-center">Fout: ${e.message}</p>`;
        }
    },

    showPaymentScreen(invoiceData) {
        // Sla betaaldata op zodat het scherm later hertoegankelijk is
        try { localStorage.setItem('qe_last_payment', JSON.stringify(invoiceData)); } catch(e){}

        const inv = invoiceData.invoice;
        const amount = inv.totalInclVat;
        const ogm = inv.formattedOgm || inv.paymentInstruction;
        const terminal = this.getSelectedTerminal();

        this.navigate('screenPayment', true);

        // Bewaar invoice data voor later gebruik
        this._currentPaymentInvoice = inv;

        // BUG-fix: _lastInvoiceForRetry werd nergens gezet → markPaymentFailed
        // kon de factuur niet bewaren in de openstaande lijst, waardoor de
        // klant later niet meer kon betalen. We bewaren hier alle info die
        // nodig is voor een retry: invoiceId, bedrag, OGM en logicId.
        this._lastInvoiceForRetry = {
            invoiceId: inv.id,
            amount: amount,
            ogm: inv.paymentInstruction || '',
            invoiceLogicId: inv.logicId || '',
            timestamp: Date.now(),
        };

        const terminalInfo = terminal
            ? `<div style="font-size:12px;color:var(--qe-grey);margin-top:4px">
                    Terminal: ${this.escapeHtml(terminal.desc)}
                    <span onclick="app.showTerminalPicker()" style="color:var(--qe-purple);cursor:pointer;font-weight:500;margin-left:4px">wijzig</span>
               </div>`
            : '';

        const content = document.getElementById('paymentContent');
        content.innerHTML = `
            <div style="margin-bottom:24px">
                <div style="width:80px;height:80px;border-radius:50%;background:var(--qe-orange);
                    display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:#fff">
                    ${this.icon('card', { size: 40 })}
                </div>
                <h2 style="color:var(--qe-darkblue);margin:0 0 4px;font-size:22px">Betaling</h2>
                <div style="font-size:14px;color:var(--qe-grey)">Factuur ${this.escapeHtml(inv.logicId)}</div>
            </div>

            <!-- Bedrag -->
            <div style="background:var(--qe-darkblue);color:#fff;border-radius:16px;padding:24px;margin-bottom:20px">
                <div style="font-size:14px;opacity:0.7;margin-bottom:4px">Te betalen</div>
                <div style="font-size:36px;font-weight:700">${this.formatPrice(amount)}</div>
                <div style="font-size:13px;opacity:0.6;margin-top:8px">
                    excl. BTW: ${this.formatPrice(inv.totalExclVat)}
                </div>
            </div>

            <!-- Gestructureerde mededeling -->
            <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #e0e0e0">
                <div style="font-size:12px;color:var(--qe-grey);margin-bottom:4px">Gestructureerde mededeling</div>
                <div style="font-size:20px;font-weight:700;color:var(--qe-purple);letter-spacing:1px;font-family:monospace">${this.escapeHtml(ogm)}</div>
            </div>

            <!-- Betaalknop: alleen terminal (QR-code is voor overschrijving) -->
            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
                <button onclick="app.startTerminalPayment('${inv.id}', ${amount}, '${inv.paymentInstruction}', '${this.escapeHtml(inv.logicId)}')"
                    style="padding:16px;border:none;border-radius:12px;background:var(--qe-orange);
                    color:#fff;font-size:16px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px">
                    ${this.icon('card', { size: 18, style: 'vertical-align:-3px' })} Betalen via terminal
                </button>
                ${terminalInfo}
            </div>

            <!-- Overslaan -->
            <button onclick="app.skipPayment()" style="padding:12px;border:1px solid #ddd;border-radius:10px;
                background:#fff;color:var(--qe-grey);font-size:14px;cursor:pointer;width:100%">
                Betaling overslaan (factuur versturen)
            </button>

            <div id="paymentStatus" style="margin-top:16px"></div>
        `;
    },

    // ========================================
    // CONTANT (CASH) — afrekenscherm met wisselgeld
    // ========================================
    showCashScreen(invoiceData) {
        const inv = (invoiceData && invoiceData.invoice) ? invoiceData.invoice : null;
        const amount = (inv && inv.totalInclVat != null) ? inv.totalInclVat : null;
        if (amount == null) {
            // Geen factuurtotaal beschikbaar -> oude afhandeling
            this.toast('Werkbon verstuurd — contant');
            this.navigate('screenPlanning', false);
            this.screenHistory = [];
            this.loadPlanning();
            return;
        }

        this._cashTotal = amount;
        this.navigate('screenPayment', true);

        const quick = this._cashQuickAmounts(amount);
        const quickBtns = [{ v: amount, label: 'Gepast' }]
            .concat(quick.map(v => ({ v: v, label: this.formatPrice(v) })))
            .map(q => `<button onclick="app._cashSetReceived(${q.v})" style="flex:1;min-width:90px;padding:10px;border:1px solid var(--qe-hairline);border-radius:10px;background:#fff;color:var(--qe-darkblue);font-size:14px;font-weight:500;cursor:pointer">${this.escapeHtml(q.label)}</button>`)
            .join('');

        const content = document.getElementById('paymentContent');
        content.innerHTML = `
            <div style="margin-bottom:20px">
                <div style="width:80px;height:80px;border-radius:50%;background:var(--qe-orange);
                    display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:#fff">
                    ${this.icon('cash', { size: 40 })}
                </div>
                <h2 style="color:var(--qe-darkblue);margin:0 0 4px;font-size:22px">Contant betalen</h2>
                ${inv.logicId ? `<div style="font-size:14px;color:var(--qe-grey)">Factuur ${this.escapeHtml(inv.logicId)}</div>` : ''}
            </div>

            <div style="background:var(--qe-darkblue);color:#fff;border-radius:16px;padding:24px;margin-bottom:20px">
                <div style="font-size:14px;opacity:0.7;margin-bottom:4px">Totaal te ontvangen</div>
                <div style="font-size:36px;font-weight:700">${this.formatPrice(amount)}</div>
            </div>

            <div style="text-align:left;margin-bottom:12px">
                <label style="font-size:14px;color:var(--qe-darkblue);font-weight:500;display:block;margin-bottom:8px">Ontvangen bedrag</label>
                <div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--qe-hairline);border-radius:12px;padding:2px 14px">
                    <span style="font-size:26px;color:var(--qe-grey)">€</span>
                    <input id="cashReceived" type="text" inputmode="decimal" placeholder="0,00"
                        oninput="app._cashUpdateChange()"
                        style="border:none;outline:none;font-size:30px;font-weight:700;color:var(--qe-darkblue);width:100%;padding:10px 0;background:transparent;text-align:right">
                </div>
            </div>

            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px">${quickBtns}</div>

            <div id="cashChangeBox" style="border-radius:16px;padding:20px;margin-bottom:24px;text-align:center;display:none">
                <div style="font-size:14px;color:var(--qe-grey);margin-bottom:4px" id="cashChangeLabel">Wisselgeld</div>
                <div style="font-size:34px;font-weight:700" id="cashChangeValue">€0,00</div>
            </div>

            <button onclick="app.finishCashPayment()" style="padding:16px;border:none;border-radius:12px;background:var(--qe-orange);
                color:#fff;font-size:16px;font-weight:600;cursor:pointer;width:100%">
                Afronden
            </button>
        `;

        setTimeout(() => { const el = document.getElementById('cashReceived'); if (el) el.focus(); }, 150);
    },

    _cashQuickAmounts(total) {
        const opts = [10, 50, 100].map(n => Math.ceil(total / n) * n).filter(v => v > total);
        return Array.from(new Set(opts)).sort((a, b) => a - b);
    },

    _cashParse(str) {
        if (str == null) return NaN;
        return parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));
    },

    _cashSetReceived(val) {
        const el = document.getElementById('cashReceived');
        if (!el) return;
        el.value = String(Math.round(val * 100) / 100).replace('.', ',');
        this._cashUpdateChange();
    },

    _cashUpdateChange() {
        const el = document.getElementById('cashReceived');
        const box = document.getElementById('cashChangeBox');
        const lbl = document.getElementById('cashChangeLabel');
        const val = document.getElementById('cashChangeValue');
        if (!el || !box) return;
        const received = this._cashParse(el.value);
        const total = this._cashTotal || 0;
        if (isNaN(received) || String(el.value).trim() === '') { box.style.display = 'none'; return; }
        box.style.display = 'block';
        const diff = Math.round((received - total) * 100) / 100;
        if (diff >= 0) {
            lbl.textContent = 'Wisselgeld';
            val.textContent = this.formatPrice(diff);
            box.style.background = '#EAF3EA';
            val.style.color = '#2E7D4F';
        } else {
            lbl.textContent = 'Te weinig ontvangen';
            val.textContent = this.formatPrice(Math.abs(diff));
            box.style.background = '#FDECEA';
            val.style.color = '#C0392B';
        }
    },

    finishCashPayment() {
        this.toast('Werkbon verstuurd — contant betaald');
        this.navigate('screenPlanning', false);
        this.screenHistory = [];
        this.loadPlanning();
    },

    async startTerminalPayment(invoiceId, amount, ogm, invoiceLogicId) {
        const statusDiv = document.getElementById('paymentStatus');
        const amountCents = Math.round(amount * 100);

        // Check of native bridge beschikbaar is (in APK)
        if (typeof QEBridge === 'undefined' || !QEBridge.openVivaTerminal) {
            statusDiv.innerHTML = `<div style="color:#e53935;padding:12px;background:#ffebee;border-radius:8px">
                Terminal-integratie alleen beschikbaar in de APK versie.<br>
                <small>Gebruik de QR/betaallink optie als alternatief.</small>
            </div>`;
            return;
        }

        statusDiv.innerHTML = `
            <div style="text-align:center">
                <div class="spinner" style="margin:8px auto"></div>
                <div style="font-size:13px;color:var(--qe-grey);margin-top:8px">
                    Viva.com Terminal openen...
                </div>
            </div>`;

        try {
            // Stap 1: Maak payment order aan (voor tracking + gestructureerde mededeling)
            const orderRes = await fetch('api/payment.php?action=create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount,
                    description: `Factuur ${invoiceLogicId}`,
                    ogm,
                    invoiceId,
                }),
            });
            const orderData = await orderRes.json();

            if (!orderData.success) {
                statusDiv.innerHTML = `<div style="color:#e53935;padding:12px;background:#ffebee;border-radius:8px">
                    ${orderData.error || 'Betaalorder aanmaken mislukt'}
                </div>`;
                return;
            }

            // Bewaar context voor callback
            this._pendingPayment = {
                invoiceId,
                orderCode: orderData.orderCode,
                amount,
                ogm,
                invoiceLogicId,
            };

            // Stap 2: Open Viva.com Terminal app direct op deze telefoon
            // merchantRef = volledige gestructureerde mededeling +++xxx/xxxx/xxxxx+++
            const ogmDigits = (ogm || '').replace(/[^0-9]/g, '');
            let merchantRef = '';
            if (ogmDigits.length >= 12) {
                // Formatteer als +++xxx/xxxx/xxxxx+++
                merchantRef = '+++' + ogmDigits.slice(0,3) + '/' + ogmDigits.slice(3,7) + '/' + ogmDigits.slice(7,12) + '+++';
            } else if (ogmDigits) {
                merchantRef = '+++' + ogmDigits + '+++';
            }
            if (!merchantRef) {
                // Geen OGM beschikbaar — waarschuw, maar laat gebruiker beslissen
                if (!confirm('Geen gestructureerde mededeling beschikbaar voor deze factuur.\n\nDoorgaan zonder OGM? Dan moet je de betaling later handmatig matchen.')) {
                    statusDiv.innerHTML = '';
                    return;
                }
                merchantRef = 'FACT' + (invoiceLogicId || '').replace(/[^0-9A-Za-z]/g, '');
            }
            const clientTrxId = String(orderData.orderCode);
            const opened = QEBridge.openVivaTerminal(amountCents, merchantRef, clientTrxId);

            if (opened) {
                statusDiv.innerHTML = `
                    <div style="color:#2e7d32;padding:16px;background:#e8f5e9;border-radius:12px;text-align:center">
                        <div style="margin-bottom:8px;color:var(--qe-purple)">${this.icon('phone', { size: 28 })}</div>
                        <div style="font-weight:600;font-size:15px">Terminal geopend</div>
                        <div style="font-size:13px;color:#558b2f;margin-top:4px">Controleer de Viva Wallet app</div>
                        <div style="font-size:12px;color:#689f38;margin-top:8px">Bedrag: € ${amount.toFixed(2)} — ${this.escapeHtml(ogm || '')}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
                        <button onclick="app.markPaymentSuccess('${invoiceId}', ${amount}, '${this.escapeHtml(invoiceLogicId || '')}')"
                            style="background:#2e7d32;color:#fff;border:none;border-radius:10px;padding:16px;font-size:16px;font-weight:600;cursor:pointer">
                            ${this.icon('check-circle', { size: 18, style: 'vertical-align:-3px' })} Betaling gelukt
                        </button>
                        <button onclick="app.markPaymentFailed('${invoiceId}')"
                            style="background:#fff;color:#c62828;border:2px solid #c62828;border-radius:10px;padding:14px;font-size:15px;font-weight:600;cursor:pointer">
                            ${this.icon('x', { size: 18, style: 'vertical-align:-3px' })} Betaling niet gelukt
                        </button>
                    </div>`;
            } else {
                statusDiv.innerHTML = `<div style="color:#e53935;padding:12px;background:#ffebee;border-radius:8px">
                    Viva.com Terminal app kon niet geopend worden.<br>
                    <small>Installeer "Viva.com | Terminal" uit de Play Store, of gebruik de QR-code als alternatief.</small>
                </div>`;
            }
        } catch (e) {
            statusDiv.innerHTML = `<div style="color:#e53935;padding:12px;background:#ffebee;border-radius:8px">Fout: ${e.message}</div>`;
        }
    },

    // Callback vanuit de Viva Terminal app (via MainActivity.onNewIntent)
    onVivaPaymentResult(url) {
        console.log('[Viva callback]', url);
        try {
            const u = new URL(url);
            const params = Object.fromEntries(u.searchParams);
            const success = params.status === 'success' || params.statusCode === '00' || params.responseCode === '0000';

            if (success) {
                const pp = this._pendingPayment || {};
                // Factuur uit openstaande lijst halen
                if (pp.invoiceId) this._removePendingPayment(pp.invoiceId);
                // Markeer factuur als betaald in Robaws
                if (pp.invoiceId) {
                    fetch('api/payment.php?action=mark-paid', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ invoiceId: pp.invoiceId }),
                    }).catch(() => {});
                }
                this.showPaymentSuccess(pp.amount || 0, pp.invoiceLogicId || '');
            } else {
                this.showPaymentFailed(params.message || params.error || 'Klant heeft geannuleerd of betaling geweigerd');
            }
        } catch (e) {
            console.error('[Viva callback parse error]', e);
        }
    },

    // =====================================================================
    // v142: MOLLIE TAP-TO-PAY (app-to-app intent flow)
    // =====================================================================

    /** Start de Mollie Tap-to-Pay flow: bouw payload + launch via Java bridge. */
    async payWithMollieTap(invoiceResult) {
        if (typeof MollieAPI === 'undefined') {
            this.toast('Mollie module niet geladen');
            this.showPaymentScreen(invoiceResult);
            return;
        }
        if (typeof QEBridge === 'undefined' || !QEBridge.openMollieTap) {
            this.toast('Mollie bridge niet beschikbaar — APK update nodig');
            this.showPaymentScreen(invoiceResult);
            return;
        }
        const inv = invoiceResult.invoice;
        const amountCents = Math.round(parseFloat(inv.totalInclVat) * 100);
        // v143: description = ENKEL factuur-logicId (bv "F20252853") zodat
        // de Mollie ↔ Robaws auto-koppeling de factuur automatisch op
        // "betaald" zet (Robaws matcht op factuurnummer in description).
        const description = inv.logicId || inv.id || 'QE Werkbon';
        const workOrderId = this.currentWO ? this.currentWO.id : null;

        // Bouw payload (vóór context-bewaren zodat we de referenceId mee kunnen pakken)
        const payload = MollieAPI.buildPaymentRequest({
            amountCents,
            description,
            workOrderId,
            invoiceId: inv.id,
        });
        console.log('[Mollie] payload:', payload);

        // Context bewaren voor de result-handler (intent kan onze app kill'en)
        this._mollieContext = {
            invoiceId: inv.id,
            amount: parseFloat(inv.totalInclVat),
            invoiceLogicId: inv.logicId || '',
            ogm: inv.paymentInstruction || '',
            // v155: bewaar referenceId + description voor Worker-polling
            referenceId: payload.referenceId,
            description: payload.description,
        };
        try { localStorage.setItem('qe_mollie_pending', JSON.stringify(this._mollieContext)); } catch(_) {}
        this._mollieHandled = false;
        // v154: auto-return tracking — reset bij elke nieuwe launch
        this._mollieAutoReturnAttempted = false;
        this._mollieManualFallbackShown = false;
        this._mollieBounceAttempted = false;   // v161
        this._mollieLaunchedAt = Date.now();

        if (typeof this.showScanLoading === 'function') {
            this.showScanLoading('Mollie Tap openen…');
        }

        // Launch via Java bridge — Java doet de HMAC-signing + intent
        let launched = false;
        try {
            launched = QEBridge.openMollieTap(JSON.stringify(payload));
        } catch (e) {
            console.warn('[Mollie] bridge openMollieTap gooi-fout:', e && e.message);
        }
        if (!launched) {
            if (typeof this.hideScanLoading === 'function') this.hideScanLoading();
            this.showPaymentFailed('Mollie Tap app niet gevonden of niet geïnstalleerd');
            setTimeout(() => this.showPaymentScreen(invoiceResult), 5000);
            return;
        }

        // v155: start Worker-polling — vangt het scenario op waarin Mollie Tap
        // de intent NIET terugstuurt (gedocumenteerd: "intent might not return
        // if the payment process is interrupted"). Mollie pingt onze Worker met
        // de webhook, Worker bewaart status in KV, app polled die KV.
        this._startMolliePolling();
    },

    /** v159: ULTRA-PERSISTENT POLLING.
     *  Gebruikt setInterval (niet recursief setTimeout) zodat zelfs als
     *  Android throttling toeslaat tijdens de Tap-betaling, de polling op
     *  onze "1 seconde"-cadans hervat zodra de WebView weer mag draaien.
     *  Geen max-duration meer — stopt alleen bij _mollieHandled of expliciete
     *  _stopMolliePolling(). De manuele "Annuleer"-knop blijft als noodrem. */
    _startMolliePolling() {
        // Stop een eventueel lopende polling
        this._stopMolliePolling();
        const ctx = this._mollieContext;
        if (!ctx || !ctx.referenceId) {
            console.warn('[Mollie poll] geen context/referenceId — skip polling');
            return;
        }
        console.log('[Mollie poll] START continue polling (1s) voor', ctx.referenceId);
        this._molliePollStartedAt = Date.now();
        this._molliePollTickCount = 0;
        // setInterval — Android pause't dit in background; bij resume blijft
        // het op z'n 1s-ritme tikken. Veel betrouwbaarder dan recursief
        // setTimeout dat moeten worden bijgehouden.
        this._molliePollTimer = setInterval(() => this._molliePollTick(), 1000);
        // Eerste tick onmiddellijk (niet wachten op interval)
        this._molliePollTick();
    },

    async _molliePollTick() {
        const ctx = this._mollieContext;
        if (!ctx || !ctx.referenceId) {
            this._stopMolliePolling();
            return;
        }
        if (this._mollieHandled) {
            this._stopMolliePolling();
            return;
        }
        this._molliePollTickCount = (this._molliePollTickCount || 0) + 1;
        const elapsed = ((Date.now() - this._molliePollStartedAt) / 1000).toFixed(1);
        // Heartbeat-log elke 5 ticks zodat we kunnen zien of polling daadwerkelijk draait
        if (this._molliePollTickCount % 5 === 1) {
            console.log('[Mollie poll] tick #' + this._molliePollTickCount + ' (' + elapsed + 's)');
        }
        let data = null;
        try {
            data = await MollieAPI.fetchPaymentStatus({
                referenceId: ctx.referenceId,
                description: ctx.description,
            });
        } catch (e) {
            console.warn('[Mollie poll] fetch fout:', e && e.message);
        }
        if (this._mollieHandled) {
            this._stopMolliePolling();
            return;
        }
        if (data && data.found && (data.status === 'paid' || data.status === 'failed')) {
            console.log('[Mollie poll] webhook-status binnen na tick #' + this._molliePollTickCount + ':', data.status, 'robawsMarked:', data.robawsMarked);
            this.onMollieTapResult({
                status:             data.status,
                paymentId:          data.paymentId || ('webhook_' + Date.now()),
                referenceId:        data.referenceId || ctx.referenceId,
                failureMessage:     data.failureMessage || null,
                failureSupportCode: data.failureSupportCode || null,
                signatureValid:     true,
                robawsMarked:       data.robawsMarked === true,
                robawsError:        data.robawsError || null,
                _source:            'webhook-poll',
            });
        }
    },

    /** Stop polling — aangeroepen wanneer een ander pad de betaling afhandelt. */
    _stopMolliePolling() {
        if (this._molliePollTimer) {
            clearInterval(this._molliePollTimer);
            this._molliePollTimer = null;
            console.log('[Mollie poll] STOP polling');
        }
    },

    /** v151: simpele, eerlijke intent-based detection.
     *  Mollie Tap onActivityResult geeft ons via Java een result-object met:
     *    { status, paymentId, referenceId, failureMessage, failureSupportCode,
     *      signatureValid, canceled, hasData, resultCode, extrasKeys }
     *  We vertrouwen daar 100% op — geen API check meer.
     *
     *  Statuswaarden volgens Mollie Tap docs:
     *    - "paid"     → SUCCES + factuur op betaald in Robaws
     *    - "failed"   → MISLUKT met failureMessage / supportCode
     *    - geen status → user heeft Tap-app afgesloten zonder te betalen
     */
    onMollieTapResult(result) {
        console.log('[Mollie intent result]', JSON.stringify(result));
        if (this._mollieHandled) return;
        this._mollieHandled = true;

        // v155: stop Worker-polling — andere paden hebben de betaling al af
        if (typeof this._stopMolliePolling === 'function') this._stopMolliePolling();
        // v160: stop ook de Java-side polling timer
        try {
            if (typeof QEBridge !== 'undefined' && QEBridge.stopMolliePolling) {
                QEBridge.stopMolliePolling();
            }
        } catch(_) {}

        // v154: opruim de manuele fallback-knoppen (als die er stonden) — die
        // zitten in de scan-loading card en worden hieronder met hideScanLoading
        // verborgen, maar voor de zekerheid expliciet verwijderen.
        try {
            const stray = document.querySelectorAll('.mollie-manual-fallback');
            stray.forEach(n => n.remove());
        } catch(_) {}

        if (typeof this.hideScanLoading === 'function') this.hideScanLoading();

        // Context ophalen die we vóór de Tap-launch bewaarden
        const ctx = this._mollieContext
            || (() => { try { return JSON.parse(localStorage.getItem('qe_mollie_pending') || 'null'); } catch(_) { return null; } })()
            || {};
        try { localStorage.removeItem('qe_mollie_pending'); } catch(_) {}
        if (this._removePendingPayment && ctx.invoiceId) {
            this._removePendingPayment(ctx.invoiceId);
        }

        const status   = result && result.status;
        const paymentId = result && result.paymentId;
        const sigOk    = !(result && result.signatureValid === false);   // null/undefined/true = OK
        const canceled = result && (result.canceled === true || result.resultCode === 0);

        // ── 1. SUCCES (status = paid) ──────────────────────────────────
        if (status === 'paid') {
            console.log('[Mollie] PAID:', paymentId, 'signature valid:', sigOk);

            // Signature warning maar niet blokkerend — Mollie Tap heeft 'paid' al
            // gerapporteerd, en de gebruiker ziet ook zelf de success-melding in de
            // Tap app. Voor de admin loggen we het en zetten een toast achteraan.
            if (!sigOk) {
                console.warn('[Mollie] paid met ongeldige signature — toch verwerken');
            }

            // Toon SUCCES card (v130 design via showPaymentSuccess)
            this.showPaymentSuccess(ctx.amount || 0, ctx.invoiceLogicId || '');

            // v155: als het result via de Worker-poll kwam EN de Worker heeft
            // de factuur al gemarkeerd, kunnen we de app's Robaws-call skippen.
            // Anders (intent result, OF Worker faalde op Robaws): app doet het zelf.
            const fromWebhook    = result && result._source === 'webhook-poll';
            const workerMarked   = !!(result && result.robawsMarked);
            const skipAppRobaws  = fromWebhook && workerMarked;

            // Idempotency-check: schrijf maar één keer naar Robaws per paymentId
            const dedupKey = 'qe_mollie_processed_' + paymentId;
            const already = (() => { try { return !!localStorage.getItem(dedupKey); } catch(_) { return false; } })();
            if (!already && ctx.invoiceId && !skipAppRobaws) {
                if (fromWebhook && !workerMarked) {
                    console.log('[Mollie] Worker heeft Robaws niet kunnen markeren — app doet het alsnog', result.robawsError);
                }
                this._registerMolliePaymentInRobaws({
                    invoiceId:      ctx.invoiceId,
                    invoiceLogicId: ctx.invoiceLogicId,
                    amount:         ctx.amount,
                    paymentId:      paymentId,
                    referenceId:    result && result.referenceId,
                    dedupKey:       dedupKey,
                });
            } else if (skipAppRobaws) {
                console.log('[Mollie] success via Worker-poll — Robaws-update al door Worker gedaan');
                try { localStorage.setItem(dedupKey, String(Date.now())); } catch(_) {}
                setTimeout(() => this.toast('Factuur ' + (ctx.invoiceLogicId || '') + ' op betaald'), 1200);
            }
            if (!sigOk) {
                setTimeout(() => this.toast(
                    '⚠️ Signature mismatch op deze betaling — controleer in Mollie dashboard'
                ), 2500);
            }
            return;
        }

        // ── 2. MISLUKT (status = failed) ───────────────────────────────
        if (status === 'failed') {
            const reason = result.failureMessage || 'Betaling geweigerd';
            const code   = result.failureSupportCode ? ' (' + result.failureSupportCode + ')' : '';
            console.log('[Mollie] FAILED:', reason, code);
            this.showPaymentFailed('Betaling mislukt: ' + reason + code);
            return;
        }

        // ── 3. GEANNULEERD (geen status, user heeft Tap-app gesloten) ─
        if (canceled || !status) {
            console.log('[Mollie] CANCELED of geen status — gebruiker heeft Tap afgesloten');
            this.showPaymentFailed(
                'Betaling geannuleerd. De klant heeft de Mollie Tap-app afgesloten zonder te betalen.'
            );
            return;
        }

        // ── 4. ONBEKENDE STATUS (theoretisch onbereikbaar, maar veilig) ─
        console.warn('[Mollie] onbekende status:', status, '— raw:', result);
        this.showPaymentFailed(
            'Onverwachte status van Mollie Tap: "' + status + '". Controleer in Mollie dashboard.'
        );
    },

    // =====================================================================
    // v154: AUTO-RETURN naar Mollie Tap wanneer onze app voorgrond komt
    // zonder dat de intent-result is binnengekomen. Mollie Tap finish()'t
    // soms niet correct → onze WebView blijft hangen op de spinner. Door
    // Tap automatisch terug naar voren te brengen (FLAG_REORDER_TO_FRONT)
    // krijgt Tap een nieuwe kans z'n setResult+finish() uit te voeren.
    //
    // Flow:
    //   1. payWithMollieTap zet _mollieAutoReturnAttempted=false
    //   2. Java onResume → app.onAppResumed()
    //   3. Wacht 1.5s (geef intent result alsnog kans)
    //   4. Nog niets? → bringMollieTapToFront() + flag op true
    //   5. Wacht 3s extra
    //   6. Nog steeds niets? → Manuele Bevestig/Annuleer knoppen in spinner
    // =====================================================================
    onAppResumed() {
        // Geen actieve Mollie betaling → niets te doen
        if (!this._mollieContext) return;
        if (this._mollieHandled) return;

        // Onmiddellijk na launch (< 2s) genegeerd — we krijgen 'n onResume bij
        // onze eigen launch waarna Tap pas naar voren komt
        const sinceLaunch = Date.now() - (this._mollieLaunchedAt || 0);
        if (sinceLaunch < 2000) {
            console.log('[Mollie] onAppResumed te vroeg (' + sinceLaunch + 'ms na launch) — skip');
            return;
        }

        // v158: debounce — Java onResume + visibilitychange + focus kunnen
        // alle drie in dezelfde 100-500ms firen. We willen maar 1 immediate
        // poll per "echte" resume.
        if (this._mollieResumeInFlight) {
            console.log('[Mollie] onAppResumed al in-flight — skip duplicate');
            return;
        }
        const now = Date.now();
        if (this._mollieLastResumeAt && (now - this._mollieLastResumeAt) < 500) {
            console.log('[Mollie] onAppResumed binnen 500ms na vorige — skip duplicate');
            return;
        }
        this._mollieLastResumeAt = now;
        this._mollieResumeInFlight = true;

        // v159: bij resume triggeren we direct een snelle burst van polls
        // (0, 0.5s, 1.5s, 3s) zodat we de KV-write 100% zeker oppikken zelfs
        // als de WebView net wakker is. De continue setInterval-poll loopt
        // verder als de burst niets vindt.
        console.log('[Mollie] onAppResumed → burst poll');
        const burst = async () => {
            for (const delay of [0, 500, 1500, 3000]) {
                if (delay) await new Promise(r => setTimeout(r, delay));
                if (this._mollieHandled) return true;
                const found = await this._pollMollieStatusNow();
                if (found) return true;
            }
            return false;
        };
        burst().then(found => {
            this._mollieResumeInFlight = false;
            if (found || this._mollieHandled) return;
            console.log('[Mollie] burst klaar, geen status — start ontdooi-bounce');
            // v161: Als continue polling om wat voor reden gestopt was, herstart 'm.
            if (!this._molliePollTimer) {
                this._startMolliePolling();
            }
            // v161: WAKE-UP BOUNCE — 1× per Mollie-flow.
            // De user heeft bewezen dat manueel minimize+heropen de bevroren
            // WebView ontdooit. We simuleren dat programmatisch: korte flits
            // naar home, dan automatisch terug. Triggert volledige lifecycle.
            if (!this._mollieBounceAttempted) {
                this._mollieBounceAttempted = true;
                setTimeout(() => {
                    if (this._mollieHandled) return;
                    try {
                        if (typeof QEBridge !== 'undefined' && QEBridge.bounceTaskToWakeUp) {
                            console.log('[Mollie] → bounceTaskToWakeUp');
                            QEBridge.bounceTaskToWakeUp();
                        }
                    } catch (e) {
                        console.warn('[Mollie] bounce fout:', e && e.message);
                    }
                }, 1000);  // 1s zodat een laat-arriverende status nog vóór de bounce binnen kan komen
            }
            // Manuele fallback alleen na lange wachttijd zodat alles z'n kans krijgt.
            this._scheduleMollieManualFallback();
        }).catch(() => { this._mollieResumeInFlight = false; });
    },

    /** v157: éénmalige Worker-status-check, los van de polling-loop. Wordt
     *  gebruikt vanuit onAppResumed zodat we niet hoeven te wachten op de
     *  volgende timer-tick. Returnt true als status binnen was en
     *  onMollieTapResult is gefired. */
    async _pollMollieStatusNow() {
        const ctx = this._mollieContext;
        if (!ctx || !ctx.referenceId) return false;
        if (this._mollieHandled) return false;
        try {
            const data = await MollieAPI.fetchPaymentStatus({
                referenceId: ctx.referenceId,
                description: ctx.description,
            });
            if (this._mollieHandled) return false;
            if (data && data.found && (data.status === 'paid' || data.status === 'failed')) {
                console.log('[Mollie immediate poll] status binnen:', data.status, 'robawsMarked:', data.robawsMarked);
                this.onMollieTapResult({
                    status:             data.status,
                    paymentId:          data.paymentId || ('webhook_' + Date.now()),
                    referenceId:        data.referenceId || ctx.referenceId,
                    failureMessage:     data.failureMessage || null,
                    failureSupportCode: data.failureSupportCode || null,
                    signatureValid:     true,
                    robawsMarked:       data.robawsMarked === true,
                    robawsError:        data.robawsError || null,
                    _source:            'webhook-poll',
                });
                return true;
            }
        } catch (e) {
            console.warn('[Mollie immediate poll] fout:', e && e.message);
        }
        return false;
    },

    /** Plan de manuele bevestig/annuleer knoppen wanneer auto-return geen
     *  resultaat oplevert binnen 3 seconden. Wordt 1× geplaatst per flow. */
    _scheduleMollieManualFallback() {
        if (this._mollieManualFallbackShown) return;
        this._mollieManualFallbackShown = true;
        setTimeout(() => {
            if (this._mollieHandled) return;
            this._showMollieManualFallback();
        }, 3000);
    },

    /** Toon manuele Bevestig/Annuleer knoppen in de scan-loading overlay,
     *  voor het geval Mollie Tap nooit een result intent terugstuurt. */
    _showMollieManualFallback() {
        if (this._mollieHandled) return;
        console.log('[Mollie] manuele fallback knoppen tonen');

        const overlay = document.getElementById('scanLoading');
        const card = overlay && overlay.querySelector('.qe-scan-card');
        if (card) {
            // Update bestaande titel/melding zodat 't duidelijk is dat er iets mis is
            const title = card.querySelector('.qe-scan-title');
            if (title) { title.textContent = 'Geen antwoord van Mollie Tap'; title.classList.remove('loading'); }
            const msg = card.querySelector('.qe-scan-msg');
            if (msg) msg.textContent = 'Was de betaling gelukt?';
            const sub = card.querySelector('.qe-scan-sub');
            if (sub) sub.textContent = 'Bevestig hieronder of annuleer';
            const iconWrap = card.querySelector('.qe-scan-icon-wrap');
            if (iconWrap) iconWrap.classList.remove('loading');

            // Zoek bestaand fallback-blok om dubbele toevoeging te vermijden
            let block = card.querySelector('.mollie-manual-fallback');
            if (!block) {
                block = document.createElement('div');
                block.className = 'mollie-manual-fallback';
                block.style.cssText = 'margin-top:18px;display:flex;gap:10px;justify-content:center;width:100%';
                block.innerHTML =
                    '<button id="mollieManualOk" type="button" style="flex:1;padding:12px;background:#10b981;color:#fff;border:none;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer">✓ Ja, gelukt</button>'
                    + '<button id="mollieManualFail" type="button" style="flex:1;padding:12px;background:#ef4444;color:#fff;border:none;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer">✕ Nee, annuleren</button>';
                card.appendChild(block);
                const okBtn = block.querySelector('#mollieManualOk');
                const failBtn = block.querySelector('#mollieManualFail');
                if (okBtn) okBtn.addEventListener('click', () => this._handleMollieManualConfirm());
                if (failBtn) failBtn.addEventListener('click', () => this._handleMollieManualCancel());
            }
            return;
        }
        // Geen overlay gevonden → native fallback
        if (confirm('Mollie Tap geeft geen antwoord.\nWas de betaling gelukt?')) {
            this._handleMollieManualConfirm();
        } else {
            this._handleMollieManualCancel();
        }
    },

    /** Manuele bevestiging: behandel alsof status='paid' met enkel referenceId
     *  (we hebben geen paymentId omdat Mollie Tap nooit antwoordde). */
    _handleMollieManualConfirm() {
        if (this._mollieHandled) return;
        console.log('[Mollie] MANUELE BEVESTIGING — geen paymentId, alleen referenceId');
        // Bouw een synthetisch result dat onMollieTapResult begrijpt
        const refId = 'manual_' + Date.now();
        this.onMollieTapResult({
            status: 'paid',
            paymentId: refId,        // gebruikt voor dedup en Robaws-referentie
            referenceId: refId,
            signatureValid: true,
            _manual: true,
        });
    },

    /** Manuele annulering: toon failed-card met duidelijke uitleg. */
    _handleMollieManualCancel() {
        if (this._mollieHandled) return;
        console.log('[Mollie] MANUELE ANNULERING');
        this._mollieHandled = true;
        if (typeof this.hideScanLoading === 'function') this.hideScanLoading();
        try { localStorage.removeItem('qe_mollie_pending'); } catch(_) {}
        if (this._removePendingPayment && this._mollieContext && this._mollieContext.invoiceId) {
            this._removePendingPayment(this._mollieContext.invoiceId);
        }
        this.showPaymentFailed(
            'Geen antwoord van Mollie Tap. Controleer in Mollie dashboard of de betaling toch is doorgekomen.'
        );
    },

    // =====================================================================
    // v151: VERIFIER-OVERLAY VOLLEDIG VERWIJDERD
    // We vertrouwen 100% op de intent return van Mollie Tap (zie
    // onMollieTapResult hierboven). Geen Mollie API check meer.
    // =====================================================================

    // v146: localStorage key voor de retry-queue van mislukte Robaws-updates.
    _MOLLIE_RETRY_KEY: 'qe_mollie_retry_queue',

    /** Stuur de Robaws factuur-betaling registratie naar Robaws. Bij failure:
     *  bewaar in retry-queue + toon waarschuwing zodat admin weet dat hij
     *  handmatig moet ingrijpen. Bij success: markeer dedup zodat retry niet
     *  opnieuw probeert. */
    async _registerMolliePaymentInRobaws({ invoiceId, invoiceLogicId, amount, paymentId, referenceId, dedupKey }) {
        if (!invoiceId) {
            console.warn('[Mollie→Robaws] geen invoiceId — skip');
            return;
        }
        console.log('[Mollie→Robaws] register payment', { invoiceId, amount, paymentId });
        try {
            const res = await RobawsAPI.registerInvoicePayment({
                invoiceId,
                amount,
                paymentMethod: 'Bancontact',  // Mollie Tap = Bancontact in Robaws-terminologie
                reference: paymentId || referenceId || '',
            });
            if (res.success) {
                console.log('[Mollie→Robaws] factuur op betaald gezet (variant ' + (res.variant || '?') + ')');
                try { localStorage.setItem(dedupKey, String(Date.now())); } catch(_) {}
                setTimeout(() => this.toast('Factuur ' + (invoiceLogicId || invoiceId) + ' op betaald'), 1200);
                return;
            }
            // Niet gelukt → naar retry-queue
            console.warn('[Mollie→Robaws] Robaws weigerde:', res.error);
            this._enqueueMollieRetry({ invoiceId, invoiceLogicId, amount, paymentId, referenceId, dedupKey });
            setTimeout(() => this.toast(
                '⚠️ Factuur niet op betaald (Robaws-fout) — wordt later opnieuw geprobeerd'
            ), 1500);
        } catch (e) {
            console.warn('[Mollie→Robaws] gooi-fout:', e && e.message);
            this._enqueueMollieRetry({ invoiceId, invoiceLogicId, amount, paymentId, referenceId, dedupKey });
            setTimeout(() => this.toast(
                '⚠️ Netwerkfout — factuur wordt later opnieuw op betaald gezet'
            ), 1500);
        }
    },

    /** Voeg een mislukte Robaws-update toe aan de retry-queue (localStorage). */
    _enqueueMollieRetry(entry) {
        try {
            const raw = localStorage.getItem(this._MOLLIE_RETRY_KEY);
            const list = raw ? JSON.parse(raw) : [];
            // Voorkom duplicaten op paymentId
            if (entry.paymentId && list.some(e => e.paymentId === entry.paymentId)) return;
            entry.queuedAt = Date.now();
            entry.attempts = 0;
            list.push(entry);
            localStorage.setItem(this._MOLLIE_RETRY_KEY, JSON.stringify(list));
            console.log('[Mollie→Robaws] queued for retry — queue size:', list.length);
        } catch (e) {
            console.warn('[Mollie→Robaws] kon queue niet schrijven:', e);
        }
    },

    /** Loop de retry-queue af en probeer elke pending entry opnieuw.
     *  Wordt aangeroepen bij app-start + online-event + na elke succesvolle login. */
    async processMollieRetryQueue() {
        if (!navigator.onLine) return;
        let list;
        try {
            const raw = localStorage.getItem(this._MOLLIE_RETRY_KEY);
            list = raw ? JSON.parse(raw) : [];
        } catch (_) { return; }
        if (!list || list.length === 0) return;
        console.log('[Mollie→Robaws] retry queue size:', list.length);
        const remaining = [];
        for (const entry of list) {
            entry.attempts = (entry.attempts || 0) + 1;
            // Geef op na 10 pogingen — admin moet dan handmatig in Robaws aanpassen
            if (entry.attempts > 10) {
                console.warn('[Mollie→Robaws] entry opgegeven na 10 pogingen:', entry.paymentId);
                continue;
            }
            try {
                const res = await RobawsAPI.registerInvoicePayment({
                    invoiceId: entry.invoiceId,
                    amount: entry.amount,
                    paymentMethod: 'Bancontact',
                    reference: entry.paymentId || entry.referenceId || '',
                });
                if (res.success) {
                    console.log('[Mollie→Robaws] retry success voor', entry.paymentId);
                    if (entry.dedupKey) {
                        try { localStorage.setItem(entry.dedupKey, String(Date.now())); } catch(_) {}
                    }
                    // niet meer in queue
                    continue;
                }
                remaining.push(entry);
            } catch (e) {
                console.warn('[Mollie→Robaws] retry gooi-fout:', e && e.message);
                remaining.push(entry);
            }
        }
        try { localStorage.setItem(this._MOLLIE_RETRY_KEY, JSON.stringify(remaining)); } catch(_) {}
        if (remaining.length === 0 && list.length > 0) {
            this.toast('Alle wachtende Mollie-betalingen op betaald gezet');
        }
    },

    // Gebruiker bevestigt handmatig dat de betaling gelukt is.
    // BUG-fix (mogelijke fraude): voorheen werd de factuur direct als
    // betaald gemarkeerd zonder enige Viva-verificatie. Nu doen we eerst
    // een check via de Viva API (find-by-ref op de OGM). Alleen als Viva
    // bevestigt dat er een geslaagde transactie is, markeren we de factuur
    // als betaald. Bij twijfel vragen we de technieker om het bewijs.
    async markPaymentSuccess(invoiceId, amount, invoiceLogicId) {
        const ogm = (this._lastInvoiceForRetry && this._lastInvoiceForRetry.ogm)
            || (this._currentPaymentInvoice && this._currentPaymentInvoice.paymentInstruction)
            || '';

        // Probeer Viva-side verificatie als we een OGM hebben
        if (ogm) {
            try {
                const res = await fetch('api/payment.php?action=find-by-ref&ref=' + encodeURIComponent(ogm));
                const data = await res.json();
                if (!data || !data.found || !data.paid) {
                    const proceed = confirm(
                        'Betaling niet teruggevonden bij Viva Wallet.\n\n' +
                        'Weet je zeker dat de klant betaald heeft? Als de transactie net gebeurd is, ' +
                        'kan het even duren voor ze in het systeem staat.\n\n' +
                        'Klik OK om alsnog door te gaan, Annuleer om te wachten en later opnieuw te controleren.'
                    );
                    if (!proceed) return;
                }
            } catch(e) {
                // Geen verbinding: laat de gebruiker zelf beslissen
                const proceed = confirm(
                    'Kan Viva Wallet niet bereiken om de betaling te verifiëren.\n\n' +
                    'Doorgaan en factuur als betaald markeren?'
                );
                if (!proceed) return;
            }
        }

        if (invoiceId) {
            fetch('api/payment.php?action=mark-paid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ invoiceId }),
            }).catch(() => {});
        }
        this._removePendingPayment(invoiceId);
        this.showPaymentSuccess(amount, invoiceLogicId);
    },

    // Gebruiker bevestigt handmatig dat de betaling niet gelukt is → bewaar voor later
    markPaymentFailed(invoiceId) {
        if (!confirm('Betaling niet gelukt?\n\nDe factuur blijft bewaard in de openstaande lijst zodat je later opnieuw kan proberen.')) return;
        // Nu pas opslaan in openstaande lijst
        if (this._lastInvoiceForRetry && String(this._lastInvoiceForRetry.invoiceId) === String(invoiceId)) {
            this._savePendingPayment(this._lastInvoiceForRetry);
        }
        this.showPaymentFailed('Betaling niet voltooid');
    },

    // Handmatige controle: vraag Viva API of er een betaling is met deze OGM/clientTransactionId
    async checkPaymentByRef(ref, invoiceId, amount, invoiceLogicId) {
        const btn = document.getElementById('checkPaymentBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;border-width:2px;vertical-align:middle"></span> Controleren bij Viva...';
        }

        try {
            const res = await fetch('api/payment.php?action=find-by-ref&ref=' + encodeURIComponent(ref));
            const data = await res.json();

            if (data.found && data.paid) {
                // Factuur als betaald markeren
                if (invoiceId) {
                    fetch('api/payment.php?action=mark-paid', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ invoiceId }),
                    }).catch(() => {});
                }
                this._removePendingPayment(invoiceId);
                this.showPaymentSuccess(data.amount || amount, invoiceLogicId);
                return;
            }

            // Geen succesvolle betaling gevonden
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = 'Ik heb betaald — controleer betaling';
            }
            const reason = data.found
                ? 'Transactie gevonden maar nog niet voltooid (status: ' + (data.status || '?') + ')'
                : 'Nog geen betaling gevonden bij Viva voor referentie ' + ref;
            alert('' + reason + '\n\nProbeer over een paar seconden opnieuw, of annuleer om later te betalen.');
        } catch (e) {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = 'Ik heb betaald — controleer betaling';
            }
            alert('Fout bij controleren: ' + e.message);
        }
    },

    // Gebruiker geeft zelf aan dat de betaling is mislukt
    manualPaymentConfirm(invoiceId, amount, invoiceLogicId) {
        if (!confirm('Betaling markeren als mislukt?\n\nDe factuur blijft bewaard in de openstaande lijst. Je kan later opnieuw proberen vanuit de dagplanning.')) return;
        this.showPaymentFailed('Handmatig geannuleerd');
    },

    // v151: Card-stijl succes-overlay (consistent met v130 SUCCES/MISLUKT scan-cards).
    // Witte card op blurred backdrop, geanimeerde groene check, bedrag + factuur,
    // OK-knop om terug naar planning.
    showPaymentSuccess(amount, invoiceLogicId) {
        if (typeof this._ensureScanOverlayStyles === 'function') this._ensureScanOverlayStyles();
        const existing = document.getElementById('paymentOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'paymentOverlay';
        overlay.className = 'qe-scan-backdrop';

        const amountHtml = amount > 0
            ? `<div style="font-size:30px;font-weight:700;color:#2e7d32;margin:6px 0 2px">€ ${Number(amount).toFixed(2)}</div>`
            : '';
        const invHtml = invoiceLogicId
            ? `<div style="font-size:13px;color:#90a4ae;margin-bottom:4px">Factuur ${this._escapeHtml(invoiceLogicId)}</div>`
            : '';

        overlay.innerHTML = `
            <div class="qe-scan-card">
                <div class="qe-scan-icon-wrap success">
                    <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
                        <circle class="qe-circle-path" cx="26" cy="26" r="22" />
                        <path class="qe-check-path" d="M14 27 l8 8 l16 -16" />
                    </svg>
                </div>
                <h3 class="qe-scan-title success">Betaling gelukt</h3>
                ${amountHtml}
                ${invHtml}
                <button id="paymentOverlayOk"
                    style="margin-top:18px;width:100%;padding:13px;background:#2e7d32;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">
                    Terug naar planning
                </button>
            </div>`;
        document.body.appendChild(overlay);
        // eslint-disable-next-line no-unused-expressions
        overlay.offsetWidth;
        overlay.classList.add('qe-show');

        try { if (navigator.vibrate) navigator.vibrate(120); } catch(_) {}

        document.getElementById('paymentOverlayOk').onclick = () => {
            overlay.classList.remove('qe-show');
            overlay.classList.add('qe-hiding');
            setTimeout(() => {
                try { overlay.remove(); } catch(_) {}
                this.navigate('screenPlanning', false);
                this.screenHistory = [];
                this.loadPlanning();
            }, 200);
        };
    },

    // v151: Card-stijl fout-overlay — zelfde design-taal als success.
    showPaymentFailed(reason) {
        if (typeof this._ensureScanOverlayStyles === 'function') this._ensureScanOverlayStyles();
        const existing = document.getElementById('paymentOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'paymentOverlay';
        overlay.className = 'qe-scan-backdrop';

        overlay.innerHTML = `
            <div class="qe-scan-card">
                <div class="qe-scan-icon-wrap error">
                    <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
                        <circle class="qe-circle-path" cx="26" cy="26" r="22" />
                        <path class="qe-cross-path" d="M18 18 l16 16" />
                        <path class="qe-cross-path" d="M34 18 l-16 16" />
                    </svg>
                </div>
                <h3 class="qe-scan-title error">Betaling niet gelukt</h3>
                <p class="qe-scan-msg">${this._escapeHtml(reason || 'Onbekende fout')}</p>
                <div style="font-size:12px;color:#90a4ae;margin-top:8px">
                    De factuur is bewaard. Je kan de betaling opnieuw proberen vanuit Uitgevoerd.
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;margin-top:18px">
                    <button id="paymentRetryBtn"
                        style="width:100%;padding:13px;background:#c62828;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer">
                        ${this.icon('refresh', { size: 18, style: 'vertical-align:-3px' })} Opnieuw proberen
                    </button>
                    <button id="paymentLaterBtn"
                        style="width:100%;padding:13px;background:#fff;color:#c62828;border:2px solid #ffcdd2;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">
                        Later betalen
                    </button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        // eslint-disable-next-line no-unused-expressions
        overlay.offsetWidth;
        overlay.classList.add('qe-show');

        try { if (navigator.vibrate) navigator.vibrate([80, 60, 80]); } catch(_) {}

        const closeWithAnim = (cb) => {
            overlay.classList.remove('qe-show');
            overlay.classList.add('qe-hiding');
            setTimeout(() => { try { overlay.remove(); } catch(_) {} if (cb) cb(); }, 200);
        };
        document.getElementById('paymentRetryBtn').onclick = () => {
            closeWithAnim(() => {
                const pp = this._pendingPayment;
                if (pp && pp.invoiceId) {
                    this.startTerminalPayment(pp.invoiceId, pp.amount, pp.ogm, pp.invoiceLogicId);
                }
            });
        };
        document.getElementById('paymentLaterBtn').onclick = () => {
            closeWithAnim(() => {
                this.navigate('screenPlanning', false);
                this.screenHistory = [];
                this.loadPlanning();
            });
        };
    },

    // =============================================
    // OPENSTAANDE BETALINGEN (localStorage persist)
    // =============================================
    _loadPendingPayments() {
        try { return JSON.parse(localStorage.getItem('qe_pending_payments') || '[]'); }
        catch (e) { return []; }
    },
    _savePendingPayment(p) {
        const list = this._loadPendingPayments().filter(x => x.invoiceId !== p.invoiceId);
        list.push(p);
        try { localStorage.setItem('qe_pending_payments', JSON.stringify(list)); } catch (e) {}
    },
    _removePendingPayment(invoiceId) {
        const list = this._loadPendingPayments().filter(x => x.invoiceId !== invoiceId);
        try { localStorage.setItem('qe_pending_payments', JSON.stringify(list)); } catch (e) {}
    },
    _saveSubmittedWOs() {
        try { localStorage.setItem('qe_submitted_wos', JSON.stringify(this.submittedWOs || [])); } catch (e) {}
    },
    _loadSubmittedWOs() {
        // Lijst wordt NIET meer gebruikt om dagplanningen te verbergen
        // (dat doet Robaws via hasWerkbon), maar WEL om dubbele werkbonnen/
        // facturen te voorkomen binnen dezelfde sessie.
        // Na herstart begint de lijst leeg — Robaws is dan de bron van waarheid.
        this.submittedWOs = [];
    },

    // Opnieuw proberen te betalen voor een openstaande factuur
    retryPendingPayment(invoiceId) {
        const pp = this._loadPendingPayments().find(p => String(p.invoiceId) === String(invoiceId));
        if (!pp) { this.toast('Factuur niet gevonden'); return; }
        // Open betaalscherm met dezelfde factuur
        const invoiceResult = {
            invoice: {
                id: pp.invoiceId,
                logicId: pp.logicId,
                totalInclVat: pp.totalInclVat,
                paymentInstruction: pp.paymentInstruction,
                formattedOgm: pp.formattedOgm,
                date: pp.date,
            },
            workOrder: { id: pp.workOrderId, logicId: pp.logicId },
        };
        this.showPaymentScreen(invoiceResult);
    },

    // Banner boven de planning met openstaande facturen
    renderPendingPaymentsBanner() {
        const container = document.getElementById('pendingPaymentsBanner');
        if (!container) return;
        const list = this._loadPendingPayments();
        if (!list.length) { container.innerHTML = ''; return; }
        container.innerHTML = `
            <div style="background:#fff3e0;border:1px solid #ffb74d;border-radius:12px;padding:12px;margin:0 0 12px 0">
                <div style="font-size:13px;font-weight:600;color:#e65100;margin-bottom:8px">
                    ⚠️ ${list.length} openstaande betaling${list.length === 1 ? '' : 'en'}
                </div>
                ${list.map(p => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:#fff;border-radius:8px;margin-top:6px">
                        <div style="flex:1;min-width:0">
                            <div style="font-size:14px;font-weight:500;color:var(--qe-darkblue);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.escapeHtml(p.clientName || 'Klant')}</div>
                            <div style="font-size:12px;color:var(--qe-grey)">Factuur ${this.escapeHtml(p.logicId || '')} — € ${Number(p.totalInclVat || 0).toFixed(2)}</div>
                        </div>
                        <button onclick="app.retryPendingPayment('${p.invoiceId}')"
                            style="background:var(--qe-orange);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer">
                            ${this.icon('card', { size: 16, style: 'vertical-align:-3px' })} Betalen
                        </button>
                    </div>
                `).join('')}
            </div>
        `;
    },

    async startQRPayment(invoiceId, amount, ogm, invoiceLogicId) {
        const statusDiv = document.getElementById('paymentStatus');
        statusDiv.innerHTML = '<div class="spinner" style="margin:8px auto"></div><div style="font-size:13px;color:var(--qe-grey);margin-top:8px">Betaallink aanmaken...</div>';

        try {
            const orderRes = await fetch('api/payment.php?action=create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount,
                    description: `Factuur ${invoiceLogicId}`,
                    ogm,
                    invoiceId,
                }),
            });
            const orderData = await orderRes.json();

            if (!orderData.success) {
                statusDiv.innerHTML = `<div style="color:#e53935;padding:12px;background:#ffebee;border-radius:8px">
                    ${orderData.error || 'Betaallink aanmaken mislukt'}<br>
                    <small>${orderData.hint || 'Controleer de Viva Wallet configuratie'}</small>
                </div>`;
                return;
            }

            // Toon QR-code + betaallink
            statusDiv.innerHTML = `
                <div style="background:#fff;border-radius:12px;padding:20px;border:1px solid #e0e0e0;text-align:center">
                    <div style="font-size:14px;font-weight:600;color:var(--qe-darkblue);margin-bottom:12px">Scan om te betalen</div>
                    <div style="background:#fff;padding:12px;display:inline-block;border-radius:8px;border:1px solid #eee">
                        <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(orderData.checkoutUrl)}"
                            alt="QR Code" style="width:200px;height:200px">
                    </div>
                    <div style="margin-top:12px">
                        <a href="${orderData.checkoutUrl}" target="_blank"
                            style="color:var(--qe-purple);font-size:14px;font-weight:500;text-decoration:underline">
                            Of open betaallink
                        </a>
                    </div>
                    <div style="font-size:11px;color:var(--qe-grey);margin-top:8px">
                        <div class="spinner" style="margin:8px auto;width:20px;height:20px;border-width:2px"></div>
                        Wacht op betaling...
                    </div>
                </div>
            `;

            // Start polling
            this.pollPaymentStatus(orderData.orderCode, invoiceId);
        } catch (e) {
            statusDiv.innerHTML = `<div style="color:#e53935;padding:12px;background:#ffebee;border-radius:8px">Fout: ${e.message}</div>`;
        }
    },

    async pollPaymentStatus(orderCode, invoiceId) {
        const statusDiv = document.getElementById('paymentStatus');
        let attempts = 0;
        const maxAttempts = 60; // 5 minuten (elke 5 seconden)

        const check = async () => {
            attempts++;
            try {
                const res = await fetch(`api/payment.php?action=check-status&orderCode=${orderCode}`);
                const data = await res.json();

                if (data.paid) {
                    // Betaling gelukt!
                    statusDiv.innerHTML = `
                        <div style="background:#e8f5e9;border-radius:12px;padding:24px;text-align:center">
                            <div style="margin-bottom:8px;color:var(--qe-green)">${this.icon('check-circle', { size: 44 })}</div>
                            <div style="font-size:20px;font-weight:700;color:#2e7d32">Betaling ontvangen!</div>
                            <div style="font-size:13px;color:#558b2f;margin-top:4px">Factuur wordt als betaald gemarkeerd...</div>
                        </div>
                    `;

                    // Markeer factuur als betaald in Robaws
                    try {
                        await fetch('api/payment.php?action=mark-paid', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ invoiceId }),
                        });
                    } catch (e) { /* niet fataal */ }

                    // Terug naar planning na 3 seconden
                    setTimeout(() => {
                        this.navigate('screenPlanning', false);
                        this.screenHistory = [];
                    }, 3000);
                    return;
                }

                if (data.status === 'expired' || data.status === 'canceled') {
                    statusDiv.innerHTML += `<div style="color:#e53935;font-size:13px;margin-top:8px">
                        Betaling ${data.status === 'expired' ? 'verlopen' : 'geannuleerd'}
                    </div>`;
                    return;
                }

                if (attempts < maxAttempts) {
                    setTimeout(check, 5000);
                } else {
                    statusDiv.innerHTML += `<div style="color:var(--qe-grey);font-size:12px;margin-top:8px">Timeout — controleer de betaling handmatig</div>`;
                }
            } catch (e) {
                if (attempts < maxAttempts) setTimeout(check, 5000);
            }
        };

        setTimeout(check, 5000);
    },

    skipPayment() {
        this.toast('Factuur aangemaakt — betaling overgeslagen');
        this.navigate('screenPlanning', false);
        this.screenHistory = [];
        this.loadPlanning();
    },

    // ========================================
    // INSTALLATIE HISTORIEK
    // ========================================
    async openInstallationHistory(installationId) {
        // v176: bewaar ID zodat refreshCurrentScreen() deze opnieuw kan laden.
        this._lastInstHistoryId = installationId;
        // Zoek installatie-info uit geladen data
        const inst = (this._loadedInstallations || []).find(i => String(i.id) === String(installationId));
        const instName = inst ? (inst.name || inst.brand || 'Installatie') : 'Installatie';

        document.getElementById('instHistoryTitle').textContent = instName;

        // Toon installatie-info bovenaan
        if (inst) {
            document.getElementById('instHistoryInfo').innerHTML = `
                <div class="card" style="margin-bottom:8px">
                    <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--qe-grey)">
                        ${inst.brand ? `<span>${this.icon('home', { size: 13, style: 'vertical-align:-2px' })} ${this.escapeHtml(inst.brand)}</span>` : ''}
                        ${inst.model ? `<span>${this.icon('clipboard', { size: 13, style: 'vertical-align:-2px' })} ${this.escapeHtml(inst.model)}</span>` : ''}
                        ${inst.serialNumber ? `<span># ${this.escapeHtml(inst.serialNumber)}</span>` : ''}
                        ${inst.bouwjaar ? `<span>${this.icon('calendar', { size: 13, style: 'vertical-align:-2px' })} ${this.escapeHtml(String(inst.bouwjaar))}</span>` : ''}
                    </div>
                </div>`;
        }

        const list = document.getElementById('instHistoryList');
        list.innerHTML = '<div class="spinner"></div>';

        this.navigate('screenInstHistory');

        try {
            // v168: directe Robaws API ipv PHP-backend.
            // 1) Resolve klant-ID via installatie (kan al gecached zijn)
            let assignedClientId = inst && inst.assignedClientId;
            if (!assignedClientId) {
                const instRes = await RobawsAPI.get(`installations/${installationId}`);
                if (instRes.code === 200 && instRes.data) {
                    assignedClientId = instRes.data.assignedClientId;
                }
            }
            if (!assignedClientId) {
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">⚠️</div>
                        <h3>Klant niet gevonden</h3>
                        <p>Deze installatie heeft geen gekoppelde klant.</p>
                    </div>`;
                return;
            }

            // 2) Paginate work-orders voor deze klant (sort=date:desc, include=timeEntries
            //    om N+1 calls te vermijden — zie ROBAWS_API_HANDLEIDING §2.16).
            //    Filter client-side op installationIds.
            const installationIdStr = String(installationId);
            const matchingOrders = [];
            const seenIds = new Set();   // dedup voor §2.17 paginated-werkbon-sort issue
            let offset = 0;
            const MAX_PAGES = 30;        // veiligheid voor klanten met heel veel werkbons
            for (let page = 0; page < MAX_PAGES; page++) {
                const r = await RobawsAPI.get(
                    `work-orders?clientId=${assignedClientId}&limit=100&offset=${offset}&sort=date:desc&include=timeEntries`
                );
                if (r.code !== 200 || !r.data || !r.data.items) break;
                const items = r.data.items;
                if (items.length === 0) break;
                for (const wo of items) {
                    if (seenIds.has(wo.id)) continue;
                    seenIds.add(wo.id);
                    const ids = (wo.installationIds || []).map(String);
                    if (ids.includes(installationIdStr)) {
                        matchingOrders.push(wo);
                    }
                }
                if (items.length < 100) break;
                offset += 100;
            }

            if (matchingOrders.length === 0) {
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">📋</div>
                        <h3>Geen historiek</h3>
                        <p>Geen werkbons gevonden voor deze installatie.</p>
                    </div>`;
                return;
            }

            // 3) Sorteer nogmaals (Robaws' date:desc is niet altijd consistent over pagina's, §2.17)
            matchingOrders.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

            // 4) Render
            const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
            const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

            list.innerHTML = matchingOrders.map(wo => {
                const d = wo.date ? new Date(wo.date + 'T12:00:00') : null;
                const dateLabel = d ? `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}` : 'Onbekend';

                // Status-label naar Robaws's eigen vocabularium
                // Zie ROBAWS_API_HANDLEIDING §6.4 voor mogelijke waarden
                const status = wo.status || 'Onbekend';
                let statusClass = 'type-diversen';
                if (/betaald/i.test(status)) statusClass = 'type-onderhoud';
                else if (/peppol|verzonden|gecontroleerd/i.test(status)) statusClass = 'type-plaatsing';

                // Time-entries via ?include (geen N+1)
                const timeCount = (wo.timeEntries || []).length;
                const summary = wo.title || (wo.extraFields && wo.extraFields.Reden && wo.extraFields.Reden.stringValue) || '';

                return `
                    <div class="card card-clickable" onclick="app.openOrderDetail('${wo.id}')" style="margin:0 16px 8px;cursor:pointer">
                        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">
                            <div>
                                <div style="font-size:15px;font-weight:500">${this.escapeHtml(wo.logicId || `#${wo.id}`)}</div>
                                <div style="font-size:12px;color:var(--qe-grey);margin-top:2px">${this.icon('calendar', { size: 13, style: 'vertical-align:-2px' })} ${dateLabel}</div>
                            </div>
                            <span class="wo-type ${statusClass}" style="font-size:11px">${this.escapeHtml(status)}</span>
                        </div>
                        ${summary ? `<div style="font-size:13px;color:var(--qe-grey);margin-top:4px">${this.escapeHtml(summary)}</div>` : ''}
                        ${timeCount > 0 ? `
                        <div style="font-size:12px;color:var(--qe-grey);margin-top:6px">
                            <span>${this.icon('clock', { size: 13, style: 'vertical-align:-2px' })} ${timeCount} ${timeCount === 1 ? 'tijdsregistratie' : 'tijdsregistraties'}</span>
                        </div>` : ''}
                    </div>`;
            }).join('');

        } catch (err) {
            console.warn('[InstHistory] fout:', err);
            list.innerHTML = `<p class="text-grey text-sm text-center" style="padding:16px">Kon historiek niet laden: ${this.escapeHtml(err.message || '')}</p>`;
        }
    },

    async openOrderDetail(workOrderId) {
        const content = document.getElementById('orderDetailContent');
        content.innerHTML = '<div class="spinner"></div>';
        // v176: bewaar ID zodat refreshCurrentScreen() deze opnieuw kan laden.
        this._lastOrderDetailId = workOrderId;

        this.navigate('screenOrderDetail');

        try {
            // v168: directe Robaws calls ipv PHP backend.
            // Parallel 2 calls: work-order (met timeEntries + client inline) + line-items.
            // v173: include=client toegevoegd zodat de fallback clients/{id} call
            // (zie regel ~7522) vrijwel altijd kan worden overgeslagen.
            // Robaws spec bevestigt: "client only present if requested via include".
            const [woRes, lineRes] = await Promise.all([
                RobawsAPI.get(`work-orders/${workOrderId}?include=timeEntries,client`),
                RobawsAPI.get(`work-orders/${workOrderId}/line-items?limit=100`),
            ]);

            if (woRes.code !== 200 || !woRes.data) {
                content.innerHTML = `<p class="text-grey text-sm text-center" style="padding:16px">Werkbon niet gevonden</p>`;
                return;
            }

            const woRaw = woRes.data;

            // Strip "- id" suffix (zie ROBAWS_API_HANDLEIDING §3.3).
            // Robaws levert client.name als "Naam - 12345" terug — overal stripppen.
            const stripClientSuffix = (raw, id) => {
                if (!raw || !id) return raw || '';
                const suffix = ` - ${id}`;
                return raw.endsWith(suffix) ? raw.slice(0, -suffix.length) : raw;
            };

            // v173: client komt nu inline mee via ?include=client (zie call hierboven),
            // dus de fallback clients/{id} call is in ~99% gevallen niet meer nodig.
            let clientName = '';
            if (woRaw.client && woRaw.client.name) {
                clientName = stripClientSuffix(woRaw.client.name, woRaw.client.id);
            } else if (woRaw.clientId) {
                // Fallback: alleen als include=client onverwacht niets opleverde.
                try {
                    const cRes = await RobawsAPI.get(`clients/${woRaw.clientId}`);
                    if (cRes.code === 200 && cRes.data) {
                        clientName = stripClientSuffix(cRes.data.name, cRes.data.id);
                    }
                } catch(_) {}
            }

            // Mappen naar dezelfde shape als de oude PHP-response
            const wo = {
                id:         woRaw.id,
                logicId:    woRaw.logicId,
                date:       woRaw.date,
                status:     woRaw.status,
                clientName: clientName,
                summary:    woRaw.title || '',
                notes:      woRaw.remark || '',
                hours:      (woRaw.timeEntries || []).map(te => ({
                    hourTypeName: (te.hourType && te.hourType.name) || te.hourTypeId || 'Uren',
                    employeeName: (te.employee && te.employee.name) || null,
                    amount:       te.hours || te.billableHours || 0,
                })),
                materials:  ((lineRes.code === 200 && lineRes.data && lineRes.data.items) || []).map(li => ({
                    articleName: (li.article && li.article.name) || li.description || 'Artikel',
                    amount:      li.quantity || 0,
                })),
            };

            const d = wo.date ? new Date(wo.date + 'T12:00:00') : null;
            const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
            const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
            const dateLabel = d ? `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}` : '';

            document.getElementById('orderDetailTitle').textContent = wo.logicId || `Order #${workOrderId}`;

            let html = `
                <div style="padding:0 16px">
                    <div class="card">
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:90px;font-size:13px">Order nr.</span>
                            <span style="font-size:13px;font-weight:500">${this.escapeHtml(wo.logicId || '-')}</span>
                        </div>
                        ${dateLabel ? `
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:90px;font-size:13px">Datum</span>
                            <span style="font-size:13px">${dateLabel}</span>
                        </div>` : ''}
                        ${wo.clientName ? `
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:90px;font-size:13px">Klant</span>
                            <span style="font-size:13px">${this.escapeHtml(wo.clientName)}</span>
                        </div>` : ''}
                        ${wo.status ? `
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:90px;font-size:13px">Status</span>
                            <span style="font-size:13px">${this.escapeHtml(wo.status)}</span>
                        </div>` : ''}
                        ${wo.summary ? `
                        <div class="info-row" style="padding:4px 0">
                            <span class="info-label" style="min-width:90px;font-size:13px">Omschrijving</span>
                            <span style="font-size:13px">${this.escapeHtml(wo.summary)}</span>
                        </div>` : ''}
                    </div>`;

            // Uren
            if (wo.hours && wo.hours.length > 0) {
                html += `<h3 style="margin:16px 0 8px;font-size:15px">Uren</h3>`;
                wo.hours.forEach(h => {
                    html += `
                        <div class="card" style="margin-bottom:6px;padding:10px 12px">
                            <div style="display:flex;justify-content:space-between;align-items:center">
                                <div>
                                    <div style="font-size:13px;font-weight:500">${this.escapeHtml(h.hourTypeName || 'Uren')}</div>
                                    ${h.employeeName ? `<div style="font-size:12px;color:var(--qe-grey)">${this.escapeHtml(h.employeeName)}</div>` : ''}
                                </div>
                                <div style="font-size:14px;font-weight:600;color:var(--qe-purple)">${h.amount || 0}u</div>
                            </div>
                        </div>`;
                });
            }

            // Materialen
            if (wo.materials && wo.materials.length > 0) {
                html += `<h3 style="margin:16px 0 8px;font-size:15px">Materialen</h3>`;
                wo.materials.forEach(m => {
                    html += `
                        <div class="card" style="margin-bottom:6px;padding:10px 12px">
                            <div style="display:flex;justify-content:space-between;align-items:center">
                                <div style="font-size:13px;font-weight:500">${this.escapeHtml(m.articleName || 'Materiaal')}</div>
                                <div style="font-size:13px;color:var(--qe-grey)">${m.amount || 0}x</div>
                            </div>
                        </div>`;
                });
            }

            // Notities
            if (wo.notes) {
                html += `
                    <h3 style="margin:16px 0 8px;font-size:15px">Opmerkingen</h3>
                    <div class="card">
                        <div style="font-size:13px;white-space:pre-wrap">${this.escapeHtml(wo.notes)}</div>
                    </div>`;
            }

            html += '</div>';
            content.innerHTML = html;

        } catch (err) {
            content.innerHTML = '<p class="text-grey text-sm text-center" style="padding:16px">Kon order detail niet laden</p>';
        }
    },

    // ========================================
    // DAGOVERZICHT
    // ========================================
    // v179: monthOffset 0 = huidige maand, -1 = vorige maand, enz. Zonder
    // argument wordt de laatst bekeken maand behouden (refresh-knop +
    // pull-to-refresh verversen dus de bekeken maand i.p.v. terug te springen).
    async loadDagoverzicht(monthOffset) {
        if (typeof monthOffset === 'number') this._dagoverzichtMonthOffset = monthOffset;
        const offset = this._dagoverzichtMonthOffset || 0;

        const container = document.getElementById('dagoverzichtContent');
        container.innerHTML = '<div class="spinner"></div>';

        const user = RobawsAPI.getLoggedInUser();
        if (!user) {
            container.innerHTML = '<p class="text-grey text-sm text-center">Log eerst in</p>';
            return;
        }

        try {
            // v58: Tijdsregistratie-werkbonnen i.p.v. time-registrations
            const today = new Date();
            today.setHours(12, 0, 0, 0);
            // v179: doelmaand = huidige maand + offset (offset <= 0).
            const target = new Date(today.getFullYear(), today.getMonth() + offset, 1, 12, 0, 0);
            const isCurrentMonth = (offset === 0);
            const yyyy = target.getFullYear();
            const mm = String(target.getMonth() + 1).padStart(2, '0');
            const monthPrefix = `${yyyy}-${mm}`;
            const monthNames = ['januari','februari','maart','april','mei','juni',
                'juli','augustus','september','oktober','november','december'];
            const monthLabel = `${monthNames[target.getMonth()].toUpperCase()} ${yyyy}`;

            const userId = user.robawsUserId || user.userId;
            const workOrders = await RobawsAPI.getMyTimeRegistrationWorkOrders(userId, monthPrefix);

            // Helper: extra-veld waarde uit werkbon
            const getField = (wo, fieldName) => {
                const ef = wo.extraFields || {};
                return RobawsAPI._extractFieldVal(ef[fieldName]);
            };

            // Groepeer per datum (1 werkbon = 1 dag in dit nieuwe model)
            const byDate = {};
            for (const wo of workOrders) {
                const date = (wo.date || '').substring(0, 10);
                if (!date) continue;
                if (!byDate[date]) byDate[date] = [];
                byDate[date].push(wo);
            }

            // Totalen berekenen — uren komen uit time-entries op de werkbon
            // (we lazy-loaden per dag bij rendering om N+1 te beperken)
            const totalDays = Object.keys(byDate).length;
            let lateCount = 0;
            for (const wo of workOrders) {
                if (getField(wo, 'Tijd') === 'Te laat') lateCount++;
            }

            // v68: gepresteerde uren = (entry_eind − entry_start) − pauze.
            // entry_start = max(Ingeklokt, startuur werknemer) afgerond op 5min als te laat.
            // entry_eind = Uitgeklokt afgerond op 5min. Pauze = werknemer-veld.
            // v76: fetch time-entries per werkbon (max 31 dagen × ~1 werkbon = haalbaar
            // binnen rate-limit). Resultaat cached in teByWoId. Toont L&L cycli + uren.
            // v173: parallelliseren met Promise.all i.p.v. sequentiële await-loop.
            // Voorheen: 30 werkbonnen × ~250ms = 7-8 sec blokkerend. Nu: ~500ms parallel.
            // v178: time-entries komen nu INLINE mee via ?include=timeEntries in
            // getMyTimeRegistrationWorkOrders (zie HANDLEIDING 2.16). Geen aparte
            // GET /work-orders/{id}/time-entries per werkbon meer (was N+1 -> bij
            // ~30 werkbonnen 30 extra calls). teByWoId behoudt dezelfde shape.
            const teByWoId = {};
            for (const wo of workOrders) {
                teByWoId[wo.id] = wo.timeEntries || [];
            }
            const m = (s) => { const x = String(s||'').match(/^(\d{1,2}):(\d{1,2})/); return x ? (+x[1])*60 + (+x[2]) : 0; };
            // v74: kwartier-afronding (in=up, uit=down)
            // v94+: TOLERANTIE van 4 minuten — moet identiek zijn aan clock.js zodat
            // de getoonde uren overeenkomen met wat naar Robaws gestuurd wordt.
            const TOLERANCE = 4;
            const roundUp15 = (mins) => {
                const rem = mins % 15;
                if (rem > 0 && rem <= TOLERANCE) return mins - rem;
                return Math.ceil(mins / 15) * 15;
            };
            const roundDown15 = (mins) => {
                const rem = mins % 15;
                const distUpper = (15 - rem) % 15;
                if (distUpper > 0 && distUpper <= TOLERANCE) return mins + distUpper;
                return Math.floor(mins / 15) * 15;
            };
            // v178: employee startuur/pauze-fetch VERWIJDERD (scheelt 1 API-call
            // per keer dat de Uren-tab opent). Deze waarden voedden enkel
            // computeHours() -- de legacy v68 uren-berekening die sinds v83 niet
            // meer wordt aangeroepen (de totalen komen nu rechtstreeks uit de
            // time-entries hieronder). De twee defaults blijven staan zodat de
            // (dode) computeHours nog geldig refereert; mag in een latere
            // cosmetische pass volledig weg.
            let userStartuurMin = 7 * 60;  // default (enkel nog door dode computeHours)
            let userPauze = 60;

            const computeHours = (wo) => {
                const ef = wo.extraFields || {};
                const inS = ef.Ingeklokt && ef.Ingeklokt.stringValue;
                const outS = ef.Uitgeklokt && ef.Uitgeklokt.stringValue;
                if (!inS || !outS) return 0;

                // v74: kwartier-afronding. In = round UP 15min. Uit = round DOWN 15min.
                // Bureau scan \u2192 cap met startuur (Math.max). Camionet \u2192 g\u00e9\u00e9n cap.
                // v95 tolerance al toegepast op roundUp15/roundDown15.
                let totalMins = 0;
                const lines = String(wo.remark || '').split(/\r?\n/);
                const cycles = [];
                let pendingIn = null;
                let pendingInIsBureau = false;
                for (const line of lines) {
                    // Detecteer tag-type uit remark \u2014 "klok-in: bureau" of "klok-in: camionetX"
                    const inM = line.match(/klok-in:\s*([^\u2014\-]+?)\s[\u2014\-]\s(\d{1,2}:\d{2})\s*$/i);
                    const outM = line.match(/klok-uit:.*?\s\u2014\s(\d{1,2}:\d{2})\s*$/i);
                    if (inM) {
                        pendingIn = m(inM[2]);
                        pendingInIsBureau = /bureau/i.test(inM[1] || '');
                    } else if (outM && pendingIn !== null) {
                        cycles.push([pendingIn, m(outM[1]), pendingInIsBureau]);
                        pendingIn = null; pendingInIsBureau = false;
                    }
                }
                if (cycles.length > 0) {
                    for (let i = 0; i < cycles.length; i++) {
                        let [s, e, isBureau] = cycles[i];
                        // Bureau: cap met startuur. Camionet/L&L: geen cap.
                        const sMin = isBureau
                            ? Math.max(roundUp15(s), userStartuurMin)
                            : roundUp15(s);
                        const eMin = roundDown15(e);
                        if (eMin > sMin) totalMins += (eMin - sMin);
                    }
                    totalMins -= userPauze;
                } else {
                    // Fallback voor oudere werkbonnen (zonder klok-in/-uit regels)
                    // \u2014 neem aan dat het Bureau is (cap met startuur)
                    const inMin = m(inS);
                    const outMin = roundDown15(m(outS));
                    const startMin = Math.max(roundUp15(inMin), userStartuurMin);
                    totalMins = outMin - startMin - userPauze;
                }
                if (totalMins <= 0) return 0;
                // v69: ceil naar 0.5 (billableHours-stijl) voor consistency met aanpassing-scherm.
                const rawHours = totalMins / 60;
                return Math.ceil(rawHours * 2) / 2;
            };
            // v83: Bereken totalen op basis van TIME-ENTRIES (werkuren vs overuren split via hourTypeId).
            //   - Totaal = som van alle entries (incl. negatieve compensatie-entries)
            //   - Werkuren = som hourTypeId=1 entries
            //   - Overuren = som hourTypeId=2 entries (incl. negatieve compensatie-entries)
            const HT_WERKUREN = String(RobawsAPI.HOUR_TYPE_IDS.werkuren);
            const HT_OVERUREN = String(RobawsAPI.HOUR_TYPE_IDS.overuren);
            // v180: een entry telt als OVERUREN als z'n hourType-NAAM "overuren"
            // bevat (dekt ook "Overuren zaterdag/zondag"). Voorheen werd enkel
            // id===2 herkend, waardoor weekend-overuren in de werkuren-bak vielen
            // (werkuren te hoog, overuren te laag). Fallback op id===2 als de naam
            // onbekend is (bv. hour-types call faalde) -> geen regressie.
            const htNameMap = await RobawsAPI.getHourTypeNameMap();
            const isOverurenHt = (ht) => {
                const n = (htNameMap[String(ht)] || '').toLowerCase();
                if (n) return n.includes('overuren');
                return String(ht) === HT_OVERUREN;
            };
            let totalHours = 0;
            let werkurenTotal = 0;
            let overurenTotal = 0;
            for (const wo of workOrders) {
                // v197: afwezigheid (Ziek/Verlof/Feestdag/Inhaal/Sociaal verlof) telt
                // NIET mee in de uren-totalen — geen forfaitaire 8u meer.
                if (this._isAbsenceTijd(getField(wo, 'Tijd') || 'Op tijd')) continue;
                const teList = teByWoId[wo.id] || [];
                for (const te of teList) {
                    const h = parseFloat(te.hours || te.billableHours || 0) || 0;
                    totalHours += h;
                    const ht = String(te.hourTypeId || (te.hourType && te.hourType.id) || '');
                    if (isOverurenHt(ht)) overurenTotal += h;
                    else werkurenTotal += h;
                }
            }
            // v87: 2 decimalen voor uren-stats (zoals Robaws ze toont)
            const fmt1 = (n) => (Math.round(n * 100) / 100).toFixed(2);
            const fmt2 = fmt1; // alias

            let html = '';

            // v179: maand-navigatie. "Volgende" is uitgeschakeld op de huidige
            // maand (geen toekomst). Knoppen herladen met de nieuwe offset.
            html += `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px">
                    <button class="btn btn-outline btn-sm" onclick="app.loadDagoverzicht(${offset - 1})" style="font-size:13px;padding:6px 12px">◀ Vorige maand</button>
                    <span style="font-size:13px;font-weight:600;color:var(--qe-darkblue);flex:1;text-align:center">${monthLabel}</span>
                    <button class="btn btn-outline btn-sm" onclick="app.loadDagoverzicht(${offset + 1})" ${isCurrentMonth ? 'disabled' : ''} style="font-size:13px;padding:6px 12px;${isCurrentMonth ? 'opacity:0.4;pointer-events:none' : ''}">Volgende ▶</button>
                </div>`;

            // Samenvatting kaart — v83: Totaal, Werkuren, Overuren, Werkdagen, Te laat
            html += `
                <div class="card" style="margin-bottom:16px;padding:20px;background:var(--qe-darkblue);color:#fff;border-radius:16px;border:none">
                    <div style="font-size:13px;opacity:0.8;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">${monthLabel}</div>
                    <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:8px">
                        <div>
                            <div style="font-size:20px;font-weight:700"><span class="qe-countup" data-count="${totalHours}" data-dec="2">${fmt2(totalHours)}</span></div>
                            <div style="font-size:10px;opacity:0.8">Totaal</div>
                        </div>
                        <div>
                            <div style="font-size:20px;font-weight:700"><span class="qe-countup" data-count="${werkurenTotal}" data-dec="2">${fmt2(werkurenTotal)}</span></div>
                            <div style="font-size:10px;opacity:0.8">Werkuren</div>
                        </div>
                        <div>
                            <div style="font-size:20px;font-weight:700"><span class="qe-countup" data-count="${overurenTotal}" data-dec="2">${fmt2(overurenTotal)}</span></div>
                            <div style="font-size:10px;opacity:0.8">Overuren</div>
                        </div>
                        <div>
                            <div style="font-size:20px;font-weight:700"><span class="qe-countup" data-count="${totalDays}" data-dec="0">${totalDays}</span></div>
                            <div style="font-size:10px;opacity:0.8">Werkdagen</div>
                        </div>
                        <div>
                            <div style="font-size:20px;font-weight:700"><span class="qe-countup" data-count="${lateCount}" data-dec="0">${lateCount}</span></div>
                            <div style="font-size:10px;opacity:0.8">Te laat</div>
                        </div>
                    </div>
                </div>`;

            // Per dag: huidige maand t/m vandaag; een vorige maand = volledige
            // maand (laatste dag t/m de 1e). v179.
            const days = ['Zo','Ma','Di','Wo','Do','Vr','Za'];
            const allDates = [];
            const lastDay = isCurrentMonth
                ? today.getDate()
                : new Date(yyyy, target.getMonth() + 1, 0).getDate();
            for (let day = lastDay; day >= 1; day--) {
                const d = new Date(yyyy, target.getMonth(), day, 12, 0, 0);
                const ddStr = String(d.getDate()).padStart(2, '0');
                allDates.push(`${yyyy}-${mm}-${ddStr}`);
            }

            for (const date of allDates) {
                const wos = byDate[date] || [];
                const d = new Date(date + 'T12:00:00');
                const dayName = days[d.getDay()];
                const dateStr = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                if (wos.length > 0) {
                    // v83: dag-totaal = som van alle time-entries (incl. negatieve compensatie)
                    let dayTotal = 0;
                    for (const wo of wos) {
                        if (this._isAbsenceTijd(getField(wo, 'Tijd') || 'Op tijd')) continue;  // v197: afwezigheid = 0u
                        const teList = teByWoId[wo.id] || [];
                        for (const te of teList) {
                            dayTotal += parseFloat(te.hours || te.billableHours || 0) || 0;
                        }
                    }
                    html += `<div style="margin-bottom:4px;padding:8px 4px 4px;display:flex;align-items:center;justify-content:space-between">
                        <div style="font-size:13px;font-weight:600;color:var(--qe-darkblue)">${dayName} ${dateStr}</div>
                        <div style="font-size:12px;color:var(--qe-grey)">${fmt1(dayTotal)} uur</div>
                    </div>`;

                    // v83: per werkbon — render individuele tijdsblokken (1 kaart per time-entry)
                    //   Werkuren (hourTypeId=1, article 185)  → ✅ groen, klant-werk
                    //   L&L (article 19786)                   → 📦 oranje box
                    //   Overuren (hourTypeId=2, article 185)  → ⏰ oranje
                    //   Compensatie (negatieve uren)          → ↩️ grijs/cursief
                    const llArtId = String(RobawsAPI.WERKUUR_ARTICLE_IDS.ladenLossen);

                    for (const wo of wos) {
                        const tijd = getField(wo, 'Tijd') || 'Op tijd';
                        const tijdStyle = this._getTijdStyle(tijd);
                        const tijdColor = tijdStyle.color;
                        const tijdIcon  = tijdStyle.icon;
                        const isAbsence = this._isAbsenceTijd(tijd);
                        // v197: afwezigheid → toon enkel het type, géén (forfaitaire) uren
                        if (isAbsence) {
                            html += `<div class="card" style="padding:10px 14px;margin-bottom:6px;background:${tijdStyle.bg}">
                                <div style="display:flex;align-items:center;gap:10px">
                                    <span style="font-size:18px;color:${tijdColor};display:inline-flex;align-items:center">${tijdIcon || this.icon('calendar', { size: 18 })}</span>
                                    <div style="flex:1">
                                        <div style="font-size:14px;font-weight:500;color:${tijdColor}">${tijdStyle.label}</div>
                                        <div style="font-size:11px;color:${tijdColor}">Geen uren gerekend</div>
                                    </div>
                                </div>
                            </div>`;
                            continue;
                        }
                        const teList = (teByWoId[wo.id] || []).slice().sort((a, b) => {
                            // Sort: entries met startTime eerst (chronologisch), dan no-time entries
                            const aMin = a.startTime ? (a.startTime.hour * 60 + a.startTime.minute) : 9999;
                            const bMin = b.startTime ? (b.startTime.hour * 60 + b.startTime.minute) : 9999;
                            return aMin - bMin;
                        });

                        if (teList.length === 0) {
                            // Open werkbon zonder entries (nog niet uitgeklokt)
                            const ingeklokt = getField(wo, 'Ingeklokt') || '?';
                            html += `<div class="card" style="padding:12px 14px;margin-bottom:6px;background:#f1f8e9;cursor:pointer" onclick="app.openAanpassing('${wo.id}')">
                                <div style="display:flex;align-items:center;gap:10px">
                                    <span style="font-size:18px;color:${tijdColor};display:inline-flex">${this.icon('clock', { size: 18 })}</span>
                                    <div style="flex:1">
                                        <div style="font-size:14px;font-weight:500">${ingeklokt} → ...</div>
                                        <div style="font-size:11px;color:${tijdColor}">${tijdIcon} ${tijd} — nog ingeklokt</div>
                                    </div>
                                </div>
                            </div>`;
                            continue;
                        }

                        for (const te of teList) {
                            const aId = String(te.articleId || (te.article && te.article.id) || '');
                            const ht = String(te.hourTypeId || (te.hourType && te.hourType.id) || '');
                            const hours = parseFloat(te.hours || te.billableHours || 0) || 0;
                            const htName = htNameMap[ht] || '';   // v180: echte Robaws hourType-naam
                            const isLL = (aId === llArtId);
                            const isOveruren = isOverurenHt(ht);
                            const isCompensatie = (hours < 0);
                            const sStr = te.startTime
                                ? String(te.startTime.hour).padStart(2, '0') + ':' + String(te.startTime.minute).padStart(2, '0')
                                : null;
                            const eStr = te.endTime
                                ? String(te.endTime.hour).padStart(2, '0') + ':' + String(te.endTime.minute).padStart(2, '0')
                                : null;
                            const timeBlockTxt = (sStr && eStr) ? (sStr + ' → ' + eStr) : null;

                            // v87: Styling per type — compensatie duidelijker als "overuren aftrek"
                            // v166: bij afwezigheidstype (Ziek / Verlof / Feestdag / Inhaal / Sociaal verlof)
                            // wordt de werkuren-styling overruled door de afwezigheids-kleur
                            let icon, bg, fg, label;
                            if (isAbsence) {
                                icon = tijdStyle.icon || this.icon('calendar', { size: 18 });
                                bg = tijdStyle.bg;
                                fg = tijdStyle.color;
                                label = tijdStyle.label;
                            } else if (isCompensatie) {
                                // Negatieve overuren — wordt afgetrokken van overuren-bank
                                // omdat L&L gebruikt is om de 8u-baseline te vullen.
                                icon = this.icon('minus', { size: 18 }); bg = '#ffebee'; fg = '#c62828';
                                label = 'Overuren aftrek';
                            } else if (isLL) {
                                icon = this.icon('package', { size: 18 }); bg = '#fff3e0'; fg = '#e65100';
                                label = 'Laden & lossen';
                            } else if (isOveruren) {
                                icon = this.icon('clock', { size: 18 }); bg = '#fff8e1'; fg = '#ef6c00';
                                label = htName || 'Overuren';   // v180: toon echte tag (bv "Overuren zaterdag")
                            } else {
                                icon = this.icon('check-circle', { size: 18 }); bg = '#f1f8e9'; fg = '#2e7d32';
                                label = htName || 'Werkuren';
                            }
                            const absHrs = Math.abs(hours).toFixed(2);
                            const headerLine = timeBlockTxt
                                ? timeBlockTxt
                                : (isCompensatie ? '−' + absHrs + ' uur (aftrek)' : absHrs + ' uur');
                            const subLine = timeBlockTxt
                                ? (label + ' · ' + hours.toFixed(2) + 'u')
                                : label;
                            const rightTxt = isCompensatie ? '−' + absHrs + 'u' : hours.toFixed(2) + 'u';

                            html += `<div class="card" style="padding:10px 14px;margin-bottom:6px;background:${bg};cursor:pointer" onclick="app.openAanpassing('${wo.id}')">
                                <div style="display:flex;align-items:center;justify-content:space-between">
                                    <div style="display:flex;align-items:center;gap:10px;flex:1">
                                        <span style="font-size:18px;color:${fg};display:inline-flex;align-items:center">${icon}</span>
                                        <div>
                                            <div style="font-size:14px;font-weight:500">${headerLine}</div>
                                            <div style="font-size:11px;color:${fg}">${subLine}</div>
                                        </div>
                                    </div>
                                    <div style="font-size:14px;color:${fg};font-weight:600">${rightTxt}</div>
                                </div>
                            </div>`;
                        }
                    }
                } else {
                    const opacity = isWeekend ? '0.4' : '0.6';
                    const label = isWeekend ? 'Weekend' : 'Geen registratie';
                    html += `<div style="margin-bottom:4px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;background:#fafafa;border-radius:8px;opacity:${opacity}">
                        <div style="font-size:13px;font-weight:500;color:var(--qe-grey)">${dayName} ${dateStr}</div>
                        <div style="font-size:11px;color:var(--qe-grey);font-style:italic">${label}</div>
                    </div>`;
                }
            }

            container.innerHTML = html;
            this._animateCountUps(container);
        } catch (e) {
            container.innerHTML = `<p class="text-grey text-sm text-center">Fout bij laden: ${e.message}</p>`;
        }
    },

    /**
     * v64: Open het aanpassing-aanvragen scherm voor een specifieke
     * Tijdsregistratie-werkbon (was vroeger time-registration).
     */
    async openAanpassing(workOrderId) {
        this._aanpassingWoId = workOrderId;
        this.navigate('screenAanpassing');

        const content = document.getElementById('aanpassingContent');
        content.innerHTML = '<div class="spinner"></div>';

        try {
            const res = await RobawsAPI.get(`work-orders/${workOrderId}`);
            if (res.code !== 200 || !res.data) throw new Error('Werkbon niet gevonden');
            const wo = res.data;
            const ef = wo.extraFields || {};
            const tijd       = (ef.Tijd && ef.Tijd.stringValue)       || 'Op tijd';
            const ingeklokt  = (ef.Ingeklokt && ef.Ingeklokt.stringValue)  || '';
            const uitgeklokt = (ef.Uitgeklokt && ef.Uitgeklokt.stringValue) || '';

            const dateOnly = (wo.date || '').substring(0, 10);
            const dateStr = dateOnly
                ? new Date(dateOnly + 'T12:00:00').toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })
                : '';

            // v166: helper gebruikt ipv hardcoded switch — dekt ook Verlof,
            // Betaalde feestdag, Inhaal rustdag, Sociaal verlof.
            const _tijdStyle = this._getTijdStyle(tijd);
            const typeIcon = _tijdStyle.icon || this.icon('calendar', { size: 24 });

            // Haal time-entries op voor totaal-uren weergave
            let totalHours = 0;
            try {
                const teRes = await RobawsAPI.get(`work-orders/${workOrderId}/time-entries?limit=100`);
                if (teRes.code === 200 && teRes.data && teRes.data.items) {
                    for (const te of teRes.data.items) totalHours += parseFloat(te.hours || 0);
                }
            } catch(_) {}

            content.innerHTML = `
                <!-- Huidige werkbon -->
                <div class="card" style="padding:16px;margin-bottom:16px">
                    <div style="font-size:13px;color:var(--qe-grey);margin-bottom:8px">${dateStr}</div>
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                        <span style="font-size:24px">${typeIcon}</span>
                        <div>
                            <div style="font-size:18px;font-weight:600">${ingeklokt || '?'} → ${uitgeklokt || '...'}</div>
                            <div style="font-size:13px;color:var(--qe-grey)">${tijd} · ${totalHours.toFixed(2)} uur</div>
                        </div>
                    </div>
                    ${(() => { const pub = this._publicRemark(wo.remark); return pub ? `<div style="font-size:12px;color:var(--qe-grey);padding:8px;background:#f5f5f5;border-radius:8px">${this.escapeHtml(pub)}</div>` : ''; })()}
                    <div style="font-size:11px;color:var(--qe-grey);margin-top:8px">Werkbon #${wo.id}</div>
                </div>

                <!-- Aanpassing formulier -->
                <div class="card" style="padding:16px">
                    <h3 style="font-size:16px;color:var(--qe-darkblue);margin-bottom:16px">Aanpassing aanvragen</h3>
                    <p style="font-size:12px;color:var(--qe-grey);margin-bottom:14px">
                        De aanvraag wordt als taak naar Vince gestuurd. Hij past de uren handmatig aan in Robaws.
                    </p>

                    <div style="margin-bottom:14px">
                        <label style="font-size:13px;font-weight:500;color:var(--qe-dark);display:block;margin-bottom:4px">Juiste ingeklokt</label>
                        <input type="time" id="aanpassingStart" value="${ingeklokt}"
                            style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
                    </div>

                    <div style="margin-bottom:14px">
                        <label style="font-size:13px;font-weight:500;color:var(--qe-dark);display:block;margin-bottom:4px">Juiste uitgeklokt</label>
                        <input type="time" id="aanpassingEnd" value="${uitgeklokt}"
                            style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
                    </div>

                    <div style="margin-bottom:16px">
                        <label style="font-size:13px;font-weight:500;color:var(--qe-dark);display:block;margin-bottom:4px">Opmerking</label>
                        <textarea id="aanpassingOpmerking" rows="3" placeholder="Waarom moet dit aangepast worden?"
                            style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box"></textarea>
                    </div>

                    <button class="btn btn-primary btn-full" onclick="app.submitAanpassing('${wo.id}')"
                        style="padding:14px;font-size:15px;font-weight:600" id="btnSubmitAanpassing">
                        ${this.icon('mail-send', { size: 18, style: 'vertical-align:-3px' })} Aanpassing indienen
                    </button>
                </div>
            `;
        } catch (e) {
            content.innerHTML = `<p class="text-grey text-sm text-center">Fout: ${e.message}</p>`;
        }
    },

    /** v64: Dien de aanpassing in als taak gekoppeld aan de werkbon. */
    async submitAanpassing(workOrderId) {
        const btn = document.getElementById('btnSubmitAanpassing');
        const startVal = document.getElementById('aanpassingStart').value;
        const endVal = document.getElementById('aanpassingEnd').value;
        const opmerking = document.getElementById('aanpassingOpmerking').value.trim();

        if (!opmerking) {
            this.toast('Vul een opmerking in waarom de aanpassing nodig is', true);
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Indienen...';

        try {
            const user = RobawsAPI.getLoggedInUser();
            const description = `Aanpassing aangevraagd door ${user ? user.name : 'onbekend'} ` +
                `voor werkbon #${workOrderId}:\n\n` +
                `Juiste ingeklokt: ${startVal || '(niet gewijzigd)'}\n` +
                `Juiste uitgeklokt: ${endVal || '(niet gewijzigd)'}\n\n` +
                `Opmerking: ${opmerking}`;

            await RobawsAPI.createTaskForWorkOrder(workOrderId, {
                title: `Uren aanpassing — ${user ? user.name : 'onbekend'}`,
                description: description,
                assignedUserId: '5', // Vince Van de Vliet (kantoor)
            });

            this.toast('Aanpassing ingediend bij Vince ');
            this.navigate('screenDagoverzicht');
            this.loadDagoverzicht();
        } catch (e) {
            this.toast('Fout bij indienen: ' + e.message, true);
            btn.disabled = false;
            btn.textContent = 'Aanpassing indienen';
        }
    },

    // ========================================
    // UITGEVOERDE WERKEN
    // ========================================
    async loadUitgevoerd() {
        const list = document.getElementById('uitgevoerdList');
        list.innerHTML = '<div class="spinner"></div>';

        try {
            const res = await fetch('api/uitgevoerd-planningen.php');
            const data = await res.json();
            const items = data.items || [];
            document.getElementById('uitgevoerdCount').textContent = items.length;

            // Cache voor openCorrectie
            this._uitgevoerdCache = {};
            items.forEach(p => { this._uitgevoerdCache[p.planningItemId] = p; });

            if (items.length === 0) {
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">✓</div>
                        <h3>Geen uitgevoerde planningen</h3>
                        <p>Geen werkbonnen van de afgelopen 7 dagen om te corrigeren</p>
                    </div>`;
                return;
            }

            // Groepeer per datum
            const grouped = {};
            items.forEach(p => {
                const d = p.date || 'Onbekend';
                if (!grouped[d]) grouped[d] = [];
                grouped[d].push(p);
            });

            const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
            const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

            // v88/v92: "Laatste betaling" knop bovenaan. v92 fetcht ALTIJD uit Robaws —
            // de laatste factuur met status "Technieker" of "Gecontrolleerd" en
            // assignedUser = ingelogde technieker. Onafhankelijk van localStorage.
            let paymentBtns = '';
            try {
                const user = RobawsAPI.getLoggedInUser();
                const userId = user && (user.robawsUserId || user.userId);
                let inv = null;
                if (userId) {
                    inv = await RobawsAPI.getLatestInvoiceForUser(userId);
                }
                if (inv) {
                    // Linked werkbon + order ophalen voor change-method flow
                    const linked = await RobawsAPI.getInvoiceLinkedDocs(inv.id);
                    const betField = (inv.extraFields && inv.extraFields.Betaling) || null;
                    const method = (betField && betField.stringValue) || 'Onbekend';
                    const amount = parseFloat(inv.totalInclVat || 0).toFixed(2);
                    const logicId = inv.logicId || '';

                    // qe_last_payment_context bijwerken zodat changeLastPaymentMethod het pakt
                    try {
                        const ctx = {
                            workOrderId: linked.workOrderId,
                            salesOrderId: linked.salesOrderId,
                            invoiceId: String(inv.id),
                            invoiceLogicId: logicId,
                            paymentMethod: method,
                            invoiceResult: {
                                invoice: {
                                    id: String(inv.id),
                                    logicId: logicId,
                                    totalInclVat: inv.totalInclVat,
                                    paymentInstruction: inv.paymentInstruction,
                                    formattedOgm: this._formatOgm(inv.paymentInstruction),
                                },
                                payment: {
                                    amount: inv.totalInclVat,
                                    ogm: inv.paymentInstruction,
                                    formattedOgm: this._formatOgm(inv.paymentInstruction),
                                },
                            },
                            timestamp: Date.now(),
                        };
                        localStorage.setItem('qe_last_payment_context', JSON.stringify(ctx));
                    } catch(_) {}

                    const methodIcon = method === 'Mollie Tap' ? this.icon('card', { size: 14, style: 'vertical-align:-2px' })
                        : method === 'Viva wallet' ? this.icon('card', { size: 14, style: 'vertical-align:-2px' })
                        : method === 'Cash' ? this.icon('cash', { size: 14, style: 'vertical-align:-2px' })
                        : method.startsWith('Overschrijving') ? this.icon('bank', { size: 14, style: 'vertical-align:-2px' })
                        : method === 'Via factuur' ? this.icon('file', { size: 14, style: 'vertical-align:-2px' })
                        : this.icon('file', { size: 14, style: 'vertical-align:-2px' });
                    paymentBtns = `
                        <div class="card" style="margin-bottom:12px;background:linear-gradient(135deg, rgba(21,101,192,0.08), rgba(46,125,50,0.08));border-left:4px solid #1565C0;cursor:pointer" onclick="app.openChangePaymentMethodModal()">
                            <div style="display:flex;align-items:center;justify-content:space-between">
                                <div style="flex:1">
                                    <div style="font-size:14px;font-weight:700;color:#1565C0">${methodIcon} Laatste betaling: ${method}</div>
                                    <div style="font-size:12px;color:var(--qe-grey);margin-top:3px">Factuur ${logicId} — € ${amount}</div>
                                    <div style="font-size:11px;color:#1565C0;margin-top:4px;font-weight:600">Tik om te openen of betalingsmethode aan te passen →</div>
                                </div>
                            </div>
                        </div>`;
                } else {
                    // Fallback: localStorage context tonen als Robaws-fetch faalt of geen match
                    const ctxRaw = localStorage.getItem('qe_last_payment_context');
                    if (ctxRaw) {
                        const ctx = JSON.parse(ctxRaw);
                        const cInv = (ctx.invoiceResult && ctx.invoiceResult.invoice) || {};
                        const amount = parseFloat(cInv.totalInclVat || 0).toFixed(2);
                        const method = ctx.paymentMethod || '?';
                        const methodIcon = method === 'Mollie Tap' ? this.icon('card', { size: 14, style: 'vertical-align:-2px' })
                            : method === 'Viva wallet' ? this.icon('card', { size: 14, style: 'vertical-align:-2px' })
                            : method === 'Cash' ? this.icon('cash', { size: 14, style: 'vertical-align:-2px' })
                            : method.startsWith('Overschrijving') ? this.icon('bank', { size: 14, style: 'vertical-align:-2px' })
                            : this.icon('file', { size: 14, style: 'vertical-align:-2px' });
                        paymentBtns = `
                            <div class="card" style="margin-bottom:12px;background:linear-gradient(135deg, rgba(21,101,192,0.08), rgba(46,125,50,0.08));border-left:4px solid #1565C0;cursor:pointer" onclick="app.openChangePaymentMethodModal()">
                                <div style="display:flex;align-items:center;justify-content:space-between">
                                    <div style="flex:1">
                                        <div style="font-size:14px;font-weight:700;color:#1565C0">${methodIcon} Laatste betaling: ${method}</div>
                                        <div style="font-size:12px;color:var(--qe-grey);margin-top:3px">Factuur ${ctx.invoiceLogicId || cInv.logicId || ''} — € ${amount}</div>
                                        <div style="font-size:11px;color:#1565C0;margin-top:4px;font-weight:600">Tik om te openen of betalingsmethode aan te passen →</div>
                                    </div>
                                </div>
                            </div>`;
                    }
                }
            } catch(e) { console.warn('[App] Laatste betaling fetch fout:', e && e.message); }

            let html = paymentBtns + `
                <div class="card" style="margin-bottom:12px;background:rgba(106,44,145,0.06);border-left:3px solid var(--qe-purple)">
                    <div style="font-size:13px;color:var(--qe-purple);font-weight:600">${this.icon('edit', { size: 14, style: 'vertical-align:-2px' })} Correctie-modus</div>
                    <div style="font-size:12px;color:var(--qe-grey);margin-top:4px">Klik op een planning om uren of materialen te corrigeren. De originele werkbon blijft staan; er wordt een correctie-werkbon met het verschil aangemaakt.</div>
                </div>`;

            Object.keys(grouped).sort().reverse().forEach(dateStr => {
                const d = new Date(dateStr + 'T12:00:00');
                const isToday = dateStr === this._localDateStr();
                const label = isToday ? 'Vandaag' : `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;

                html += `<div class="section-header mt-16"><h3 style="font-size:14px">${label}</h3></div>`;

                grouped[dateStr].forEach(p => {
                    const totH = (p.cumulatief && p.cumulatief.totalHours) || 0;
                    const matCount = (p.cumulatief && p.cumulatief.materials && p.cumulatief.materials.length) || 0;
                    const corrBadge = p.aantalWerkbonnen > 1
                        ? `<span style="background:var(--qe-orange);color:#fff;font-size:10px;padding:2px 6px;border-radius:8px;margin-left:6px">${p.aantalWerkbonnen - 1} correctie${p.aantalWerkbonnen > 2 ? 's' : ''}</span>`
                        : '';

                    html += `
                        <div class="card" style="margin-bottom:8px;cursor:pointer" onclick="app.openCorrectie('${p.planningItemId}')">
                            <div style="display:flex;justify-content:space-between;align-items:flex-start">
                                <div style="flex:1">
                                    <div style="font-size:15px;font-weight:500">${this.escapeHtml(p.clientName || 'Onbekend')}${corrBadge}</div>
                                    ${p.clientAddress ? `<div style="font-size:12px;color:var(--qe-grey);margin-top:2px">📍 ${this.escapeHtml(p.clientAddress)}</div>` : ''}
                                    <div style="font-size:12px;color:var(--qe-grey);margin-top:4px">
                                        ⏱ ${this.formatDecimalHours(totH)} · 📦 ${matCount} item${matCount !== 1 ? 's' : ''}
                                    </div>
                                </div>
                                <div style="text-align:right">
                                    ${p.origineelLogicId ? `<div style="font-size:13px;font-weight:600;color:var(--qe-purple)">${this.escapeHtml(p.origineelLogicId)}</div>` : ''}
                                    ${p.orderLogicId ? `<div style="font-size:11px;color:var(--qe-grey);margin-top:2px">${this.escapeHtml(p.orderLogicId)}</div>` : ''}
                                    <div style="font-size:18px;color:var(--qe-purple);margin-top:6px">${this.icon('edit', { size: 18 })}</div>
                                </div>
                            </div>
                        </div>`;
                });
            });

            list.innerHTML = html;
        } catch (err) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <h3>Fout bij laden</h3>
                    <p style="font-size:12px;color:var(--qe-grey)">${this.escapeHtml(err.message)}</p>
                    <button class="btn btn-primary btn-sm" onclick="app.loadUitgevoerd()">Opnieuw proberen</button>
                </div>`;
        }
    },

    // ========================================
    // CORRECTIE FLOW
    // ========================================
    async openCorrectie(planningItemId) {
        const p = (this._uitgevoerdCache || {})[planningItemId];
        if (!p) { this.toast('Planning niet gevonden'); return; }

        // Zorg dat we uurcodes hebben (klant + verplaatsing) voor delta-berekening
        if (!this.selectedUurcode || !this.verplaatsingCode) {
            try {
                const res = await fetch('api/hour-types.php');
                const data = await res.json();
                const allItems = data.items || [];
                this.verplaatsingCode = allItems.find(ht => ht.isVerplaatsing) || null;
                this.hourTypes = allItems.filter(ht => !ht.isVerplaatsing);
                if (this.hourTypes.length > 0) this.selectedUurcode = this.hourTypes[0];
            } catch(e) {}
        }
        const uurId = String(this.selectedUurcode?.id || '');
        const verplId = String(this.verplaatsingCode?.id || '');

        // Splits cumulatieve uren in klant vs verplaatsing op basis van articleId
        const hpa = p.cumulatief.hoursPerArticle || {};
        const klantUurOrig = parseFloat(hpa[uurId] || 0);
        const verplUurOrig = parseFloat(hpa[verplId] || 0);

        // State voor het correctie-scherm
        this.correctieState = {
            planning: p,
            klantMin: Math.round(klantUurOrig * 60),
            verplMin: Math.round(verplUurOrig * 60),
            materials: (p.cumulatief.materials || []).map(m => ({
                articleId: m.articleId,
                name: m.description,
                quantity: m.quantity,
                unitPrice: m.unitPrice,
            })),
            notes: p.cumulatief.remark || '',
            origineel: {
                klantUur: klantUurOrig,
                verplUur: verplUurOrig,
                materials: p.cumulatief.materials || [],
                remark: p.cumulatief.remark || '',
                hoursPerArticle: hpa,
            },
        };

        this.navigate('screenCorrectie');
        this.renderCorrectie();
    },

    renderCorrectie() {
        const s = this.correctieState;
        if (!s) return;
        const p = s.planning;

        document.getElementById('correctieKlantInfo').innerHTML = `
            <div style="font-size:16px;font-weight:600">${this.escapeHtml(p.clientName || 'Onbekend')}</div>
            ${p.clientAddress ? `<div style="font-size:12px;color:var(--qe-grey);margin-top:2px">📍 ${this.escapeHtml(p.clientAddress)}</div>` : ''}
            <div style="font-size:12px;color:var(--qe-grey);margin-top:4px">
                ${p.origineelLogicId ? `<span style="color:var(--qe-purple);font-weight:600">${this.escapeHtml(p.origineelLogicId)}</span>` : ''}
                ${p.orderLogicId ? ` · ${this.escapeHtml(p.orderLogicId)}` : ''}
                ${p.aantalWerkbonnen > 1 ? ` · <span style="color:var(--qe-orange)">${p.aantalWerkbonnen} werkbons (incl. ${p.aantalWerkbonnen - 1} correctie${p.aantalWerkbonnen > 2 ? 's' : ''})</span>` : ''}
            </div>`;

        // v92+: tijd in uren (s.klantMin/verplMin blijft intern in min, UI toont uren met 2 decimalen)
        document.getElementById('correctieKlantUur').value = (s.klantMin / 60).toFixed(2);
        document.getElementById('correctieVerplUur').value = (s.verplMin / 60).toFixed(2);

        // Render materialen
        const matList = document.getElementById('correctieMaterialen');
        if (s.materials.length === 0) {
            matList.innerHTML = '<div style="font-size:13px;color:var(--qe-grey);text-align:center;padding:12px">Geen materialen</div>';
        } else {
            matList.innerHTML = s.materials.map((m, idx) => `
                <div class="card" style="margin-bottom:6px;padding:10px">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                        <div style="flex:1;min-width:0">
                            <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHtml(m.name || '-')}</div>
                            <div style="font-size:11px;color:var(--qe-grey)">€${(m.unitPrice || 0).toFixed(2)}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:4px">
                            <button class="btn btn-outline btn-sm" style="width:28px;padding:4px" onclick="app.adjustCorrectieMaterial(${idx}, -1)">−</button>
                            <input type="number" step="0.01" value="${m.quantity}" style="width:60px;text-align:center;font-size:13px;padding:4px;border:1px solid #ddd;border-radius:6px" onchange="app.setCorrectieMaterialQty(${idx}, this.value)">
                            <button class="btn btn-outline btn-sm" style="width:28px;padding:4px" onclick="app.adjustCorrectieMaterial(${idx}, 1)">+</button>
                            <button class="btn btn-outline btn-sm" style="width:28px;padding:4px;color:#c00" onclick="app.removeCorrectieMaterial(${idx})">${this.icon('x', { size: 16 })}</button>
                        </div>
                    </div>
                </div>`).join('');
        }

        document.getElementById('correctieNotes').value = s.notes;

        // Toon delta preview
        this.updateCorrectieDelta();
    },

    updateCorrectieDelta() {
        const s = this.correctieState;
        if (!s) return;
        // v92+: input is uren (decimaal), state blijft min
        const newKlant = parseFloat(document.getElementById('correctieKlantUur').value) || 0;
        const newVerpl = parseFloat(document.getElementById('correctieVerplUur').value) || 0;
        const dKlant = Math.round((newKlant - s.origineel.klantUur) * 100) / 100;
        const dVerpl = Math.round((newVerpl - s.origineel.verplUur) * 100) / 100;
        const fmt = v => (v > 0 ? '+' : '') + v.toFixed(2) + 'u';
        const color = v => v > 0 ? 'var(--qe-green)' : (v < 0 ? '#c00' : 'var(--qe-grey)');
        const el = document.getElementById('correctieDelta');
        if (!el) return;
        el.innerHTML = `
            <div style="display:flex;justify-content:space-around;font-size:12px">
                <div>Klant: <span style="font-weight:600;color:${color(dKlant)}">${fmt(dKlant)}</span></div>
                <div>Verplaatsing: <span style="font-weight:600;color:${color(dVerpl)}">${fmt(dVerpl)}</span></div>
            </div>`;
    },

    setCorrectieKlantMin(v) {
        if (this.correctieState) {
            this.correctieState.klantMin = parseInt(v) || 0;
            this.updateCorrectieDelta();
        }
    },

    setCorrectieVerplMin(v) {
        if (this.correctieState) {
            this.correctieState.verplMin = parseInt(v) || 0;
            this.updateCorrectieDelta();
        }
    },

    /** v92+: input in uren (decimaal). Intern bewaren we minuten voor compatibiliteit. */
    setCorrectieKlantUur(v) {
        if (this.correctieState) {
            const uur = parseFloat(v) || 0;
            this.correctieState.klantMin = Math.round(uur * 60);
            this.updateCorrectieDelta();
        }
    },
    setCorrectieVerplUur(v) {
        if (this.correctieState) {
            const uur = parseFloat(v) || 0;
            this.correctieState.verplMin = Math.round(uur * 60);
            this.updateCorrectieDelta();
        }
    },

    adjustCorrectieMaterial(idx, delta) {
        if (!this.correctieState) return;
        const m = this.correctieState.materials[idx];
        if (!m) return;
        m.quantity = Math.round((parseFloat(m.quantity) + delta) * 100) / 100;
        this.renderCorrectie();
    },

    setCorrectieMaterialQty(idx, val) {
        if (!this.correctieState) return;
        const m = this.correctieState.materials[idx];
        if (!m) return;
        m.quantity = parseFloat(val) || 0;
    },

    removeCorrectieMaterial(idx) {
        if (!this.correctieState) return;
        // Op 0 zetten — niet verwijderen (anders kunnen we geen negatieve delta sturen)
        this.correctieState.materials[idx].quantity = 0;
        this.renderCorrectie();
    },

    _showMaterialSearchModal() {
        document.getElementById('modalContent').innerHTML = `
            <h3>Materiaal zoeken</h3>
            <input type="text" id="correctieMatSearch" placeholder="Zoek artikel..."
                style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box;margin-bottom:12px"
                oninput="app._searchCorrectieMatModal(this.value)">
            <div id="correctieMatResults" style="max-height:300px;overflow-y:auto"></div>
            <button class="btn btn-outline btn-full" onclick="app.closeModal()" style="margin-top:12px">Annuleren</button>
        `;
        this.openModal();
        setTimeout(() => document.getElementById('correctieMatSearch')?.focus(), 200);
    },

    async _searchCorrectieMatModal(query) {
        const container = document.getElementById('correctieMatResults');
        if (!query || query.length < 2) { container.innerHTML = ''; return; }
        try {
            const results = await RobawsAPI.searchArticles(query, 15);
            if (results.length === 0) {
                container.innerHTML = '<p style="text-align:center;font-size:13px;color:var(--qe-grey);padding:8px">Geen resultaten</p>';
                return;
            }
            container.innerHTML = results.map(art => `
                <div class="card card-clickable" style="padding:10px 12px;margin-bottom:4px" onclick='app.addMaterial(${JSON.stringify({
                    id: art.id,
                    name: art.name,
                    salePrice: art.salePrice,
                    unitPrice: art.salePrice,
                    unit: art.unitType || "stuk",
                }).replace(/'/g, "&#39;")}); app.closeModal();'>
                    <div style="font-size:14px;font-weight:500">${this.escapeHtml(art.name)}</div>
                    <div style="font-size:12px;color:var(--qe-grey)">${art.articleNumber ? '#' + art.articleNumber + ' — ' : ''}${this.formatPrice(art.salePrice)}</div>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = '<p style="color:var(--qe-red);font-size:13px;text-align:center">Zoeken mislukt</p>';
        }
    },

    async addCorrectieMaterial() {
        // BUG-fix: vroegere implementatie pollte met setTimeout om te zien
        // of de gebruiker iets had gekozen. Dat kon oneindig blijven draaien
        // (bv. als de modal CSS-klasse niet 'show' kreeg) en hield
        // currentWO in een fake state. Nu gebruiken we een explicit
        // safety-timeout én een max van 60 seconden polling.
        const fakeWoId = '__correctie__';
        if (!this.woData[fakeWoId]) this.woData[fakeWoId] = { hours: [], materials: [], photos: [], notes: '' };
        this._origCurrentWO = this.currentWO;
        this.currentWO = { id: fakeWoId };
        this._showMaterialSearchModal();

        const startCount = this.woData[fakeWoId].materials.length;
        const startedAt = Date.now();
        const MAX_WAIT_MS = 60 * 1000; // hard limit

        const restoreWO = () => {
            this.currentWO = this._origCurrentWO;
            this._origCurrentWO = null;
        };

        const check = () => {
            const arr = this.woData[fakeWoId].materials;
            if (arr.length > startCount) {
                const nieuw = arr[arr.length - 1];
                this.correctieState.materials.push({
                    articleId: nieuw.id,
                    name: nieuw.name,
                    quantity: parseFloat(nieuw.quantity) || 1,
                    // BUG-fix: salePrice kan 0 zijn (gratis). Met `||` valt 0
                    // door naar unitPrice; met `??` blijft 0 behouden.
                    unitPrice: parseFloat(nieuw.salePrice ?? nieuw.unitPrice ?? 0) || 0,
                });
                restoreWO();
                this.renderCorrectie();
                return;
            }
            // Modal nog open én binnen tijdslimiet → opnieuw checken
            const overlay = document.getElementById('modalOverlay');
            const stillOpen = overlay && overlay.classList.contains('show');
            const elapsed = Date.now() - startedAt;
            if (stillOpen && elapsed < MAX_WAIT_MS) {
                setTimeout(check, 400);
            } else {
                restoreWO();
                if (elapsed >= MAX_WAIT_MS) {
                    console.warn('[Correctie] addCorrectieMaterial timeout — currentWO hersteld');
                }
            }
        };
        setTimeout(check, 400);
    },

    setCorrectieNotes(v) {
        if (this.correctieState) this.correctieState.notes = v;
    },

    async saveCorrectie() {
        const s = this.correctieState;
        if (!s) { this.toast('Geen correctie actief'); return; }

        // Bouw currentHours zoals submitWerkbon ze verwacht
        const currentHours = [];
        if (s.klantMin > 0) currentHours.push({ type: 'klant', duration: s.klantMin, startTime: '--:--', endTime: '--:--' });
        if (s.verplMin > 0) currentHours.push({ type: 'verplaatsing', duration: s.verplMin, startTime: '--:--', endTime: '--:--' });

        // BUG-fix: oude code las uit localStorage.getItem('qe_user') wat hier
        // niet betrouwbaar was — gebruik gewoon this.currentUser. Daarbij
        // vragen we just-in-time de robawsUserId aan als die nog ontbreekt,
        // zodat correctie-werkbonnen NOOIT zonder verantwoordelijke aankomen.
        const user = this.currentUser || RobawsAPI.getLoggedInUser() || {};
        if (user && user.robawsEmployeeId && !user.robawsUserId) {
            try {
                const resolved = await RobawsAPI.ensureUserId();
                if (resolved) user.robawsUserId = resolved;
            } catch(e) { /* offline: server-side fallback in robaws-api.js */ }
        }

        const payload = {
            planningItemId: s.planning.planningItemId,
            clientId: s.planning.clientId,
            salesOrderId: s.planning.salesOrderId,
            installationIds: s.planning.installationIds || [],
            employeeId: user.robawsEmployeeId,
            userId: user.robawsUserId,
            date: s.planning.date,
            clientName: s.planning.clientName,
            origineelTitle: s.planning.origineelTitle,
            origineelLogicId: s.planning.origineelLogicId,
            currentHours,
            currentMaterials: s.materials,
            currentRemark: s.notes,
            origineelCumulatief: s.planning.cumulatief,
            uurcode: this.selectedUurcode,
            verplaatsingCode: this.verplaatsingCode,
        };

        // Guard: voorkom dubbel klikken
        if (this._submitInProgress) {
            this.toast('Bezig met versturen...');
            return;
        }
        this._submitInProgress = true;

        const btn = document.getElementById('correctieSubmitBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Bezig…'; }

        try {
            const result = await RobawsAPI.submitWerkbonCorrectie(payload);
            if (result.nothingToDo) {
                this.toast('Geen verschillen — niets te corrigeren');
            } else if (result.success) {
                const dh = (result.deltaHours || []).map(d => `${d.deltaHours > 0 ? '+' : ''}${d.deltaHours}u`).join(', ') || '–';
                const dm = (result.deltaMats || []).map(d => `${d.quantity > 0 ? '+' : ''}${d.quantity}× ${d.description}`).join(', ') || '–';
                alert(`Correctie verstuurd!\n\nWerkbon ID: ${result.workOrderId}\nUren delta: ${dh}\nMaterialen delta: ${dm}\nUren OK: ${result.timeSuccess}/${(result.timeSuccess || 0) + (result.timeErrors?.length || 0)}\nMat OK: ${result.materialSuccess}/${(result.materialSuccess || 0) + (result.materialErrors?.length || 0)}`);
                this.correctieState = null;
                this.navigate('screenUitgevoerd');
                this.loadUitgevoerd();
            }
        } catch (err) {
            alert('Fout bij correctie: ' + err.message);
        } finally {
            this._submitInProgress = false;
            if (btn) { btn.disabled = false; btn.textContent = 'Correctie versturen'; }
        }
    },

    cancelCorrectie() {
        this.correctieState = null;
        this.navigate('screenUitgevoerd');
    },

    // ========================================
    // NAVIGATION TO ADDRESS
    // ========================================
    navigateToAddress(address) {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`, '_blank');
    },

    openRoutePlanning() {
        // Verzamel alle adressen van werkorders op volgorde van starttijd
        const sorted = [...this.workorders]
            .filter(wo => wo.address || wo.client?.address)
            .sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0));

        if (sorted.length === 0) { this.toast('Geen adressen beschikbaar'); return; }

        // Google Maps multi-stop: destination = laatste, waypoints = tussenliggende
        const addresses = sorted.map(wo => wo.address || wo.client?.address);
        const destination = addresses[addresses.length - 1];
        const waypoints = addresses.slice(0, -1);

        let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
        if (waypoints.length > 0) {
            url += `&waypoints=${waypoints.map(a => encodeURIComponent(a)).join('|')}`;
        }
        url += '&travelmode=driving';
        window.open(url, '_blank');
    },

    // ========================================
    // MODALS & TOAST
    // ========================================
    openModal() { document.getElementById('modalOverlay').classList.add('show'); },
    closeModal() { document.getElementById('modalOverlay').classList.remove('show'); },
    showModal(html) {
        document.getElementById('modalContent').innerHTML = html;
        this.openModal();
    },

    toast(message) {
        const el = document.getElementById('toast');
        el.textContent = message;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    },

    /** v92: format Robaws paymentInstruction (12-cijferige OGM) als +++123/4567/89012+++ */
    _formatOgm(ogm) {
        const s = String(ogm || '').replace(/[^0-9]/g, '');
        if (s.length !== 12) return '';
        return '+++' + s.substr(0, 3) + '/' + s.substr(3, 4) + '/' + s.substr(7, 5) + '+++';
    },

    // ================================================================
    // v119+: AUTO-KM BEREKENING via Google Routes API
    // ----------------------------------------------------------------
    //  Start/eind = bureau, tenzij "rechtstreeks van/naar thuis" → dan
    //  het werknemer-adres uit Robaws. Werf-adressen uit dagplanning.
    //  heen = startAddr → eerste werf van de dag
    //  terug = laatste werf van de dag → endAddr
    // ================================================================
    GOOGLE_MAPS_API_KEY: 'AIzaSyDdgkLVxmuOEddVcodKDl7yO4vlI_NvGYA',
    QE_OFFICE_ADDRESS:  'Deuzeldlaan 36, 2900 Schoten, België',

    /** Format een Robaws-`address`-object naar een Google-leesbare string. */
    _formatRobawsAddress(addr) {
        if (!addr) return null;
        const cityLine = [addr.postalCode, addr.city].filter(Boolean).join(' ').trim();
        const parts = [
            (addr.addressLine1 || '').trim(),
            cityLine,
            (addr.country || 'België').trim(),
        ].filter(s => s);
        return parts.join(', ');
    },

    /** Stash voor diagnostiek — bevat de laatste set keys van de employee
     *  response zodat we in de modal kunnen tonen welke velden Robaws teruggaf. */
    _lastEmployeeKeys: null,
    _lastEmployeeExtraKeys: null,

    /** Werknemer-adres uit Robaws. Probeert meerdere structuren omdat
     *  Robaws het adres op verschillende plekken kan zetten:
     *   - emp.address als object met addressLine1/postalCode/city/country
     *   - emp.homeAddress / emp.privateAddress / emp.addresses[0]
     *   - of als losse top-level velden direct op emp (addressLine1, street, postalCode, city, ...)
     *  Returns geformatteerde string of null. */
    async _fetchEmployeeAddress(employeeId) {
        try {
            const res = await RobawsAPI.get('employees/' + employeeId);
            if (res.code !== 200 || !res.data) {
                console.warn('[KM] employee fetch faalde, code', res.code);
                this._lastEmployeeKeys = ['fetch-faalde:' + res.code];
                return null;
            }
            const emp = res.data;
            this._lastEmployeeKeys = Object.keys(emp);
            this._lastEmployeeExtraKeys = (emp.extraFields && typeof emp.extraFields === 'object')
                ? Object.keys(emp.extraFields)
                : null;
            console.log('[KM] employee object keys:', Object.keys(emp));
            console.log('[KM] employee extraFields keys:', this._lastEmployeeExtraKeys);

            // 1) Probeer geneste address-objects (Robaws gebruikt `domicileAddress`
            //    op employees — bevestigd via debug-output v127)
            const objCandidates = [
                emp.domicileAddress,
                emp.address,
                emp.homeAddress,
                emp.privateAddress,
                Array.isArray(emp.addresses) ? emp.addresses[0] : null,
            ].filter(Boolean);
            for (const cand of objCandidates) {
                const formatted = this._formatRobawsAddress(cand);
                if (formatted) {
                    console.log('[KM] werknemer-adres gevonden via geneste object:', formatted);
                    return formatted;
                }
            }

            // 2) Probeer een synthetisch object opgebouwd uit losse velden direct op emp.
            //  Robaws kan in de employees-response het adres als losse properties zetten:
            //  addressLine1, addressLine2, postalCode, city, country, street, streetNumber...
            const synthetic = {
                addressLine1: emp.addressLine1 || emp.street || emp.straat || null,
                addressLine2: emp.addressLine2 || null,
                postalCode:   emp.postalCode || emp.postcode || emp.zip || null,
                city:         emp.city || emp.stad || null,
                country:      emp.country || emp.land || null,
            };
            // Numeriek straat-nr toevoegen aan addressLine1 als er een apart `streetNumber` is
            if (synthetic.addressLine1 && (emp.streetNumber || emp.huisnummer || emp.number)) {
                const nr = emp.streetNumber || emp.huisnummer || emp.number;
                if (!String(synthetic.addressLine1).match(new RegExp('\\b' + nr + '\\b'))) {
                    synthetic.addressLine1 = synthetic.addressLine1 + ' ' + nr;
                }
            }
            if (synthetic.addressLine1 || synthetic.city || synthetic.postalCode) {
                const formatted = this._formatRobawsAddress(synthetic);
                if (formatted) {
                    console.log('[KM] werknemer-adres gevonden via losse velden:', formatted);
                    return formatted;
                }
            }

            // 3) Probeer extraFields — Robaws bewaart custom velden hier.
            //    Adres kan staan als 'Adres', 'Address', 'Thuisadres', etc.
            if (emp.extraFields && typeof emp.extraFields === 'object') {
                for (const [key, val] of Object.entries(emp.extraFields)) {
                    const lcKey = key.toLowerCase();
                    if (!lcKey.includes('adres') && !lcKey.includes('address')) continue;
                    // ExtraField kan een string of een object zijn
                    const stringValue = (val && typeof val === 'object')
                        ? (val.stringValue || val.value || val.textValue || null)
                        : (typeof val === 'string' ? val : null);
                    if (stringValue && stringValue.trim()) {
                        console.log('[KM] werknemer-adres uit extraFields["' + key + '"]:', stringValue);
                        return stringValue.trim();
                    }
                }
            }

            console.warn('[KM] geen werknemer-adres in employee record. Raw:',
                JSON.stringify(emp).slice(0, 800));
            return null;
        } catch (e) {
            console.warn('[KM] employee-adres ophalen mislukt:', e && e.message);
            return null;
        }
    },

    /** Werf-adressen uit dagplanning van vandaag, in volgorde (vroegst → laatst).
     *  Returns array van geformatteerde adres-strings, of null. */
    async _fetchTodayWerfAddresses(employeeId) {
        try {
            const today = RobawsAPI._localDateStr();
            const planning = await RobawsAPI.getPlanning(employeeId, today, null);
            const items = (planning && planning.items) || [];
            // getPlanning sorteert al op startDate ascending — items[0] = eerste, items[len-1] = laatste
            const addrs = items
                .map(it => (it.address || '').trim())
                .filter(a => a);
            if (addrs.length === 0) {
                console.warn('[KM] geen dagplanning-items met adres voor vandaag');
                return null;
            }
            // De-duplicate opeenvolgende identieke adressen (bv. 2 planningen op dezelfde werf)
            const dedup = [];
            for (const a of addrs) {
                if (dedup.length === 0 || dedup[dedup.length - 1] !== a) dedup.push(a);
            }
            console.log('[KM] dagplanning adressen vandaag (' + dedup.length + '):', dedup);
            return dedup;
        } catch (e) {
            console.warn('[KM] dagplanning-adressen ophalen faalde:', e && e.message);
            return null;
        }
    },

    /** Google Routes API (v2). Returns:
     *   { km: <number> }                op succes
     *   { km: null, error: <string> }   op fout (exacte fout-tekst voor debug) */
    async _googleDistanceKm(origin, destination) {
        if (!origin || !destination) return { km: null, error: 'origin/destination leeg' };
        try {
            const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': this.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'routes.distanceMeters',
                },
                body: JSON.stringify({
                    origin: { address: origin },
                    destination: { address: destination },
                    travelMode: 'DRIVE',
                    routingPreference: 'TRAFFIC_UNAWARE',
                }),
            });
            let body = '';
            try { body = await res.text(); } catch(_) {}
            let data = null;
            try { data = body ? JSON.parse(body) : null; } catch(_) {}
            if (!res.ok) {
                const msg = (data && data.error && data.error.message)
                    || `HTTP ${res.status}`
                    + (body ? (' — ' + body.slice(0, 200)) : '');
                console.warn('[KM] Routes API non-OK:', res.status, msg);
                return { km: null, error: 'HTTP ' + res.status + ': ' + msg };
            }
            const meters = data && data.routes && data.routes[0] && data.routes[0].distanceMeters;
            if (typeof meters !== 'number') {
                console.warn('[KM] Routes API geen distanceMeters:', data);
                return { km: null, error: 'Geen distanceMeters in response' };
            }
            return { km: Math.round(meters / 1000) };
        } catch (e) {
            const msg = (e && e.message) || String(e);
            console.warn('[KM] Routes API fetch gooi-fout:', msg);
            // CORS / netwerk faal geeft typisch "Failed to fetch" of "Load failed"
            return { km: null, error: 'Fetch faalde: ' + msg };
        }
    },

    /** Hoofd-functie: bereken heen + terug enkel tot/van eerste/laatste werf.
     *  Tussenliggende werven tellen NIET mee (werknemers krijgen uurloon onderweg).
     *   - heen  = startAddr → eerste werf van de dag
     *   - terug = laatste werf van de dag → endAddr
     *  startAddr/endAddr = bureau, tenzij "rechtstreeks van/naar thuis" → werknemer-adres.
     *  Fiets-vinkje heeft GEEN invloed op de km — werknemer kan met fiets naar bureau
     *  komen en daarna met camionet vertrekken; de km worden dan nog steeds berekend. */
    async _autoCalcKilometers(employeeId, options) {
        const werven = await this._fetchTodayWerfAddresses(employeeId);
        if (!werven || werven.length === 0) {
            return { heen: 0, terug: 0, source: 'geen-werf-adres', error: 'Geen dagplanning-adres gevonden' };
        }
        let startAddr = this.QE_OFFICE_ADDRESS;
        let endAddr   = this.QE_OFFICE_ADDRESS;
        let empAddrMissing = false;
        if (options.directThuisWerf || options.directWerfThuis) {
            const empAddr = await this._fetchEmployeeAddress(employeeId);
            if (empAddr) {
                if (options.directThuisWerf) startAddr = empAddr;
                if (options.directWerfThuis) endAddr   = empAddr;
            } else {
                empAddrMissing = true;
                console.warn('[KM] werknemer-adres niet gevonden, val terug op bureau');
            }
        }
        const eersteWerf  = werven[0];
        const laatsteWerf = werven[werven.length - 1];
        console.log('[KM] berekenen:', { startAddr, eersteWerf, laatsteWerf, endAddr });
        const [heenRes, terugRes] = await Promise.all([
            this._googleDistanceKm(startAddr, eersteWerf),
            this._googleDistanceKm(laatsteWerf, endAddr),
        ]);
        const heen  = heenRes  && heenRes.km;
        const terug = terugRes && terugRes.km;
        const ok = (typeof heen === 'number' && typeof terug === 'number');
        const apiError = (heenRes && heenRes.error) || (terugRes && terugRes.error) || null;
        // Wanneer een rechtstreeks-vinkje aanstaat maar het werknemer-adres niet
        // gevonden is, val de berekening terug op bureau-adres → user ziet zelfde
        // km. Toon dat expliciet zodat de gebruiker weet waarom.
        let warning = null;
        if (empAddrMissing && ok) {
            let keysHint = '';
            if (Array.isArray(this._lastEmployeeKeys) && this._lastEmployeeKeys.length) {
                keysHint = ' [emp keys: ' + this._lastEmployeeKeys.join(', ') + ']';
            }
            if (Array.isArray(this._lastEmployeeExtraKeys) && this._lastEmployeeExtraKeys.length) {
                keysHint += ' [extraFields: ' + this._lastEmployeeExtraKeys.join(', ') + ']';
            }
            warning = 'Werknemer-adres niet gevonden in Robaws — gerekend vanaf bureau.' + keysHint;
        }
        return {
            heen:  typeof heen  === 'number' ? heen  : 0,
            terug: typeof terug === 'number' ? terug : 0,
            source: ok ? 'google-maps' : 'partial',
            startAddr, eersteWerf, laatsteWerf, endAddr,
            error: ok ? null : ('Google Maps gaf geen afstand' + (apiError ? ' — ' + apiError : '')),
            warning,
        };
    },

    /**
     * v83: Vraag de monteur om kilometers heen/terug in te geven na uitklokken,
     * en post die als commute-entry op de werkbon. Modal — kan niet weggeklikt
     * worden zonder iets in te vullen (0 is een geldige waarde).
     * v119: bij open auto-fill via Google Maps Distance Matrix.
     */
    async promptKilometers(workOrderId, employeeId) {
        return new Promise((resolve) => {
            // Bouw modal — v95: mobility-keuze + woonwerk-fiets checkbox
            let m = document.getElementById('kmPromptModal');
            if (m) m.remove();
            m = document.createElement('div');
            m.id = 'kmPromptModal';
            // v96-fix: align-items:flex-start + padding-top:30px zodat de modal bovenaan
            // staat ipv gecentreerd. Bij open toetsenbord blijft de hele inhoud zichtbaar
            // en kan je naar boven scrollen om titel/subtitle/mobility/fiets te zien.
            m.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.7);display:flex;align-items:flex-start;justify-content:center;padding:30px 16px 16px;overflow-y:auto;-webkit-overflow-scrolling:touch';
            m.innerHTML = `
                <div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:22px;box-shadow:0 8px 32px rgba(0,0,0,0.3);box-sizing:border-box">
                    <div style="font-size:20px;font-weight:700;color:#1A237E;margin-bottom:6px;display:flex;align-items:center;gap:8px">
 Kilometers vandaag
                    </div>
                    <div style="font-size:13px;color:#666;margin-bottom:14px">
                        Hoeveel kilometers heb je heen en terug afgelegd?
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
                        <div>
                            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">Heen (km)</label>
                            <input id="kmHeenInput" type="number" inputmode="numeric" min="0" step="1" value="0"
                                style="width:100%;padding:12px;font-size:17px;border:2px solid #cfd8dc;border-radius:10px;text-align:center;font-weight:600;box-sizing:border-box">
                        </div>
                        <div>
                            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">Terug (km)</label>
                            <input id="kmTerugInput" type="number" inputmode="numeric" min="0" step="1" value="0"
                                style="width:100%;padding:12px;font-size:17px;border:2px solid #cfd8dc;border-radius:10px;text-align:center;font-weight:600;box-sizing:border-box">
                        </div>
                    </div>

                    <label style="font-size:12px;color:#666;display:block;margin-bottom:4px">Mobiliteit</label>
                    <div id="kmMobilityRadio" style="display:grid;gap:6px;margin-bottom:14px">
                        <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:2px solid #cfd8dc;border-radius:10px;cursor:pointer;font-size:14px">
                            <input type="radio" name="kmMobility" value="-3" checked style="margin:0">
 <span> Chauffeur zonder passagiers</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:2px solid #cfd8dc;border-radius:10px;cursor:pointer;font-size:14px">
                            <input type="radio" name="kmMobility" value="-1" style="margin:0">
 <span> Chauffeur (met passagiers)</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:2px solid #cfd8dc;border-radius:10px;cursor:pointer;font-size:14px">
                            <input type="radio" name="kmMobility" value="-2" style="margin:0">
 <span> Passagier</span>
                        </label>
                    </div>

                    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:2px solid #cfd8dc;border-radius:10px;cursor:pointer;font-size:14px;margin-bottom:8px;background:#fff8e1">
                        <input id="kmFietsInput" type="checkbox" style="margin:0;width:20px;height:20px;cursor:pointer">
 <span> Woonwerk-verkeer met de <strong>fiets</strong></span>
                    </label>

                    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:2px solid #cfd8dc;border-radius:10px;cursor:pointer;font-size:14px;margin-bottom:8px;background:#e8f5e9">
                        <input id="kmDirectThuisWerfInput" type="checkbox" style="margin:0;width:20px;height:20px;cursor:pointer">
 <span> Rechtstreeks van <strong>thuis naar werf</strong> gereden</span>
                    </label>

                    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:2px solid #cfd8dc;border-radius:10px;cursor:pointer;font-size:14px;margin-bottom:14px;background:#e8f5e9">
                        <input id="kmDirectWerfThuisInput" type="checkbox" style="margin:0;width:20px;height:20px;cursor:pointer">
 <span> Rechtstreeks van <strong>werf naar thuis</strong> gereden</span>
                    </label>

                    <!-- v131: knop om rit te splitsen in 2 mobiliteits-segmenten -->
                    <button id="kmSplitToggle" type="button"
                            style="width:100%;padding:11px;background:#fff;color:#1A237E;border:2px dashed #1A237E;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:14px">
 Rit splitsen (deel met andere mobiliteit)
                    </button>

                    <div id="kmSplitSection" style="display:none;border:2px solid #cfd8dc;border-radius:12px;padding:14px;margin-bottom:14px;background:#fafafa">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
 <div style="font-size:13px;font-weight:700;color:#1A237E"> Tweede rit-segment</div>
                            <button id="kmSplitRemove" type="button" style="background:none;border:none;color:#c62828;cursor:pointer;font-size:13px;font-weight:600;padding:0">✕ verwijder</button>
                        </div>
                        <div style="font-size:11px;color:#888;margin-bottom:10px;line-height:1.4">
                            Vul hier de km in die je in een <strong>andere</strong> mobiliteit aflegde (bv. solo-deel voordat je iemand oppikte). De hoofd-keuze hierboven geldt voor de rest.
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
                            <div>
                                <label style="font-size:11px;color:#666;display:block;margin-bottom:3px">Heen (km)</label>
                                <input id="kmHeen2Input" type="number" inputmode="numeric" min="0" step="1" value="0"
                                    style="width:100%;padding:10px;font-size:15px;border:2px solid #cfd8dc;border-radius:8px;text-align:center;font-weight:600;box-sizing:border-box">
                            </div>
                            <div>
                                <label style="font-size:11px;color:#666;display:block;margin-bottom:3px">Terug (km)</label>
                                <input id="kmTerug2Input" type="number" inputmode="numeric" min="0" step="1" value="0"
                                    style="width:100%;padding:10px;font-size:15px;border:2px solid #cfd8dc;border-radius:8px;text-align:center;font-weight:600;box-sizing:border-box">
                            </div>
                        </div>
                        <label style="font-size:11px;color:#666;display:block;margin-bottom:4px">Mobiliteit voor dit segment</label>
                        <div id="kmMobility2Radio" style="display:grid;gap:5px">
                            <label style="display:flex;align-items:center;gap:7px;padding:8px 10px;border:2px solid #cfd8dc;border-radius:8px;cursor:pointer;font-size:13px;background:#fff">
                                <input type="radio" name="kmMobility2" value="-3" checked style="margin:0">
 <span> Chauffeur zonder passagiers</span>
                            </label>
                            <label style="display:flex;align-items:center;gap:7px;padding:8px 10px;border:2px solid #cfd8dc;border-radius:8px;cursor:pointer;font-size:13px;background:#fff">
                                <input type="radio" name="kmMobility2" value="-1" style="margin:0">
 <span> Chauffeur (met passagiers)</span>
                            </label>
                            <label style="display:flex;align-items:center;gap:7px;padding:8px 10px;border:2px solid #cfd8dc;border-radius:8px;cursor:pointer;font-size:13px;background:#fff">
                                <input type="radio" name="kmMobility2" value="-2" style="margin:0">
 <span> Passagier</span>
                            </label>
                        </div>
                    </div>

                    <button id="kmPromptSubmit" style="width:100%;padding:14px;background:#1A237E;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer">
                        Opslaan
                    </button>
                    <div id="kmPromptError" style="font-size:11px;color:#e65100;background:#fff3e0;border:1px solid #ffcc80;border-radius:8px;padding:8px;margin-top:8px;text-align:left;display:none;word-wrap:break-word;max-height:120px;overflow-y:auto;line-height:1.4"></div>
                </div>`;
            document.body.appendChild(m);

            const heenEl = document.getElementById('kmHeenInput');
            const terugEl = document.getElementById('kmTerugInput');
            const fietsEl = document.getElementById('kmFietsInput');
            const directTWEl = document.getElementById('kmDirectThuisWerfInput');
            const directWTEl = document.getElementById('kmDirectWerfThuisInput');
            const errEl = document.getElementById('kmPromptError');
            const btn = document.getElementById('kmPromptSubmit');
            // v131: split-rit elementen
            const splitToggleEl = document.getElementById('kmSplitToggle');
            const splitSectionEl = document.getElementById('kmSplitSection');
            const splitRemoveEl = document.getElementById('kmSplitRemove');
            const heen2El = document.getElementById('kmHeen2Input');
            const terug2El = document.getElementById('kmTerug2Input');
            const openSplit = () => {
                splitSectionEl.style.display = 'block';
                splitToggleEl.style.display = 'none';
            };
            const closeSplit = () => {
                splitSectionEl.style.display = 'none';
                splitToggleEl.style.display = 'block';
                heen2El.value = '0';
                terug2El.value = '0';
            };
            if (splitToggleEl) splitToggleEl.addEventListener('click', openSplit);
            if (splitRemoveEl) splitRemoveEl.addEventListener('click', closeSplit);

            // Auto-focus heen veld + select-all
            setTimeout(() => { try { heenEl.focus(); heenEl.select(); } catch(_) {} }, 100);

            // ============================================================
            // v119: Auto-bereken km via Google Maps Distance Matrix.
            //  - Loopt bij open van de modal (na 250ms zodat user de modal ziet)
            //  - Loopt opnieuw bij elke checkbox-wijziging (fiets / directTW / directWT)
            //  - Tijdens berekening: inputs disabled + opacity:0.5 + placeholder "..."
            //  - Als google iets teruggeeft → veld vullen
            //  - User kan altijd nog handmatig overschrijven (na de async call)
            // ============================================================
            let _kmCalcSeq = 0;
            const self = this;
            const recalcKm = async () => {
                const seq = ++_kmCalcSeq;
                const opts = {
                    directThuisWerf: !!(directTWEl && directTWEl.checked),
                    directWerfThuis: !!(directWTEl && directWTEl.checked),
                };
                // Loading state
                try {
                    heenEl.disabled = true;
                    terugEl.disabled = true;
                    heenEl.style.opacity = '0.5';
                    terugEl.style.opacity = '0.5';
                    heenEl.value = '...';
                    terugEl.value = '...';
                    errEl.style.display = 'none';
                } catch(_) {}
                let result = null;
                let thrownMsg = null;
                try {
                    result = await self._autoCalcKilometers(employeeId, opts);
                } catch (e) {
                    thrownMsg = e && e.message || String(e);
                    console.warn('[KM] auto-calc faalde:', thrownMsg);
                }
                // Race-check: alleen toepassen als deze call de meest recente is
                if (seq !== _kmCalcSeq) return;
                try {
                    heenEl.disabled = false;
                    terugEl.disabled = false;
                    heenEl.style.opacity = '1';
                    terugEl.style.opacity = '1';
                } catch(_) {}
                if (result) {
                    heenEl.value = String(result.heen);
                    terugEl.value = String(result.terug);
                    console.log('[KM] auto-fill:', result);
                    if (result.error) {
                        errEl.textContent = '' + result.error + ' — vul handmatig in.';
                        errEl.style.color = '#e65100';
                        errEl.style.display = 'block';
                    } else if (result.warning) {
                        errEl.textContent = '' + result.warning;
                        errEl.style.color = '#0277bd';
                        errEl.style.display = 'block';
                    }
                } else {
                    heenEl.value = '0';
                    terugEl.value = '0';
                    if (thrownMsg) {
                        errEl.textContent = 'Auto-km mislukt ('+ thrownMsg + ') — vul handmatig in.';
                        errEl.style.color = '#e65100';
                        errEl.style.display = 'block';
                    }
                }
            };
            // Initial calc - bij open
            setTimeout(() => { recalcKm(); }, 250);
            // Re-calc bij thuis-werf vinkjes (fiets-vinkje heeft geen invloed meer)
            if (directTWEl) directTWEl.addEventListener('change', recalcKm);
            if (directWTEl) directWTEl.addEventListener('change', recalcKm);

            const submit = async () => {
                const heen = Math.max(0, Math.round(parseFloat(heenEl.value) || 0));
                const terug = Math.max(0, Math.round(parseFloat(terugEl.value) || 0));
                const mobRadio = document.querySelector('input[name="kmMobility"]:checked');
                const mobilityTypeId = mobRadio ? parseInt(mobRadio.value, 10) : -3;
                const fiets = !!(fietsEl && fietsEl.checked);
                const directThuisWerf = !!(directTWEl && directTWEl.checked);
                const directWerfThuis = !!(directWTEl && directWTEl.checked);

                // v131: detecteer split-rit (2e mobility-blok)
                const splitOpen = splitSectionEl && splitSectionEl.style.display !== 'none';
                const heen2 = splitOpen ? Math.max(0, Math.round(parseFloat(heen2El.value) || 0)) : 0;
                const terug2 = splitOpen ? Math.max(0, Math.round(parseFloat(terug2El.value) || 0)) : 0;
                const mob2Radio = document.querySelector('input[name="kmMobility2"]:checked');
                const mobility2TypeId = mob2Radio ? parseInt(mob2Radio.value, 10) : -3;
                const hasSplit = splitOpen && (heen2 > 0 || terug2 > 0);

                btn.disabled = true;
                btn.textContent = 'Opslaan...';
                errEl.style.display = 'none';

                try {
                    // Stap 1: commute-entry voor de hoofd-rit
                    const r = await RobawsAPI.addCommuteEntry({
                        workOrderId,
                        employeeId,
                        distance: heen,
                        returnDistance: terug,
                        mobilityTypeId: mobilityTypeId,
                    });
                    if (r.code !== 200 && r.code !== 201) {
                        throw new Error('Robaws (' + r.code + ')');
                    }

                    // v131: stap 1b — tweede commute-entry indien split aangevinkt
                    if (hasSplit) {
                        const r2 = await RobawsAPI.addCommuteEntry({
                            workOrderId,
                            employeeId,
                            distance: heen2,
                            returnDistance: terug2,
                            mobilityTypeId: mobility2TypeId,
                        });
                        if (r2.code !== 200 && r2.code !== 201) {
                            throw new Error('Robaws split (' + r2.code + ')');
                        }
                        console.log('[App] split commute-entry gepost:', { heen2, terug2, mobility2TypeId });
                    }

                    // Stap 2: checkboxes (Fietsvergoeding + Rechtstreeks routes) → set
                    // extraFields op de werkbon. Alleen aanraken als minstens één checked
                    // is, en alle 3 in één PUT (anders 3 round-trips).
                    if (fiets || directThuisWerf || directWerfThuis) {
                        try {
                            const woFull = await RobawsAPI.get(`work-orders/${workOrderId}`);
                            if (woFull.code === 200 && woFull.data) {
                                woFull.data.extraFields = woFull.data.extraFields || {};
                                if (fiets) {
                                    woFull.data.extraFields['Fietsvergoeding'] = {
                                        type: 'CHECKBOX',
                                        group: 'Tijdsregistratie',
                                        booleanValue: true,
                                    };
                                }
                                if (directThuisWerf) {
                                    woFull.data.extraFields['Rechtstreeks - Thuis / Werf'] = {
                                        type: 'CHECKBOX',
                                        group: 'Tijdsregistratie',
                                        booleanValue: true,
                                    };
                                }
                                if (directWerfThuis) {
                                    woFull.data.extraFields['Rechtstreeks - Werf / Thuis'] = {
                                        type: 'CHECKBOX',
                                        group: 'Tijdsregistratie',
                                        booleanValue: true,
                                    };
                                }
                                await RobawsAPI.put(`work-orders/${workOrderId}`, woFull.data);
                                console.log('[App] Tijdsregistratie checkboxes aangevinkt:',
                                    {fiets, directThuisWerf, directWerfThuis}, 'op werkbon', workOrderId);
                            }
                        } catch (eFiets) {
                            console.warn('[App] Tijdsregistratie checkboxes update faalde (niet kritiek):',
                                eFiets && eFiets.message);
                        }
                    }

                    // Succes → modal weg
                    m.remove();
                    const tags = [];
 if (fiets) tags.push('');
 if (directThuisWerf) tags.push('→');
 if (directWerfThuis) tags.push('→');
 if (hasSplit) tags.push('');
                    const tagTxt = tags.length ? ' · ' + tags.join(' ') : '';
                    const totaalKm = (heen + terug) + (hasSplit ? (heen2 + terug2) : 0);
                    this.toast('Kilometers opgeslagen: ' + totaalKm + ' km' + tagTxt);
                    resolve(true);
                } catch (e) {
                    console.warn('[App] km POST faalde:', e && e.message);
                    errEl.textContent = 'Opslaan mislukt: ' + (e && e.message || '?');
                    errEl.style.display = 'block';
                    btn.disabled = false;
                    btn.textContent = 'Opslaan';
                }
            };
            btn.addEventListener('click', submit);
            terugEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
            heenEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') terugEl.focus(); });
        });
    },

    // =====================================================================
    // v137: NIEUWE WERKBON (ad-hoc, voor techniekers wanneer klant belt)
    // =====================================================================

    /** State voor de "+ Nieuwe werkbon" modal. */
    _newWo: null,

    openNewWorkOrderModal() {
        if (!this.currentUser || this._activeRole() === 'monteur') {
            this.toast('Niet beschikbaar voor monteurs');
            return;
        }
        this._newWo = {
            selectedClient: null,
            useNewClient: false,
            searchTimer: null,
        };
        const m = document.getElementById('newWoModal');
        if (!m) return;
        document.getElementById('newWoClientStep').style.display = '';
        document.getElementById('newWoSelectedStep').style.display = 'none';
        document.getElementById('newWoNewClientFields').style.display = 'none';
        document.getElementById('newWoClientSearch').value = '';
        document.getElementById('newWoClientResults').style.display = 'none';
        document.getElementById('newWoClientResults').innerHTML = '';
        document.getElementById('newWoNewClientPrompt').style.display = 'none';
        document.getElementById('newWoNewClientName').value = '';
        document.getElementById('newWoNewClientStreet').value = '';
        document.getElementById('newWoNewClientZip').value = '';
        document.getElementById('newWoNewClientCity').value = '';
        document.getElementById('newWoNewClientTel').value = '';
        document.getElementById('newWoReason').value = '';
        document.getElementById('newWoStatus').textContent = '';
        document.getElementById('newWoStatus').className = 'qe-newwo-status';
        document.getElementById('newWoSubmitBtn').disabled = true;

        const sIn = document.getElementById('newWoClientSearch');
        sIn.oninput = () => this._newWoOnSearchInput();
        document.getElementById('newWoReason').oninput = () => this._newWoUpdateSubmitState();
        ['newWoNewClientName', 'newWoNewClientStreet', 'newWoNewClientZip', 'newWoNewClientCity'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.oninput = () => this._newWoUpdateSubmitState();
        });

        m.style.display = 'flex';
        // eslint-disable-next-line no-unused-expressions
        m.offsetWidth;
        m.classList.add('qe-show');
        setTimeout(() => sIn.focus(), 200);
    },

    closeNewWorkOrderModal() {
        const m = document.getElementById('newWoModal');
        if (!m) return;
        m.classList.remove('qe-show');
        setTimeout(() => { m.style.display = 'none'; }, 220);
        if (this._newWo && this._newWo.searchTimer) clearTimeout(this._newWo.searchTimer);
        this._newWo = null;
    },

    _newWoOnSearchInput() {
        if (!this._newWo) return;
        if (this._newWo.searchTimer) clearTimeout(this._newWo.searchTimer);
        const q = document.getElementById('newWoClientSearch').value.trim();
        const resultsEl = document.getElementById('newWoClientResults');
        const promptEl  = document.getElementById('newWoNewClientPrompt');
        if (q.length < 2) {
            resultsEl.style.display = 'none';
            resultsEl.innerHTML = '';
            promptEl.style.display = 'none';
            return;
        }
        this._newWo.searchTimer = setTimeout(async () => {
            resultsEl.innerHTML = '<div style="padding:10px;font-size:13px;color:#90a4ae;text-align:center">Zoeken…</div>';
            resultsEl.style.display = 'block';
            promptEl.style.display = 'none';
            try {
                const matches = await RobawsAPI.searchClients(q, 15);
                this._newWoRenderResults(matches);
            } catch (e) {
                console.warn('[App] klant-zoek faalde:', e && e.message);
                resultsEl.innerHTML = '<div style="padding:10px;font-size:13px;color:#c62828;text-align:center">Zoeken mislukt — probeer opnieuw</div>';
                promptEl.style.display = 'block';
            }
        }, 300);
    },

    _newWoRenderResults(matches) {
        const resultsEl = document.getElementById('newWoClientResults');
        const promptEl  = document.getElementById('newWoNewClientPrompt');
        if (!matches || matches.length === 0) {
            resultsEl.innerHTML = '<div style="padding:10px;font-size:13px;color:#90a4ae;text-align:center">Geen klanten gevonden</div>';
            resultsEl.style.display = 'block';
            promptEl.style.display = 'block';
            return;
        }
        resultsEl.innerHTML = matches.map((c, i) => `
            <div class="qe-newwo-result" data-idx="${i}">
                <div class="name">${this._escapeHtml(c.name)}</div>
                ${c.address ? `<div class="addr">${this._escapeHtml(c.address)}</div>` : ''}
            </div>
        `).join('');
        Array.from(resultsEl.querySelectorAll('.qe-newwo-result')).forEach((el, i) => {
            el.addEventListener('click', () => this._newWoSelectClient(matches[i]));
        });
        resultsEl.style.display = 'block';
        promptEl.style.display = 'block';
    },

    _newWoSelectClient(client) {
        if (!this._newWo) return;
        this._newWo.selectedClient = client;
        this._newWo.useNewClient = false;
        document.getElementById('newWoClientStep').style.display = 'none';
        document.getElementById('newWoNewClientFields').style.display = 'none';
        document.getElementById('newWoSelectedStep').style.display = '';
        const pill = document.getElementById('newWoSelectedClient');
        pill.innerHTML = this.icon('home', { size: 14, style: 'vertical-align:-2px' }) + ' ' + this._escapeHtml(client.name)
            + (client.address ? ' <span style="opacity:0.65;font-weight:400;font-size:12px">— ' + this._escapeHtml(client.address) + '</span>' : '')
            + ' <span class="x" title="Wissen" onclick="app._newWoClearSelection()">✕</span>';
        this._newWoUpdateSubmitState();
        setTimeout(() => document.getElementById('newWoReason').focus(), 50);
    },

    _newWoClearSelection() {
        if (!this._newWo) return;
        this._newWo.selectedClient = null;
        this._newWo.useNewClient = false;
        document.getElementById('newWoClientStep').style.display = '';
        document.getElementById('newWoSelectedStep').style.display = 'none';
        document.getElementById('newWoNewClientFields').style.display = 'none';
        document.getElementById('newWoClientSearch').value = '';
        document.getElementById('newWoClientResults').style.display = 'none';
        document.getElementById('newWoClientResults').innerHTML = '';
        document.getElementById('newWoNewClientPrompt').style.display = 'none';
        this._newWoUpdateSubmitState();
        setTimeout(() => document.getElementById('newWoClientSearch').focus(), 50);
    },

    newWoSwitchToNewClient() {
        if (!this._newWo) return;
        this._newWo.useNewClient = true;
        this._newWo.selectedClient = null;
        document.getElementById('newWoClientStep').style.display = 'none';
        document.getElementById('newWoSelectedStep').style.display = '';
        document.getElementById('newWoNewClientFields').style.display = '';
        const pill = document.getElementById('newWoSelectedClient');
        pill.innerHTML = '＋ Nieuwe klant <span class="x" title="Wissen" onclick="app._newWoClearSelection()">✕</span>';
        const q = document.getElementById('newWoClientSearch').value.trim();
        if (q) document.getElementById('newWoNewClientName').value = q;
        this._newWoUpdateSubmitState();
        setTimeout(() => document.getElementById('newWoNewClientName').focus(), 50);
    },

    _newWoUpdateSubmitState() {
        if (!this._newWo) return;
        const btn = document.getElementById('newWoSubmitBtn');
        const reason = document.getElementById('newWoReason').value.trim();
        let ok = reason.length >= 3;
        if (this._newWo.selectedClient) {
            // OK
        } else if (this._newWo.useNewClient) {
            const n = document.getElementById('newWoNewClientName').value.trim();
            const s = document.getElementById('newWoNewClientStreet').value.trim();
            const z = document.getElementById('newWoNewClientZip').value.trim();
            const c = document.getElementById('newWoNewClientCity').value.trim();
            ok = ok && n.length >= 2 && s.length >= 2 && z.length >= 3 && c.length >= 2;
        } else {
            ok = false;
        }
        btn.disabled = !ok;
    },

    async submitNewWorkOrder() {
        if (!this._newWo) return;
        const statusEl = document.getElementById('newWoStatus');
        const btn = document.getElementById('newWoSubmitBtn');
        statusEl.className = 'qe-newwo-status';
        statusEl.textContent = '';

        const reason = document.getElementById('newWoReason').value.trim();
        if (!reason) { statusEl.textContent = 'Vul een reden in'; return; }

        btn.disabled = true;
        const setStep = (txt) => { statusEl.textContent = txt; };

        try {
            let client = this._newWo.selectedClient;
            let addressForOrder = null;
            if (this._newWo.useNewClient) {
                setStep('Klant aanmaken…');
                const name   = document.getElementById('newWoNewClientName').value.trim();
                const street = document.getElementById('newWoNewClientStreet').value.trim();
                const zip    = document.getElementById('newWoNewClientZip').value.trim();
                const city   = document.getElementById('newWoNewClientCity').value.trim();
                const tel    = document.getElementById('newWoNewClientTel').value.trim();
                const created = await RobawsAPI.createClient({
                    name, addressLine1: street, postalCode: zip, city, country: 'België', tel,
                });
                client = { id: created.id, name: created.name, rawAddress: created.address };
                addressForOrder = created.address || { addressLine1: street, postalCode: zip, city, country: 'België' };
            } else if (client && client.rawAddress) {
                addressForOrder = client.rawAddress;
            }

            if (!client || !client.id) throw new Error('Geen klant geselecteerd');

            setStep('Order aanmaken…');
            const order = await RobawsAPI.createSalesOrder({
                clientId: client.id,
                title: reason,
                assignedUserId: this.currentUser.robawsUserId,
                salesAgentUserId: this.currentUser.robawsUserId,
                address: addressForOrder,
            });
            if (!order || !order.id) throw new Error('Order kreeg geen ID terug');

            setStep('Dagplanning aanmaken…');
            const now = new Date();
            const end = new Date(now.getTime() + 60 * 60 * 1000);
            const fmt = (d) => d.toISOString();
            await RobawsAPI.createPlanningItem({
                salesOrderId: order.id,
                clientId: client.id,
                employeeIds: [String(this.currentUser.robawsEmployeeId)],
                startDate: fmt(now),
                endDate:   fmt(end),
                summary: reason,
                description: reason,
                address: addressForOrder,
            });

            statusEl.className = 'qe-newwo-status ok';
            statusEl.textContent = 'Werkbon aangemaakt!';
            setTimeout(() => {
                this.closeNewWorkOrderModal();
                this.toast('Werkbon aangemaakt: ' + reason);
                try { this.loadPlanning(); } catch(_) {}
            }, 600);
        } catch (e) {
            console.warn('[App] nieuwe werkbon maken faalde:', e);
            statusEl.textContent = '' + (e && e.message || 'onbekende fout');
            btn.disabled = false;
        }
    },

    /** v128: zorg dat de scan-overlay CSS-keyframes 1x geïnjecteerd zijn. */
    _ensureScanOverlayStyles() {
        if (document.getElementById('qeScanOverlayStyles')) return;
        const style = document.createElement('style');
        style.id = 'qeScanOverlayStyles';
        style.textContent = `
            .qe-scan-backdrop {
                position: fixed; inset: 0; z-index: 99998;
                background: rgba(15, 23, 42, 0.55);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                display: flex; align-items: center; justify-content: center;
                padding: 24px;
                opacity: 0;
                transition: opacity 220ms ease-out;
            }
            .qe-scan-backdrop.qe-show { opacity: 1; }

            .qe-scan-card {
                background: #ffffff;
                border-radius: 22px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.08);
                padding: 36px 28px 28px;
                max-width: 360px; width: 100%;
                text-align: center;
                transform: scale(0.88) translateY(16px);
                opacity: 0;
                transition: transform 280ms cubic-bezier(0.18, 0.89, 0.32, 1.28),
                            opacity 200ms ease-out;
            }
            .qe-scan-backdrop.qe-show .qe-scan-card {
                transform: scale(1) translateY(0);
                opacity: 1;
            }
            .qe-scan-backdrop.qe-hiding {
                opacity: 0;
                transition: opacity 180ms ease-in;
            }
            .qe-scan-backdrop.qe-hiding .qe-scan-card {
                transform: scale(0.94);
                opacity: 0;
                transition: transform 180ms ease-in, opacity 180ms ease-in;
            }

            .qe-scan-icon-wrap {
                width: 84px; height: 84px;
                border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                margin: 0 auto 18px;
            }
            .qe-scan-icon-wrap.success { background: rgba(46, 125, 50, 0.12); }
            .qe-scan-icon-wrap.error   { background: rgba(198, 40, 40, 0.12); }
            .qe-scan-icon-wrap.loading { background: rgba(26, 35, 126, 0.10); }

            .qe-scan-icon-wrap svg { width: 56px; height: 56px; display: block; }
            .qe-scan-icon-wrap.success svg { color: #2e7d32; }
            .qe-scan-icon-wrap.error   svg { color: #c62828; }
            .qe-scan-icon-wrap.loading svg { color: #1A237E; animation: qeScanSpin 1s linear infinite; }

            /* SVG-stroke draw animations */
            .qe-check-path {
                stroke-dasharray: 50;
                stroke-dashoffset: 50;
                animation: qeDraw 450ms 120ms ease-out forwards;
            }
            .qe-cross-path {
                stroke-dasharray: 30;
                stroke-dashoffset: 30;
                animation: qeDraw 350ms 120ms ease-out forwards;
            }
            .qe-circle-path {
                stroke-dasharray: 190;
                stroke-dashoffset: 190;
                animation: qeDraw 500ms ease-out forwards;
            }
            @keyframes qeDraw { to { stroke-dashoffset: 0; } }
            @keyframes qeScanSpin { to { transform: rotate(360deg); } }

            .qe-scan-title {
                font-size: 24px; font-weight: 700;
                letter-spacing: 0.4px;
                margin: 0 0 8px;
            }
            .qe-scan-title.success { color: #2e7d32; }
            .qe-scan-title.error   { color: #c62828; }
            .qe-scan-title.loading { color: #1A237E; }

            .qe-scan-msg {
                font-size: 15px; line-height: 1.45;
                color: #455a64;
                white-space: pre-line;
                margin: 0;
            }
            .qe-scan-sub {
                font-size: 13px; color: #90a4ae;
                margin-top: 14px;
            }
            .qe-scan-tap-hint {
                margin-top: 20px;
                font-size: 12px; color: #b0bec5;
                letter-spacing: 0.5px;
            }
        `;
        document.head.appendChild(style);
    },

    /** Sluit een overlay met afsluit-animatie + roept callback.
     *  Element wordt alleen uit DOM verwijderd als het géén persistent
     *  wrapper is (#scanResult is persistent en wordt enkel verborgen). */
    _closeScanOverlay(el, onDone) {
        if (!el || el.dataset.closing === '1') return;
        el.dataset.closing = '1';
        el.classList.remove('qe-show');
        el.classList.add('qe-hiding');
        setTimeout(() => {
            if (el.id !== 'scanResult') {
                try { el.remove(); } catch(_) {}
            }
            if (typeof onDone === 'function') {
                try { onDone(); } catch (e) { console.warn('[Scan] onDone fout:', e); }
            }
        }, 200);
    },

    /**
     * v126/v128: Loading-overlay tussen scan en SUCCES/MISLUKT.
     * Card-stijl met spinner. Idempotent — meerdere showScanLoading
     * calls werken zonder duplicate overlays.
     */
    showScanLoading(message) {
        this._ensureScanOverlayStyles();
        let overlay = document.getElementById('scanLoading');
        if (overlay) {
            // bestaande overlay: update tekst
            const msgEl = overlay.querySelector('.qe-scan-msg');
            if (msgEl && message) msgEl.textContent = message;
            return;
        }
        overlay = document.createElement('div');
        overlay.id = 'scanLoading';
        overlay.className = 'qe-scan-backdrop';
        overlay.innerHTML = `
            <div class="qe-scan-card">
                <div class="qe-scan-icon-wrap loading">
                    <svg viewBox="0 0 50 50" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round">
                        <circle cx="25" cy="25" r="20" stroke-opacity="0.18" />
                        <path d="M25 5 a20 20 0 0 1 20 20" />
                    </svg>
                </div>
                <h3 class="qe-scan-title loading">Even geduld…</h3>
                <p class="qe-scan-msg">${this._escapeHtml(message || 'Bezig met verwerken…')}</p>
                <div class="qe-scan-sub">Robaws krijgt je scan binnen</div>
            </div>`;
        document.body.appendChild(overlay);
        // Force reflow voor de open-animatie
        // eslint-disable-next-line no-unused-expressions
        overlay.offsetWidth;
        overlay.classList.add('qe-show');
    },

    hideScanLoading() {
        const overlay = document.getElementById('scanLoading');
        if (overlay) this._closeScanOverlay(overlay);
    },

    /** Veilige escape voor inline HTML inserts (titel/melding). */
    _escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    /**
     * Card-stijl scan-resultaat overlay (SUCCES of MISLUKT).
     * v128: animatie + SVG icoons + professionele look.
     */
    showScanResult(success, message, onDone, duration) {
        this._ensureScanOverlayStyles();
        // Verberg loading direct (zonder fade) — anders zit hij in de weg
        const loading = document.getElementById('scanLoading');
        if (loading) { try { loading.remove(); } catch(_) {} }

        const overlay = document.getElementById('scanResult');
        if (!overlay) {
            this.toast(message);
            if (typeof onDone === 'function') { try { onDone(); } catch(_) {} }
            return;
        }

        // Reset eventuele oude classes/state (her-show na een eerdere result)
        overlay.classList.remove('qe-hiding', 'qe-show');
        overlay.removeAttribute('data-closing');
        overlay.className = 'qe-scan-backdrop';
        overlay.style.display = 'flex';
        overlay.onclick = null;

        const title = success ? 'Gelukt' : 'Mislukt';
        const iconSvg = success
            ? `<svg viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
                   <circle class="qe-circle-path" cx="26" cy="26" r="22" />
                   <path class="qe-check-path" d="M14 27 l8 8 l16 -16" />
               </svg>`
            : `<svg viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
                   <circle class="qe-circle-path" cx="26" cy="26" r="22" />
                   <path class="qe-cross-path" d="M18 18 l16 16" />
                   <path class="qe-cross-path" d="M34 18 l-16 16" />
               </svg>`;
        overlay.innerHTML = `
            <div class="qe-scan-card">
                <div class="qe-scan-icon-wrap ${success ? 'success' : 'error'}">${iconSvg}</div>
                <h3 class="qe-scan-title ${success ? 'success' : 'error'}">${this._escapeHtml(title)}</h3>
                <p class="qe-scan-msg">${this._escapeHtml(message || '')}</p>
                <div class="qe-scan-tap-hint">Tik om te sluiten</div>
            </div>`;
        // Force reflow + show
        // eslint-disable-next-line no-unused-expressions
        overlay.offsetWidth;
        overlay.classList.add('qe-show');

        try { if (navigator.vibrate) navigator.vibrate(success ? 120 : [80, 60, 80]); } catch(_) {}

        const dur = typeof duration === 'number' ? duration : (success ? 2200 : 6000);
        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            this._closeScanOverlay(overlay, () => {
                overlay.style.display = 'none';
                overlay.innerHTML = '';
                if (typeof onDone === 'function') {
                    try { onDone(); } catch(e) { console.warn('[Scan] onDone fout:', e); }
                }
            });
        };
        overlay.onclick = close;
        setTimeout(close, dur);
    },

    // ========================================
    // PLANNING POLLING — check op nieuwe items
    // ========================================
    _lastPlanningCount: null,
    _planningPollInterval: null,

    startPlanningPoll() {
        // Check elke 5 minuten of er nieuwe planning-items zijn
        if (this._planningPollInterval) clearInterval(this._planningPollInterval);
        this._planningPollInterval = setInterval(() => this._pollForNewPlanning(), 5 * 60 * 1000);
    },

    async _pollForNewPlanning() {
        if (!navigator.onLine || !this.currentUser) return;
        try {
            const date = this._localDateStr();
            const result = await RobawsAPI.getPlanning(this.currentUser.robawsEmployeeId, date, this.currentUser.robawsUserId);
            const items = (result.items || []).filter(it => !it.hasWerkbon);
            const count = items.length;

            if (this._lastPlanningCount !== null && count > this._lastPlanningCount) {
                const diff = count - this._lastPlanningCount;
                this.toast(` ${diff} nieuw${diff > 1 ? 'e' : ''} werkorder${diff > 1 ? 's' : ''} in planning!`);
                // Badge tonen op planning-scherm
                const badge = document.getElementById('woCount');
                if (badge) { badge.textContent = count; badge.style.background = 'var(--qe-orange)'; }
            }
            this._lastPlanningCount = count;
        } catch (e) { /* stille fout bij polling */ }
    },

    // ========================================
    // ONLINE/OFFLINE
    // ========================================
    updateOnlineStatus() {
        const isOnline = navigator.onLine;
        document.getElementById('offlineBar').classList.toggle('show', !isOnline);

        // Terug online? Sync database + verwerk wachtrij
        if (isOnline) {
            this.backgroundSync();
            // Klokdata synchroniseren
            if (typeof QEClock !== 'undefined' && QEClock.syncPending) {
                QEClock.syncPending().catch(e => console.warn('[App] Klok sync fout:', e));
            }
            // v146: probeer wachtende Mollie→Robaws updates opnieuw
            if (typeof this.processMollieRetryQueue === 'function') {
                this.processMollieRetryQueue().catch(e => console.warn('[App] Mollie retry fout:', e));
            }
        }
    },

    // ========================================
    // HELPERS
    // ========================================
    // Afrondingslogica voor facturatie:
    // - Wachturen → naar boven afronden per heel uur (60 min)
    // - Overige uren → naar boven afronden per half uur (30 min)
    roundHoursForInvoice(totalMinutes, uurcode) {
        if (!totalMinutes || totalMinutes <= 0) return 0;
        const isWacht = uurcode && (uurcode.name || '').toLowerCase().includes('wacht');
        const roundTo = isWacht ? 60 : 30; // minuten
        return Math.ceil(totalMinutes / roundTo) * roundTo;
    },

    // Pas afrondingslogica toe op de uren-array vóór submit.
    // Werkuren (klant) worden afgerond op basis van uurcode.
    // Het verschil wordt aan de laatste entry toegevoegd.
    _roundHoursForSubmit(hours) {
        if (!hours || hours.length === 0) return hours;
        const result = hours.map(h => ({ ...h }));

        // Bereken totaal werkuren
        const werkEntries = result.filter(h => h.type === 'klant');
        if (werkEntries.length > 0) {
            const totalRaw = werkEntries.reduce((sum, h) => sum + (h.duration || 0), 0);
            const totalRounded = this.roundHoursForInvoice(totalRaw, this.selectedUurcode);
            const diff = totalRounded - totalRaw;
            if (diff > 0) {
                // Voeg verschil toe aan de laatste werkuren entry
                werkEntries[werkEntries.length - 1].duration += diff;
            }
        }
        return result;
    },

    formatPrice(amount) {
        return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(amount || 0);
    },
    formatMinutes(mins) {
        if (!mins || mins <= 0) return '0:00';
        return `${Math.floor(mins / 60)}:${(mins % 60).toString().padStart(2, '0')}`;
    },
    /** Formatteer decimale uren (bijv. 1.75) als "1u 45m" */
    formatDecimalHours(decHours) {
        if (!decHours || decHours <= 0) return '0u 00m';
        const h = Math.floor(decHours);
        const m = Math.round((decHours - h) * 60);
        return `${h}u ${String(m).padStart(2, '0')}m`;
    },
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ========================================
    // ONDERHOUDSCHECKLIST
    // ========================================
    initChecklist() {
        const section = document.getElementById('checklistSection');
        const container = document.getElementById('checklistContainer');
        if (!section || !container || !window.ONDERHOUD_DATA) { if (section) section.style.display = 'none'; return; }

        const summary = this.currentWO?.summary || '';
        const checklistKey = ONDERHOUD_DATA.detectChecklist(summary);
        if (!checklistKey) { section.style.display = 'none'; return; }

        const checklist = ONDERHOUD_DATA.CHECKLISTS[checklistKey];
        if (!checklist) { section.style.display = 'none'; return; }

        // Herstel opgeslagen staat
        const woId = this.currentWO.id;
        const saved = this.woData[woId]?.checklist || {};

        document.getElementById('checklistTitle').textContent = '' + checklist.label;
        container.innerHTML = checklist.items.map(item => {
            const checked = saved[item.id] ? 'checked' : '';
            return `<label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--qe-grey-light);cursor:pointer">
                <input type="checkbox" ${checked} onchange="app.toggleChecklistItem('${checklistKey}','${item.id}',this.checked)"
                    style="width:20px;height:20px;min-width:20px;margin-top:1px;accent-color:var(--qe-green)">
                <span style="font-size:14px;line-height:1.4" id="clItem_${item.id}">${this.escapeHtml(item.text)}</span>
            </label>`;
        }).join('');

        // Voortgangsbalk
        const doneCount = Object.values(saved).filter(v => v).length;
        const totalCount = checklist.items.length;
        const pct = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;
        container.innerHTML += `<div style="margin-top:12px;display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:6px;background:var(--qe-grey-light);border-radius:3px;overflow:hidden">
                <div id="checklistProgress" style="height:100%;background:var(--qe-green);border-radius:3px;width:${pct}%;transition:width .3s"></div>
            </div>
            <span id="checklistPct" style="font-size:12px;color:var(--qe-grey);font-weight:500;min-width:36px;text-align:right">${pct}%</span>
        </div>`;

        section.style.display = '';
    },

    toggleChecklistItem(checklistKey, itemId, checked) {
        if (!this.currentWO) return;
        const woId = this.currentWO.id;
        if (!this.woData[woId].checklist) this.woData[woId].checklist = {};
        this.woData[woId].checklist[itemId] = checked;

        // Update voortgang
        const checklist = ONDERHOUD_DATA.CHECKLISTS[checklistKey];
        if (checklist) {
            const saved = this.woData[woId].checklist;
            const doneCount = Object.values(saved).filter(v => v).length;
            const pct = Math.round(doneCount / checklist.items.length * 100);
            const bar = document.getElementById('checklistProgress');
            const label = document.getElementById('checklistPct');
            if (bar) bar.style.width = pct + '%';
            if (label) label.textContent = pct + '%';
        }

        // Doorhalen van afgevinkte items
        const span = document.getElementById(`clItem_${itemId}`);
        if (span) span.style.textDecoration = checked ? 'line-through' : 'none';

        this._saveWoData();
    },

    /** v72: multi-line aware. Voor Tijdsregistratie-werkbonnen kan de remark
     * meerdere klok-in/klok-uit regels bevatten + eventueel mens-gerichte
     * notities. Strategie:
     *   1. Splits op nieuwe regels.
     *   2. Voor elke regel: strip 'klok-(in|uit):\s*' prefix en knip vanaf
     *      de eerste " — " of " - http" (whitespace verplicht).
     *   3. Concatenate de schone delen, gescheiden door '\n'.
     *   4. Lege regels worden weggegooid.
     * Tag-namen zonder spaties rond interne hyphens (bv. "1-XXD-141") blijven
     * intact omdat we \s+ aan beide kanten van de separator verplichten.
     */
    _publicRemark(remark) {
        if (!remark) return '';
        const cleanLine = (line) => {
            let s = String(line || '').replace(/^\s*klok-(in|uit):\s*/i, '');
            const m = s.match(/^(.*?)\s+[—-]\s+/);
            if (m) return m[1].trim();
            const httpIdx = s.indexOf('http');
            if (httpIdx > 0) return s.substring(0, httpIdx).replace(/[\s\-—]+$/, '').trim();
            return s.trim();
        };
        const lines = String(remark).split(/\r?\n/).map(cleanLine).filter(Boolean);
        // Dedupliceer opeenvolgende identieke entries (bv. 2x "Bureau" voor in+uit)
        const dedup = [];
        for (const l of lines) {
            if (dedup.length === 0 || dedup[dedup.length - 1] !== l) dedup.push(l);
        }
        return dedup.join('\n');
    },

    // ========================================
    // v59 TEST: éénmalige werkbon-aanmaak
    // ========================================
    async testCreateTimeRegistration() {
        const resultEl = document.getElementById('testTrResult');
        resultEl.style.color = 'var(--qe-grey)';
        resultEl.textContent = 'Bezig...';

        try {
            const user = RobawsAPI.getLoggedInUser();
            if (!user) throw new Error('Niet ingelogd');

            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const mi = String(now.getMinutes()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;
            const timeStr = `${hh}:${mi}`;

            const result = await RobawsAPI.createTimeRegistrationWorkOrder({
                employeeId: user.robawsEmployeeId,
                employeeName: user.name || user.email,
                userId: user.robawsUserId,
                dateStr: dateStr,
                ingeklokt: timeStr,
                tijdLabel: 'Op tijd',
                opmerking: 'TEST WERKBON - https://maps.google.com/?q=51.234,4.567',
            });

            resultEl.style.color = '#2e7d32';
            const woUrl = `https://app.robaws.com/work-orders/${result.workOrderId}`;
            resultEl.innerHTML = 'Werkbon aangemaakt: <a href="' + woUrl +
                '" target="_blank" style="color:#1565c0">#' + result.workOrderId +
                '</a>\n\nKlik link, controleer alle velden in Robaws, en stuur screenshot.';
        } catch (e) {
            resultEl.style.color = '#c62828';
            // Probeer ook de laatste req/res uit localStorage te tonen voor debugging
            let extra = '';
            try {
                const postRes = localStorage.getItem('qe_last_tr_post_res');
                const putReq = localStorage.getItem('qe_last_tr_put_req');
                const putRes = localStorage.getItem('qe_last_tr_put_res');
                if (postRes) extra += '\n\nPOST response: ' + postRes.slice(0, 200);
                if (putRes) extra += '\n\nPUT response: ' + putRes.slice(0, 300);
                if (putReq) extra += '\n\nPUT request body: ' + putReq.slice(0, 400);
            } catch(_) {}
            resultEl.textContent = 'FOUT: ' + e.message + extra;
        }
    },

    // ========================================
    // DARK MODE
    // ========================================
    toggleDarkMode(enabled) {
        document.body.classList.toggle('dark-mode', enabled);
        localStorage.setItem('qe_dark_mode', enabled ? '1' : '0');
    },
};

// Zet app expliciet op window zodat screen-guards in clock.js werken (v53)
window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
