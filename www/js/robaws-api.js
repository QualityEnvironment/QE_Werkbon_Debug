/**
 * QE Werkbon App — Robaws API Module
 * Directe communicatie met Robaws API v2 (geen PHP proxy nodig)
 *
 * Quality Environment bvba - Intern gebruik
 */

const RobawsAPI = {
    // === CONFIGURATIE ===
    BASE_URL: 'https://app.robaws.com/api/v2',

    // === CACHE ===
    _articleCache: null,       // Alle artikelen (1x geladen)
    _articleCacheLoading: false,
    API_KEY: 'KBM8UEKYPLHIXDHIQ1IL',
    API_SECRET: 'xmFYgMmDi4xFLiPZy8qCslSKbCmSDIgIErmTWJZ5',
    TENANT: 'qualityenvironment',

    // === MEDEWERKERS MAPPING ===
    // userId = Robaws USER id (voor assignedUserId/verantwoordelijke)
    // employeeId = Robaws EMPLOYEE id (voor time-entries/planning)
    // Bron: auth.php user_mapping + Robaws gebruikersbeheer
    EMPLOYEES: {
        // Techniekers
        'glycera@qe.be':             { employeeId: 7,  userId: 10,    name: 'Glycera',    role: 'technieker' },
        'sascha@qe.be':              { employeeId: 9,  userId: 18,    name: 'Sascha',     role: 'technieker' },
        'daxleekens@qe.be':          { employeeId: 10, userId: 9,     name: 'Dax',        role: 'technieker' },
        'olivier.puchacz@qe.be':     { employeeId: 12, userId: 13,    name: 'Olivier',    role: 'technieker' },
        'yassine@qe.be':             { employeeId: 30, userId: 20,    name: 'Yassine',    role: 'technieker' },
        // Monteurs
        'levi@qe.be':                { employeeId: 1,  userId: 8,     name: 'Levi',       role: 'bureel' },
        'stefan@qe.be':              { employeeId: 2,  userId: 21,    name: 'Stefan',     role: 'monteur' },
        'jelle@qe.be':               { employeeId: 3,  userId: 14,    name: 'Jelle',      role: 'monteur' },
        'wim@qe.be':                 { employeeId: 4,  userId: 22,    name: 'Wim',        role: 'monteur' },
        'jens@qe.be':                { employeeId: 5,  userId: 23,    name: 'Jens',       role: 'monteur' },
        'herve@qe.be':               { employeeId: 8,  userId: 15,    name: 'Herve',      role: 'monteur' },
        'keng@qe.be':                { employeeId: 11, userId: 17,    name: 'Keng',       role: 'monteur' },
        'joshua@qe.be':              { employeeId: 13, userId: 16,    name: 'Joshua',     role: 'monteur' },
        // Bureel / kantoor
        'vince@qe.be':               { employeeId: 16, userId: 5,     name: 'Vince',      role: 'bureel' },
        'bjorn@qe.be':               { employeeId: 19, userId: 4,     name: 'Bjorn',      role: 'bureel' },
        'bart@qe.be':                { employeeId: 20, userId: 7,     name: 'Bart',       role: 'bureel' },
        'felicity@qe.be':            { employeeId: 21, userId: 6,     name: 'Felicity',   role: 'bureel' },
        'rolf@qe.be':                { employeeId: 22, userId: 2,     name: 'Rolf',       role: 'bureel' },
        'els@qe.be':                 { employeeId: 23, userId: 3,     name: 'Els',        role: 'bureel' },
    },

    // v219: Tijd-types die een AFWEZIGHEID zijn (de Robaws-keuzelijst minus
    // "Op tijd"/"Te laat"). Eén bron voor klok, aanwezigheid en dagoverzicht.
    ABSENCE_TIJD: ['Ziek', 'Betaalde feestdag', 'Inhaal rustdag', 'Verlof', 'Sociaal verlof'],

    // === AUTH HEADERS ===
    getHeaders() {
        const auth = btoa(this.API_KEY + ':' + this.API_SECRET);
        return {
            'Authorization': 'Basic ' + auth,
            'X-Tenant': this.TENANT,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
    },

    // === HELPERS ===

    /** Rond uren naar boven af op halve uren (voor facturatie).
     *  Bv: 0.22 → 0.5, 0.5 → 0.5, 0.51 → 1.0, 1.0 → 1.0, 1.1 → 1.5 */
    _roundUpHalfHour(hours) {
        return Math.ceil(hours * 2) / 2;
    },

    // === BASIS API CALLS ===
    // v184: cache + in-flight-dedup laag rond get().
    //  - Enkel GET wordt gecached, nooit mutaties (post/put).
    //  - Enkel top-level "resource/{id}" GETs (geen query, geen sub-resource)
    //    krijgen een TTL-cache. Lijst/query-GETs (met ?) worden NIET gecached
    //    maar wel ge-dedup't (gelijktijdige identieke calls -> 1 fetch).
    //  - Elke cache-/dedup-hit geeft een DEEP CLONE terug, zodat code die een
    //    record ophaalt-muteert-PUT (installatie/klant/werkbon) de cache niet
    //    corrumpeert.
    //  - put()/post() invalideren de betrokken resource/{id}-sleutel.
    _getCache: {},        // key -> { at, value }
    _getInflight: {},     // key -> Promise

    /** TTL (ms) voor een endpoint, of 0 als niet cachebaar. */
    _cacheTtlFor(key) {
        if (key.includes('?')) return 0;                  // lijst/query -> niet cachen
        const m = key.match(/^([a-z-]+)\/(\d+)$/);         // exact "resource/id"
        if (!m) return 0;                                  // sub-resource e.d. -> niet cachen
        const TTL = {
            'clients':        15 * 60 * 1000,
            'employees':      60 * 60 * 1000,
            'employee-roles': 60 * 60 * 1000,
            'articles':       60 * 60 * 1000,
            'vat-tariffs':    60 * 60 * 1000,
            'sales-orders':    5 * 60 * 1000,
            'installations':   5 * 60 * 1000,
            'planning-items':      60 * 1000,
            'work-orders':         30 * 1000,
        };
        return TTL[m[1]] != null ? TTL[m[1]] : 60 * 1000;  // default 60s voor andere /{id}
    },

    _cloneResult(r) {
        if (!r) return r;
        try {
            return { code: r.code, data: (r.data == null) ? r.data : JSON.parse(JSON.stringify(r.data)) };
        } catch (_) {
            return { code: r.code, data: r.data };
        }
    },

    /** Wis de cache-sleutel die bij een mutatie hoort (resource/{id}-prefix). */
    _invalidateCache(endpoint) {
        const e = String(endpoint).replace(/^\//, '');
        const m = e.match(/^([a-z-]+\/\d+)/);   // bv "work-orders/456" (ook bij .../time-entries)
        if (m) {
            delete this._getCache[m[1]];
            delete this._getInflight[m[1]];
        }
    },

    // v207: fetch met harde timeout. In de Android-WebView kan een fetch op
    // "dode" wifi (verbonden maar geen internet, vliegtuigmodus-randgevallen)
    // MINUTENLANG hangen — en navigator.onLine zegt dan ook nog true. Eén
    // centrale timeout maakt elke Robaws-call eindig; de foutmelding bevat
    // "timeout" zodat de netwerkfout-detectie in app.js hem herkent en de
    // werkbon alsnog netjes de offline-wachtrij in gaat.
    _TIMEOUT_MS: 20000,          // get/post/put
    _TIMEOUT_UPLOAD_MS: 90000,   // uploads (foto's op traag 4G)
    async _fetchWithTimeout(url, opts, timeoutMs) {
        const ms = timeoutMs || this._TIMEOUT_MS;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        try {
            return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
        } catch (e) {
            if (e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message)))) {
                throw new Error('Netwerk-timeout na ' + Math.round(ms / 1000) + 's (geen verbinding?)');
            }
            throw e;
        } finally {
            clearTimeout(timer);
        }
    },

    /** Rauwe fetch zonder cache (interne helper). */
    async _rawGet(key) {
        const url = this.BASE_URL + '/' + key;
        const res = await this._fetchWithTimeout(url, { headers: this.getHeaders() });
        if (res.status === 204) return { code: 204, data: null };
        const txt = await res.text();
        if (!txt) return { code: res.status, data: null };
        try {
            return { code: res.status, data: JSON.parse(txt) };
        } catch (e) {
            return { code: res.status, data: { raw: txt } };
        }
    },

    async get(endpoint, opts) {
        const key = String(endpoint).replace(/^\//, '');
        const ttl = this._cacheTtlFor(key);
        const bypass = !!(opts && opts.bypassCache);

        // 1. Cache-hit
        if (ttl > 0 && !bypass) {
            const hit = this._getCache[key];
            if (hit && (Date.now() - hit.at) < ttl) {
                return this._cloneResult(hit.value);
            }
        }
        // 2. In-flight dedup: deel een lopende identieke GET
        if (!bypass && this._getInflight[key]) {
            const shared = await this._getInflight[key];
            return this._cloneResult(shared);
        }
        // 3. Echte fetch (in-flight registreren voor dedup)
        const p = this._rawGet(key);
        this._getInflight[key] = p;
        let result;
        try {
            result = await p;
        } finally {
            delete this._getInflight[key];
        }
        // 4. Cache schrijven (enkel 200 + cachebaar) en clone teruggeven
        if (ttl > 0 && result && result.code === 200) {
            if (Object.keys(this._getCache).length > 800) this._getCache = {};  // simpele size-cap
            this._getCache[key] = { at: Date.now(), value: result };
            return this._cloneResult(result);
        }
        return result;
    },

    async post(endpoint, body) {
        this._invalidateCache(endpoint);   // v184: cache van het betrokken record wissen
        const url = this.BASE_URL + '/' + endpoint.replace(/^\//, '');
        const res = await this._fetchWithTimeout(url, {   // v207: timeout
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });
        // 204 No Content of lege body veilig afhandelen
        if (res.status === 204) return { code: 204, data: null };
        const txt = await res.text();
        if (!txt) return { code: res.status, data: null };
        try {
            return { code: res.status, data: JSON.parse(txt) };
        } catch (e) {
            return { code: res.status, data: { raw: txt } };
        }
    },

    async put(endpoint, body) {
        this._invalidateCache(endpoint);   // v184: cache van het betrokken record wissen
        const url = this.BASE_URL + '/' + endpoint.replace(/^\//, '');
        const res = await this._fetchWithTimeout(url, {   // v207: timeout
            method: 'PUT',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });
        // PUT returns 204 No Content on success
        if (res.status === 204) return { code: 204, data: null };
        // BUG-fix: bij Cloudflare/HTML 502/504 crashte `await res.json()`
        // op niet-JSON inhoud. Nu eerst tekst lezen en daarna parsen.
        const txt = await res.text();
        try {
            const data = txt ? JSON.parse(txt) : null;
            return { code: res.status, data };
        } catch(e) {
            return { code: res.status, data: { raw: txt } };
        }
    },

    // v211: DELETE-wrapper — nodig voor rollback van half-aangemaakte records
    // (bv. een werkbon waarvan de veld-PUT faalde).
    async del(endpoint) {
        this._invalidateCache(endpoint);
        const url = this.BASE_URL + '/' + endpoint.replace(/^\//, '');
        const res = await this._fetchWithTimeout(url, {
            method: 'DELETE',
            headers: this.getHeaders(),
        });
        if (res.status === 204) return { code: 204, data: null };
        const txt = await res.text();
        try {
            return { code: res.status, data: txt ? JSON.parse(txt) : null };
        } catch (e) {
            return { code: res.status, data: { raw: txt } };
        }
    },

    async uploadFile(endpoint, file, fileName) {
        const url = this.BASE_URL + '/' + endpoint.replace(/^\//, '');
        const auth = btoa(this.API_KEY + ':' + this.API_SECRET);

        const formData = new FormData();
        formData.append('file', file, fileName);

        const res = await this._fetchWithTimeout(url, {   // v207: ruime upload-timeout
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + auth,
                'X-Tenant': this.TENANT,
                'Accept': 'application/json',
                // Geen Content-Type — browser zet multipart boundary automatisch
            },
            body: formData,
        }, this._TIMEOUT_UPLOAD_MS);
        // BUG-fix: zelfde JSON-parse safety als bij put().
        const txt = await res.text();
        try {
            const data = txt ? JSON.parse(txt) : null;
            return { code: res.status, data };
        } catch(e) {
            return { code: res.status, data: { raw: txt } };
        }
    },

    // Document downloaden (retourneert { blobUrl, contentType })
    // Gebruikt de Android native bridge (Java HTTP) om Robaws login redirect te omzeilen.
    async getDocumentUrl(documentId) {
        if (typeof QEBridge !== 'undefined' && QEBridge.downloadRobawsDocument) {
            try {
                const result = QEBridge.downloadRobawsDocument(
                    String(documentId), this.API_KEY, this.API_SECRET, this.TENANT
                );
                if (result && result.length > 0) {
                    // Format: "contentType|base64data"
                    const pipeIdx = result.indexOf('|');
                    const contentType = pipeIdx > 0 ? result.substring(0, pipeIdx) : 'application/octet-stream';
                    const base64 = pipeIdx > 0 ? result.substring(pipeIdx + 1) : result;

                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    const blob = new Blob([bytes], { type: contentType });
                    return { blobUrl: URL.createObjectURL(blob), contentType, blob };
                }
            } catch(e) {
                console.warn('[RobawsAPI] Native download mislukt:', e);
            }
        }

        throw new Error('Kon document niet downloaden');
    },

    // =============================================
    // HELPERS
    // =============================================

    /**
     * Probeer de Robaws userId van een werknemer dynamisch op te halen.
     * Doorzoekt achtereenvolgens:
     *   1. lokale cache (qe_emp_cache_<email>)
     *   2. employee-record (employees/{id}) → userId / user.id
     *   3. /users met filters (employeeId, dan email)
     *   4. /users zonder filter (volledige scan, gepagineerd)
     * Returns userId (string/number) of null.
     *
     * Wordt gebruikt om "werkbon zonder verantwoordelijke" te voorkomen
     * wanneer login hem niet kon oplossen.
     */
    async _resolveUserIdForEmployee(employeeId, emailHint) {
        if (!employeeId) return null;
        const empIdStr = String(employeeId);

        // 1) Probeer via /employees/{id}
        try {
            const empRes = await this.get(`employees/${empIdStr}`);
            if (empRes.code === 200 && empRes.data) {
                const direct = empRes.data.userId
                    || (empRes.data.user && empRes.data.user.id)
                    || null;
                if (direct) return direct;
                if (!emailHint) emailHint = (empRes.data.email || '').toLowerCase();
            }
        } catch(e) { /* ga door */ }

        // 2) Probeer /users?employeeId=...
        try {
            const filtered = await this.get(`users?employeeId=${encodeURIComponent(empIdStr)}&limit=10`);
            if (filtered.code === 200 && filtered.data) {
                const list = filtered.data.items || (Array.isArray(filtered.data) ? filtered.data : []);
                const m = list.find(u => u && (
                    String(u.employeeId || '') === empIdStr ||
                    (u.employee && String(u.employee.id || '') === empIdStr)
                ));
                if (m && m.id) return m.id;
            }
        } catch(e) { /* ga door */ }

        // 3) Probeer /users?email=...
        if (emailHint) {
            try {
                const byEmail = await this.get(`users?email=${encodeURIComponent(emailHint)}&limit=10`);
                if (byEmail.code === 200 && byEmail.data) {
                    const list = byEmail.data.items || (Array.isArray(byEmail.data) ? byEmail.data : []);
                    const m = list.find(u => u && (u.email || u.emailAddress || u.username || '').toLowerCase() === emailHint);
                    if (m && m.id) return m.id;
                }
            } catch(e) { /* ga door */ }
        }

        // 4) Volledige scan op /users (gepagineerd, max 5 pagina's)
        try {
            let page = 0;
            do {
                const r = await this.get(`users?limit=100&offset=${page * 100}`);
                if (r.code !== 200 || !r.data) break;
                const list = r.data.items || (Array.isArray(r.data) ? r.data : []);
                if (list.length === 0) break;
                let m = list.find(u => u && (
                    String(u.employeeId || '') === empIdStr ||
                    (u.employee && String(u.employee.id || '') === empIdStr)
                ));
                if (!m && emailHint) {
                    m = list.find(u => u && (u.email || u.emailAddress || u.username || '').toLowerCase() === emailHint);
                }
                if (m && m.id) return m.id;
                page++;
                if (page >= (r.data.totalPages || 1)) break;
            } while (page < 5);
        } catch(e) { /* opgeven */ }

        return null;
    },

    /**
     * Garandeer dat de ingelogde gebruiker een robawsUserId heeft.
     * Als die ontbreekt, los hem op via _resolveUserIdForEmployee en
     * persist de aangevulde user terug in localStorage zodat volgende
     * submits hem direct kunnen gebruiken (geen extra round-trip).
     * Returns het userId (number/string) of null.
     */
    async ensureUserId() {
        const user = this.getLoggedInUser();
        if (!user) return null;
        if (user.robawsUserId) return user.robawsUserId;
        if (!user.robawsEmployeeId) return null;
        const resolved = await this._resolveUserIdForEmployee(user.robawsEmployeeId, user.email);
        if (resolved) {
            user.robawsUserId = resolved;
            try { localStorage.setItem('qe_user', JSON.stringify(user)); } catch(e) {}
            // Cache ook bijwerken zodat offline-fallback de userId heeft
            try {
                const cacheKey = 'qe_emp_cache_' + (user.email || '').toLowerCase();
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const c = JSON.parse(cached);
                    c.userId = resolved;
                    localStorage.setItem(cacheKey, JSON.stringify(c));
                }
            } catch(e) {}
            // Zorg dat ook de in-memory app.currentUser bijgewerkt is
            try {
                if (typeof window !== 'undefined' && window.app && window.app.currentUser) {
                    window.app.currentUser.robawsUserId = resolved;
                }
            } catch(e) {}
            console.log('[RobawsAPI] robawsUserId alsnog opgehaald:', resolved);
        }
        return resolved;
    },

    /**
     * Brussel-aware "YYYY-MM-DD" string. Vervangt het foute patroon
     * `new Date().toISOString().split('T')[0]` dat UTC-datum gaf
     * en daardoor rond middernacht (22:00 UTC = 00:00 CEST) de
     * verkeerde dag teruggaf — werkbonnen op verkeerde datum.
     */
    _localDateStr(d, offsetDays) {
        const base = (d instanceof Date) ? d : new Date();
        const t = new Date(base.getTime() + (offsetDays ? offsetDays * 86400000 : 0));
        try {
            // 'en-CA' geeft "YYYY-MM-DD" formaat
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Europe/Brussels',
                year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(t);
        } catch(e) {
            // Fallback voor oude WebViews zonder Intl-Brussel-tz
            const y = t.getFullYear();
            const m = String(t.getMonth() + 1).padStart(2, '0');
            const day = String(t.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
    },

    formatAddress(addr) {
        if (!addr) return '';
        if (typeof addr === 'string') return addr;
        // Robaws address object: { addressLine1, addressLine2, postalCode, city, country, latitude, longitude }
        const parts = [];
        if (addr.addressLine1) parts.push(addr.addressLine1);
        if (addr.addressLine2) parts.push(addr.addressLine2);
        const cityPart = [addr.postalCode, addr.city].filter(Boolean).join(' ');
        if (cityPart) parts.push(cityPart);
        return parts.join(', ') || '';
    },

    // =============================================
    // LOGIN
    // =============================================
    async login(email, pin) {
        // === VOLLEDIG DYNAMISCHE LOGIN VIA ROBAWS ===
        // Geen hardcoded EMPLOYEES mapping meer nodig.
        // Alles wordt opgehaald uit Robaws: werknemer, pincode, rol, gelinkte gebruiker.
        const emailLower = email.toLowerCase().trim();
        console.log('[RobawsAPI] Login poging voor:', emailLower);

        // Stap 1: Zoek de werknemer op email in Robaws.
        // v132: retry 1x bij transient failure + 3e fallback zonder status-filter
        // zodat ook niet-"actieve" werknemers gevonden worden.
        // v134: gebruik cache van check-email om dubbele Robaws-calls te voorkomen
        //       (kritiek voor werknemers waar ?email= filter niet werkt — die
        //       hebben pagination nodig, en 2x pagination triggert rate-limit).
        let employee = null;
        let lastSearchError = null;
        try {
            const cachedRaw = localStorage.getItem('qe_login_emp_cache_' + emailLower);
            if (cachedRaw) {
                const cached = JSON.parse(cachedRaw);
                const ageMs = Date.now() - (cached.at || 0);
                if (cached.emp && ageMs < 5 * 60 * 1000 && (cached.emp.email || '').toLowerCase() === emailLower) {
                    employee = cached.emp;
                    console.log('[RobawsAPI] employee cache hit (uit check-email):', employee.id);
                }
            }
        } catch(_) {}
        const fetchEmployee = async () => {
            // 1a) Filter op email
            const searchRes = await this.get(`employees?email=${encodeURIComponent(emailLower)}&limit=50`);
            const allEmps = (searchRes.data && searchRes.data.items) || [];
            let emp = allEmps.find(e => (e.email || '').toLowerCase() === emailLower);
            // 1b) Niet gevonden — probeer alle actieve werknemers
            if (!emp) {
                let page = 0;
                const allActive = [];
                do {
                    const res = await this.get(`employees?status=actief&limit=100&offset=${page * 100}`);
                    const items = (res.data && res.data.items) || [];
                    if (items.length === 0) break;
                    allActive.push(...items);
                    page++;
                    if (page >= (res.data.totalPages || 1)) break;
                } while (page < 5);
                emp = allActive.find(e => (e.email || '').toLowerCase() === emailLower);
            }
            // 1c) Nog niet gevonden — probeer ZONDER status-filter
            //     (werknemer kan andere status hebben dan "actief")
            if (!emp) {
                let page = 0;
                const allEmps2 = [];
                do {
                    const res = await this.get(`employees?limit=100&offset=${page * 100}`);
                    const items = (res.data && res.data.items) || [];
                    if (items.length === 0) break;
                    allEmps2.push(...items);
                    page++;
                    if (page >= (res.data.totalPages || 1)) break;
                } while (page < 5);
                emp = allEmps2.find(e => (e.email || '').toLowerCase() === emailLower);
            }
            return emp || null;
        };
        if (!employee) {
            try {
                employee = await fetchEmployee();
            } catch(e) {
                lastSearchError = e;
                console.warn('[RobawsAPI] Eerste werknemer-zoek faalde, retry over 1.2s:', e && e.message);
                await new Promise(r => setTimeout(r, 1200));
                try { employee = await fetchEmployee(); }
                catch(e2) {
                    console.error('[RobawsAPI] Beide werknemer-zoek pogingen faalden:', e2 && e2.message);
                    lastSearchError = e2;
                }
            }
        }
        if (!employee && lastSearchError) {
            // Echte connection-fout — geef originele error door voor diagnostiek
            return this._loginFallback(emailLower, pin, lastSearchError);
        }

        if (!employee) {
            // v136: Werknemer niet gevonden via email-search of pagination.
            // Mogelijk omdat hun email in Robaws afwijkt van wat de user typt
            // (bv. dax.leekens@qe.be vs daxleekens@qe.be).
            // → Als de user in EMPLOYEES mapping staat, doe een DIRECTE
            //   employees/{id} lookup ipv te zoeken op email.
            const mapped = this.EMPLOYEES[emailLower];
            if (mapped && mapped.employeeId) {
                try {
                    console.log('[RobawsAPI] Email-search miste werknemer, directe lookup via EMPLOYEES mapping id=' + mapped.employeeId);
                    const directRes = await this.get(`employees/${mapped.employeeId}`);
                    if (directRes.code === 200 && directRes.data) {
                        employee = directRes.data;
                    }
                } catch(e) {
                    console.warn('[RobawsAPI] Directe employee lookup faalde:', e && e.message);
                }
            }
        }
        if (!employee) {
            // Geen mapping én geen API-result → echt onbekend
            return {
                success: false,
                error: 'Werknemer niet gevonden in Robaws (v136). Vraag Levi om je werknemerfiche te controleren.',
            };
        }

        console.log('[RobawsAPI] Werknemer gevonden:', employee.id, employee.firstName, employee.lastName);

        // PIN checken via extra veld "Pincode" (groep "QE Werkbon app", type TEXT).
        // v132: ook andere veld-naam-varianten + value-types proberen voor het geval
        // de PIN handmatig in Robaws onder een afwijkende key is gezet.
        const extraFields = employee.extraFields || {};
        console.log('[RobawsAPI] extraFields keys:', Object.keys(extraFields));
        let storedPin = '';
        const tryKeys = ['Pincode', 'PIN', 'Pin', 'pincode', 'pin'];
        for (const k of tryKeys) {
            const pf = extraFields[k];
            if (!pf) continue;
            const v = pf.stringValue ?? pf.intValue ?? pf.value ?? pf.numberValue ?? null;
            if (v != null && String(v).trim()) { storedPin = String(v).trim(); break; }
        }
        if (!storedPin) {
            // Scan alle extraFields op key die "pin" bevat
            for (const [k, pf] of Object.entries(extraFields)) {
                if (!/pin/i.test(k)) continue;
                const v = pf && (pf.stringValue ?? pf.intValue ?? pf.value ?? pf.numberValue);
                if (v != null && String(v).trim()) { storedPin = String(v).trim(); break; }
            }
        }
        console.log('[RobawsAPI] storedPin:', storedPin ? '***(' + storedPin.length + ' chars)' : '(leeg)');

        if (!storedPin) {
            // Geen PIN in Robaws → accepteer de ingevoerde PIN en sla op in Robaws
            console.log('[RobawsAPI] Geen pincode in Robaws, sla ingevoerde PIN op:', emailLower);
            try {
                await this._savePinToRobaws(employee.id, pin);
                console.log('[RobawsAPI] PIN opgeslagen in Robaws voor', emailLower);
            } catch(e) {
                console.warn('[RobawsAPI] PIN opslaan in Robaws mislukt:', e);
            }
        } else if (String(pin) !== storedPin) {
            return { success: false, error: 'PIN onjuist' };
        }

        // PIN lokaal cachen voor offline fallback (binnen 7 dagen)
        await this.setPin(emailLower, pin);
        // v118: stempel timestamp van laatste succesvolle online login zodat
        // _loginFallback kan controleren of we nog binnen de 7-dagen grace
        // zitten. Buiten die grace → offline login geweigerd.
        try { localStorage.setItem('qe_last_online_login_' + emailLower, String(Date.now())); } catch(_) {}
        // Werknemerdata ook lokaal cachen voor offline
        try {
            localStorage.setItem('qe_emp_cache_' + emailLower, JSON.stringify({
                id: employee.id,
                firstName: employee.firstName,
                lastName: employee.lastName,
                email: employee.email,
                employeeRoleId: employee.employeeRoleId,
                planningGroupName: employee.planningGroupName || employee.planningGroup || '',
                userId: employee.userId || (employee.user && employee.user.id) || null,
            }));
        } catch(e) {}

        // Stap 3: Rol ophalen uit werknemersrol / planning groep
        let roleName = '';
        let roleKey = '';
        try {
            if (employee.employeeRoleId) {
                const roleRes = await this.get(`employee-roles/${employee.employeeRoleId}`);
                if (roleRes.code === 200 && roleRes.data && roleRes.data.name) {
                    roleName = roleRes.data.name;
                    roleKey = roleName.toLowerCase();
                }
            }
            // Fallback: planning groep
            if (!roleKey) {
                const planningGroup = (employee.planningGroupName || employee.planningGroup || '').toLowerCase();
                if (planningGroup) roleKey = planningGroup;
            }
        } catch(e) { console.warn('[RobawsAPI] Rol ophalen fout:', e); }

        // Normaliseer rol
        const isMonteur = roleKey.includes('monteur');
        const isBureel = roleKey.includes('kantoor') || roleKey.includes('bureel') || roleKey.includes('projectleider') || roleKey.includes('service');
        let normalRole = 'technieker';
        let normalRoleName = 'Technieker';
        if (isMonteur) { normalRole = 'monteur'; normalRoleName = 'Monteur'; }
        else if (isBureel) { normalRole = 'bureel'; normalRoleName = 'Bureel'; }

        // Stap 4: userId ophalen (gelinkte gebruiker) — via gedeelde helper
        // zodat we exact dezelfde fallbacks gebruiken bij elke submit.
        let resolvedUserId = null;
        try {
            if (employee.userId) resolvedUserId = employee.userId;
            else if (employee.user && employee.user.id) resolvedUserId = employee.user.id;
            else {
                resolvedUserId = await this._resolveUserIdForEmployee(employee.id, emailLower);
            }
        } catch(e) { console.warn('[RobawsAPI] userId lookup fout:', e); }
        if (!resolvedUserId) {
            console.warn('[RobawsAPI] WAARSCHUWING: geen Robaws userId gevonden voor', emailLower,
                '— werkbonnen/facturen zullen dynamisch een lookup doen tijdens submit.');
        }

        const empName = [employee.firstName, employee.lastName].filter(Boolean).join(' ') || employee.name || emailLower;

        const user = {
            name: empName,
            email: emailLower,
            robawsEmployeeId: employee.id,
            robawsUserId: resolvedUserId,
            role: normalRole,
            roleName: roleName || normalRoleName,
        };
        console.log('[RobawsAPI] Login OK:', empName, '→ employeeId:', employee.id, ', userId:', resolvedUserId || 'GEEN');
        localStorage.setItem('qe_user', JSON.stringify(user));

        // Vernieuw de avatar-cache vanuit Robaws (achtergrond, niet awaited
        // zodat de login-flow niet wacht op de download). Tijdens app-gebruik
        // gebruikt get-avatar gewoon de lokale cache.
        this.refreshAvatarFromRobaws(emailLower, employee.id).catch(() => {});

        return { success: true, user };
    },

    // PIN opslaan in Robaws (extra veld "Pincode" op werknemer, type TEXT)
    async _savePinToRobaws(employeeId, pin) {
        const empRes = await this.get(`employees/${employeeId}`);
        if (empRes.code !== 200 || !empRes.data) throw new Error('Werknemer niet gevonden');
        const empData = empRes.data;
        empData.extraFields = empData.extraFields || {};
        empData.extraFields['Pincode'] = {
            type: 'TEXT',
            group: 'QE Werkbon app',
            stringValue: String(pin),
        };
        console.log('[RobawsAPI] PIN opslaan als TEXT/stringValue:', String(pin));
        const putRes = await this.put(`employees/${employeeId}`, empData);
        console.log('[RobawsAPI] PUT response code:', putRes.code);
        if (putRes.code !== 200 && putRes.code !== 204) {
            throw new Error('PUT mislukt: ' + putRes.code);
        }
    },

    // PIN wijzigen (lokaal + Robaws)
    async changePin(email, oldPin, newPin) {
        if (!/^\d{4,6}$/.test(newPin)) return { success: false, error: 'PIN moet 4 tot 6 cijfers zijn' };

        // Controleer oude PIN lokaal
        const ok = await this.verifyPin(email, oldPin);
        if (!ok) return { success: false, error: 'Huidige PIN klopt niet' };

        // Update in Robaws
        const user = this.getLoggedInUser();
        if (user && user.robawsEmployeeId) {
            try {
                await this._savePinToRobaws(user.robawsEmployeeId, newPin);
                console.log('[RobawsAPI] PIN gewijzigd in Robaws');
            } catch(e) {
                console.warn('[RobawsAPI] PIN wijzigen in Robaws mislukt:', e);
                return { success: false, error: 'Kon PIN niet wijzigen in Robaws: ' + e.message };
            }
        }

        // Update lokaal
        await this.setPin(email, newPin);
        return { success: true };
    },

    // Fallback login als Robaws onbereikbaar is.
    // v118: strenger — vereist BEIDE:
    //   1. Geldige lokaal gecachte PIN-hash (afgeleid van een eerdere online
    //      login — niet meer uit hardcoded seed)
    //   2. Laatste succesvolle online login binnen 7 dagen (`qe_last_online_login_<email>`)
    // Buiten die grace, of zonder cache → geen offline login mogelijk.
    async _loginFallback(email, pin, originalError) {
        const ONLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dagen

        // v134: log waarom we in de fallback zitten zodat we de echte fout zien
        const ctx = originalError ? (' — oorzaak: ' + (originalError.message || originalError)) : '';

        // Stap 1: PIN-cache aanwezig?
        const hasLocalPin = await this.hasPin(email);
        if (!hasLocalPin) {
            return {
                success: false,
                error: 'Robaws onbereikbaar tijdens login (v136)' + ctx + '. Probeer opnieuw of contacteer Levi.',
            };
        }

        // Stap 2: 7-dagen grace check
        let lastOnline = 0;
        try { lastOnline = parseInt(localStorage.getItem('qe_last_online_login_' + email) || '0', 10); } catch(_) {}
        const age = Date.now() - lastOnline;
        if (!lastOnline || age > ONLINE_GRACE_MS) {
            const dagen = Math.floor(age / (24 * 60 * 60 * 1000));
            return {
                success: false,
                error: 'Geen verbinding met Robaws. Laatste online login is te oud' +
                       (lastOnline ? ` (${dagen} dagen geleden)` : '') +
                       ' — verbind met internet om opnieuw in te loggen.',
            };
        }

        // Stap 3: PIN-validatie tegen lokale cache
        const ok = await this.verifyPin(email, pin);
        if (!ok) return { success: false, error: 'PIN onjuist' };

        // Stap 4: gebruikersgegevens samenstellen uit lokale cache
        const cached = localStorage.getItem('qe_emp_cache_' + email);
        const emp = this.EMPLOYEES[email];
        let user;
        if (cached) {
            const c = JSON.parse(cached);
            const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || email;
            const roleKey = (c.planningGroupName || '').toLowerCase();
            const isMonteur = roleKey.includes('monteur');
            const isBureel = roleKey.includes('kantoor') || roleKey.includes('bureel')
                          || roleKey.includes('projectleider') || roleKey.includes('service');
            let role = 'technieker';
            if (isMonteur) role = 'monteur';
            else if (isBureel) role = 'bureel';
            user = {
                name: name,
                email: email,
                robawsEmployeeId: c.id,
                robawsUserId: c.userId || null,
                role: role,
                roleName: role.charAt(0).toUpperCase() + role.slice(1),
            };
        } else if (emp) {
            user = {
                name: emp.name,
                email: email,
                robawsEmployeeId: emp.employeeId,
                robawsUserId: emp.userId || null,
                role: emp.role || 'technieker',
                roleName: emp.role || 'Technieker',
            };
        } else {
            return { success: false, error: 'Geen lokale werknemer-data — log eerst online in.' };
        }

        console.log('[RobawsAPI] Offline fallback login (binnen 7d grace):', user.name);
        localStorage.setItem('qe_user', JSON.stringify(user));
        return { success: true, user };
    },

    // v118: PIN-cache helpers behouden (nodig voor 7-dagen offline-grace
    // in `_loginFallback`), maar `seedDefaultPins()` is verwijderd zodat
    // er geen hardcoded PINs meer op een vers toestel staan. De cache
    // wordt ENKEL gevuld na een succesvolle online login (zie login).
    async _hashPin(email, pin) {
        const data = new TextEncoder().encode(`qe-pin|${email.toLowerCase()}|${pin}`);
        const buf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    },
    async hasPin(email) {
        return !!localStorage.getItem('qe_pin_' + email.toLowerCase());
    },
    async setPin(email, pin) {
        if (!/^\d{4,6}$/.test(pin)) return { success: false, error: 'PIN moet 4 tot 6 cijfers zijn' };
        const hash = await this._hashPin(email, pin);
        localStorage.setItem('qe_pin_' + email.toLowerCase(), hash);
        return { success: true };
    },
    async verifyPin(email, pin) {
        const stored = localStorage.getItem('qe_pin_' + email.toLowerCase());
        if (!stored) return false;
        const hash = await this._hashPin(email, pin);
        return hash === stored;
    },
    clearPin(email) {
        localStorage.removeItem('qe_pin_' + email.toLowerCase());
    },

    // ---- EMPLOYEE PHOTO ----
    // Robaws heeft geen dedicated avatar-endpoint. We uploaden de foto als
    // document op het medewerkerfiche (POST /employees/{id}/documents) en
    // lokaal cachen we de base64 voor offline weergave + snelle render.
    async uploadEmployeePhoto(employeeId, file, fileName = 'Foto.jpg') {
        return await this.uploadFile(`employees/${employeeId}/documents`, file, fileName);
    },
    /**
     * Haal de profielfoto-blob op voor een werknemer.
     *
     * Returns:
     *   - Blob       → foto succesvol opgehaald
     *   - null       → werknemer heeft GEEN profielfoto in Robaws (documents-
     *                  lijst is bereikbaar maar bevat geen foto/photo/avatar)
     *   - throws     → kon documents-lijst of bestand niet ophalen (offline,
     *                  redirect, fout). Caller MOET de bestaande cache
     *                  behouden, NIET wissen.
     *
     * BUG-fix: voorheen was er geen onderscheid tussen "geen foto" en "fout",
     * waardoor `refreshAvatarFromRobaws` de cache wiste bij elke netwerkfout.
     * Bovendien gebruiken we nu de native Java-bridge voor de download omdat
     * de directe fetch naar /documents/{id} in de WebView een redirect naar
     * de Robaws login-pagina krijgt.
     */
    async getEmployeePhotoBlob(employeeId) {
        // Stap 1: documents-lijst ophalen
        const res = await this.get(`employees/${employeeId}/documents`);
        if (res.code !== 200 || !res.data) {
            const e = new Error('Documents-lijst niet bereikbaar (code ' + res.code + ')');
            e.code = 'DOCS_UNREACHABLE';
            throw e;
        }
        const items = res.data.items || res.data || [];
        // Zoek alle documents met "foto/photo/profile/avatar" in de naam
        const photos = items.filter(d => /foto|photo|profile|avatar/i.test(d.name || d.fileName || ''));
        if (!photos.length) return null;  // explicit: geen foto in Robaws

        // Sorteer op createdAt desc (nieuwste eerst). Bij gelijke createdAt:
        // sorteer op naam desc (zodat Foto_2026-05-05_... vóór Foto_2026-04-01_... komt).
        photos.sort((a, b) => {
            const dateCmp = (b.createdAt || '').localeCompare(a.createdAt || '');
            if (dateCmp !== 0) return dateCmp;
            return (b.name || '').localeCompare(a.name || '');
        });
        const doc = photos[0];
        if (!doc.id) return null;

        // Stap 2: download het bestand. Eerst native bridge (omzeilt redirect),
        // anders directe fetch als laatste poging.
        if (typeof QEBridge !== 'undefined' && QEBridge.downloadRobawsDocument) {
            try {
                const result = QEBridge.downloadRobawsDocument(
                    String(doc.id), this.API_KEY, this.API_SECRET, this.TENANT
                );
                if (result && result.length > 0) {
                    const pipeIdx = result.indexOf('|');
                    const contentType = pipeIdx > 0 ? result.substring(0, pipeIdx) : 'image/jpeg';
                    const base64 = pipeIdx > 0 ? result.substring(pipeIdx + 1) : result;
                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    return new Blob([bytes], { type: contentType });
                }
                // Native bridge gaf lege string → throw (fout, geen "geen foto")
                const e = new Error('Native download gaf lege response');
                e.code = 'DOWNLOAD_EMPTY';
                throw e;
            } catch(e) {
                // Native bridge faalde — val terug op fetch
                console.warn('[RobawsAPI] Native photo-download mislukt, val terug op fetch:', e.message);
            }
        }

        // Fallback: directe fetch (werkt in een browser/PWA-context)
        const url = this.BASE_URL + '/documents/' + doc.id;
        const dlRes = await fetch(url, { headers: this.getHeaders() });
        if (!dlRes.ok) {
            const e = new Error('Document download faalde (HTTP ' + dlRes.status + ')');
            e.code = 'DOWNLOAD_FAILED';
            throw e;
        }
        const blob = await dlRes.blob();
        // Sanity check: WebView krijgt soms HTML-redirect terug met content-type text/html
        if (blob.type && blob.type.startsWith('text/html')) {
            const e = new Error('Document download gaf HTML terug (redirect naar login?)');
            e.code = 'DOWNLOAD_REDIRECTED';
            throw e;
        }
        return blob;
    },
    setLocalAvatar(email, dataUrl) {
        try {
            localStorage.setItem('qe_avatar_' + email.toLowerCase(), dataUrl);
            return true;
        } catch(e) {
            // BUG-fix: vroeger werd de quota-fout stilzwijgend geslikt → bij
            // refresh was de cache leeg en verscheen de foto niet meer.
            // Loggen zodat we het in de DevTools-console kunnen zien.
            console.warn('[RobawsAPI] Avatar opslaan in localStorage mislukt (' + e.name +
                '): mogelijk quota overschreden. dataUrl was ' +
                (dataUrl ? dataUrl.length : 0) + ' tekens lang.');
            return false;
        }
    },
    getLocalAvatar(email) {
        return localStorage.getItem('qe_avatar_' + email.toLowerCase()) || null;
    },
    clearLocalAvatar(email) {
        try { localStorage.removeItem('qe_avatar_' + email.toLowerCase()); } catch(e){}
    },

    /**
     * Schaal een dataUrl af naar maximaal NxN, JPEG met opgegeven quality.
     * Wordt gebruikt om profielfoto's te thumbnaillen voor lokale cache.
     * Resolved met de geresizede dataUrl, of bij fout met de originele
     * dataUrl als fallback.
     */
    _resizeImageDataUrl(dataUrl, maxSize, quality) {
        maxSize = maxSize || 256;
        quality = quality || 0.85;
        return new Promise((resolve) => {
            try {
                const img = new Image();
                img.onload = () => {
                    try {
                        let w = img.naturalWidth || img.width;
                        let h = img.naturalHeight || img.height;
                        if (w > maxSize || h > maxSize) {
                            if (w >= h) { h = Math.round(h * (maxSize / w)); w = maxSize; }
                            else { w = Math.round(w * (maxSize / h)); h = maxSize; }
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, w, h);
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    } catch(e) {
                        console.warn('[RobawsAPI] Image resize mislukt:', e.message);
                        resolve(dataUrl);
                    }
                };
                img.onerror = () => {
                    console.warn('[RobawsAPI] Image load mislukt voor resize');
                    resolve(dataUrl);
                };
                img.src = dataUrl;
            } catch(e) {
                resolve(dataUrl);
            }
        });
    },

    /**
     * Cache een avatar in localStorage als kleine thumbnail (256x256).
     * Voorkomt dat het quota wordt overschreden door grote profielfoto's.
     * Returns de gecachete (geresizede) dataUrl, of null bij fout.
     */
    async cacheAvatarFromDataUrl(email, dataUrl) {
        if (!dataUrl) return null;
        let toCache = dataUrl;
        try {
            toCache = await this._resizeImageDataUrl(dataUrl, 256, 0.85);
        } catch(e) {
            console.warn('[RobawsAPI] Avatar resize mislukt, val terug op origineel:', e.message);
        }
        const ok = this.setLocalAvatar(email, toCache);
        return ok ? toCache : null;
    },

    /**
     * Vernieuw de lokaal gecachete avatar door hem opnieuw uit Robaws op te
     * halen. Wordt aangeroepen ná een succesvolle login zodat een wijziging
     * van profielfoto via de admin (of via een ander toestel) door komt.
     * Tijdens normaal app-gebruik gebruikt de app gewoon de lokale cache —
     * geen Robaws-call meer per app-start.
     *
     * Belangrijke semantiek (zie getEmployeePhotoBlob):
     *   - blob       → foto opgehaald, cache vervangen
     *   - null       → Robaws bereikbaar maar werknemer heeft geen foto;
     *                  cache wissen zodat de fallback-initiaal verschijnt
     *   - throws     → ophalen mislukt (offline, redirect, fout); cache
     *                  ABSOLUUT NIET wissen, want we weten niet zeker of
     *                  er een foto is.
     */
    async refreshAvatarFromRobaws(email, employeeId) {
        if (!employeeId) return;
        let blob;
        try {
            blob = await this.getEmployeePhotoBlob(employeeId);
        } catch(e) {
            console.warn('[RobawsAPI] Avatar refresh mislukt, lokale cache behouden:', e.message);
            return;
        }
        if (blob === null) {
            // Robaws is bereikbaar én heeft echt geen foto bij deze werknemer
            this.clearLocalAvatar(email);
            console.log('[RobawsAPI] Geen foto in Robaws — lokale cache gewist');
            return;
        }
        try {
            const dataUrl = await new Promise(res => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.readAsDataURL(blob);
            });
            // Resize naar thumbnail voor cache (anders quota-issue)
            await this.cacheAvatarFromDataUrl(email, dataUrl);
            console.log('[RobawsAPI] Avatar verfrist vanuit Robaws bij login');
        } catch(e) {
            console.warn('[RobawsAPI] Avatar omzetten naar dataUrl mislukt:', e.message);
        }
    },

    getLoggedInUser() {
        const stored = localStorage.getItem('qe_user');
        if (!stored) return null;
        try {
            return JSON.parse(stored);
        } catch(e) {
            console.warn('[RobawsAPI] qe_user corrupt — wordt gewist:', e.message);
            try { localStorage.removeItem('qe_user'); } catch(_) {}
            return null;
        }
    },

    logout() {
        localStorage.removeItem('qe_user');
    },

    // =============================================
    // TIJDSREGISTRATIE (Time Registrations)
    // =============================================

    /**
     * Maak een nieuwe tijdsregistratie aan in Robaws.
     * @param {Object} data - { employeeId, startDate (ISO), type, remarks }
     * @returns {Object} - { code, data } met de aangemaakte registratie
     */
    async createTimeRegistration(data) {
        const body = {
            employeeId: String(data.employeeId),
            startDate: data.startDate,
            type: data.type || 'Op tijd',
        };
        if (data.endDate) body.endDate = data.endDate;
        if (data.hours !== undefined) body.hours = data.hours;
        if (data.remarks) body.remarks = data.remarks;
        if (data.projectId) body.projectId = String(data.projectId);
        if (data.clientId) body.clientId = String(data.clientId);
        console.log('[RobawsAPI] Tijdsregistratie aanmaken:', JSON.stringify(body));
        return await this.post('time-registrations', body);
    },

    /**
     * Update een bestaande tijdsregistratie (bijv. endDate toevoegen bij uitclocken).
     * @param {string|number} id - Robaws registratie ID
     * @param {Object} updates - velden om te updaten
     */
    async updateTimeRegistration(id, updates) {
        // Haal eerst de volledige registratie op om niets te overschrijven
        const existing = await this.get(`time-registrations/${id}`);
        if (existing.code !== 200 || !existing.data) {
            throw new Error('Tijdsregistratie niet gevonden: ' + id);
        }
        // SECURITY: ownership-check — voorkom dat we per ongeluk een PUT
        // doen op de registratie van een andere werknemer (bv. als de
        // lokale sessie nog een verkeerde robawsId bevat). Sta geen update
        // toe als de registratie niet aan de ingelogde gebruiker toebehoort.
        const me = this.getLoggedInUser();
        if (me && me.robawsEmployeeId) {
            const ownerId = existing.data.employeeId
                || (existing.data.employee && existing.data.employee.id);
            if (ownerId && String(ownerId) !== String(me.robawsEmployeeId)) {
                console.error('[RobawsAPI] WEIGER update — registratie', id,
                    'is van werknemer', ownerId, 'niet van mij (', me.robawsEmployeeId, ')');
                throw new Error(`Registratie ${id} hoort bij een andere werknemer (${ownerId})`);
            }
        }
        const body = { ...existing.data, ...updates };
        // Verwijder metadata velden die niet in PUT mogen
        delete body._metadata;
        delete body.logicId;
        delete body.createdAt;
        delete body.updatedAt;
        console.log('[RobawsAPI] Tijdsregistratie updaten:', id, JSON.stringify(updates));
        return await this.put(`time-registrations/${id}`, body);
    },

    /**
     * Haal tijdsregistraties op voor een werknemer op een specifieke datum.
     * @param {string|number} employeeId
     * @param {string} date - YYYY-MM-DD
     */
    async getTimeRegistrations(employeeId, date) {
        // BUG-fix: vroeger 1 pagina van 100 zonder sort. Robaws default sort is
        // ascending op id (oudste eerst), dus hedendaagse registraties stonden
        // op latere pagina's en verdwenen uit de respons. Resultaat: app dacht
        // dat een werknemer niet ingeklokt was → maakte een 2e registratie aan.
        // Fix: sort=id:desc (nieuwste eerst), paginate met early-stop, en GOOI
        // een fout bij niet-200 zodat caller (syncWithRobaws) geen lokale
        // sessie wist op basis van een mislukte fetch.
        let allItems = [];
        let page = 0;
        const maxPages = 10;
        while (page < maxPages) {
            const res = await this.get(`time-registrations?employeeId=${employeeId}&limit=100&offset=${page * 100}&sort=id:desc`);
            if (res.code !== 200) {
                throw new Error(`Robaws time-registrations fetch faalde (code ${res.code})`);
            }
            if (!res.data || !res.data.items || res.data.items.length === 0) break;
            allItems.push(...res.data.items);
            // Vroeg stoppen: als oudste item op deze pagina al voor de gevraagde
            // datum is, hoeven we niet verder te paginen
            const oldestOnPage = res.data.items[res.data.items.length - 1];
            const oldestDate = (oldestOnPage.startDate || '').substring(0, 10);
            if (oldestDate && oldestDate < date) break;
            page++;
            if (res.data.totalPages && page >= res.data.totalPages) break;
        }
        return allItems.filter(item => {
            const itemDate = (item.startDate || '').substring(0, 10);
            if (itemDate !== date) return false;
            // SECURITY-fix: vroeger werd item zonder employeeId als match
            // beschouwd. Robaws geeft het veld soms niet terug — een werknemer
            // kreeg dan andermans open registratie te zien als zijn eigen
            // ingeklokte tijd, en kon die ongewild afsluiten via NFC. Nu
            // VEREISEN we een expliciete employeeId match.
            const itemEmpId = item.employeeId || (item.employee && item.employee.id);
            if (!itemEmpId) {
                console.warn('[RobawsAPI] Tijdsregistratie zonder employeeId genegeerd, id=', item.id);
                return false;
            }
            return String(itemEmpId) === String(employeeId);
        });
    },

    /**
     * Haal alle tijdsregistraties op voor vandaag (alle werknemers, voor admin).
     */
    async getAllTimeRegistrationsToday() {
        const today = this._localDateStr();
        let allItems = [];
        let page = 0;
        const maxPages = 20;
        while (page < maxPages) {
            // sort=id:desc: nieuwste eerst → vandaag staat altijd vooraan,
            // ook als er duizenden historische registraties zijn
            const res = await this.get(`time-registrations?limit=100&offset=${page * 100}&sort=id:desc`);
            if (res.code !== 200) {
                throw new Error(`Robaws time-registrations fetch faalde (code ${res.code})`);
            }
            if (!res.data || !res.data.items || res.data.items.length === 0) break;
            allItems.push(...res.data.items);
            // Vroeg stoppen wanneer oudste item op deze pagina al voor vandaag is
            const oldestOnPage = res.data.items[res.data.items.length - 1];
            const oldestDate = (oldestOnPage.startDate || '').substring(0, 10);
            if (oldestDate && oldestDate < today) break;
            page++;
            if (res.data.totalPages && page >= res.data.totalPages) break;
        }
        // Filter op vandaag
        return allItems.filter(item => {
            const itemDate = (item.startDate || '').substring(0, 10);
            return itemDate === today;
        });
    },

    /** v217: alle tijdsregistratie-WERKBONNEN van vandaag (alle werknemers) —
     *  voor de Team-aanwezigheid van bureel. Registraties worden altijd op de
     *  dag zelf aangemaakt, dus de createdAt-stop maakt dit 1 pagina werk. */
    async getTeamTimeRegistrationsToday() {
        const today = this._localDateStr();
        const out = [];
        const seen = new Set();
        for (let p = 0; p < 10; p++) {
            const res = await this.get(`work-orders?limit=100&offset=${p * 100}&sort=createdAt:desc`);
            if (res.code !== 200) break;
            const items = (res.data && res.data.items) || [];
            if (items.length === 0) break;
            let stop = false;
            for (const wo of items) {
                const k = String(wo.id);
                if (seen.has(k)) continue;
                seen.add(k);
                const created = ((wo.createdAt || wo.date || '') + '').split('T')[0];
                if (created && created < today) { stop = true; break; }
                const d = ((wo.date || '') + '').split('T')[0];
                if (d !== today) continue;
                const isTR = String(wo.status || '').toLowerCase() === 'tijdsregistratie' ||
                             /^tijdsregistratie/i.test(String(wo.title || ''));
                if (!isTR) continue;
                out.push(wo);
            }
            if (stop || items.length < 100) break;
        }
        return out;
    },

    /**
     * Haal NFC tag configuratie op.
     * Tags komen van werknemer 1 (gedeeld), startuur van de ingelogde werknemer.
     * @returns {Object} - { bureau, ladenLossen, camionetten: [{name, fieldName, tagId}], startuur }
     */
    async getNfcTagConfig() {
        // Tags ophalen van werknemer 1 (gedeelde configuratie)
        const empRes = await this.get('employees/1');
        if (empRes.code !== 200 || !empRes.data) throw new Error('Kon werknemer niet ophalen');
        const config = this._parseNfcTags(empRes.data.extraFields || {});

        // Startuur + Pauze ophalen van de INGELOGDE werknemer (persoonlijk)
        // BUG-fix v56: ook voor werknemer 1, en lees alle mogelijke value-types
        // (intValue/numberValue/...) — Robaws levert numerieke extra-velden niet
        // altijd als stringValue.
        const user = this.getLoggedInUser();
        if (user && user.robawsEmployeeId) {
            try {
                const myRes = await this.get(`employees/${user.robawsEmployeeId}`);
                if (myRes.code === 200 && myRes.data && myRes.data.extraFields) {
                    console.log('[RobawsAPI] Extra velden werknemer:', JSON.stringify(Object.keys(myRes.data.extraFields)));

                    // Helper: lees een waarde uit alle gangbare value-keys
                    const extractVal = (field) => {
                        if (!field) return '';
                        const raw = field.stringValue
                            ?? field.intValue
                            ?? field.integerValue
                            ?? field.numberValue
                            ?? field.decimalValue
                            ?? field.doubleValue
                            ?? field.longValue
                            ?? field.value
                            ?? '';
                        return raw === null || raw === undefined ? '' : String(raw).trim();
                    };

                    // Zoek startuur veld (kan "Startuur werknemer" of "Startuur" heten)
                    let startField = myRes.data.extraFields['Startuur werknemer'];
                    if (!startField) startField = myRes.data.extraFields['Startuur'];
                    if (!startField) {
                        for (const [name, data] of Object.entries(myRes.data.extraFields)) {
                            if (name.toLowerCase().includes('startuur')) {
                                startField = data;
                                console.log('[RobawsAPI] Startuur gevonden als:', name);
                                break;
                            }
                        }
                    }
                    const val = extractVal(startField);
                    console.log('[RobawsAPI] Startuur waarde voor', user.name, ':', val || 'NIET GEVONDEN');
                    if (val) config.startuur = val;

                    // Pauze veld ophalen (in minuten)
                    let pauzeField = myRes.data.extraFields['Pauze'];
                    let pauzeFieldName = pauzeField ? 'Pauze' : null;
                    if (!pauzeField) {
                        for (const [name, data] of Object.entries(myRes.data.extraFields)) {
                            if (name.toLowerCase().includes('pauze')) {
                                pauzeField = data;
                                pauzeFieldName = name;
                                break;
                            }
                        }
                    }
                    let pauzeVal = extractVal(pauzeField);
                    // Strip eventuele tekst (bv. "60 min" -> "60")
                    const numMatch = pauzeVal.match(/\d+/);
                    if (numMatch) pauzeVal = numMatch[0];
                    console.log('[RobawsAPI] Pauze waarde voor', user.name,
                        '(veld:', pauzeFieldName || 'GEEN', '):',
                        pauzeVal || 'NIET GEVONDEN');
                    if (pauzeVal) config.pauze = pauzeVal;
                }
            } catch(e) {
                console.warn('[RobawsAPI] Kon startuur/pauze niet ophalen voor werknemer:', e.message);
            }
        }

        return config;
    },

    /**
     * Parse NFC tags uit extra velden.
     * Zoekt velden in groep "QE Tags" of met "NFC" in de naam.
     */
    _parseNfcTags(extraFields) {
        const result = {
            bureau: null,           // { fieldName, tagId }
            ladenLossen: null,      // { fieldName, tagId }
            camionetten: [],        // [{ name, fieldName, tagId }]
            startuur: null,         // verwachte starttijd "HH:MM"
        };
        // Velden die we moeten overslaan (niet-tag velden)
        const skipFields = ['Startuur werknemer', 'Pincode'];

        for (const [fieldName, fieldData] of Object.entries(extraFields)) {
            // Startuur apart behandelen
            if (fieldName === 'Startuur werknemer') {
                const val = fieldData ? String(fieldData.stringValue ?? fieldData.value ?? '') : '';
                if (val) result.startuur = val;
                continue;
            }
            if (skipFields.includes(fieldName)) continue;

            // Check groep info (kan via group veld of groupName)
            const group = fieldData ? (fieldData.group || fieldData.groupName || '') : '';
            const isQETag = group === 'QE Tags';
            const isNFC = fieldName.startsWith('NFC ');

            // Herken het veld als tag: via groepsnaam, via NFC prefix, of via nummerplaat-patroon (bv. "1-ABC-123", "2-ABA-191")
            const isNummerplaat = /^\d+-[A-Z]{2,4}-\d+$/.test(fieldName);

            if (!isQETag && !isNFC && !isNummerplaat) continue;

            const tagId = fieldData ? String(fieldData.stringValue ?? fieldData.value ?? '').trim() : '';
            if (fieldName === 'NFC Bureau Tag') {
                result.bureau = { fieldName, tagId: tagId || null };
            } else if (fieldName === 'NFC Bureau Tag Laden & Lossen') {
                result.ladenLossen = { fieldName, tagId: tagId || null };
            } else if (isNFC && fieldName.endsWith(' Tag')) {
                const name = fieldName.replace(/^NFC\s+/, '').replace(/\s+Tag$/, '');
                result.camionetten.push({ name, fieldName, tagId: tagId || null });
            } else {
                // Alles anders (nummerplaten, QE Tags groep items)
                result.camionetten.push({ name: fieldName, fieldName, tagId: tagId || null });
            }
        }
        return result;
    },

    /**
     * Sla een NFC tag ID op in Robaws (extra veld op werknemer 1).
     * @param {string} fieldName - bijv. "NFC Bureau Tag" of "NFC 2-ABA-191 Tag"
     * @param {string} tagId - de NFC tag ID
     */
    async saveNfcTagId(fieldName, tagId) {
        const empRes = await this.get('employees/1');
        if (empRes.code !== 200 || !empRes.data) throw new Error('Kon werknemer niet ophalen');
        const empData = empRes.data;
        empData.extraFields = empData.extraFields || {};
        empData.extraFields[fieldName] = {
            type: 'TEXT',
            group: 'QE Tags',
            stringValue: String(tagId),
        };
        const putRes = await this.put('employees/1', empData);
        if (putRes.code !== 200 && putRes.code !== 204) {
            throw new Error('Tag opslaan mislukt: ' + putRes.code);
        }
        return true;
    },

    /**
     * Haal tijdsregistraties op voor de afgelopen X dagen voor een werknemer.
     * @param {string|number} employeeId
     * @param {number} days - aantal dagen terug
     */
    async getTimeRegistrationHistory(employeeId, days = 30) {
        // BUG-fix: zelfde issue als getTimeRegistrations — sort=id:desc + early
        // stop op datum, en deduplicatie op id. Robaws bleek soms dezelfde
        // items op meerdere pagina's terug te geven (totalPages incorrect),
        // wat in "Mijn registraties" tot dubbele entries leidde.
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString();

        let allItems = [];
        const seenIds = new Set();
        let page = 0;
        const maxPages = 20; // v57: opgekrikt van 10 -> 20 voor actieve users
        while (page < maxPages) {
            const res = await this.get(`time-registrations?employeeId=${employeeId}&limit=100&offset=${page * 100}&sort=id:desc`);
            if (res.code !== 200) {
                throw new Error(`Robaws time-registrations history fetch faalde (code ${res.code})`);
            }
            if (!res.data || !res.data.items || res.data.items.length === 0) break;
            // Deduplicatie op id (Robaws geeft soms overlappende pagina's)
            for (const it of res.data.items) {
                if (it.id != null && !seenIds.has(String(it.id))) {
                    seenIds.add(String(it.id));
                    allItems.push(it);
                }
            }
            // Vroeg stoppen wanneer oudste item op deze pagina al voor cutoff is
            const oldestOnPage = res.data.items[res.data.items.length - 1];
            if (oldestOnPage.startDate && oldestOnPage.startDate < cutoffStr) break;
            page++;
            if (res.data.totalPages && page >= res.data.totalPages) break;
        }

        // v57: filter versoepeld - server query is al ?employeeId=X, dus
        // items zonder expliciete empId-veld vertrouwen we (Robaws levert het
        // veld soms niet terug, vroeger dropten we die zichtbaarheid weg).
        // Items MET een ander empId blijven uitgesloten.
        const beforeFilter = allItems.length;
        const filtered = allItems
            .filter(item => {
                if (!(item.startDate >= cutoffStr)) return false;
                const itemEmpId = item.employeeId || (item.employee && item.employee.id);
                // Als empId expliciet anders is, droppen (cross-employee bescherming)
                if (itemEmpId && String(itemEmpId) !== String(employeeId)) {
                    console.warn('[RobawsAPI] history: item id=' + item.id +
                        ' had empId=' + itemEmpId + ' (verwacht ' + employeeId + ') - skip');
                    return false;
                }
                // empId leeg/niet meegegeven: server-side ?employeeId=X filter vertrouwen
                return true;
            })
            .sort((a, b) => b.startDate.localeCompare(a.startDate));
        console.log('[RobawsAPI] history fetch: ' + beforeFilter + ' fetched, ' +
            filtered.length + ' na filter (cutoff=' + cutoffStr + ', empId=' + employeeId + ')');
        return filtered;
    },

    /**
     * Maak een taak aan bij een tijdsregistratie (aanpassing aanvragen).
     * @param {string} timeRegId - ID van de tijdsregistratie
     * @param {Object} data - { title, description, assignedUserId }
     */
    /**
     * v64: Maak een taak aan gerelateerd aan een werkbon (Tijdsregistratie).
     * Gebruikt voor "aanpassing aanvragen" — wordt toegewezen aan Vince (userId 5).
     */
    async createTaskForWorkOrder(workOrderId, data) {
        const user = this.getLoggedInUser();
        const body = {
            title: data.title || 'Aanpassing aangevraagd',
            description: data.description || '',
            relatedResource: `/work-orders/${workOrderId}`,
            status: 'Te doen',
            reportingUserId: user ? String(user.robawsUserId) : null,
        };
        if (data.assignedUserId) {
            body.assignedUserId = String(data.assignedUserId);
        }
        console.log('[RobawsAPI] Taak aanmaken bij werkbon:', workOrderId, JSON.stringify(body));
        const res = await this.post('tasks', body);
        if (res.code !== 201 && res.code !== 200) {
            throw new Error('Taak aanmaken mislukt: ' + res.code + ' ' +
                JSON.stringify(res.data).slice(0, 200));
        }
        return res;
    },

        async createTaskForTimeRegistration(timeRegId, data) {
        const user = this.getLoggedInUser();
        const body = {
            title: data.title || 'Aanpassing aangevraagd',
            description: data.description || '',
            relatedResource: `/time-registrations/${timeRegId}`,
            status: 'Te doen',
            reportingUserId: user ? String(user.robawsUserId) : null,
        };
        // Wijs toe aan een kantoor-gebruiker (bijv. Levi userId=8, of een vaste admin)
        if (data.assignedUserId) {
            body.assignedUserId = String(data.assignedUserId);
        }
        console.log('[RobawsAPI] Taak aanmaken bij registratie:', timeRegId, JSON.stringify(body));
        const res = await this.post('tasks', body);
        if (res.code !== 201 && res.code !== 200) {
            throw new Error('Taak aanmaken mislukt: ' + res.code);
        }
        return res;
    },

    // =============================================
    // PLANNING
    // =============================================
    async getPlanning(employeeId, date, userId = null) {
        // v138: GEEN whitelist meer — elke datum wordt geaccepteerd en strikt
        // gefilterd. Voorheen werd elke datum buiten {gisteren, vandaag, morgen}
        // gereset naar today wat ervoor zorgde dat morgen-chip soms vandaag-
        // items toonde (race condition bij middernacht-overgang).
        // Cutoff is de eerste van vandaag-1d zodat we minimaal gisteren laden
        // maar ook verder terug indien `date` ouder is.
        const today    = this._localDateStr();
        const yesterday = this._localDateStr(null, -1);
        const cutoff   = (date && date < yesterday) ? date : yesterday;
        console.log('[getPlanning] gevraagd voor date=' + date + ' (today=' + today + ', cutoff=' + cutoff + ')');

        // Haal planning items op met paginatie
        // v200: Robaws NEGEERT ?page= op /planning-items (zelfde quirk als bij
        // /articles). Elke "pagina" gaf dezelfde eerste 100 items terug die zonder
        // dedup werden samengevoegd -> elke werkorder werd ×(aantal pagina's)
        // getoond (de dubbele kaarten in de planning). Fix: ?offset= + dedup op id.
        let allItems = [];
        const seenPlanIds = new Set();
        let offset = 0;
        const PAGE = 100;

        for (let p = 0; p < 30; p++) {
            const result = await this.get(
                `planning-items?employeeId=${employeeId}&limit=${PAGE}&offset=${offset}&sort=startDate:desc`
            );
            if (result.code !== 200) throw new Error('Kon planning niet ophalen');

            const items = result.data.items || [];
            if (items.length === 0) break;

            let added = 0;
            for (const it of items) {
                const key = String(it.id);
                if (seenPlanIds.has(key)) continue;
                seenPlanIds.add(key);
                allItems.push(it);
                added++;
            }

            // Stop als we voorbij de cutoff (= oudste relevante datum) zijn
            const lastDate = (items[items.length - 1].startDate || '').split('T')[0];
            if (lastDate < cutoff) break;
            if (added === 0) break;          // niets nieuws meer -> stop (veiligheid)
            if (items.length < PAGE) break;  // laatste pagina bereikt
            offset += PAGE;
        }

        // Strikt filter op datum — exact equal match
        let filtered = allItems.filter(item => {
            const itemDate = (item.startDate || '').split('T')[0];
            return itemDate === date;
        });
        console.log('[getPlanning] ' + filtered.length + ' items na filter op ' + date + ' (uit ' + allItems.length + ' geladen)');

        // Sorteer op startDate (vroegste eerst)
        filtered.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

        // Check welke planning items al een werkbon hebben van DEZE gebruiker
        const planningIdsMetWerkbon = await this._getPlanningIdsWithWorkOrders(userId);

        // Verrijk elk item met klantgegevens + BTW + ordernummer
        // v183: BTW-tarieven 1x als gecachede map (geen vat-tariffs/{id} per klant).
        const vatMap = await this.getVatTariffMap();
        // v183: parallelliseer de enrichment OVER de items (Promise.all) i.p.v. een
        // sequentiele for...of. Binnen een item blijven de calls serieel, dus de
        // gelijktijdige concurrency = aantal items (typisch 3-8) -> veilig qua
        // rate-limit. Promise.all behoudt de volgorde.
        const enriched = await Promise.all(filtered.map(async (item) => {
            const hasWerkbon = planningIdsMetWerkbon.has(String(item.id));

            // Haal het volledige planning-item op voor de complete description (HTML)
            // Het list-endpoint kapt de description af, het detail-endpoint geeft alles.
            let fullDescription = item.description || item.notes || '';
            // v182: regie (timeAndMaterial) staat OP de dagplanning zelf. Primair
            // van het list-item, daarna eventueel overschreven door het detail-item.
            let planRegie = (item.timeAndMaterial === true);
            try {
                const fullItem = await this.get(`planning-items/${item.id}`);
                if (fullItem.code === 200 && fullItem.data) {
                    if (fullItem.data.description) fullDescription = fullItem.data.description;
                    if (typeof fullItem.data.timeAndMaterial === 'boolean') planRegie = fullItem.data.timeAndMaterial;
                    // v188: tweede regie-vinkje "Regie monteurs" (custom veld op de
                    // dagplanning). Voor de werknemer telt regie zodra ÉÉN van beide
                    // vinkjes aan staat. We scannen de extraFields op een sleutel die
                    // zowel "regie" als "monteur" bevat en accepteren booleanValue of
                    // stringValue ("true"/"ja"/"1"/"x") als aangevinkt.
                    const _ef = fullItem.data.extraFields || item.extraFields || {};
                    for (const _k of Object.keys(_ef)) {
                        const _kl = _k.toLowerCase();
                        if (_kl.includes('regie') && _kl.includes('monteur')) {
                            const _f = _ef[_k];
                            let _on = false;
                            if (_f === true) _on = true;
                            else if (_f && typeof _f === 'object' && _f.booleanValue === true) _on = true;
                            else {
                                const _s = String((_f && (_f.stringValue ?? _f.value)) ?? _f ?? '').trim().toLowerCase();
                                _on = (_s === 'true' || _s === 'ja' || _s === '1' || _s === 'yes' || _s === 'x');
                            }
                            if (_on) planRegie = true;
                        }
                    }
                }
            } catch(e) { /* Fallback naar list-description */ }

            const entry = {
                id: item.id,
                salesOrderId: item.salesOrderId || null,
                clientId: item.clientId || null,
                endClientId: item.endClientId || null,
                startDate: item.startDate || '',
                endDate: item.endDate || '',
                summary: item.summary || '',
                description: fullDescription,
                address: item.address ? this.formatAddress(item.address) : '',
                employeeIds: item.employeeIds || [],
                installationIds: item.installationIds || [],
                planningTypeId: item.planningTypeId || null,
                hourTypeId: item.hourTypeId || null,
                hasWerkbon: hasWerkbon,
                timeAndMaterial: planRegie,   // v182: regie komt ENKEL van de dagplanning
                client: null,
                endClient: null,  // v102+: ook eindklant ophalen
            };

            // Klant ophalen
            if (item.clientId) {
                try {
                    const clientResult = await this.get(`clients/${item.clientId}`);
                    if (clientResult.code === 200) {
                        const c = clientResult.data;
                        entry.client = {
                            id: c.id,
                            name: c.name || '',
                            email: c.email || '',
                            tel: c.tel || '',
                            address: this.formatAddress(c.address),
                            vatTariffId: c.vatTariffId || null,
                            vatPercentage: null,
                            vatTariffName: null,
                        };

                        // v183: BTW-tarief uit de 1x gecachede map (geen call per klant).
                        const vt = c.vatTariffId ? vatMap[String(c.vatTariffId)] : null;
                        if (vt) {
                            entry.client.vatPercentage = vt.percentage ?? null;
                            entry.client.vatTariffName = vt.name ?? null;
                        }
                    }
                } catch (e) { /* Klant niet gevonden */ }
            }

            // v185: eindklant + line-items + documenten worden NIET meer hier
            // (bij elke lijst-load, per item) opgehaald. Dat is detail-only data en
            // wordt lazy geladen in app._loadWorkorderDetailData() bij het openen van
            // een werkbon (parallel + v184-cache). De IDs (endClientId, id) zitten al
            // in de entry zodat openWorkorder ze kan ophalen.

            // Ordernummer ophalen van sales order. (Regie NIET van de order —
            // v182: die komt ENKEL van de dagplanning, zie planRegie hierboven.)
            if (item.salesOrderId) {
                try {
                    const soResult = await this.get(`sales-orders/${item.salesOrderId}`);
                    if (soResult.code === 200) {
                        entry.orderLogicId = soResult.data.logicId || null;
                        entry.orderStatus = soResult.data.status || null;
                    }
                } catch (e) { /* Order niet gevonden */ }
            }

            return entry;
        }));

        return { items: enriched, date, employeeId };
    },

    async _getPlanningIdsWithWorkOrders(currentUserId = null) {
        // Verzamel planningItemIds waarvoor de HUIDIGE GEBRUIKER al een werkbon heeft.
        // Meerdere techniekers kunnen op hetzelfde planning-item een werkbon indienen —
        // een planning-item verdwijnt alleen voor de technieker wiens werkbon eraan
        // gelinkt is (verantwoordelijke = zichzelf).
        const ids = new Set();
        const seenWoIds = new Set();
        let offset = 0;
        const PAGE = 100;

        try {
            const sinceDate = this._localDateStr(null, -7);
            for (let p = 0; p < 15; p++) {
                // v200: ?offset= i.p.v. ?page= (Robaws negeert page op /work-orders)
                // + dedup op id, anders blijf je op dezelfde eerste 100 werkbons hangen.
                const result = await this.get(`work-orders?limit=${PAGE}&offset=${offset}&sort=createdAt:desc`);
                const items = (result.data && result.data.items) || [];
                if (items.length === 0) break;

                let stop = false, added = 0;
                for (const wo of items) {
                    if (wo.id != null) {
                        if (seenWoIds.has(String(wo.id))) continue;
                        seenWoIds.add(String(wo.id));
                    }
                    added++;
                    // v213: stop op createdAt (waarop gesorteerd wordt) — een
                    // teruggedateerde recente werkbon stopte de lus voorheen
                    // te vroeg → hasWerkbon vals-negatief → planning-item
                    // bleef "open" en kon dubbel ingediend worden.
                    const woCreated = ((wo.createdAt || wo.date || '') + '').split('T')[0];
                    if (woCreated && woCreated < sinceDate) { stop = true; break; }
                    const woDate = wo.date || '';
                    if (woDate && woDate < sinceDate) continue;  // oud: overslaan, niet stoppen
                    if (wo.planningItemId) {
                        // Als we een currentUserId hebben, alleen werkbonnen van deze gebruiker tellen
                        if (currentUserId) {
                            const woUserId = wo.assignedUserId || (wo.assignedUser && wo.assignedUser.id) || null;
                            if (String(woUserId) === String(currentUserId)) {
                                ids.add(String(wo.planningItemId));
                            }
                        } else {
                            // Fallback: alle werkbonnen tellen (oorspronkelijk gedrag)
                            ids.add(String(wo.planningItemId));
                        }
                    }
                }
                if (stop) break;
                if (added === 0) break;
                if (items.length < PAGE) break;
                offset += PAGE;
            }
        } catch (e) { /* Bij fout: geen filtering, niet erg */ }

        return ids;
    },

    // =============================================
    // UURCODES (via employee role → articles)
    // =============================================
    async getHourTypes(employeeId) {
        console.log('[RobawsAPI] getHourTypes gestart voor employee:', employeeId);

        // Stap 1: Employee → employeeRoleId
        const empResult = await this.get(`employees/${employeeId}`);
        console.log('[RobawsAPI] Employee result:', empResult.code);
        if (empResult.code !== 200) throw new Error('Kon employee niet ophalen');

        const employeeRoleId = empResult.data.employeeRoleId;
        console.log('[RobawsAPI] employeeRoleId:', employeeRoleId);
        if (!employeeRoleId) return { items: [], roleName: '?' };

        // Stap 2: Role → timeOperationIds
        const roleResult = await this.get(`employee-roles/${employeeRoleId}`);
        console.log('[RobawsAPI] Role result:', roleResult.code);
        if (roleResult.code !== 200) throw new Error('Kon werknemersrol niet ophalen');

        const roleName = roleResult.data.name || '?';
        const timeOperationIds = roleResult.data.timeOperationIds || [];
        console.log('[RobawsAPI] timeOperationIds:', timeOperationIds.length, 'items');

        // Stap 3: Haal elk artikel PARALLEL op (v183: was sequentieel per artikel).
        // Promise.all behoudt de volgorde; gefaalde/lege resultaten filteren we eruit.
        const artResults = await Promise.all(
            timeOperationIds.map(articleId =>
                this.get(`articles/${articleId}`).catch(e => {
                    console.warn('[RobawsAPI] Artikel', articleId, 'fout:', e && e.message);
                    return null;
                })
            )
        );
        const uurcodes = [];
        for (const artResult of artResults) {
            if (artResult && artResult.code === 200 && artResult.data) {
                const art = artResult.data;
                const name = art.name || `Uurcode ${art.id}`;
                uurcodes.push({
                    id: art.id,
                    name: name,
                    unitPrice: art.unitPrice ?? null,
                    salePrice: art.salePrice ?? null,
                    costPrice: art.costPrice ?? null,
                    isVerplaatsing: name.toLowerCase().includes('verplaatsing'),
                });
            }
        }

        console.log('[RobawsAPI] Uurcodes geladen:', uurcodes.length, 'items');
        return { items: uurcodes, roleName, employeeRoleId };
    },

    // =============================================
    // INSTALLATIES
    // =============================================
    async getInstallations(clientId, installationIds) {
        if (installationIds && installationIds.length > 0) {
            // Specifieke installaties ophalen
            const installations = [];
            for (const id of installationIds) {
                try {
                    const result = await this.get(`installations/${id}`);
                    if (result.code === 200) installations.push(result.data);
                } catch (e) {}
            }
            return installations;
        } else if (clientId) {
            // Alle installaties van klant
            const result = await this.get(`installations?clientId=${clientId}&limit=50`);
            return result.data.items || [];
        }
        return [];
    },

    // =============================================
    // ARTIKELEN ZOEKEN (materialen)
    // =============================================
    async searchArticles(query, limit = 20) {
        const raw = (query || '').trim();
        if (!raw) return [];
        const ql = raw.toLowerCase();
        const words = ql.split(/\s+/).filter(Boolean);

        // Robaws zoekt server-side op naam, maar matcht meerdere woorden slecht.
        // Daarom sturen we het meest onderscheidende (langste) woord naar Robaws
        // en verfijnen we de rest client-side op de teruggekregen kandidaten.
        const primary = words.reduce((a, b) => (b.length > a.length ? b : a), raw);

        const byId = new Map();
        const add = arr => {
            for (const it of (arr || [])) {
                if (it && it.id != null && !byId.has(String(it.id))) byId.set(String(it.id), it);
            }
        };

        // 1) Op naam (ruime limit zodat client-side verfijnen materiaal heeft)
        try {
            const r = await this.get(`articles?name=${encodeURIComponent(primary)}&limit=50`);
            add(r.data && r.data.items);
        } catch (e) {}
        // 2) Ook op artikelnummer (codes)
        try {
            const r2 = await this.get(`articles?articleNumber=${encodeURIComponent(raw)}&limit=20`);
            add(r2.data && r2.data.items);
        } catch (e) {}

        let items = Array.from(byId.values());

        // 3) Bij meerdere woorden: enkel artikels waar ALLE woorden in voorkomen
        if (words.length > 1) {
            const refined = items.filter(it => {
                const hay = ((it.name || '') + ' ' + (it.articleNumber || '')).toLowerCase();
                return words.every(w => hay.includes(w));
            });
            if (refined.length) items = refined;
        }

        // 4) Rangschikken: artikelnr exact > naam begint met > naam bevat
        const score = it => {
            const name = (it.name || '').toLowerCase();
            const nr = (it.articleNumber || '').toLowerCase();
            if (nr && nr === ql) return 1000;
            if (name === ql) return 950;
            if (name.startsWith(ql)) return 850;
            if (nr && nr.startsWith(ql)) return 800;
            if (name.includes(ql)) return 700;
            return 500;
        };
        items.sort((a, b) => score(b) - score(a) || (a.name || '').localeCompare(b.name || ''));

        return items.slice(0, limit);
    },

    // Client-side ranked matcher: artikelnr exact > naam start > bevat > alle woorden.
    _rankArticles(cache, q, limit) {
        const words = q.split(/\s+/).filter(Boolean);
        const scored = [];
        for (let i = 0; i < cache.length; i++) {
            const art = cache[i];
            const name = (art.name || '').toLowerCase();
            const nr = (art.articleNumber || '').toLowerCase();
            let score = 0;
            if (nr && nr === q) score = 1000;
            else if (name === q) score = 950;
            else if (name.startsWith(q)) score = 850;
            else if (nr && nr.startsWith(q)) score = 800;
            else if (name.includes(q)) score = 700;
            else if (nr && nr.includes(q)) score = 600;
            else if (words.length > 0 && words.every(w => name.includes(w) || nr.includes(w))) score = 500;
            if (score > 0) {
                // Lichte voorkeur voor kortere (specifiekere) namen
                score += Math.max(0, 80 - name.length) * 0.05;
                scored.push({ art, score, idx: i });
            }
        }
        scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
        return scored.slice(0, limit).map(s => s.art);
    },

    // Live verkoopprijs uit de artikel-cache op id (0 extra API-calls).
    /** v209: DE prijs-autoriteit. Haalt een artikel LIVE uit Robaws op
     *  (60-min TTL-cache via get() dempt het verkeer). Aanleiding: het
     *  onderhoud-snelmenu factureerde €102 i.p.v. €120 (doorstromer) omdat
     *  de oude live-patch fouten stil wegslikte en terugviel op de
     *  prijslijst-2023. Retourneert:
     *    { ok:true, article:{id,name,salePrice,unitPrice,unit} }
     *    { ok:false, notFound:true, error }   → artikel-id bestaat niet (meer)
     *    { ok:false, network:true,  error }   → geen verbinding/timeout
     *    { ok:false, error }                  → andere fout (HTTP-code)
     *  Callers mogen bij ok:false NOOIT stil een oude prijs gebruiken. */
    async resolveArticle(articleId) {
        if (articleId == null || articleId === '') {
            return { ok: false, error: 'geen artikel-id' };
        }
        try {
            const r = await this.get('articles/' + articleId);
            if (r && r.code === 200 && r.data && r.data.id != null) {
                const a = r.data;
                return {
                    ok: true,
                    article: {
                        id: a.id,
                        name: a.name || ('Artikel ' + a.id),
                        salePrice: (a.salePrice != null) ? a.salePrice : (a.unitPrice != null ? a.unitPrice : null),
                        unitPrice: (a.unitPrice != null) ? a.unitPrice : (a.salePrice != null ? a.salePrice : null),
                        unit: a.unitType || a.unit || 'stuk',
                    },
                };
            }
            if (r && r.code === 404) {
                return { ok: false, notFound: true, error: 'Artikel ' + articleId + ' bestaat niet (meer) in Robaws' };
            }
            return { ok: false, error: 'HTTP ' + (r && r.code) };
        } catch (e) {
            const msg = String((e && e.message) || e || '');
            const network = /failed to fetch|net::err|networkerror|timeout/i.test(msg);
            return { ok: false, network, error: msg };
        }
    },

    getCachedArticlePrice(id) {
        if (!this._articleCache || id == null) return null;
        const a = this._articleCache.find(x => String(x.id) === String(id));
        if (!a) return null;
        const p = (a.salePrice != null) ? a.salePrice : a.unitPrice;
        return (p != null) ? p : null;
    },

    // =============================================
    // WERKBON INDIENEN
    // =============================================
    async submitWerkbon(data) {
        const {
            salesOrderId, planningItemId, clientId, installationIds,
            employeeId, userId, summary, date, clientName,
            materials, hours, notes, uurcode, verplaatsingCode,
            timeAndMaterial, onderhoud,
        } = data;

        const log = [];

        // BELANGRIJK: Robaws v2 API verwacht STRING IDs (niet integers).
        // Integers worden silent genegeerd — vandaar dat klant/datum/dagplanning
        // leeg bleven. Gebruik overal String(...).
        const toStr = v => (v == null || v === '') ? null : String(v);

        // Titel: klantnaam + datum (werfadres komt via siteAddress op de factuur)
        const titleParts = [];
        if (summary && summary.trim()) titleParts.push(summary.trim());
        else if (clientName) titleParts.push(clientName);
        if (date) titleParts.push(date);
        const finalTitle = titleParts.join(' — ') || 'Werkbon via QE App';

        // Stap 1: Lege werkbon aanmaken. POST /work-orders dropt velden stil,
        // maar PUT daarna accepteert alles wél. Voordeel van deze aanpak:
        // - werkt ook als de planning al eens verbruikt is
        // - Robaws kopieert GEEN bestaande time-entries van de planning mee
        //   (dat was de oorzaak van extra uur-regels in de werkbon)
        let woResult = await this.post('work-orders', {});
        log.push('Lege werkbon aangemaakt');

        try { localStorage.setItem('qe_last_wo_create_res', JSON.stringify({ code: woResult.code, data: woResult.data })); } catch(e){}

        if (woResult.code !== 200 && woResult.code !== 201) {
            throw new Error('Kon werkbon niet aanmaken (' + woResult.code + '): ' + JSON.stringify(woResult.data));
        }

        const workOrderId = woResult.data.id;

        // Stap 1b: Haal huidige werkbon op en PUT met overschrijvingen.
        // assignedUserId → ingelogde monteur (ipv kantoor-eigenaar van planning)
        // remark → opmerkingen uit app
        // timeAndMaterial → true (regie-vinkje aan)
        // create-from-planning-item vult enkel salesOrderId automatisch in.
        // Alle andere velden (title/date/clientId/planningItemId/status/...)
        // moeten we zelf expliciet via PUT meegeven.
        let putResult = { code: null };
        try {
            const body = {
                timeAndMaterial: timeAndMaterial ?? false,
                title: finalTitle,
                status: 'nakijken',
            };
            // Verantwoordelijke: userId (opgezocht bij login via /users endpoint).
            // Als userId ontbreekt (login kon hem niet oplossen), probeer alsnog
            // via een live lookup zodat de werkbon NOOIT zonder verantwoordelijke
            // in Robaws belandt.
            let resolvedUserIdForWO = userId;
            if (!resolvedUserIdForWO) {
                try {
                    resolvedUserIdForWO = await this._resolveUserIdForEmployee(employeeId);
                    if (resolvedUserIdForWO) {
                        // Werk de in-memory user bij zodat volgende submits hem hebben
                        const u = this.getLoggedInUser();
                        if (u && !u.robawsUserId) {
                            u.robawsUserId = resolvedUserIdForWO;
                            try { localStorage.setItem('qe_user', JSON.stringify(u)); } catch(e) {}
                            try {
                                if (typeof window !== 'undefined' && window.app && window.app.currentUser) {
                                    window.app.currentUser.robawsUserId = resolvedUserIdForWO;
                                }
                            } catch(e) {}
                        }
                        log.push('userId dynamisch opgehaald: ' + resolvedUserIdForWO);
                    }
                } catch(e) { log.push('userId lookup fout: ' + e.message); }
            }
            if (resolvedUserIdForWO) body.assignedUserId = toStr(resolvedUserIdForWO);
            else log.push('WAARSCHUWING: werkbon zonder assignedUserId (userId niet vindbaar)');
            if (notes) body.remark = notes;
            if (date) body.date = date;
            if (clientId) body.clientId = toStr(clientId);
            if (planningItemId) body.planningItemId = toStr(planningItemId);
            if (salesOrderId) body.salesOrderId = toStr(salesOrderId);
            if (installationIds && installationIds.length) {
                body.installationIds = installationIds.map(toStr);
            }

            // Adres ophalen van planning-item of client en meegeven in PUT.
            // Robaws vult dit niet automatisch — moet expliciet.
            try {
                let addr = null;
                if (planningItemId) {
                    const p = await this.get(`planning-items/${planningItemId}`);
                    if (p.code === 200 && p.data && p.data.address) addr = p.data.address;
                }
                if (!addr && clientId) {
                    const c = await this.get(`clients/${clientId}`);
                    if (c.code === 200 && c.data && c.data.address) addr = c.data.address;
                }
                if (addr && (addr.addressLine1 || addr.city || addr.postalCode)) {
                    body.address = {
                        addressLine1: addr.addressLine1 || null,
                        addressLine2: addr.addressLine2 || null,
                        postalCode: addr.postalCode || null,
                        city: addr.city || null,
                        country: addr.country || null,
                        latitude: addr.latitude || 0,
                        longitude: addr.longitude || 0,
                    };
                }
            } catch(e) {
                log.push('Adres ophalen fout: ' + e.message);
            }

            try { localStorage.setItem('qe_last_wo_put_req', JSON.stringify(body)); } catch(e){}
            putResult = await this.put(`work-orders/${workOrderId}`, body);
            try { localStorage.setItem('qe_last_wo_put_res', JSON.stringify({ code: putResult.code, data: putResult.data })); } catch(e){}
            if (putResult.code !== 200 && putResult.code !== 201 && putResult.code !== 204) {
                log.push(`PUT werkbon fout: ${putResult.code}: ${JSON.stringify(putResult.data).slice(0,200)}`);
            } else {
                log.push(`Werkbon bijgewerkt (title, date, client, planning, order, user, T&M)`);
            }
        } catch(e) {
            log.push('PUT werkbon exception: ' + e.message);
        }

        // v211: een werkbon zónder velden (PUT mislukt) is een onbruikbaar
        // spook-record — geen titel/klant/datum/verantwoordelijke, onvindbaar
        // in elke filter, en de uren zouden eraan blijven hangen. Voorheen
        // ging de flow gewoon door en kreeg de gebruiker "verstuurd ✓".
        // Nu: lege werkbon direct opruimen en een ECHTE fout teruggeven,
        // zodat de app veilig opnieuw kan proberen.
        const putOk = !!(putResult && (putResult.code === 200 || putResult.code === 201 || putResult.code === 204));
        if (!putOk) {
            try {
                const delRes = await this.del(`work-orders/${workOrderId}`);
                log.push('Rollback lege werkbon: DELETE → ' + (delRes && delRes.code));
            } catch (e) {
                log.push('Rollback mislukt: ' + (e && e.message));
            }
            try { localStorage.setItem('qe_last_wo_verify', JSON.stringify({ putFailed: true, log })); } catch(e){}
            return {
                success: false,
                error: 'Werkbon-velden konden niet weggeschreven worden (code ' + (putResult && putResult.code) + ') — er is niets verstuurd, probeer opnieuw',
                workOrderId: null,
                log,
            };
        }

        // Stap 2: POST elke time-entry naar /work-orders/{id}/time-entries
        // v212: als de app de uren al op totaalniveau heeft afgerond
        // (hoursPrerounded via _roundHoursForSubmit), dan ronden we billable
        // hier NIET nog eens per entry op. Voorheen stapelde dat: 25+35 min
        // (totaal al afgerond op 60) werd per entry 0,5u + 1,0u = 1,5u
        // billable voor 1,0u werk.
        const prerounded = !!data.hoursPrerounded;
        let timeSuccess = 0;
        const timeErrors = [];
        const timeRequests = [];
        for (const h of hours || []) {
            if ((h.duration || 0) <= 0) continue;
            const isVerplaatsing = (h.type || 'klant') === 'verplaatsing';
            const code = isVerplaatsing ? verplaatsingCode : uurcode;
            const hrs = Math.round((h.duration || 0) / 60 * 100) / 100;
            const isKlant = (h.type || 'klant') === 'klant';
            // Gebruik employeeId per uur-entry als die is ingevuld (multi-werknemer)
            const entryEmployeeId = h.employeeId ? toStr(h.employeeId) : toStr(employeeId);
            const te = {
                employeeId: entryEmployeeId,
                hours: hrs,
                // v212: klant-uren met prerounded vlag = exact overnemen
                billableHours: (onderhoud && isKlant) ? 0
                    : ((prerounded && isKlant) ? hrs : this._roundUpHalfHour(hrs)),
            };
            if (code && code.id) te.articleId = toStr(code.id);
            // v108: Robaws v2 wil 'breakMinutes' (was 'breakDuration' — die werd
            // stilletjes genegeerd waardoor pauze altijd 0 toonde op werkbonnen
            // die via "dagplanning bevestigen" werden aangemaakt).
            if (h.pauze && h.pauze > 0) {
                te.breakMinutes = parseInt(h.pauze, 10);
            }
            // Bij onderhoud: werkuren met verkoopprijs 0 en kostprijs 57.50
            if (onderhoud && isKlant) {
                te.unitPrice = 0;
                te.costPrice = 57.50;
            }
            if (h.startTime && h.endTime && h.startTime !== '--:--') {
                const [sh, sm] = h.startTime.split(':').map(Number);
                const [eh, em] = h.endTime.split(':').map(Number);
                te.startTime = { hour: sh, minute: sm || 0 };
                te.endTime = { hour: eh, minute: em || 0 };
            }
            timeRequests.push(te);
            const r = await this.post(`work-orders/${workOrderId}/time-entries`, te);
            if (r.code === 200 || r.code === 201) {
                timeSuccess++;
                log.push(`Uur toegevoegd: ${hrs}u ${isVerplaatsing ? '(verplaatsing)' : ''}`);
            } else {
                timeErrors.push({ sent: te, code: r.code, response: r.data });
                log.push(`FOUT uur: ${r.code}`);
            }
        }

        // Stap 3: POST elke material-item naar /work-orders/{id}/line-items
        // (het "Items" tabblad in de werkbon). material-entries is een
        // interne stock-record en gooide 500. line-items is wat Wappy gebruikt.
        let materialSuccess = 0;
        const materialErrors = [];
        const materialRequests = [];
        for (const m of materials || []) {
            const li = {
                type: 'LINE',
                articleId: toStr(m.articleId),
                quantity: parseFloat(m.quantity || 1),
                description: m.name || '',
            };
            if (m.unitPrice != null) li.price = parseFloat(m.unitPrice);
            materialRequests.push(li);
            const r = await this.post(`work-orders/${workOrderId}/line-items`, li);
            if (r.code === 200 || r.code === 201) {
                materialSuccess++;
                log.push(`Item toegevoegd: ${li.articleId} x ${li.quantity}`);
            } else {
                materialErrors.push({ sent: li, code: r.code, response: r.data });
                log.push(`FOUT item: ${r.code}`);
            }
        }

        const commuteSuccess = 0;
        const commuteErrors = [];

        // Stap 4: Verificatie — haal werkbon + sub-entries opnieuw op
        let verifyFields = null;
        let verifyCounts = null;
        try {
            const v = await this.get(`work-orders/${workOrderId}`);
            if (v.code === 200 && v.data) {
                verifyFields = {
                    title: v.data.title ?? v.data.name ?? null,
                    date: v.data.date ?? v.data.startDate ?? null,
                    clientId: v.data.clientId ?? null,
                    endClientId: v.data.endClientId ?? null,
                    salesOrderId: v.data.salesOrderId ?? null,
                    planningItemId: v.data.planningItemId ?? null,
                    assignedUserId: v.data.assignedUserId ?? null,
                    status: v.data.status ?? null,
                    allKeys: Object.keys(v.data),
                };
            }
            const tr = await this.get(`work-orders/${workOrderId}/time-entries`);
            const lr = await this.get(`work-orders/${workOrderId}/line-items`);
            verifyCounts = {
                timeEntriesInRobaws: ((tr.data && (tr.data.items || tr.data)) || []).length,
                lineItemsInRobaws: ((lr.data && (lr.data.items || lr.data)) || []).length,
                sentTime: timeRequests.length,
                sentMaterial: materialRequests.length,
            };
        } catch(e){
            log.push('Verify fout: ' + e.message);
        }

        try { localStorage.setItem('qe_last_wo_verify', JSON.stringify({ verifyFields, verifyCounts, timeErrors, materialErrors })); } catch(e){}

        return {
            success: true,
            workOrderId,
            materialErrors,
            timeErrors,
            commuteErrors,
            timeSuccess,
            commuteSuccess,
            materialSuccess,
            log,
            verifyFields,
            verifyCounts,
            createCode: woResult.code,
            putCode: putResult.code,
        };
    },

    // =============================================
    // CORRECTIE WERKBON — delta tov originele werkbon(s)
    // currentState = wat de monteur nu wil dat het totaal is
    // origineelCumulatief = wat al in Robaws staat (som van alle werkbons op de planning)
    // We sturen enkel het verschil in een nieuwe werkbon "Correctie - [origineel]"
    // =============================================
    async submitWerkbonCorrectie(data) {
        const {
            planningItemId, clientId, salesOrderId, installationIds,
            employeeId, userId, date, clientName,
            origineelTitle, origineelLogicId,
            currentHours, currentMaterials, currentRemark,
            origineelCumulatief,
            uurcode, verplaatsingCode,
        } = data;
        const log = [];
        const toStr = v => (v == null || v === '') ? null : String(v);

        // 1) Bereken delta uren per articleId
        // currentHours = [{type:'klant'|'verplaatsing', duration: minuten, startTime, endTime}, ...]
        const newHoursPerArticle = {};
        for (const h of currentHours || []) {
            if (!h.duration || h.duration <= 0) continue;
            const isVerpl = (h.type || 'klant') === 'verplaatsing';
            const code = isVerpl ? verplaatsingCode : uurcode;
            const aId = code && code.id ? String(code.id) : '';
            if (!newHoursPerArticle[aId]) newHoursPerArticle[aId] = 0;
            newHoursPerArticle[aId] += (h.duration / 60);
        }
        // Round to 2 decimals
        for (const k of Object.keys(newHoursPerArticle)) {
            newHoursPerArticle[k] = Math.round(newHoursPerArticle[k] * 100) / 100;
        }
        const oldHoursPerArticle = (origineelCumulatief && origineelCumulatief.hoursPerArticle) || {};
        const allArticleIds = new Set([
            ...Object.keys(newHoursPerArticle),
            ...Object.keys(oldHoursPerArticle),
        ]);
        const deltaHours = []; // [{articleId, deltaHours, billableDelta}]
        for (const aId of allArticleIds) {
            const oldH = parseFloat(oldHoursPerArticle[aId] || 0);
            const newH = parseFloat(newHoursPerArticle[aId] || 0);
            const diff = Math.round((newH - oldH) * 100) / 100;
            // v213: billable-delta = verschil van de AFGERONDE totalen.
            // Voorheen werd de delta zélf opgerond: -0,25u werd billable -0,0
            // (ceil richting nul) → een correctie omlaag verlaagde de
            // factureerbare uren nooit; en kleine plus-delta's bliezen op.
            const billableDelta = Math.round(
                (this._roundUpHalfHour(newH) - this._roundUpHalfHour(oldH)) * 100
            ) / 100;
            if (diff !== 0 || billableDelta !== 0) {
                deltaHours.push({ articleId: aId, deltaHours: diff, billableDelta });
            }
        }

        // 2) Bereken delta materialen per (articleId|description)
        const oldMats = {};
        for (const m of (origineelCumulatief && origineelCumulatief.materials) || []) {
            const key = (m.articleId || '') + '|' + (m.description || '');
            oldMats[key] = m;
        }
        const newMats = {};
        for (const m of currentMaterials || []) {
            const key = (m.articleId || '') + '|' + (m.name || m.description || '');
            if (!newMats[key]) {
                newMats[key] = {
                    articleId: m.articleId || null,
                    description: m.name || m.description || '',
                    quantity: 0,
                    unitPrice: parseFloat(m.unitPrice != null ? m.unitPrice : (m.price || 0)),
                };
            }
            newMats[key].quantity += parseFloat(m.quantity || 0);
        }
        const allMatKeys = new Set([...Object.keys(oldMats), ...Object.keys(newMats)]);
        const deltaMats = [];
        for (const key of allMatKeys) {
            const oldQ = parseFloat((oldMats[key] && oldMats[key].quantity) || 0);
            const newQ = parseFloat((newMats[key] && newMats[key].quantity) || 0);
            const diff = Math.round((newQ - oldQ) * 100) / 100;
            if (diff !== 0) {
                const ref = newMats[key] || oldMats[key];
                deltaMats.push({
                    articleId: ref.articleId,
                    description: ref.description,
                    quantity: diff,
                    unitPrice: parseFloat(ref.unitPrice || 0),
                });
            }
        }

        // 3) Niets te corrigeren?
        const remarkChanged = (currentRemark || '').trim() !== (origineelCumulatief.remark || '').trim();
        if (deltaHours.length === 0 && deltaMats.length === 0 && !remarkChanged) {
            return { success: true, nothingToDo: true, log: ['Geen verschillen — niets te corrigeren'] };
        }

        // 4) Maak de correctie-werkbon aan (zelfde flow als gewone werkbon: bare POST + PUT)
        const finalTitle = 'Correctie - ' + (origineelTitle || clientName || 'Werkbon');
        let woResult = await this.post('work-orders', {});
        log.push('Lege correctie-werkbon aangemaakt');
        if (woResult.code !== 200 && woResult.code !== 201) {
            throw new Error('Kon correctie-werkbon niet aanmaken (' + woResult.code + ')');
        }
        const workOrderId = woResult.data.id;

        // 5) PUT met alle velden
        // Regie-vinkje ophalen van de sales order (als die er is)
        let regie = false;
        if (salesOrderId) {
            try {
                const soRes = await this.get(`sales-orders/${salesOrderId}`);
                if (soRes.code === 200 && soRes.data) regie = soRes.data.timeAndMaterial ?? false;
            } catch(e) {}
        }
        const putBody = {
            timeAndMaterial: regie,
            title: finalTitle,
            status: 'nakijken',
        };
        // Verantwoordelijke: userId. Live fallback als hij ontbreekt.
        let resolvedUserIdForCorr = userId;
        if (!resolvedUserIdForCorr) {
            try {
                resolvedUserIdForCorr = await this._resolveUserIdForEmployee(employeeId);
                if (resolvedUserIdForCorr) {
                    const u = this.getLoggedInUser();
                    if (u && !u.robawsUserId) {
                        u.robawsUserId = resolvedUserIdForCorr;
                        try { localStorage.setItem('qe_user', JSON.stringify(u)); } catch(e) {}
                        try {
                            if (typeof window !== 'undefined' && window.app && window.app.currentUser) {
                                window.app.currentUser.robawsUserId = resolvedUserIdForCorr;
                            }
                        } catch(e) {}
                    }
                    log.push('userId dynamisch opgehaald: ' + resolvedUserIdForCorr);
                }
            } catch(e) { log.push('userId lookup fout: ' + e.message); }
        }
        if (resolvedUserIdForCorr) putBody.assignedUserId = toStr(resolvedUserIdForCorr);
        else log.push('WAARSCHUWING: correctie-werkbon zonder assignedUserId');
        if (date) putBody.date = date;
        if (clientId) putBody.clientId = toStr(clientId);
        if (planningItemId) putBody.planningItemId = toStr(planningItemId);
        if (salesOrderId) putBody.salesOrderId = toStr(salesOrderId);
        if (installationIds && installationIds.length) {
            putBody.installationIds = installationIds.map(toStr);
        }
        // Adres ophalen (zelfde aanpak als gewone werkbon)
        try {
            let addr = null;
            if (planningItemId) {
                const p = await this.get(`planning-items/${planningItemId}`);
                if (p.code === 200 && p.data && p.data.address) addr = p.data.address;
            }
            if (!addr && clientId) {
                const c = await this.get(`clients/${clientId}`);
                if (c.code === 200 && c.data && c.data.address) addr = c.data.address;
            }
            if (addr && (addr.addressLine1 || addr.city || addr.postalCode)) {
                putBody.address = {
                    addressLine1: addr.addressLine1 || null,
                    addressLine2: addr.addressLine2 || null,
                    postalCode: addr.postalCode || null,
                    city: addr.city || null,
                    country: addr.country || null,
                    latitude: addr.latitude || 0,
                    longitude: addr.longitude || 0,
                };
            }
        } catch(e) { /* negeer adres-fout */ }
        // Opmerking: als veranderd → nieuwe volledige tekst (gemarkeerd als correctie)
        if (remarkChanged) {
            putBody.remark = '[Correctie] ' + (currentRemark || '');
        } else {
            putBody.remark = '[Correctie]';
        }
        const putResult = await this.put(`work-orders/${workOrderId}`, putBody);
        if (putResult.code !== 200 && putResult.code !== 201 && putResult.code !== 204) {
            // v213: voorheen ging de flow gewoon door en kwamen de delta-
            // entries op een ANONIEME werkbon terecht (geen titel/klant/datum):
            // niet herkenbaar als correctie en buiten het cumulatief, waardoor
            // een volgende correctie de delta verdubbelde. Nu: opruimen + fout.
            log.push('PUT correctie fout: ' + putResult.code + ' — rollback');
            try {
                const delRes = await this.del(`work-orders/${workOrderId}`);
                log.push('Rollback correctie-werkbon: DELETE → ' + (delRes && delRes.code));
            } catch (e) {
                log.push('Rollback mislukt: ' + (e && e.message));
            }
            return {
                success: false,
                error: 'Correctie-werkbon kon niet weggeschreven worden (code ' + putResult.code + ') — er is niets gecorrigeerd, probeer opnieuw',
                log,
            };
        }

        // 6) Delta uren posten
        let timeSuccess = 0;
        const timeErrors = [];
        for (const dh of deltaHours) {
            const te = {
                employeeId: toStr(employeeId),
                hours: dh.deltaHours,
                // v213: verschil-van-totalen (zie hierboven), niet de delta opronden
                billableHours: dh.billableDelta,
            };
            if (dh.articleId) te.articleId = toStr(dh.articleId);
            const r = await this.post(`work-orders/${workOrderId}/time-entries`, te);
            if (r.code === 200 || r.code === 201) timeSuccess++;
            else timeErrors.push({ sent: te, code: r.code, response: r.data });
        }

        // 7) Delta materialen posten
        let materialSuccess = 0;
        const materialErrors = [];
        for (const dm of deltaMats) {
            const li = {
                type: 'LINE',
                quantity: dm.quantity,
                description: dm.description || '',
            };
            if (dm.articleId) li.articleId = toStr(dm.articleId);
            if (dm.unitPrice != null) li.price = dm.unitPrice;
            const r = await this.post(`work-orders/${workOrderId}/line-items`, li);
            if (r.code === 200 || r.code === 201) materialSuccess++;
            else materialErrors.push({ sent: li, code: r.code, response: r.data });
        }

        return {
            success: true,
            workOrderId,
            createCode: woResult.code,
            putCode: putResult.code,
            deltaHours,
            deltaMats,
            timeSuccess,
            timeErrors,
            materialSuccess,
            materialErrors,
            log,
        };
    },

    // =============================================
    // FOTO'S UPLOADEN
    // =============================================
    async uploadPhotos(workOrderId, photos) {
        const results = [];
        let success = 0;
        let failed = 0;

        // Haal installationIds op van de werkorder zodat we de foto's ook zichtbaar
        // kunnen maken bij de gekoppelde installatie(s).
        let installationIds = [];
        try {
            const wo = await this.get(`work-orders/${workOrderId}`);
            if (wo.code === 200 && wo.data && Array.isArray(wo.data.installationIds)) {
                installationIds = wo.data.installationIds.filter(Boolean);
            }
        } catch(e) { /* niet fataal */ }

        for (let i = 0; i < photos.length; i++) {
            const photo = photos[i];
            const fileName = photo.name || `foto_${i + 1}.jpg`;

            try {
                // Base64 naar Blob
                let base64 = photo.data;
                if (base64.includes(',')) base64 = base64.split(',')[1];
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let j = 0; j < binary.length; j++) {
                    bytes[j] = binary.charCodeAt(j);
                }

                const contentType = fileName.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
                const blob = new Blob([bytes], { type: contentType });
                const file = new File([blob], fileName, { type: contentType });

                // 1) Upload naar de werkorder
                const result = await this.uploadFile(
                    `work-orders/${workOrderId}/documents`,
                    file,
                    fileName
                );

                const installationUploads = [];
                if (result.code === 200 || result.code === 201) {
                    // 2) Ook uploaden naar elke gekoppelde installatie zodat
                    //    ze zichtbaar zijn op het tabblad Documenten van de installatie.
                    for (const instId of installationIds) {
                        try {
                            // Nieuwe File maken want de stream van de vorige is verbruikt
                            const fileForInst = new File([blob], fileName, { type: contentType });
                            const instRes = await this.uploadFile(
                                `installations/${instId}/documents`,
                                fileForInst,
                                fileName
                            );
                            installationUploads.push({
                                installationId: instId,
                                code: instRes.code,
                                documentId: instRes.data ? instRes.data.id : null,
                            });
                        } catch(e) {
                            installationUploads.push({ installationId: instId, error: e.message });
                        }
                    }

                    results.push({
                        name: fileName,
                        success: true,
                        documentId: result.data.id,
                        installationUploads,
                    });
                    success++;
                } else {
                    results.push({ name: fileName, success: false, error: result.data });
                    failed++;
                }
            } catch (e) {
                results.push({ name: fileName, success: false, error: e.message });
                failed++;
            }
        }

        return { uploaded: success, failed, total: photos.length, results, installationIds };
    },

    // =============================================
    // ARTIKELEN CACHE — alles 1x laden, daarna instant filteren
    // =============================================
    async _loadAllArticles(onProgress) {
        if (this._articleCache) return this._articleCache;
        if (this._articleCacheLoading) {
            // Wacht tot andere load klaar is
            while (this._articleCacheLoading) {
                await new Promise(r => setTimeout(r, 200));
            }
            return this._articleCache || [];  // v209: null-safe
        }

        this._articleCacheLoading = true;

        // 0) Meegeleverde snapshot proberen (data/articles.json in de www-update) -> 0 API-calls.
        //    Valt automatisch terug op live ophalen als het bestand er (nog) niet is of leeg is.
        try {
            const snapRes = await fetch('data/articles.json', { cache: 'no-store' });
            if (snapRes.ok) {
                const snap = await snapRes.json();
                const snapItems = Array.isArray(snap) ? snap : (snap.items || snap.articles || []);
                if (Array.isArray(snapItems) && snapItems.length > 0) {
                    // v209: snapshot dedupliceren op id — het meegeleverde
                    // bestand bleek dezelfde artikelen tientallen keren te
                    // bevatten (kapotte export), wat dubbele regels in de
                    // groep-browser gaf.
                    const seenSnap = new Set();
                    const deduped = [];
                    for (const a of snapItems) {
                        const k = String(a && a.id);
                        if (seenSnap.has(k)) continue;
                        seenSnap.add(k);
                        deduped.push(a);
                    }
                    this._articleCache = deduped;
                    this._articleCacheLoading = false;
                    if (onProgress) onProgress(deduped.length, deduped.length);
                    return this._articleCache;
                }
            }
        } catch (e) { /* geen snapshot -> live ophalen */ }

        // Live ophalen — Robaws negeert ?page= op /articles (zelfde quirk als
        // /work-orders, v83b), dus ?offset= gebruiken + dedup op id + stoppen
        // zodra een pagina niets nieuws meer oplevert.
        const LIMIT = 100;
        const allArticles = [];
        const seen = new Set();

        try {
            let totalItems = 0;
            for (let p = 0; p < 1000; p++) {
                const result = await this.get(`articles?limit=${LIMIT}&offset=${p * LIMIT}`);
                if (result.code && result.code !== 200) break;
                const items = (result.data && result.data.items) || [];
                if (items.length === 0) break;
                totalItems = result.data.totalItems || totalItems;
                let added = 0;
                for (const a of items) {
                    const key = String(a && a.id);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    allArticles.push(a);
                    added++;
                }
                if (onProgress) onProgress(allArticles.length, totalItems || allArticles.length);
                if (added === 0) break;          // paginatie-einde of -bug
                if (items.length < LIMIT) break; // laatste pagina
            }

            // v209: een LEGE lijst niet cachen — anders bleef de catalogus na
            // één mislukte eerste pagina de hele sessie leeg zonder retry.
            this._articleCache = allArticles.length > 0 ? allArticles : null;
        } finally {
            this._articleCacheLoading = false;
        }

        return this._articleCache || [];
    },

    // =============================================
    // ARTIKELGROEPEN
    // =============================================
    async getArticleGroups() {
        // Robaws negeert ?page= -> ?offset= gebruiken + dedup + stoppen bij niets-nieuws
        const GLIMIT = 100;
        const allGroups = [];
        const seenG = new Set();
        for (let p = 0; p < 200; p++) {
            const result = await this.get(`article-groups?limit=${GLIMIT}&offset=${p * GLIMIT}`);
            const items = (result.data && (result.data.items || (Array.isArray(result.data) ? result.data : []))) || [];
            if (items.length === 0) break;
            let added = 0;
            for (const g of items) {
                const k = String(g && g.id);
                if (seenG.has(k)) continue;
                seenG.add(k);
                allGroups.push(g);
                added++;
            }
            if (added === 0) break;
            if (items.length < GLIMIT) break;
        }

        // Dedupe op id (Robaws-paginatie kan dezelfde groep meermaals teruggeven -> dubbele tegels)
        const _seen = new Set();
        const uniqueGroups = [];
        for (const g of allGroups) {
            if (g && !_seen.has(g.id)) { _seen.add(g.id); uniqueGroups.push(g); }
        }

        // Filter alleen wappy=true
        const wappyGroups = uniqueGroups.filter(g => g.wappy === true);

        // Boomstructuur
        const rootGroups = [];
        const childMap = {};
        wappyGroups.forEach(g => {
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

        // Tel artikelen per groep (vanuit cache als beschikbaar)
        if (this._articleCache) {
            const counts = {};
            this._articleCache.forEach(a => {
                const gid = String(a.articleGroupId || '');
                counts[gid] = (counts[gid] || 0) + 1;
            });
            wappyGroups.forEach(g => g._articleCount = counts[String(g.id)] || 0);
        }

        return { all: wappyGroups, tree: rootGroups };
    },

    async getArticlesByGroup(groupId) {
        // Gebruik cache — instant filteren
        const allArticles = await this._loadAllArticles();
        return allArticles
            .filter(a => String(a.articleGroupId) === String(groupId))
            .map(art => ({
                id: art.id,
                name: art.name,
                salePrice: art.salePrice,
                costPrice: art.costPrice,
                unitType: art.unitType || 'stuk',
                articleGroupId: art.articleGroupId,
                imageId: art.imageId || null,
            }));
    },

    // Image URL helper
    getImageUrl(imageId) {
        if (!imageId) return null;
        const auth = btoa(this.API_KEY + ':' + this.API_SECRET);
        return `${this.BASE_URL}/images/${imageId}?tenant=${this.TENANT}`;
    },

    // =============================================
    // UITGEVOERDE PLANNINGEN (gisteren + vandaag) — voor correctie-tool
    // Per planning-item: som van alle gelinkte werkbons (uren, materialen, opmerkingen).
    // =============================================
    async getUitgevoerdPlanningen(employeeId, userId) {
        // 1. Planning-items van afgelopen 7 dagen voor deze monteur
        const today = this._localDateStr();
        const sevenDaysAgo = this._localDateStr(null, -7);

        // v200: ?offset= i.p.v. ?page= (Robaws negeert page) + dedup op id, anders
        // werden dezelfde planning-items dubbel geteld in de correctie-tool.
        let allPlanningen = [];
        const seenUitgevoerdIds = new Set();
        let offset = 0;
        const PAGE = 100;
        for (let p = 0; p < 20; p++) {
            const r = await this.get(
                `planning-items?employeeId=${employeeId}&limit=${PAGE}&offset=${offset}&sort=startDate:desc`
            );
            if (r.code !== 200) break;
            const items = r.data.items || [];
            if (items.length === 0) break;
            let added = 0;
            for (const it of items) {
                const key = String(it.id);
                if (seenUitgevoerdIds.has(key)) continue;
                seenUitgevoerdIds.add(key);
                allPlanningen.push(it);
                added++;
            }
            const lastDate = (items[items.length - 1].startDate || '').split('T')[0];
            if (lastDate < sevenDaysAgo) break;
            if (added === 0) break;
            if (items.length < PAGE) break;
            offset += PAGE;
        }

        const planningenInScope = allPlanningen.filter(p => {
            const d = (p.startDate || '').split('T')[0];
            return d >= sevenDaysAgo && d <= today;
        });

        if (planningenInScope.length === 0) return { items: [] };

        // 2. Alle werkbons van afgelopen 7 dagen ophalen → mappen op planningItemId
        const sinceDate = this._localDateStr(null, -7);
        const werkbonsPerPlanning = {};
        // v186: ?include=timeEntries -> time-entries komen INLINE mee (geen
        // per-werkbon time-entries-call meer in stap 4, zie HANDLEIDING 2.16).
        // Ook ?offset= i.p.v. ?page= (Robaws negeert page op /work-orders, v83b)
        // + dedup op id zodat dezelfde werkbon niet dubbel telt.
        const WO_LIMIT = 100;
        const seenWoIds = new Set();
        for (let woPage = 0; woPage < 15; woPage++) {
            const r = await this.get(`work-orders?limit=${WO_LIMIT}&offset=${woPage * WO_LIMIT}&sort=createdAt:desc&include=timeEntries`);
            if (r.code !== 200) break;
            const items = (r.data && r.data.items) || [];
            if (items.length === 0) break;
            let stop = false;
            for (const wo of items) {
                if (wo.id != null) {
                    if (seenWoIds.has(String(wo.id))) continue;
                    seenWoIds.add(String(wo.id));
                }
                // v213: stop-criterium op createdAt — de lijst is op createdAt
                // gesorteerd; stoppen op wo.date brak de lus af bij één
                // teruggedateerde recente werkbon → het cumulatief viel te
                // laag uit en een correctie kon reeds gefactureerde uren
                // OPNIEUW toevoegen (dubbele facturatie).
                const created = ((wo.createdAt || wo.date || '') + '').split('T')[0];
                if (created && created < sinceDate) { stop = true; break; }
                // v213: oude werkbon (op datum) overslaan zonder te stoppen
                const d = wo.date || '';
                if (d && d < sinceDate) continue;
                // v213: alleen werkbonnen van DEZE gebruiker — voorheen telde
                // het cumulatief ook collega's op hetzelfde planning-item mee,
                // waardoor een correctie van tech A de uren van tech B wegboekte.
                if (userId != null && String(userId) !== '') {
                    const woUser = wo.assignedUserId != null ? String(wo.assignedUserId) : null;
                    if (woUser !== String(userId)) continue;
                }
                if (!wo.planningItemId) continue;
                const key = String(wo.planningItemId);
                if (!werkbonsPerPlanning[key]) werkbonsPerPlanning[key] = [];
                werkbonsPerPlanning[key].push(wo);
            }
            if (stop) break;
            if (items.length < WO_LIMIT) break;
            if (r.data.totalPages && (woPage + 1) >= r.data.totalPages) break;
        }

        // 3. Enkel plannings die al ≥1 werkbon hebben overhouden
        const planningenMetWerkbon = planningenInScope.filter(p => werkbonsPerPlanning[String(p.id)]);

        // 4. Voor elke planning: client + sub-entries van alle linked werkbons sommeren
        // v186: verwerk alle plannings PARALLEL (Promise.all) i.p.v. sequentieel.
        const result = await Promise.all(planningenMetWerkbon.map(async (p) => {
            const wos = werkbonsPerPlanning[String(p.id)] || [];
            // Klant + order parallel ophalen (gecached via v184)
            const [cr, sr] = await Promise.all([
                p.clientId ? this.get(`clients/${p.clientId}`).catch(() => null) : Promise.resolve(null),
                p.salesOrderId ? this.get(`sales-orders/${p.salesOrderId}`).catch(() => null) : Promise.resolve(null),
            ]);
            let clientName = '', clientAddress = '';
            if (cr && cr.code === 200 && cr.data) {
                clientName = cr.data.name || '';
                clientAddress = this.formatAddress(cr.data.address);
            }
            const orderLogicId = (sr && sr.code === 200 && sr.data) ? (sr.data.logicId || null) : null;
            // Sub-entries van elke werkbon
            let totalHours = 0;
            let totalCommute = 0;
            const materialMap = {}; // key = articleId|description → { articleId, description, quantity, unitPrice }
            const remarks = [];
            const sourceWerkbonIds = [];
            // We hebben de uurcode-articleIds nodig om uren te splitsen klant vs verplaatsing
            // → niet beschikbaar zonder employee-rol; we slaan beide totals op en laten UI splitsen op articleId
            const hoursPerArticle = {}; // articleId → totalHours
            // v186: time-entries komen INLINE mee via ?include=timeEntries (geen
            // per-werkbon call meer). line-items wel nog per werkbon -> parallel.
            const liResults = await Promise.all(
                wos.map(wo => this.get(`work-orders/${wo.id}/line-items`).catch(() => null))
            );
            wos.forEach((wo, idx) => {
                sourceWerkbonIds.push(wo.id);
                if (wo.remark && wo.remark.trim()) remarks.push(wo.remark.trim());
                // time-entries (inline)
                const teItems = wo.timeEntries || [];
                for (const t of teItems) {
                    const hrs = parseFloat(t.hours || t.billableHours || 0);
                    const aId = String(t.articleId || (t.article && t.article.id) || '');
                    if (!hoursPerArticle[aId]) hoursPerArticle[aId] = 0;
                    hoursPerArticle[aId] += hrs;
                    totalHours += hrs;
                }
                // line-items (materialen)
                const li = liResults[idx];
                const liItems = (li && li.data && (li.data.items || li.data)) || [];
                for (const l of liItems) {
                    const aId = String(l.articleId || '');
                    const desc = l.description || '';
                    const key = aId + '|' + desc;
                    if (!materialMap[key]) {
                        materialMap[key] = {
                            articleId: aId || null,
                            description: desc,
                            quantity: 0,
                            unitPrice: parseFloat(l.price || 0),
                        };
                    }
                    materialMap[key].quantity += parseFloat(l.quantity || 0);
                }
            });

            // Origineel werkbon = de eerste (oudste) — dat is de "echte" werkbon, latere zijn al correcties.
            // BUG-fix: vroegere code sorteerde lexicografisch ('10' < '2'), waardoor
            // willekeurig de verkeerde werkbon als "origineel" werd gekozen. Nu
            // sorteren we numeriek op id (Robaws geeft sequentiële ints).
            const origineel = wos.sort((a, b) => {
                const na = Number(a.id), nb = Number(b.id);
                if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
                // fallback voor non-numerieke ids
                return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
            })[0];

            return {
                planningItemId: p.id,
                clientId: p.clientId,
                clientName,
                clientAddress,
                salesOrderId: p.salesOrderId,
                orderLogicId,
                installationIds: p.installationIds || [],
                date: (p.startDate || '').split('T')[0],
                summary: p.summary || '',
                origineelWerkbonId: origineel ? origineel.id : null,
                origineelLogicId: origineel ? (origineel.logicId || null) : null,
                origineelTitle: origineel ? (origineel.title || '') : '',
                aantalWerkbonnen: wos.length,
                sourceWerkbonIds,
                cumulatief: {
                    totalHours,
                    hoursPerArticle, // articleId → uren (UI splitst klant vs verplaatsing)
                    materials: Object.values(materialMap).filter(m => m.quantity !== 0),
                    remark: remarks.join(' | '),
                },
            };
        }));

        // Sorteer: vandaag eerst, dan op startDate desc
        result.sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            return 0;
        });

        return { items: result };
    },

    // =============================================
    // UITGEVOERDE WERKEN (oude versie — behouden voor compat, niet meer gebruikt)
    // =============================================
    async getUitgevoerd(userId) {
        const workOrders = [];
        let page = 0;
        // Toon werkbonnen van de afgelopen 14 dagen
        const sinceDate = this._localDateStr(null, -14);

        // Stap 1: Werkbonnen ophalen — enkel van deze ingelogde gebruiker
        // (filter op assignedUserId = de Robaws userId van de technieker)
        let done = false;
        do {
            const userFilter = userId ? `&assignedUserId=${encodeURIComponent(userId)}` : '';
            const result = await this.get(`work-orders?limit=50&offset=${page * 50}&sort=date:desc${userFilter}`);
            const items = (result.data && result.data.items) || [];
            if (items.length === 0) break;

            for (const wo of items) {
                const woDate = wo.date || '';
                if (woDate && woDate < sinceDate) { done = true; break; }
                // Alleen echte werkbonnen (werkorders MET lijnen/uren), geen lege planning items
                // De API geeft enkel werk-orders terug; planning-items zitten in /planning-items.
                // Extra zekerheid: skip items zonder id/title.
                if (!wo.id) continue;
                // Dubbele check op assignedUserId (voor het geval het filter niet werd gerespecteerd).
                // BUG-fix: vroeger werden werkbonnen ZONDER assignedUserId niet
                // weggefilterd → gebruiker zag andermans werkbonnen die per
                // ongeluk geen verantwoordelijke hadden. Nu strict: als userId
                // gegeven is, eis een match (en filter dus zonder ook weg).
                if (userId) {
                    if (!wo.assignedUserId) continue;
                    if (String(wo.assignedUserId) !== String(userId)) continue;
                }
                workOrders.push({
                    id: wo.id,
                    logicId: wo.logicId || null,
                    title: wo.title || '',
                    status: wo.status || '',
                    date: wo.date || '',
                    clientId: wo.clientId || null,
                    clientName: null,
                    clientAddress: null,
                    planningItemId: wo.planningItemId || null,
                    assignedUserId: wo.assignedUserId || null,
                    totalExclVat: wo.totalExclVat || null,
                });
            }

            if (done) break;
            const totalPages = (result.data && result.data.totalPages) || 1;
            page++;
            if (page >= totalPages) break;
            // Hard limit om oneindige loops te vermijden
            if (page > 20) break;
        } while (true);

        // Stap 2: Klantgegevens ophalen (unieke clientIds)
        const clientIds = [...new Set(workOrders.map(w => w.clientId).filter(Boolean))];
        const clientCache = {};
        for (const cId of clientIds) {
            try {
                const cResult = await this.get(`clients/${cId}`);
                if (cResult.code === 200) {
                    clientCache[cId] = {
                        name: cResult.data.name || '',
                        address: this.formatAddress(cResult.data.address),
                    };
                }
            } catch (e) { /* skip */ }
        }

        // Stap 3: Klantgegevens invullen
        for (const wo of workOrders) {
            if (wo.clientId && clientCache[wo.clientId]) {
                wo.clientName = clientCache[wo.clientId].name;
                wo.clientAddress = clientCache[wo.clientId].address;
            }
        }

        return { items: workOrders };
    },

    // =============================================
    // FACTUUR AANMAKEN VANUIT WERKORDER
    // =============================================
    async createInvoice({ workOrderId, paymentConditionId = '9', vatTariffId = null,
        clientId: passedClientId = null, companyId: passedCompanyId = null,
        salesOrderId = null, paymentMethod = null, notes = '',
        materials = [], hours = [], onderhoud = false, hoursPrerounded = false,
        userId = null, installationIds = [] }) {

        const toStr = v => (v == null || v === '') ? null : String(v);

        // v210: GEEN stille BTW-default meer (was '4' = 6% — een klant zonder
        // gekend tarief kreeg zo geruisloos 6% op de hele factuur). Zonder
        // expliciet tarief wordt de factuur geweigerd; de app blokkeert dit
        // al vóór de submit, dus dit is het laatste vangnet.
        if (vatTariffId == null || String(vatTariffId) === '') {
            return { success: false, error: 'Geen BTW-tarief meegegeven — factuur niet aangemaakt. Stel het BTW-tarief van de klant in (info-tab → BTW wijzigen).' };
        }

        // v112: Postcode van de werf — bewaard in functie-scope. Wordt gevuld
        // wanneer we het installatie-adres ophalen voor `siteAddress`, en later
        // gebruikt als extra TEXT-lijn op de factuur (zodat de back-office
        // direct kan zien welke postcode bij de werkbon hoort).
        // v177: ook de gemeente bewaren zodat we "2900 Schoten" kunnen plakken
        // i.p.v. enkel "2900".
        let invoicePostalCode = '';
        let invoiceCity       = '';
        // v211: status-updates die falen horen zichtbaar te zijn, maar mogen
        // de betaling NIET blokkeren (het factuurbedrag zelf klopt). Aparte
        // lijst naast errors[] (die wél geld-fouten bevat).
        const statusErrors = [];

        // Stap 1: Werkorder details
        const woResult = await this.get(`work-orders/${workOrderId}`);
        if (woResult.code !== 200) throw new Error('Werkorder niet gevonden');
        const wo = woResult.data;

        const clientId = passedClientId
            || wo.endClientId || wo.clientId
            || (wo.client && wo.client.id)
            || (wo.endClient && wo.endClient.id);
        const companyId = passedCompanyId || wo.companyId || (wo.company && wo.company.id) || '3';
        const woSalesOrderId = toStr(salesOrderId || wo.salesOrderId);

        if (!clientId) {
            throw new Error('Geen klant gekoppeld aan werkorder ' + workOrderId);
        }

        // Stap 2: Factuur aanmaken — NIET boeken (draft)!
        const invResult = await this.post('sales-invoices', {
            type: 'INVOICE',
            clientId: toStr(clientId),
            companyId: toStr(companyId),
            date: this._localDateStr(),
            paymentConditionId: toStr(paymentConditionId),
            booked: false,
        });

        if (invResult.code !== 201 && invResult.code !== 200) {
            throw new Error('Kon factuur niet aanmaken: ' + JSON.stringify(invResult.data));
        }

        const invoice = invResult.data;
        const invoiceId = invoice.id;

        // Stap 2b: Factuur bijwerken — status, verantwoordelijke, werfadres, betaalmethode
        const invGet = await this.get(`sales-invoices/${invoiceId}`);
        if (invGet.code === 200) {
            const invFull = invGet.data;
            invFull.booked = false;

            // Status "Technieker" — zodat kantoor facturen van de app kan nakijken
            invFull.status = 'Technieker';

            // Verantwoordelijke = de ingelogde technieker (niet standaard Rolf).
            // Centrale helper gebruikt dezelfde fallback-strategie als submitWerkbon
            // én persisteert het resultaat in qe_user, zodat we het maar één keer
            // hoeven op te lossen per sessie.
            let resolvedUserId = userId;
            if (!resolvedUserId) {
                try {
                    const currentUser = this.getLoggedInUser();
                    if (currentUser && currentUser.robawsEmployeeId) {
                        resolvedUserId = await this._resolveUserIdForEmployee(
                            currentUser.robawsEmployeeId, currentUser.email
                        );
                        if (resolvedUserId) {
                            currentUser.robawsUserId = resolvedUserId;
                            try { localStorage.setItem('qe_user', JSON.stringify(currentUser)); } catch(e) {}
                            try {
                                if (typeof window !== 'undefined' && window.app && window.app.currentUser) {
                                    window.app.currentUser.robawsUserId = resolvedUserId;
                                }
                            } catch(e) {}
                            console.log('[Factuur] UserId dynamisch opgehaald:', resolvedUserId);
                        } else {
                            console.warn('[Factuur] WAARSCHUWING: geen userId vindbaar — factuur zal zonder verantwoordelijke aangemaakt worden');
                        }
                    }
                } catch(e) { console.warn('[Factuur] UserId lookup mislukt:', e); }
            }
            if (resolvedUserId) invFull.assignedUserId = toStr(resolvedUserId);

            // Werfadres: installatie-adres ophalen → siteAddress (verschijnt in titel factuur)
            // v112: we promote `instAddrPostalCode` to function scope zodat de postcode-textlijn
            // (sectie 3a verderop) hem ook kan gebruiken.
            try {
                let instAddr = null;
                if (installationIds && installationIds.length > 0) {
                    const instResult = await this.get(`installations/${installationIds[0]}`);
                    if (instResult.code === 200 && instResult.data) {
                        const inst = instResult.data;
                        if (inst.address && (inst.address.addressLine1 || inst.address.city)) {
                            instAddr = inst.address;
                        }
                    }
                }
                if (instAddr) {
                    invFull.siteAddress = {
                        addressLine1: instAddr.addressLine1 || null,
                        addressLine2: instAddr.addressLine2 || null,
                        postalCode: instAddr.postalCode || null,
                        city: instAddr.city || null,
                        country: instAddr.country || null,
                    };
                    invoicePostalCode = instAddr.postalCode || '';
                    // v177: ook de gemeente bewaren voor de "2900 Schoten" tekstlijn
                    invoiceCity = instAddr.city || '';
                }
            } catch(e) {
                console.warn('Installatie-adres ophalen voor factuur mislukt:', e);
            }

            if (paymentMethod) {
                invFull.extraFields = invFull.extraFields || {};
                invFull.extraFields['Betaling'] = {
                    type: 'SELECT',
                    group: 'Betaling',
                    stringValue: paymentMethod,
                };
            }
            // v211: deze PUT was ongecontroleerd — faalde hij, dan had de
            // factuur geen 'Technieker'-status en viel hij buiten de
            // nakijklijst van bureel (werd dus nooit verstuurd).
            const statusPut = await this.put(`sales-invoices/${invoiceId}`, invFull);
            if (statusPut.code !== 200 && statusPut.code !== 204) {
                statusErrors.push('factuur-status/verantwoordelijke niet gezet (code ' + statusPut.code + ')');
            }
        }

        // Stap 3: Line items toevoegen
        // Line items worden gelinkt aan de SALES ORDER (orderId), niet aan de werkbon (workOrderId).
        // workOrderId op line-items genereert een "Werkbon Txxxxx..." koptekst op de factuur-PDF.
        // Het werfadres wordt als TEXT-lijn bovenaan de factuur gezet (zoals Wappy dat doet).
        let addedLines = 0;
        const errors = [];

        // 3a: Notities als tekstlijn
        if (notes && notes.trim()) {
            const textLineData = {
                type: 'TEXT',
                description: notes.trim(),
            };
            if (woSalesOrderId) textLineData.orderId = woSalesOrderId;

            const textResult = await this.post(`sales-invoices/${invoiceId}/line-items`, textLineData);
            if (textResult.code === 201 || textResult.code === 200) addedLines++;
        }

        // 3b: v112 — Postcode-tekstlijn (uit dagplanning werfadres) zodat de
        // back-office in één oogopslag weet welke postcode bij deze factuur
        // hoort. Komt rechts ná de notities-lijn.
        // v177: nu ook de gemeentenaam erbij in Belgisch standaardformaat
        // ("2900 Schoten"). Als de gemeente onbekend is, valt het automatisch
        // terug op enkel de postcode zoals voorheen.
        const pcTrim   = String(invoicePostalCode || '').trim();
        const cityTrim = String(invoiceCity || '').trim();
        const postcodeText = (pcTrim && cityTrim) ? (pcTrim + ' ' + cityTrim) : pcTrim;
        if (postcodeText) {
            const postcodeLine = {
                type: 'TEXT',
                description: postcodeText,
            };
            if (woSalesOrderId) postcodeLine.orderId = woSalesOrderId;
            const r = await this.post(`sales-invoices/${invoiceId}/line-items`, postcodeLine);
            if (r.code === 201 || r.code === 200) addedLines++;
            else console.warn('[Invoice] postcode-lijn POST faalde:', r.code, r.data);
        }

        // 3c: Materialen van frontend (betrouwbaarder dan WO material-entries)
        if (materials.length > 0) {
            for (const mat of materials) {
                const articleId = mat.articleId;
                const lineData = {
                    type: 'LINE',
                    quantity: Number(mat.quantity) || 1,
                    description: mat.name || 'Materiaal',
                    price: Number(mat.unitPrice) || 0,
                    vatTariffId: toStr(vatTariffId),
                };
                if (woSalesOrderId) lineData.orderId = woSalesOrderId;
                if (articleId && !isNaN(articleId) && Number(articleId) > 0) {
                    lineData.articleId = toStr(articleId);
                }

                const addResult = await this.post(`sales-invoices/${invoiceId}/line-items`, lineData);
                if (addResult.code === 201 || addResult.code === 200) {
                    addedLines++;
                } else {
                    errors.push({ line: lineData.description, code: addResult.code, error: addResult.data });
                }
            }
        } else {
            // Fallback: lees material-entries van werkorder
            const matResult = await this.get(`work-orders/${workOrderId}/material-entries`);
            const matEntries = (matResult.data && (matResult.data.items || matResult.data)) || [];
            if (Array.isArray(matEntries)) {
                for (const me of matEntries) {
                    const lineData = {
                        type: 'LINE',
                        quantity: Number(me.billableAmount ?? me.amount ?? me.quantity ?? 1),
                        description: me.description || (me.article && me.article.name) || 'Materiaal',
                        price: Number(me.salePrice ?? me.price ?? 0),
                        vatTariffId: toStr(me.vatTariffId || (me.vatTariff && me.vatTariff.id) || vatTariffId),
                    };
                    if (woSalesOrderId) lineData.orderId = woSalesOrderId;
                    const artId = me.articleId || (me.article && me.article.id);
                    if (artId) lineData.articleId = toStr(artId);
                    if (me.unitType || (me.article && me.article.unitType)) {
                        lineData.unitType = me.unitType || me.article.unitType;
                    }

                    const addResult = await this.post(`sales-invoices/${invoiceId}/line-items`, lineData);
                    if (addResult.code === 201 || addResult.code === 200) addedLines++;
                    else errors.push({ line: lineData.description, code: addResult.code, error: addResult.data });
                }
            }
        }

        // 3c: Uren als line items — alleen 'klant' uren factureren!
        // Verplaatsingsuren en pauze worden NIET gefactureerd (verplaatsing zit al in materialen als vast tarief)
        // ALTIJD totaal afronden naar boven op half uur (niet per entry!)
        if (hours.length > 0) {
            // Groepeer per articleId en tel totaal minuten op
            const hoursByArticle = {};
            for (const h of hours) {
                if (h.type && h.type !== 'klant') continue;
                const dur = Number(h.duration || 0);
                const salePrice = Number(h.salePrice || 0);
                if (dur <= 0) continue;
                // v211: uren met prijs €0/null werden hier STIL overgeslagen —
                // volledige arbeid ontbrak dan op de factuur zonder dat iemand
                // het zag (bv. als de uurcode-prijs niet geladen was). Nu gaat
                // dit in errors[] en blokkeert de app de betaling.
                if (salePrice <= 0) {
                    errors.push({ line: 'Werkuren (' + (dur / 60).toFixed(2) + 'u)', code: 'GEEN_PRIJS',
                        error: 'Uurcode zonder verkoopprijs — uren NIET op de factuur gezet' });
                    continue;
                }
                const artKey = h.articleId || '_default';
                if (!hoursByArticle[artKey]) hoursByArticle[artKey] = { totalMinutes: 0, salePrice, articleId: h.articleId };
                hoursByArticle[artKey].totalMinutes += dur;
            }
            // Eén factuurregel per articleId, afgerond op totaal.
            // v212: als de app al afgerond aanlevert (hoursPrerounded — zelfde
            // bron als werkbon en preview, incl. wacht=60min-regel) ronden we
            // hier NIET nog eens — anders kon de factuur afwijken van wat de
            // klant in de preview zag en tekende.
            for (const [artKey, group] of Object.entries(hoursByArticle)) {
                const rawHrs = Math.round(group.totalMinutes / 60 * 100) / 100;
                const billableHrs = hoursPrerounded ? rawHrs : this._roundUpHalfHour(rawHrs);
                const desc = 'Werkuren';
                const lineData = {
                    type: 'LINE',
                    quantity: billableHrs,
                    unitType: 'uur',
                    description: desc,
                    price: group.salePrice,
                    vatTariffId: toStr(vatTariffId),
                };
                if (woSalesOrderId) lineData.orderId = woSalesOrderId;
                if (group.articleId && !isNaN(group.articleId) && Number(group.articleId) > 0) {
                    lineData.articleId = toStr(group.articleId);
                }
                console.log('[Factuur] Uren lijn:', rawHrs, 'u → afgerond:', billableHrs, 'u @', group.salePrice);
                const addResult = await this.post(`sales-invoices/${invoiceId}/line-items`, lineData);
                if (addResult.code === 201 || addResult.code === 200) addedLines++;
                else errors.push({ line: desc, code: addResult.code, error: addResult.data });
            }
        } else if (!onderhoud) {
            // Fallback: time-entries van werkorder (NIET bij onderhoud — dan worden uren niet gefactureerd)
            // Tel alle uren op per article en rond totaal af
            const timeResult = await this.get(`work-orders/${workOrderId}/time-entries`);
            const timeEntries = (timeResult.data && (timeResult.data.items || timeResult.data)) || [];
            const teByArticle = {};
            for (const te of timeEntries) {
                const hrs = Number(te.billableHours) || Number(te.hours) || 0;
                const salePrice = Number(te.salePrice) || 0;
                if (hrs <= 0 || salePrice <= 0) continue;
                const artId = te.articleId || (te.article && te.article.id) || '_default';
                if (!teByArticle[artId]) teByArticle[artId] = { totalHrs: 0, salePrice, articleId: artId, desc: te.description || (te.article && te.article.name) || 'Werkuren' };
                teByArticle[artId].totalHrs += hrs;
            }
            for (const [aId, group] of Object.entries(teByArticle)) {
                const billableHrs = this._roundUpHalfHour(group.totalHrs);
                const lineData = {
                    type: 'LINE',
                    quantity: billableHrs,
                    unitType: 'uur',
                    description: group.desc,
                    price: group.salePrice,
                    vatTariffId: toStr(vatTariffId),
                };
                if (woSalesOrderId) lineData.orderId = woSalesOrderId;
                if (aId && aId !== '_default') lineData.articleId = toStr(aId);
                console.log('[Factuur] Uren lijn (fallback):', group.totalHrs, 'u → afgerond:', billableHrs, 'u');
                const addResult = await this.post(`sales-invoices/${invoiceId}/line-items`, lineData);
                if (addResult.code === 201 || addResult.code === 200) addedLines++;
                else errors.push({ line: group.desc, code: addResult.code, error: addResult.data });
            }
        }

        // Stap 4: Factuur ophalen voor totalen + OGM
        let finalInvoice = await this.get(`sales-invoices/${invoiceId}`);
        let inv = finalInvoice.data || {};

        // Controleer nogmaals booked=false
        if (inv.booked) {
            inv.booked = false;
            await this.put(`sales-invoices/${invoiceId}`, inv);
            finalInvoice = await this.get(`sales-invoices/${invoiceId}`);
            inv = finalInvoice.data || {};
        }

        // Totalen berekenen (Robaws geeft ze soms niet terug voor draft)
        let totalExclVat = inv.totalExclVat ?? inv.totalExclTax ?? inv.netAmount ?? null;
        let totalInclVat = inv.totalInclVat ?? inv.totalInclTax ?? inv.grossAmount ?? inv.totalAmount ?? null;

        if (!totalExclVat || !totalInclVat) {
            const linesRes = await this.get(`sales-invoices/${invoiceId}/line-items`);
            const lines = (linesRes.data && linesRes.data.items) || [];
            let computedExcl = 0, computedIncl = 0;
            // BUG-fix: vorige map had '1': 0 wat conflicteert met app.js
            // (waar '1' = 21%). Bovendien viel een onbekend tarief stilletjes
            // terug op 6% — dat gaf foute totalen voor 21%-klanten.
            // We ondersteunen nu zowel '1' als '5' als 21% (Robaws blijkt
            // historisch beide te gebruiken) en loggen een waarschuwing
            // i.p.v. stille foute berekening.
            // v210: percentages eerst uit de LIVE Robaws-tariefmap (één bron,
            // dekt ook nieuwe/gewijzigde tarieven); de lokale tabel is enkel
            // nog noodfallback als de map niet laadt.
            let liveVatMap = null;
            try { liveVatMap = await this.getVatTariffMap(); } catch (_) {}
            const vatRates = { '1': 0.21, '2': 0, '3': 0, '4': 0.06, '5': 0.21 };  // noodfallback (id 2 = Verlegd, 0%)
            for (const l of lines) {
                const lineExcl = (Number(l.quantity) || 0) * (Number(l.price) || 0) * (1 - (Number(l.discount) || 0) / 100);
                const tariffKey = String(l.vatTariffId);
                let vatRate;
                const livePct = (liveVatMap && liveVatMap[tariffKey]) ? liveVatMap[tariffKey].percentage : null;
                if (livePct != null && !isNaN(Number(livePct))) {
                    vatRate = Number(livePct) / 100;
                } else {
                    vatRate = vatRates[tariffKey];
                }
                if (vatRate === undefined) {
                    console.warn('[Factuur] Onbekend vatTariffId:', tariffKey, '— gerekend met 0% (controleer in Robaws)');
                    vatRate = 0;
                }
                computedExcl += lineExcl;
                computedIncl += lineExcl * (1 + vatRate);
            }
            totalExclVat = totalExclVat || Math.round(computedExcl * 100) / 100;
            totalInclVat = totalInclVat || Math.round(computedIncl * 100) / 100;
        }

        const ogm = inv.paymentInstruction || '';
        let formattedOgm = '';
        if (ogm.length === 12) {
            formattedOgm = '+++' + ogm.substr(0, 3) + '/' + ogm.substr(3, 4) + '/' + ogm.substr(7, 5) + '+++';
        }

        // Stap 5: Bedrijfsgegevens ophalen voor betaalscherm
        // Fallback: hardcoded QE bedrijfsgegevens (Robaws companies endpoint geeft IBAN niet altijd terug)
        let companyIban = 'BE17645135216621', companyBic = 'JVBABE22', companyName = 'Quality Environment';
        try {
            const compResult = await this.get(`companies/${companyId}`);
            if (compResult.code === 200 && compResult.data) {
                companyIban = compResult.data.iban || compResult.data.bankAccountNumber || companyIban;
                companyBic = compResult.data.bic || companyBic;
                companyName = compResult.data.name || companyName;
            }
        } catch(e) { /* fallback naar hardcoded waarden */ }

        // Stap 6: Werkbon + order status updaten op basis van betaalmethode
        // v85: ALLE betalingsmethoden zetten werkbon + order op 'gefactureerd'.
        // Voorheen enkel Viva/Overschrijving — nu ook Cash en Niet Ontvangen,
        // omdat in alle gevallen een factuur wordt aangemaakt en de werkbon klaar is.
        // (Monteurs-flow gebruikt executeMonteurSubmitFlow en raakt deze code niet.)
        let newStatus = null;
        if (paymentMethod) {
            newStatus = 'gefactureerd';
        }

        if (newStatus) {
            // v88: Werkbon status + Betaling extra-field updaten
            try {
                const woFull = await this.get(`work-orders/${workOrderId}`);
                if (woFull.code === 200 && woFull.data) {
                    woFull.data.status = newStatus;
                    if (paymentMethod) {
                        woFull.data.extraFields = woFull.data.extraFields || {};
                        woFull.data.extraFields['Betaling'] = {
                            type: 'SELECT',
                            group: 'Betaling',
                            stringValue: paymentMethod,
                        };
                    }
                    // v211: resultaat checken — een werkbon die níet op
                    // 'gefactureerd' raakt, blijft op 'Uitgevoerd' staan en
                    // kan later dubbel gefactureerd worden.
                    const woPut = await this.put(`work-orders/${workOrderId}`, woFull.data);
                    if (woPut.code === 200 || woPut.code === 204) {
                        console.log(`[RobawsAPI] Werkbon ${workOrderId} status → ${newStatus}, Betaling → ${paymentMethod}`);
                    } else {
                        statusErrors.push('werkbon-status niet op gefactureerd (code ' + woPut.code + ')');
                    }
                }
            } catch(e) {
                console.warn('[RobawsAPI] Werkbon status/Betaling updaten mislukt:', e);
                statusErrors.push('werkbon-status niet op gefactureerd (' + (e && e.message) + ')');
            }

            // v88: Sales order status + Betaling extra-field updaten
            if (woSalesOrderId) {
                try {
                    const soFull = await this.get(`sales-orders/${woSalesOrderId}`);
                    if (soFull.code === 200 && soFull.data) {
                        soFull.data.status = newStatus;
                        if (paymentMethod) {
                            soFull.data.extraFields = soFull.data.extraFields || {};
                            soFull.data.extraFields['Betaling'] = {
                                type: 'SELECT',
                                group: 'Betaling',
                                stringValue: paymentMethod,
                            };
                        }
                        const soPut = await this.put(`sales-orders/${woSalesOrderId}`, soFull.data);
                        if (soPut.code === 200 || soPut.code === 204) {
                            console.log(`[RobawsAPI] Order ${woSalesOrderId} status → ${newStatus}, Betaling → ${paymentMethod}`);
                        } else {
                            statusErrors.push('order-status niet op gefactureerd (code ' + soPut.code + ')');  // v211
                        }
                    }
                } catch(e) {
                    console.warn('[RobawsAPI] Order status/Betaling updaten mislukt:', e);
                    statusErrors.push('order-status niet op gefactureerd (' + (e && e.message) + ')');
                }
            }
        }

        return {
            success: true,
            invoice: {
                id: inv.id,
                logicId: inv.logicId,
                date: inv.date,
                expireDate: inv.expireDate,
                totalExclVat: totalExclVat || 0,
                totalInclVat: totalInclVat || 0,
                status: inv.status,
                booked: inv.booked ?? false,
                paymentInstruction: ogm,
                formattedOgm,
            },
            payment: {
                iban: companyIban,
                bic: companyBic,
                companyName: companyName,
                amount: totalInclVat || 0,
                ogm: ogm,
                formattedOgm: formattedOgm,
            },
            lineItemsAdded: addedLines,
            errors,
            statusErrors,  // v211: niet-blokkerende status-fouten (apart van geld-fouten)
            paymentMethod,
            salesOrderId: woSalesOrderId,
            workOrder: {
                id: wo.id,
                logicId: wo.logicId,
                title: wo.title,
            },
        };
    },

    // =============================================
    // HANDTEKENING UPLOADEN
    // =============================================
    async uploadSignature({ workOrderId, signatureName, signatureData }) {
        // Base64 naar Blob
        let base64 = signatureData;
        if (base64.includes(',')) base64 = base64.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) {
            bytes[j] = binary.charCodeAt(j);
        }
        const blob = new Blob([bytes], { type: 'image/png' });
        const file = new File([blob], 'signature.png', { type: 'image/png' });

        // Upload als document bij werkorder
        const result = await this.uploadFile(
            `work-orders/${workOrderId}/documents`,
            file,
            'signature.png'
        );

        // Probeer signatureName op te slaan.
        // BELANGRIJK: Robaws v2 PUT is een VOLLEDIGE replace (geen PATCH).
        // Een PUT met enkel { signatureName } zet alle andere velden terug op null.
        //
        // BUG-fix: vroegere code bouwde een eigen body met alleen een
        // selectie van velden — daardoor verloren we extraFields, notes,
        // tags, responsibleEmployeeId enz. bij elke handtekening-upload.
        // Nu spreaden we het GET-resultaat als basis en zetten enkel
        // signatureName + metadata-velden bij. Read-only/auto-velden die
        // Robaws niet accepteert in een PUT verwijderen we expliciet.
        if (signatureName) {
            try {
                const cur = await this.get(`work-orders/${workOrderId}`);
                if (cur.code === 200 && cur.data) {
                    const body = { ...cur.data, signatureName };
                    // Robaws genereert deze velden zelf — niet meesturen in PUT
                    delete body.id;
                    delete body.createdAt;
                    delete body.updatedAt;
                    delete body.createdBy;
                    delete body.updatedBy;
                    delete body.logicId;
                    await this.put(`work-orders/${workOrderId}`, body);
                }
            } catch(e) { /* niet fataal */ }
        }

        return {
            success: result.code === 200 || result.code === 201,
            documentId: result.data ? result.data.id : null,
        };
    },

    // =============================================
    // FACTUUR ALS BETAALD MARKEREN
    // =============================================
    async markInvoicePaid(invoiceId) {
        // Status blijft "Viva wallet betaling" — de bank zet de factuur automatisch
        // op "betaald" via matching op de gestructureerde mededeling (OGM).
        //
        // We posten GEEN /payments en veranderen GEEN status, want:
        // - Een /payments voor het volledige bedrag zet de factuur meteen op "betaald"
        //   (openstaand saldo = 0), wat we niet willen tot de bank het bevestigt.
        // - De status mag op "Viva wallet betaling" blijven staan zodat de factuur
        //   in de juiste lijst zichtbaar blijft tot de bank matcht.
        //
        // Deze functie is dus effectief een no-op vanuit Robaws-perspectief; ze bestaat
        // enkel nog zodat de app-flow kan doorgaan na een geslaagde terminal-betaling.
        return { success: true, code: 200, skipped: true };
    },

    /**
     * v146: Registreer een EXTERNE betaling op een Robaws sales-invoice.
     * Gebruikt voor Mollie Tap-to-Pay payments die buiten Robaws zelf zijn
     * geïnitieerd. Het volledige bedrag posten zet de factuur automatisch
     * op "betaald" (openstaand saldo = 0).
     *
     * Robaws v2 endpoint: POST /sales-invoices/{id}/payments
     *
     * @param {Object} opts
     * @param {string|number} opts.invoiceId  - factuur ID in Robaws
     * @param {number} opts.amount            - totaal incl. BTW (in EUR)
     * @param {string} [opts.date]            - YYYY-MM-DD (default: vandaag)
     * @param {string} [opts.paymentMethod]   - bv. "Mollie Tap" / "Bancontact"
     * @param {string} [opts.reference]       - bv. Mollie tr_xxxx voor traceability
     * @returns {Promise<{success, code, data, error?}>}
     */
    /**
     * v169: Stuur een werkbon-PDF per email via Robaws.
     *
     * Officieel endpoint (uit Robaws Public API docs):
     *   POST /api/v2/{resourceTypeBasePath}/{resourceId}/emails
     *
     * Voor werkbons:
     *   POST /api/v2/work-orders/{id}/emails
     *
     * Body:
     *   - templateName / templateId  → kies welk template Robaws moet gebruiken
     *   - recipients.to              → bestemmings-adressen
     *   - send: true                 → echt versturen (vs. opslaan als draft)
     *   - sendAsUserId (optioneel)   → namens een specifieke gebruiker
     *
     * Response 201 → { id: "..." } (id van de email)
     *
     * @param {string|number} workOrderId
     * @param {string} email - bestemmings-adres (single email)
     * @param {Object} [opts]
     * @param {string} [opts.templateName] - bv. "Werkbon naar klant" (default uit constante)
     * @param {string} [opts.templateId]   - alternatief voor templateName
     * @param {string} [opts.subject]      - override template-onderwerp
     * @param {Object} [opts.templateContext] - dict voor vervangingscodes
     * @param {string} [opts.sendAsUserId] - namens deze user (default: API-user)
     * @returns {Promise<{ok: boolean, emailId?: string, error?: string}>}
     */
    async sendWorkOrderByEmail(workOrderId, email, opts = {}) {
        if (!workOrderId || !email) return { ok: false, error: 'workOrderId en email verplicht' };
        const trimmed = String(email).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            return { ok: false, error: 'Ongeldig email-adres' };
        }

        // Default template-naam (configurabel in Robaws Instellingen → e-mailtemplates)
        const templateName = opts.templateName || this.EMAIL_TEMPLATE_WERKBON || 'Werkbon naar klant';
        const body = {
            recipients: { to: [trimmed] },
            send: true,
        };
        if (opts.templateId) body.templateId = opts.templateId;
        else body.templateName = templateName;
        if (opts.subject) body.subject = opts.subject;
        if (opts.templateContext) body.templateContext = opts.templateContext;
        if (opts.sendAsUserId) body.sendAsUserId = String(opts.sendAsUserId);

        try {
            const r = await this.post(`work-orders/${workOrderId}/emails`, body);
            if (r.code === 200 || r.code === 201 || r.code === 204) {
                const emailId = (r.data && r.data.id) || null;
                console.log('[sendWorkOrderByEmail] ✓ verstuurd via template "' + templateName + '" → id', emailId);
                return { ok: true, emailId };
            }
            const errMsg = `HTTP ${r.code}: ${JSON.stringify(r.data).slice(0, 300)}`;
            console.warn('[sendWorkOrderByEmail] faalde:', errMsg);
            return { ok: false, error: errMsg };
        } catch (e) {
            const errMsg = (e && e.message) || String(e);
            console.warn('[sendWorkOrderByEmail] gooi-fout:', errMsg);
            return { ok: false, error: errMsg };
        }
    },

    /** v169: configurabele template-naam voor werkbon-mails.
     *  Moet exact matchen met de naam in Robaws Instellingen → e-mailtemplates.
     *  Bij wijziging in Robaws ook hier aanpassen. */
    EMAIL_TEMPLATE_WERKBON: 'Werkbon naar klant',

    async registerInvoicePayment({ invoiceId, amount, date, paymentMethod, reference }) {
        if (!invoiceId) return { success: false, error: 'invoiceId verplicht' };
        if (!amount || amount <= 0) return { success: false, error: 'amount > 0 verplicht' };

        const isoDate = date || this._localDateStr();
        const amountStr = (Math.round(parseFloat(amount) * 100) / 100).toFixed(2);

        // Robaws v2 verwacht bedragen als string in het amount-object (zelfde
        // patroon als bij sales-invoices/line-items). We proberen meerdere
        // gangbare body-vormen indien de eerste een 4xx geeft.
        const bodyVariants = [
            // Variant A: amount object met value/currency (Mollie-stijl)
            {
                amount: { value: amountStr, currency: 'EUR' },
                date: isoDate,
                paymentMethod: paymentMethod || 'Bancontact',
                remark: reference ? ('Mollie ' + reference) : '',
            },
            // Variant B: flat amount (legacy v1-stijl)
            {
                amount: parseFloat(amountStr),
                date: isoDate,
                paymentMethod: paymentMethod || 'Bancontact',
                remark: reference ? ('Mollie ' + reference) : '',
            },
            // Variant C: minimal (alleen amount + date)
            {
                amount: { value: amountStr, currency: 'EUR' },
                date: isoDate,
            },
        ];

        const path = `sales-invoices/${invoiceId}/payments`;
        let lastErr = null;
        for (let i = 0; i < bodyVariants.length; i++) {
            const body = bodyVariants[i];
            console.log('[Robaws] registerInvoicePayment poging ' + (i+1) + ':', body);
            try {
                const res = await this.post(path, body);
                console.log('[Robaws] registerInvoicePayment response:', res.code, res.data);
                if (res.code === 200 || res.code === 201 || res.code === 204) {
                    return { success: true, code: res.code, data: res.data, variant: i + 1 };
                }
                lastErr = { code: res.code, data: res.data };
                // 400/422 = body-format probleem → probeer volgende variant
                if (res.code !== 400 && res.code !== 422) break;
            } catch (e) {
                lastErr = { error: e && e.message };
                break;
            }
        }
        return {
            success: false,
            code: lastErr && lastErr.code,
            error: (lastErr && lastErr.data && (lastErr.data.message || JSON.stringify(lastErr.data).slice(0, 200)))
                || (lastErr && lastErr.error)
                || 'onbekende fout',
        };
    },
    // =============================================
    // TIJDSREGISTRATIE VIA WERKBONNEN (v58+)
    // =============================================

    /** Article-IDs voor uurcodes in Robaws (zie screenshot uurcodes-lijst). */
    WERKUUR_ARTICLE_IDS: {
        monteurProject: 185,    // "Werkuur monteur - Project" - €65 verkoop
        ladenLossen: 19786,     // "Werkuur laden & lossen"     - €0 verkoop
    },

    /** v83: hourTypeId waarden voor uursoort in Robaws time-entries.
     *  Zie GET /work-orders/{id}/time-entries response — werkuren=1, overuren=2.
     *  v138: weekend-versies worden runtime opgehaald via _loadWeekendHourTypeIds. */
    HOUR_TYPE_IDS: {
        werkuren: 1,
        overuren: 2,
        werkurenZaterdag: null,
        werkurenZondag:   null,
        overurenZaterdag: null,
        overurenZondag:   null,
    },

    /** v138: probeer Robaws's hour-types endpoint en cache namen → IDs. */
    // v180: cache van hourType-id -> naam (1 call), zodat het dagoverzicht
    // overuren-varianten ("Overuren zaterdag/zondag") correct kan herkennen.
    // Voorheen werd enkel id===2 als overuren geteld -> weekend-overuren viel
    // in de werkuren-bak.
    _hourTypeNameCache: null,
    async getHourTypeNameMap() {
        if (this._hourTypeNameCache) return this._hourTypeNameCache;
        const map = {};
        try {
            const res = await this.get('hour-types?limit=100');
            if (res.code === 200) {
                const items = (res.data && res.data.items) || res.data || [];
                for (const ht of items) {
                    if (ht && ht.id != null) map[String(ht.id)] = ht.name || '';
                }
            }
        } catch (e) {
            console.warn('[RobawsAPI] getHourTypeNameMap faalde:', e && e.message);
        }
        this._hourTypeNameCache = map;
        return map;
    },

    // v183: BTW-tarieven 1x ophalen als map {id: {percentage, name}} (gecached),
    // zodat getPlanning niet per klant een vat-tariffs/{id}-call hoeft te doen.
    _vatTariffMapCache: null,
    async getVatTariffMap() {
        if (this._vatTariffMapCache) return this._vatTariffMapCache;
        const map = {};
        try {
            const res = await this.get('vat-tariffs?limit=50');
            if (res.code === 200) {
                const items = (res.data && res.data.items) || res.data || [];
                for (const t of items) {
                    if (t && t.id != null) {
                        map[String(t.id)] = { percentage: t.percentage ?? null, name: t.name ?? null };
                    }
                }
            }
        } catch (e) {
            console.warn('[RobawsAPI] getVatTariffMap faalde:', e && e.message);
        }
        // v210: een LEGE map niet cachen — één mislukte fetch bij opstart
        // betekende voorheen de hele sessie geen BTW-percentages (kaarten
        // zonder %, fee-berekening op noodfallback). Nu wordt het bij de
        // volgende aanroep gewoon opnieuw geprobeerd.
        if (Object.keys(map).length > 0) {
            this._vatTariffMapCache = map;
        }
        return map;
    },

    _weekendHourTypesLoaded: false,
    _weekendHourTypesLoading: false,
    async _loadWeekendHourTypeIds() {
        if (this._weekendHourTypesLoaded || this._weekendHourTypesLoading) return;
        // v214: de loaded-vlag stond voorheen direct op true, óók bij een
        // mislukte fetch — één hapering bij opstart en zaterdag-/zondaguren
        // werden de hele sessie stil als weekdag geboekt. Nu: pas markeren
        // ná een geslaagde load, zodat het bij de volgende klok-actie
        // gewoon opnieuw geprobeerd wordt.
        this._weekendHourTypesLoading = true;
        try {
            const res = await this.get('hour-types?limit=50');
            if (res.code !== 200) {
                console.warn('[RobawsAPI] hour-types endpoint gaf', res.code);
                return;
            }
            const items = (res.data && res.data.items) || res.data || [];
            const byName = {};
            for (const ht of items) {
                const n = (ht.name || '').toLowerCase().trim();
                if (n && ht.id != null) byName[n] = ht.id;
            }
            if (byName['werkuren zaterdag']) this.HOUR_TYPE_IDS.werkurenZaterdag = byName['werkuren zaterdag'];
            if (byName['werkuren zondag'])   this.HOUR_TYPE_IDS.werkurenZondag   = byName['werkuren zondag'];
            if (byName['overuren zaterdag']) this.HOUR_TYPE_IDS.overurenZaterdag = byName['overuren zaterdag'];
            if (byName['overuren zondag'])   this.HOUR_TYPE_IDS.overurenZondag   = byName['overuren zondag'];
            console.log('[RobawsAPI] weekend hourTypes:', this.HOUR_TYPE_IDS);
            this._weekendHourTypesLoaded = true;  // v214: enkel bij succes
        } catch(e) {
            console.warn('[RobawsAPI] hour-types lookup faalde:', e && e.message);
        } finally {
            this._weekendHourTypesLoading = false;
        }
    },

    /** v138: voor een gegeven hourTypeId en datum (YYYY-MM-DD), geef de juiste
     *  weekend-variant terug als de datum een zaterdag of zondag is.
     *  Werkt enkel als de weekend-IDs gevonden zijn — anders blijft origineel. */
    async getWeekendAdjustedHourTypeId(hourTypeId, dateStr) {
        if (!hourTypeId || !dateStr) return hourTypeId;
        await this._loadWeekendHourTypeIds();
        const day = new Date(String(dateStr) + 'T12:00:00').getDay();
        if (day !== 0 && day !== 6) return hourTypeId;
        const base = String(hourTypeId);
        const isWerk = base === String(this.HOUR_TYPE_IDS.werkuren);
        const isOver = base === String(this.HOUR_TYPE_IDS.overuren);
        if (!isWerk && !isOver) return hourTypeId;
        const target = isWerk
            ? (day === 6 ? this.HOUR_TYPE_IDS.werkurenZaterdag : this.HOUR_TYPE_IDS.werkurenZondag)
            : (day === 6 ? this.HOUR_TYPE_IDS.overurenZaterdag : this.HOUR_TYPE_IDS.overurenZondag);
        if (target) {
            console.log('[RobawsAPI] weekend-adjust hourTypeId ' + hourTypeId + ' → ' + target + ' (day=' + day + ')');
            return target;
        }
        console.warn('[RobawsAPI] geen weekend hourTypeId gevonden — gebruik default ' + hourTypeId);
        return hourTypeId;
    },

    /** v83/v95: mobilityTypeId waarden voor commute-entries in Robaws.
     *   -1 = chauffeur (met passagiers)
     *   -2 = passagier
     *   -3 = chauffeur zonder passagiers (default voor werknemers)
     */
    MOBILITY_TYPE_IDS: {
        chauffeurMetPassagiers: -1,
        passagier: -2,
        chauffeur: -3,                  // = chauffeur zonder passagiers (legacy alias, default)
        chauffeurZonderPassagiers: -3,
    },

    /** YYYY-MM-DD -> DD/MM/YYYY voor titel */
    _formatDateLabel(dateStr) {
        if (!dateStr) return '';
        const m = String(dateStr).substring(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return dateStr;
        return `${m[3]}/${m[2]}/${m[1]}`;
    },

    /** Rond een HH:MM string af op de dichtsbijzeijnde 5 min. */
    _roundTimeToNearest5(hhmm) {
        if (!hhmm) return hhmm;
        const m = String(hhmm).match(/^(\d{1,2}):(\d{1,2})/);
        if (!m) return hhmm;
        const h = parseInt(m[1], 10) || 0;
        const min = parseInt(m[2], 10) || 0;
        const total = h * 60 + min;
        const rounded = Math.round(total / 5) * 5;
        const rh = Math.floor(rounded / 60) % 24;
        const rm = rounded % 60;
        return `${String(rh).padStart(2,'0')}:${String(rm).padStart(2,'0')}`;
    },

    /** Lees een extraField waarde uit alle gangbare value-keys */
    _extractFieldVal(field) {
        if (!field) return '';
        const raw = field.stringValue
            ?? field.intValue
            ?? field.integerValue
            ?? field.numberValue
            ?? field.decimalValue
            ?? field.doubleValue
            ?? field.longValue
            ?? field.value
            ?? '';
        return raw === null || raw === undefined ? '' : String(raw).trim();
    },

    /**
     * Maak een nieuwe Tijdsregistratie-werkbon aan voor de gescande werknemer.
     * Returns { workOrderId, raw }.
     * v59: GET-then-PUT i.p.v. partial PUT — voorkomt dat Robaws het body-format
     * stilzwijgend afwijst en een lege werkbon achterlaat. Uitgebreide
     * logging naar localStorage zodat we exact kunnen zien wat er gebeurt.
     */
    async createTimeRegistrationWorkOrder(opts) {
        const { employeeId, employeeName, userId, dateStr, ingeklokt, tijdLabel, opmerking } = opts;

        // v214: zonder userId géén tijdsregistratie aanmaken — zo'n werkbon
        // zonder verantwoordelijke is onvindbaar voor getTodaysOpen... (dus
        // dubbele inklok bij de volgende scan) en lekt in het dagoverzicht
        // van álle gebruikers.
        if (userId == null || String(userId) === '') {
            throw new Error('Geen Robaws-gebruikers-id gekend — log opnieuw in (met internet) en probeer dan te klokken');
        }

        // Stap 1: lege werkbon aanmaken
        const woRes = await this.post('work-orders', {});
        try { localStorage.setItem('qe_last_tr_post_res', JSON.stringify({code: woRes.code, data: woRes.data})); } catch(_) {}
        if (woRes.code !== 200 && woRes.code !== 201) {
            throw new Error('POST /work-orders faalde (' + woRes.code + '): ' +
                JSON.stringify(woRes.data).slice(0, 200));
        }
        const workOrderId = woRes.data && woRes.data.id;
        if (!workOrderId) {
            throw new Error('POST /work-orders gaf geen id terug: ' + JSON.stringify(woRes.data).slice(0,200));
        }

        // Stap 2: GET de werkbon zodat we het volledige object kunnen mergen
        let woFull;
        try {
            const getRes = await this.get(`work-orders/${workOrderId}`);
            if (getRes.code === 200 && getRes.data) {
                woFull = getRes.data;
            }
        } catch(e) {
            console.warn('[RobawsAPI] GET werkbon na POST faalde:', e.message);
        }
        if (!woFull) {
            // Fallback: alleen het id bekend
            woFull = { id: workOrderId };
        }

        // Stap 3: bouw merged body — bestaande velden behouden, onze velden toevoegen
        const dateLabel = this._formatDateLabel(dateStr);
        let trTitle = `Tijdsregistratie ${employeeName || ''} - ${dateLabel}`.trim();
        // v221: bij een afwezigheid het type achter de titel — zo zie je in
        // de Robaws-lijst meteen "... - Ziek" / "... - Verlof" zonder de
        // registratie te moeten openen. Gewone klok-registraties (Op tijd /
        // Te laat) blijven ongewijzigd.
        if (tijdLabel && this.ABSENCE_TIJD.includes(String(tijdLabel).trim())) {
            trTitle += ' - ' + String(tijdLabel).trim();
        }
        woFull.title = trTitle;
        woFull.date = dateStr;
        woFull.status = 'Tijdsregistratie';
        woFull.timeAndMaterial = false;
        woFull.remark = opmerking || '';
        if (userId) woFull.assignedUserId = String(userId);

        // v60: Variant A format — bevestigd werkend via PHP probe.
        // GEEN type/group meegeven; Robaws gebruikt zijn eigen schema.
        woFull.extraFields = woFull.extraFields || {};
        woFull.extraFields['Tijd']       = { stringValue: tijdLabel || 'Op tijd' };
        woFull.extraFields['Ingeklokt']  = { stringValue: ingeklokt || '' };
        woFull.extraFields['Uitgeklokt'] = { stringValue: '' };

        try { localStorage.setItem('qe_last_tr_put_req', JSON.stringify(woFull)); } catch(_) {}

        const putRes = await this.put(`work-orders/${workOrderId}`, woFull);
        try { localStorage.setItem('qe_last_tr_put_res', JSON.stringify({code: putRes.code, data: putRes.data})); } catch(_) {}

        if (putRes.code !== 200 && putRes.code !== 201 && putRes.code !== 204) {
            throw new Error('PUT /work-orders/' + workOrderId + ' faalde (' + putRes.code +
                '): ' + JSON.stringify(putRes.data).slice(0, 300));
        }

        return { workOrderId, raw: putRes.data || woFull };
    },

    /**
     * Update Uitgeklokt-tijd op een tijdsregistratie-werkbon.
     * v59: GET-then-PUT (partial PUT zou andere velden wissen).
     * v70: optioneel een extra regel aan de werkbon-remark appenden
     *      (gebruikt voor "klok-uit: ..." regel).
     */
    async setTimeRegistrationUitgeklokt(workOrderId, uitgeklokt, appendRemark) {
        const getRes = await this.get(`work-orders/${workOrderId}`);
        if (getRes.code !== 200 || !getRes.data) {
            throw new Error('GET /work-orders/' + workOrderId + ' faalde (' + getRes.code + ')');
        }
        const wo = getRes.data;
        wo.extraFields = wo.extraFields || {};
        wo.extraFields['Uitgeklokt'] = { stringValue: uitgeklokt || '' };
        if (appendRemark) {
            const existing = String(wo.remark || '').trim();
            wo.remark = existing ? (existing + '\n' + appendRemark) : appendRemark;
        }
        try { localStorage.setItem('qe_last_uitg_put_req', JSON.stringify(wo)); } catch(_) {}
        const putRes = await this.put(`work-orders/${workOrderId}`, wo);
        try { localStorage.setItem('qe_last_uitg_put_res', JSON.stringify({code: putRes.code, data: putRes.data})); } catch(_) {}
        return putRes;
    },

    /** Update Tijd-keuze (bv. naar "Ziek"). v59: GET-then-PUT. */
    async setTimeRegistrationTijd(workOrderId, tijdLabel) {
        const getRes = await this.get(`work-orders/${workOrderId}`);
        if (getRes.code !== 200 || !getRes.data) {
            throw new Error('GET /work-orders/' + workOrderId + ' faalde (' + getRes.code + ')');
        }
        const wo = getRes.data;
        wo.extraFields = wo.extraFields || {};
        // v60: Variant A — geen type/group
        wo.extraFields['Tijd'] = { stringValue: tijdLabel || 'Op tijd' };
        return await this.put(`work-orders/${workOrderId}`, wo);
    },

    /**
     * Voeg een werknemer-uren regel toe aan een tijdsregistratie-werkbon.
     * @param {Object} opts
     * @param {string|number} opts.workOrderId
     * @param {string|number} opts.employeeId
     * @param {string} opts.startTime       HH:MM
     * @param {string} opts.endTime         HH:MM
     * @param {number} [opts.breakMinutes]  Pauze in minuten
     * @param {string|number} opts.articleId  Uurcode-id (185 of 19786)
     */
    /**
     * v73: POST een L&L time-entry direct bij start (alleen startTime, geen endTime).
     * Returns het time-entry id zodat we het kunnen updaten bij eind-scan.
     */
    async postOpenLLTimeEntry(opts) {
        const { workOrderId, employeeId, startTime } = opts;
        const te = {
            employeeId: String(employeeId),
            articleId: String(this.WERKUUR_ARTICLE_IDS.ladenLossen),
            // v110: L&L is uursoort OVERUREN (vroeger werkuren — gebruiker wil dat
            // L&L altijd buiten de 8u werkuren-eis valt en als overuren wordt
            // geregistreerd, zonder dat kantoor handmatig hoeft te switchen).
            hourTypeId: String(this.HOUR_TYPE_IDS.overuren),
        };
        if (startTime) {
            const [sh, sm] = startTime.split(':').map(Number);
            te.startTime = { hour: sh || 0, minute: sm || 0 };
        }
        // Geen endTime, geen hours — die worden later geupdate.
        const res = await this.post(`work-orders/${workOrderId}/time-entries`, te);
        if (res.code !== 200 && res.code !== 201) {
            throw new Error('POST L&L time-entry faalde: ' + res.code + ' ' +
                JSON.stringify(res.data).slice(0, 200));
        }
        return res.data && res.data.id;
    },

    /**
     * v73: PUT update een bestaande L&L time-entry met endTime + hours.
     * Robaws v2 ondersteunt PUT op /work-orders/{id}/time-entries/{teId}.
     */
    async closeOpenLLTimeEntry(workOrderId, teId, opts) {
        const { startTime, endTime } = opts;
        const body = {
            articleId: String(this.WERKUUR_ARTICLE_IDS.ladenLossen),
            // v110: bij PUT update ook hourTypeId op OVERUREN zetten (was werkuren).
            hourTypeId: String(this.HOUR_TYPE_IDS.overuren),
        };
        if (startTime) {
            const [sh, sm] = startTime.split(':').map(Number);
            body.startTime = { hour: sh || 0, minute: sm || 0 };
        }
        if (endTime) {
            const [eh, em] = endTime.split(':').map(Number);
            body.endTime = { hour: eh || 0, minute: em || 0 };
        }
        if (startTime && endTime) {
            const [sh, sm] = startTime.split(':').map(Number);
            const [eh, em] = endTime.split(':').map(Number);
            const minutes = ((eh || 0) * 60 + (em || 0)) - ((sh || 0) * 60 + (sm || 0));
            const hrs = Math.max(0, Math.round(minutes / 60 * 100) / 100);
            body.hours = hrs;
            body.billableHours = this._roundUpHalfHour(hrs);
        }
        return await this.put(`work-orders/${workOrderId}/time-entries/${teId}`, body);
    },

        async addWorkHoursTimeEntry(opts) {
        const {
            workOrderId, employeeId, startTime, endTime, breakMinutes, articleId,
            // v83 nieuwe parameters:
            hourTypeId: rawHourTypeId,  // 1 = werkuren, 2 = overuren (HOUR_TYPE_IDS)
            hoursOverride,              // expliciete uren (voor compensatie-entries zonder tijden)
            date,                       // v138: optioneel — datum voor weekend-adjust (default = today)
        } = opts;
        // v138: op zaterdag/zondag → werkuren/overuren-zaterdag/zondag variant
        const dateForAdjust = date || this._localDateStr();
        const hourTypeId = await this.getWeekendAdjustedHourTypeId(rawHourTypeId, dateForAdjust);
        const te = {
            employeeId: String(employeeId),
            articleId: String(articleId),
        };
        if (hourTypeId != null) te.hourTypeId = String(hourTypeId);
        if (startTime) {
            const [sh, sm] = startTime.split(':').map(Number);
            te.startTime = { hour: sh || 0, minute: sm || 0 };
        }
        if (endTime) {
            const [eh, em] = endTime.split(':').map(Number);
            te.endTime = { hour: eh || 0, minute: em || 0 };
        }
        // v63: Robaws v2 wil 'breakMinutes' (we stuurden breakDuration en kreeg breakMinutes:0 terug)
        if (breakMinutes && breakMinutes > 0) te.breakMinutes = parseInt(breakMinutes, 10);
        // v83: hoursOverride wint van auto-calc (voor compensatie-entries die negatief zijn)
        if (hoursOverride != null) {
            te.hours = parseFloat(hoursOverride);
            te.billableHours = parseFloat(hoursOverride);
        } else if (startTime && endTime) {
            // Bereken hours uit start/end - pauze (= netto). Robaws toont
            // `hours` in de "Uren"-kolom van de werkbon als netto-uren
            // (= bruto − pauze), dus aftrekken hier is correct.
            const [sh, sm] = startTime.split(':').map(Number);
            const [eh, em] = endTime.split(':').map(Number);
            const minutes = ((eh || 0) * 60 + (em || 0)) - ((sh || 0) * 60 + (sm || 0)) - (parseInt(breakMinutes, 10) || 0);
            const hrs = Math.max(0, Math.round(minutes / 60 * 100) / 100);
            te.hours = hrs;
            te.billableHours = this._roundUpHalfHour(hrs);
        }
        return await this.post(`work-orders/${workOrderId}/time-entries`, te);
    },

    /**
     * v88: Update Betaling extra-field op een document (werkbon / order / factuur).
     * Doet GET (om bestaand object te krijgen), wijzigt extraFields.Betaling, doet PUT.
     * Robaws v2 vereist het volledige object terug bij PUT.
     *
     * @param {string} resource - 'work-orders' | 'sales-orders' | 'sales-invoices'
     * @param {string|number} id
     * @param {string} paymentMethod - 'Viva wallet' | 'Cash' | 'Overschrijving' | 'Via factuur'
     * @returns {Promise<{ok:boolean, code?:number, error?:string}>}
     */
    async updateBetalingField(resource, id, paymentMethod) {
        try {
            const fullRes = await this.get(`${resource}/${id}`);
            if (fullRes.code !== 200 || !fullRes.data) {
                return { ok: false, code: fullRes.code, error: 'GET faalde' };
            }
            const data = fullRes.data;
            data.extraFields = data.extraFields || {};
            data.extraFields['Betaling'] = {
                type: 'SELECT',
                group: 'Betaling',
                stringValue: paymentMethod,
            };
            const putRes = await this.put(`${resource}/${id}`, data);
            if (putRes.code !== 200 && putRes.code !== 204) {
                return { ok: false, code: putRes.code, error: 'PUT faalde' };
            }
            return { ok: true, code: putRes.code };
        } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
        }
    },

    /**
     * v88: Update de Betaling extra-field op alle 3 documenten (werkbon, order, factuur).
     * Onafhankelijk — bij fout op één document gaan we door met de rest.
     *
     * @param {Object} ids - { workOrderId, salesOrderId, invoiceId }
     * @param {string} paymentMethod
     * @returns {Promise<{ok:boolean, results: {workOrder, salesOrder, invoice}}>}
     */
    async setBetalingOnAllDocs(ids, paymentMethod) {
        const { workOrderId, salesOrderId, invoiceId } = ids || {};
        const results = { workOrder: null, salesOrder: null, invoice: null };
        if (workOrderId) {
            results.workOrder = await this.updateBetalingField('work-orders', workOrderId, paymentMethod);
        }
        if (salesOrderId) {
            results.salesOrder = await this.updateBetalingField('sales-orders', salesOrderId, paymentMethod);
        }
        if (invoiceId) {
            results.invoice = await this.updateBetalingField('sales-invoices', invoiceId, paymentMethod);
        }
        const allOk = (!workOrderId || results.workOrder?.ok)
            && (!salesOrderId || results.salesOrder?.ok)
            && (!invoiceId || results.invoice?.ok);
        return { ok: allOk, results };
    },

    /**
     * v92: Zoek de meest recente factuur voor de ingelogde technieker met
     * status "Technieker" OF "Gecontrolleerd". Return de hele invoice object
     * of null als geen match. Pagineert max 5 pagina's (= 500 facturen) en
     * stopt bij eerste match.
     */
    async getLatestInvoiceForUser(userId, statusWhitelist) {
        if (!userId) return null;
        const whitelist = (statusWhitelist || ['Technieker', 'Gecontrolleerd']).map(s => s.toLowerCase());
        const LIMIT = 100;
        for (let p = 0; p < 5; p++) {
            const offset = p * LIMIT;
            const res = await this.get(`sales-invoices?limit=${LIMIT}&offset=${offset}&sort=id:desc`);
            if (res.code !== 200) break;
            const items = (res.data && res.data.items) || [];
            if (!items.length) break;
            for (const inv of items) {
                const st = String(inv.status || '').toLowerCase();
                if (!whitelist.includes(st)) continue;
                const aId = inv.assignedUserId || (inv.assignedUser && inv.assignedUser.id);
                if (String(aId) !== String(userId)) continue;
                return inv;
            }
            if (res.data.totalPages && p + 1 >= res.data.totalPages) break;
        }
        return null;
    },

    /**
     * v92: Zoek de gelinkte werkbon + order voor een factuur via de line-items.
     * Sales-orders staan op line-item.orderId. Werkbon vinden via een query op
     * work-orders met die salesOrderId.
     * @returns {{salesOrderId: string|null, workOrderId: string|null}}
     */
    async getInvoiceLinkedDocs(invoiceId) {
        const result = { salesOrderId: null, workOrderId: null };
        if (!invoiceId) return result;
        // Stap 1: line-items voor salesOrderId
        try {
            const liRes = await this.get(`sales-invoices/${invoiceId}/line-items?limit=50`);
            if (liRes.code === 200 && liRes.data && liRes.data.items) {
                for (const li of liRes.data.items) {
                    if (li.orderId && !result.salesOrderId) result.salesOrderId = String(li.orderId);
                    if (li.workOrderId && !result.workOrderId) result.workOrderId = String(li.workOrderId);
                    if (result.salesOrderId && result.workOrderId) break;
                }
            }
        } catch(_) {}
        // Stap 2: als geen workOrderId, zoek via salesOrder
        if (result.salesOrderId && !result.workOrderId) {
            try {
                const woRes = await this.get(`work-orders?salesOrderId=${result.salesOrderId}&limit=10&sort=id:desc`);
                if (woRes.code === 200 && woRes.data && woRes.data.items && woRes.data.items.length > 0) {
                    // Pak de laatst aangemaakte werkbon voor deze sales-order
                    // (filter op match aangezien API soms breed terugfilter krijgt)
                    for (const wo of woRes.data.items) {
                        const sId = wo.salesOrderId || (wo.salesOrder && wo.salesOrder.id);
                        if (String(sId) === String(result.salesOrderId)) {
                            result.workOrderId = String(wo.id);
                            break;
                        }
                    }
                }
            } catch(_) {}
        }
        return result;
    },

    /** v83: Voeg een kilometers/commute-lijn toe aan een werkbon.
     *  @param {Object} opts
     *  @param {string|number} opts.workOrderId
     *  @param {string|number} opts.employeeId
     *  @param {number} opts.distance - km heen
     *  @param {number} [opts.returnDistance] - km terug (default 0)
     *  @param {number} [opts.mobilityTypeId] - default -3 (chauffeur zonder passagiers)
     *  @returns {Promise<{code:number, data:object}>}
     */
    async addCommuteEntry(opts) {
        const {
            workOrderId, employeeId, distance, returnDistance, mobilityTypeId,
        } = opts;
        const body = {
            employeeId: String(employeeId),
            mobilityTypeId: String(mobilityTypeId != null ? mobilityTypeId : this.MOBILITY_TYPE_IDS.chauffeur),
            distance: parseFloat(distance) || 0,
            returnDistance: parseFloat(returnDistance) || 0,
        };
        return await this.post(`work-orders/${workOrderId}/commute-entries`, body);
    },

    // =============================================
    // v137: KLANT ZOEKEN + AANMAKEN (technieker ad-hoc werkbon flow)
    // =============================================

    // Caches alle Robaws clients voor 10 min zodat klant-search instant is.
    _allClientsCache: null,        // {at: timestamp, items: [...]}
    _allClientsCacheMs: 10 * 60 * 1000,

    /** Haal (en cache) alle Robaws-klanten paginerend op. */
    async _fetchAllClientsCached() {
        const now = Date.now();
        if (this._allClientsCache && (now - this._allClientsCache.at) < this._allClientsCacheMs) {
            return this._allClientsCache.items;
        }
        const all = [];
        let page = 0;
        const MAX_PAGES = 20;      // ~2000 clients ruim genoeg voor QE
        do {
            const res = await this.get(`clients?limit=100&offset=${page * 100}`);
            const items = (res.data && res.data.items) || [];
            if (items.length === 0) break;
            all.push(...items);
            page++;
            if (page >= (res.data.totalPages || 1)) break;
        } while (page < MAX_PAGES);
        this._allClientsCache = { at: now, items: all };
        console.log('[RobawsAPI] _fetchAllClientsCached:', all.length, 'klanten geladen');
        return all;
    },

    /**
     * Live klantzoek voor de "+ Nieuwe werkbon" modal. Robaws's `?q=`-filter
     * werkt niet betrouwbaar voor clients → we doen client-side substring match
     * op naam, email en telefoon. Cache met 10 min TTL maakt het snel.
     */
    async searchClients(query, limit = 15) {
        const q = String(query || '').trim().toLowerCase();
        if (!q || q.length < 2) return [];
        const all = await this._fetchAllClientsCached();
        const matches = [];
        for (const c of all) {
            if (matches.length >= limit) break;
            const name  = (c.name  || '').toLowerCase();
            const email = (c.email || '').toLowerCase();
            const tel   = (c.tel   || '').toLowerCase();
            const addr  = c.address ? this.formatAddress(c.address).toLowerCase() : '';
            if (name.includes(q) || email.includes(q) || tel.includes(q) || addr.includes(q)) {
                matches.push(c);
            }
        }
        // Sorteer: name-startsWith zaken eerst, dan rest
        matches.sort((a, b) => {
            const an = (a.name || '').toLowerCase();
            const bn = (b.name || '').toLowerCase();
            const aStarts = an.startsWith(q) ? 0 : 1;
            const bStarts = bn.startsWith(q) ? 0 : 1;
            if (aStarts !== bStarts) return aStarts - bStarts;
            return an.localeCompare(bn);
        });
        return matches.map(c => ({
            id: c.id,
            name: c.name || '',
            email: c.email || '',
            tel: c.tel || '',
            address: c.address ? this.formatAddress(c.address) : '',
            rawAddress: c.address || null,
        }));
    },

    /**
     * Maak een nieuwe klant aan in Robaws. Minimaal naam + adres-velden.
     * Returns het volledige client-object van Robaws.
     */
    async createClient({ name, addressLine1, postalCode, city, country, email, tel }) {
        if (!name || !String(name).trim()) throw new Error('Naam is verplicht');
        const body = {
            name: String(name).trim(),
            address: {
                addressLine1: addressLine1 || null,
                postalCode:   postalCode || null,
                city:         city || null,
                country:      country || 'België',
            },
        };
        if (email) body.email = String(email).trim();
        if (tel)   body.tel   = String(tel).trim();
        const res = await this.post('clients', body);
        if (res.code !== 200 && res.code !== 201) {
            throw new Error('Klant aanmaken faalde (HTTP ' + res.code + ')');
        }
        return res.data;
    },

    /**
     * Maak een nieuwe sales-order (opdracht) aan voor een klant.
     * Returns het volledige sales-order object.
     */
    async createSalesOrder({ clientId, title, assignedUserId, salesAgentUserId, address }) {
        if (!clientId) throw new Error('clientId is verplicht');
        const body = {
            clientId: String(clientId),
            title:    String(title || '').trim(),
        };
        if (assignedUserId)   body.assignedUserId   = String(assignedUserId);
        if (salesAgentUserId) body.salesAgentUserId = String(salesAgentUserId);
        if (address)          body.address          = address;
        const res = await this.post('sales-orders', body);
        if (res.code !== 200 && res.code !== 201) {
            throw new Error('Order aanmaken faalde (HTTP ' + res.code + ')');
        }
        return res.data;
    },

    /**
     * Maak een nieuw planning-item (dagplanning) aan voor een werknemer.
     * startDate/endDate moeten ISO-strings met UTC offset zijn.
     */
    async createPlanningItem({
        salesOrderId, clientId, employeeIds, startDate, endDate,
        summary, description, address, hourTypeId, planningTypeId,
    }) {
        const body = {};
        if (summary)        body.summary        = String(summary);
        if (description)    body.description    = String(description);
        if (salesOrderId)   body.salesOrderId   = String(salesOrderId);
        if (clientId)       body.clientId       = String(clientId);
        if (Array.isArray(employeeIds) && employeeIds.length) {
            body.employeeIds = employeeIds.map(String);
        }
        if (startDate)      body.startDate      = startDate;
        if (endDate)        body.endDate        = endDate;
        if (address)        body.address        = address;
        if (hourTypeId != null)     body.hourTypeId     = String(hourTypeId);
        if (planningTypeId != null) body.planningTypeId = String(planningTypeId);
        const res = await this.post('planning-items', body);
        if (res.code !== 200 && res.code !== 201) {
            throw new Error('Dagplanning aanmaken faalde (HTTP ' + res.code + ')');
        }
        return res.data;
    },

    /**
     * Haal Tijdsregistratie-werkbonnen op voor de huidige user, voor een
     * bepaalde maand (YYYY-MM). Filter op assignedUserId zodat techniekers
     * enkel hun eigen kaarten zien.
     */
    async getMyTimeRegistrationWorkOrders(userId, monthPrefix) {
        // v178: deterministische + efficiente fetch.
        //  - ?include=timeEntries -> time-entries komen INLINE mee (geen N+1 meer;
        //    zie ROBAWS_API_HANDLEIDING 2.16). loadDagoverzicht hoeft dus geen
        //    aparte GET /work-orders/{id}/time-entries per werkbon meer te doen.
        //  - Stop-conditie op DATUM i.p.v. de oude "smart break". De vorige aanpak
        //    stopte na 2 pagina's zonder maand-match; omdat /work-orders op id:desc
        //    staat en er constant nieuwe werkbonnen bijkomen (elke klok-in), viel
        //    die break elke load op een ANDERE diepte -> wisselende registraties.
        //    Nu stoppen we zodra een volledige pagina ouder is dan de maandstart:
        //    id:desc ~ aanmaakvolgorde en tijdsregistratie-werkbonnen worden op hun
        //    eigen dag aangemaakt, dus alle items van de doelmaand staan bovenaan
        //    en nieuwe komen er bovenop -> STABIEL resultaat tussen loads.
        //  - Server-side filteren op user/status/datum kan NIET op /work-orders
        //    (2.18: status genegeerd; 2.1: enkel clientId/salesOrderId werken),
        //    vandaar de client-side filter onderaan.
        const LIMIT = 100;
        const monthStart = monthPrefix + '-01';   // bv "2026-06-01"
        const allItems = [];
        const seenIds = new Set();
        const MAX_PAGES = 40;   // veiligheidsplafond; de datum-stop kapt normaal
                                // al na enkele pagina's binnen een maand.
        for (let page = 0; page < MAX_PAGES; page++) {
            const offset = page * LIMIT;
            const res = await this.get(
                `work-orders?limit=${LIMIT}&offset=${offset}&sort=id:desc&include=timeEntries`
            );
            if (res.code !== 200) {
                throw new Error(`Tijdsregistratie-werkbonnen fetch faalde (${res.code})`);
            }
            const items = (res.data && res.data.items) || [];
            if (items.length === 0) break;

            let maxRealDate = '';   // hoogste ECHTE datum op deze pagina
            for (const it of items) {
                const d = (it.date || '').substring(0, 10);
                if (d && d > maxRealDate) maxRealDate = d;
                if (it.id == null || seenIds.has(String(it.id))) continue;
                seenIds.add(String(it.id));
                allItems.push(it);
            }

            // Deterministische stop: zagen we een echte datum EN is de hele pagina
            // ouder dan de maandstart, dan zijn alle volgende pagina's (lagere id =
            // ouder) dat ook -> klaar. Lege/null-datums tellen niet mee voor de stop.
            if (maxRealDate && maxRealDate < monthStart) break;
            if (items.length < LIMIT) break;
            if (res.data.totalPages && (page + 1) >= res.data.totalPages) break;
        }
        // Client-side filter: status~tijdsregistratie + assignedUser = user + maand.
        const filtered = allItems.filter(item => {
            const status = String(item.status || '').toLowerCase();
            if (!status.includes('tijdsregistratie')) return false;
            if ((item.date || '').substring(0, 7) !== monthPrefix) return false;
            const itemUserId = item.assignedUserId
                || (item.assignedUser && item.assignedUser.id);
            if (itemUserId && String(itemUserId) !== String(userId)) return false;
            return true;
        });
        console.log('[RobawsAPI] Tijdsregistratie-werkbonnen (v178 include+datumstop): ' +
            allItems.length + ' gescand, ' + filtered.length + ' voor user ' + userId +
            ' in ' + monthPrefix);
        return filtered;
    },

    /**
     * v62/v72: zoek tijdsregistratie-werkbon van vandaag voor een user.
     * Robaws is hier leidend — er hoort er maar 1 te zijn per dag per user.
     * Status whitelist: 'tijdsregistratie' OR 'tijdsregistratie gecontrolleerd'.
     * v72: paginate eerste 3 pagina's (sort=id:desc — recent gemaakte werkbonnen
     * vooraan) en filter optioneel op "open" (Uitgeklokt nog leeg).
     * @param {string|number} userId  - de Robaws userId
     * @param {boolean} [onlyOpen]    - true = alleen werkbonnen met lege Uitgeklokt
     */
    async getTodaysOpenTimeRegistrationWorkOrder(userId, onlyOpen) {
        if (!userId) return null;
        const today = this._localDateStr();
        const allItems = [];
        const seen = new Set();
        // v83b: pagination fix — Robaws negeert ?page=N, gebruik ?offset=N*limit
        const LIMIT = 100;
        for (let p = 0; p < 3; p++) {
            const offset = p * LIMIT;
            const res = await this.get(`work-orders?limit=${LIMIT}&offset=${offset}&sort=id:desc`);
            if (res.code !== 200 || !res.data || !res.data.items || res.data.items.length === 0) break;
            for (const wo of res.data.items) {
                if (wo.id == null || seen.has(String(wo.id))) continue;
                seen.add(String(wo.id));
                allItems.push(wo);
            }
            if (res.data.totalPages && p + 1 >= res.data.totalPages) break;
        }
        const items = allItems.filter(wo => {
            const status = String(wo.status || '').toLowerCase();
            // v72: whitelist i.p.v. substring (toleranter voor andere tijdsregistratie-* statussen
            // is een feature, niet een bug — beide bekende statussen accepteren)
            const validStatus = (status === 'tijdsregistratie' || status === 'tijdsregistratie gecontrolleerd');
            if (!validStatus) return false;
            if ((wo.date || '').substring(0, 10) !== today) return false;
            const itemUserId = wo.assignedUserId || (wo.assignedUser && wo.assignedUser.id);
            if (!itemUserId || String(itemUserId) !== String(userId)) return false;
            // v219: afwezigheids-registraties (Ziek/Verlof/...) zijn GEEN
            // klok-sessies — anders toonde de telefoon van een ziekgemelde
            // werknemer "ingeklokt" en blokkeerde inklokken bij latere komst.
            const tijdVal = String((wo.extraFields && wo.extraFields.Tijd &&
                (wo.extraFields.Tijd.stringValue || '')) || '').trim();
            if (this.ABSENCE_TIJD.includes(tijdVal)) return false;
            if (onlyOpen) {
                const uitg = (wo.extraFields && wo.extraFields.Uitgeklokt
                    && wo.extraFields.Uitgeklokt.stringValue || '').trim();
                if (uitg) return false;
            }
            return true;
        });
        if (items.length === 0) return null;
        if (items.length > 1) {
            console.warn('[RobawsAPI] Meer dan 1 tijdsregistratie-werkbon vandaag voor user',
                userId, '- nieuwste eerste; IDs:', items.map(i => i.id).join(','));
        }
        // v214: numeriek sorteren — de string-sort koos rond een id-lengte-
        // wissel ('9999' vs '10001') de verkeerde werkbon als "nieuwste".
        items.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
        return items[0];
    },

};
