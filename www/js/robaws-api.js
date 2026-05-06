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
    async get(endpoint) {
        const url = this.BASE_URL + '/' + endpoint.replace(/^\//, '');
        const res = await fetch(url, { headers: this.getHeaders() });
        if (res.status === 204) return { code: 204, data: null };
        const txt = await res.text();
        if (!txt) return { code: res.status, data: null };
        try {
            return { code: res.status, data: JSON.parse(txt) };
        } catch (e) {
            return { code: res.status, data: { raw: txt } };
        }
    },

    async post(endpoint, body) {
        const url = this.BASE_URL + '/' + endpoint.replace(/^\//, '');
        const res = await fetch(url, {
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
        const url = this.BASE_URL + '/' + endpoint.replace(/^\//, '');
        const res = await fetch(url, {
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

    async uploadFile(endpoint, file, fileName) {
        const url = this.BASE_URL + '/' + endpoint.replace(/^\//, '');
        const auth = btoa(this.API_KEY + ':' + this.API_SECRET);

        const formData = new FormData();
        formData.append('file', file, fileName);

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + auth,
                'X-Tenant': this.TENANT,
                'Accept': 'application/json',
                // Geen Content-Type — browser zet multipart boundary automatisch
            },
            body: formData,
        });
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
                const r = await this.get(`users?limit=100&page=${page}`);
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

        // Stap 1: Zoek de werknemer op email in Robaws
        let employee = null;
        try {
            // Probeer eerst te zoeken op email
            const searchRes = await this.get(`employees?email=${encodeURIComponent(emailLower)}&limit=50`);
            const allEmps = (searchRes.data && searchRes.data.items) || [];
            employee = allEmps.find(e => (e.email || '').toLowerCase() === emailLower);

            // Als niet gevonden via filter, haal alle actieve werknemers op
            if (!employee) {
                let page = 0;
                const allActive = [];
                do {
                    const res = await this.get(`employees?status=actief&limit=100&page=${page}`);
                    const items = (res.data && res.data.items) || [];
                    if (items.length === 0) break;
                    allActive.push(...items);
                    page++;
                    if (page >= (res.data.totalPages || 1)) break;
                } while (page < 5);
                employee = allActive.find(e => (e.email || '').toLowerCase() === emailLower);
            }
        } catch(e) {
            console.error('[RobawsAPI] Fout bij werknemers ophalen:', e);
            // Fallback naar hardcoded EMPLOYEES als Robaws onbereikbaar
            return this._loginFallback(emailLower, pin);
        }

        if (!employee) {
            // Laatste poging: fallback mapping
            if (this.EMPLOYEES[emailLower]) {
                console.warn('[RobawsAPI] Werknemer niet gevonden via API, fallback naar EMPLOYEES mapping');
                return this._loginFallback(emailLower, pin);
            }
            return { success: false, error: 'Onbekend emailadres' };
        }

        console.log('[RobawsAPI] Werknemer gevonden:', employee.id, employee.firstName, employee.lastName);

        // PIN checken via extra veld "Pincode" (groep "QE Werkbon app", type TEXT)
        const extraFields = employee.extraFields || {};
        console.log('[RobawsAPI] extraFields:', JSON.stringify(extraFields));
        const pinField = extraFields['Pincode'] || null;
        const storedPin = pinField ? String(pinField.stringValue ?? pinField.intValue ?? pinField.value ?? '') : '';
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

        // PIN lokaal cachen voor offline fallback
        await this.setPin(emailLower, pin);
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

    // Fallback login als Robaws onbereikbaar is (gebruikt lokaal gecachte PIN + werknemerdata)
    async _loginFallback(email, pin) {
        // Eerst proberen met lokaal gecachte werknemerdata
        const cached = localStorage.getItem('qe_emp_cache_' + email);
        const emp = this.EMPLOYEES[email];

        // PIN check via lokale cache
        const hasLocalPin = await this.hasPin(email);
        if (hasLocalPin) {
            const ok = await this.verifyPin(email, pin);
            if (!ok) return { success: false, error: 'PIN onjuist' };
        } else if (!cached && !emp) {
            return { success: false, error: 'Geen verbinding met Robaws en geen lokale gegevens' };
        }

        let user;
        if (cached) {
            const c = JSON.parse(cached);
            const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || email;
            const roleKey = (c.planningGroupName || '').toLowerCase();
            const isMonteur = roleKey.includes('monteur');
            const isBureel = roleKey.includes('kantoor') || roleKey.includes('bureel') || roleKey.includes('service');
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
        }

        console.log('[RobawsAPI] Offline fallback login:', user.name);
        localStorage.setItem('qe_user', JSON.stringify(user));
        return { success: true, user };
    },

    // ---- PIN-AUTH (lokaal per toestel) ----
    // Robaws v2 heeft geen password-API, dus we doen PIN-auth lokaal in localStorage.
    // De PIN wordt gehashed bewaard met de email als salt.
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

    // Pre-seed PINs: zet standaard PINs voor alle medewerkers als er
    // nog geen PIN in localStorage staat. Wordt 1x aangeroepen bij app-start.
    seedDefaultPins() {
        const defaults = {
            'qe_pin_glycera@qe.be':             'a54c598cbb607a2623dd1d29368d5aa64229bfc224115d6fea618b2d2e79619e',
            'qe_pin_sascha@qe.be':              '1d432b29e5217c19439da5e02fc8bc81b5006ad09198ff0ffb275557e18f7809',
            'qe_pin_daxleekens@qe.be':          '9b5eac84180accf54ce661a253526459a2251afb6595051f3f3be2b84e3b0864',
            'qe_pin_olivier.puchacz@qe.be':     '8575b1f59819e2a6cb5de911df99f93e9639852cc2999bff0b382562e3654953',
            'qe_pin_yassine@qe.be':             'a9c7fd61e0a48fd12b9afd6ab8e4520989a3fe8491c44a9c0b415dab21408be7',
            'qe_pin_levi@qe.be':                '7dfd3cb772282ee863b8eb04eb539cf56f8e05c5e028bff353edc42151aa74ec',
            'qe_pin_stefan@qe.be':              '3a138748f7cc4993f54392b2d47c985979eb936fcb2b5d6b6ab08cbafeead5e2',
            'qe_pin_jelle@qe.be':               'af2ec424ed0ca866c7bf798f6eb35c04b238d34f25eb2ad573cd3e073f76e5b2',
            'qe_pin_wim@qe.be':                 '66ba111ed4633c1d266166c3c0f6b86a0df4cd239fc0e69ca74a7534e5674e38',
            'qe_pin_jens@qe.be':                '9da1c6b5c705013b0d4255d787ec5e2b35b47d24fcd09082b9e384473631d4dc',
            'qe_pin_herve@qe.be':               '02ab3d13cb03f01497456162a4ef1513927ce6eb3f425e96ca6037136bec2ad6',
            'qe_pin_keng@qe.be':                '78f36df6ef01cd5ebf531ec6327562dd5838ac95fa956e0060e00097817cb5ee',
            'qe_pin_joshua@qe.be':              'f8403d86e335eb67affe196d046aeaa8ad573de187be6f380b40b73e484e6d05',
            'qe_pin_vince@qe.be':               'fb23a739555cf34c451e1445185272a5c1e6bfc30d5d2758196e1ad76ad18cb2',
            'qe_pin_bjorn@qe.be':               '90b30b51a0472f2714bdb1f896403a6b1adfb2921404845eebfddc88c5cd8b21',
            'qe_pin_bart@qe.be':                'd141f2502ee7759d344cea4b9b019957fa61627b0dcf3c969c5a6609d7979c46',
            'qe_pin_felicity@qe.be':            'c2ffea1001f12af0b83e9a00dbd85176f6eedd6ebb62a319a47beb6368d3fbdb',
            'qe_pin_rolf@qe.be':                '97295e4354d4aa98782a29bb40ef2b51c54f4f1a6a5cc8b248a8960728e473cf',
        };
        for (const [key, hash] of Object.entries(defaults)) {
            if (!localStorage.getItem(key)) {
                localStorage.setItem(key, hash);
            }
        }
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
            const res = await this.get(`time-registrations?employeeId=${employeeId}&limit=100&page=${page}&sort=id:desc`);
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
            const res = await this.get(`time-registrations?limit=100&page=${page}&sort=id:desc`);
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
            const res = await this.get(`time-registrations?employeeId=${employeeId}&limit=100&page=${page}&sort=id:desc`);
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
        const today = this._localDateStr();
        const tomorrow = this._localDateStr(null, 1);
        if (date !== today && date !== tomorrow) date = today;

        // Haal planning items op met paginatie
        let allItems = [];
        let page = 0;
        let totalPages = 1;

        do {
            const result = await this.get(
                `planning-items?employeeId=${employeeId}&limit=100&page=${page}&sort=startDate:desc`
            );
            if (result.code !== 200) throw new Error('Kon planning niet ophalen');

            const items = result.data.items || [];
            if (items.length === 0) break;

            allItems = allItems.concat(items);

            // Stop als we voorbij de gewenste datum zijn
            const lastDate = (items[items.length - 1].startDate || '').split('T')[0];
            if (lastDate < today) break;

            totalPages = result.data.totalPages || 1;
            page++;
        } while (page < totalPages);

        // Filter op datum
        let filtered = allItems.filter(item => {
            const itemDate = (item.startDate || '').split('T')[0];
            return itemDate === date;
        });

        // Sorteer op startDate (vroegste eerst)
        filtered.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

        // Check welke planning items al een werkbon hebben van DEZE gebruiker
        const planningIdsMetWerkbon = await this._getPlanningIdsWithWorkOrders(userId);

        // Verrijk elk item met klantgegevens + BTW + ordernummer
        const enriched = [];
        for (const item of filtered) {
            const hasWerkbon = planningIdsMetWerkbon.has(String(item.id));

            // Haal het volledige planning-item op voor de complete description (HTML)
            // Het list-endpoint kapt de description af, het detail-endpoint geeft alles.
            let fullDescription = item.description || item.notes || '';
            try {
                const fullItem = await this.get(`planning-items/${item.id}`);
                if (fullItem.code === 200 && fullItem.data && fullItem.data.description) {
                    fullDescription = fullItem.data.description;
                }
            } catch(e) { /* Fallback naar list-description */ }

            const entry = {
                id: item.id,
                salesOrderId: item.salesOrderId || null,
                clientId: item.clientId || null,
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
                client: null,
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

                        // BTW tarief ophalen
                        if (c.vatTariffId) {
                            try {
                                const vatResult = await this.get(`vat-tariffs/${c.vatTariffId}`);
                                if (vatResult.code === 200) {
                                    entry.client.vatPercentage = vatResult.data.percentage ?? null;
                                    entry.client.vatTariffName = vatResult.data.name ?? null;
                                }
                            } catch (e) { /* BTW niet gevonden, niet erg */ }
                        }
                    }
                } catch (e) { /* Klant niet gevonden */ }
            }

            // Planning line-items ophalen (materialen/artikelen die meegegeven moeten worden)
            try {
                const liRes = await this.get(`planning-items/${item.id}/line-items`);
                if (liRes.code === 200 && liRes.data) {
                    const lineItems = liRes.data.items || liRes.data || [];
                    entry.lineItems = lineItems.map(li => ({
                        id: li.id,
                        description: li.description || '',
                        quantity: li.quantity || 1,
                        unitType: li.unitType || null,
                        type: li.type || 'LINE',
                        articleId: li.articleId || (li.article && li.article.id) || null,
                    }));
                }
            } catch(e) { console.warn('[RobawsAPI] Line-items ophalen mislukt:', e); }

            // Planning documenten/bestanden ophalen
            try {
                const docRes = await this.get(`planning-items/${item.id}/documents`);
                if (docRes.code === 200 && docRes.data) {
                    const docs = Array.isArray(docRes.data) ? docRes.data : (docRes.data.items || []);
                    entry.documents = docs.map(d => ({
                        id: d.id,
                        name: d.name || 'Bestand',
                        contentType: d.contentType || '',
                        size: d.size || 0,
                        url: d.url || d.previewUrl || null,
                    }));
                }
            } catch(e) { console.warn('[RobawsAPI] Documenten ophalen mislukt:', e); }

            // Ordernummer + regie-vinkje ophalen van sales order
            if (item.salesOrderId) {
                try {
                    const soResult = await this.get(`sales-orders/${item.salesOrderId}`);
                    if (soResult.code === 200) {
                        entry.orderLogicId = soResult.data.logicId || null;
                        entry.orderStatus = soResult.data.status || null;
                        // Regie (timeAndMaterial) overnemen van de order
                        entry.timeAndMaterial = soResult.data.timeAndMaterial ?? false;
                    }
                } catch (e) { /* Order niet gevonden */ }
            }

            enriched.push(entry);
        }

        return { items: enriched, date, employeeId };
    },

    async _getPlanningIdsWithWorkOrders(currentUserId = null) {
        // Verzamel planningItemIds waarvoor de HUIDIGE GEBRUIKER al een werkbon heeft.
        // Meerdere techniekers kunnen op hetzelfde planning-item een werkbon indienen —
        // een planning-item verdwijnt alleen voor de technieker wiens werkbon eraan
        // gelinkt is (verantwoordelijke = zichzelf).
        const ids = new Set();
        let page = 0;

        try {
            const sinceDate = this._localDateStr(null, -7);
            do {
                const result = await this.get(`work-orders?limit=100&page=${page}&sort=createdAt:desc`);
                const items = result.data.items || [];
                if (items.length === 0) break;

                let stop = false;
                for (const wo of items) {
                    const woDate = wo.date || '';
                    if (woDate && woDate < sinceDate) { stop = true; break; }
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

                const totalPages = result.data.totalPages || 1;
                page++;
                if (page >= totalPages) break;
                if (page > 10) break;
            } while (true);
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

        // Stap 3: Haal elk artikel op
        const uurcodes = [];
        for (const articleId of timeOperationIds) {
            try {
                const artResult = await this.get(`articles/${articleId}`);
                if (artResult.code === 200) {
                    const art = artResult.data;
                    const name = art.name || `Uurcode ${articleId}`;
                    uurcodes.push({
                        id: art.id,
                        name: name,
                        unitPrice: art.unitPrice ?? null,
                        salePrice: art.salePrice ?? null,
                        costPrice: art.costPrice ?? null,
                        isVerplaatsing: name.toLowerCase().includes('verplaatsing'),
                    });
                }
            } catch (e) {
                console.warn('[RobawsAPI] Artikel', articleId, 'fout:', e.message);
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
        // Probeer eerst op naam te zoeken via de API
        const result = await this.get(`articles?name=${encodeURIComponent(query)}&limit=${limit}`);
        let items = result.data.items || [];

        // Als query een nummer lijkt, ook op articleNumber zoeken
        if (/^\d+/.test(query.trim())) {
            try {
                const numResult = await this.get(`articles?articleNumber=${encodeURIComponent(query.trim())}&limit=${limit}`);
                const numItems = numResult.data.items || [];
                // Merge zonder duplicaten
                const existingIds = new Set(items.map(i => i.id));
                numItems.forEach(i => { if (!existingIds.has(i.id)) items.push(i); });
            } catch(e) {}
        }

        // Client-side fuzzy filter: als minder dan 3 resultaten, zoek ook door cache
        if (items.length < 3 && this._articleCache && this._articleCache.length > 0) {
            const q = query.toLowerCase().trim();
            const words = q.split(/\s+/);
            const fuzzyMatches = this._articleCache.filter(art => {
                const name = (art.name || '').toLowerCase();
                const nr = (art.articleNumber || '').toLowerCase();
                // Elk woord moet voorkomen in naam of artikelnummer
                return words.every(w => name.includes(w) || nr.includes(w));
            }).slice(0, limit);
            const existingIds = new Set(items.map(i => i.id));
            fuzzyMatches.forEach(i => { if (!existingIds.has(i.id)) items.push(i); });
        }

        return items.slice(0, limit);
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

        // Stap 2: POST elke time-entry naar /work-orders/{id}/time-entries
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
                billableHours: (onderhoud && isKlant) ? 0 : this._roundUpHalfHour(hrs),
            };
            if (code && code.id) te.articleId = toStr(code.id);
            // Pauze in minuten meesturen (Robaws veld "breakDuration")
            if (h.pauze && h.pauze > 0) {
                te.breakDuration = h.pauze;
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
        const deltaHours = []; // [{articleId, deltaHours}]
        for (const aId of allArticleIds) {
            const oldH = parseFloat(oldHoursPerArticle[aId] || 0);
            const newH = parseFloat(newHoursPerArticle[aId] || 0);
            const diff = Math.round((newH - oldH) * 100) / 100;
            if (diff !== 0) deltaHours.push({ articleId: aId, deltaHours: diff });
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
            log.push('PUT correctie fout: ' + putResult.code);
        }

        // 6) Delta uren posten
        let timeSuccess = 0;
        const timeErrors = [];
        for (const dh of deltaHours) {
            const te = {
                employeeId: toStr(employeeId),
                hours: dh.deltaHours,
                billableHours: this._roundUpHalfHour(dh.deltaHours),
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
            return this._articleCache;
        }

        this._articleCacheLoading = true;
        const allArticles = [];
        let page = 0;

        try {
            // Eerst totaal opvragen
            const first = await this.get('articles?limit=100&page=0');
            const totalPages = first.data.totalPages || 1;
            const totalItems = first.data.totalItems || 0;
            const firstItems = first.data.items || [];
            allArticles.push(...firstItems);

            if (onProgress) onProgress(firstItems.length, totalItems);

            // Rest ophalen
            for (page = 1; page < totalPages; page++) {
                const result = await this.get(`articles?limit=100&page=${page}`);
                const items = result.data.items || [];
                if (items.length === 0) break;
                allArticles.push(...items);
                if (onProgress) onProgress(allArticles.length, totalItems);
            }

            this._articleCache = allArticles;
        } finally {
            this._articleCacheLoading = false;
        }

        return this._articleCache;
    },

    // =============================================
    // ARTIKELGROEPEN
    // =============================================
    async getArticleGroups() {
        const allGroups = [];
        let page = 0;
        do {
            const result = await this.get(`article-groups?limit=100&page=${page}`);
            const items = result.data.items || result.data || [];
            if (items.length === 0) break;
            allGroups.push(...items);
            const totalPages = result.data.totalPages || 1;
            page++;
            if (page >= totalPages) break;
        } while (true);

        // Filter alleen wappy=true
        const wappyGroups = allGroups.filter(g => g.wappy === true);

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

        let allPlanningen = [];
        let page = 0;
        do {
            const r = await this.get(
                `planning-items?employeeId=${employeeId}&limit=100&page=${page}&sort=startDate:desc`
            );
            if (r.code !== 200) break;
            const items = r.data.items || [];
            if (items.length === 0) break;
            allPlanningen = allPlanningen.concat(items);
            const lastDate = (items[items.length - 1].startDate || '').split('T')[0];
            if (lastDate < sevenDaysAgo) break;
            const totalPages = r.data.totalPages || 1;
            page++;
            if (page >= totalPages || page > 10) break;
        } while (true);

        const planningenInScope = allPlanningen.filter(p => {
            const d = (p.startDate || '').split('T')[0];
            return d >= sevenDaysAgo && d <= today;
        });

        if (planningenInScope.length === 0) return { items: [] };

        // 2. Alle werkbons van afgelopen 7 dagen ophalen → mappen op planningItemId
        const sinceDate = this._localDateStr(null, -7);
        const werkbonsPerPlanning = {};
        let woPage = 0;
        do {
            const r = await this.get(`work-orders?limit=100&page=${woPage}&sort=createdAt:desc`);
            if (r.code !== 200) break;
            const items = r.data.items || [];
            if (items.length === 0) break;
            let stop = false;
            for (const wo of items) {
                const d = wo.date || '';
                if (d && d < sinceDate) { stop = true; break; }
                if (!wo.planningItemId) continue;
                const key = String(wo.planningItemId);
                if (!werkbonsPerPlanning[key]) werkbonsPerPlanning[key] = [];
                werkbonsPerPlanning[key].push(wo);
            }
            if (stop) break;
            const totalPages = r.data.totalPages || 1;
            woPage++;
            if (woPage >= totalPages || woPage > 10) break;
        } while (true);

        // 3. Enkel plannings die al ≥1 werkbon hebben overhouden
        const planningenMetWerkbon = planningenInScope.filter(p => werkbonsPerPlanning[String(p.id)]);

        // 4. Voor elke planning: client + sub-entries van alle linked werkbons sommeren
        const result = [];
        for (const p of planningenMetWerkbon) {
            const wos = werkbonsPerPlanning[String(p.id)] || [];
            // Klant
            let clientName = '', clientAddress = '';
            if (p.clientId) {
                try {
                    const cr = await this.get(`clients/${p.clientId}`);
                    if (cr.code === 200) {
                        clientName = cr.data.name || '';
                        clientAddress = this.formatAddress(cr.data.address);
                    }
                } catch(e) {}
            }
            // Order
            let orderLogicId = null;
            if (p.salesOrderId) {
                try {
                    const sr = await this.get(`sales-orders/${p.salesOrderId}`);
                    if (sr.code === 200) orderLogicId = sr.data.logicId || null;
                } catch(e) {}
            }
            // Sub-entries van elke werkbon
            let totalHours = 0;
            let totalCommute = 0;
            const materialMap = {}; // key = articleId|description → { articleId, description, quantity, unitPrice }
            const remarks = [];
            const sourceWerkbonIds = [];
            // We hebben de uurcode-articleIds nodig om uren te splitsen klant vs verplaatsing
            // → niet beschikbaar zonder employee-rol; we slaan beide totals op en laten UI splitsen op articleId
            const hoursPerArticle = {}; // articleId → totalHours
            for (const wo of wos) {
                sourceWerkbonIds.push(wo.id);
                if (wo.remark && wo.remark.trim()) remarks.push(wo.remark.trim());
                // time-entries
                try {
                    const te = await this.get(`work-orders/${wo.id}/time-entries`);
                    const teItems = (te.data && (te.data.items || te.data)) || [];
                    for (const t of teItems) {
                        const hrs = parseFloat(t.hours || t.billableHours || 0);
                        const aId = String(t.articleId || '');
                        if (!hoursPerArticle[aId]) hoursPerArticle[aId] = 0;
                        hoursPerArticle[aId] += hrs;
                        totalHours += hrs;
                    }
                } catch(e) {}
                // line-items (materialen)
                try {
                    const li = await this.get(`work-orders/${wo.id}/line-items`);
                    const liItems = (li.data && (li.data.items || li.data)) || [];
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
                } catch(e) {}
            }

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

            result.push({
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
            });
        }

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
            const result = await this.get(`work-orders?limit=50&page=${page}&sort=date:desc${userFilter}`);
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
    async createInvoice({ workOrderId, paymentConditionId = '9', vatTariffId = '4',
        clientId: passedClientId = null, companyId: passedCompanyId = null,
        salesOrderId = null, paymentMethod = null, notes = '',
        materials = [], hours = [], onderhoud = false,
        userId = null, installationIds = [] }) {

        const toStr = v => (v == null || v === '') ? null : String(v);

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
            await this.put(`sales-invoices/${invoiceId}`, invFull);
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
                if (dur <= 0 || salePrice <= 0) continue;
                const artKey = h.articleId || '_default';
                if (!hoursByArticle[artKey]) hoursByArticle[artKey] = { totalMinutes: 0, salePrice, articleId: h.articleId };
                hoursByArticle[artKey].totalMinutes += dur;
            }
            // Eén factuurregel per articleId, afgerond op totaal
            for (const [artKey, group] of Object.entries(hoursByArticle)) {
                const rawHrs = Math.round(group.totalMinutes / 60 * 100) / 100;
                const billableHrs = this._roundUpHalfHour(rawHrs);
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
            const vatRates = { '1': 0.21, '2': 0.12, '3': 0, '4': 0.06, '5': 0.21 };
            for (const l of lines) {
                const lineExcl = (Number(l.quantity) || 0) * (Number(l.price) || 0) * (1 - (Number(l.discount) || 0) / 100);
                const tariffKey = String(l.vatTariffId);
                let vatRate = vatRates[tariffKey];
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
        // Overschrijving/Viva wallet = betaald → "Gefactureerd"
        // Cash = moet nagekeken worden → "Nakijken"
        // Niet Ontvangen = laten zoals is
        let newStatus = null;
        if (paymentMethod === 'Overschrijving ter plaatse' || paymentMethod === 'Viva wallet') {
            newStatus = 'gefactureerd';
        }

        if (newStatus) {
            // Werkbon status updaten
            try {
                const woFull = await this.get(`work-orders/${workOrderId}`);
                if (woFull.code === 200 && woFull.data) {
                    woFull.data.status = newStatus;
                    await this.put(`work-orders/${workOrderId}`, woFull.data);
                    console.log(`[RobawsAPI] Werkbon ${workOrderId} status → ${newStatus}`);
                }
            } catch(e) {
                console.warn('[RobawsAPI] Werkbon status updaten mislukt:', e);
            }

            // Sales order status updaten
            if (woSalesOrderId) {
                try {
                    const soFull = await this.get(`sales-orders/${woSalesOrderId}`);
                    if (soFull.code === 200 && soFull.data) {
                        soFull.data.status = newStatus;
                        await this.put(`sales-orders/${woSalesOrderId}`, soFull.data);
                        console.log(`[RobawsAPI] Order ${woSalesOrderId} status → ${newStatus}`);
                    }
                } catch(e) {
                    console.warn('[RobawsAPI] Order status updaten mislukt:', e);
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
    // =============================================
    // TIJDSREGISTRATIE VIA WERKBONNEN (v58+)
    // =============================================

    /** Article-IDs voor uurcodes in Robaws (zie screenshot uurcodes-lijst). */
    WERKUUR_ARTICLE_IDS: {
        monteurProject: 185,    // "Werkuur monteur - Project" - €65 verkoop
        ladenLossen: 19786,     // "Werkuur laden & lossen"     - €0 verkoop
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
        woFull.title = `Tijdsregistratie ${employeeName || ''} - ${dateLabel}`.trim();
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

    /** Update Uitgeklokt-tijd op een tijdsregistratie-werkbon. v59: GET-then-PUT. */
    async setTimeRegistrationUitgeklokt(workOrderId, uitgeklokt) {
        const getRes = await this.get(`work-orders/${workOrderId}`);
        if (getRes.code !== 200 || !getRes.data) {
            throw new Error('GET /work-orders/' + workOrderId + ' faalde (' + getRes.code + ')');
        }
        const wo = getRes.data;
        wo.extraFields = wo.extraFields || {};
        // v60: Variant A — geen type/group, partial PUT zou andere velden wissen
        wo.extraFields['Uitgeklokt'] = { stringValue: uitgeklokt || '' };
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
    async addWorkHoursTimeEntry(opts) {
        const { workOrderId, employeeId, startTime, endTime, breakMinutes, articleId } = opts;
        const te = {
            employeeId: String(employeeId),
            articleId: String(articleId),
        };
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
        // Bereken hours uit start/end - pauze
        if (startTime && endTime) {
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
     * Haal Tijdsregistratie-werkbonnen op voor de huidige user, voor een
     * bepaalde maand (YYYY-MM). Filter op assignedUserId zodat techniekers
     * enkel hun eigen kaarten zien.
     */
    async getMyTimeRegistrationWorkOrders(userId, monthPrefix) {
        // v65: sort=id:desc i.p.v. date:desc — onze migratie-werkbonnen
        // (id 1248+) zijn de meest recent aangemaakte en staan dus vooraan,
        // ongeacht hun werkbon-datum. Bij sort=date:desc stonden toekomstige
        // planning-werkbonnen vooraan en kwam onze 4/5 werkbon niet in de
        // eerste 20 pagina's voor.
        let allItems = [];
        const seenIds = new Set();
        let page = 0;
        const maxPages = 30;  // tot 3000 werkbonnen
        while (page < maxPages) {
            const res = await this.get(`work-orders?limit=100&page=${page}&sort=id:desc`);
            if (res.code !== 200) {
                throw new Error(`Tijdsregistratie-werkbonnen fetch faalde (${res.code})`);
            }
            if (!res.data || !res.data.items || res.data.items.length === 0) break;
            for (const it of res.data.items) {
                if (it.id != null && !seenIds.has(String(it.id))) {
                    seenIds.add(String(it.id));
                    allItems.push(it);
                }
            }
            // Geen date-based early-stop meer; sort=id:desc heeft geen date-volgorde garantie
            page++;
            if (res.data.totalPages && page >= res.data.totalPages) break;
        }
        // Filter: status=Tijdsregistratie EN assignedUser=ingelogde user EN maand klopt
        const filtered = allItems.filter(item => {
            const status = String(item.status || '').toLowerCase();
            if (!status.includes('tijdsregistratie')) return false;
            const dateMonth = (item.date || '').substring(0, 7);
            if (dateMonth !== monthPrefix) return false;
            const itemUserId = item.assignedUserId
                || (item.assignedUser && item.assignedUser.id);
            if (itemUserId && String(itemUserId) !== String(userId)) return false;
            return true;
        });
        console.log('[RobawsAPI] Tijdsregistratie-werkbonnen: ' + allItems.length +
            ' fetched, ' + filtered.length + ' voor user ' + userId + ' in ' + monthPrefix);
        return filtered;
    },

    /**
     * v62: zoek de OPEN tijdsregistratie-werkbon van vandaag voor een user.
     * Robaws is hier leidend — er hoort er maar 1 te zijn per dag per user
     * (status="Tijdsregistratie" + assignedUserId=user + date=today).
     * Returns null als er geen is.
     */
    async getTodaysOpenTimeRegistrationWorkOrder(userId) {
        if (!userId) return null;
        const today = this._localDateStr();
        // Korte fetch — eerste pagina is meestal genoeg
        const res = await this.get('work-orders?limit=100&sort=date:desc');
        if (res.code !== 200 || !res.data || !res.data.items) return null;
        const items = res.data.items.filter(wo => {
            const status = String(wo.status || '').toLowerCase();
            if (!status.includes('tijdsregistratie')) return false;
            if ((wo.date || '').substring(0, 10) !== today) return false;
            const itemUserId = wo.assignedUserId
                || (wo.assignedUser && wo.assignedUser.id);
            return itemUserId && String(itemUserId) === String(userId);
        });
        if (items.length === 0) return null;
        if (items.length > 1) {
            console.warn('[RobawsAPI] Meer dan 1 tijdsregistratie-werkbon vandaag voor user',
                userId, '- nieuwste eerste; ID:', items.map(i => i.id).join(','));
        }
        // Sorteer op id desc — nieuwste werkbon eerst (mocht er per ongeluk dubbel zijn)
        items.sort((a, b) => String(b.id).localeCompare(String(a.id)));
        return items[0];
    },

};
