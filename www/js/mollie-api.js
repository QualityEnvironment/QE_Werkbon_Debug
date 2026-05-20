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

    // v155: WEBHOOK_URL = onze eigen Cloudflare Worker (qe-mollie-webhook).
    // Mollie stuurt elke status-wijziging POST → Worker. Worker bewaart status
    // in KV en zet de factuur op betaald in Robaws. App polled de Worker via
    // STATUS_URL met de unieke referenceId om de intent-onbetrouwbaarheid op
    // te vangen (officieel Mollie-gedocumenteerd: "intent might not return").
    //
    WEBHOOK_URL: 'https://qe-mollie-webhook.levi-957.workers.dev',
    STATUS_URL:  'https://qe-mollie-webhook.levi-957.workers.dev/status',

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

    /** v155: Vraag de status van een Tap-to-Pay betaling op aan onze Worker.
     *  Worker indexeert zowel op referenceId (uniek per launch) als description
     *  (factuur-logicId). Geeft `{status:'pending',found:false}` als de webhook
     *  nog niet binnen is. */
    async fetchPaymentStatus({ referenceId, description }) {
        if (!this.STATUS_URL) return null;
        const params = [];
        if (referenceId) params.push('referenceId=' + encodeURIComponent(referenceId));
        if (description) params.push('description=' + encodeURIComponent(description));
        if (params.length === 0) return null;
        const url = this.STATUS_URL + '?' + params.join('&');
        try {
            const res = await fetch(url, { method: 'GET', cache: 'no-store' });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.warn('[Mollie] status-lookup fout:', e && e.message);
            return null;
        }
    },

    /** Map de Mollie Tap intent return naar een UI-bericht. */
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
