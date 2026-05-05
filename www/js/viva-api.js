/**
 * QE Werkbon App — Viva Wallet API Module
 * Directe communicatie met Viva Wallet API (geen PHP proxy nodig)
 *
 * Quality Environment bvba - Intern gebruik
 */

const VivaAPI = {
    // === CONFIGURATIE ===
    MERCHANT_ID: '5cad89ef-2d72-ed11-9561-000d3adea31e',
    API_KEY: 'X66bv0812k2tc3943vyHkPv28Op1JG',
    ENV: 'live', // 'live' of 'demo'

    get BASE_URL() {
        return this.ENV === 'live'
            ? 'https://www.vivapayments.com'
            : 'https://demo.vivapayments.com';
    },

    get API_URL() {
        return this.ENV === 'live'
            ? 'https://api.vivapayments.com'
            : 'https://demo-api.vivapayments.com';
    },

    // === AUTH HEADERS (Basic Auth) ===
    getHeaders() {
        const auth = btoa(this.MERCHANT_ID + ':' + this.API_KEY);
        return {
            'Authorization': 'Basic ' + auth,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
    },

    // === BASIS API CALLS ===
    async request(method, url, data = null) {
        const options = {
            method,
            headers: this.getHeaders(),
        };
        if (data && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(data);
        }

        try {
            const res = await fetch(url, options);
            let responseData = null;
            const text = await res.text();
            try { responseData = JSON.parse(text); } catch(e) { responseData = text; }
            return { code: res.status, data: responseData, raw: text };
        } catch (e) {
            return { code: 0, data: null, raw: null, curlError: e.message };
        }
    },

    // =============================================
    // STATUS CHECK
    // =============================================
    async checkStatus() {
        const configured = !!(this.MERCHANT_ID && this.API_KEY);
        const result = {
            configured,
            environment: this.ENV,
            hasTerminal: false,
        };

        if (configured) {
            const test = await this.request('GET', this.BASE_URL + '/api/wallets');
            result.connectionTest = {
                code: test.code,
                success: test.code === 200,
            };
            if (test.code !== 200) {
                const test2 = await this.request('GET', this.BASE_URL + '/api/orders');
                result.connectionTest = {
                    code: test2.code,
                    success: [200, 400, 403].includes(test2.code),
                    note: test2.code === 400 ? 'Auth OK, endpoint bereikbaar' : null,
                };
            }
        }

        return result;
    },

    // =============================================
    // BETAALORDER AANMAKEN
    // =============================================
    async createOrder({ amount, description, ogm, invoiceId }) {
        if (amount <= 0) {
            return { success: false, error: 'Ongeldig bedrag' };
        }

        const amountCents = Math.round(amount * 100);

        const orderData = {
            Amount: amountCents,
            CustomerTrns: description || 'Betaling',
            MerchantTrns: ogm || '',
            PaymentTimeOut: 1800,
        };

        const result = await this.request('POST', this.BASE_URL + '/api/orders', orderData);

        if (result.code !== 200 || !result.data || !result.data.OrderCode) {
            return {
                success: false,
                error: 'Kon betaalorder niet aanmaken',
                vivaCode: result.code,
                vivaResponse: result.data,
                hint: 'Controleer de Viva Wallet configuratie',
            };
        }

        const orderCode = result.data.OrderCode;

        // Format gestructureerde mededeling
        let formattedOgm = '';
        if (ogm && ogm.length === 12) {
            formattedOgm = '+++' + ogm.substr(0, 3) + '/' + ogm.substr(3, 4) + '/' + ogm.substr(7, 5) + '+++';
        }

        const checkoutUrl = this.BASE_URL + '/web/checkout?ref=' + orderCode;

        return {
            success: true,
            orderCode,
            checkoutUrl,
            amount,
            amountCents,
            ogm: ogm || '',
            formattedOgm,
            description: description || 'Betaling',
        };
    },

    // =============================================
    // TERMINAL BETALING (Cloud Terminal API)
    // =============================================
    async terminalPayment({ orderCode, terminalId }) {
        if (!orderCode) return { success: false, error: 'orderCode is verplicht' };
        if (!terminalId) return { success: false, error: 'Geen terminal geselecteerd.' };

        const result = await this.request('POST', this.API_URL + '/ecr/v1/transactions:sale', {
            sessionType: 'CardPresent',
            terminalId: parseInt(terminalId),
            cashRegisterId: 'QE-APP',
            orderCode: parseInt(orderCode),
        });

        if (result.code === 200) {
            return {
                success: true,
                message: 'Betaling verstuurd naar terminal',
                sessionId: result.data ? result.data.sessionId : null,
                terminalId,
            };
        }

        let hint = '';
        if (result.code === 401 || result.code === 403) {
            hint = 'Cloud Terminal API vereist mogelijk OAuth2 authenticatie.';
        } else if (result.code === 404) {
            hint = 'Terminal niet gevonden. Controleer of terminal ID ' + terminalId + ' actief is.';
        } else if (result.code === 0) {
            hint = 'Kan geen verbinding maken met Viva API.';
        }

        return {
            success: false,
            error: 'Terminal betaling mislukt',
            hint,
            vivaCode: result.code,
            vivaResponse: result.data,
        };
    },

    // =============================================
    // BETAALSTATUS CONTROLEREN
    // =============================================
    async checkPaymentStatus(orderCode) {
        if (!orderCode) return { error: 'orderCode is verplicht' };

        const result = await this.request('GET', this.BASE_URL + '/api/orders/' + orderCode);

        let paid = false;
        let status = 'pending';

        if (result.code === 200 && result.data) {
            const stateId = result.data.StateId;
            if (stateId === 3 || stateId === '3') {
                paid = true;
                status = 'paid';
            } else if (stateId === 1 || stateId === '1') {
                status = 'expired';
            } else if (stateId === 2 || stateId === '2') {
                status = 'canceled';
            }
        }

        return { orderCode, paid, status };
    },

    // =============================================
    // TRANSACTIE ZOEKEN OP CLIENT TRANSACTION ID (= OGM)
    // Gebruikt wanneer de SoftPos-app een eigen order aanmaakt
    // en wij alleen de OGM als clientTransactionId meegaven.
    // =============================================
    async findTransactionByClientRef(clientTransactionId) {
        if (!clientTransactionId) return { found: false, error: 'Geen referentie' };

        // Primair endpoint: Accounts API zoeken op clientTransactionId
        const urls = [
            this.BASE_URL + '/api/transactions?clientTransactionId=' + encodeURIComponent(clientTransactionId),
            this.API_URL + '/checkout/v2/transactions?clientTransactionId=' + encodeURIComponent(clientTransactionId),
        ];

        for (const url of urls) {
            const result = await this.request('GET', url);
            if (result.code !== 200 || !result.data) continue;

            // Response kan verschillende shapes hebben
            const items = result.data.Transactions
                || result.data.transactions
                || result.data.items
                || (Array.isArray(result.data) ? result.data : []);

            if (items && items.length > 0) {
                // Zoek een succesvolle transactie
                const successful = items.find(t => {
                    const status = (t.StatusId || t.statusId || t.Status || '').toString().toUpperCase();
                    const state = t.StateId || t.stateId;
                    return status === 'F' || status === 'PAID' || state === 3 || state === '3';
                });

                if (successful) {
                    return {
                        found: true,
                        paid: true,
                        transactionId: successful.TransactionId || successful.transactionId || successful.Id,
                        orderCode: successful.OrderCode || successful.orderCode,
                        amount: (successful.Amount || successful.amount || 0) / 100,
                        timestamp: successful.InsDate || successful.insDate || successful.timestamp,
                        raw: successful,
                    };
                }
                // Transactie gevonden maar niet succesvol
                return {
                    found: true,
                    paid: false,
                    status: items[0].StatusId || items[0].Status || 'unknown',
                    raw: items[0],
                };
            }
        }

        return { found: false, paid: false };
    },
};
