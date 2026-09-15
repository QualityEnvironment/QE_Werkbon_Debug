// =============================================
// ONDERHOUD DATA — Zone/gemeente mapping + artikelcatalogus
// Gegenereerd op basis van de QE-prijslijst 2023
// =============================================

window.ONDERHOUD_DATA = {

    // ---- ZONE → GEMEENTEN ----
    // v393: bron = "Prijzen QE.xlsx" (Levi, 7 aug 2026), dezelfde indeling als
    // de Worker-KV 'onderhoudsprijzen' (prijzen-config.json). Wijzigt er een
    // zone, pas dan BEIDE aan. Eén tekst per gemeente:
    //   'Naam | andere schrijfwijze | …'   (de eerste naam wordt getoond)
    //   'Naam#2980'      = de naam bestaat ook elders in België: staat er een
    //                      postcode in het adres, dan telt hij alleen bij deze
    //   'Antwerpen@2100' = geldt ALLEEN met die postcode (districten)
    // De zone wordt ENKEL uit de gemeente (+ postcode) gehaald, nooit uit de
    // straat: "Leuvensevest, 2500 Lier" gaf vroeger zone 9 (Leuven).
    ZONE_GEMEENTEN: {
        1: ['Schoten | Shoten'],
        2: ['Merksem | Merksem (Antwerpen) | Antwerpen@2170', 'Deurne | Deurne (Antwerpen) | Antwerpen@2100',
            'Brasschaat | Mariaburg | Brasschaat-Mariaburg', 'Schilde', "'s-Gravenwezel",
            "Sint-Job-in-'t-Goor | Sint-Job | Sint Job in Goor | Sint-Job (Brecht) | Brecht (Sint-Job) | Sint-Job-in-'t-Goor (Brecht)",
            'Wijnegem', 'Ekeren | Ekeren (Antwerpen) | Antwerpen@2180', 'Borgerhout | Borgerhout (Antwerpen) | Antwerpen@2140', 'Wommelgem'],
        3: ['Antwerpen | Antwerpen 1 | Antwerpen 2 | Antwerpen 3 | Antwerpen 4 | Antwerpen 5 | Antwerpen 6',
            'Berchem#2600 | Antwerpen-Berchem | Berchem (Antwerpen) | Antwerpen@2600',
            'Antwerpen Linkeroever | Antwerpen L.O. | Linkeroever | Antwerpen@2050',
            'Borsbeek | Antwerpen@2150', 'Brecht', 'Boechout | Boechout-Vremde', 'Edegem', 'Hoevenen | Hoevenen (Stabroek)',
            'Kapellen', 'Putte (Kapellen) | Putte-Kapellen | Putte#2950', 'Hove', 'Oelegem | Oelegem (Broechem)', 'Mortsel',
            'Vremde', 'Broechem', 'Ranst'],
        4: ['Burcht | Zwijndrecht (Burcht)', 'Emblem | Emblem (Ranst)', 'Zoersel', 'Halle (Zoersel) | Halle-Zoersel | Halle#2980',
            'Wilrijk | Antwerpen-Wilrijk | Wilrijk (Antwerpen) | Antwerpen@2610', 'Aartselaar', 'Hemiksem',
            'Hoboken | Hoboken (Antwerpen) | Antwerpen@2660', 'Massenhoven', 'Zandhoven', 'Viersel', 'Pulderbos', 'Kontich',
            'Malle', 'Westmalle', 'Oostmalle', 'Stabroek', 'Sint-Lenaarts | Sint-Lenaerts',
            'Zwijndrecht | Zwijnrecht | Beveren-Kruibeke-Zwijndrecht@2070', 'Sint-Antonius | Sint-Anthonius'],
        5: ['Achterbroek', 'Berendrecht | Antwerpen@2040', 'Bouwel | Bouwel (Grobbendonk)', 'Duffel', 'Grobbendonk', 'Kalmthout',
            'Lint', 'Melsele', 'Nijlen', 'Reet', 'Schelle', 'Waarloos | Waarloos (Kontich)', 'Wuustwezel',
            'Gooreind | Gooreind (Wuustwezel)', 'Loenhout', 'Kessel', 'Koningshooikt', 'Kruibeke | Kruibeke (Bazel)', 'Lier',
            'Lillo', 'Niel', 'Zandvliet'],
        6: ['Bazel', 'Beveren | Beveren-Waas | Beveren-Kruibeke-Zwijndrecht', 'Doel', 'Kallo', 'Pulle', 'Berlaar', 'Boom',
            'Haasdonk', 'Ruisbroek#2870', 'Rumst', 'Steendorp', 'Sint-Katelijne-Waver', 'Vorselaar', 'Walem', 'Herenthout',
            'Hoogstraten', 'Itegem', 'Rijkevorsel'],
        7: ['Keerbergen', 'Beerse', 'Blaasveld', 'Bonheiden', 'Rijmenam | Bonheiden-Rijmenam | Bonheiden (Rijmenam)', 'Essen',
            'Wildert | Wildert (Essen)', 'Heffen', 'Heindonk', 'Kieldrecht', 'Lille | Lille (Wechelderzande)', 'Gierle',
            'Mechelen', 'Merksplas', 'Nieuwkerken-Waas', 'Olen', 'Onze-Lieve-Vrouw-Waver | O.L.V.-Waver',
            'Rupelmonde | Ruppelmonde', 'Sint-Gillis-Waas', 'Temse', 'Verrebroek', 'Vlimmeren', 'Vrasene', 'Wechelderzande',
            'Willebroek', 'Turnhout', 'Poederlee', 'Putte#2580', 'Puurs', 'Heist-op-den-Berg', 'Herentals', 'Noorderwijk',
            'Hingene'],
        8: ['Bavel', 'Brussel', 'Grimbergen', 'Meise', 'Arendonk', 'Stekene', 'Weelde', 'Geel'],
        9: ['Gent', 'Evergem', 'Leuven', 'Heverlee', 'Hasselt']
    },

    ZONE_VERPLAATSING: {
        1: 25, 2: 30, 3: 40, 4: 50, 5: 60, 6: 80, 7: 100, 8: 120, 9: 150
    },

    // ---- VERPLAATSINGSKOSTEN ARTIKELEN (regie) ----
    // Zone → Robaws article { id, price }
    VERPLAATSING_ARTICLES: {
        1: { id: 5, price: 25 },
        2: { id: 43, price: 30 },
        3: { id: 44, price: 40 },
        4: { id: 45, price: 50 },
        5: { id: 46, price: 60 },
        6: { id: 47, price: 80 },
        7: { id: 48, price: 100 },
        8: { id: 49, price: 120 },
        9: { id: 50, price: 150 },
    },

    // ---- CATEGORIEËN → VERMOGEN → ZONE → ARTIKEL ----
    CATEGORIES: [
        {
            key: 'gasketel',
            label: 'Gasketel',
            icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 .5-3-1-5 1-7.5z"/></svg>',
            sizes: [
                {
                    label: '-70 KW',
                    zones: { 1:{id:112,price:148}, 2:{id:113,price:158}, 3:{id:115,price:168}, 4:{id:122,price:178}, 5:{id:124,price:188}, 6:{id:125,price:208}, 7:{id:126,price:228}, 8:{id:128,price:283}, 9:{id:129,price:266} }
                },
                {
                    label: '-70 KW (vanaf 2e)',
                    zones: { 1:{id:130,price:141}, 2:{id:139,price:146}, 3:{id:140,price:151}, 4:{id:141,price:156}, 5:{id:142,price:161}, 6:{id:143,price:171}, 7:{id:145,price:181}, 8:{id:146,price:193}, 9:{id:147,price:208} }
                },
                {
                    label: '71-115 KW',
                    zones: { 1:{id:17790,price:204}, 2:{id:17791,price:214}, 3:{id:17792,price:224}, 4:{id:17793,price:234}, 5:{id:17794,price:244}, 6:{id:17795,price:264}, 7:{id:17796,price:284}, 8:{id:17797,price:309}, 9:{id:17798,price:339} }
                },
                {
                    label: '116-300 KW',
                    zones: { 1:{id:148,price:260}, 2:{id:153,price:270}, 3:{id:158,price:280}, 4:{id:159,price:290}, 5:{id:160,price:300}, 6:{id:162,price:320}, 7:{id:163,price:340}, 8:{id:164,price:365}, 9:{id:165,price:395} }
                },
                {
                    label: '301-500 KW',
                    zones: { 1:{id:166,price:316}, 2:{id:168,price:326}, 3:{id:169,price:336}, 4:{id:170,price:346}, 5:{id:171,price:356}, 6:{id:174,price:376}, 7:{id:177,price:396}, 8:{id:179,price:421}, 9:{id:181,price:451} }
                }
            ]
        },
        {
            key: 'ag',
            label: 'Aangeblazen gas (AG)',
            icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M3 9h10a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 14h13a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 11.5h7"/></svg>',
            sizes: [
                {
                    label: '-70 KW',
                    zones: { 1:{id:111,price:284}, 2:{id:114,price:294}, 3:{id:116,price:304}, 4:{id:117,price:314}, 5:{id:118,price:324}, 6:{id:119,price:344}, 7:{id:120,price:364}, 8:{id:121,price:389}, 9:{id:123,price:419} }
                },
                {
                    label: '71-115 KW',
                    zones: { 1:{id:127,price:355}, 2:{id:131,price:365}, 3:{id:132,price:375}, 4:{id:133,price:385}, 5:{id:134,price:395}, 6:{id:135,price:415}, 7:{id:136,price:435}, 8:{id:137,price:460}, 9:{id:138,price:490} }
                },
                {
                    label: '116-300 KW',
                    zones: { 1:{id:144,price:355}, 2:{id:149,price:365}, 3:{id:150,price:375}, 4:{id:151,price:385}, 5:{id:152,price:395}, 6:{id:154,price:415}, 7:{id:155,price:435}, 8:{id:156,price:460}, 9:{id:157,price:490} }
                },
                {
                    label: '301-500 KW',
                    zones: { 1:{id:161,price:421}, 2:{id:167,price:431}, 3:{id:172,price:441}, 4:{id:173,price:451}, 5:{id:175,price:461}, 6:{id:176,price:481}, 7:{id:178,price:501}, 8:{id:180,price:526}, 9:{id:182,price:556} }
                }
            ]
        },
        {
            key: 'stookolie',
            label: 'Stookolieketel',
            icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M6 9h12M6 15h12"/></svg>',
            sizes: [
                {
                    label: '-70 KW',
                    zones: { 1:{id:72,price:284}, 2:{id:76,price:294}, 3:{id:75,price:304}, 4:{id:78,price:314}, 5:{id:79,price:324}, 6:{id:80,price:344}, 7:{id:81,price:364}, 8:{id:82,price:389}, 9:{id:83,price:419} }
                },
                {
                    label: '71-115 KW',
                    zones: { 1:{id:84,price:355}, 2:{id:85,price:365}, 3:{id:86,price:375}, 4:{id:87,price:385}, 5:{id:88,price:395}, 6:{id:89,price:415}, 7:{id:90,price:435}, 8:{id:91,price:460}, 9:{id:92,price:490} }
                },
                {
                    label: '116-300 KW',
                    zones: { 1:{id:93,price:355}, 2:{id:94,price:365}, 3:{id:95,price:375}, 4:{id:96,price:385}, 5:{id:97,price:395}, 6:{id:98,price:415}, 7:{id:99,price:435}, 8:{id:100,price:460}, 9:{id:101,price:490} }
                },
                {
                    label: '301-500 KW',
                    zones: { 1:{id:102,price:421}, 2:{id:103,price:431}, 3:{id:104,price:441}, 4:{id:105,price:451}, 5:{id:106,price:461}, 6:{id:107,price:481}, 7:{id:108,price:501}, 8:{id:109,price:526}, 9:{id:110,price:556} }
                },
                {
                    label: 'B2 (mazout)',
                    single: true,
                    articleId: 188, price: 300
                }
            ]
        },
        {
            key: 'gaskachel',
            label: 'Gaskachel',
            icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 .5-3-1-5 1-7.5z"/></svg>',
            sizes: [
                {
                    label: 'Gaskachel',
                    zones: { 1:{id:17829,price:125}, 2:{id:17830,price:130}, 3:{id:17831,price:140}, 4:{id:17832,price:150}, 5:{id:17834,price:160}, 6:{id:17833,price:180}, 7:{id:17835,price:200}, 8:{id:17836,price:220}, 9:{id:17837,price:250} }
                }
            ]
        },
        {
            key: 'overig',
            label: 'Overig',
            icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M15.5 5.5a3.5 3.5 0 0 0-4.4 4.4l-5.3 5.3a1.5 1.5 0 1 0 2.1 2.1l5.3-5.3a3.5 3.5 0 0 0 4.4-4.4L15.2 9 13 8.8 12.8 6.6z"/></svg>',
            sizes: [
                { label: 'Doorstromer', single: true, articleId: 18456, price: 120 },
                { label: 'Schouw', single: true, articleId: 439, price: 130 }
            ]
        }
    ],

    // ---- CHECKLISTS PER JOB TYPE ----
    // Automatisch tonen op basis van summary/planningType
    CHECKLISTS: {
        gasketel: {
            label: 'Gasketel onderhoud',
            keywords: ['gasketel', 'gas ketel', 'cv-ketel', 'cv ketel', 'gaswandketel'],
            items: [
                { id: 'g1', text: 'Buitenmantel verwijderd en visuele inspectie uitgevoerd' },
                { id: 'g2', text: 'Brander gecontroleerd en gereinigd' },
                { id: 'g3', text: 'Warmtewisselaar gereinigd' },
                { id: 'g4', text: 'Condensafvoer/sifon gecontroleerd en gereinigd' },
                { id: 'g5', text: 'Rookgasafvoer gecontroleerd op lekdichtheid' },
                { id: 'g6', text: 'Expansievat druk gecontroleerd' },
                { id: 'g7', text: 'Waterdruk installatie gecontroleerd' },
                { id: 'g8', text: 'Rookgasanalyse uitgevoerd (CO, CO2, rendement)' },
                { id: 'g9', text: 'Veiligheidsklep gecontroleerd' },
                { id: 'g10', text: 'Toestel opnieuw in bedrijf gesteld en getest' },
            ]
        },
        stookolie: {
            label: 'Stookolie ketel onderhoud',
            keywords: ['stookolie', 'mazout', 'olieketel'],
            items: [
                { id: 's1', text: 'Buitenmantel verwijderd en visuele inspectie uitgevoerd' },
                { id: 's2', text: 'Brander gedemonteerd en gereinigd' },
                { id: 's3', text: 'Verstuiver/nozzle vervangen' },
                { id: 's4', text: 'Filter vervangen' },
                { id: 's5', text: 'Warmtewisselaar/vuurhaard gereinigd' },
                { id: 's6', text: 'Rookgaskanaal en schouw gecontroleerd' },
                { id: 's7', text: 'Rookgasanalyse uitgevoerd (CO, CO2, roetindex)' },
                { id: 's8', text: 'Condensafvoer gecontroleerd' },
                { id: 's9', text: 'Expansievat druk gecontroleerd' },
                { id: 's10', text: 'Toestel opnieuw in bedrijf gesteld en getest' },
            ]
        },
        warmtepomp: {
            label: 'Warmtepomp onderhoud',
            keywords: ['warmtepomp', 'heat pump', 'wp '],
            items: [
                { id: 'w1', text: 'Buitenunit gecontroleerd en gereinigd' },
                { id: 'w2', text: 'Binnenunit gecontroleerd' },
                { id: 'w3', text: 'Filters gereinigd/vervangen' },
                { id: 'w4', text: 'Koudemiddel druk gecontroleerd' },
                { id: 'w5', text: 'Waterdruk installatie gecontroleerd' },
                { id: 'w6', text: 'Elektrische aansluitingen gecontroleerd' },
                { id: 'w7', text: 'Toestel getest in verwarmings- en koelmodus' },
            ]
        },
        airco: {
            label: 'Airco onderhoud',
            keywords: ['airco', 'aircondition', 'koeling', 'split'],
            items: [
                { id: 'a1', text: 'Filters gereinigd/vervangen' },
                { id: 'a2', text: 'Binnenunit gereinigd (verdamper, lekbak)' },
                { id: 'a3', text: 'Buitenunit gereinigd (condensor, ventilator)' },
                { id: 'a4', text: 'Condensafvoer doorgespoeld' },
                { id: 'a5', text: 'Koudemiddel druk gecontroleerd' },
                { id: 'a6', text: 'Elektrische aansluitingen gecontroleerd' },
                { id: 'a7', text: 'Toestel getest op werking' },
            ]
        },
        schouw: {
            label: 'Schouw inspectie',
            keywords: ['schouw', 'schoorsteen', 'rookkanaal'],
            items: [
                { id: 'c1', text: 'Schouw visueel ge\u00EFnspecteerd' },
                { id: 'c2', text: 'Schouw gereinigd/geveegd' },
                { id: 'c3', text: 'Trekproef uitgevoerd' },
                { id: 'c4', text: 'Rookgasafvoer lekdicht bevonden' },
            ]
        },
    },

    // Detecteer welke checklist past bij een job-omschrijving
    detectChecklist(summary) {
        if (!summary) return null;
        const s = summary.toLowerCase();
        for (const [key, cl] of Object.entries(this.CHECKLISTS)) {
            if (cl.keywords.some(kw => s.includes(kw))) return key;
        }
        // Fallback: als het woord "onderhoud" erin zit, gebruik gasketel als standaard
        if (s.includes('onderhoud')) return 'gasketel';
        return null;
    },

    // ---- HELPERS ----

    // v393: plaatsnaam → vergelijkbare sleutel. Kleine letters, geen accenten
    // of leestekens, "St." = "Sint", "O.L.V." = "Onze-Lieve-Vrouw".
    // "'s-Gravenwezel" → "s gravenwezel", "Antwerpen L.O." → "antwerpen lo".
    _plaatsSleutel(s) {
        let t = String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
        t = t.replace(/['‘’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
        t = t.replace(/\b([a-z]) (?=[a-z]\b)/g, '$1');   // losse letters: "o l v" → "olv"
        return t.replace(/\bst\b/g, 'sint').replace(/\bonze lieve vrouw\b/g, 'olv');
    },

    // Index (één keer opgebouwd): sleutel → [{ zone, naam, primair, alleenPc, pcs }]
    _zoneIndex() {
        if (this._zoneIdx) return this._zoneIdx;
        const idx = {}, lijst = [];
        for (const [zone, gemeenten] of Object.entries(this.ZONE_GEMEENTEN)) {
            for (const regel of gemeenten) {
                const namen = regel.split('|').map(n => n.trim()).filter(Boolean);
                const entry = { zone: parseInt(zone, 10), naam: namen[0].replace(/[#@][\d,]+$/, ''), zoekNamen: [] };
                namen.forEach((n, i) => {
                    const m = n.match(/^(.*?)([#@])([\d,]+)$/);
                    const naam = m ? m[1].trim() : n;
                    const c = { zone: entry.zone, naam: entry.naam, primair: i === 0,
                        alleenPc: !!(m && m[2] === '@'), pcs: m ? m[3].split(',') : null };
                    const k = this._plaatsSleutel(naam);
                    if (!k) return;
                    (idx[k] = idx[k] || []).push(c);
                    // Zoeken: de getoonde naam + gewone schrijfwijzen (geen districten of "X (Y)")
                    if (!c.alleenPc && (i === 0 || naam.indexOf('(') < 0) && entry.zoekNamen.indexOf(k) < 0) entry.zoekNamen.push(k);
                });
                lijst.push(entry);
            }
        }
        this._zoneIdx = idx;
        this._zoneLijst = lijst;
        return idx;
    },

    // Eén plaatsnaam (+ eventuele postcode) → { zone, naam } of null
    _zoneVoorPlaats(plaats, postcode) {
        let kand = this._zoneIndex()[this._plaatsSleutel(plaats)] || [];
        if (postcode) {
            const exact = kand.filter(c => c.pcs && c.pcs.indexOf(postcode) >= 0);
            kand = exact.length ? exact : kand.filter(c => !c.pcs);
        } else {
            kand = kand.filter(c => !c.alleenPc);
        }
        if (!kand.length) return null;
        const zones = new Set(kand.map(c => c.zone));
        if (zones.size === 1) return { zone: kand[0].zone, naam: kand[0].naam };
        const prim = kand.filter(c => c.primair);
        if (new Set(prim.map(c => c.zone)).size === 1) return { zone: prim[0].zone, naam: prim[0].naam };
        return null;   // dubbelzinnig → geen voorstel
    },

    // Adres (tekst zoals formatAddress "Straat 1, 2500 Lier" of Robaws-adresobject)
    // → { plaats, postcode }. Kijkt ENKEL naar het laatste stuk van het adres.
    _adresPlaats(adres) {
        if (!adres) return null;
        const PC = /^(?:be?-?)?(\d{4})$/i;   // "2500", "B-2500", "BE-2500"
        if (typeof adres === 'object') {
            const pcRuw = String(adres.postalCode || '').trim(), stad = String(adres.city || '').trim();
            const pc = pcRuw.match(PC);
            if (stad && !/^\d{4}\s/.test(stad)) return { plaats: stad, postcode: pc ? pc[1] : '' };
            adres = [adres.addressLine1, adres.addressLine2, [pcRuw, stad].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        }
        const delen = String(adres).split(',').map(d => d.trim()).filter(Boolean);
        if (delen.length > 1 && /^(belgie|belgium|belgique|be)$/.test(this._plaatsSleutel(delen[delen.length - 1]))) delen.pop();
        if (!delen.length) return null;
        const laatste = delen[delen.length - 1];
        const woorden = laatste.split(/\s+/);
        for (let i = woorden.length - 2; i >= 0; i--) {
            const pc = woorden[i].match(PC);
            const rest = woorden.slice(i + 1).join(' ');
            if (pc && /[a-z]/i.test(rest)) return { plaats: rest, postcode: pc[1] };
        }
        // Geen (geldige) postcode: het hele laatste stuk, anders wat na het laatste
        // getal staat ("21710 MERKSEM", "Kerkstraat 5 Lier"). Beide exact vergeleken.
        let n = woorden.length;
        while (n > 0 && !/\d/.test(woorden[n - 1])) n--;
        return { plaats: laatste, postcode: '', achterGetal: n > 0 ? woorden.slice(n).join(' ') : '' };
    },

    // v393: zone op basis van het werfadres → { zone, gemeente, postcode } of null.
    // Vroeger werd in het HELE adres naar stukjes gemeentenaam gezocht, dus ook
    // in straatnamen (Leuvensevest → Leuven, Molenlei → Olen, Turnhoutsebaan →
    // Turnhout). Nu telt enkel de gemeente, exact, eventueel met de postcode.
    zoneVoorAdres(adres) {
        const p = this._adresPlaats(adres);
        if (!p || !p.plaats) return null;
        let hit = this._zoneVoorPlaats(p.plaats, p.postcode);
        if (!hit && p.achterGetal) {
            hit = this._zoneVoorPlaats(p.achterGetal, '');
            if (hit) p.plaats = p.achterGetal;
        }
        if (!hit) {
            // Samengestelde schrijfwijze, bv. "Wilrijk (Antwerpen)" of "Antwerpen - Wilrijk":
            // de delen moeten dezelfde zone geven ("Antwerpen" wijkt voor het district).
            const delen = p.plaats.split(/[()]|\s-\s?|\s?-\s/).map(d => d.trim()).filter(Boolean);
            if (delen.length > 1) {
                let hits = delen.map(d => ({ sleutel: this._plaatsSleutel(d), hit: this._zoneVoorPlaats(d, p.postcode) })).filter(x => x.hit);
                if (new Set(hits.map(x => x.hit.zone)).size > 1) hits = hits.filter(x => x.sleutel !== 'antwerpen');
                if (hits.length && new Set(hits.map(x => x.hit.zone)).size === 1) hit = hits[0].hit;
            }
        }
        return hit ? { zone: hit.zone, gemeente: hit.naam, postcode: p.postcode || '' } : null;
    },

    // Compatibel met de oude aanroep: enkel het zonenummer
    detectZoneFromAddress(address) {
        const r = this.zoneVoorAdres(address);
        return r ? r.zone : null;
    },

    // Zoek gemeenten die matchen met wat de technieker typt
    searchGemeenten(query) {
        const q = this._plaatsSleutel(query);
        if (q.length < 2) return [];
        this._zoneIndex();
        const results = [];
        for (const e of this._zoneLijst) {
            const namen = e.zoekNamen;
            if (!namen.some(n => n.indexOf(q) >= 0)) continue;
            const rang = namen.indexOf(q) >= 0 ? 0 : (namen.some(n => n.indexOf(q) === 0) ? 1 : 2);
            results.push({ gemeente: e.naam, zone: e.zone, verplaatsing: this.ZONE_VERPLAATSING[e.zone], _rang: rang });
        }
        results.sort((a, b) => (a._rang - b._rang) || (a.zone - b.zone) || a.gemeente.localeCompare(b.gemeente, 'nl'));
        return results.map(({ _rang, ...r }) => r);
    }
};
