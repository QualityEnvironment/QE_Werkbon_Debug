/* QE Werkbon — "Wat is er nieuw?" (www v428)
 * Na een update ziet de werknemer bij het aanmelden één venster met wat er voor HEM veranderd is. Later teruglezen:
 * Profiel → App bijwerken → Wat is er nieuw?
 *
 * EEN BLOK PER www-VERSIE waarin de werknemer iets merkt (geen blok voor een versie die hij niet merkt):
 *   { v: <versie uit version.json>, datum: 'jjjj-mm-dd', items: [ { s, titel, tekst, rol?, hoofdstuk? } ] }
 *   s         'nieuw' | 'beter' | 'opgelost'
 *   rol       alleen voor deze rollen ('monteur', 'technieker', 'bureel'); weglaten = iedereen
 *   hoofdstuk slug van een hoofdstuk in de handleiding (js/handleiding.js): knop "Lees meer"
 * Schrijfregels: je-vorm, korte zinnen, wat de werknemer merkt (niet hoe het gebouwd is), geen gedachtestreepjes,
 * positief maar nuchter. Komt een functie pas later echt in gebruik (bv. als de Worker live gaat), zet ze dan bij de
 * eerstvolgende www-versie: wie al verder is, ziet een blok van een oudere versie nooit meer.
 */
