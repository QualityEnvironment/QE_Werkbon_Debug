/**
 * QE Clock v2 — Tijdsregistratie via Robaws
 */

window.QEClock = {

    DEFAULT_START_TIME: '07:00',
    _serverOffset: 0,
    _serverOffsetLoaded: false,

    async _loadServerTimeOffset() {
        try {
            const localBefore = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch('https://worldtimeapi.org/api/timezone/Europe/Brussels', {
                signal: controller.signal,
                cache: 'no-store',
            });
            clearTimeout(timeout);
            const localAfter = Date.now();
            const localMid = (localBefore + localAfter) / 2;
            if (res.ok) {
                const data = await res.json();
                const serverTime = new Date(data.datetime).getTime();
                this._serverOffset = serverTime - localMid;
                this._serverOffsetLoaded = true;
                console.log('[Clock] Internet-tijd geladen. Offset:', this._serverOffset, 'ms');
                return;
            }
        } catch (e) {
            console.warn('[Clock] WorldTimeAPI niet bereikbaar:', e.message);
        }
        try {
            const res = await fetch('https://app.robaws.com/api/v2/', {
                method: 'HEAD',
                cache: 'no-store',
                headers: RobawsAPI.getHeaders(),
            });
            const dateHeader = res.headers.get('Date');
            if (dateHeader) {
                const serverTime = new Date(dateHeader).getTime();
                this._serverOffset = serverTime - Date.now();
                this._serverOffsetLoaded = true;
                return;
            }
        } catch (e) {}
        this._serverOffsetLoaded = false;
    },

    _now() { return new Date(Date.now() + this._serverOffset); },
    async _getNow() {
        if (!this._serverOffsetLoaded) await this._loadServerTimeOffset();
        return this._now();
    },
    _localDate(d) {
        const dt = d || this._now();
        return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
    },
    _localTime(d) {
        const dt = d || this._now();
        return dt.toTimeString().slice(0, 5);
    },
    _calcHours(startISO, endISO) {
        const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
        return Math.round((ms / 3600000) * 100) / 100;
    },

    _tagConfig: null,

    async loadTagConfig() {
        try {
            const config = await RobawsAPI.getNfcTagConfig();
            this._tagConfig = config;
            const currentUser = RobawsAPI.getLoggedInUser();
            const currentUserId = currentUser ? String(currentUser.robawsEmployeeId) : null;
            if (config.startuur && currentUserId) {
                this._personalStartuur = config.startuur;
                this._startuurLoadedForUser = currentUserId;
                localStorage.setItem('qe_startuur_' + currentUserId, config.startuur);
            }
            if (config.pauze && currentUserId) {
                this._personalPauze = parseInt(config.pauze, 10) || 0;
                localStorage.setItem('qe_pauze_' + currentUserId, String(this._personalPauze));
            }
            localStorage.setItem('qe_nfc_tags', JSON.stringify(config));
            return config;
        } catch (e) {
            const cached = localStorage.getItem('qe_nfc_tags');
            if (cached) {
                this._tagConfig = JSON.parse(cached);
                return this._tagConfig;
            }
            return null;
        }
    },

    getTagConfig() {
        if (this._tagConfig) return this._tagConfig;
        const cached = localStorage.getItem('qe_nfc_tags');
        if (cached) { this._tagConfig = JSON.parse(cached); return this._tagConfig; }
        return null;
    },

    identifyTag(tagId) {
        const config = this.getTagConfig();
        if (!config) return null;
        if (config.bureau && config.bureau.tagId === tagId) return { type: 'bureau', name: 'Bureau' };
        if (config.ladenLossen && config.ladenLossen.tagId === tagId) return { type: 'laden_lossen', name: 'Laden & Lossen' };
        for (const cam of (config.camionetten || [])) {
            if (cam.tagId === tagId) return { type: 'camionet', name: cam.name };
        }
        return null;
    },

    _personalStartuur: null,
    _startuurLoadedForUser: null,
    _personalPauze: null,

    getExpectedStartTime() {
        const user = RobawsAPI.getLoggedInUser();
        const userId = user ? String(user.robawsEmployeeId) : null;
        if (this._personalStartuur && this._startuurLoadedForUser === userId) return this._personalStartuur;
        if (userId) {
            const cached = localStorage.getItem('qe_startuur_' + userId);
            if (cached) { this._personalStartuur = cached; this._startuurLoadedForUser = userId; return cached; }
        }
        return this.DEFAULT_START_TIME;
    },

    _getSessionKey() {
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return null;
        return 'qe_clock_v2_' + this._localDate() + '_' + user.email;
    },

    getSession() {
        const key = this._getSessionKey();
        if (!key) return null;
        const stored = localStorage.getItem(key);
        if (!stored) return null;
        try {
            const session = JSON.parse(stored);
            if (session.date !== this._localDate()) { localStorage.removeItem(key); return null; }
            return session;
        } catch(e) { try { localStorage.removeItem(key); } catch(_) {} return null; }
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
            active: false, startTime: null, startISO: null,
            tagType: null, tagName: null, registrationType: null,
            robawsId: null, gpsLat: null, gpsLng: null,
            completedSessions: [],
        };
    },

    isActive() { const s = this.getSession(); return s ? s.active : false; },
    hasCompletedToday() { const s = this.getSession(); return s ? (s.completedSessions || []).length > 0 : false; },

    _scanLock: false,

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
        const normalizedTagId = String(tagId || '').trim().toLowerCase();
        if (!normalizedTagId) return;
        console.log('[Clock] NFC scan:', normalizedTagId);

        const onClockScreen = window.app && window.app.currentScreen === 'screenClock';
        if (!onClockScreen && !this._pendingAssignment) {
            if (window.app) {
                app.toast('Open eerst het Klok-scherm om te scannen');
                try { app.navigate('screenClock'); } catch(_) {}
            }
            return;
        }

        if (this._scanLock) return;
        this._scanLock = true;
        const lockTimeoutId = setTimeout(() => { this._scanLock = false; }, 8000);
        let scanResult = null;

        try {
            const user = RobawsAPI.getLoggedInUser();
            if (!user) { scanResult = { ok: false, message: 'Niet ingelogd' }; return; }

            if (this._pendingAssignment) {
                await this._handleAssignmentScan(normalizedTagId);
                return;
            }

            if (!this.getTagConfig()) await this.loadTagConfig();

            let tag = this.identifyTag(normalizedTagId);
            if (!tag) tag = this.identifyTag(tagId);
            if (!tag) {
                await this.loadTagConfig();
                tag = this.identifyTag(normalizedTagId) || this.identifyTag(tagId);
            }
            if (!tag) {
                scanResult = { ok: false, message: 'Onbekende NFC tag — eerst toewijzen via Tag beheer' };
                return;
            }

            let session = this.getSession() || this._newSession();
            if (session.employeeId && String(session.employeeId) !== String(user.robawsEmployeeId)) {
                session = this._newSession();
            }

            if (tag.type === 'laden_lossen') {
                const r = await this._handleLadenLossen(session, tag);
                scanResult = r || { ok: true, message: 'Laden & Lossen verwerkt', refresh: true };
                return;
            }

            if (session.active) {
                const userName = user.name || user.email;
                const startTime = session.startTime || '?';
                const confirmed = confirm(userName + ' uitklokken?\n\nIngeklokt om ' + startTime + '\nWil je nu uitklokken?');
                if (!confirmed) return;
                const r = await this._clockOut(session, tag);
                scanResult = r || { ok: true, message: 'Uitgeklokt', refresh: true };
                return;
            }

            const r = await this._clockIn(session, tag);
            scanResult = r || { ok: true, message: 'Ingeklokt', refresh: true };
        } catch (e) {
            console.warn('[Clock] Scan flow fout:', e);
            scanResult = { ok: false, message: e && e.message ? e.message : 'Onbekende fout' };
        } finally {
            clearTimeout(lockTimeoutId);
            this._scanLock = false;
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
    },

    async _clockIn(session, tag) {
        const now = await this._getNow();
        const time = this._localTime(now);
        const isFirstOfDay = (session.completedSessions || []).length === 0;
        let type;
        if (!isFirstOfDay) { type = 'Extra uren'; }
        else {
            const clockUser = RobawsAPI.getLoggedInUser();
            const clockUserId = clockUser ? String(clockUser.robawsEmployeeId) : null;
            if (clockUserId && this._startuurLoadedForUser !== clockUserId) {
                try {
                    const myRes = await RobawsAPI.get('employees/' + clockUserId);
                    if (myRes.code === 200 && myRes.data && myRes.data.extraFields) {
                        for (const [name, data] of Object.entries(myRes.data.extraFields)) {
                            if (name.toLowerCase().includes('startuur')) {
                                const val = data ? String(data.stringValue != null ? data.stringValue : (data.value || '')) : '';
                                if (val) {
                                    this._personalStartuur = val;
                                    this._startuurLoadedForUser = clockUserId;
                                    localStorage.setItem('qe_startuur_' + clockUserId, val);
                                }
                                break;
                            }
                        }
                    }
                } catch(e) {}
            }
            const expectedStart = this.getExpectedStartTime();
            const toMinutes = (h) => { if (!h) return 0; const m = String(h).match(/^(\d{1,2}):(\d{1,2})/); return m ? (parseInt(m[1],10)||0)*60 + (parseInt(m[2],10)||0) : 0; };
            const isLate = toMinutes(time) > toMinutes(expectedStart) + 5;
            type = isLate ? 'Te laat' : 'Op tijd';
        }

        let gpsLat = null, gpsLng = null, gpsText = '';
        try {
            const pos = await this._getGPS();
            gpsLat = pos.latitude; gpsLng = pos.longitude;
            gpsText = 'https://maps.google.com/?q=' + gpsLat.toFixed(6) + ',' + gpsLng.toFixed(6);
        } catch (e) { gpsText = 'GPS niet beschikbaar'; }

        const remarks = tag.name + ' — ' + gpsText + ' — ' + time;

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

        const currentUser = RobawsAPI.getLoggedInUser();
        const empId = currentUser ? String(currentUser.robawsEmployeeId) : session.employeeId;
        session.employeeId = empId;
        this._saveSession(session);

        let robawsCode = null, robawsError = null;
        try {
            const result = await RobawsAPI.createTimeRegistration({
                employeeId: empId, startDate: session.startISO, type: type, remarks: remarks,
            });
            robawsCode = result.code;
            if (result.code === 200 || result.code === 201) {
                session.robawsId = result.data ? String(result.data.id) : null;
                this._saveSession(session);
            } else {
                robawsError = this._extractRobawsError(result);
                this._addPendingSync({ action: 'create_open', employeeId: empId, startISO: session.startISO, type: type, remarks: remarks });
            }
        } catch (e) {
            robawsError = 'netwerkfout: ' + (e && e.message ? e.message : 'onbekend');
            try { this._addPendingSync({ action: 'create_open', employeeId: empId, startISO: session.startISO, type: type, remarks: remarks }); } catch(_) {}
        }

        const ok = robawsCode === 200 || robawsCode === 201;
        const lateMsg = type === 'Te laat' ? ' (te laat!)' : '';
        const message = ok
            ? 'Ingeklokt om ' + time + ' — ' + tag.name + lateMsg
            : 'Robaws weigerde de inclock\n' + (robawsError || ('code ' + (robawsCode || '?')));
        return { ok, message, refresh: true };
    },

    async _clockOut(session, tag) {
        const now = await this._getNow();
        const endTime = this._localTime(now);
        const endISO = now.toISOString();
        const rawHours = this._calcHours(session.startISO, endISO);

        let pauseHours = 0;
        const isNormalShift = session.registrationType === 'Op tijd' || session.registrationType === 'Te laat';
        if (isNormalShift) {
            let pauseMinutes = this._personalPauze;
            if (!pauseMinutes && pauseMinutes !== 0) {
                const user = RobawsAPI.getLoggedInUser();
                const userId = user ? String(user.robawsEmployeeId) : null;
                if (userId) {
                    const cached = localStorage.getItem('qe_pauze_' + userId);
                    if (cached) pauseMinutes = parseInt(cached, 10);
                }
            }
            if (!pauseMinutes && pauseMinutes !== 0) pauseMinutes = 45;
            pauseHours = pauseMinutes / 60;
        }
        const hours = Math.max(0, Math.round((rawHours - pauseHours) * 100) / 100);

        session.active = false;
        session.completedSessions = session.completedSessions || [];
        session.completedSessions.push({
            startTime: session.startTime, endTime: endTime,
            type: session.registrationType, robawsId: session.robawsId,
            tagName: session.tagName, hours: hours,
        });
        this._saveSession(session);

        const breakMinutes = Math.round(pauseHours * 60);
        let robawsCode = null, robawsError = null;
        if (session.robawsId) {
            try {
                const me = RobawsAPI.getLoggedInUser();
                const existing = await RobawsAPI.get('time-registrations/' + session.robawsId);
                const ownerId = existing.data && (existing.data.employeeId || (existing.data.employee && existing.data.employee.id));
                if (me && ownerId && String(ownerId) !== String(me.robawsEmployeeId)) {
                    const sessionKey = this._getSessionKey();
                    if (sessionKey) localStorage.removeItem(sessionKey);
                    return {
                        ok: false,
                        message: 'Deze registratie hoort bij iemand anders\n(werknemer ' + ownerId + '). Sessie is gereset — scan opnieuw om correct in te klokken.',
                        refresh: true,
                    };
                }
            } catch(e) {}

            try {
                const updateData = { endDate: endISO, hours: hours };
                if (breakMinutes > 0) updateData.breakDuration = breakMinutes;
                const upd = await RobawsAPI.updateTimeRegistration(session.robawsId, updateData);
                robawsCode = upd && typeof upd.code !== 'undefined' ? upd.code : 200;
                if (robawsCode !== 200 && robawsCode !== 201 && robawsCode !== 204) {
                    robawsError = this._extractRobawsError(upd);
                    this._addPendingSync({ action: 'update', id: session.robawsId, endDate: endISO, hours: hours, breakDuration: breakMinutes });
                }
            } catch (e) {
                robawsError = 'netwerkfout: ' + (e && e.message ? e.message : 'onbekend');
                this._addPendingSync({ action: 'update', id: session.robawsId, endDate: endISO, hours: hours, breakDuration: breakMinutes });
            }
        } else {
            this._addPendingSync({ action: 'create_complete', employeeId: session.employeeId, startDate: session.startISO, endDate: endISO, hours: hours, type: session.registrationType, remarks: session.pendingRemarks || '' });
            robawsError = 'geen verbinding bij inclocken — wordt later automatisch verzonden';
        }

        const pauseMin = Math.round(pauseHours * 60);
        const pauseText = pauseMin > 0 ? ' (' + pauseMin + 'min pauze)' : '';
        const ok = robawsCode === 200 || robawsCode === 201 || robawsCode === 204;
        const message = ok
            ? 'Uitgeklokt om ' + endTime + ' — ' + hours + 'u gewerkt' + pauseText
            : 'Uitklokken niet bevestigd\n' + (robawsError || ('code ' + (robawsCode || '?')));
        return { ok, message, refresh: true };
    },

    async _handleLadenLossen(session, tag) {
        if (session.active && session.registrationType === 'Laden & Lossen') {
            return await this._clockOut(session, tag);
        }
        const now = await this._getNow();
        const time = this._localTime(now);
        let gpsLat = null, gpsLng = null, gpsText = '';
        try {
            const pos = await this._getGPS();
            gpsLat = pos.latitude; gpsLng = pos.longitude;
            gpsText = 'https://maps.google.com/?q=' + gpsLat.toFixed(6) + ',' + gpsLng.toFixed(6);
        } catch (e) { gpsText = 'GPS niet beschikbaar'; }
        const remarks = 'Laden & Lossen — ' + gpsText + ' — ' + time;

        if (session.active) {
            await this._clockOut(session, tag);
            session = this.getSession() || this._newSession();
        }

        session.active = true;
        session.startTime = time;
        session.startISO = now.toISOString();
        session.tagType = 'laden_lossen';
        session.tagName = 'Laden & Lossen';
        session.registrationType = 'Laden & Lossen';
        session.robawsId = null;
        session.gpsLat = gpsLat; session.gpsLng = gpsLng;
        session.pendingRemarks = remarks;
        this._saveSession(session);

        let robawsCode = null, robawsError = null;
        try {
            const result = await RobawsAPI.createTimeRegistration({
                employeeId: session.employeeId, startDate: session.startISO, type: 'Laden & Lossen', remarks: remarks,
            });
            robawsCode = result.code;
            if (result.code === 200 || result.code === 201) {
                session.robawsId = result.data ? String(result.data.id) : null;
                this._saveSession(session);
            } else {
                robawsError = this._extractRobawsError(result);
            }
        } catch (e) { robawsError = 'netwerkfout: ' + (e && e.message ? e.message : 'onbekend'); }

        const ok = robawsCode === 200 || robawsCode === 201;
        const message = ok
            ? 'Laden & Lossen gestart om ' + time
            : 'Robaws weigerde de L&L registratie\n' + (robawsError || ('code ' + (robawsCode || '?')));
        return { ok, message, refresh: true };
    },

    _getGPS() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) { reject(new Error('Geolocation niet beschikbaar')); return; }
            navigator.geolocation.getCurrentPosition(
                pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                err => reject(err),
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
            );
        });
    },

    _pendingAssignment: null,

    startTagAssignment(fieldName, locationName) {
        this._pendingAssignment = { fieldName, locationName };
        const overlay = document.createElement('div');
        overlay.id = 'nfcScanOverlay';
        overlay.className = 'nfc-scan-overlay';
        overlay.innerHTML = '<div class="nfc-location-badge">' + locationName + '</div><div class="nfc-icon-wrap"><div class="nfc-ripple"></div><div class="nfc-ripple"></div><div class="nfc-ripple"></div><div class="nfc-icon">📱</div></div><h3>Wacht op NFC scan...</h3><p>Houd de NFC tag tegen de achterkant van je telefoon</p><button class="nfc-cancel-btn" onclick="QEClock.cancelTagAssignment()">Annuleren</button>';
        document.body.appendChild(overlay);
    },

    cancelTagAssignment() { this._pendingAssignment = null; this._removeNfcOverlay(); },
    _removeNfcOverlay() { const o = document.getElementById('nfcScanOverlay'); if (o) o.remove(); },

    _showAssignmentSuccess(locationName) {
        const o = document.getElementById('nfcScanOverlay');
        if (o) {
            o.className = 'nfc-scan-overlay nfc-success';
            o.innerHTML = '<div class="nfc-success-icon">✅</div><h3 style="margin-top:16px">Tag toegewezen!</h3><p>' + locationName + '</p>';
            setTimeout(() => { this._removeNfcOverlay(); if (window.app && app.currentScreen === 'screenClock') app.onNavigateToClock(); }, 1500);
        }
    },

    _showAssignmentError(msg) {
        const o = document.getElementById('nfcScanOverlay');
        if (o) { o.style.background = 'rgba(198,40,40,0.9)'; o.innerHTML = '<div style="font-size:72px;margin-bottom:16px">❌</div><h3>Toewijzing mislukt</h3><p>' + msg + '</p><button class="nfc-cancel-btn" onclick="QEClock._removeNfcOverlay()" style="margin-top:20px">Sluiten</button>'; }
    },

    async _handleAssignmentScan(tagId) {
        const assignment = this._pendingAssignment;
        this._pendingAssignment = null;
        try {
            await RobawsAPI.saveNfcTagId(assignment.fieldName, tagId);
            await this.loadTagConfig();
            this._showAssignmentSuccess(assignment.locationName);
        } catch (e) { this._showAssignmentError(e.message); }
    },

    _pendingSyncKey() {
        const user = RobawsAPI.getLoggedInUser();
        if (!user || !user.email) return null;
        return 'qe_clock_pending_' + user.email;
    },

    _readPendingSync() {
        const key = this._pendingSyncKey();
        if (!key) return { key: null, items: [] };
        let items = [];
        try { const raw = localStorage.getItem(key); if (raw) items = JSON.parse(raw); if (!Array.isArray(items)) items = []; } catch(e) {}
        return { key, items };
    },

    _addPendingSync(item) {
        const { key, items } = this._readPendingSync();
        if (!key) return;
        const user = RobawsAPI.getLoggedInUser();
        const myId = user ? String(user.robawsEmployeeId) : null;
        items.push({ ...item, ownerEmployeeId: myId, employeeId: myId, timestamp: this._now().toISOString() });
        try { localStorage.setItem(key, JSON.stringify(items)); } catch(e) {}
    },

    async syncPending() {
        const { key, items: pending } = this._readPendingSync();
        if (!key || pending.length === 0) return;
        const user = RobawsAPI.getLoggedInUser();
        const myId = user ? String(user.robawsEmployeeId) : null;
        const myItems = pending.filter(it => it.ownerEmployeeId && String(it.ownerEmployeeId) === myId);
        if (myItems.length === 0) { try { localStorage.setItem(key, JSON.stringify([])); } catch(_) {} return; }

        const remaining = [];
        for (const item of myItems) {
            try {
                if (item.action === 'update' && item.id) {
                    await RobawsAPI.updateTimeRegistration(item.id, { endDate: item.endDate, hours: item.hours });
                } else if (item.action === 'create_complete') {
                    await RobawsAPI.createTimeRegistration({ employeeId: myId, startDate: item.startDate, endDate: item.endDate, hours: item.hours, type: item.type, remarks: item.remarks });
                } else if (item.action === 'create_open') {
                    const result = await RobawsAPI.createTimeRegistration({ employeeId: myId, startDate: item.startISO, type: item.type, remarks: item.remarks });
                    if (result && (result.code === 200 || result.code === 201) && result.data) {
                        const newId = String(result.data.id);
                        const session = this.getSession();
                        if (session && session.startISO === item.startISO && !session.robawsId) {
                            session.robawsId = newId; this._saveSession(session);
                        }
                    } else { throw new Error('Robaws gaf code ' + (result && result.code)); }
                }
            } catch (e) { remaining.push(item); }
        }
        try { localStorage.setItem(key, JSON.stringify(remaining)); } catch(_) {}
    },

    async getHistory(days = 7) {
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return [];
        try {
            const res = await RobawsAPI.get('time-registrations?employeeId=' + user.robawsEmployeeId + '&limit=100');
            if (res.code !== 200 || !res.data || !res.data.items) return [];
            const cutoff = this._now();
            cutoff.setDate(cutoff.getDate() - days);
            const cutoffStr = cutoff.toISOString();
            const empId = String(user.robawsEmployeeId);
            return res.data.items
                .filter(item => {
                    if (!(item.startDate >= cutoffStr)) return false;
                    const itemEmpId = item.employeeId || (item.employee && item.employee.id);
                    if (!itemEmpId) return false;
                    return String(itemEmpId) === empId;
                })
                .sort((a, b) => b.startDate.localeCompare(a.startDate));
        } catch (e) { return []; }
    },

    async syncWithRobaws() {
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return;
        let robawsRegs;
        try {
            const today = this._localDate();
            robawsRegs = await RobawsAPI.getTimeRegistrations(user.robawsEmployeeId, today);
        } catch (e) {
            console.warn('[Clock] Robaws sync mislukt — sessie BEHOUDEN:', e.message);
            return;
        }
        try {
            const myEmpId = String(user.robawsEmployeeId);
            robawsRegs = robawsRegs.filter(r => {
                const empId = r.employeeId || (r.employee && r.employee.id);
                if (!empId) return false;
                if (String(empId) !== myEmpId) return false;
                return true;
            });
            if (robawsRegs.length === 0) {
                const session = this.getSession();
                if (session && (session.active || (session.completedSessions || []).length > 0)) {
                    const key = this._getSessionKey();
                    if (key) localStorage.removeItem(key);
                }
                return;
            }
            let session = this.getSession() || this._newSession();
            const completedFromRobaws = robawsRegs.filter(r => r.endDate).map(r => ({
                startTime: new Date(r.startDate).toTimeString().slice(0, 5),
                endTime: new Date(r.endDate).toTimeString().slice(0, 5),
                type: r.type || 'Op tijd', robawsId: String(r.id),
                tagName: (r.remarks || '').split(' — ')[0] || '',
                hours: r.hours || this._calcHours(r.startDate, r.endDate),
            }));
            session.completedSessions = completedFromRobaws;
            const openReg = robawsRegs.find(r => !r.endDate);
            if (openReg) {
                session.active = true;
                session.robawsId = String(openReg.id);
                session.startTime = new Date(openReg.startDate).toTimeString().slice(0, 5);
                session.startISO = openReg.startDate;
                session.registrationType = openReg.type || 'Op tijd';
                if (openReg.remarks) session.tagName = openReg.remarks.split(' — ')[0] || session.tagName;
            } else {
                session.active = false; session.robawsId = null;
                const firstReg = robawsRegs.find(r => r.type === 'Op tijd' || r.type === 'Te laat');
                if (firstReg) session.registrationType = firstReg.type;
                else if (completedFromRobaws.length > 0) session.registrationType = completedFromRobaws[0].type;
                const earliest = robawsRegs.reduce((a, b) => a.startDate < b.startDate ? a : b);
                session.startTime = new Date(earliest.startDate).toTimeString().slice(0, 5);
            }
            this._saveSession(session);
        } catch (e) { console.warn('[Clock] Robaws sync mislukt:', e.message); }
    },

    async getAllAttendanceToday() {
        const me = RobawsAPI.getLoggedInUser();
        if (!me || me.role !== 'bureel') return [];
        try {
            const allRegs = await RobawsAPI.getAllTimeRegistrationsToday();
            const byEmployee = {};
            for (const reg of allRegs) {
                const empId = reg.employeeId;
                if (!byEmployee[empId]) byEmployee[empId] = [];
                byEmployee[empId].push(reg);
            }
            const result = [];
            for (const [empId, regs] of Object.entries(byEmployee)) {
                let name = 'Werknemer ' + empId;
                try {
                    const empRes = await RobawsAPI.get('employees/' + empId);
                    if (empRes.code === 200 && empRes.data) name = empRes.data.fullName || empRes.data.name || name;
                } catch(e) {}
                const firstOfDay = regs.find(r => r.type === 'Op tijd' || r.type === 'Te laat');
                const clockTime = firstOfDay ? new Date(firstOfDay.startDate).toTimeString().slice(0,5) : null;
                const isLate = firstOfDay ? firstOfDay.type === 'Te laat' : false;
                result.push({
                    employeeId: empId, name, clockTime, isLate,
                    type: firstOfDay ? firstOfDay.type : null,
                    totalRegistrations: regs.length,
                    ladenLossen: regs.filter(r => r.type === 'Laden & Lossen').length,
                    extraUren: regs.filter(r => r.type === 'Extra uren').length,
                    registrations: regs,
                });
            }
            return result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } catch (e) { return []; }
    },

    renderTagAdmin() {
        const config = this.getTagConfig();
        if (!config) return '<p class="text-grey text-sm">NFC configuratie niet geladen</p>';
        let html = '';
        html += this._renderTagRow('🏢', 'Bureau', config.bureau, 'NFC Bureau Tag');
        html += this._renderTagRow('📦', 'Laden & Lossen', config.ladenLossen, 'NFC Bureau Tag Laden & Lossen');
        for (const cam of (config.camionetten || [])) html += this._renderTagRow('🚐', cam.name, cam, cam.fieldName);
        return html;
    },

    _tagRowCounter: 0,

    _renderTagRow(icon, name, tagData, fieldName) {
        const tagId = tagData && tagData.tagId ? tagData.tagId : null;
        const statusColor = tagId ? 'var(--qe-green)' : 'var(--qe-orange)';
        const statusText = tagId ? tagId.substring(0, 16) + (tagId.length > 16 ? '...' : '') : 'Niet ingesteld';
        const rowId = 'tagRow_' + (this._tagRowCounter++);
        const fA = this._htmlAttr(fieldName);
        const nA = this._htmlAttr(name);
        const clearBtn = tagId ? '<button data-action="clear" data-field="' + fA + '" style="font-size:11px;color:#E53935;background:none;border:none;cursor:pointer;padding:4px">✕</button>' : '';
        const scanBtn = '<button data-action="assign" data-field="' + fA + '" data-name="' + nA + '" style="font-size:11px;color:var(--qe-purple);background:none;border:1px solid var(--qe-purple);border-radius:6px;cursor:pointer;padding:4px 8px">📱 Scan</button>';
        return '<div id="' + rowId + '" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:20px">' + icon + '</span><div><div style="font-size:14px;font-weight:500">' + name + '</div><div style="font-size:11px;color:' + statusColor + ';font-family:monospace">' + statusText + '</div></div></div><div style="display:flex;align-items:center;gap:4px">' + scanBtn + clearBtn + '</div></div>';
    },

    _htmlAttr(str) { return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },

    bindTagAdminEvents() {
        const container = document.getElementById('clockTagList');
        if (!container) return;
        container.querySelectorAll('button[data-action="assign"]').forEach(btn => {
            btn.addEventListener('click', () => {
                QEClock.startTagAssignment(btn.getAttribute('data-field'), btn.getAttribute('data-name'));
            });
        });
        container.querySelectorAll('button[data-action="clear"]').forEach(btn => {
            btn.addEventListener('click', () => { QEClock._clearTag(btn.getAttribute('data-field')); });
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
        } catch (e) { if (window.app) app.toast('Kon tag niet verwijderen: ' + e.message, true); }
    },

    isClockedIn() { return this.isActive(); },
    isLate() {
        const session = this.getSession();
        if (!session) { const now = this._localTime(); return now > this.getExpectedStartTime(); }
        if (session.registrationType === 'Te laat') return true;
        return (session.completedSessions || []).some(s => s.type === 'Te laat');
    },
    getClockTime() {
        const session = this.getSession();
        if (!session) return null;
        const completed = session.completedSessions || [];
        if (completed.length > 0) return completed[0].startTime;
        if (session.startTime) return session.startTime;
        return null;
    },
    getRegistrationType() { const s = this.getSession(); return s ? s.registrationType : null; },
    getActiveTagName() { const s = this.getSession(); return s && s.active ? s.tagName : null; },
};
