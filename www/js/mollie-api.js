/* ============================================================
 * QE Werkbon — Mollie Tap-to-Pay integratie (v139)
 * ------------------------------------------------------------
 * Flow:
 *   1. createPosPayment(amountCents, description, workOrderId)
 *      → POST /v2/payments met method=pointofsale + terminalId
 *      → Mollie returnt een tr_xxx ID + _links.checkout URL
 *   2. App launcht de checkout URL via Java-bridge openMollieTap()
 *   3. Mollie Tap-app: klant tikt NFC kaart
 *   4. Mollie redirect terug naar qewerkbondebug://payment-return?id=tr_xxx
 *   5. MainActivity.onNewIntent → JS app.onMolliePaymentReturn(url)
 *   6. JS polled GET /v2/payments/tr_xxx tot status definitief is
 *
 * Credentials staan hardcoded — Mollie test-omgeving, niet kritiek
 * voor security. Voor live deployment moeten ze server-side gemoved
 * worden, maar voor in-house gebruik is hardcoded acceptabel.
 * ============================================================ */

const MollieAPI = {
    // === CREDENTIALS — Test omgeving ===
    API_BASE:    'https://api.mollie.com/v2',
    API_KEY:     'test_BPDStCB4QHfGzR8gVgFttHebsdWyTn',
    PROFILE_ID:  'pfl_F9o2anpX8f',
    TERMINAL_ID: 'term_dL2X7EqP4unuGkUKTf6RJ',

    // POS-credentials per package (debug vs release)
    // We detecteren runtime via getPackageName() of de debug-build draait.
    POS_DEBUG_ID:     'possecr_4imehLQB8HPAAEBNpiQRJ',
    POS_DEBUG_SECRET: 'SpfeJ9adGUSv8cQHWetcpjrw2ytaB8PG',
    POS_RELEASE_ID:     'possecr_3EkteYDQo25DZEJ3kiQRJ',
    POS_RELEASE_SECRET: 'gxr7bnzwR8K4GBdKt8ru3x2M2geV7KFz',

    /** Bepaal of we in een debug-build draaien (package eindigt op .debug). */
    _isDebugBuild() {
        try {
            if (typeof QEBridge !== 'undefined' && QEBridge.getApkVersionName) {
                const v = QEBridge.getApkVersionName() || '';
                return v.toLowerCase().includes('debug');
            }
        } catch(_) {}
        // Fallback: assume debug (we zijn in dev)
        return true;
    },

    getPosCredentials() {
        return this._isDebugBuild()
            ? { id: this.POS_DEBUG_ID, secret: this.POS_DEBUG_SECRET }
            : { id: this.POS_RELEASE_ID, secret: this.POS_RELEASE_SECRET };
    },

    /** Bearer Authorization headers voor Mollie REST API. */
    _headers() {
        return {
            'Authorization': 'Bearer ' + this.API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
    },

    /** Custom redirect URI — komt overeen met manifest intent-filter scheme. */
    _redirectUri() {
        // Beide schemes worden door MainActivity opgevangen; debug-app heeft
        // alleen `qewerkbondebug` geregistreerd, release zou `qewerkbon` hebben.
        return this._isDebugBuild()
            ? 'qewerkbondebug://payment-return'
            : 'qewerkbon://payment-return';
    },

    /**
     * Stap 1: Maak een Point-of-Sale payment aan. Returns het volledige
     * Mollie Payment object met id en _links.checkout.
     */
    async createPosPayment({ amountCents, description, workOrderId }) {
        if (!amountCents || amountCents <= 0) {
            throw new Error('Bedrag moet > 0 zijn');
        }
        const value = (amountCents / 100).toFixed(2);
        const body = {
            amount: { value, currency: 'EUR' },
            description: String(description || 'QE Werkbon betaling').slice(0, 255),
            method: 'pointofsale',
            terminalId: this.TERMINAL_ID,
            redirectUrl: this._redirectUri(),
            profileId: this.PROFILE_ID,
            metadata: {
                workOrderId: String(workOrderId || ''),
                source: 'qe-werkbon-app',
            },
        };
        console.log('[Mollie] createPosPayment:', body);
        const res = await fetch(this.API_BASE + '/payments', {
            method: 'POST',
            headers: this._headers(),
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const msg = (data && data.detail) || (data && data.title) || ('HTTP ' + res.status);
            console.warn('[Mollie] createPosPayment faalde:', msg, data);
            throw new Error('Mollie: ' + msg);
        }
        console.log('[Mollie] payment aangemaakt:', data.id, 'status:', data.status);
        return data;
    },

    /** Stap 6: Haal de huidige status van een payment op. */
    async getPaymentStatus(paymentId) {
        if (!paymentId) throw new Error('paymentId ontbreekt');
        const res = await fetch(this.API_BASE + '/payments/' + encodeURIComponent(paymentId), {
            headers: this._headers(),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const msg = (data && data.detail) || ('HTTP ' + res.status);
            throw new Error('Mollie status: ' + msg);
        }
        return data;
    },

    /**
     * Poll tot de payment status definitief is (paid/failed/canceled/expired).
     * onUpdate(status) wordt elke poll-iteratie aangeroepen zodat UI kan updaten.
     * Returns het finale payment-object.
     */
    async pollUntilFinal(paymentId, { maxSeconds = 180, intervalMs = 2000, onUpdate } = {}) {
        const FINAL_STATUSES = ['paid', 'failed', 'canceled', 'expired'];
        const deadline = Date.now() + (maxSeconds * 1000);
        let lastStatus = null;
        while (Date.now() < deadline) {
            try {
                const p = await this.getPaymentStatus(paymentId);
                if (p.status !== lastStatus) {
                    console.log('[Mollie] status update:', p.status);
                    lastStatus = p.status;
                    if (typeof onUpdate === 'function') {
                        try { onUpdate(p.status, p); } catch(_) {}
                    }
                }
                if (FINAL_STATUSES.includes(p.status)) return p;
            } catch (e) {
                console.warn('[Mollie] poll fout:', e && e.message);
            }
            await new Promise(r => setTimeout(r, intervalMs));
        }
        // Timeout — geef laatste bekende status terug
        return { status: 'timeout', id: paymentId };
    },

    /** Parse de inkomende qewerkbondebug://payment-return?id=tr_xxx URL */
    parseReturnUrl(url) {
        try {
            const u = new URL(url);
            return {
                paymentId: u.searchParams.get('id') || u.searchParams.get('paymentId') || null,
                status:    u.searchParams.get('status') || null,
            };
        } catch(_) {
            // Fallback regex
            const m = String(url).match(/[?&]id=([^&]+)/);
            return { paymentId: m ? decodeURIComponent(m[1]) : null, status: null };
        }
    },
};

// Maak globaal beschikbaar
if (typeof window !== 'undefined') window.MollieAPI = MollieAPI;
