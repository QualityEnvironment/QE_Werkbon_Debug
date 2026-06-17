/* ============================================================
 * QE Werkbon — Mollie Tap-to-Pay (app-to-app, per Mollie-spec)
 * ------------------------------------------------------------
 * Flow (per Mollie docs "Integrating Tap to Pay in Your Android App"):
 *   1. JS bouwt een spec-conforme PaymentRequest: amount, appId,
 *      description, referenceId, secretId, webhookUrl — GEEN extra velden.
 *   2. JS roept QEBridge.openMollieTap(payloadJson) aan.
 *   3. Java zet appId + secretId uit de ECHTE build, sorteert de keys
 *      alfabetisch en tekent met HMAC-SHA256. De Secret-key blijft 100%
 *      in Java — nooit in JS.
 *   4. Java launcht de Intent naar com.mollie.pos/MainActivity.
 *   5. Mollie Tap voert de NFC-kaartbetaling uit.
 *   6. Resultaat via onActivityResult → app.onMollieTapResult(). Het
 *      intent-result kan ontbreken (Mollie: "intent might not return");
 *      de webhook + STATUS-polling bevestigen de definitieve status.
 *
 * Per omgeving: release-build (be.qe.werkbon) en debug-build
 * (be.qe.werkbon.debug) gebruiken elk hun eigen Mollie-integratie;
 * Java kiest op basis van de echte package-naam.
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
        // v204: GEEN debug-fallback meer. native openMollieTap overschrijft
        // secretId sowieso met de juiste gepaarde POS-id, dus '' is veilig.
        return '';
    },

    /** appId = de bundle-id van deze build. Java overschrijft dit vóór het
     *  tekenen met de ECHTE package-naam, dus dit is enkel een nette default. */
    getAppId() {
        try {
            if (typeof QEBridge !== 'undefined' && QEBridge.getApkVersionName) {
                const v = (QEBridge.getApkVersionName() || '').toLowerCase();
                if (v.includes('debug')) return this.APP_ID_DEBUG;
            }
        } catch(_) {}
        return this.APP_ID_RELEASE;
    },

    /** Bouw een spec-conforme PaymentRequest (amount, appId, description,
     *  referenceId, secretId, webhookUrl — géén extra velden). Java zet appId
     *  en secretId definitief uit de echte build en tekent vóór verzending. */
    buildPaymentRequest({ amountCents, description, workOrderId, invoiceId }) {
        const value = (Math.round(amountCents) / 100).toFixed(2);
        const referenceId = invoiceId
            ? ('inv_' + invoiceId + '_' + Date.now())
            : ('qe_' + (workOrderId || 'unknown') + '_' + Date.now());
        return {
            amount: { currency: 'EUR', value },
            appId: this.getAppId(),
            description: String(description || 'QE Werkbon betaling').slice(0, 255),
            referenceId: referenceId.slice(0, 255),
            secretId: this.getPosId(),
            webhookUrl: this.WEBHOOK_URL,
        };
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

    /** v227: Maak een Bancontact-QR-betaling aan via onze Worker.
     *  De Mollie API-key blijft op de Worker — de app stuurt alleen bedrag,
     *  omschrijving (factuur-logicId!) en referenceId. De webhook boekt de
     *  betaling daarna automatisch in Robaws, identiek aan Tap-to-Pay.
     *  @returns {paymentId, status, qrSrc, checkoutUrl, expiresAt, referenceId} */
    async createQrPayment({ amountCents, description, invoiceId, workOrderId, method }) {
        const value = (Math.round(amountCents) / 100).toFixed(2);
        const referenceId = invoiceId
            ? ('inv_' + invoiceId + '_' + Date.now())
            : ('qe_' + (workOrderId || 'unknown') + '_' + Date.now());
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
        try {
            const res = await fetch(this.WEBHOOK_URL + '/create-qr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amountValue: value,
                    description: String(description || '').slice(0, 255),
                    referenceId: referenceId,
                    invoiceId: invoiceId || null,
                    // v228: 'bancontact' (QR voor de bank-app) of 'any'
                    // (betaallink: Mollie-checkout, klant kiest de methode)
                    method: method === 'any' ? 'any' : 'bancontact',
                }),
                signal: controller ? controller.signal : undefined,
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data || data.error) {
                throw new Error((data && data.error) || ('QR aanmaken faalde (HTTP ' + res.status + ')'));
            }
            data.referenceId = referenceId;
            return data;
        } finally {
            if (timer) clearTimeout(timer);
        }
    },

    /** v229: Maak een Mollie-BETAALLINK aan via de Worker; de app toont de
     *  link-URL als QR. description MOET het factuurnummer zijn — daarop
     *  matchen de webhook, de KV-status en de automatische Robaws-boeking
     *  (betaallinks ondersteunen geen metadata).
     *  @returns {paymentLinkId, paymentLinkUrl, expiresAt} */
    async createPaymentLink({ amountCents, description, invoiceId }) {
        const value = (Math.round(amountCents) / 100).toFixed(2);
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
        try {
            const res = await fetch(this.WEBHOOK_URL + '/create-payment-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amountValue: value,
                    description: String(description || '').slice(0, 255),
                    invoiceId: invoiceId || null,
                }),
                signal: controller ? controller.signal : undefined,
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data || data.error) {
                throw new Error((data && data.error) || ('betaallink aanmaken faalde (HTTP ' + res.status + ')'));
            }
            return data;
        } finally {
            if (timer) clearTimeout(timer);
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
