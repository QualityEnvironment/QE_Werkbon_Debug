/**
 * QE Werkbon App — API Bridge
 * Onderschept fetch('api/...') calls en routeert ze naar directe JS API modules
 * wanneer er geen PHP server beschikbaar is (APK standalone modus).
 *
 * Dit bestand moet VOOR app.js geladen worden, en NA robaws-api.js + viva-api.js.
 */

const APIBridge = {
    // Detecteer of we in standalone modus draaien (file:// of geen server)
    isStandalone: window.location.protocol === 'file:',

    // Override de globale fetch functie
    init() {
        if (!this.isStandalone) return; // Op server: gewoon fetch gebruiken

        const originalFetch = window.fetch.bind(window);
        const bridge = this;

        window.fetch = function(url, options = {}) {
            // Alleen api/*.php calls onderscheppen
            if (typeof url === 'string' && url.startsWith('api/')) {
                return bridge.handleApiCall(url, options);
            }
            // Alle andere calls normaal doorsturen
            return originalFetch(url, options);
        };

        console.log('[APIBridge] Standalone modus actief — API calls worden lokaal afgehandeld');
    },

    // Maak een nep Response object (zoals fetch zou returnen)
    jsonResponse(data, status = 200) {
        return Promise.resolve(new Response(JSON.stringify(data), {
            status,
            headers: { 'Content-Type': 'application/json' },
        }));
    },

    // Parse JSON body van een POST request
    async parseBody(options) {
        if (options.body) {
            if (typeof options.body === 'string') return JSON.parse(options.body);
            if (options.body instanceof FormData) return null; // FormData apart behandelen
        }
        return {};
    },

    // Hoofd-router
    async handleApiCall(url, options) {
        const urlObj = new URL(url, 'http://localhost');
        const path = urlObj.pathname.replace(/^\//, '');
        const params = Object.fromEntries(urlObj.searchParams);
        const method = (options.method || 'GET').toUpperCase();

        try {
            // === AUTH ===
            if (path === 'api/auth.php') {
                return this.handleAuth(params, options);
            }

            // === PROFIEL ===
            if (path === 'api/profile.php') {
                return this.handleProfile(params, options);
            }

            // === PLANNING ===
            if (path === 'api/planning.php') {
                return this.handlePlanning(params);
            }

            // === HOUR TYPES ===
            if (path === 'api/hour-types.php') {
                return this.handleHourTypes();
            }

            // === INSTALLATIONS ===
            if (path === 'api/installations.php') {
                return this.handleInstallations(params);
            }

            // === ARTICLES ===
            if (path === 'api/articles.php') {
                return this.handleArticles(params);
            }
            if (path === 'api/articles-all.php') {
                return this.handleArticlesAll();
            }
            if (path === 'api/article-groups.php') {
                return this.handleArticleGroups();
            }
            if (path === 'api/articles-by-group.php') {
                return this.handleArticlesByGroup(params);
            }

            // === WERKBON ===
            if (path === 'api/werkbon.php') {
                return this.handleWerkbon(options);
            }

            // === UPLOAD PHOTO ===
            if (path === 'api/upload-photo.php') {
                return this.handleUploadPhoto(options);
            }

            // === WERKBON QUEUE ===
            if (path === 'api/werkbon-queue.php') {
                return this.handleWerkbonQueue(params, options);
            }

            // === SYNC ===
            if (path === 'api/sync.php') {
                return this.jsonResponse({ success: true, message: 'Sync niet nodig in standalone modus' });
            }

            // === SIGNATURE ===
            if (path === 'api/sign-werkbon.php') {
                return this.handleSignature(options);
            }

            // === CREATE INVOICE ===
            if (path === 'api/create-invoice.php') {
                return this.handleCreateInvoice(options);
            }

            // === PAYMENT ===
            if (path === 'api/payment.php') {
                return this.handlePayment(params, options);
            }

            // === UITGEVOERD (oude endpoint, behouden voor compat) ===
            if (path === 'api/uitgevoerd.php') {
                const user = RobawsAPI.getLoggedInUser();
                if (!user) return this.jsonResponse({ error: 'Niet ingelogd' }, 401);
                const result = await RobawsAPI.getUitgevoerd(user.robawsUserId || user.robawsEmployeeId);
                return this.jsonResponse(result);
            }

            // === UITGEVOERDE PLANNINGEN (correctie-tool) ===
            if (path === 'api/uitgevoerd-planningen.php') {
                const user = RobawsAPI.getLoggedInUser();
                if (!user) return this.jsonResponse({ error: 'Niet ingelogd' }, 401);
                const result = await RobawsAPI.getUitgevoerdPlanningen(
                    user.robawsEmployeeId,
                    user.robawsUserId
                );
                return this.jsonResponse(result);
            }


            console.warn('[APIBridge] Onbekende API call:', path);
            return this.jsonResponse({ error: 'Onbekend endpoint: ' + path }, 404);

        } catch (e) {
            console.error('[APIBridge] Fout bij', path, e);
            return this.jsonResponse({ error: e.message }, 500);
        }
    },

    // =============================================
    // AUTH
    // =============================================
    async handleAuth(params, options) {
        const action = params.action || '';

        if (action === 'check') {
            const user = RobawsAPI.getLoggedInUser();
            if (user) {
                // Als robawsUserId nog ontbreekt (oude sessies of login waarbij
                // /users niet bereikbaar was), probeer hem alsnog op te halen
                // zodat werkbonnen niet zonder verantwoordelijke ingediend worden.
                if (!user.robawsUserId && user.robawsEmployeeId) {
                    try {
                        const resolved = await RobawsAPI.ensureUserId();
                        if (resolved) user.robawsUserId = resolved;
                    } catch(e) { /* offline → laat null staan, submit-tijd doet retry */ }
                }
                return this.jsonResponse({ loggedIn: true, user });
            }
            return this.jsonResponse({ loggedIn: false });
        }

        // Stap 1 van de PIN-flow: kijk of een email bekend is + heeft deze een PIN in Robaws?
        if (action === 'check-email') {
            const body = await this.parseBody(options);
            const email = (body.email || '').toLowerCase().trim();
            // Via Robaws checken — lijst-endpoint bevat extraFields
            try {
                let found = null;
                const res = await RobawsAPI.get(`employees?email=${encodeURIComponent(email)}&limit=10`);
                const items = (res.data && res.data.items) || [];
                found = items.find(e => (e.email || '').toLowerCase() === email);
                // v132: tweede poging — sommige werknemers worden niet via ?email
                // filter teruggegeven (case/encoding-verschillen). Doorblader alle.
                if (!found) {
                    let page = 0;
                    const all = [];
                    do {
                        const r2 = await RobawsAPI.get(`employees?limit=100&page=${page}`);
                        const it2 = (r2.data && r2.data.items) || [];
                        if (it2.length === 0) break;
                        all.push(...it2);
                        page++;
                        if (page >= (r2.data.totalPages || 1)) break;
                    } while (page < 5);
                    found = all.find(e => (e.email || '').toLowerCase() === email);
                }
                // v136: derde poging — directe lookup via EMPLOYEES mapping
                // (voor wanneer Robaws-email afwijkt van de getypte email,
                // bv. dax.leekens@qe.be vs daxleekens@qe.be).
                if (!found) {
                    const mapped = RobawsAPI.EMPLOYEES[email];
                    if (mapped && mapped.employeeId) {
                        try {
                            const direct = await RobawsAPI.get(`employees/${mapped.employeeId}`);
                            if (direct.code === 200 && direct.data) {
                                found = direct.data;
                                console.log('[APIBridge] check-email: gevonden via directe lookup id=' + mapped.employeeId);
                            }
                        } catch(_) {}
                    }
                }
                if (found) {
                    // v134: cache het gevonden employee object voor 5 min zodat
                    // login() geen tweede zoektocht moet doen (voorkomt Robaws
                    // rate-limit voor werknemers waar ?email= filter niet werkt
                    // en pagination nodig is — typisch techniekers).
                    try {
                        localStorage.setItem('qe_login_emp_cache_' + email,
                            JSON.stringify({ at: Date.now(), emp: found }));
                    } catch(_) {}
                    // v132: PIN-detectie robuuster — probeer meerdere veld-namen +
                    // value-types omdat admin de PIN handmatig in Robaws kan
                    // hebben ingegeven onder een afwijkende key.
                    const ef = found.extraFields || {};
                    let pinVal = '';
                    const tryKeys = ['Pincode', 'PIN', 'Pin', 'pincode', 'pin'];
                    for (const k of tryKeys) {
                        const pf = ef[k];
                        if (!pf) continue;
                        const v = pf.stringValue ?? pf.intValue ?? pf.value ?? pf.numberValue ?? null;
                        if (v != null && String(v).trim()) { pinVal = String(v).trim(); break; }
                    }
                    // Last resort — scan alle extraFields op key die "pin" bevat
                    if (!pinVal) {
                        for (const [k, pf] of Object.entries(ef)) {
                            if (!/pin/i.test(k)) continue;
                            const v = pf && (pf.stringValue ?? pf.intValue ?? pf.value ?? pf.numberValue);
                            if (v != null && String(v).trim()) { pinVal = String(v).trim(); break; }
                        }
                    }
                    const hasPin = !!pinVal;
                    console.log('[APIBridge] check-email:', email, 'hasPin:', hasPin, 'extraFields keys:', Object.keys(ef));
                    return this.jsonResponse({ known: true, hasPin });
                }
            } catch(e) {
                // Robaws onbereikbaar → fallback naar lokale mapping + lokale PIN cache
                const knownLocal = !!RobawsAPI.EMPLOYEES[email];
                if (knownLocal) {
                    const hasLocalPin = await RobawsAPI.hasPin(email);
                    return this.jsonResponse({ known: true, hasPin: hasLocalPin });
                }
            }
            // Laatste fallback: lokale mapping
            const knownLocal = !!RobawsAPI.EMPLOYEES[email];
            if (knownLocal) {
                const hasLocalPin = await RobawsAPI.hasPin(email);
                return this.jsonResponse({ known: true, hasPin: hasLocalPin });
            }
            return this.jsonResponse({ known: false }, 200);
        }

        // Stap 2: login met PIN — alles via Robaws (PIN uit extra veld op werknemer)
        if (action === 'login') {
            const body = await this.parseBody(options);
            const email = (body.email || '').toLowerCase().trim();
            const pin = String(body.pin || body.newPin || body.password || '');

            const result = await RobawsAPI.login(email, pin);
            if (!result.success) {
                return this.jsonResponse({ success: false, error: result.error }, 401);
            }
            return this.jsonResponse({ success: true, user: result.user });
        }

        if (action === 'change-pin') {
            const body = await this.parseBody(options);
            const user = RobawsAPI.getLoggedInUser();
            if (!user) return this.jsonResponse({ error: 'Niet ingelogd' }, 401);
            const result = await RobawsAPI.changePin(user.email, String(body.oldPin || ''), String(body.newPin || ''));
            if (!result.success) return this.jsonResponse({ success: false, error: result.error }, 400);
            return this.jsonResponse({ success: true });
        }

        if (action === 'logout') {
            RobawsAPI.logout();
            return this.jsonResponse({ success: true });
        }

        return this.jsonResponse({ error: 'Onbekende auth actie' }, 400);
    },

    // =============================================
    // PROFILE
    // =============================================
    async handleProfile(params, options) {
        const action = params.action || '';
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return this.jsonResponse({ error: 'Niet ingelogd' }, 401);

        if (action === 'get-avatar') {
            // Cache-first: voorheen werd ALTIJD Robaws aangeroepen wat traag is
            // en onnodig data verbruikt. Nu gebruiken we de lokale cache als
            // primaire bron. De cache wordt vernieuwd:
            //   - bij elke succesvolle login (RobawsAPI.refreshAvatarFromRobaws)
            //   - bij upload van een nieuwe foto via set-avatar
            //   - bij expliciete refresh via action=force-refresh-avatar
            const local = RobawsAPI.getLocalAvatar(user.email);
            if (local) {
                return this.jsonResponse({ avatar: local, dataUrl: local, source: 'local' });
            }
            // Geen lokale cache (eerste app-start of cache gewist) → eenmalig
            // Robaws proberen om de cache te vullen.
            try {
                const blob = await RobawsAPI.getEmployeePhotoBlob(user.robawsEmployeeId);
                if (blob) {
                    const dataUrl = await new Promise(res => {
                        const r = new FileReader();
                        r.onload = () => res(r.result);
                        r.readAsDataURL(blob);
                    });
                    const cached = await RobawsAPI.cacheAvatarFromDataUrl(user.email, dataUrl) || dataUrl;
                    return this.jsonResponse({ avatar: cached, dataUrl: cached, source: 'robaws' });
                }
            } catch(e) { /* offline of geen avatar in Robaws */ }
            return this.jsonResponse({ avatar: null, dataUrl: null });
        }

        if (action === 'force-refresh-avatar') {
            // Expliciete refresh — gebruikt door RobawsAPI.refreshAvatarFromRobaws
            // (na login) en kan ook gebruikt worden voor een handmatige
            // "vernieuw foto"-knop in de profielpagina.
            try {
                const blob = await RobawsAPI.getEmployeePhotoBlob(user.robawsEmployeeId);
                if (blob) {
                    const dataUrl = await new Promise(res => {
                        const r = new FileReader();
                        r.onload = () => res(r.result);
                        r.readAsDataURL(blob);
                    });
                    const cached = await RobawsAPI.cacheAvatarFromDataUrl(user.email, dataUrl) || dataUrl;
                    return this.jsonResponse({ avatar: cached, dataUrl: cached, source: 'robaws', refreshed: true });
                }
                // Geen foto meer in Robaws → wis ook lokale cache
                RobawsAPI.clearLocalAvatar && RobawsAPI.clearLocalAvatar(user.email);
                return this.jsonResponse({ avatar: null, dataUrl: null, refreshed: true });
            } catch(e) {
                // Bij netwerkfout: laat lokale cache staan, return wat we hebben
                const local = RobawsAPI.getLocalAvatar(user.email);
                return this.jsonResponse({
                    avatar: local || null,
                    dataUrl: local || null,
                    source: local ? 'local' : null,
                    error: 'refresh mislukt: ' + e.message,
                });
            }
        }

        if (action === 'set-avatar') {
            const body = await this.parseBody(options);
            const dataUrl = body.dataUrl || '';
            if (!dataUrl) return this.jsonResponse({ success: false, error: 'Geen foto' }, 400);
            // Lokaal direct cachen als 256x256 thumbnail (past gegarandeerd
            // in localStorage; voorkomt quota-fouten bij grote foto's).
            // De Robaws-upload hieronder krijgt de oorspronkelijke dataUrl.
            const cachedDataUrl = await RobawsAPI.cacheAvatarFromDataUrl(user.email, dataUrl) || dataUrl;
            // Naar Robaws sturen
            try {
                const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                const binary = atob(base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const ct = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
                const ext = ct === 'image/png' ? 'png' : 'jpg';
                const blob = new Blob([bytes], { type: ct });

                // BUG-fix: vroeger heetten alle uploads 'Foto.jpg', waardoor
                // je in Robaws niet kon zien welke de nieuwste was. Nu zetten
                // we een ISO-timestamp in de filename (sorteert chronologisch).
                // Format: Foto_2026-05-05_15-30-45.jpg
                const now = new Date();
                const pad = n => String(n).padStart(2, '0');
                const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}` +
                           `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
                const fileName = `Foto_${ts}.${ext}`;

                const file = new File([blob], fileName, { type: ct });
                const upRes = await RobawsAPI.uploadEmployeePhoto(user.robawsEmployeeId, file, fileName);
                const ok = upRes && (upRes.code === 200 || upRes.code === 201);
                if (!ok) {
                    return this.jsonResponse({ success: false, error: 'Robaws weigerde de upload (code ' + (upRes?.code || '?') + ')', avatar: dataUrl });
                }
                // Return de gecachete (kleinere) dataUrl zodat de UI de
                // identieke foto toont als bij volgende refresh uit cache.
                return this.jsonResponse({ success: true, robawsCode: upRes.code, avatar: cachedDataUrl, dataUrl: cachedDataUrl, fileName });
            } catch(e) {
                return this.jsonResponse({ success: false, error: 'Upload naar Robaws mislukt: ' + e.message, avatar: cachedDataUrl });
            }
        }

        return this.jsonResponse({ error: 'Onbekende profile actie' }, 400);
    },

    // =============================================
    // PLANNING
    // =============================================
    async handlePlanning(params) {
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return this.jsonResponse({ error: 'Niet ingelogd' }, 401);

        const date = params.date || RobawsAPI._localDateStr();
        const result = await RobawsAPI.getPlanning(user.robawsEmployeeId, date, user.robawsUserId);
        return this.jsonResponse(result);
    },

    // =============================================
    // HOUR TYPES
    // =============================================
    async handleHourTypes() {
        const user = RobawsAPI.getLoggedInUser();
        if (!user) return this.jsonResponse({ error: 'Niet ingelogd' }, 401);
        const result = await RobawsAPI.getHourTypes(user.robawsEmployeeId);
        return this.jsonResponse(result);
    },

    // =============================================
    // INSTALLATIONS
    // =============================================
    async handleInstallations(params) {
        const action = params.action || '';
        if (action === 'byIds' && params.ids) {
            const ids = params.ids.split(',');
            const items = await RobawsAPI.getInstallations(null, ids);
            return this.jsonResponse({ items });
        }
        if (action === 'byClient' && params.clientId) {
            const items = await RobawsAPI.getInstallations(params.clientId, null);
            return this.jsonResponse({ items });
        }
        if (action === 'documents' && params.id) {
            try {
                const result = await RobawsAPI.get(`installations/${params.id}/documents`);
                return this.jsonResponse(result.data || { items: [] });
            } catch(e) {
                return this.jsonResponse({ items: [] });
            }
        }
        return this.jsonResponse({ items: [] });
    },

    // =============================================
    // ARTICLES
    // =============================================
    async handleArticles(params) {
        if (params.action === 'search' && params.name) {
            const items = await RobawsAPI.searchArticles(params.name, parseInt(params.limit) || 20);
            return this.jsonResponse({ items });
        }
        return this.jsonResponse({ items: [] });
    },

    async handleArticlesAll() {
        const allArticles = await RobawsAPI._loadAllArticles();
        return this.jsonResponse({ items: allArticles, total: allArticles.length });
    },

    async handleArticleGroups() {
        const result = await RobawsAPI.getArticleGroups();
        return this.jsonResponse({
            groups: result.all,
            allGroups: result.all,
            count: result.all.length,
        });
    },

    async handleArticlesByGroup(params) {
        if (!params.groupId) return this.jsonResponse({ items: [] });
        const items = await RobawsAPI.getArticlesByGroup(params.groupId);
        return this.jsonResponse({ items });
    },

    // =============================================
    // WERKBON
    // =============================================
    async handleWerkbon(options) {
        const body = await this.parseBody(options);
        if (!body) return this.jsonResponse({ error: 'Geen body' }, 400);

        const user = RobawsAPI.getLoggedInUser();
        if (!user) return this.jsonResponse({ error: 'Niet ingelogd' }, 401);

        // Voeg user info toe aan body
        body.employeeId = user.robawsEmployeeId;
        body.userId = user.robawsUserId;

        const result = await RobawsAPI.submitWerkbon(body);
        // v206: stond ditzelfde planning-item nog in de offline-wachtrij,
        // dan vervangt deze live submit die entry (anders zou de queue hem
        // later alsnog versturen → dubbele werkbon).
        if (result && result.success) {
            this._dropQueuedWerkbon(body.planningItemId, body.date);
        }
        return this.jsonResponse(result);
    },

    // =============================================
    // UPLOAD PHOTO
    // =============================================
    async handleUploadPhoto(options) {
        const body = await this.parseBody(options);
        if (!body || !body.workOrderId || !body.photos) {
            return this.jsonResponse({ error: 'workOrderId en photos zijn verplicht' }, 400);
        }
        const result = await RobawsAPI.uploadPhotos(body.workOrderId, body.photos);
        return this.jsonResponse(result);
    },

    // =============================================
    // WERKBON QUEUE — v206: ECHTE offline-wachtrij
    // ---------------------------------------------
    // Voorheen deed 'add' niets met de payload maar gaf wél {success:true}
    // terug → de app toonde "in wachtrij geplaatst" en wiste de invoer,
    // terwijl de werkbon definitief verloren was (audit-bevinding K20).
    // Nu: 'add' bewaart de volledige payload (incl. foto's, handtekening en
    // eenmalige artikels) in localStorage; 'process' verstuurt ze zodra er
    // verbinding is: werkbon → foto's → handtekening → custom line-items →
    // bureel-taak ("factuur nog aanmaken"). Entries worden NOOIT stil
    // gedropt; bij falen blijven ze staan met attempts/lastError.
    // =============================================
    _QUEUE_KEY: 'qe_werkbon_queue_v2',
    _queueProcessing: false,

    _readWerkbonQueue() {
        try {
            const a = JSON.parse(localStorage.getItem(this._QUEUE_KEY) || '[]');
            return Array.isArray(a) ? a : [];
        } catch (_) { return []; }
    },
    _writeWerkbonQueue(q) {
        localStorage.setItem(this._QUEUE_KEY, JSON.stringify(q));
    },
    /** v206: queue-entry voor dit planning-item verwijderen (na live submit
     *  vervangt de live werkbon de gequeue'de versie → geen duplicaat). */
    _dropQueuedWerkbon(planningItemId, date) {
        try {
            const q = this._readWerkbonQueue();
            const left = q.filter(e => {
                const p = e.payload || {};
                return !(String(p.planningItemId) === String(planningItemId) &&
                         (!date || p.date === date));
            });
            if (left.length !== q.length) this._writeWerkbonQueue(left);
        } catch (_) {}
    },

    async handleWerkbonQueue(params, options) {
        const action = params.action || '';

        if (action === 'add') {
            const body = await this.parseBody(options);
            if (!body || !body.planningItemId) {
                return this.jsonResponse({ success: false, queued: false, error: 'Ongeldige werkbon-payload' }, 400);
            }
            const key = String(body.planningItemId) + '|' + (body.date || '');
            // Dedup: zelfde planning-item + datum → nieuwste versie wint
            const filtered = this._readWerkbonQueue().filter(e => e.key !== key);
            const entry = { key, queuedAt: Date.now(), attempts: 0, lastError: null, payload: body };
            filtered.push(entry);
            let photosDropped = false;
            try {
                this._writeWerkbonQueue(filtered);
            } catch (e) {
                // localStorage vol (foto's zijn groot): bewaar zonder foto's,
                // maar meld dat EERLIJK aan de app i.p.v. stil te slikken.
                try {
                    entry.payload = Object.assign({}, body, { photos: [] });
                    entry.photosDropped = true;
                    photosDropped = true;
                    this._writeWerkbonQueue(filtered);
                } catch (e2) {
                    return this.jsonResponse({ success: false, queued: false,
                        error: 'Offline-opslag vol — werkbon kon niet bewaard worden' }, 507);
                }
            }
            return this.jsonResponse({ success: true, queued: true, photosDropped, count: filtered.length });
        }

        if (action === 'process') {
            // v207: geen navigator.onLine-gate — die is in de Android-WebView
            // onbetrouwbaar (blijft vaak true in vliegtuigmodus en kan ook
            // vals op false blijven hangen). Echt offline → de submits falen
            // gewoon snel met een netwerkfout en de entries blijven staan.
            if (this._queueProcessing) {
                return this.jsonResponse({ success: true, processed: 0, failed: 0, busy: true,
                    remaining: this._readWerkbonQueue().length });
            }
            this._queueProcessing = true;
            let processed = 0, failed = 0;
            const errors = [];
            try {
                const snapshot = this._readWerkbonQueue();
                for (const entry of snapshot) {
                    try {
                        const p = Object.assign({}, entry.payload || {});
                        // User-info aanvullen zoals handleWerkbon dat doet
                        const user = RobawsAPI.getLoggedInUser();
                        if (user) {
                            if (!p.employeeId) p.employeeId = user.robawsEmployeeId;
                            if (!p.userId) p.userId = user.robawsUserId;
                        }
                        const photos = p.photos || [];
                        const signatureData = p.signatureData || null;
                        const signatureName = p.signatureName || '';
                        const customArticles = p.customArticles || [];
                        delete p.photos; delete p.signatureData;
                        delete p.signatureName; delete p.customArticles;

                        const result = await RobawsAPI.submitWerkbon(p);
                        if (!result || !result.success || !result.workOrderId) {
                            throw new Error((result && result.error) || 'submitWerkbon faalde');
                        }
                        const workOrderId = result.workOrderId;

                        // Bijlagen: best-effort. De werkbon staat al in Robaws —
                        // opnieuw proberen zou een duplicaat maken, dus fouten
                        // hier gaan mee in de bureel-taak i.p.v. de entry te
                        // laten staan.
                        const naFouten = [];
                        if (photos.length) {
                            try { await RobawsAPI.uploadPhotos(workOrderId, photos); }
                            catch (e) { naFouten.push('foto\'s: ' + (e && e.message)); }
                        }
                        if (signatureData) {
                            try { await RobawsAPI.uploadSignature({ workOrderId, signatureName, signatureData }); }
                            catch (e) { naFouten.push('handtekening: ' + (e && e.message)); }
                        }
                        for (const m of customArticles) {
                            try {
                                await RobawsAPI.post('work-orders/' + workOrderId + '/line-items', {
                                    type: 'LINE',
                                    description: m.name || 'Eenmalig artikel',
                                    quantity: parseFloat(m.quantity || 1),
                                    price: parseFloat(m.salePrice ?? m.unitPrice ?? 0),
                                });
                            } catch (e) { naFouten.push('eenmalig artikel "' + (m.name || '?') + '": ' + (e && e.message)); }
                        }
                        // Bureel-taak: offline werkbonnen krijgen geen factuur in
                        // de automatische verwerking → bureel moet opvolgen.
                        try {
                            await RobawsAPI.createTaskForWorkOrder(workOrderId, {
                                title: 'Offline werkbon verwerkt - factuur nog aanmaken',
                                description: 'Deze werkbon is offline ingevuld en automatisch verstuurd ' +
                                    'zodra er terug verbinding was. Er is GEEN factuur aangemaakt.' +
                                    (customArticles.length ? ' Er zijn ook eenmalige artikels die in Robaws aangemaakt moeten worden.' : '') +
                                    (naFouten.length ? '\n\nNiet gelukt bij automatische verwerking: ' + naFouten.join('; ') : '') +
                                    '\n\nGelieve op te volgen.',
                                assignedUserId: 5,
                            });
                        } catch (e) { console.warn('[Queue] bureel-taak mislukt:', e && e.message); }

                        // Entry pas verwijderen NA geslaagde submit
                        this._writeWerkbonQueue(this._readWerkbonQueue().filter(x => x.key !== entry.key));
                        processed++;
                    } catch (e) {
                        failed++;
                        const naam = (entry.payload && entry.payload.clientName) || entry.key;
                        errors.push(naam + ': ' + (e && e.message));
                        const q2 = this._readWerkbonQueue();
                        const it = q2.find(x => x.key === entry.key);
                        if (it) {
                            it.attempts = (it.attempts || 0) + 1;
                            it.lastError = String((e && e.message) || e);
                            this._writeWerkbonQueue(q2);
                        }
                    }
                }
            } finally {
                this._queueProcessing = false;
            }
            return this.jsonResponse({ success: true, processed, failed,
                remaining: this._readWerkbonQueue().length, errors });
        }

        if (action === 'count') {
            return this.jsonResponse({ success: true, count: this._readWerkbonQueue().length });
        }

        return this.jsonResponse({ success: true });
    },

    // =============================================
    // SIGNATURE
    // =============================================
    async handleSignature(options) {
        const body = await this.parseBody(options);
        if (!body || !body.workOrderId) {
            return this.jsonResponse({ error: 'workOrderId is verplicht' }, 400);
        }
        const result = await RobawsAPI.uploadSignature(body);
        return this.jsonResponse(result);
    },

    // =============================================
    // CREATE INVOICE
    // =============================================
    async handleCreateInvoice(options) {
        const body = await this.parseBody(options);
        if (!body || !body.workOrderId) {
            return this.jsonResponse({ error: 'workOrderId is verplicht' }, 400);
        }
        const result = await RobawsAPI.createInvoice(body);
        return this.jsonResponse(result);
    },

    // =============================================
    // PAYMENT (Viva Wallet)
    // =============================================
    async handlePayment(params, options) {
        const action = params.action || 'status';

        if (action === 'status') {
            const result = await VivaAPI.checkStatus();
            return this.jsonResponse(result);
        }

        if (action === 'create-order') {
            const body = await this.parseBody(options);
            const result = await VivaAPI.createOrder(body);
            if (result.success) return this.jsonResponse(result);
            return this.jsonResponse(result, 500);
        }

        if (action === 'terminal-payment') {
            const body = await this.parseBody(options);
            const result = await VivaAPI.terminalPayment(body);
            if (result.success) return this.jsonResponse(result);
            return this.jsonResponse(result, 500);
        }

        if (action === 'check-status') {
            const result = await VivaAPI.checkPaymentStatus(params.orderCode);
            return this.jsonResponse(result);
        }

        if (action === 'find-by-ref') {
            const ref = params.ref || params.clientTransactionId || '';
            const result = await VivaAPI.findTransactionByClientRef(ref);
            return this.jsonResponse(result);
        }

        if (action === 'mark-paid') {
            const body = await this.parseBody(options);
            if (!body.invoiceId) return this.jsonResponse({ error: 'invoiceId is verplicht' }, 400);
            const result = await RobawsAPI.markInvoicePaid(body.invoiceId);
            return this.jsonResponse(result);
        }

        return this.jsonResponse({ error: 'Ongeldige actie' }, 400);
    },
};

// Auto-initialisatie
APIBridge.init();
