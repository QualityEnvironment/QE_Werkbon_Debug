/**
 * QE Werkbon — in-app handleiding (v313)
 *
 * De papieren handleidingen (monteur + technieker, map Handleiding/) als
 * doorzoekbaar naslagwerk ín de app. Zelfde inhoud, maar zonder de zware
 * screenshots (OTA-gewicht): in de app staan de échte schermen één tik
 * verderop, dus elk hoofdstuk heeft waar zinvol een "Open dit scherm"-knop.
 *
 * - Rol bepaalt de inhoud: monteur ziet de monteur-versie, technieker de
 *   technieker-versie (mét betaaldeel); bureel ziet standaard de technieker-
 *   versie en krijgt een wisselknop. Blokken kunnen per rol gefilterd worden
 *   via `rol: 'monteur'|'technieker'` (weglaten = beide).
 * - Zoeken: genormaliseerd (kleine letters, accenten weg) over titels,
 *   tekstblokken, vragen/antwoorden en de woordenlijst; resultaat springt
 *   naar het blok en markeert de zoekterm.
 *
 * Geen DOM-referenties bij load; app.js levert de dunne controllers
 * (openHandleiding / hlZoek / hlOpen / hlRol).
 */
(function () {
    'use strict';

    // Link naar een ander hoofdstuk (vervangt "zie hoofdstuk X" van papier).
    function L(slug, tekst) {
        return '<a href="javascript:void(0)" onclick="app.hlOpen(\'' + slug + '\')" ' +
            'style="color:var(--qe-orange,#F99D3E);font-weight:600;text-decoration:underline">' + tekst + '</a>';
    }

    /* ─────────────────────────── INHOUD ─────────────────────────── */
    // Blok-types: p · stap (n) · letop · tip · kaart (kop) · faq (items [q,a])
    //             woorden (items [term,uitleg]) · stappenlijst (items) · knop (scherm)
    var H = [

    /* ══ DEEL: VOOR JE BEGINT ══ */
    { slug: 'nodig', deel: 'Voor je begint', kick: 'Voor je begint', titel: 'Wat heb je nodig?', lead: 'Drie dingen. Meer niet.', blokken: [
        { t: 'p', h: '<b>1. De QE Werkbon-app</b> op je werktelefoon. Staat hij er niet op? Bel Levi — hij zet hem erop.' },
        { t: 'p', h: '<b>2. NFC aan</b> op je telefoon. Dat is het "tikken zoals bankcontactloos". Veeg van boven naar beneden over je scherm en kijk of het NFC-knopje aan staat. Meestal staat het altijd aan.' },
        { t: 'p', h: '<b>3. Internet</b> (4G of wifi). Geen internet op de werf? De app onthoudt alles en verstuurt het later vanzelf — zie ' + L('offline', 'Geen internet?') + '.', rol: 'monteur' },
        { t: 'p', h: '<b>3. Internet</b> (4G of wifi). Voor het <b>betalen</b> heb je internet nodig — de rest onthoudt de app ook zonder, zie ' + L('offline', 'Geen internet?') + '.', rol: 'technieker' },
        { t: 'faq', items: [
            ['Moet ik iets betalen of installeren?', 'Nee. De app staat op je wérktelefoon en kantoor regelt alles. Jij hoeft alleen in te loggen.'],
            ['Waar vind ik dat NFC-knopje?', 'Veeg van boven naar beneden over je scherm. Tussen wifi en bluetooth staat "NFC". Staat hij grijs? Tik erop zodat hij oplicht.'],
            ['Heb ik een betaalterminal nodig?', 'Alleen als je met Bancontact laat betalen. De QR-code werkt zónder terminal — de klant scant met zijn eigen telefoon.', 'technieker'],
        ] },
    ] },

    { slug: 'inloggen', deel: 'Voor je begint', kick: 'Eén keer doen', titel: 'Inloggen', lead: 'Dit doe je maar één keer. Daarna blijf je gewoon ingelogd.', blokken: [
        { t: 'stap', n: 1, h: 'Open de app. Typ je <b>e-mailadres van het werk</b> (eindigt op <b>@qe.be</b>) en tik op <b>Verder</b>.' },
        { t: 'stap', n: 2, h: 'Typ je <b>PIN-code</b>: 4 tot 6 cijfers. Allereerste keer? Dan kies je nu zelf een PIN — kies cijfers die je makkelijk onthoudt.' },
        { t: 'tip', h: 'Je hoeft hierna nooit meer in te loggen. Alleen als je PIN opnieuw gezet wordt.' },
        { t: 'faq', items: [
            ['Ik weet mijn e-mailadres niet.', 'Bel Levi. Het is bijna altijd jouw voornaam + @qe.be.'],
            ['Ik ben mijn PIN vergeten.', 'Bel Levi. Hij zet je PIN terug op nul. Daarna kies je bij het inloggen gewoon een nieuwe.'],
            ['Er staat "e-mailadres niet gevonden".', 'Kijk of je alles juist typte (geen spatie, geen hoofdletters nodig). Lukt het nog niet? Bel Levi — dan zet hij je account goed.'],
            ['Ik heb een nieuwe telefoon.', 'App erop (laat Levi helpen), inloggen met je e-mail en je PIN — klaar. Al je gegevens staan veilig op kantoor, niet op je oude telefoon.'],
            ['Kan iemand anders op mijn account?', 'Niet zonder jouw PIN. Geef je PIN dus aan niemand door.'],
        ] },
    ] },

    { slug: 'app', deel: 'Voor je begint', kick: 'Even rondkijken', titel: 'Zo zit de app in elkaar', lead: 'Vier knoppen onderaan, drie dingen bovenaan.', blokken: [
        { t: 'p', h: '<b>Onderaan staan 4 knoppen:</b><br><b>Planning</b> — jouw klanten van vandaag. Hier begin je.<br><b>Klok</b> — in- en uitklokken en je uren.<br><b>Klaar</b> — de werkbonnen die je al verstuurd hebt.<br><b>Aanvragen</b> — verlof aanvragen en materieel lenen.' },
        { t: 'p', h: '<b>Bovenaan rechts:</b> de <b>ⓘ-knop</b> legt élk scherm uit (' + L('hulp', 'Hulp in de app') + ') · het <b>rondje met je letter of foto</b> = je profiel · de <b>groene tekst</b> toont of je ingeklokt bent en sinds hoe laat.' },
        { t: 'p', h: '<b>De gekleurde woorden</b> op de planningskaarten tonen het soort werk: <b style="color:var(--green2,#2e7d32)">Onderhoud</b> (groen), <b style="color:#E88A2A">Herstelling</b> (oranje), <b style="color:#6A2C91">Installatie</b> (paars).' },
        { t: 'faq', items: [
            ['Ik ben "verdwaald" in de app.', 'Tik onderaan op Planning. Dan sta je terug op het startscherm. Er kan niets mis gaan door rond te tikken.'],
            ['Mijn scherm ziet er anders uit dan bij een collega.', 'Waarschijnlijk staat de tekst groter of donkerder ingesteld (zie "De app aanpassen aan jou"). De knoppen en woorden blijven dezelfde.'],
            ['Wat betekent de groene tekst bovenaan?', 'Dat je ingeklokt bent, en sinds hoe laat. Staat er niets of "Niet ingeklokt"? Dan ben je uitgeklokt.'],
        ] },
    ] },

    /* ══ DEEL: JOUW WERKDAG ══ */
    { slug: 'inklokken', deel: 'Jouw werkdag', kick: "'s Morgens", titel: 'Inklokken', lead: 'Zo weet de app hoe laat je begon. Belangrijk voor je loon.', scherm: 'screenClock', blokken: [
        { t: 'stap', n: 1, h: 'Houd je telefoon <b>tegen de NFC-tag</b>. Die hangt aan het <b>bureau</b> en in de <b>camionet</b>. Je voelt een trilling en het scherm reageert.' },
        { t: 'stap', n: 2, h: 'Kijk op het Klok-scherm: staat er <b>groen "INGEKLOKT"</b> met de juiste tijd? Dan is het gelukt.' },
        { t: 'p', h: '<b>De regels, simpel uitgelegd:</b><br>• Je tijd wordt afgerond op <b>kwartieren</b>, met 4 minuten speling (inklokken om 06:48 telt als 06:45).<br>• <b>Vroeger komen mag altijd</b> — je uren tellen vanaf je startuur.<br>• Klok je <b>ná je startuur</b> in? Dan staat er "te laat" bij die dag.<br>• <b>Weekend</b> = alles telt automatisch als <b>overuren</b>.<br>• Meer dan <b>8 uur</b> op één dag? Alles erboven wordt vanzelf overuren.<br>• Je <b>pauze</b> wordt automatisch verrekend, één keer per dag.' },
        { t: 'letop', h: '<b>Ook ’s middags klokken?</b> Nee. Eén keer in als je dag begint, één keer uit als hij stopt. De pauze regelt de app zelf.' },
        { t: 'faq', items: [
            ['Ik ben vergeten in te klokken!', 'Geen paniek. Klok → Mijn uren bekijken → tik op de dag → kies "Vergeten in te klokken". Kantoor zet het recht.'],
            ['De tag doet niets.', '1) Kijk of NFC aan staat. 2) Haal je telefoon uit een dikke hoes. 3) Houd de bóvenkant tegen de tag en tel tot twee. Blijft het niet lukken? Bel — dan wordt je tijd handmatig gezet.'],
            ['Moet ik ook inklokken als ik rechtstreeks naar de werf rijd?', 'Scan dan de tag in de camionet. Geen tag in de buurt? Bel het bureau, zij klokken je in.'],
            ['Wat is "L&L" / laden & lossen?', 'Een aparte tag voor laden en lossen ná je werkuren. Die uren komen apart op je telling. Alleen gebruiken als het je gevraagd wordt.'],
            ['Ik was te vroeg. Krijg ik die tijd betaald?', 'Je uren tellen vanaf je startuur. Vroeger komen mag, maar de teller start op je normale beginuur.'],
        ] },
    ] },

    { slug: 'planning', deel: 'Jouw werkdag', kick: 'Jouw dag', titel: 'Je planning', lead: 'Al je klanten van vandaag, in de juiste volgorde.', scherm: 'screenPlanning', blokken: [
        { t: 'stap', n: 1, h: 'Tik onderaan op <b>Planning</b>. Je ziet je klanten van vandaag, met uur en adres.' },
        { t: 'stap', n: 2, h: 'Met de <b>dag-knopjes</b> bovenaan (ma, di, wo…) kijk je vooruit naar morgen.' },
        { t: 'stap', n: 3, h: 'Op elke kaart staan twee knopjes rechts: <b>bellen</b> (belt meteen de klant) en <b>route</b> (opent de GPS met het adres al ingevuld).' },
        { t: 'stap', n: 4, h: 'Ben je bij de klant? <b>Tik op de kaart</b> — dan opent de werkorder.' },
        { t: 'p', h: '<b>De wacht-balk</b> (met het schildje, boven je planning) toont wie deze week de <b>wacht</b> heeft. Tik erop voor de komende weken. Heb jíj de wacht, dan kleurt de balk oranje.' },
        { t: 'faq', items: [
            ['Mijn planning is leeg.', 'Trek het scherm even naar beneden om te verversen. Nog leeg? Dan is er (nog) niets ingepland — bel het bureau als dat niet klopt.'],
            ['Er kwam een nieuwe klant bij, zie ik dat?', 'Ja. De app kijkt elke 5 minuten of er iets bijkwam en toont dan een melding.'],
            ['Wat betekent "In bewerking" op een kaart?', 'Dat je al uren of materiaal invulde op die werkorder. Handig om te zien waar je mee bezig was.'],
            ['Wat betekent "Regie"?', 'Dat alle tijd en materiaal aan de klant wordt doorgerekend. Vul dan extra nauwkeurig in.'],
            ['Moet ik de klanten in deze volgorde doen?', 'Meestal wel — kantoor plant de route zo. Moet je afwijken? Even bellen met het bureau.'],
            ['Wie heeft er deze week de wacht?', 'Kijk op de wacht-balk boven je planning (het schildje). Tik erop om ook de komende weken te zien. De wacht zelf wordt door het bureau gepland — klopt iets niet, bel het bureau.'],
        ] },
    ] },

    { slug: 'wo-info', deel: 'Jouw werkdag', kick: 'De werkorder · tabblad 1', titel: 'De werkorder: Info', lead: 'Bovenin de werkorder staan 4 tabbladen: Info · Uren · Materiaal · Foto’s.', blokken: [
        { t: 'stap', n: 1, h: 'Op <b>Info</b> zie je de klant (adres, telefoon) en de <b>installatie</b> waar je voor komt.' },
        { t: 'stap', n: 2, h: 'Staat er een <b>taakomschrijving</b>? Lees die eerst — daar staat wat je moet doen.' },
        { t: 'stap', n: 3, h: 'Onderaan is een vak voor <b>opmerkingen</b>. Schrijf kort op wat je deed of wat de klant zei. Dat komt op de werkbon.' },
        { t: 'tip', h: 'Zie je een paarse knop <b>"Mee te nemen"</b>? Tik erop vóór je vertrekt — daar staat wat je moet meenemen naar deze klant.' },
        { t: 'faq', items: [
            ['Het adres of telefoonnummer klopt niet.', 'Bel het bureau — zij passen het aan in het systeem. Verander zelf niets op de bon.'],
            ['Er staat geen taakomschrijving.', 'Dan zie je aan het soort werk (Onderhoud, Herstelling…) wat de bedoeling is. Twijfel? Bel even.'],
            ['Wat schrijf ik in het opmerkingen-vak?', 'Kort en duidelijk: wat je deed, wat je zag, wat de klant vroeg. Bv.: "Ketel onderhouden, brander gereinigd. Klant vraagt offerte nieuwe thermostaat."'],
        ] },
    ] },

    { slug: 'wo-uren', deel: 'Jouw werkdag', kick: 'De werkorder · tabblad 2', titel: 'Uren invullen', lead: 'De timer doet het werk voor jou.', blokken: [
        { t: 'stap', n: 1, h: 'Tik op het tabblad <b>Uren</b>.' },
        { t: 'stap', n: 2, h: 'Begin je met werken? Tik op de <b>groene knop</b> — de timer start.' },
        { t: 'stap', n: 3, h: 'Klaar? Tik nog eens — de timer stopt. De tijd wordt netjes afgerond op kwartieren.' },
        { t: 'stap', n: 4, h: 'Vul bij <b>"Wat heb je gedaan?"</b> kort in wat je deed. Dat ziet de klant op de werkbon.' },
        { t: 'p', h: 'Timer vergeten? Geen probleem: tik op <b>"+ Uren toevoegen"</b> en vul de uren met de hand in.' },
        { t: 'letop', h: '<b>De uurcode</b> (het vakje bovenaan) staat bijna altijd al juist. Verander die alleen als kantoor het vraagt.' },
        { t: 'faq', items: [
            ['Ik ben vergeten de timer te stoppen.', 'Stop hem alsnog en pas het blok aan met "+ Uren toevoegen" (of verwijder het foute blok en zet het juiste erin).'],
            ['Ik werkte met twee man — moeten we allebei uren invullen?', 'Ja. Iedereen vult zijn eigen uren in op zijn eigen telefoon.'],
            ['Ik deed twee klanten na elkaar. Hoe verdeel ik mijn uren?', 'Start de timer bij klant 1 en stop hem daar als je vertrekt. Bij klant 2 open je díe werkorder en start je opnieuw. Elke klant krijgt zo zijn eigen uren.'],
            ['Tellen deze uren ook voor mijn loon?', 'Je loon volgt uit je in- en uitklok. De uren op de werkorder zijn voor de klant en de werkbon. Vul dus allebei goed in.'],
        ] },
    ] },

    { slug: 'wo-materiaal', deel: 'Jouw werkdag', kick: 'De werkorder · tabblad 3', titel: 'Materiaal invullen', lead: 'Alles wat je gebruikt hebt, zet je op de bon.', blokken: [
        { t: 'stap', n: 1, h: 'Tik op het tabblad <b>Materiaal</b> en typ in het <b>zoekvak</b> de naam van het stuk (bv. "kraan"). Na twee letters begint de app te zoeken.' },
        { t: 'stap', n: 2, h: 'Tik in de lijst op het juiste artikel — het staat meteen op de bon met aantal 1.', rol: 'monteur' },
        { t: 'stap', n: 2, h: 'Tik in de lijst op het juiste artikel — het staat meteen op de bon met aantal 1. Je ziet de <b>prijs</b> er al bij; die staat vast in het systeem.', rol: 'technieker' },
        { t: 'stap', n: 3, h: 'Meer gebruikt? Pas het <b>aantal</b> aan. Fout stuk? Tik erop en verwijder het weer.' },
        { t: 'p', h: 'Niet gevonden? Tik op <b>"Zoek op artikelgroep"</b> (bladeren per groep) of kies <b>"Eenmalig artikel"</b> en typ zelf de naam — kantoor zet het dan goed.' },
        { t: 'p', h: '<b>Regie-klant?</b> Vul ook het blok "Verplaatsingskosten" in: typ de gemeente en de app kiest zelf de juiste zone.' },
        { t: 'letop', h: '<b>Vul het meteen in</b>, terwijl je nog bij de klant staat. Straks in de camionet ben je de helft vergeten — dat is verlies voor de zaak.' },
        { t: 'faq', items: [
            ['Ik vind het artikel niet.', 'Zoek met een korter woord ("kraan" i.p.v. "vulkraantje"). Nog niets? "Zoek op artikelgroep" of "Eenmalig artikel".'],
            ['Ik weet niet hoe het stuk officieel heet.', 'Kies "Eenmalig artikel" en schrijf gewoon op wat het is ("koppelstuk 15 mm"). Kantoor maakt er het juiste artikel van.'],
            ['Klein verbruik (tape, schroefjes) — ook invullen?', 'Ja, als het op de lijst staat. Beter één keer te veel dan telkens vergeten.'],
            ['Ik gebruikte iets uit de camionet van een collega.', 'Gewoon invullen op jouw werkbon — het gaat om wat de klánt kreeg, niet uit wiens bak het kwam.'],
            ['De prijs in de lijst lijkt me fout.', 'Gewoon het artikel kiezen — de prijzen beheert kantoor. Denk je écht dat er iets mis is? Zet het in de opmerkingen of bel even.', 'technieker'],
        ] },
    ] },

    { slug: 'wo-fotos', deel: 'Jouw werkdag', kick: 'De werkorder · tabblad 4', titel: 'Foto’s maken', lead: 'Foto’s zijn jouw bewijs dat het werk goed gedaan is.', blokken: [
        { t: 'stap', n: 1, h: 'Tik op het tabblad <b>Foto’s</b> en dan op de <b>camera-knop</b>.' },
        { t: 'stap', n: 2, h: 'Maak duidelijke foto’s van je werk. <b>Meerdere foto’s mag altijd</b> — beter te veel dan te weinig.' },
        { t: 'stap', n: 3, h: 'Goede gewoonte: een foto <b>vóór</b> je begint en een foto <b>ná</b> je werk. Zo is er nooit discussie.' },
        { t: 'letop', h: 'Bij een <b>onderhoud</b> is minstens <b>één foto van het attest verplicht</b>. Zonder die foto kan de werkbon niet verstuurd worden — de app houdt je tegen.' },
        { t: 'tip', h: 'Je foto’s blijven bewaard, óók als de app herstart of je even geen internet hebt. Je raakt ze niet kwijt.' },
        { t: 'faq', items: [
            ['Mijn foto is mislukt of onscherp.', 'Maak gewoon een nieuwe. Een slechte foto kan je verwijderen zolang de werkbon niet verstuurd is.'],
            ['Hoeveel foto’s zijn genoeg?', 'Bij onderhoud: het attest + het toestel. Bij een herstelling: het probleem vóór en het resultaat ná. Twijfel? Maak er één extra.'],
            ['Komen die foto’s op mijn eigen telefoon te staan?', 'Nee, ze horen bij de werkbon en gaan naar kantoor. Ze vullen je eigen galerij niet.'],
            ['Te donker in de stookruimte?', 'Zet het licht aan of gebruik de flits.'],
        ] },
    ] },

    /* — werkbon: aparte versie per rol — */
    { slug: 'werkbon', deel: 'Jouw werkdag', rol: 'monteur', kick: 'Klaar bij de klant', titel: 'Werkbon versturen', lead: 'Alles ingevuld? Twee keer tikken en het is binnen bij kantoor.', blokken: [
        { t: 'stap', n: 1, h: 'Tik onderaan de werkorder op <b>"Werkbon bekijken"</b>.' },
        { t: 'stap', n: 2, h: 'Je ziet het overzicht: je uren, je materiaal, je foto’s. <b>Kijk het even na.</b>' },
        { t: 'stap', n: 3, h: 'Klopt alles? Tik op <b>"Werkbon versturen"</b>. Zie je het donkerblauwe scherm met het <b>vinkje</b> — dan is hij binnen. Klaar!' },
        { t: 'p', h: 'Het vakje <b>"Geen factuur maken"</b> vink je alleen aan bij <b>garantie of terugkomwerk</b>. Twijfel je? Niet aanvinken en even bellen.' },
        { t: 'tip', h: '<b>Geen internet op de werf?</b> Gewoon versturen. De werkbon komt in de <b>wachtrij</b> en vertrekt vanzelf zodra je weer internet hebt. Zie ' + L('offline', 'Geen internet?') + '.' },
        { t: 'faq', items: [
            ['Ik heb iets verkeerd ingevuld en al verstuurd.', 'Ga naar Klaar → tik op die werkbon → geef een correctie door. Het origineel blijft staan; kantoor ziet het verschil netjes.'],
            ['De app zegt dat er een foto ontbreekt.', 'Bij onderhoud is een foto van het attest verplicht. Maak die foto — daarna kan je wél versturen.'],
            ['Hoe weet ik zeker dat hij verstuurd is?', 'Je ziet het vinkje-scherm én de werkbon staat daarna onder "Klaar". Staat er "wachtrij"? Dan vertrekt hij zodra er internet is.'],
            ['Moet de klant tekenen of betalen?', 'Nee. Jij verstuurt alleen de werkbon. Kantoor maakt de factuur en regelt de betaling.'],
        ] },
    ] },

    { slug: 'werkbon', deel: 'Jouw werkdag', rol: 'technieker', kick: 'Klaar bij de klant · stap 1', titel: 'Werkbon: nakijken & handtekening', lead: 'Eerst alles nakijken mét de klant, dan laten tekenen, dan betalen.', blokken: [
        { t: 'stap', n: 1, h: 'Tik onderaan de werkorder op <b>"Werkbon bekijken"</b>.' },
        { t: 'stap', n: 2, h: 'Kijk het overzicht na, liefst <b>samen met de klant</b>: uren, materialen, de <b>BTW</b> (6% bij een woning ouder dan 10 jaar, anders 21%) en het <b>totaal</b>.' },
        { t: 'stap', n: 3, h: 'Kies onderaan de <b>betaalmethode</b> (' + L('betalen-kiezen', 'welke wanneer?') + ') en tik op <b>"Ondertekenen &amp; Versturen"</b>.' },
        { t: 'stap', n: 4, h: 'Het <b>handtekening-vak</b> klapt open. Typ de <b>naam van de klant</b> en geef je telefoon — de klant <b>tekent met de vinger</b>. Foutje? Tik "Wis".' },
        { t: 'stap', n: 5, h: 'Wil de klant de werkbon <b>per e-mail</b>? Vul het e-mailveld in (het knopje ernaast haalt het adres uit het systeem).' },
        { t: 'stap', n: 6, h: 'Tik nogmaals op <b>"Ondertekenen &amp; Versturen"</b>. De app maakt de <b>factuur</b> en opent het betaalscherm van de gekozen methode.' },
        { t: 'p', h: 'Het vakje <b>"Geen factuur maken"</b> vink je alleen aan bij <b>garantie of terugkomwerk</b> — dan is er geen factuur en geen betaling. Twijfel? Bellen.' },
        { t: 'letop', h: '<b>Bij onderhoud is de handtekening verplicht</b> — de app verwittigt je als ze ontbreekt.' },
        { t: 'faq', items: [
            ['De klant wil niet tekenen.', 'Leg uit dat het gewoon bevestigt dat het werk is uitgevoerd. Blijft het een probleem? Bel kantoor vóór je verstuurt.'],
            ['Er klopt iets niet in het totaal.', 'Ga terug naar de tabbladen Uren of Materiaal en verbeter het daar. Het overzicht rekent zichzelf opnieuw uit.'],
            ['Welk BTW-tarief moet ik kiezen?', 'Meestal kiest de app het zelf op basis van de klantgegevens. Zie je het verkeerde tarief? Bel kantoor — niet gokken.'],
            ['Mag ik korting geven?', 'Ja: tik onder het totaal op "+ Korting toevoegen" — percentage of een bedrag in euro, eventueel met een reden. Een bedrag in euro is wat de klant écht minder betaalt (€15 korting = €15 van het eindtotaal). De korting komt als aparte lijn op de factuur en het te betalen bedrag (QR/Bancontact/cash) past zich automatisch aan. Weghalen kan met het kruisje naast de korting-regel.'],
        ] },
    ] },

    /* ══ DEEL: BETALEN (alleen technieker) ══ */
    { slug: 'betalen-kiezen', deel: 'Betalen bij de klant', rol: 'technieker', kick: 'Klaar bij de klant · stap 2', titel: 'Welke betaalmethode wanneer?', lead: 'Er moet altijd betaald worden vóór je vertrekt. Dit zijn je opties.', blokken: [
        { t: 'kaart', kop: 'QR-code — eerste keus', h: 'De klant scant met zijn telefoon en betaalt meteen (Bancontact, kaart, Apple Pay…). Direct bevestigd in de app. Werkt bij bijna iedereen. → ' + L('betalen-qr', 'Betalen met QR-code') },
        { t: 'kaart', kop: 'Bancontact', h: 'Het bedrag verschijnt vanzelf op de <b>betaalterminal</b>; de klant tikt zijn kaart. → ' + L('betalen-bancontact', 'Betalen met Bancontact') },
        { t: 'kaart', kop: 'Cash', h: 'Contant geld. De app rekent het <b>wisselgeld</b> voor je uit. → ' + L('betalen-cash', 'Contant betalen') },
        { t: 'kaart', kop: 'Overschrijving ter plaatse', h: 'De klant schrijft <b>nu meteen</b> over met zijn bank-app (QR met alles al ingevuld). → ' + L('betalen-overschrijving', 'Overschrijving & via factuur') },
        { t: 'kaart', kop: 'Via factuur', h: 'De klant betaalt <b>later</b> na ontvangst van de factuur. <b>Alleen als dat zo afgesproken is</b> met kantoor (vaste klanten, firma’s). → ' + L('betalen-overschrijving', 'Overschrijving & via factuur') },
        { t: 'letop', h: '<b>De prijs op het scherm is de prijs.</b> Reken nooit extra kosten aan voor kaart, QR of terminal — dat mag niet, bij geen enkele betaalmethode.' },
        { t: 'faq', items: [
            ['De klant vraagt "kan ik ook …?"', 'Met de QR-code kan bijna alles: Bancontact, kredietkaart, Apple/Google Pay. Bij twijfel: QR.'],
            ['De klant kan of wil nu écht niet betalen.', 'Niet zelf beslissen: bel kantoor. Zij zeggen of "Via factuur" mag of wat je moet doen.'],
            ['Het is garantiewerk.', 'Dan is er niets te betalen: vink "Geen factuur maken" aan op de werkbon.'],
        ] },
    ] },

    { slug: 'betalen-qr', deel: 'Betalen bij de klant', rol: 'technieker', kick: 'Betalen · methode 1', titel: 'Betalen met QR-code', lead: 'De klant scant, betaalt en jij ziet meteen "Betaald". Geen terminal nodig.', blokken: [
        { t: 'stap', n: 1, h: 'Kies op de werkbon <b>"QR code"</b> en verstuur. De app maakt de QR aan.' },
        { t: 'stap', n: 2, h: '<b>Toon je scherm aan de klant.</b> Die scant de code met de <b>camera</b> of de <b>bank-app</b> en kiest zelf hoe hij betaalt (Bancontact, kaart, Apple Pay…).' },
        { t: 'stap', n: 3, h: 'Kijk naar <b>"Wachten op betaling…"</b> onderaan. Zodra de klant klaar is, springt dat op <b>Betaald</b> — en zie je het bevestigingsscherm.' },
        { t: 'tip', h: 'De QR blijft <b>24 uur geldig</b>. Betaalt de klant pas later via dezelfde QR, dan wordt de factuur automatisch afgepunt.' },
        { t: 'faq', items: [
            ['De klant krijgt de QR niet gescand.', 'Zet je schermhelderheid hoger. Lukt het nog niet? De bank-app van de klant heeft ook een scanner — of kies een andere methode (Bancontact/cash).'],
            ['"Wachten op betaling…" blijft staan, maar de klant zegt dat het gelukt is.', 'Geef het een halve minuut. Nog niets? Kijk bij Klaar → "Laatste betaling" of vraag de klant zijn bevestiging te tonen. Onduidelijk? Bel kantoor — niet dubbel laten betalen.'],
            ['Ik heb het scherm per ongeluk gesloten.', 'Geen probleem: de QR blijft 24u geldig en de betaling wordt automatisch verwerkt. Via Klaar → "Laatste betaling" kan je alles bekijken of aanpassen.'],
        ] },
    ] },

    { slug: 'betalen-bancontact', deel: 'Betalen bij de klant', rol: 'technieker', kick: 'Betalen · methode 2', titel: 'Betalen met Bancontact (terminal)', lead: 'Eén tik en het bedrag staat op de betaalterminal.', blokken: [
        { t: 'stap', n: 1, h: 'Kies op de werkbon <b>"Bancontact"</b> en verstuur. Je komt op het <b>Betaling</b>-scherm.' },
        { t: 'stap', n: 2, h: 'Controleer het <b>bedrag</b> en tik op <b>"Betalen via terminal"</b>.' },
        { t: 'stap', n: 3, h: 'Het bedrag <b>verschijnt vanzelf op de terminal</b>. De klant tikt of steekt zijn kaart in — klaar.' },
        { t: 'stap', n: 4, h: 'Je ziet <b>"Betaald — automatisch geboekt in Robaws"</b>. Verder hoef je niets te doen.' },
        { t: 'p', h: 'Onder de knop zie je welke terminal gebruikt wordt (tik "wijzig" voor een andere). Stel je vaste terminal in via ' + L('profiel', 'je profiel') + ' — dan hoef je nooit meer te kiezen.' },
        { t: 'letop', h: '<b>"Betaling overslaan" gebruik je niet zomaar.</b> Alleen als kantoor het zegt — anders blijft de factuur open staan.' },
        { t: 'faq', items: [
            ['Er verschijnt niets op de terminal.', 'Kijk of de terminal aan staat en internet heeft. Nog niets? Tik nogmaals, of kies gewoon de QR-code — die werkt altijd.'],
            ['De kaart van de klant wordt geweigerd.', 'Laat het opnieuw proberen of gebruik de QR-code (daar kan de klant ook met een andere kaart of app betalen).'],
            ['Welke terminal staat er ingesteld?', 'Dat zie je onder de betaalknop, en je past het aan via Profiel → Instellingen → Standaard terminal.'],
        ] },
    ] },

    { slug: 'betalen-cash', deel: 'Betalen bij de klant', rol: 'technieker', kick: 'Betalen · methode 3', titel: 'Contant betalen', lead: 'De app rekent het wisselgeld uit. Jij telt alleen het geld na.', blokken: [
        { t: 'stap', n: 1, h: 'Kies op de werkbon <b>"Cash"</b> en verstuur. Je komt op het <b>Contant betalen</b>-scherm.' },
        { t: 'stap', n: 2, h: 'Typ het bedrag dat de klant je geeft bij <b>"Ontvangen bedrag"</b> — of tik een knopje (<b>Gepast</b>, € 180, € 200…).' },
        { t: 'stap', n: 3, h: 'De app toont het <b>wisselgeld</b> in het groen. Geef dat terug en tik op <b>"Afronden"</b>.' },
        { t: 'stap', n: 4, h: 'Geef het geld af op kantoor <b>zoals afgesproken</b>. De boekhouding verwerkt het verder.' },
        { t: 'faq', items: [
            ['Ik heb niet genoeg wisselgeld.', 'Vraag of de klant gepast kan geven, of stel de QR-code voor — daar is geen wisselgeld voor nodig.'],
            ['De klant wil deels cash en deels met kaart betalen.', 'Dat kan de app niet in één keer. Kies één methode, of bel kantoor voor de juiste oplossing.'],
            ['Twijfel aan een briefje?', 'Vriendelijk een ander vragen, of een andere betaalmethode voorstellen.'],
        ] },
    ] },

    { slug: 'betalen-overschrijving', deel: 'Betalen bij de klant', rol: 'technieker', kick: 'Betalen · methode 4 & 5', titel: 'Overschrijving & via factuur', lead: 'Voor klanten zonder kaart of cash — of met een betaal-afspraak.', blokken: [
        { t: 'p', h: '<b>Overschrijving ter plaatse:</b>' },
        { t: 'stap', n: 1, h: 'Kies op de werkbon <b>"Overschrijving ter plaatse"</b> en verstuur. Je krijgt een scherm met bedrag, IBAN, mededeling én een QR.' },
        { t: 'stap', n: 2, h: '<b>Toon het aan de klant.</b> Die scant de QR met zijn <b>bank-app</b> — alles staat er al in. Overtypen kan ook.' },
        { t: 'stap', n: 3, h: 'Laat de klant de <b>bevestiging in de bank-app tonen</b> ("overschrijving uitgevoerd"). Kies dan <b>Betaald</b>. Niet gelukt of niet gedaan? Kies eerlijk <b>Niet betaald</b> — de factuur blijft dan open tot het geld er is.' },
        { t: 'p', h: '<b>Via factuur</b> (alleen op afspraak): kies <b>"Via factuur"</b>, vul het <b>e-mailadres</b> van de klant in en verstuur. De klant krijgt de factuur en betaalt later.' },
        { t: 'letop', h: '<b>Kies nooit "Betaald" om ervan af te zijn.</b> Het geld is pas binnen als de bank het ziet. Eerlijk kiezen = geen gedoe achteraf.' },
        { t: 'faq', items: [
            ['De klant heeft geen bank-app.', 'De gegevens staan ook leesbaar op het scherm — de klant kan ze thuis overtypen. Kies dan "Niet betaald"; de factuur blijft open tot de betaling binnenkomt.'],
            ['Mag ik zelf beslissen om "Via factuur" te doen?', 'Nee. Dat is alleen voor klanten waar kantoor het zo geregeld heeft. Twijfel? Bellen.'],
            ['Wat is die "gestructureerde mededeling"?', 'De code met +++ ervoor en erna. Daarmee herkent de bank automatisch welke factuur betaald wordt. De QR vult hem vanzelf in.'],
        ] },
    ] },

    /* ══ DEEL: NAKIJKEN & RECHTZETTEN ══ */
    { slug: 'uitklokken', deel: 'Nakijken & rechtzetten', kick: 'Einde van de dag', titel: 'Uitklokken + kilometers', lead: 'Scan de tag. Vul je kilometers in. Bevestig. In die volgorde.', scherm: 'screenClock', blokken: [
        { t: 'stap', n: 1, h: 'Houd je telefoon <b>tegen de NFC-tag</b>, net zoals ’s morgens.' },
        { t: 'stap', n: 2, h: 'De app vraagt je <b>kilometers</b>: heen en terug. Vul ze in.' },
        { t: 'stap', n: 3, h: 'Kies je <b>mobiliteit</b>: chauffeur (alleen of met passagiers) of passagier.' },
        { t: 'stap', n: 4, h: 'Tik op <b>"Uitklokken bevestigen"</b>. Nu pas ben je uitgeklokt. Tik je op "Annuleren"? Dan blijf je gewoon ingeklokt.' },
        { t: 'stap', n: 5, h: 'Daarna zie je het <b>"Dag afgerond"-scherm</b> met je uren en kilometers. Dit scherm = alles is binnen. Op vrijdag krijg je het weekend-scherm, mét muziekje.' },
        { t: 'letop', h: '<b>Steek je telefoon pas weg als je het eindscherm zag.</b> Dan weet je zeker dat je uitgeklokt bent én je kilometers binnen zijn.' },
        { t: 'faq', items: [
            ['Ik ben vergeten uit te klokken.', 'De app merkt dat de volgende ochtend en helpt je de dag netjes af te sluiten. Klopt de tijd niet? Vraag een aanpassing aan.'],
            ['Ik weet mijn kilometers niet precies.', 'Kijk op de teller van de camionet, of schat eerlijk. Zelfde rit als altijd? Dan weet je het getal zo.'],
            ['Ik reed rechtstreeks van de werf naar huis.', 'Vink dan het vakje "Rechtstreeks van werf naar thuis gereden" aan op het kilometer-scherm.'],
            ['Ik was passagier, moet ik ook km invullen?', 'Vul de rit in en kies "Passagier" bij mobiliteit. Dan klopt alles voor de administratie.'],
            ['Ik moet ’s avonds nog laden voor morgen.', 'Dat is L&L (laden & lossen): scan de aparte L&L-tag ná je gewone uitklok. Die uren komen er netjes bij.'],
        ] },
    ] },

    { slug: 'klaar', deel: 'Nakijken & rechtzetten', kick: 'Controle achteraf', titel: 'Klaar: je verstuurde werkbonnen', lead: 'Alles wat je verstuurde — en fouten zet je hier recht.', scherm: 'screenUitgevoerd', blokken: [
        { t: 'stap', n: 1, h: 'Tik onderaan op <b>Klaar</b>. Je ziet je verstuurde werkbonnen per dag, de nieuwste bovenaan, met bonnummer, uren en materialen.', rol: 'monteur' },
        { t: 'stap', n: 1, h: 'Tik onderaan op <b>Klaar</b>. Bovenaan staat <b>"Laatste betaling"</b>: factuur, bedrag en betaalwijze. Daaronder je werkbonnen per dag.', rol: 'technieker' },
        { t: 'stap', n: 2, h: '<b>Verkeerde betaalwijze gekozen?</b> (klant betaalde toch cash i.p.v. QR?) Tik op de kaart "Laatste betaling" en pas de betaalwijze aan.', rol: 'technieker' },
        { t: 'p', h: 'Zie je een oranje label <b>"1 correctie"</b>? Dan heb je die bon al eens verbeterd — kantoor ziet beide versies.' },
        { t: 'stap', n: 3, h: '<b>Fout ontdekt?</b> Tik op de werkbon → het correctie-scherm opent.' },
        { t: 'stap', n: 4, h: 'Zet de <b>uren</b> en <b>aantallen</b> op wat het écht moest zijn (het totaal, niet het verschil). De app rekent zelf het verschil uit — dat zie je in het paarse zinnetje.' },
        { t: 'stap', n: 5, h: 'Schrijf bij <b>Opmerkingen</b> kort waarom, en tik op <b>"Correctie versturen"</b>. Het origineel blijft altijd bestaan.' },
        { t: 'faq', items: [
            ['Ik was materiaal vergeten op te schrijven.', 'Klaar → tik op de bon → zet het aantal juist (of voeg het artikel toe) → "Correctie versturen".'],
            ['Ik had te véél ingevuld.', 'Zelfde weg: zet het totaal op het juiste (lagere) getal. Het verschil wordt dan een minnetje — helemaal prima.'],
            ['Kan ik een foto nog toevoegen na het versturen?', 'Nee, foto’s gaan mee met de originele bon. Belangrijke foto vergeten? Bel kantoor.'],
            ['Hoe ver terug kan ik corrigeren?', 'Je recente bonnen staan in de lijst. Al ouder of al gefactureerd/betaald? Bel kantoor in plaats van te corrigeren.'],
            ['De klant heeft toch anders betaald dan ik aanduidde.', 'Klaar → "Laatste betaling" → betaalwijze aanpassen. Alleen de laatste betaling kan zo — oudere gevallen: bel kantoor.', 'technieker'],
        ] },
    ] },

    { slug: 'uren-nakijken', deel: 'Nakijken & rechtzetten', kick: 'Controle', titel: 'Je uren nakijken', lead: 'Altijd zien hoeveel uren je hebt — per dag en per maand.', scherm: 'screenDagoverzicht', blokken: [
        { t: 'stap', n: 1, h: 'Tik onderaan op <b>Klok</b>, dan op <b>"Mijn uren bekijken"</b>.' },
        { t: 'stap', n: 2, h: 'Bovenaan staan de <b>maandtotalen</b> (totaal, werkuren, overuren, dagen). Daaronder elke dag apart. Met ‹ › blader je naar vorige maanden.' },
        { t: 'stap', n: 3, h: 'Bij elke dag staat een label: <b style="color:var(--green2,#2e7d32)">Op tijd</b>, <b style="color:#6A2C91">Overuren</b>, verlof… Zo zie je meteen wat voor dag het was.' },
        { t: 'stap', n: 4, h: '<b>Klopt een dag niet?</b> Tik op die dag — dan kom je bij de aanpassing-aanvraag (' + L('aanpassing', 'zo werkt dat') + ').' },
        { t: 'faq', items: [
            ['Er staat "te laat" bij een dag, maar dat klopt niet.', 'Tik op de dag en vraag een aanpassing aan met de echte tijden. Vince kijkt het na.'],
            ['Waar zie ik mijn overuren?', 'Bovenaan bij de maandtotalen (paars cijfer) en per dag met een paars label. Weekend telt automatisch als overuren.'],
            ['Ziekte of verlof — staat dat er ook tussen?', 'Ja, die dagen staan gewoon in de lijst met hun eigen label.'],
            ['Kloppen deze cijfers met mijn loonbrief?', 'Dit zijn de geklokte uren waar kantoor mee rekent. Zie je een verschil? Bel Vince.'],
        ] },
    ] },

    { slug: 'aanpassing', deel: 'Nakijken & rechtzetten', kick: 'Foutje in je uren?', titel: 'Vergeten te klokken? Aanpassing aanvragen', lead: 'Twee tikken en Vince zet het recht.', scherm: 'screenDagoverzicht', blokken: [
        { t: 'stap', n: 1, h: 'Ga naar <b>Klok → Mijn uren bekijken</b> en <b>tik op de dag</b> die niet klopt.' },
        { t: 'stap', n: 2, h: 'Kies wat er mis is: <b>Vergeten in te klokken</b>, <b>Vergeten uit te klokken</b>, <b>Verkeerd inkloktijdstip</b>, <b>Verkeerd uitkloktijdstip</b>, <b>Verkeerd type</b> of <b>Iets anders</b>.' },
        { t: 'stap', n: 3, h: 'Vul de <b>juiste tijden</b> in (die velden verschijnen vanzelf) en zet er eventueel een <b>toelichting</b> bij.' },
        { t: 'stap', n: 4, h: 'Tik op <b>"Aanvraag versturen"</b>. Je aanvraag gaat rechtstreeks naar Vince — je hoeft nergens achteraan te bellen.' },
        { t: 'tip', h: 'Doe dit <b>zo snel mogelijk</b> nadat je het merkt — dan weet je de juiste tijden nog uit je hoofd.' },
        { t: 'faq', items: [
            ['Hoe weet ik dat het aangepast is?', 'Kijk een dag later even in "Mijn uren bekijken" — daar zie je de verbeterde tijden staan.'],
            ['Ik koos de verkeerde reden.', 'Stuur gewoon een nieuwe aanvraag met de juiste reden, en zet er kort bij dat de vorige fout was.'],
            ['Het gaat over een hele week.', 'Dan is bellen met Vince sneller dan vijf losse aanvragen.'],
        ] },
    ] },

    { slug: 'maandrecap', deel: 'Nakijken & rechtzetten', kick: 'Leuk extraatje', titel: 'Je maandoverzicht in beeldjes', lead: 'Jouw uren, kilometers en records — als een klein filmpje.', scherm: 'screenRecap', blokken: [
        { t: 'stap', n: 1, h: 'Klok je op de <b>laatste werkdag van de maand</b> uit? Dan start vanzelf jouw <b>maandrecap</b>: een reeks beeldjes met je cijfers.' },
        { t: 'stap', n: 2, h: '<b>Tik rechts</b> voor het volgende beeldje, <b>links</b> om terug te gaan. Het kruisje rechtsboven sluit af.' },
        { t: 'stap', n: 3, h: 'Later nog eens bekijken? <b>Klok → "Maandrecap"</b> — daar staan ook je vorige maanden.' },
        { t: 'tip', h: 'Gewoon leuk om te zien. Niemand "beoordeelt" je erop, en collega’s zien jouw cijfers niet.' },
        { t: 'faq', items: [
            ['Ik heb hem per ongeluk weggeklikt.', 'Klok → "Maandrecap" → kies de maand. Daar staat hij gewoon opnieuw.'],
        ] },
    ] },

    /* ══ DEEL: AANVRAGEN ══ */
    { slug: 'verlof', deel: 'Aanvragen', kick: 'Vrij vragen', titel: 'Verlof aanvragen', lead: 'Een dagje vrij of een week vakantie — rechtstreeks vanuit de app.', scherm: 'screenAanvragen', blokken: [
        { t: 'stap', n: 1, h: 'Tik onderaan op <b>Aanvragen</b>. Je staat meteen op <b>Verlof</b>. Bovenaan zie je je <b>saldo</b>.' },
        { t: 'stap', n: 2, h: 'Kies de <b>eerste dag</b> en de <b>laatste dag</b>. Tik op <b>"Verlof aanvragen"</b>. Klaar!' },
        { t: 'stap', n: 3, h: 'Je aanvraag verschijnt onderaan met een status: eerst <b>Aangevraagd</b>, daarna <b>Goedgekeurd</b> of <b>Geweigerd</b>.' },
        { t: 'stap', n: 4, h: '<b>Tik op een aanvraag</b> voor het detail: de beslissing van kantoor en hun bericht. Typ onderaan om <b>zelf te reageren</b> — je bericht staat op jouw naam.' },
        { t: 'letop', h: '<b>Ziek?</b> Dat gaat NIET via de app. <b>Bel ’s morgens naar het bureau.</b> Verlof = app, ziekte = bellen.' },
        { t: 'faq', items: [
            ['Hoe lang duurt de goedkeuring?', 'Kantoor krijgt je aanvraag meteen binnen. Je ziet de beslissing in de app zodra ze beslist hebben — meestal dezelfde dag.'],
            ['Kan ik een aanvraag intrekken?', 'Stuur een berichtje in het detail van je aanvraag, of bel even.'],
            ['Mijn saldo klopt niet volgens mij.', 'Bel Levi — het jaartotaal staat op je fiche op kantoor en kan daar aangepast worden.'],
            ['Eén losse dag of een halve dag?', 'Eén dag: kies dezelfde dag als eerste én laatste dag. Halve dag: zet het erbij in je aanvraag of stuur een berichtje.'],
        ] },
    ] },

    { slug: 'materieel', deel: 'Aanvragen', kick: 'Camionet of machine nodig?', titel: 'Materieel lenen', lead: 'Reserveer in de app — dan weet iedereen dat hij bezet is.', scherm: 'screenAanvragen', blokken: [
        { t: 'stap', n: 1, h: 'Tik onderaan op <b>Aanvragen</b> en dan bovenaan op <b>Materieel</b>. Je ziet per machine of hij <b>nu vrij</b> is (groen), in gebruik (oranje) of gereserveerd (blauw).' },
        { t: 'stap', n: 2, h: 'Tik op wat je nodig hebt en kijk in de <b>agenda</b> welke dagen al bezet zijn (oranje).' },
        { t: 'stap', n: 3, h: 'Kies je <b>datums</b>, typ kort waarvoor, en tik op <b>"Reserveren aanvragen"</b>. Botsen je datums met een andere reservatie? Dan blokkeert de app dat meteen.' },
        { t: 'stap', n: 4, h: 'Volg de status via <b>"Vorige aanvragingen"</b>: Aangevraagd → Goedgekeurd → In gebruik → Teruggebracht.' },
        { t: 'stap', n: 5, h: '<b>Klaar met de machine?</b> Tik bij je reservatie op <b>"Teruggebracht"</b> — dan kan een collega hem weer lenen.' },
        { t: 'faq', items: [
            ['De camionet is bezet op mijn dag.', 'Kies een andere dag in de agenda, of bel wie hem gereserveerd heeft (kantoor ziet wie) om te ruilen.'],
            ['Ik heb hem maar een halve dag nodig.', 'Reserveer die ene dag en zet het in de opmerking ("enkel voormiddag"). Breng hem daarna meteen terug en tik "Teruggebracht".'],
            ['Iets kapot aan de machine?', 'Meld het meteen aan het bureau. Niet stilletjes terugzetten.'],
            ['Ik heb hem dringend NU nodig, zonder reservatie.', 'Staat hij op "Nu beschikbaar"? Reserveer hem snel voor vandaag en neem hem mee. Bezet? Bel kantoor — niet zomaar meenemen.'],
        ] },
    ] },

    /* ══ DEEL: JOUW APP ══ */
    { slug: 'profiel', deel: 'Jouw app', kick: 'Van jou', titel: 'Je profiel: foto, PIN en updates', lead: 'Tik rechtsboven op het rondje met je letter of foto.', scherm: 'screenProfile', blokken: [
        { t: 'stap', n: 1, h: 'Tik <b>rechtsboven op het rondje</b>. Je ziet groepen die je kan openklappen: <b>Instellingen</b>, <b>Toegankelijkheid</b> en <b>App bijwerken</b>.' },
        { t: 'stap', n: 2, h: '<b>Profielfoto?</b> Bovenaan bij je naam: <b>Camera</b> (nieuwe foto) of <b>Galerij</b> (bestaande). De app maakt hem zelf klein en scherp.' },
        { t: 'stap', n: 3, h: '<b>Standaard terminal</b> (belangrijk!): open <b>Instellingen</b> en kies het toestel waar jij mee werkt. Vanaf dan gaat elke Bancontact-betaling <b>direct</b> naar die terminal — zonder keuzescherm.', rol: 'technieker' },
        { t: 'stap', n: 4, h: '<b>PIN veranderen?</b> Instellingen → <b>PIN wijzigen</b>: typ je huidige PIN, dan twee keer je nieuwe (4-6 cijfers), en bevestig.' },
        { t: 'stap', n: 5, h: '<b>App bijwerken?</b> Gebeurt vanzelf. Zelf kijken kan: open die groep en tik op <b>"Controleren"</b>. Staat er "up-to-date"? Dan heb je de nieuwste versie.' },
        { t: 'faq', items: [
            ['Mijn foto staat er scheef of lelijk op.', 'Maak gewoon een nieuwe met Camera of kies een andere uit je Galerij. De nieuwste foto telt.'],
            ['Moet ik een profielfoto hebben?', 'Het hoeft niet, maar het is handig — collega’s en kantoor zien dan meteen wie je bent.'],
            ['"PIN wijzigen" zegt dat mijn huidige PIN fout is.', 'Probeer rustig opnieuw. Weet je hem echt niet meer? Bel Levi — reset, en je kiest een nieuwe bij het inloggen.'],
        ] },
    ] },

    { slug: 'toegankelijkheid', deel: 'Jouw app', kick: 'Beter leesbaar', titel: 'De app aanpassen aan jou', lead: 'Grotere letters, meer contrast, donker scherm — in twee tikken.', scherm: 'screenProfile', blokken: [
        { t: 'p', h: 'Profiel → <b>Toegankelijkheid</b>. Kies wat jou helpt:<br>• <b>Tekst- &amp; knopgrootte</b> op <b>Groot</b> of <b>Extra groot</b> — ideaal met handschoenen.<br>• <b>Donker thema</b> — rustiger in donkere stookruimtes.<br>• <b>Vetgedrukte tekst</b> en <b>hoog contrast</b> — beter leesbaar in de zon.<br>• <b>Minder beweging</b> — geen animaties.<br>• <b>Kleurenblind-stand</b> — past de kleuren aan zodat labels uit elkaar te houden zijn.' },
        { t: 'tip', h: 'Alles wat je hier kiest, blijft zo staan — ook na het herstarten van de app. En kantoor merkt er niets van.' },
        { t: 'faq', items: [
            ['Ik wil terug naar normaal.', 'Zet de keuzes gewoon terug (grootte op "Normaal", schakelaars uit). Klaar.'],
            ['De letters zijn nu zó groot dat het scherm vol staat.', 'Dat is normaal bij "Extra groot" — je moet iets meer scrollen. Te veel? Kies "Groot".'],
        ] },
    ] },

    { slug: 'hulp', deel: 'Jouw app', kick: 'Vergeten hoe iets werkt?', titel: 'Hulp in de app zelf', lead: 'De ⓘ-knop legt elk scherm uit — en deze handleiding is er altijd.', blokken: [
        { t: 'stap', n: 1, h: 'Sta je ergens en weet je het niet meer? Tik <b>rechtsboven op de ⓘ-knop</b>.' },
        { t: 'stap', n: 2, h: 'Je krijgt uitleg over <b>precies dat scherm</b>, stap voor stap. De <b>oranje ring</b> wijst aan waar je moet tikken.' },
        { t: 'stap', n: 3, h: 'Onderaan die uitleg start je ook de <b>volledige rondleiding</b> — of open je deze <b>handleiding</b>.' },
        { t: 'tip', h: 'De ⓘ-uitleg en deze handleiding kan je <b>zo vaak openen als je wil</b>. Niemand ziet hoe vaak je ze gebruikt.' },
    ] },

    /* ══ DEEL: ALS HET MISLOOPT ══ */
    { slug: 'offline', deel: 'Als het misloopt', kick: 'Slecht bereik?', titel: 'Geen internet? Zo werkt de wachtrij', lead: 'Kelders, stookruimtes, afgelegen werven — de app is erop gebouwd.', blokken: [
        { t: 'p', rol: 'monteur', h: '<b>De korte versie: werk gewoon door.</b> Alles wat je invult — uren, materiaal, foto’s, werkbonnen, je in- en uitklok — wordt op je telefoon bewaard. Zodra er weer internet is, verstuurt de app het <b>vanzelf</b>.' },
        { t: 'p', rol: 'monteur', h: '<b>Werkbon versturen zonder bereik?</b> Gewoon op "Werkbon versturen" tikken. Je ziet een melding dat hij in de <b>wachtrij</b> staat. Dat is normaal — hij vertrekt automatisch zodra er internet is.' },
        { t: 'p', rol: 'technieker', h: '<b>Dit werkt gewoon zonder internet:</b> in- en uitklokken, uren en materiaal invullen, foto’s maken, opmerkingen schrijven. Alles wordt bewaard en later vanzelf doorgestuurd.' },
        { t: 'p', rol: 'technieker', h: '<b>Dit werkt NIET zonder internet: een werkbon versturen mét betaling.</b> Er moet altijd betaald worden — en betalen (QR, terminal, de factuur aanmaken) heeft internet nodig. <b>Zoek dus even bereik</b>: buiten, aan de camionet, of via de wifi van de klant. Meestal is één streepje 4G genoeg.' },
        { t: 'p', rol: 'technieker', h: '<b>De enige uitzondering:</b> een werkbon met <b>"Geen factuur maken"</b> (garantie/terugkomwerk). Die mag in de wachtrij en vertrekt vanzelf zodra er weer internet is.' },
        { t: 'p', h: 'Onderaan het <b>Klok</b>-scherm staat de knop <b>"Offline registraties synchroniseren"</b>. Heb je weer bereik en wil je niet wachten? Eén tik en alles wat klaarstond, vertrekt meteen.' },
        { t: 'letop', h: '<b>Inklokken lukt ook zonder internet</b> — de scan wordt bewaard en later doorgestuurd. Je uren gaan dus nooit verloren, ook niet in de diepste kelder.' },
        { t: 'faq', items: [
            ['Er staat al de hele dag "wachtrij".', 'Zodra je ergens wifi of 4G hebt, verstuurt hij vanzelf. Blijft hij staan? Klok-scherm → "Offline registraties synchroniseren", of bel even.'],
            ['Ben ik mijn foto’s kwijt als de app crasht zonder internet?', 'Nee. Foto’s blijven veilig op je telefoon staan tot ze verstuurd zijn — ook na een herstart.'],
            ['Mijn planning laadt niet zonder internet.', 'Klopt — de planning komt van kantoor en heeft internet nodig. Bekijk hem ’s morgens even, dan weet je waar je moet zijn.'],
            ['Ik heb écht nergens bereik en de klant staat te wachten.', 'Vraag of je even op de wifi van de klant mag — dat is genoeg om te versturen en te laten betalen. Lukt niets? Bel kantoor zodra je bereik hebt.', 'technieker'],
            ['De QR-betaling lukte, maar daarna viel mijn internet weg.', 'Geen probleem — de betaling is bij de bank al gebeurd en wordt automatisch verwerkt. Controleer later gerust bij Klaar → "Laatste betaling".', 'technieker'],
        ] },
    ] },

    { slug: 'problemen', deel: 'Als het misloopt', kick: 'Als het even niet lukt', titel: 'Problemen oplossen + wie bel ik?', lead: 'Negen op de tien keer is het één van deze. Kom je er niet uit? Bellen.', blokken: [
        { t: 'faq', kop: 'Telefoon & NFC', items: [
            ['De NFC-tag doet niets.', 'Kijk of NFC aan staat (veeg van boven naar beneden). Haal je telefoon uit een dikke hoes. Houd de bóvenkant tegen de tag en tel tot twee.'],
            ['De app doet raar of blijft hangen.', 'Sluit de app helemaal af en open hem opnieuw. Dat lost het bijna altijd op. Je bent niets kwijt — alles blijft bewaard.'],
            ['Mijn batterij was leeg midden op de dag.', 'Opladen, app openen — alles staat er nog. Niet kunnen klokken? Vraag een aanpassing aan.'],
            ['Het scherm is gebarsten / de telefoon is stuk.', 'Bel Levi voor een oplossing. Je gegevens staan op kantoor, niet in de telefoon — er gaat niets verloren.'],
        ] },
        { t: 'faq', kop: 'Betalen', rol: 'technieker', items: [
            ['Er verschijnt niets op de terminal.', 'Terminal aan? Internet? Probeer opnieuw, of kies de QR-code — die werkt altijd, zonder terminal.'],
            ['De QR wil niet scannen.', 'Scherm helderder zetten. Of laat de klant de scanner in zijn bank-app gebruiken. Anders: Bancontact of cash.'],
            ['"Wachten op betaling…" blijft staan maar de klant betaalde.', 'Halve minuut geduld. Dan: Klaar → "Laatste betaling" controleren, of de klant zijn bevestiging laten tonen. Onduidelijk? Bel — nooit dubbel laten betalen.'],
            ['Verkeerde betaalmethode aangeduid.', 'Klaar → "Laatste betaling" → tik en pas aan.'],
            ['De klant kan niet betalen.', 'Bel kantoor vóór je vertrekt. Zij beslissen. Niet zelf "Betaald" kiezen als er niet betaald is.'],
        ] },
        { t: 'faq', kop: 'Internet', items: [
            ['Geen bereik op de werf.', 'Invullen kan altijd. Zie het hoofdstuk "Geen internet?" voor wat wel en niet kan zonder bereik.'],
        ] },
        { t: 'faq', kop: 'Fouten rechtzetten', items: [
            ['Verkeerde uren of vergeten te klokken.', 'Klok → Mijn uren bekijken → tik op de dag → kies de reden → versturen. Vince zet het recht.'],
            ['Werkbon verstuurd met een fout erin.', 'Klaar → tik op de werkbon → correctie doorgeven. Het origineel blijft bestaan.'],
            ['Verkeerde foto op de werkbon.', 'Maak een extra, juiste foto vóór het versturen. Al verstuurd? Bel even met kantoor.'],
        ] },
        { t: 'faq', kop: 'Wie bel ik?', items: [
            ['Voor de app, je PIN, je account of een kapotte telefoon:', 'Bel Levi.'],
            ['Voor betaal-problemen (QR/terminal):', 'Bel Levi.', 'technieker'],
            ['Voor je uren en aanpassingen:', 'Bel Vince (maar de aanpassing-aanvraag in de app is meestal sneller).'],
            ['Voor je planning, klanten of materieel:', 'Bel het bureau.'],
            ['Ziek melden:', 'Bel ’s morgens naar het bureau. Niet via de app.'],
        ] },
    ] },

    { slug: 'woordenlijst', deel: 'Als het misloopt', kick: 'Wat betekent…?', titel: 'Woordenlijst', lead: 'Alle woorden uit de app, kort uitgelegd.', blokken: [
        { t: 'woorden', items: [
            ['NFC-tag', 'Het "tik-plaatje" aan het bureau en in de camionet. Telefoon ertegen = in- of uitklokken.'],
            ['Werkorder', 'De opdracht bij een klant, met de tabbladen Info · Uren · Materiaal · Foto’s.'],
            ['Werkbon', 'Het eindresultaat dat je verstuurt naar kantoor: jouw uren + materiaal + foto’s van die klant.'],
            ['Factuur', 'De rekening die de app na het versturen aanmaakt. Die betaalt de klant meteen bij jou.', 'technieker'],
            ['Gestructureerde mededeling', 'De code met +++ ervoor en erna. Daarmee herkent de bank automatisch welke factuur betaald wordt.', 'technieker'],
            ['QR-code (betalen)', 'De klant scant met zijn telefoon en betaalt meteen — Bancontact, kaart of Apple/Google Pay.', 'technieker'],
            ['Bancontact (terminal)', 'De betaalmethode waarbij het bedrag vanzelf op de betaalterminal verschijnt.', 'technieker'],
            ['Standaard terminal', 'De terminal die jouw Bancontact-betalingen automatisch krijgt. In te stellen op je profiel.', 'technieker'],
            ['Overschrijvings-QR', 'QR voor de bank-app van de klant: bedrag, IBAN en mededeling al ingevuld.', 'technieker'],
            ['Via factuur', 'De klant betaalt later, na ontvangst van de factuur. Alleen op afspraak met kantoor.', 'technieker'],
            ['Correctie-werkbon', 'Een verbetering op een al verstuurde werkbon. Het origineel blijft staan; kantoor ziet het verschil.'],
            ['Onderhoud', 'Gepland nazicht van een toestel (groen label). Attest-foto verplicht.'],
            ['Herstelling', 'Iets is kapot en jij maakt het (oranje label).'],
            ['Installatie', 'Nieuw toestel plaatsen (paars label).'],
            ['Regie', 'Alle tijd en materiaal wordt aan de klant doorgerekend. Extra nauwkeurig invullen dus.'],
            ['Attest', 'Het officiële papier na een onderhoud. Foto ervan = verplicht op de werkbon.'],
            ['Uurcode', 'Het soort uren op de werkorder. Staat bijna altijd al juist — alleen veranderen als kantoor het vraagt.'],
            ['Overuren', 'Uren boven de 8 per dag, en álle uren in het weekend. De app rekent ze zelf uit.'],
            ['Kwartier-afronding', 'Je kloktijd wordt afgerond op kwartieren, met 4 minuten speling (06:48 telt als 06:45).'],
            ['L&L (laden & lossen)', 'Aparte tag voor laden/lossen ná je werkuren. Alleen gebruiken als het gevraagd wordt.'],
            ['Wacht(dienst)', 'De technieker die die week oproepbaar is buiten de uren. Zie de wacht-balk boven je planning; het bureau plant de beurtrol.'],
            ['Wachtrij', 'Waar je werkbon even wacht als er geen internet is. Vertrekt vanzelf zodra er weer bereik is.'],
            ['Synchroniseren', 'Alles wat nog op je telefoon klaarstond alsnog versturen. Knop onderaan het Klok-scherm.'],
            ['Maandrecap', 'Jouw maand in beeldjes: uren, kilometers, records. Verschijnt vanzelf op het einde van de maand.'],
            ['Materieel', 'Camionetten en machines van de zaak die je kan reserveren via Aanvragen → Materieel.'],
            ['Verlofsaldo', 'Hoeveel verlof je nog over hebt dit jaar. Staat bovenaan op de Verlof-pagina.'],
            ['PIN', 'Jouw geheime cijfercode (4-6 cijfers) om in te loggen. Kwijt? Bel Levi.'],
            ['Update', 'Nieuwe versie van de app. Wordt vanzelf binnengehaald — jij hoeft niets te doen.'],
            ['ⓘ-knop', 'De hulpknop rechtsboven: uitleg over het scherm waar je op staat, met oranje aanwijs-ring.'],
        ] },
    ] },

    { slug: 'spiekbriefje', deel: 'Als het misloopt', kick: 'Spiekbriefje', titel: 'Jouw dag in het kort', lead: 'De hele dag op één blaadje.', blokken: [
        { t: 'stappenlijst', rol: 'monteur', items: [
            '<b>Inklokken</b> — telefoon tegen de tag, check groen "INGEKLOKT".',
            '<b>Planning</b> — kijk waar je moet zijn. Route-knop = GPS.',
            '<b>Bij de klant</b> — tik op de kaart, timer aan.',
            '<b>Invullen</b> — uren, materiaal en foto’s. Meteen, niet straks.',
            '<b>Versturen</b> — overzicht nakijken → "Werkbon versturen" → vinkje.',
            '<b>Uitklokken</b> — tag scannen → kilometers → "Uitklokken bevestigen" → "Dag afgerond".',
            '<b>Foutje?</b> — Klaar = correctie · Klok = uren-aanpassing.',
            '<b>Twijfel?</b> — ⓘ-knop of deze handleiding, of bel Levi/Vince.',
        ] },
        { t: 'stappenlijst', rol: 'technieker', items: [
            '<b>Inklokken</b> — telefoon tegen de tag, check groen "INGEKLOKT".',
            '<b>Planning</b> — kijk waar je moet zijn. Route-knop = GPS.',
            '<b>Bij de klant</b> — tik op de kaart, timer aan.',
            '<b>Invullen</b> — uren, materiaal en foto’s. Meteen, niet straks.',
            '<b>Nakijken</b> — werkbon samen met de klant overlopen.',
            '<b>Tekenen &amp; versturen</b> — betaalmethode kiezen → klant tekent → versturen.',
            '<b>Betalen</b> — QR eerst; anders Bancontact, cash of overschrijving. Check "Betaald".',
            '<b>Uitklokken</b> — tag scannen → kilometers → bevestigen → "Dag afgerond".',
            '<b>Twijfel?</b> — ⓘ-knop of deze handleiding, of bel Levi/Vince.',
        ] },
    ] },
    ];

    /* ─────────────────────────── MOTOR ─────────────────────────── */

    function norm(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    function stripTags(h) {
        return String(h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    // Rol van een item (hoofdstuk/blok/faq-rij) matchen tegen de actieve rol.
    function rolOk(itemRol, rol) {
        return !itemRol || itemRol === rol;
    }

    function hoofdstukken(rol) {
        return H.filter(function (h) { return rolOk(h.rol, rol); });
    }

    // Alle doorzoekbare tekst van een blok (zonder HTML).
    function blokTekst(b) {
        if (b.t === 'faq') {
            return (b.kop ? b.kop + ' ' : '') + b.items.map(function (i) { return i[0] + ' ' + i[1]; }).join(' ');
        }
        if (b.t === 'woorden') return b.items.map(function (i) { return i[0] + ' ' + i[1]; }).join(' ');
        if (b.t === 'stappenlijst') return stripTags(b.items.join(' '));
        return stripTags(b.h) + (b.kop ? ' ' + b.kop : '');
    }

    /** Zoek in alle hoofdstukken van deze rol. Geeft [{h, nummer, blokIdx, snippet}] */
    function zoek(query, rol) {
        var q = norm(query);
        if (q.length < 2) return [];
        var res = [];
        var lijst = hoofdstukken(rol);
        lijst.forEach(function (h, hi) {
            var titelHit = norm(h.titel).indexOf(q) >= 0 || norm(h.lead || '').indexOf(q) >= 0;
            var eerste = null;
            h.blokken.forEach(function (b, bi) {
                if (!rolOk(b.rol, rol)) return;
                var txt = blokTekst(b);
                // faq/woorden-rijen kunnen zelf rol-gefilterd zijn (3e element)
                if ((b.t === 'faq' || b.t === 'woorden') && b.items) {
                    txt = (b.kop ? b.kop + ' ' : '') + b.items
                        .filter(function (i) { return rolOk(i[2], rol); })
                        .map(function (i) { return i[0] + ' ' + i[1]; }).join(' ');
                }
                var pos = norm(txt).indexOf(q);
                if (pos >= 0 && res.length < 40) {
                    var start = Math.max(0, pos - 34);
                    var snip = (start > 0 ? '…' : '') + txt.substr(start, 110) + (start + 110 < txt.length ? '…' : '');
                    res.push({ h: h, nummer: hi + 1, blokIdx: bi, snippet: snip });
                    if (eerste == null) eerste = bi;
                }
            });
            if (titelHit && eerste == null && res.length < 40) {
                res.push({ h: h, nummer: hi + 1, blokIdx: -1, snippet: stripTags(h.lead || '') });
            }
        });
        // hoogstens 1 resultaat per hoofdstuk+blok; titel-hits eerst
        return res;
    }

    /* — HTML-renderers (Marble-stijl, inline zoals de rest van de app) — */

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function faqHtml(b, rol) {
        var rows = b.items.filter(function (i) { return rolOk(i[2], rol); }).map(function (i) {
            return '<div style="padding:11px 0;border-bottom:1px solid var(--l1,#ece8de)">' +
                '<div style="font-size:14px;font-weight:700;color:var(--qe-darkblue)"><span style="color:var(--qe-orange)">Vraag:</span> ' + esc(i[0]) + '</div>' +
                '<div style="font-size:13.5px;margin-top:3px;line-height:1.55"><span style="color:var(--green2,#2e7d32);font-weight:700">→</span> ' + esc(i[1]) + '</div></div>';
        }).join('');
        if (!rows) return '';
        return '<div class="card" style="padding:4px 16px;margin:14px 0">' +
            (b.kop ? '<div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--qe-grey);margin:12px 0 2px">' + esc(b.kop) + '</div>'
                   : '<div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--qe-grey);margin:12px 0 2px">Vragen &amp; antwoorden</div>') +
            rows + '</div>';
    }

    function blokHtml(b, rol) {
        if (b.t === 'p') return '<div class="card" style="padding:13px 16px;margin-bottom:10px;font-size:14px;line-height:1.6">' + b.h + '</div>';
        if (b.t === 'stap') return '<div style="display:flex;gap:12px;align-items:flex-start;margin:0 2px 12px">' +
            '<span style="flex-shrink:0;width:26px;height:26px;border-radius:50%;background:var(--qe-orange);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13.5px;margin-top:1px">' + b.n + '</span>' +
            '<div style="flex:1;font-size:14px;line-height:1.6">' + b.h + '</div></div>';
        if (b.t === 'letop') return '<div style="background:var(--awash,#FBF3E4);border:1.5px solid var(--aborder,#F99D3E);border-radius:12px;padding:12px 14px;margin:14px 0;font-size:13.5px;line-height:1.55"><b style="color:var(--amber2,#E88A2A)">Let op!</b> ' + b.h + '</div>';
        if (b.t === 'tip') return '<div style="background:var(--gwash,#EAF3EC);border:1.5px solid var(--gborder2,#2e7d32);border-radius:12px;padding:12px 14px;margin:14px 0;font-size:13.5px;line-height:1.55"><b style="color:var(--green2,#2e7d32)">Tip:</b> ' + b.h + '</div>';
        if (b.t === 'kaart') return '<div class="card" style="padding:13px 16px;margin-bottom:10px"><div style="font-size:14px;font-weight:700;color:var(--qe-darkblue)">' + b.kop + '</div><div style="font-size:13.5px;margin-top:3px;line-height:1.55">' + b.h + '</div></div>';
        if (b.t === 'faq') return faqHtml(b, rol);
        if (b.t === 'woorden') {
            var rows = b.items.filter(function (i) { return rolOk(i[2], rol); }).map(function (i) {
                return '<div style="padding:10px 0;border-bottom:1px solid var(--l1,#ece8de)">' +
                    '<div style="font-size:13.5px;font-weight:700;color:var(--qe-darkblue)">' + esc(i[0]) + '</div>' +
                    '<div style="font-size:13px;margin-top:2px;line-height:1.5">' + esc(i[1]) + '</div></div>';
            }).join('');
            return '<div class="card" style="padding:4px 16px;margin-bottom:10px">' + rows + '</div>';
        }
        if (b.t === 'stappenlijst') {
            var lis = b.items.map(function (it, i) {
                return '<div style="display:flex;gap:12px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--l1,#ece8de)">' +
                    '<span style="flex-shrink:0;min-width:24px;height:24px;border-radius:50%;background:var(--qe-orange);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:12.5px">' + (i + 1) + '</span>' +
                    '<span style="font-size:14px;line-height:1.55">' + it + '</span></div>';
            }).join('');
            return '<div class="card" style="padding:6px 16px;margin-bottom:10px">' + lis + '</div>';
        }
        return '';
    }

    function hoofdstukHtml(h, nummer, rol) {
        var html = '<div style="border-bottom:2px solid var(--ink,#26334B);padding-bottom:12px;margin-bottom:16px">' +
            '<div style="font-size:11px;font-weight:600;color:var(--qe-grey);letter-spacing:.06em;text-transform:uppercase">' + esc(h.kick) + '</div>' +
            '<div style="display:flex;align-items:center;gap:12px;margin-top:4px">' +
                '<span style="flex-shrink:0;min-width:38px;height:38px;border-radius:10px;background:var(--qe-darkblue,#001E45);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:18px;font-weight:800">' + nummer + '</span>' +
                '<h2 style="font-size:22px;font-weight:700;letter-spacing:-0.5px;line-height:1.15;color:var(--ink,#26334B);margin:0">' + esc(h.titel) + '</h2>' +
            '</div>' +
            (h.lead ? '<div style="font-size:13.5px;color:var(--qe-grey);margin-top:6px">' + esc(h.lead) + '</div>' : '') +
        '</div>';
        h.blokken.forEach(function (b, bi) {
            if (!rolOk(b.rol, rol)) return;
            html += '<div data-hlblok="' + bi + '">' + blokHtml(b, rol) + '</div>';
        });
        if (h.scherm) {
            html += '<button class="btn btn-outline btn-full" style="margin-top:6px" onclick="app.navigate(\'' + h.scherm + '\', true)">Open dit scherm in de app →</button>';
        }
        return html;
    }

    function inhoudHtml(rol) {
        var lijst = hoofdstukken(rol);
        var html = '', vorigDeel = null;
        lijst.forEach(function (h, i) {
            if (h.deel !== vorigDeel) {
                vorigDeel = h.deel;
                html += '<div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--amber2,#E88A2A);margin:18px 4px 8px">' + esc(h.deel) + '</div>';
            }
            html += '<div class="card card-clickable" onclick="app.hlOpen(\'' + h.slug + '\')" style="margin-bottom:8px;padding:13px 16px;display:flex;align-items:center;gap:12px;cursor:pointer">' +
                '<span style="flex-shrink:0;min-width:28px;height:28px;border-radius:50%;background:var(--qe-orange);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13px">' + (i + 1) + '</span>' +
                '<div style="flex:1;min-width:0"><div style="font-size:14.5px;font-weight:600;color:var(--ink,#26334B)">' + esc(h.titel) + '</div>' +
                (h.lead ? '<div style="font-size:12px;color:var(--qe-grey);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(h.lead) + '</div>' : '') + '</div>' +
                '<span style="flex-shrink:0;color:var(--qe-grey)">→</span></div>';
        });
        return html;
    }

    function resultatenHtml(res, query) {
        if (!res.length) {
            return '<div class="card" style="padding:20px 16px;text-align:center;color:var(--qe-grey);font-size:13.5px">Niets gevonden voor "<b>' + esc(query) + '</b>".<br>Probeer een korter woord, of blader hieronder door de hoofdstukken.</div>';
        }
        var q = norm(query);
        return '<div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--qe-grey);margin:2px 4px 8px">' + res.length + ' ' + (res.length === 1 ? 'resultaat' : 'resultaten') + '</div>' +
            res.map(function (r) {
                var sn = esc(r.snippet);
                // zoekterm vet-oranje markeren in de snippet (op de genormaliseerde positie)
                var pos = norm(r.snippet).indexOf(q);
                if (pos >= 0) {
                    sn = esc(r.snippet.substr(0, pos)) + '<mark style="background:rgba(249,157,62,0.35);border-radius:3px;padding:0 1px">' +
                        esc(r.snippet.substr(pos, query.length)) + '</mark>' + esc(r.snippet.substr(pos + query.length));
                }
                return '<div class="card card-clickable" onclick="app.hlOpen(\'' + r.h.slug + '\',' + r.blokIdx + ',this)" style="margin-bottom:8px;padding:12px 16px;cursor:pointer">' +
                    '<div style="font-size:13.5px;font-weight:700;color:var(--qe-darkblue)">' + r.nummer + '. ' + esc(r.h.titel) + '</div>' +
                    '<div style="font-size:12.5px;color:var(--qe-grey);margin-top:3px;line-height:1.5">' + sn + '</div></div>';
            }).join('');
    }

    // Zoekterm markeren in het geopende hoofdstuk (alleen tekst-nodes; veilig voor HTML).
    function markeer(container, query) {
        if (!query || query.length < 2) return;
        var q = norm(query);
        var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function (node) {
            var txt = node.nodeValue || '';
            var pos = norm(txt).indexOf(q);
            if (pos < 0) return;
            var span = document.createElement('span');
            span.innerHTML = esc(txt.substr(0, pos)) +
                '<mark style="background:rgba(249,157,62,0.35);border-radius:3px;padding:0 1px">' + esc(txt.substr(pos, query.length)) + '</mark>' +
                esc(txt.substr(pos + query.length));
            node.parentNode.replaceChild(span, node);
        });
    }

    window.QEHandleiding = {
        hoofdstukken: hoofdstukken,
        zoek: zoek,
        inhoudHtml: inhoudHtml,
        resultatenHtml: resultatenHtml,
        hoofdstukHtml: hoofdstukHtml,
        markeer: markeer,
        vind: function (slug, rol) {
            var lijst = hoofdstukken(rol);
            for (var i = 0; i < lijst.length; i++) if (lijst[i].slug === slug) return { h: lijst[i], nummer: i + 1 };
            return null;
        },
    };
})();
