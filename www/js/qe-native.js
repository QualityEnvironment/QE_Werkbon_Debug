/* =========================================================
   QE NATIVE (v391) — toestelfuncties van de APK voor de www.
   De APK 1.245 heeft een algemene brug "QENativeBrug" (permissies,
   intents, delen, meldingen, agenda, biometrie, NFC-schrijven,
   Bluetooth, print, spraak, APK-update). Deze module maakt daar
   Promises en events van, zodat nieuwe functies later via een
   gewone OTA-update kunnen komen zonder nieuwe APK.

   Gebruik:
     QENative.beschikbaar()                → true op APK ≥ 1.245
     await QENative.vraagPermissie(['camera','locatie'])
     QENative.op('nfc', data => …)         → events
   Op een oudere APK of in de browser geeft elke aanroep
   { ok:false, fout:'niet-beschikbaar' } terug (nooit een crash).
   ========================================================= */
(function () {
    'use strict';
    var wacht = {};
    var teller = 0;
    var luisteraars = {};

    function brug() { return window.QENativeBrug || null; }
    function heeft(fn) { var b = brug(); return !!(b && typeof b[fn] === 'function'); }

    window.QENativeTerug = function (id, data) {
        var w = wacht[id];
        if (!w) return;
        delete wacht[id];
        try { w(data || {}); } catch (e) { console.warn('[QENative] terug', e); }
    };
    var zonderLuisteraar = [];  /* bv. tik op een melding bij koude start: bewaard tot iemand luistert */
    window.QENativeEvent = function (naam, data) {
        var l = (luisteraars[naam] || []).slice();
        if (!l.length && zonderLuisteraar.length < 20) zonderLuisteraar.push({ naam: naam, data: data || {} });
        for (var i = 0; i < l.length; i++) {
            try { l[i](data || {}); } catch (e) { console.warn('[QENative] event ' + naam, e); }
        }
        try { window.dispatchEvent(new CustomEvent('qe-native-' + naam, { detail: data || {} })); } catch (e) {}
    };

    /* async functie: laatste argument = terug-id */
    function roep(fn, args, tijdMs) {
        return new Promise(function (resolve) {
            if (!heeft(fn)) { resolve({ ok: false, fout: 'niet-beschikbaar' }); return; }
            var id = 'q' + (++teller) + '_' + Date.now();
            wacht[id] = resolve;
            if (tijdMs) setTimeout(function () {
                if (wacht[id]) { delete wacht[id]; resolve({ ok: false, fout: 'time-out' }); }
            }, tijdMs);
            try { brug()[fn].apply(brug(), (args || []).concat([id])); }
            catch (e) { delete wacht[id]; resolve({ ok: false, fout: String((e && e.message) || e) }); }
        });
    }
    /* sync functie */
    function direct(fn, args, standaard) {
        if (!heeft(fn)) return standaard;
        try { return brug()[fn].apply(brug(), args || []); } catch (e) { return standaard; }
    }
    function json(fn, args, standaard) {
        var r = direct(fn, args, null);
        if (r == null) return standaard;
        try { return JSON.parse(r); } catch (e) { return standaard; }
    }

    var QENative = {
        beschikbaar: function () { return heeft('nativeInfo'); },
        versie: function () { return direct('apiVersie', [], 0) || 0; },
        info: function () { return json('nativeInfo', [], null); },
        op: function (naam, fn) {
            (luisteraars[naam] = luisteraars[naam] || []).push(fn);
            var nog = [];
            zonderLuisteraar.forEach(function (e) {
                if (e.naam !== naam) { nog.push(e); return; }
                try { fn(e.data); } catch (x) { console.warn('[QENative] event ' + naam, x); }
            });
            zonderLuisteraar = nog;
            return fn;
        },
        af: function (naam, fn) { luisteraars[naam] = (luisteraars[naam] || []).filter(function (x) { return x !== fn; }); },

        /* permissies: locatie · camera · microfoon · meldingen · agenda · bluetooth · installeren · batterij */
        permissie: function (naam) { return direct('permissieStatus', [naam], 'onbekend'); },
        vraagPermissie: function (namen) {
            return roep('vraagPermissie', [JSON.stringify([].concat(namen || []))], 120000);
        },
        openInstelling: function (welke) { return !!direct('openInstelling', [welke || 'app'], false); },
        appGeinstalleerd: function (pakket) { return !!direct('appGeinstalleerd', [pakket], false); },

        /* andere apps */
        openUrl: function (url) { return roep('openUrl', [url], 15000); },
        openIntent: function (o) { return roep('openIntent', [JSON.stringify(o || {})], 15000); },
        navigeer: function (bestemming) { return roep('navigeer', [bestemming || ''], 15000); },
        agendaOpenen: function (o) { return roep('agendaOpenen', [JSON.stringify(o || {})], 15000); },

        /* bestanden (base64 zonder data:-voorvoegsel) */
        deelBestand: function (b64, naam, mime, tekst) { return roep('deelBestand', [b64, naam || 'bestand', mime || '', tekst || ''], 30000); },
        deelTekst: function (tekst, onderwerp) { return roep('deelTekst', [tekst || '', onderwerp || ''], 15000); },
        openBestand: function (b64, naam, mime) { return roep('openBestand', [b64, naam || 'bestand', mime || ''], 30000); },
        printPagina: function (titel) { direct('printPagina', [titel || document.title || 'QE Werkbon']); },
        printPdf: function (b64, naam) { return roep('printPdf', [b64, naam || 'document.pdf'], 30000); },
        download: function (url, naam) { return roep('downloadUrl', [url, naam || ''], 15000); },
        installeerApk: function (url) { return roep('installeerApk', [url || ''], 600000); },

        /* toestel */
        kopieer: function (tekst) { return !!direct('kopieer', [String(tekst == null ? '' : tekst)], false); },
        plak: function () { return direct('plak', [], '') || ''; },
        schermAan: function (aan) { direct('schermAan', [!!aan]); },
        tril: function (patroon) { return !!direct('tril', [JSON.stringify([].concat(patroon || [60]))], false); },
        netwerk: function () { return json('netwerk', [], { online: navigator.onLine, type: 'onbekend' }); },

        /* meldingen: {tag, titel, tekst, dringend, data, op(ms)|na(ms)} */
        toonMelding: function (o) { return !!direct('toonMelding', [JSON.stringify(o || {})], false); },
        planMelding: function (o) { return !!direct('planMelding', [JSON.stringify(o || {})], false); },
        annuleerMelding: function (tag) { direct('annuleerMelding', [tag]); },

        spraak: function (taal, prompt) { return roep('spraak', [taal || 'nl-BE', prompt || ''], 120000); },
        biometrieStatus: function () { return direct('biometrieStatus', [], 'niet-beschikbaar'); },
        biometrie: function (titel, uitleg) { return roep('biometrie', [titel || '', uitleg || ''], 120000); },

        /* agenda van het toestel (stil, permissie "agenda") */
        agendaKalenders: function () { return roep('agendaKalenders', [], 20000); },
        agendaBewaar: function (o) { return roep('agendaBewaar', [JSON.stringify(o || {})], 20000); },
        agendaVerwijder: function (uid) { return roep('agendaVerwijder', [uid], 20000); },

        /* NFC: events 'nfc' en 'nfc-schrijfmodus'; schrijven wacht op de volgende tag */
        nfcSchrijf: function (o) { return roep('nfcSchrijf', [JSON.stringify(o || {})], 310000); },
        nfcSchrijfStop: function () { direct('nfcSchrijfStop', []); },

        /* Bluetooth (base64-data) — events: ble-gevonden, ble-data, ble-verbroken, spp-data, spp-verbroken */
        btStatus: function () { return json('btStatus', [], { beschikbaar: false }); },
        btGekoppeld: function () { return json('btGekoppeld', [], []); },
        bleScan: function (filter, duurMs) { return roep('bleScan', [JSON.stringify(filter || {}), duurMs || 8000], 40000); },
        bleVerbind: function (adres) { return roep('bleVerbind', [adres], 30000); },
        bleLees: function (adres, service, kenmerk) { return roep('bleLees', [adres, service, kenmerk], 15000); },
        bleSchrijf: function (adres, service, kenmerk, b64, zonderAntwoord) { return roep('bleSchrijf', [adres, service, kenmerk, b64, !!zonderAntwoord], 15000); },
        bleVolg: function (adres, service, kenmerk, aan) { return roep('bleVolg', [adres, service, kenmerk, aan !== false], 15000); },
        bleVerbreek: function (adres) { direct('bleVerbreek', [adres]); },
        sppVerbind: function (adres, uuid) { return roep('sppVerbind', [adres, uuid || ''], 30000); },
        sppSchrijf: function (adres, b64) { return roep('sppSchrijf', [adres, b64], 15000); },
        sppVerbreek: function (adres) { direct('sppVerbreek', [adres]); }
    };
    window.QENative = QENative;

    /* de APK buffert events tot de pagina klaar is */
    function klaar() { try { if (heeft('nativeKlaar')) brug().nativeKlaar(); } catch (e) {} }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', klaar);
    else klaar();
})();
/* QE-EIND qe-native */