(function (root) {
    'use strict';
    var LIJST = [
        { v: 434, datum: '2026-10-16', items: [
            { s: 'nieuw', rol: ['bureel'], titel: 'Gsm’s en tablets in Logistiek', tekst: 'In Logistiek staat nu Gsm’s & tablets. Je ziet wie welk toestel heeft, sinds wanneer, de IMEI, het nummer en het abonnement. Tik op een toestel om het aan te passen of aan iemand anders te geven. Het is dezelfde lijst als in de hub.' },
        ] },
        { v: 433, datum: '2026-10-15', items: [
            { s: 'nieuw', titel: 'Meldingen van het bureel op je gsm', tekst: 'Stuurt het bureel een melding, dan krijg je ze nu ook als melding op je gsm, ook als de app dicht is. Dat kan tot een kwartier duren. Tik erop en je leest ze in de app. Dit werkt met de nieuwste versie van de app.', hoofdstuk: 'meldingen' },
        ] },
        { v: 432, datum: '2026-10-14', items: [
            { s: 'nieuw', titel: 'Code van het sleutelkluisje', tekst: 'Heeft een werf een sleutelkluisje, dan staat de code bij elke opdracht van dat project op je planning en bovenaan je werkbon.' }
        ] },
        { v: 431, datum: '2026-10-14', items: [
            { s: 'nieuw', rol: ['bureel'], titel: 'NFC tags op één plaats', tekst: 'Bij Logistiek staat nu NFC tags: de klok-tags, de tags van de voertuigen en die van het gereedschap samen. Zoeken, koppelen, beschrijven en wissen doe je daar. Het klokscherm verwijst ernaar.' }
        ] },
        { v: 430, datum: '2026-10-14', items: [
            { s: 'nieuw', rol: ['monteur', 'technieker'], titel: 'Foto’s verplicht', tekst: 'Zie je op je planning Foto’s verplicht bij een opdracht, dan vraagt het bureel foto’s van je werk. De werkbon versturen kan pas als er minstens één foto op staat.', hoofdstuk: 'wo-fotos' }
        ] },
        { v: 428, datum: '2026-10-12', items: [
            { s: 'nieuw', titel: 'Meldingen van het bureel', tekst: 'Heeft het bureel iets belangrijks te melden, zoals "iedereen binnenkomen vanavond", dan verschijnt dat meteen als je de app opent. Tot de einddatum staat de melding ook bovenaan je planning. Tik op Begrepen als je ze gelezen hebt.', hoofdstuk: 'meldingen' },
            { s: 'nieuw', titel: 'Wat is er nieuw?', tekst: 'Na een update zie je voortaan meteen wat er sinds je vorige versie veranderd is. Alles teruglezen kan in je Profiel, bij App bijwerken.' },
        ] },
        { v: 427, datum: '2026-10-12', items: [
            { s: 'opgelost', titel: 'Naar boven scrollen werkt weer', tekst: 'Scrolde je naar boven, dan herlaadde de app soms het scherm. Dat is opgelost. Verversen doe je zo: scrol helemaal naar boven, laat los en trek dan naar beneden.' },
            { s: 'beter', titel: 'Aanvragen begint bij Materiaal', tekst: 'De tabbladen staan nu zo: Materiaal, Materieel, Budget en Verlof.' },
            { s: 'opgelost', rol: ['technieker'], titel: 'Tekenen bovenaan de werkbon', tekst: 'Staat het handtekeningvak bovenaan, dan kan de klant gewoon tekenen. Een haal naar beneden herlaadt het scherm niet meer.' },
        ] },
        { v: 425, datum: '2026-10-12', items: [
            { s: 'nieuw', titel: 'Materiaal bestellen met een mandje', tekst: 'Bij Aanvragen → Materiaal vul je een mandje in de webshop, voor een werf of voor de stock. Het bureel kijkt je bestelling na en bestelt. Je volgt ze bij Mijn bestellingen.', hoofdstuk: 'materiaal-bestellen' },
        ] },
        { v: 424, datum: '2026-10-12', items: [
            { s: 'nieuw', rol: ['monteur', 'technieker'], titel: 'Materiaal uit de webshop op je werkbon', tekst: 'Op een werkbon kies je materiaal nu ook rechtstreeks uit de webshop. Het gewone zoeken werkt nog zoals vroeger.' },
        ] },
        { v: 423, datum: '2026-10-12', items: [
            { s: 'beter', rol: ['monteur', 'technieker'], titel: 'Geen dubbele uren meer', tekst: 'Zette een collega jouw uren al op een werkbon? Dan verdwijnt die dagplanning bij jou. Voor het versturen kijkt de app ook na of je uren al op een werkbon staan.' },
        ] },
        { v: 422, datum: '2026-10-12', items: [
            { s: 'nieuw', rol: ['monteur'], titel: 'Uren verdelen bij het uitklokken', tekst: 'Heb je bij het uitklokken meer dan één werkbon open? Dan kies je zelf hoeveel uur naar elke werkbon gaat. Samen is het altijd precies je gewerkte tijd.', hoofdstuk: 'uitklokken' },
        ] },
    ];

    var SOORT = {
        nieuw: { label: 'Nieuw' },
        beter: { label: 'Beter' },
        opgelost: { label: 'Opgelost' },
    };
    var MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

    function datumTekst(iso, nu) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
        if (!m) return '';
        var jaar = Number(m[1]), dag = Number(m[3]), maand = MAANDEN[Number(m[2]) - 1] || '';
        var ditJaar = (nu instanceof Date ? nu : new Date()).getFullYear();
        return dag + ' ' + maand + (jaar !== ditJaar ? ' ' + jaar : '');
    }

    function voorRol(item, rollen) {
        if (!item || !item.titel) return false;
        if (!item.rol || !item.rol.length) return true;
        for (var i = 0; i < rollen.length; i++) if (item.rol.indexOf(rollen[i]) >= 0) return true;
        return false;
    }

    /**
     * Wat moet deze werknemer zien?
     *   opts.vanaf  versie die hij al zag (exclusief; 0 of leeg = alles)
     *   opts.tot    huidige versie (inclusief)
     *   opts.rollen ['monteur'] / ['technieker', 'monteur'] / ['bureel'] …
     *   opts.max    hoogstens zoveel items (de nieuwste blijven), standaard alles
     * → { groepen: [ { datum, datumTekst, versies: [..], items: [..] } ], aantal, verborgen }
     *   groepen per datum, nieuwste eerst; versies zonder items voor deze rol vallen weg.
     */
    function voor(opts) {
        opts = opts || {};
        var vanaf = Number(opts.vanaf) || 0;
        var tot = Number(opts.tot);
        if (!(tot > 0)) tot = Infinity;
        var rollen = (opts.rollen || []).filter(Boolean);
        var max = Number(opts.max) > 0 ? Number(opts.max) : Infinity;
        var blokken = LIJST.filter(function (b) { return b && b.v > vanaf && b.v <= tot; })
            .sort(function (a, b) { return b.v - a.v; });
        var groepen = [], aantal = 0, verborgen = 0;
        blokken.forEach(function (b) {
            var items = (b.items || []).filter(function (it) { return voorRol(it, rollen); });
            if (!items.length) return;
            var plek = Math.max(0, max - aantal);
            if (plek < items.length) { verborgen += items.length - plek; items = items.slice(0, plek); }
            if (!items.length) return;
            aantal += items.length;
            var g = groepen.length ? groepen[groepen.length - 1] : null;
            if (!g || g.datum !== b.datum) {
                g = { datum: b.datum, datumTekst: datumTekst(b.datum, opts.nu), versies: [], items: [] };
                groepen.push(g);
            }
            g.versies.push(b.v);
            items.forEach(function (it) { g.items.push({ s: SOORT[it.s] ? it.s : 'nieuw', label: (SOORT[it.s] || SOORT.nieuw).label, titel: it.titel, tekst: it.tekst || '', hoofdstuk: it.hoofdstuk || '', v: b.v }); });
        });
        return { groepen: groepen, aantal: aantal, verborgen: verborgen };
    }

    function laatsteVersie() {
        var m = 0;
        LIJST.forEach(function (b) { if (b && b.v > m) m = b.v; });
        return m;
    }

    var api = { lijst: LIJST, soort: SOORT, voor: voor, datumTekst: datumTekst, laatsteVersie: laatsteVersie };
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.QENieuw = api;
})(typeof window !== 'undefined' ? window : this);
/* QE-EIND nieuw */
