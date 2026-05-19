/* ============================================================
 * QE Werkbon — Mollie Tap-to-Pay (v142 — correcte app-to-app flow)
 * ------------------------------------------------------------
 * Flow (per Mollie docs "Integrating Tap to Pay in Your Android App"):
 *   1. JS bouwt een PaymentRequest JSON (amount/description/refId/etc)
 *   2. JS roept QEBridge.openMollieTap(payloadJson) aan
 *   3. Java canonicaliseert + signeert met HMAC-SHA256 (secret in Java!)
 *   4. Java launcht Intent naar com.mollie.pos/MainActivity
 *   5. Mollie Tap voert NFC-betaling uit
 *   6. Result via onActivityResult → JS.app.onMollieTapResult(jsonObj)
 *
 * BELANGRIJK: de POS Secret-key blijft 100% in Java. Hier alleen de
 * Secret-ID die in elke gesigneerde payload moet — die is niet geheim.
 *
 * webhookUrl: voorlopig null. Voor productie zou een server-side endpoint
 * Mollie's status-pushes oppikken voor late updates. Voor nu vertrouwen we
 * op het intent result (volgens Mollie docs is dat voldoende voor normaal
 * gebruik; webhook is voor "payment flow interrupted" edge-cases).
 * ============================================================ */

const MollieAPI = {
    // De Secret-ID is NIET geheim (zit in elke gesigneerde payload, mag in JS).
    // De Secret-key is wel geheim en zit alleen in Java/MainActivity.java.
    // Voor debug-build halen we de POS-ID uit Java zodat het altijd matched.
    APP_ID_DEBUG:   'be.qe.werkbon.debug',
    APP_ID_RELEASE: 'be.qe.werkbon',

    // v147: Mollie REST API key voor GET /v2/payments/{id} verificatie.
    // LET OP: de Tap-to-Pay POS credentials zijn LIVE → de payments zijn LIVE.
    // Deze TEST key kan LIVE payments NIET ophalen (Mollie returnt 404/401).
    // Voor productie moet je een LIVE API key gebruiken: ga in Mollie dashboard
    // naar Ontwikkelaars → API-sleutels → kopieer de "live_..." token.
    API_BASE: 'https://api.mollie.com/v2',
    API_KEY:  'test_BPDStCB4QHfGzR8gVgFttHebsdWyTn',

    // v144: Robaws/eForge proxy-webhook — Mollie post hier de payment-status
    // updates naartoe, en eForge forwardt naar Robaws die de factuur op
    // betaald zet. Zelfde URL die de Robaws ↔ Mollie betaallinks-integratie
    // gebruikt, hergebruikt voor onze Tap-to-Pay payments.
    WEBHOOK_URL: 'https://payments.eforge.be/mollie/robaws_prod:r_eb7cbxhcpkf59kc6/webhook',

    /** Lees POS-ID via de Java bridge (Java weet of we debug of release zijn). */
    getPosId() {
        try {
            if (typeof QEBridge !== 'undefined' && QEBridge.getMolliePosId) {
                return QEBridge.getMolliePosId();
            }
        } catch(_) {}
        // Fallback (test-omgeving)
        return 'possecr_4imehLQB8HPAAEBNpiQRJ';
    },

    getAppId() {
        try {
            if (typeof QEBridge !== 'undefined' && QEBridge.getApkVersionName) {
                const v = QEBridge.getApkVersionName() || '';
                if (v.toLowerCase().includes('debug')) return this.APP_ID_DEBUG;
            }
        } catch(_) {}
        return this.APP_ID_RELEASE;
    },

    /** Bouw een PaymentRequest JSON-payload voor de intent.
     *  Java zal de keys alfabetisch sorteren + signen voor verzending. */
    buildPaymentRequest({ amountCents, description, workOrderId, invoiceId }) {
        const value = (Math.round(amountCents) / 100).toFixed(2);
        const referenceId = invoiceId
            ? ('inv_' + invoiceId + '_' + Date.now())
            : ('qe_' + (workOrderId || 'unknown') + '_' + Date.now());
        const payload = {
            amount: { currency: 'EUR', value },
            appId: this.getAppId(),
            description: String(description || 'QE Werkbon betaling').slice(0, 255),
            referenceId: referenceId.slice(0, 255),
            secretId: this.getPosId(),
            // v144: webhook URL meegeven zodat Mollie de Robaws-connector pingt
            // bij elke status-wijziging → factuur automatisch op betaald.
            webhookUrl: this.WEBHOOK_URL,
        };
        return payload;
    },

    /** Check of de Mollie Tap app aanwezig is via de Java bridge. */
    isInstalled() {
        try {
            if (typeof QEBridge !== 'undefined' && QEBridge.isMollieTapInstalled) {
                return QEBridge.isMollieTapInstalled();
            }
        } catch(_) {}
        return false;
    },

    /** v147: GET een Mollie payment via de REST API. Returns
     *  { ok: true, payment } op success of { ok: false, status, error } op fout. */
    async getPayment(paymentId) {
        if (!paymentId) return { ok: false, error: 'paymentId ontbreekt' };
        const url = this.API_BASE + '/payments/' + encodeURIComponent(paymentId);
        try {
            const res = await fetch(url, {
                headers: {
                    'Authorization': 'Bearer ' + this.API_KEY,
                    'Accept': 'application/json',
                },
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const msg = (data && data.detail) || (data && data.title) || ('HTTP ' + res.status);
                console.warn('[Mollie] getPayment', paymentId, '→', res.status, msg);
                return { ok: false, status: res.status, error: msg };
            }
            return { ok: true, payment: data };
        } catch (e) {
            console.warn('[Mollie] getPayment fetch faalde:', e && e.message);
            return { ok: false, error: 'Netwerkfout: ' + (e && e.message || '?') };
        }
    },

    /** Map de finale Mollie status naar een UI-bericht. */
    statusToMessage(result) {
        if (!result) return 'Onbekend';
        if (result.canceled) return 'Klant heeft de betaling geannuleerd';
        if (result.status === 'paid') return 'Betaling gelukt';
        if (result.status === 'failed') {
            const msg = result.failureMessage || 'Betaling geweigerd';
            const code = result.failureSupportCode ? ' (' + result.failureSupportCode + ')' : '';
            return msg + code;
        }
        if (result.status === 'error') return 'Fout: ' + (result.failureMessage || '?');
        return 'Status: ' + (result.status || 'onbekend');
    },
};

// Globaal beschikbaar
if (typeof window !== 'undefined') window.MollieAPI = MollieAPI;
