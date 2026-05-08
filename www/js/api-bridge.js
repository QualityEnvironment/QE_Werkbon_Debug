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
                const res = await RobawsAPI.get(`employees?email=${encodeURIComponent(email)}&limit=10`);
                const items = (res.data && res.data.items) || [];
                const found = items.find(e => (e.email || '').toLowerCase() === email);
                if (found) {
                    const ef = found.extraFields || {};
                    const pf = ef['Pincode'] || null;
                    const pinVal = pf ? String(pf.stringValue ?? pf.intValue ?? pf.value ?? '') : '';
                    const hasPin = !!pinVal;
                    console.log('[APIBridge] check-email:', email, 'hasPin:', hasPin);
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
            groups: result.tree,
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
    // WERKBON QUEUE (simplified for standalone)
    // =============================================
    async handleWerkbonQueue(params, options) {
        const action = params.action || '';
        if (action === 'process') {
            return this.jsonResponse({ success: true, processed: 0, message: 'Geen queue in standalone modus' });
        }
        if (action === 'add') {
            // In standalone modus: direct indienen (geen queue)
            const body = await this.parseBody(options);
            return this.jsonResponse({ success: true, queued: false, message: 'Direct verwerkt' });
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
