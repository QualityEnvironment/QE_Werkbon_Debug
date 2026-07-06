/**
 * EPC QR Code generator voor Europese overschrijvingen
 * Genereert een QR code met de EPC standaard (European Payments Council)
 *
 * Gebaseerd op: https://www.europeanpaymentscouncil.eu/document-library/guidance-documents/quick-response-code-guidelines
 */

window.EPCQR = {
    /**
     * Genereer EPC QR data string
     * @param {Object} opts - { iban, bic, name, amount, ogm }
     * @returns {string} EPC QR content string
     */
    generateEPCData(opts) {
        // EPC QR code standaard formaat:
        // BCD\n002\n1\nSCT\n[BIC]\n[Name]\n[IBAN]\nEUR[Amount]\n\n[Reference]\n[Text]
        const lines = [
            'BCD',                                    // Service Tag
            '002',                                    // Version
            '1',                                      // Character set (UTF-8)
            'SCT',                                    // Identification (SEPA Credit Transfer)
            opts.bic || '',                            // BIC
            (opts.name || '').substring(0, 70),        // Beneficiary name (max 70)
            opts.iban || '',                           // IBAN
            'EUR' + (parseFloat(opts.amount) || 0).toFixed(2), // Amount
            '',                                       // Purpose (leeg)
            opts.ogm || '',                            // Gestructureerde mededeling
            '',                                       // Vrije tekst
        ];
        return lines.join('\n');
    },

    /**
     * Genereer een QR code img element
     * Probeert meerdere API's: qrserver.com als primaire, Google Charts als fallback
     * @param {Object} opts - { iban, bic, name, amount, ogm }
     * @param {number} size - QR code grootte in pixels (default 250)
     * @returns {string} HTML img tag
     */
    generateImgTag(opts, size) {
        size = size || 250;
        const data = this.generateEPCData(opts);
        const encoded = encodeURIComponent(data);

        // Primaire API: goqr.me / qrserver.com (betrouwbaar, gratis)
        const primaryUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&ecc=M&data=${encoded}`;
        // v253: fallback was Google Charts — die QR-dienst is sinds 2019
        // definitief uitgeschakeld, dus er was de facto GEEN tweede dienst.
        // Nu quickchart.io (actief onderhouden, gratis QR-endpoint).
        const fallbackUrl = `https://quickchart.io/qr?size=${size}&ecLevel=M&text=${encoded}`;

        return `<img src="${primaryUrl}" alt="Betaal QR Code" style="width:${size}px;height:${size}px;image-rendering:pixelated" onerror="this.onerror=function(){this.parentElement.innerHTML='<p style=\\'color:#999\\'>QR code kon niet geladen worden — gebruik de gegevens hierboven</p>'};this.src='${fallbackUrl}'">`;
    },

    /**
     * Toon het betaalscherm met alle overschrijvingsinfo + QR code
     * @param {Object} invoiceResult - response van createInvoice()
     * @param {HTMLElement} container - target element
     */
    showPaymentScreen(invoiceResult, container) {
        const inv = invoiceResult.invoice || {};
        const pay = invoiceResult.payment || {};
        const ogm = pay.formattedOgm || inv.formattedOgm || '';
        const amount = parseFloat(pay.amount || inv.totalInclVat || 0).toFixed(2);
        const iban = pay.iban || '';
        const bic = pay.bic || '';
        const companyName = pay.companyName || 'Quality Environment';

        // Format IBAN met spaties: BE17 6451 3521 6621
        const ibanFormatted = iban.replace(/(.{4})/g, '$1 ').trim();

        // EPC QR code — enkel cijfers voor OGM referentie
        const qrImg = this.generateImgTag({
            iban: iban,
            bic: bic,
            name: companyName,
            amount: amount,
            ogm: (pay.ogm || ogm).replace(/[^0-9]/g, ''),
        }, 220);

        container.innerHTML = `
            <div style="text-align:center;padding:16px">
                <div style="font-size:18px;font-weight:700;color:var(--qe-purple);margin-bottom:16px">
                    💳 Overschrijving ter plaatse
                </div>

                <div style="background:#f8f9fa;border-radius:12px;padding:20px;margin-bottom:16px;text-align:left">
                    <div style="margin-bottom:14px">
                        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px">Factuur</div>
                        <div style="font-size:16px;font-weight:600">${inv.logicId || '—'}</div>
                    </div>
                    <div style="margin-bottom:14px">
                        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px">Bedrag</div>
                        <div style="font-size:24px;font-weight:700;color:var(--qe-purple)">€ ${amount}</div>
                    </div>
                    <div style="margin-bottom:14px">
                        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px">Begunstigde</div>
                        <div style="font-size:16px;font-weight:600">${companyName}</div>
                    </div>
                    <div style="margin-bottom:14px">
                        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px">IBAN</div>
                        <div style="font-size:16px;font-weight:600;font-family:monospace;letter-spacing:1px">${ibanFormatted || '—'}</div>
                    </div>
                    ${bic ? `<div style="margin-bottom:14px">
                        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px">BIC</div>
                        <div style="font-size:16px;font-weight:600;font-family:monospace">${bic}</div>
                    </div>` : ''}
                    <div>
                        <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px">Gestructureerde mededeling</div>
                        <div style="font-size:20px;font-weight:700;font-family:monospace;color:var(--qe-purple);letter-spacing:2px">${ogm || '—'}</div>
                    </div>
                </div>

                <div style="background:#fff;border:2px solid var(--qe-purple);border-radius:12px;padding:16px;margin-bottom:16px">
                    <div style="font-size:13px;color:#888;margin-bottom:8px">Scan met bank-app om te betalen</div>
                    ${qrImg}
                </div>

                <p style="font-size:12px;color:#888;margin-bottom:16px">
                    Toon dit scherm aan de klant zodat zij de QR-code kunnen scannen met hun bank-app,
                    of de gegevens handmatig kunnen overnemen.
                </p>

                <button onclick="app.closePaymentScreen()"
                    class="btn btn-primary btn-full"
                    style="padding:14px;font-size:16px;font-weight:600">
                    ✓ Klaar — Terug naar planning
                </button>
            </div>
        `;
    }
};
