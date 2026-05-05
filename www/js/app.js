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

    // Auto-save: sla woData op na elke wijziging
    _saveWoData() {
        try {
            // Sla alleen id/hours/materials/notes op (geen foto-data — te groot)
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
            if (!stored) return;
            const slim = JSON.parse(stored);
            for (const [id, d] of Object.entries(slim)) {
                if (!this.woData[id]) {
                    this.woData[id] = { hours: d.hours || [], materials: d.materials || [], photos: [], notes: d.notes || '', checklist: d.checklist || null, onderhoud: d.onderhoud || false };
                }
            }
        } catch (e) {}
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
        // Standaard PINs seeden (alleen als er nog geen PIN staat)
        if (typeof RobawsAPI !== 'undefined' && RobawsAPI.seedDefaultPins) {
            RobawsAPI.seedDefaultPins();
        }

        // Android back-knop: navigeer binnen de app i.p.v. afsluiten.
        if (!window._qeBackHandlerInstalled) {
            window.addEventListener('popstate', () => {
                const modal = document.getElementById('modalOverlay');
                if (modal && modal.classList.contains('show')) {
                    this.closeModal();
                    try { history.pushState({ qeApp: true }, '', location.pathname); } catch(_) {}
                    return;
                }
                if (this.currentScreen === 'screenPayment' || this.currentScreen === 'screenOverschrijving') {
                    this.screenHistory = [];
                    try { history.replaceState({ qeApp: true }, '', location.pathname); } catch(_) {}
                    this.navigate('screenPlanning', false);
                    this.loadPlanning();
                    return;
                }
                if (this.screenHistory.length > 0) {
                    const prev = this.screenHistory.pop();
                    this.navigate(prev, false);
                    return;
                }
            });
            try { history.replaceState({ qeApp: true }, '', location.pathname); } catch(_) {}
            window._qeBackHandlerInstalled = true;
        }
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
        // Check of er al een sessie is
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
            // Geen sessie of fout — toon login
            this.showLogin();
        }

        // Offline detection
        window.addEventListener('online', () => this.updateOnlineStatus());
        window.addEventListener('offline', () => this.updateOnlineStatus());
        this.updateOnlineStatus();

        // Timer herstellen als app weer zichtbaar wordt (na achtergrond)
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.timer.running) {
                // Herstart interval (was gestopt door OS) — elapsed wordt
                // correct berekend via Date.now() - startTime
                clearInterval(this.timer.interval);
                this.timer.interval = setInterval(() => this.updateTimerDisplay(), 1000);
                this.updateTimerDisplay();
            }
        });
    },

    // ========================================
    // LOGIN
    // ========================================
    showLogin() {
        document.getElementById('loginScreen').classList.remove('hidden');
    },

    // PIN-flow stap 1: e-mail controleren, daarna PIN-stap tonen
    async loginCheckEmail() {
        const email = document.getElementById('loginEmail').value.trim().toLowerCase();
        const errorEl = document.getElementById('loginError');
        const btn = document.getElementById('loginBtn');
        errorEl.textContent = '';

        if (!email) { errorEl.textContent = 'Vul je e-mailadres in'; return; }

        btn.disabled = true;
        btn.textContent = 'Even kijken...';
        try {
            const res = await fetch('api/auth.php?action=check-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
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
            errorEl.textContent = 'Verbindingsfout — probeer opnieuw';
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
            const data = await res.json();
            if (!res.ok || data.error || !data.success) {
                errorEl.textContent = data.error || 'Inloggen mislukt';
                return;
            }
            this.currentUser = data.user;
            this.showApp();
        } catch (e) {
            errorEl.textContent = 'Verbindingsfout — probeer opnieuw';
        } finally {
            btn.disabled = false;
            btn.textContent = this._loginNeedsPinSetup ? 'PIN instellen & inloggen' : 'Inloggen';
        }
    },

    // Behouden voor backward-compat (oude knoppen of code paths)
    doLogin() { return this.loginCheckEmail(); },

    logout() {
        fetch('api/auth.php?action=logout');
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
        // App versie tonen — haal uit version.json
        const versionEl = document.getElementById('appVersionInfo');
        if (versionEl) {
            fetch('version.json?t=' + Date.now()).then(r => r.json()).then(d => {
                versionEl.textContent = `Versie: ${d.version}`;
            }).catch(() => {
                const v = (window.QEBridge && QEBridge.getAppVersion) ? QEBridge.getAppVersion() : 0;
                versionEl.textContent = v > 0 ? `Versie: ${v}` : 'Versie onbekend';
            });
        }
        const updateStatus = document.getElementById('updateStatus');
        if (updateStatus) updateStatus.style.display = 'none';

        // === DEBUG NFC TESTER — verwijder dit blok na security audit ===
        this._maybeShowNfcTesterButton();
        // === EINDE DEBUG NFC TESTER ===

        this.navigate('screenProfile');
    },

    // === DEBUG NFC TESTER — verwijder deze methode na security audit ===
    _maybeShowNfcTesterButton() {
        if (this._nfcTesterChecked) {
            const btn = document.getElementById('btnDebugNfcTester');
            if (btn) btn.style.display = this._nfcTesterAvailable ? 'block' : 'none';
            return;
        }
        fetch('debug-nfc.html', { method: 'HEAD' }).then(r => {
            this._nfcTesterChecked = true;
            this._nfcTesterAvailable = r.ok;
            if (!r.ok) return;
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
            const pinCard = profile.querySelector('.card:has(input#profileOldPin)');
            if (pinCard) profile.insertBefore(card, pinCard);
            else profile.appendChild(card);
        }).catch(() => { this._nfcTesterChecked = true; this._nfcTesterAvailable = false; });
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
                    if (status) { status.style.color = 'var(--qe-green)'; status.textContent = `✅ Bijgewerkt naar versie ${newVersion}!`; }
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
    isMonteur() {
        return !!(this.currentUser && this.currentUser.role === 'monteur');
    },
    isTechnieker() {
        return !this.isMonteur();
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
        if (screenId === 'screenDagoverzicht') this.loadDagoverzicht();
        if (screenId === 'screenClock') this.onNavigateToClock();
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
    // DATE STRIP — alleen vandaag en morgen
    // ========================================
    buildDateStrip() {
        const strip = document.getElementById('dateStrip');
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
        const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

        const dates = [today, tomorrow];

        strip.innerHTML = dates.map(d => {
            const dateStr = d.toISOString().split('T')[0];
            const isToday = d.toDateString() === today.toDateString();
            const isActive = d.toDateString() === this.currentDate.toDateString();
            const label = isToday ? 'Vandaag' : 'Morgen';

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
        list.innerHTML = '<div class="spinner"></div>';

        const dateStr = this.currentDate.toISOString().split('T')[0];

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
                const isToday = dateStr === new Date().toISOString().split('T')[0];
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">📋</div>
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
                    <div class="empty-icon">⚠️</div>
                    <h3>Fout bij laden</h3>
                    <p style="font-size:12px;color:var(--qe-grey);word-break:break-all;margin-bottom:8px">${this.escapeHtml(err.message)}</p>
                    <button class="btn btn-primary btn-sm" onclick="app.loadPlanning()">Opnieuw proberen</button>
                </div>
            `;
        }
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

        return `
            <div class="card card-clickable" onclick="app.openWorkorder('${wo.id}')">
                <div class="wo-card">
                    <div class="wo-time">
                        <div class="t-hour">${timeStr}</div>
                    </div>
                    <div class="wo-info">
                        <h3>${this.escapeHtml(clientName)}</h3>
                        ${wo.summary ? `<div style="font-size:13px;color:var(--qe-darkblue);font-weight:500;margin:2px 0">${this.escapeHtml(wo.summary)}</div>` : ''}
                        ${address ? `<div class="wo-address">📍 ${this.escapeHtml(address)}</div>` : ''}
                        <span class="wo-type ${type}">${typeLabel}</span>
                        ${orderNr ? `<span style="margin-left:6px;font-size:11px;color:var(--qe-purple);font-weight:500">${this.escapeHtml(orderNr)}</span>` : ''}
                        ${histBadge}
                        ${hasMaterials || hasHours ? '<span style="margin-left:6px;font-size:11px;color:var(--qe-green)">✓ In bewerking</span>' : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;align-items:center;flex-shrink:0">
                        ${tel ? `<a href="tel:${this.escapeHtml(tel)}" class="wo-nav-btn" onclick="event.stopPropagation()" title="Bel klant" style="text-decoration:none">📞</a>` : ''}
                        ${address ? `<button class="wo-nav-btn" onclick="event.stopPropagation(); app.navigateToAddress('${this.escapeHtml(address).replace(/'/g, "\\'")}')" title="Navigeer">🧭</button>` : ''}
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
            for (const cid of clientIds) {
                try {
                    const res = await fetch(`api/werkbon-queue.php?action=countByClient&clientId=${cid}`);
                    const data = await res.json();
                    if (data.count !== undefined) {
                        this._clientHistoryCache[cid] = data.count;
                    } else {
                        this._clientHistoryCache[cid] = localCounts[cid] || 0;
                    }
                } catch(e) {
                    this._clientHistoryCache[cid] = localCounts[cid] || 0;
                }
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

        document.getElementById('clientInfo').innerHTML = `
            <div class="info-row">
                <span class="info-icon">👤</span>
                <span class="info-label">Naam</span>
                <span class="info-value">${this.escapeHtml(client.name || 'Onbekend')}</span>
            </div>
            <div class="info-row">
                <span class="info-icon">📍</span>
                <span class="info-label">Adres</span>
                <span class="info-value">${this.escapeHtml(displayAddress || '-')}</span>
            </div>
            ${planTimeStr ? `<div class="info-row">
                <span class="info-icon">🕐</span>
                <span class="info-label">Gepland</span>
                <span class="info-value">${this.escapeHtml(planTimeStr)}</span>
            </div>` : ''}
            ${planDescription ? `<div class="info-row">
                <span class="info-icon">📋</span>
                <span class="info-label">Omschrijving</span>
                <span class="info-value">${planDescription.replace(/<[^>]*>/g, '') || '-'}</span>
            </div>` : ''}
            <div class="info-row">
                <span class="info-icon">📞</span>
                <span class="info-label">Telefoon</span>
                <span class="info-value">${client.tel ? `<a href="tel:${client.tel}">${this.escapeHtml(client.tel)}</a>` : '-'}</span>
            </div>
            <div class="info-row">
                <span class="info-icon">✉️</span>
                <span class="info-label">Email</span>
                <span class="info-value">${client.email ? `<a href="mailto:${client.email}">${this.escapeHtml(client.email)}</a>` : '-'}</span>
            </div>
            <div class="info-row btw-row" style="background:rgba(106,44,145,0.06);border-radius:8px;padding:8px 12px;margin-top:4px">
                <span class="info-icon">💰</span>
                <span class="info-label">BTW tarief</span>
                <span class="info-value" id="clientVatDisplay" style="font-weight:600;color:var(--qe-purple)">${client.vatTariffName ? this.escapeHtml(client.vatTariffName) : (client.vatPercentage !== null && client.vatPercentage !== undefined ? client.vatPercentage + '%' : 'Niet ingesteld')}</span>
            </div>
            ${client.id ? `<button class="btw-change-btn" onclick="app.openChangeVatTariff()"
                style="width:100%;margin-top:8px;padding:10px;border:2px solid var(--qe-purple);border-radius:10px;
                background:transparent;color:var(--qe-purple);font-size:14px;font-weight:600;cursor:pointer;
                display:flex;align-items:center;justify-content:center;gap:6px">
                💰 BTW tarief aanpassen
            </button>` : ''}
            ${displayAddress ? `
            <button onclick="app.navigateToAddress('${this.escapeHtml(displayAddress).replace(/'/g, "\\'")}')"
                style="width:100%;margin-top:10px;padding:12px;border:none;border-radius:10px;
                background:linear-gradient(135deg,#6A2C91,#001E45);color:#fff;
                font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;
                justify-content:center;gap:8px;box-shadow:0 2px 8px rgba(106,44,145,0.3)">
                🧭 Navigeer naar adres
            </button>` : ''}
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

        // Load installations — alleen die van de dagplanning
        const installationIds = this.currentWO.installationIds || [];
        if (installationIds.length > 0) {
            this.loadInstallations(null, installationIds);
        } else if (client.id) {
            this.loadInstallations(client.id, []);
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
                        ✏️ Installatie bewerken
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
            this.toast('Installatie bijgewerkt ✓');
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
                        <span>📄</span>
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

        document.getElementById('modalContent').innerHTML =
            `<h3>${label} — controleer tijden</h3><div class="spinner" style="margin:20px auto"></div>`;
        this.openModal();

        const hourOpts = (sel) => Array.from({length: 24}, (_, i) =>
            `<option value="${i}" ${i === sel ? 'selected' : ''}>${String(i).padStart(2,'0')}</option>`).join('');
        const minOpts = (sel) => Array.from({length: 60}, (_, m) =>
            `<option value="${m}" ${m === sel ? 'selected' : ''}>${String(m).padStart(2,'0')}</option>`).join('');
        const pauzeOpts = [0, 15, 30, 45, 60].map(m =>
            `<option value="${m}" ${m === 0 ? 'selected' : ''}>${m} min</option>`).join('');

        const empIds = this.currentWO ? (this.currentWO.employeeIds || []) : [];
        let employees = [];
        if (empIds.length > 0) {
            try { employees = await this._getEmployeeNames(empIds); } catch(e) {}
        }
        if (employees.length === 0 && this.currentUser) {
            employees = [{ id: String(this.currentUser.robawsEmployeeId), name: this.currentUser.name || 'Ik' }];
        }
        const currentEmpId = this.currentUser ? String(this.currentUser.robawsEmployeeId) : '';
        const employeeSelect = employees.length > 0 ? `
            <div class="form-group" style="margin-bottom:12px">
                <label>👷 Werknemer</label>
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
                <label>☕ Pauze</label>
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

        const empSelect = document.getElementById('tcEmployee');
        const employeeId = empSelect ? empSelect.value : (this.currentUser ? String(this.currentUser.robawsEmployeeId) : null);
        const employeeName = empSelect ? empSelect.options[empSelect.selectedIndex].text : (this.currentUser ? this.currentUser.name : '');

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
        'Jaarlijks onderhoud uitgevoerd conform voorschriften.',
        'Installatie werkt naar behoren na interventie.',
        'Klant is op de hoogte gebracht van de toestand.',
        'Onderdeel besteld — vervolgafspraak nodig.',
        'Storing verholpen — testrun OK.',
        'Ketel gereinigd en bijgevuld.',
        'Koelmiddel bijgevuld.',
        'Filters vervangen.',
        'Klant was niet aanwezig — buur heeft toegang verleend.',
        'Garantie-interventie — geen kost voor klant.',
    ],

    renderNoteTemplates() {
        const bar = document.getElementById('noteTemplatesBar');
        if (!bar) return;
        bar.innerHTML = this.NOTE_TEMPLATES.map((t, i) => {
            // Toon alleen de eerste paar woorden als label
            const label = t.length > 35 ? t.substring(0, 32) + '...' : t;
            return `<button class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px;white-space:nowrap" onclick="app.insertNoteTemplate(${i})">${this.escapeHtml(label)}</button>`;
        }).join('');
    },

    insertNoteTemplate(index) {
        const template = this.NOTE_TEMPLATES[index];
        if (!template || !this.currentWO) return;
        const ta = document.getElementById('workNotes');
        const current = ta.value;
        // Voeg toe met een nieuwe regel als er al tekst staat
        const newVal = current ? current.trimEnd() + '\n' + template : template;
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
                <label>👷 Werknemer</label>
                <select class="form-input" id="hourEmployee">
                    ${employees.map(e => `<option value="${e.id}" ${String(e.id) === currentEmpId ? 'selected' : ''}>${e.name}</option>`).join('')}
                </select>
            </div>` : '';

        document.getElementById('modalContent').innerHTML = `
            <h3>${label}</h3>
            ${employeeSelect}
            <div class="form-group" style="margin-bottom:12px">
                <label>Van</label>
                <div style="display:flex;gap:8px;align-items:center">
                    <select class="form-input" id="fromH" style="flex:1">${hourOpts(nowH)}</select>
                    <span style="font-size:20px;font-weight:600">:</span>
                    <select class="form-input" id="fromM" style="flex:1">${minOpts(nowM)}</select>
                </div>
            </div>
            <div class="form-group" style="margin-bottom:12px">
                <label>Tot</label>
                <div style="display:flex;gap:8px;align-items:center">
                    <select class="form-input" id="toH" style="flex:1">${hourOpts((nowH + 1) % 24)}</select>
                    <span style="font-size:20px;font-weight:600">:</span>
                    <select class="form-input" id="toM" style="flex:1">${minOpts(nowM)}</select>
                </div>
            </div>
            <div class="form-group" style="margin-bottom:12px">
                <label>☕ Pauze</label>
                <select class="form-input" id="hourPauze">${pauzeOpts}</select>
            </div>
            <button class="btn btn-primary btn-full mt-16" onclick="app.saveManualHours('${type}')">Opslaan</button>
            <button class="btn btn-outline btn-full" style="margin-top:8px" onclick="app.closeModal()">Annuleren</button>
        `;
    },

    saveManualHours(type) {
        const fh = parseInt(document.getElementById('fromH').value);
        const fm = parseInt(document.getElementById('fromM').value);
        const th = parseInt(document.getElementById('toH').value);
        const tm = parseInt(document.getElementById('toM').value);
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

        const icons = { klant: '🔧', verplaatsing: '🚗', pauze: '☕' };
        const labels = { klant: 'Werkuren', verplaatsing: 'Verplaatsing', pauze: 'Pauze' };

        container.innerHTML = data.hours.map(h => {
            const empLabel = h.employeeName ? `<div style="font-size:11px;color:var(--qe-purple);font-weight:500">👷 ${this.escapeHtml(h.employeeName)}</div>` : '';
            const pauzeLabel = h.pauze && h.pauze > 0 ? `<span style="font-size:11px;color:var(--qe-grey);margin-left:4px">(☕${h.pauze}m)</span>` : '';
            return `
            <div class="hour-entry">
                <div class="he-type ${h.type}">${icons[h.type] || '🔧'}</div>
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
    // ONDERHOUD — werkuren niet factureren
    // ========================================
    toggleOnderhoud(checked) {
        if (!this.currentWO) return;
        const data = this.woData[this.currentWO.id];
        data.onderhoud = checked;
        const label = document.getElementById('onderhoudLabel');
        if (label) {
            label.textContent = checked
                ? 'Werkuren worden NIET gefactureerd'
                : 'Werkuren worden gefactureerd';
            label.style.color = checked ? 'var(--qe-purple)' : 'var(--qe-grey)';
            label.style.fontWeight = checked ? '600' : '400';
        }
        this._saveWoData();
    },

    _restoreOnderhoud() {
        if (!this.currentWO) return;
        const section = document.getElementById('onderhoudSection');
        // Monteurs mogen geen onderhoud aanvinken
        const isMonteur = this.currentUser && this.currentUser.role === 'monteur';
        if (section) section.style.display = isMonteur ? 'none' : 'flex';
        if (isMonteur) return;
        const data = this.woData[this.currentWO.id];
        const cb = document.getElementById('onderhoudCheckbox');
        if (cb) cb.checked = !!data.onderhoud;
        this.toggleOnderhoud(!!data.onderhoud);
    },

    // ========================================
    // MATERIALEN
    // ========================================
    async searchMaterials(query) {
        clearTimeout(this.searchTimeout);
        const container = document.getElementById('materialSearchResults');

        if (query.length < 2) { container.style.display = 'none'; return; }

        this.searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`api/articles.php?action=search&name=${encodeURIComponent(query)}&limit=20`);
                const data = await res.json();
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
                                <span class="monteur-hide" style="font-weight:500;color:var(--qe-darkblue)">${this.formatPrice(art.salePrice || art.unitPrice)}</span>
                            </div>
                        </div>
                    `).join('');
                }
                container.style.display = 'block';
            } catch (err) {
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
        // Bijhouden voor veelgebruikte materialen
        this._trackFavoriteMaterial(article);
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
            <h3 style="font-size:16px;margin-bottom:12px">⚠️ Materiaal ontbreekt</h3>
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
            <button class="btn btn-primary btn-full" onclick="app._sendMissingMaterial()">📧 Verstuur melding</button>
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
            const tariffs = this._vatTariffsCache;
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
            this.toast('BTW tarief bijgewerkt ✓');
        } catch (err) {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓ Opslaan'; }
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
        document.getElementById('onderhoudCatLabel').textContent = cat.icon + ' ' + cat.label;
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
                (this._ohArticle.salePrice ? `<br><span class="monteur-hide">Prijs: ${this.formatPrice(this._ohArticle.salePrice)}</span>` : '');
            document.getElementById('onderhoudStep2').style.display = 'none';
            document.getElementById('onderhoudResult').style.display = '';
            return;
        }

        this._ohShowStep3(cat, size);
    },

    _ohShowStep3(cat, size) {
        document.getElementById('onderhoudSizeLabel').textContent =
            cat.icon + ' ' + cat.label + ' — ' + size.label;
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
            (this._ohArticle.salePrice ? `<br><span class="monteur-hide">Prijs: ${this.formatPrice(this._ohArticle.salePrice)}</span>` : '');
        document.getElementById('onderhoudStep3').style.display = 'none';
        document.getElementById('onderhoudResult').style.display = '';
    },

    onderhoudBack(toStep) {
        document.getElementById('onderhoudStep1').style.display = toStep === 1 ? '' : 'none';
        document.getElementById('onderhoudStep2').style.display = toStep === 2 ? '' : 'none';
        document.getElementById('onderhoudStep3').style.display = 'none';
        document.getElementById('onderhoudResult').style.display = 'none';
        this._ohArticle = null;
    },

    onderhoudAddToMaterials() {
        if (!this._ohArticle || !this.currentWO) return;
        this.addMaterial(this._ohArticle);

        // Verplaatsingskosten worden NIET apart toegevoegd bij onderhoud —
        // de verplaatsing zit al verrekend in de onderhoudsprijs (zone-gebaseerd).

        // Reset naar stap 1
        this.initOnderhoudPicker();
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
        if (n.includes('verplaatsing') || n.includes('transport')) return { icon: '🚗', bg: 'linear-gradient(135deg,#e3f2fd,#bbdefb)' };
        if (n.includes('koper') || n.includes('koperen') || n.includes('leiding')) return { icon: '🔧', bg: 'linear-gradient(135deg,#fff3e0,#ffe0b2)' };
        if (n.includes('mannesmann') || n.includes('buis') || n.includes('pijp')) return { icon: '🏗️', bg: 'linear-gradient(135deg,#efebe9,#d7ccc8)' };
        if (n.includes('onderhoud') || n.includes('service')) return { icon: '🛠️', bg: 'linear-gradient(135deg,#e8f5e9,#c8e6c9)' };
        if (n.includes('expansie') || n.includes('vat')) return { icon: '🫙', bg: 'linear-gradient(135deg,#fce4ec,#f8bbd0)' };
        if (n.includes('thermostaat') || n.includes('regeling') || n.includes('temp')) return { icon: '🌡️', bg: 'linear-gradient(135deg,#e8eaf6,#c5cae9)' };
        if (n.includes('bosch') || n.includes('junker')) return { icon: '🔥', bg: 'linear-gradient(135deg,#fff8e1,#ffecb3)' };
        if (n.includes('ketel') || n.includes('cv')) return { icon: '♨️', bg: 'linear-gradient(135deg,#fbe9e7,#ffccbc)' };
        if (n.includes('atag') || n.includes('remeha') || n.includes('vaillant')) return { icon: '🏭', bg: 'linear-gradient(135deg,#f3e5f5,#e1bee7)' };
        if (n.includes('radiat') || n.includes('convect')) return { icon: '🔲', bg: 'linear-gradient(135deg,#e0f7fa,#b2ebf2)' };
        if (n.includes('pomp') || n.includes('circul')) return { icon: '💧', bg: 'linear-gradient(135deg,#e1f5fe,#b3e5fc)' };
        if (n.includes('ventiel') || n.includes('kraan') || n.includes('afsluit')) return { icon: '🔩', bg: 'linear-gradient(135deg,#eceff1,#cfd8dc)' };
        if (n.includes('elektr') || n.includes('kabel') || n.includes('draad')) return { icon: '⚡', bg: 'linear-gradient(135deg,#fffde7,#fff9c4)' };
        if (n.includes('sanitair') || n.includes('douche') || n.includes('bad')) return { icon: '🚿', bg: 'linear-gradient(135deg,#e0f2f1,#b2dfdb)' };
        if (n.includes('gas') || n.includes('brandstof')) return { icon: '🔥', bg: 'linear-gradient(135deg,#fff3e0,#ffe0b2)' };
        if (n.includes('filter') || n.includes('zuiver')) return { icon: '🧹', bg: 'linear-gradient(135deg,#f1f8e9,#dcedc8)' };
        if (n.includes('isolatie') || n.includes('isoleer')) return { icon: '🧱', bg: 'linear-gradient(135deg,#efebe9,#d7ccc8)' };
        return { icon: '📦', bg: 'linear-gradient(135deg,rgba(249,157,62,0.12),rgba(106,44,145,0.1))' };
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
                <div style="font-size:28px;margin-bottom:8px">📭</div>
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

        files.forEach((file, i) => {
            // Comprimeer foto's om geheugen te besparen
            this.compressPhoto(file, (dataUrl) => {
                const name = file.name || `foto_${Date.now()}_${i}.jpg`;
                this.woData[this.currentWO.id].photos.push({
                    id: Date.now() + i,
                    data: dataUrl,
                    name: name,
                });
                loaded++;
                if (loaded === files.length) {
                    this.renderPhotos();
                    this.toast(`${files.length} foto('s) toegevoegd`);
                }
            });
        });
        input.value = '';
    },

    compressPhoto(file, callback) {
        const maxWidth = 1600;
        const maxHeight = 1600;
        const quality = 0.7;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Bereken nieuwe dimensies
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
            };
            img.onerror = () => {
                // Fallback: gebruik origineel als compressie mislukt
                callback(e.target.result);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
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
            content.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><h3>Geen items</h3></div>';
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
                        <span style="font-size:20px">${checked ? '✅' : '📦'}</span>
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
            if (icon) icon.textContent = checked ? '✅' : '📦';
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
        list.innerHTML = docs.map(doc => {
            const icon = this._getFileIcon(doc.contentType);
            const sizeStr = doc.size > 0 ? this._formatFileSize(doc.size) : '';
            return `
                <div class="card" style="display:flex;align-items:center;gap:12px;padding:12px 16px;margin-bottom:8px;cursor:pointer"
                     onclick="app.downloadPlanDocument('${doc.id}', '${this.escapeHtml(doc.name).replace(/'/g, "\\'")}')"
                    <span style="font-size:24px">${icon}</span>
                    <div style="flex:1;min-width:0">
                        <div style="font-size:14px;font-weight:500;color:var(--qe-darkblue);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHtml(doc.name)}</div>
                        ${sizeStr ? `<div style="font-size:12px;color:var(--qe-grey)">${sizeStr}</div>` : ''}
                    </div>
                    <span style="font-size:20px;color:var(--qe-purple)">⬇️</span>
                </div>`;
        }).join('');
    },

    _getFileIcon(contentType) {
        if (!contentType) return '📄';
        if (contentType.includes('image')) return '🖼️';
        if (contentType.includes('pdf')) return '📕';
        if (contentType.includes('word') || contentType.includes('document')) return '📘';
        if (contentType.includes('sheet') || contentType.includes('excel')) return '📊';
        return '📄';
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
                        <button class="btn btn-primary" onclick="app._saveBlobToDevice('${docId}', '${this.escapeHtml(fileName).replace(/'/g, "\\'")}')">💾 Opslaan</button>
                    </div>
                `);
            } else if (contentType.includes('pdf')) {
                this.showModal(`
                    <div style="text-align:center">
                        <h3 style="margin-bottom:12px">${this.escapeHtml(fileName)}</h3>
                        <iframe src="${blobUrl}" style="width:100%;height:70vh;border:none;border-radius:8px"></iframe>
                        <br><br>
                        <button class="btn btn-primary" onclick="app._saveBlobToDevice('${docId}', '${this.escapeHtml(fileName).replace(/'/g, "\\'")}')">💾 Opslaan</button>
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

        // Kritiek
        if (!data.hours || data.hours.filter(h => h.type === 'klant').length === 0) {
            warnings.push({ level: 'error', msg: 'Geen werkuren geregistreerd' });
        }
        if (!this.selectedUurcode) {
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
            const icons = { error: '❌', warn: '⚠️', info: 'ℹ️' };
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
                `<div class="day-hours-row"><span>👷 ${this.escapeHtml(name)}</span><span style="font-weight:500">${this.formatMinutes(d.duration)}${d.pauze > 0 ? ` <span style="font-size:11px;color:var(--qe-grey)">(☕${d.pauze}m)</span>` : ''}</span></div>`
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
                </div>`;
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
                <div class="total-row subtotal"><span>Totaal incl. 21% BTW</span><span style="font-weight:500">${this.formatPrice(subtotal + btw21)}</span></div>`;
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
                btn.innerHTML = '📤 Uren & materiaal versturen';
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
                btn.innerHTML = '✍️ Ondertekenen & Versturen';
                btn.onclick = () => this.startSubmitFlow();
                btn.disabled = true; // Pas actief na betaalmethode selectie
            }
        }

        // Bewaar vatTariffId op currentWO voor factuur-aanmaak
        // Robaws vat-tariff IDs: 1=21%, 2=12%, 3=0%, 4=6%
        if (client.vatPercentage === 6) this.currentWO.vatTariffId = '4';
        else if (client.vatPercentage === 21) this.currentWO.vatTariffId = '1';
        else if (client.vatPercentage === 12) this.currentWO.vatTariffId = '2';
        else if (client.vatPercentage === 0) this.currentWO.vatTariffId = '3';

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
                    date: this.currentDate.toISOString().split('T')[0],
                    materials: data.materials.map(m => ({
                        articleId: m.id,
                        name: m.name,
                        quantity: m.quantity,
                        unitPrice: m.salePrice || m.unitPrice,
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

                this.toast('Werkbon verstuurd ✓');
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
                date: this.currentDate.toISOString().split('T')[0],
                materials: data.materials.map(m => ({
                    articleId: m.id,
                    name: m.name,
                    quantity: m.quantity,
                    unitPrice: m.salePrice || m.unitPrice,
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
        const canvas = document.getElementById('signatureCanvas');
        if (!canvas) return;

        // Stel canvas resolutie in op basis van werkelijke grootte
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;

        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);
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

        const start = (e) => {
            e.preventDefault();
            this.signatureDrawing = true;
            const p = getPos(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
        };
        const move = (e) => {
            if (!this.signatureDrawing) return;
            e.preventDefault();
            const p = getPos(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            this.signatureHasContent = true;
        };
        const end = () => { this.signatureDrawing = false; };

        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);
        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', end);
        canvas.addEventListener('mouseleave', end);
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

    // ========================================
    // UNIFIED SUBMIT FLOW
    // ========================================
    startSubmitFlow() {
        if (!this.currentWO) return;

        if (this.isMonteur()) {
            return this.executeMonteurSubmitFlow();
        }

        // Valideer betaalmethode
        if (!this._selectedPaymentMethod) {
            this.toast('Kies eerst een betaalmethode');
            return;
        }

        // Overschrijving ter plaatse: geen extra validatie nodig (QR scherm wordt getoond)

        const section = document.getElementById('wbSignatureSection');
        const btn = document.getElementById('btnSubmitWerkbon');

        if (section.style.display === 'none') {
            section.style.display = 'block';
            section.scrollIntoView({ behavior: 'smooth' });
            btn.innerHTML = '✓ Ondertekenen & Versturen';
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
            date: this.currentDate.toISOString().split('T')[0],
            // Regie-vinkje overnemen van de sales order (niet hardcoded true)
            timeAndMaterial: this.currentWO.timeAndMaterial ?? false,
            materials: data.materials.map(m => ({
                articleId: m.id,
                name: m.name,
                quantity: m.quantity,
                unitPrice: m.salePrice || m.unitPrice,
            })),
            hours: this._roundHoursForSubmit(data.hours),
            notes: data.notes,
            uurcode: this.selectedUurcode,
            verplaatsingCode: this.verplaatsingCode,
            paymentMethod: this._selectedPaymentMethod,
            onderhoud: data.onderhoud || false,
        };
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

            // === STAP 2: Foto's + handtekening ===
            await this._uploadPhotosAndSignature(data, workOrderId, signatureName, signatureData);

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
                materials: data.materials.map(m => ({
                    articleId: m.id,
                    name: m.name,
                    quantity: m.quantity || 1,
                    unitPrice: m.salePrice || m.unitPrice || 0,
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

            this._markWOSubmitted(data);

            // === STAP 4: Betaalmethode-specifieke afhandeling ===
            if (paymentMethod === 'Viva wallet') {
                // Viva Wallet → toon betaalscherm met terminal/QR
                this.showPaymentScreen(invoiceResult);
            } else if (paymentMethod === 'Overschrijving ter plaatse') {
                // Overschrijving ter plaatse → toon betaalscherm met QR code
                this.showOverschrijvingScreen(invoiceResult);
            } else {
                // Cash of Niet Ontvangen → enkel factuur, klaar
                this.toast(`Werkbon verstuurd — betaling: ${paymentMethod} ✓`);
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
            btn.innerHTML = '✍️ Ondertekenen & Versturen';
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
                    date: this.currentDate.toISOString().split('T')[0],
                    timeAndMaterial: this.currentWO.timeAndMaterial ?? false,
                    materials: data.materials.map(m => ({
                        articleId: m.id,
                        name: m.name,
                        quantity: m.quantity,
                        unitPrice: m.salePrice || m.unitPrice,
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

            this.toast('Werkbon verstuurd ✓');

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
            btn.innerHTML = '📤 Uren & materiaal versturen';
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
            const icon = type === 'ApplePos' ? '📱' : type === 'Datecs BlueLite' ? '🖨️' : '📲';
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
        if (selIcon) { selIcon.style.background = 'var(--qe-purple)'; selIcon.style.color = '#fff'; selIcon.textContent = '✓'; }

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

        if (isActive || clockTime) {
            // Ingeklokt of al gescand vandaag
            const lateClass = isLate ? 'background:linear-gradient(135deg,#fff3e0,#ffccbc)' : 'background:linear-gradient(135deg,#e8f5e9,#c8e6c9)';
            bar.style.cssText = `display:block;padding:12px 16px;border-radius:12px;margin-bottom:12px;cursor:pointer;${lateClass}`;
            icon.textContent = isLate ? '⚠️' : '✅';
            const activeTag = QEClock.getActiveTagName();
            text.textContent = isActive ? `Actief sinds ${session.startTime}` : `Ingeklokt om ${clockTime}`;
            text.style.color = isLate ? '#e65100' : '#2e7d32';
            sub.textContent = isLate ? 'Te laat!' : (activeTag || 'Uitgeklokt');
            sub.style.color = isLate ? '#e65100' : '#2e7d32';
        } else {
            // Nog niet ingeclockt
            const isLateNow = QEClock.isLate();
            const bg = isLateNow ? 'background:linear-gradient(135deg,#fce4ec,#ffcdd2)' : 'background:linear-gradient(135deg,#e3f2fd,#bbdefb)';
            bar.style.cssText = `display:block;padding:12px 16px;border-radius:12px;margin-bottom:12px;cursor:pointer;${bg}`;
            icon.textContent = isLateNow ? '🚨' : '⏰';
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

        if (isActive) {
            const isLate = session.registrationType === 'Te laat';
            const isLL = session.registrationType === 'Laden & Lossen';
            bigStatus.textContent = isLL ? '📦' : (isLate ? '⚠️' : '✅');
            bigText.textContent = isLL ? 'Laden & Lossen' : 'Ingeklokt';
            bigText.style.color = isLate ? '#e65100' : 'var(--qe-green)';
            bigTime.textContent = `${session.startTime} — ${session.tagName}${isLate ? ' (te laat)' : ''}`;

            // Verberg NFC instructie, toon actieve sessie
            document.getElementById('clockNfcCard').style.display = 'none';
            const activeEl = document.getElementById('clockActiveSession');
            if (activeEl) {
                activeEl.style.display = 'block';
                document.getElementById('clockActiveContent').innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                        <h3 style="margin:0;font-size:16px;color:var(--qe-darkblue)">🔄 Actieve registratie</h3>
                        <span style="background:${isLL ? '#e3f2fd' : '#e8f5e9'};color:${isLL ? '#1565c0' : '#2e7d32'};font-size:11px;padding:2px 8px;border-radius:8px;font-weight:600">${session.registrationType}</span>
                    </div>
                    <div style="display:flex;gap:16px;margin-bottom:8px">
                        <div><span style="font-size:12px;color:var(--qe-grey)">Start</span><br><span style="font-size:15px;font-weight:600">${session.startTime}</span></div>
                        <div><span style="font-size:12px;color:var(--qe-grey)">Locatie</span><br><span style="font-size:15px;font-weight:600">${session.tagName}</span></div>
                    </div>
                    <p style="font-size:13px;color:var(--qe-grey);margin:0">Scan opnieuw een NFC tag om uit te clocken</p>
                `;
            }
        } else {
            const isLateNow = QEClock.isLate();
            if (clockTime) {
                bigStatus.textContent = '🏁';
                bigText.textContent = 'Uitgeklokt';
                bigText.style.color = 'var(--qe-darkblue)';
                bigTime.textContent = `Eerste scan: ${clockTime}`;
            } else {
                bigStatus.textContent = isLateNow ? '🚨' : '⏰';
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
                        <div style="font-size:32px;margin-bottom:8px">📵</div>
                        <div style="font-size:15px;font-weight:600;margin-bottom:4px">NFC niet beschikbaar</div>
                        <div style="font-size:13px;color:var(--qe-grey)">Zet NFC aan in je telefoon-instellingen</div>
                    </div>`;
            } else {
                nfcCard.innerHTML = `
                    <div style="font-size:32px;margin-bottom:8px">📱</div>
                    <div style="font-size:15px;font-weight:600;margin-bottom:4px">Houd je telefoon tegen de NFC tag</div>
                    <div style="font-size:13px;color:var(--qe-grey)">Bureau, camionet of laden & lossen</div>`;
            }
            // Verberg actieve sessie
            const activeEl = document.getElementById('clockActiveSession');
            if (activeEl) activeEl.style.display = 'none';
        }

        // ── Voltooide sessies vandaag ──
        const completedSection = document.getElementById('clockCompletedSection');
        const completedList = document.getElementById('clockCompletedList');
        const completed = session ? (session.completedSessions || []) : [];
        if (completed.length > 0) {
            completedSection.style.display = 'block';
            completedList.innerHTML = completed.map(s => {
                const typeIcon = s.type === 'Te laat' ? '⚠️' : (s.type === 'Laden & Lossen' ? '📦' : (s.type === 'Extra uren' ? '🔄' : '✅'));
                const bg = s.type === 'Te laat' ? '#fff8e1' : '#f1f8e9';
                return `<div class="card" style="padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;background:${bg}">
                    <div style="display:flex;align-items:center;gap:10px">
                        <span>${typeIcon}</span>
                        <div>
                            <div style="font-size:14px;font-weight:500">${s.type}</div>
                            <div style="font-size:11px;color:var(--qe-grey)">${s.tagName || ''}</div>
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
        const pendingCount = JSON.parse(localStorage.getItem('qe_clock_pending') || '[]').length;
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
                const typeIcon = h.type === 'Te laat' ? '⚠️' : (h.type === 'Laden & Lossen' ? '📦' : (h.type === 'Extra uren' ? '🔄' : '✅'));
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

        const terminalInfo = terminal
            ? `<div style="font-size:12px;color:var(--qe-grey);margin-top:4px">
                    Terminal: ${this.escapeHtml(terminal.desc)}
                    <span onclick="app.showTerminalPicker()" style="color:var(--qe-purple);cursor:pointer;font-weight:500;margin-left:4px">wijzig</span>
               </div>`
            : '';

        const content = document.getElementById('paymentContent');
        content.innerHTML = `
            <div style="margin-bottom:24px">
                <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--qe-orange),#F97316);
                    display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:36px;color:#fff">
                    💳
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
                    style="padding:16px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--qe-orange),#F97316);
                    color:#fff;font-size:16px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px">
                    💳 Betalen via terminal
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
                if (!confirm('⚠ Geen gestructureerde mededeling beschikbaar voor deze factuur.\n\nDoorgaan zonder OGM? Dan moet je de betaling later handmatig matchen.')) {
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
                        <div style="font-size:28px;margin-bottom:8px">📲</div>
                        <div style="font-weight:600;font-size:15px">Terminal geopend</div>
                        <div style="font-size:13px;color:#558b2f;margin-top:4px">Controleer de Viva Wallet app</div>
                        <div style="font-size:12px;color:#689f38;margin-top:8px">Bedrag: € ${amount.toFixed(2)} — ${this.escapeHtml(ogm || '')}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
                        <button onclick="app.markPaymentSuccess('${invoiceId}', ${amount}, '${this.escapeHtml(invoiceLogicId || '')}')"
                            style="background:#2e7d32;color:#fff;border:none;border-radius:10px;padding:16px;font-size:16px;font-weight:600;cursor:pointer">
                            ✅ Betaling gelukt
                        </button>
                        <button onclick="app.markPaymentFailed('${invoiceId}')"
                            style="background:#fff;color:#c62828;border:2px solid #c62828;border-radius:10px;padding:14px;font-size:15px;font-weight:600;cursor:pointer">
                            ❌ Betaling niet gelukt
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

    // Gebruiker bevestigt handmatig dat de betaling gelukt is (check via Viva Wallet app)
    markPaymentSuccess(invoiceId, amount, invoiceLogicId) {
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
                btn.innerHTML = '✅ Ik heb betaald — controleer betaling';
            }
            const reason = data.found
                ? 'Transactie gevonden maar nog niet voltooid (status: ' + (data.status || '?') + ')'
                : 'Nog geen betaling gevonden bij Viva voor referentie ' + ref;
            alert('❌ ' + reason + '\n\nProbeer over een paar seconden opnieuw, of annuleer om later te betalen.');
        } catch (e) {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '✅ Ik heb betaald — controleer betaling';
            }
            alert('Fout bij controleren: ' + e.message);
        }
    },

    // Gebruiker geeft zelf aan dat de betaling is mislukt
    manualPaymentConfirm(invoiceId, amount, invoiceLogicId) {
        if (!confirm('Betaling markeren als mislukt?\n\nDe factuur blijft bewaard in de openstaande lijst. Je kan later opnieuw proberen vanuit de dagplanning.')) return;
        this.showPaymentFailed('Handmatig geannuleerd');
    },

    // Volledig-scherm succes-overlay na betaling
    showPaymentSuccess(amount, invoiceLogicId) {
        // Verwijder eventueel bestaande overlay
        const existing = document.getElementById('paymentOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'paymentOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:#2e7d32;color:#fff;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center';
        overlay.innerHTML = `
            <div style="font-size:96px;margin-bottom:16px">✅</div>
            <div style="font-size:32px;font-weight:700;margin-bottom:8px">Betaling gelukt!</div>
            ${amount > 0 ? `<div style="font-size:22px;opacity:0.9;margin-bottom:4px">€ ${Number(amount).toFixed(2)}</div>` : ''}
            ${invoiceLogicId ? `<div style="font-size:14px;opacity:0.8;margin-bottom:32px">Factuur ${this.escapeHtml(invoiceLogicId)}</div>` : '<div style="margin-bottom:32px"></div>'}
            <button id="paymentOverlayOk" style="background:#fff;color:#2e7d32;border:none;border-radius:12px;padding:16px 48px;font-size:18px;font-weight:600;cursor:pointer">OK — Terug naar planning</button>
        `;
        document.body.appendChild(overlay);
        document.getElementById('paymentOverlayOk').onclick = () => {
            overlay.remove();
            this.navigate('screenPlanning', false);
            this.screenHistory = [];
            this.loadPlanning();
        };
    },

    // Volledig-scherm fout-overlay met retry-optie
    showPaymentFailed(reason) {
        const existing = document.getElementById('paymentOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'paymentOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:#c62828;color:#fff;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center';
        overlay.innerHTML = `
            <div style="font-size:96px;margin-bottom:16px">⚠️</div>
            <div style="font-size:28px;font-weight:700;margin-bottom:8px">Betaling niet gelukt</div>
            <div style="font-size:15px;opacity:0.9;max-width:320px;margin-bottom:8px">${this.escapeHtml(reason || '')}</div>
            <div style="font-size:13px;opacity:0.85;max-width:340px;margin-bottom:32px">De factuur is bewaard. Je kan de betaling opnieuw proberen vanuit de dagplanning.</div>
            <div style="display:flex;gap:12px;flex-direction:column;width:100%;max-width:300px">
                <button id="paymentRetryBtn" style="background:#fff;color:#c62828;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:600;cursor:pointer">🔄 Opnieuw proberen</button>
                <button id="paymentLaterBtn" style="background:transparent;color:#fff;border:2px solid #fff;border-radius:12px;padding:14px;font-size:15px;font-weight:500;cursor:pointer">Later betalen</button>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('paymentRetryBtn').onclick = () => {
            overlay.remove();
            const pp = this._pendingPayment;
            if (pp && pp.invoiceId) {
                this.startTerminalPayment(pp.invoiceId, pp.amount, pp.ogm, pp.invoiceLogicId);
            }
        };
        document.getElementById('paymentLaterBtn').onclick = () => {
            overlay.remove();
            this.navigate('screenPlanning', false);
            this.screenHistory = [];
            this.loadPlanning();
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
                            💳 Betalen
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
                            <div style="font-size:48px;margin-bottom:8px">✅</div>
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
        // Zoek installatie-info uit geladen data
        const inst = (this._loadedInstallations || []).find(i => String(i.id) === String(installationId));
        const instName = inst ? (inst.name || inst.brand || 'Installatie') : 'Installatie';

        document.getElementById('instHistoryTitle').textContent = instName;

        // Toon installatie-info bovenaan
        if (inst) {
            document.getElementById('instHistoryInfo').innerHTML = `
                <div class="card" style="margin-bottom:8px">
                    <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--qe-grey)">
                        ${inst.brand ? `<span>🏭 ${this.escapeHtml(inst.brand)}</span>` : ''}
                        ${inst.model ? `<span>📋 ${this.escapeHtml(inst.model)}</span>` : ''}
                        ${inst.serialNumber ? `<span>🔢 ${this.escapeHtml(inst.serialNumber)}</span>` : ''}
                        ${inst.bouwjaar ? `<span>📅 ${this.escapeHtml(String(inst.bouwjaar))}</span>` : ''}
                    </div>
                </div>`;
        }

        const list = document.getElementById('instHistoryList');
        list.innerHTML = '<div class="spinner"></div>';

        this.navigate('screenInstHistory');

        try {
            const res = await fetch(`api/installation-history.php?installationId=${installationId}`);
            const data = await res.json();
            const orders = data.items || [];

            if (orders.length === 0) {
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">📋</div>
                        <h3>Geen historiek</h3>
                        <p>Geen orders gevonden voor deze installatie</p>
                    </div>`;
                return;
            }

            const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
            const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

            list.innerHTML = orders.map(order => {
                const d = order.date ? new Date(order.date + 'T12:00:00') : null;
                const dateLabel = d ? `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}` : 'Onbekend';
                const statusClass = order.status === 'COMPLETED' ? 'type-onderhoud' : (order.status === 'IN_PROGRESS' ? 'type-plaatsing' : 'type-diversen');
                const statusLabel = order.status === 'COMPLETED' ? 'Afgerond' : (order.status === 'IN_PROGRESS' ? 'In uitvoering' : (order.status || 'Onbekend'));

                return `
                    <div class="card card-clickable" onclick="app.openOrderDetail(${order.id})" style="margin:0 16px 8px;cursor:pointer">
                        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">
                            <div>
                                <div style="font-size:15px;font-weight:500">${this.escapeHtml(order.logicId || `#${order.id}`)}</div>
                                <div style="font-size:12px;color:var(--qe-grey);margin-top:2px">📅 ${dateLabel}</div>
                            </div>
                            <span class="wo-type ${statusClass}" style="font-size:11px">${statusLabel}</span>
                        </div>
                        ${order.summary ? `<div style="font-size:13px;color:var(--qe-grey);margin-top:4px">${this.escapeHtml(order.summary)}</div>` : ''}
                        ${order.hourEntries > 0 || order.materialEntries > 0 ? `
                        <div style="font-size:12px;color:var(--qe-grey);margin-top:6px;display:flex;gap:12px">
                            ${order.hourEntries > 0 ? `<span>🕐 ${order.hourEntries} uren</span>` : ''}
                            ${order.materialEntries > 0 ? `<span>🔧 ${order.materialEntries} materialen</span>` : ''}
                        </div>` : ''}
                    </div>`;
            }).join('');

        } catch (err) {
            list.innerHTML = '<p class="text-grey text-sm text-center" style="padding:16px">Kon historiek niet laden</p>';
        }
    },

    async openOrderDetail(workOrderId) {
        const content = document.getElementById('orderDetailContent');
        content.innerHTML = '<div class="spinner"></div>';

        this.navigate('screenOrderDetail');

        try {
            const res = await fetch(`api/installation-history.php?action=detail&workOrderId=${workOrderId}`);
            const data = await res.json();

            if (data.error) {
                content.innerHTML = `<p class="text-grey text-sm text-center" style="padding:16px">${this.escapeHtml(data.error)}</p>`;
                return;
            }

            const wo = data;
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
    async loadDagoverzicht() {
        const container = document.getElementById('dagoverzichtContent');
        container.innerHTML = '<div class="spinner"></div>';

        const user = RobawsAPI.getLoggedInUser();
        if (!user) {
            container.innerHTML = '<p class="text-grey text-sm text-center">Log eerst in</p>';
            return;
        }

        try {
            const registrations = await RobawsAPI.getTimeRegistrationHistory(user.robawsEmployeeId, 30);

            if (registrations.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="margin-top:20px">
                        <div class="empty-icon">⏰</div>
                        <h3>Geen registraties</h3>
                        <p>Scan een NFC tag om je eerste tijdsregistratie te starten</p>
                    </div>`;
                return;
            }

            // Groepeer per datum
            const byDate = {};
            for (const reg of registrations) {
                const date = reg.startDate.substring(0, 10);
                if (!byDate[date]) byDate[date] = [];
                byDate[date].push(reg);
            }

            // Totalen berekenen
            const totalHours = registrations.reduce((sum, r) => sum + (r.hours || 0), 0);
            const totalDays = Object.keys(byDate).length;
            const lateCount = registrations.filter(r => r.type === 'Te laat').length;

            let html = '';

            // Samenvatting kaart
            html += `
                <div class="card" style="margin-bottom:16px;padding:20px;background:linear-gradient(135deg, var(--qe-darkblue), var(--qe-purple));color:#fff;border-radius:16px">
                    <div style="font-size:13px;opacity:0.8;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Laatste 30 dagen</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
                        <div>
                            <div style="font-size:28px;font-weight:700">${totalHours.toFixed(1)}</div>
                            <div style="font-size:12px;opacity:0.8">Totaal uren</div>
                        </div>
                        <div>
                            <div style="font-size:28px;font-weight:700">${totalDays}</div>
                            <div style="font-size:12px;opacity:0.8">Werkdagen</div>
                        </div>
                        <div>
                            <div style="font-size:28px;font-weight:700">${lateCount}</div>
                            <div style="font-size:12px;opacity:0.8">Te laat</div>
                        </div>
                    </div>
                </div>`;

            // Per datum groep
            const days = ['Zo','Ma','Di','Wo','Do','Vr','Za'];
            const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

            for (const date of sortedDates) {
                const regs = byDate[date];
                const d = new Date(date + 'T12:00:00');
                const dayName = days[d.getDay()];
                const dateStr = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
                const dayTotal = regs.reduce((sum, r) => sum + (r.hours || 0), 0);

                html += `<div style="margin-bottom:4px;padding:8px 4px 4px;display:flex;align-items:center;justify-content:space-between">
                    <div style="font-size:13px;font-weight:600;color:var(--qe-darkblue)">${dayName} ${dateStr}</div>
                    <div style="font-size:12px;color:var(--qe-grey)">${dayTotal.toFixed(1)} uur</div>
                </div>`;

                for (const reg of regs) {
                    const startTime = new Date(reg.startDate).toTimeString().slice(0, 5);
                    const endTime = reg.endDate ? new Date(reg.endDate).toTimeString().slice(0, 5) : '...';
                    const hours = reg.hours ? `${reg.hours}u` : '';

                    let typeIcon, typeBg, typeColor;
                    switch (reg.type) {
                        case 'Te laat':
                            typeIcon = '⚠️'; typeBg = '#fff8e1'; typeColor = '#e65100'; break;
                        case 'Laden & Lossen':
                            typeIcon = '📦'; typeBg = '#e3f2fd'; typeColor = '#1565c0'; break;
                        case 'Extra uren':
                            typeIcon = '🔄'; typeBg = '#f3e5f5'; typeColor = '#7b1fa2'; break;
                        default:
                            typeIcon = '✅'; typeBg = '#f1f8e9'; typeColor = '#2e7d32'; break;
                    }

                    // GPS link uit opmerkingen halen
                    const gpsMatch = (reg.remarks || '').match(/https:\/\/maps\.google\.com\/\?q=[\d.,\-]+/);
                    const gpsLink = gpsMatch ? `<a href="${gpsMatch[0]}" onclick="event.stopPropagation()" style="font-size:11px;color:var(--qe-purple);text-decoration:none">📍</a>` : '';

                    html += `<div class="card" style="padding:12px 14px;margin-bottom:6px;background:${typeBg};cursor:pointer" onclick="app.openAanpassing('${reg.id}')">
                        <div style="display:flex;align-items:center;justify-content:space-between">
                            <div style="display:flex;align-items:center;gap:10px">
                                <span style="font-size:18px">${typeIcon}</span>
                                <div>
                                    <div style="font-size:14px;font-weight:500">${startTime} → ${endTime} <span style="font-size:12px;font-weight:400;color:var(--qe-grey)">${hours}</span></div>
                                    <div style="font-size:11px;color:${typeColor}">${reg.type} ${gpsLink}</div>
                                </div>
                            </div>
                            <div style="font-size:18px;color:var(--qe-grey)">›</div>
                        </div>
                    </div>`;
                }
            }

            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<p class="text-grey text-sm text-center">Fout bij laden: ${e.message}</p>`;
        }
    },

    /** Open het aanpassing-aanvragen scherm voor een specifieke registratie */
    async openAanpassing(regId) {
        // Sla regId op voor gebruik in het scherm
        this._aanpassingRegId = regId;
        this.navigate('screenAanpassing');

        const content = document.getElementById('aanpassingContent');
        content.innerHTML = '<div class="spinner"></div>';

        try {
            const res = await RobawsAPI.get(`time-registrations/${regId}`);
            if (res.code !== 200 || !res.data) throw new Error('Registratie niet gevonden');
            const reg = res.data;

            const startDt = new Date(reg.startDate);
            const endDt = reg.endDate ? new Date(reg.endDate) : null;
            const startTime = startDt.toTimeString().slice(0, 5);
            const endTime = endDt ? endDt.toTimeString().slice(0, 5) : '';
            const dateStr = startDt.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });

            let typeIcon;
            switch (reg.type) {
                case 'Te laat': typeIcon = '⚠️'; break;
                case 'Laden & Lossen': typeIcon = '📦'; break;
                case 'Extra uren': typeIcon = '🔄'; break;
                default: typeIcon = '✅'; break;
            }

            content.innerHTML = `
                <!-- Huidige registratie -->
                <div class="card" style="padding:16px;margin-bottom:16px">
                    <div style="font-size:13px;color:var(--qe-grey);margin-bottom:8px">${dateStr}</div>
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                        <span style="font-size:24px">${typeIcon}</span>
                        <div>
                            <div style="font-size:18px;font-weight:600">${startTime} → ${endTime || '...'}</div>
                            <div style="font-size:13px;color:var(--qe-grey)">${reg.type} · ${reg.hours || 0} uur</div>
                        </div>
                    </div>
                    ${reg.remarks ? `<div style="font-size:12px;color:var(--qe-grey);padding:8px;background:#f5f5f5;border-radius:8px">${reg.remarks}</div>` : ''}
                </div>

                <!-- Aanpassing formulier -->
                <div class="card" style="padding:16px">
                    <h3 style="font-size:16px;color:var(--qe-darkblue);margin-bottom:16px">Aanpassing aanvragen</h3>

                    <div style="margin-bottom:14px">
                        <label style="font-size:13px;font-weight:500;color:var(--qe-dark);display:block;margin-bottom:4px">Juiste startuur</label>
                        <input type="time" id="aanpassingStart" value="${startTime}"
                            style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
                    </div>

                    <div style="margin-bottom:14px">
                        <label style="font-size:13px;font-weight:500;color:var(--qe-dark);display:block;margin-bottom:4px">Juiste einduur</label>
                        <input type="time" id="aanpassingEnd" value="${endTime}"
                            style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;box-sizing:border-box">
                    </div>

                    <div style="margin-bottom:16px">
                        <label style="font-size:13px;font-weight:500;color:var(--qe-dark);display:block;margin-bottom:4px">Opmerking</label>
                        <textarea id="aanpassingOpmerking" rows="3" placeholder="Waarom moet dit aangepast worden?"
                            style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box"></textarea>
                    </div>

                    <button class="btn btn-primary btn-full" onclick="app.submitAanpassing('${regId}')"
                        style="padding:14px;font-size:15px;font-weight:600" id="btnSubmitAanpassing">
                        📩 Aanpassing indienen
                    </button>
                </div>
            `;
        } catch (e) {
            content.innerHTML = `<p class="text-grey text-sm text-center">Fout: ${e.message}</p>`;
        }
    },

    /** Dien de aanpassing in als taak bij de tijdsregistratie */
    async submitAanpassing(regId) {
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
            const description = `Aanpassing aangevraagd door ${user ? user.name : 'onbekend'}:\n\nJuiste startuur: ${startVal || '(niet gewijzigd)'}\nJuiste einduur: ${endVal || '(niet gewijzigd)'}\n\nOpmerking: ${opmerking}`;

            await RobawsAPI.createTaskForTimeRegistration(regId, {
                title: `Uren aanpassing — ${user ? user.name : 'onbekend'}`,
                description: description,
                assignedUserId: '5', // Vince van de Vliet (kantoor)
            });

            this.toast('Aanpassing ingediend ✓');
            this.navigate('screenDagoverzicht');
            this.loadDagoverzicht();
        } catch (e) {
            this.toast('Fout bij indienen: ' + e.message, true);
            btn.disabled = false;
            btn.textContent = '📩 Aanpassing indienen';
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

            // Check of er openstaande betaalschermen zijn
            let paymentBtns = '';
            try {
                const lastOv = localStorage.getItem('qe_last_overschrijving');
                if (lastOv) {
                    const ovData = JSON.parse(lastOv);
                    const inv = ovData.invoice || {};
                    const pay = ovData.payment || {};
                    const amount = parseFloat(pay.amount || inv.totalInclVat || 0).toFixed(2);
                    paymentBtns += `
                        <div class="card" style="margin-bottom:8px;background:rgba(46,125,50,0.06);border-left:3px solid var(--qe-green);cursor:pointer" onclick="app.reopenLastPaymentScreen('overschrijving')">
                            <div style="display:flex;align-items:center;justify-content:space-between">
                                <div>
                                    <div style="font-size:13px;font-weight:600;color:#2E7D32">🏦 Overschrijving betaalscherm</div>
                                    <div style="font-size:12px;color:var(--qe-grey);margin-top:2px">Factuur ${inv.logicId || ''} — € ${amount}</div>
                                </div>
                                <div style="font-size:14px;color:#2E7D32;font-weight:600">Openen →</div>
                            </div>
                        </div>`;
                }
                const lastViva = localStorage.getItem('qe_last_payment');
                if (lastViva) {
                    const vivaData = JSON.parse(lastViva);
                    const inv = vivaData.invoice || {};
                    const amount = parseFloat(inv.totalInclVat || 0).toFixed(2);
                    paymentBtns += `
                        <div class="card" style="margin-bottom:8px;background:rgba(21,101,192,0.06);border-left:3px solid #1565C0;cursor:pointer" onclick="app.reopenLastPaymentScreen('viva')">
                            <div style="display:flex;align-items:center;justify-content:space-between">
                                <div>
                                    <div style="font-size:13px;font-weight:600;color:#1565C0">💳 Viva Wallet betaalscherm</div>
                                    <div style="font-size:12px;color:var(--qe-grey);margin-top:2px">Factuur ${inv.logicId || ''} — € ${amount}</div>
                                </div>
                                <div style="font-size:14px;color:#1565C0;font-weight:600">Openen →</div>
                            </div>
                        </div>`;
                }
            } catch(e) {}

            let html = paymentBtns + `
                <div class="card" style="margin-bottom:12px;background:rgba(106,44,145,0.06);border-left:3px solid var(--qe-purple)">
                    <div style="font-size:13px;color:var(--qe-purple);font-weight:600">✏️ Correctie-modus</div>
                    <div style="font-size:12px;color:var(--qe-grey);margin-top:4px">Klik op een planning om uren of materialen te corrigeren. De originele werkbon blijft staan; er wordt een correctie-werkbon met het verschil aangemaakt.</div>
                </div>`;

            Object.keys(grouped).sort().reverse().forEach(dateStr => {
                const d = new Date(dateStr + 'T12:00:00');
                const isToday = dateStr === new Date().toISOString().split('T')[0];
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
                                    <div style="font-size:18px;color:var(--qe-purple);margin-top:6px">✏️</div>
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

        document.getElementById('correctieKlantMin').value = s.klantMin;
        document.getElementById('correctieVerplMin').value = s.verplMin;

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
                            <button class="btn btn-outline btn-sm" style="width:28px;padding:4px;color:#c00" onclick="app.removeCorrectieMaterial(${idx})">🗑</button>
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
        const newKlant = (parseInt(document.getElementById('correctieKlantMin').value) || 0) / 60;
        const newVerpl = (parseInt(document.getElementById('correctieVerplMin').value) || 0) / 60;
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
        // Hergebruik de bestaande materialen-zoek modal door currentWO tijdelijk te vervangen
        const fakeWoId = '__correctie__';
        if (!this.woData[fakeWoId]) this.woData[fakeWoId] = { hours: [], materials: [], photos: [], notes: '' };
        this._origCurrentWO = this.currentWO;
        this.currentWO = { id: fakeWoId };
        this._showMaterialSearchModal();
        // Wanneer de gebruiker een materiaal selecteert wordt het in woData[__correctie__].materials gezet.
        // We pollen even tot er iets in zit, maar simpeler: we hooken het via setInterval.
        const startCount = this.woData[fakeWoId].materials.length;
        const check = () => {
            const arr = this.woData[fakeWoId].materials;
            if (arr.length > startCount) {
                const nieuw = arr[arr.length - 1];
                this.correctieState.materials.push({
                    articleId: nieuw.id,
                    name: nieuw.name,
                    quantity: parseFloat(nieuw.quantity) || 1,
                    unitPrice: parseFloat(nieuw.salePrice || nieuw.unitPrice) || 0,
                });
                this.currentWO = this._origCurrentWO;
                this._origCurrentWO = null;
                this.renderCorrectie();
            } else if (document.getElementById('modalOverlay').classList.contains('show')) {
                setTimeout(check, 400);
            } else {
                this.currentWO = this._origCurrentWO;
                this._origCurrentWO = null;
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

        const user = JSON.parse(localStorage.getItem('qe_user') || '{}');

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
            const date = new Date().toISOString().split('T')[0];
            const result = await RobawsAPI.getPlanning(this.currentUser.robawsEmployeeId, date, this.currentUser.robawsUserId);
            const items = (result.items || []).filter(it => !it.hasWerkbon);
            const count = items.length;

            if (this._lastPlanningCount !== null && count > this._lastPlanningCount) {
                const diff = count - this._lastPlanningCount;
                this.toast(`📋 ${diff} nieuw${diff > 1 ? 'e' : ''} werkorder${diff > 1 ? 's' : ''} in planning!`);
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

        document.getElementById('checklistTitle').textContent = '\u2705 ' + checklist.label;
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

    // ========================================
    // DARK MODE
    // ========================================
    toggleDarkMode(enabled) {
        document.body.classList.toggle('dark-mode', enabled);
        localStorage.setItem('qe_dark_mode', enabled ? '1' : '0');
    },
};

document.addEventListener('DOMContentLoaded', () => app.init());
