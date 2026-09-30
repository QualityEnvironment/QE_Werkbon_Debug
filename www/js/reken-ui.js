/* QE Rekenmachine — gedeelde UI (v410, Marble; v411: zeven modules)
 * BRON = QE-Software/reken-ui.js; kopie in de www via `node sync-reken.js`.
 *
 * QERekenUI.mount(host, { breed, onTitel, toast }) tekent de rekenmachine in `host`
 * (app-scherm of hub-pagina). Eigen CSS (één keer ingespoten), kleuren via de Marble-tokens van de
 * gastheer (--bg/--card/--ink/--g1/--b1/--accent …) met terugval op de lichte waarden.
 * Geen netwerk, geen DOM buiten host.
 *
 * Schermen: start (zoeken, modules, favorieten, recent) → module (groepen) → berekening
 * (invoer links/boven, uitkomst rechts/onder, live). instance.terug() = één stap terug
 * (true als er iets te sluiten was; de gastheer koppelt er zijn terugknop aan).
 *
 * Opmaakregels (QE-DESIGN-SYSTEM-MARBLE.md): hairlines in plaats van zware randen, grote titels licht
 * (400), kleine labels vet en in hoofdletters, één accentkleur, tabulaire cijfers, lijn-iconen
 * (geen emoji), rijen met een hairline in plaats van kaarten in kaarten.
 */
(function (root) {
    'use strict';
    var R = root.QEReken;
    if (!R) throw new Error('reken-kern.js eerst laden');

    // ------------------------------------------------------------------ iconen (eigen lijntekeningen, 24 × 24)
    var PAD = {
        verwarming: '<path d="M12 2.6c.6 3 2.9 4.7 4.5 7A6.9 6.9 0 1 1 6.2 10.5c.7 1.2 1.6 2 2.8 2.4-.4-3.7.8-7.3 3-10.3z"/>',
        sanitair: '<path d="M12 2.8c3.2 3.6 6 7.2 6 10.8a6 6 0 0 1-12 0c0-3.6 2.8-7.2 6-10.8z"/><path d="M9 14a3.1 3.1 0 0 0 2.6 3"/>',
        elektriciteit: '<path d="M13.2 2.5 4.8 13.6h6.4l-.9 7.9 8.4-11.1h-6.4z"/>',
        ventilatie: '<path d="M3 8h8.5a2.3 2.3 0 1 0-2.3-2.3"/><path d="M3 12h14.5a2.8 2.8 0 1 1-2.8 2.8"/><path d="M3 16h6.5"/>',
        airco: '<path d="M12 3v18"/><path d="m4.2 7.5 15.6 9"/><path d="m19.8 7.5-15.6 9"/><path d="m9.6 4.8 2.4 2.2 2.4-2.2"/><path d="m9.6 19.2 2.4-2.2 2.4 2.2"/>',
        werf: '<path d="M4 20V4.5L19.5 20z"/><path d="M8 16.2v-3.4l3.4 3.4z"/><path d="M4 9h1.6M4 12.5h1.6M4 16h1.6"/>',
        omrekenen: '<path d="M4 8.5h15"/><path d="M15.5 5l3.5 3.5-3.5 3.5"/><path d="M20 15.5H5"/><path d="M8.5 12 5 15.5 8.5 19"/>',
        reken: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M8.5 7h7"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18.5h.01M12 18.5h.01M15.5 18.5h.01"/>',
        zoek: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
        pijl: '<path d="m9.5 6 6 6-6 6"/>',
        ster: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
        kopieer: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
        reset: '<path d="M4 12a8 8 0 1 0 8-8 8.6 8.6 0 0 0-5.9 2.4L4 8.5"/><path d="M4 4v4.5h4.5"/>',
        letop: '<path d="M12 4.2 21 19.5H3z"/><path d="M12 10v4.5"/><path d="M12 17.2h.01"/>',
        info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.5v5"/><path d="M12 8h.01"/>',
        fout: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
        plus: '<path d="M12 5.5v13M5.5 12h13"/>',
        kruis: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
        vink: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
        pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
        klok: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        lamp: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.7 10.7c.7.6 1.2 1.4 1.2 2.3h5c0-.9.5-1.7 1.2-2.3A6 6 0 0 0 12 3z"/>'
    };
    function ico(naam, maat, klasse) {
        var m = maat || 20;
        return '<svg class="rk-i' + (klasse ? ' ' + klasse : '') + '" width="' + m + '" height="' + m + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (PAD[naam] || PAD.reken) + '</svg>';
    }
    var PIJL_KEUZE = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%2385847C%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M6 9l6 6 6-6%27/%3E%3C/svg%3E")';

    // ------------------------------------------------------------------ opmaak
    var CSS = [
        /* tokens + basis */
        '.rk{--rk-bg:var(--bg,#F4F2ED);--rk-card:var(--card,#FDFCFA);--rk-wash:var(--wash,#EFEDE6);--rk-ink:var(--ink,#26334B);--rk-txt2:var(--txt2,#3A4356);--rk-g1:var(--g1,#85847C);--rk-g2:var(--g2,#5F5E56);--rk-g3:var(--g3,#A3A29A);--rk-l1:var(--l1,#E4E1D9);--rk-l2:var(--l2,#EBE8E0);--rk-cb:var(--cb,#E9E6DE);--rk-b1:var(--b1,#DCD9D0);--rk-b2:var(--b2,#CAC7BE);--rk-accent:var(--accent,#F99D3E);--rk-groen:var(--green2,#3E7A54);--rk-gwash:var(--gwash,#EDF3EE);--rk-amber:var(--amber,#D97E24);--rk-amber2:var(--amber2,#A65E12);--rk-awash:var(--awash2,#F7E9D8);--rk-aborder:var(--aborder2,#E9CBA6);--rk-rood:var(--red2,#B4372F);--rk-rwash:var(--rwash,#F6E7E5);--rk-btn:var(--btn,#26334B);--rk-btnfg:var(--btnfg,#FFFFFF);--rk-schaduw:var(--shadow-md,0 2px 10px rgba(38,51,75,.05));--rk-ease:cubic-bezier(.22,1,.36,1);color:var(--rk-ink);font-family:inherit;font-size:15px;line-height:1.45;font-variant-numeric:tabular-nums;text-align:left;-webkit-font-smoothing:antialiased}',
        '.rk *,.rk *::before,.rk *::after{box-sizing:border-box}',
        '.rk button{font-family:inherit;cursor:pointer;color:inherit;-webkit-tap-highlight-color:transparent}',
        '.rk button:focus-visible{outline:2px solid var(--rk-ink);outline-offset:2px}',
        '.rk svg.rk-i{display:block;flex:0 0 auto}',
        '.rk sub{font-size:.72em;line-height:0;position:relative;vertical-align:baseline;bottom:-.28em;letter-spacing:0;text-transform:none}',
        '.rk .rk-nb{white-space:nowrap}',
        '.rk .groen{color:var(--rk-groen)}.rk .rood{color:var(--rk-rood)}.rk .amber{color:var(--rk-amber2)}',

        /* schermkop */
        '.rk .rk-head{margin:0 0 20px}',
        '.rk .rk-kruim{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;min-height:20px;margin:0 0 2px;font-size:13px;color:var(--rk-g1)}',
        '.rk .rk-kruim button{background:none;border:none;border-radius:4px;padding:0;font-size:13px;color:var(--rk-g1)}',
        '.rk .rk-kruim button:hover{color:var(--rk-ink);text-decoration:underline}',
        '.rk .rk-kruim .s{color:var(--rk-g3)}',
        '.rk .rk-titelrij{display:flex;align-items:flex-start;gap:12px}',
        '.rk .rk-titel{flex:1;min-width:0;margin:0;font-size:34px;font-weight:400;letter-spacing:-1px;line-height:1.12;color:var(--rk-ink);text-wrap:balance}',
        '.rk .rk-titel.klein{font-size:26px;letter-spacing:-.6px;line-height:1.18;padding-top:2px}',
        '.rk .rk-onder{margin:8px 0 0;max-width:72ch;font-size:14.5px;line-height:1.5;color:var(--rk-g2)}',
        '.rk .rk-ster{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;border:1px solid var(--rk-b1);background:var(--rk-card);color:var(--rk-g1);transition:color .15s,border-color .15s,background .15s}',
        '.rk .rk-ster.aan{color:var(--rk-accent);border-color:var(--rk-aborder);background:var(--rk-awash)}',
        '.rk .rk-ster.aan svg{fill:currentColor}',

        /* statuslabel + soort */
        '.rk .rk-label{display:inline-block;padding:2px 7px;border-radius:4px;border:1px solid var(--rk-b1);background:var(--rk-wash);color:var(--rk-g2);font-size:10.5px;font-weight:600;letter-spacing:.5px;line-height:1.5;text-transform:uppercase;white-space:nowrap}',
        '.rk .rk-label.exact{color:var(--rk-groen);background:var(--rk-gwash);border-color:var(--rk-l1)}',
        '.rk .rk-label.indicatief{color:var(--rk-amber2);background:var(--rk-awash);border-color:var(--rk-aborder)}',
        '.rk .rk-soort{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--rk-g1);white-space:nowrap}',
        '.rk .rk-soort i{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--rk-g3)}',
        '.rk .rk-soort.exact i{background:var(--rk-groen)}.rk .rk-soort.indicatief i{background:var(--rk-amber)}',

        /* zoeken */
        '.rk .rk-zoek{position:relative;margin:0 0 20px}',
        '.rk .rk-zoek>.rk-i{position:absolute;left:14px;top:50%;margin-top:-9px;color:var(--rk-g3);pointer-events:none}',
        '.rk .rk-zoek input{display:block;width:100%;height:48px;margin:0;padding:0 46px 0 42px;border:1px solid var(--rk-b1);border-radius:10px;background:var(--rk-card);box-shadow:none;outline:none;font-family:inherit;font-size:16px;color:var(--rk-ink);-webkit-appearance:none;appearance:none;transition:border-color .15s,box-shadow .15s}',
        '.rk .rk-zoek input::placeholder{color:var(--rk-g3)}',
        '.rk .rk-zoek input::-webkit-search-cancel-button{-webkit-appearance:none;display:none}',
        '.rk .rk-zoek input:focus{border-color:var(--rk-ink);box-shadow:0 0 0 3px rgba(38,51,75,.08)}',
        '.rk .rk-zoek .x{position:absolute;right:6px;top:50%;margin-top:-18px;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:none;border-radius:50%;background:none;color:var(--rk-g1)}',

        /* sectielabel */
        '.rk .rk-sectie{display:flex;align-items:center;gap:6px;margin:28px 0 10px;font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--rk-g1)}',
        '.rk .rk-sectie .n{font-weight:400;letter-spacing:0;text-transform:none;color:var(--rk-g3)}',
        '.rk .rk-sectie.eerst,.rk .rk-groep .rk-sectie{margin-top:0}',

        /* modules: smal = rijen in één kaart, breed = tegels */
        '.rk .rk-mods{border:1px solid var(--rk-cb);border-radius:14px;background:var(--rk-card);box-shadow:var(--rk-schaduw);overflow:hidden}',
        '.rk .rk-mod{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"ico t pijl" "ico n pijl";align-items:center;column-gap:14px;width:100%;padding:14px 14px 14px 16px;border:none;border-bottom:1px solid var(--rk-l2);background:none;text-align:left;transition:background .15s,border-color .15s}',
        '.rk .rk-mod:last-child{border-bottom:none}',
        '.rk .rk-mod:active{background:var(--rk-wash)}',
        '.rk .rk-mod:focus-visible,.rk .rk-item:focus-visible{outline-offset:-2px}',
        '.rk .rk-ico{grid-area:ico;display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:10px;background:var(--rk-wash);color:var(--rk-ink)}',
        '.rk .rk-mod .t{grid-area:t;min-width:0}',
        '.rk .rk-mod b{display:block;font-size:16px;font-weight:600;letter-spacing:-.2px;color:var(--rk-ink)}',
        '.rk .rk-mod .d{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:1px;font-size:13px;line-height:1.4;color:var(--rk-g1)}',
        '.rk .rk-mod .n{grid-area:n;margin-top:3px;font-size:12px;color:var(--rk-g3)}',
        '.rk .rk-pijl{grid-area:pijl;display:flex;color:var(--rk-g3);transition:transform .2s var(--rk-ease),color .15s}',

        /* lijsten: rijen met een hairline */
        '.rk .rk-lijst{border:1px solid var(--rk-cb);border-radius:14px;background:var(--rk-card);box-shadow:var(--rk-schaduw);overflow:hidden}',
        '.rk .rk-item{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:12px;width:100%;min-height:60px;padding:11px 12px 11px 16px;border:none;border-bottom:1px solid var(--rk-l2);background:none;text-align:left;transition:background .15s}',
        '.rk .rk-item.met-i{grid-template-columns:auto minmax(0,1fr) auto}',
        '.rk .rk-item:last-child{border-bottom:none}',
        '.rk .rk-item:active{background:var(--rk-wash)}',
        '.rk .rk-item .i{display:flex;color:var(--rk-g1)}',
        '.rk .rk-item .t{min-width:0}',
        '.rk .rk-item b{display:block;font-size:15px;font-weight:500;letter-spacing:-.1px;color:var(--rk-ink)}',
        '.rk .rk-item .k{display:block;margin-top:1px;font-size:13px;line-height:1.4;color:var(--rk-g1)}',
        '.rk .rk-item .k .rk-soort{display:flex;margin:5px 0 0}',
        '.rk .rk-item .r{display:flex;align-items:center;gap:14px}',
        '.rk .rk-item .r .rk-soort{display:none}',
        '.rk .rk-item .rk-pijl{grid-area:auto}',
        '.rk .rk-groep{margin:0 0 28px;break-inside:avoid;page-break-inside:avoid}',
        '.rk .rk-duo{display:grid;grid-template-columns:minmax(0,1fr);gap:0 24px;margin-top:28px}',
        '.rk .rk-duo .rk-sectie{margin-top:0}.rk .rk-duo>div+div{margin-top:28px}',
        '.rk .rk-tip{display:flex;align-items:flex-start;gap:12px;margin-top:24px;padding:14px 16px;border:1px dashed var(--rk-b1);border-radius:14px;font-size:13.5px;line-height:1.5;color:var(--rk-g2)}',
        '.rk .rk-tip .rk-i{margin-top:1px;color:var(--rk-g3)}',
        '.rk .rk-leeg{display:flex;flex-direction:column;align-items:center;gap:6px;padding:30px 16px 8px;text-align:center;font-size:13.5px;color:var(--rk-g1)}',
        '.rk .rk-leeg .rk-i{color:var(--rk-b2)}',
        '.rk .rk-leeg b{font-size:15px;font-weight:500;color:var(--rk-g2)}',
        '.rk .rk-leeg .rk-snel{justify-content:center;margin-top:10px}',

        /* berekening */
        '.rk .rk-calc{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}',
        '.rk .rk-paneel{min-width:0;padding:18px;border:1px solid var(--rk-cb);border-radius:14px;background:var(--rk-card);box-shadow:var(--rk-schaduw)}',
        '.rk .rk-pkop{display:flex;align-items:center;gap:10px;min-height:32px;margin:-5px 0 12px}',
        '.rk .rk-pkop .rk-tknop{margin-left:auto}',
        '.rk .rk-pkop .l{font-size:12px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--rk-g1)}',
        '.rk .rk-tknop{display:inline-flex;align-items:center;gap:6px;height:32px;margin:0 -8px 0 0;padding:0 10px;border:none;border-radius:8px;background:none;font-size:13px;font-weight:500;color:var(--rk-g2);transition:background .15s,color .15s}',
        '.rk .rk-tknop.plus{margin:8px 0 0 -8px;color:var(--rk-txt2)}',
        '.rk .rk-tknop:active{background:var(--rk-wash);color:var(--rk-ink)}',
        '.rk .rk-intro{margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid var(--rk-l2);font-size:13.5px;line-height:1.55;color:var(--rk-g2)}',
        '.rk .rk-bron{margin:18px 0 0;padding:14px 0 0;border-top:1px solid var(--rk-l2);font-size:12.5px;line-height:1.55;color:var(--rk-g1);overflow-wrap:anywhere}',
        '.rk .rk-bron b{display:block;margin-bottom:3px;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--rk-g3)}',

        /* velden */
        '.rk .rk-veld{margin:0 0 16px}.rk .rk-veld:last-child{margin-bottom:0}',
        '.rk .rk-veld>label:not(.rk-vink),.rk .rk-vlabel{display:block;margin:0 0 6px;font-size:13px;font-weight:500;color:var(--rk-txt2)}',
        '.rk .rk-veld .opt{margin-left:4px;font-weight:400;color:var(--rk-g3)}',
        '.rk .rk-veld .hint{margin-top:6px;font-size:12.5px;line-height:1.45;color:var(--rk-g1)}',
        '.rk .rk-in{display:flex;align-items:stretch;min-height:46px;border:1px solid var(--rk-b1);border-radius:10px;background:var(--rk-card);overflow:hidden;transition:border-color .15s,box-shadow .15s}',
        '.rk .rk-in:focus-within{border-color:var(--rk-ink);box-shadow:0 0 0 3px rgba(38,51,75,.08)}',
        '.rk .rk-in input,.rk .rk-in select{flex:1 1 auto;width:100%;min-width:0;height:auto;min-height:44px;margin:0;padding:0 12px;border:none;border-radius:0;background-color:transparent;box-shadow:none;outline:none;font-family:inherit;font-size:16px;font-variant-numeric:tabular-nums;color:var(--rk-ink);-webkit-appearance:none;appearance:none}',
        '.rk .rk-in input:focus,.rk .rk-in select:focus{border:none;box-shadow:none;outline:none}',
        '.rk .rk-in input::placeholder{color:var(--rk-g3)}',
        '.rk .rk-in select{padding-right:34px;background-image:' + PIJL_KEUZE + ';background-repeat:no-repeat;background-position:right 10px center;background-size:16px 16px;cursor:pointer;text-overflow:ellipsis}',
        '.rk .rk-in select option{color:var(--rk-ink);background:var(--rk-card)}',
        '.rk .rk-in .rk-eh{flex:0 0 auto;display:flex;align-items:center;padding:0 12px 0 2px;font-size:14px;color:var(--rk-g1);white-space:nowrap}',
        '.rk .rk-in select.rk-ehs{flex:0 0 auto;width:auto;max-width:46%;padding:0 30px 0 12px;border-left:1px solid var(--rk-l1);background-color:var(--rk-wash);background-position:right 8px center;background-size:14px 14px;font-size:14px;color:var(--rk-txt2)}',
        '.rk .rk-in select.rk-ehs:focus{border-left:1px solid var(--rk-l1)}',
        '.rk .rk-snel{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
        '.rk .rk-snel button{height:30px;padding:0 12px;border:1px solid var(--rk-b1);border-radius:24px;background:transparent;font-size:13px;font-weight:500;color:var(--rk-txt2);transition:background .15s,border-color .15s,color .15s}',
        '.rk .rk-snel button.aan{border-color:var(--rk-btn);background:var(--rk-btn);color:var(--rk-btnfg)}',
        '.rk .rk-vink{display:flex;align-items:center;gap:10px;min-height:32px;margin:0;font-size:14.5px;font-weight:400;color:var(--rk-ink);cursor:pointer}',
        '.rk .rk-vink input{position:absolute;width:1px;height:1px;margin:0;padding:0;border:none;opacity:0;pointer-events:none}',
        '.rk .rk-vink .box{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--rk-b2);border-radius:6px;background:var(--rk-card);color:transparent;transition:background .15s,border-color .15s}',
        '.rk .rk-vink input:checked+.box{border-color:var(--rk-btn);background:var(--rk-btn);color:var(--rk-btnfg)}',
        '.rk .rk-vink input:focus-visible+.box{outline:2px solid var(--rk-ink);outline-offset:2px}',
        '.rk .rk-rijen{display:flex;flex-direction:column;gap:6px}',
        '.rk .rk-rijen .rij{display:flex;align-items:center;gap:6px}',
        '.rk .rk-rijen .rk-in{flex:1 1 0;min-width:0;min-height:42px}',
        '.rk .rk-rijen .rk-in.smal{flex:0 0 88px}',
        /* v411: rij met drie of meer velden = twee regels, elk veld met zijn kopje */
        '.rk .rk-rijen.veel{gap:0}',
        '.rk .rk-rijen.veel .rij{display:grid;grid-template-columns:minmax(0,104px) minmax(0,1fr) 34px;gap:8px 8px;align-items:end;padding:10px 0 12px;border-bottom:1px solid var(--rk-l2)}',
        '.rk .rk-rijen.veel .rij:first-child{padding-top:2px}',
        '.rk .rk-rijen.veel .cel{min-width:0;display:flex;flex-direction:column;gap:4px}',
        '.rk .rk-rijen.veel .kl{font-size:11.5px;line-height:1.2;color:var(--rk-g1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.rk .rk-rijen.veel .rk-in,.rk .rk-rijen.veel .rk-in.smal{flex:0 0 auto;width:100%}',
        '.rk .rk-rijen.veel .x{grid-column:3;grid-row:1;align-self:end;margin-bottom:4px}',
        '.rk .rk-rijen .rk-in input,.rk .rk-rijen .rk-in select{min-height:40px;font-size:15px}',
        '.rk .rk-rijen .x{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border:none;border-radius:50%;background:none;color:var(--rk-g3);transition:background .15s,color .15s}',
        '.rk .rk-rijen .x:active{background:var(--rk-rwash);color:var(--rk-rood)}',

        /* uitkomst */
        '.rk .rk-hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:16px 28px;margin:0 0 4px;padding:0 0 18px;border-bottom:1px solid var(--rk-l1)}',
        '.rk .rk-hero.alleen{border-bottom:none;padding-bottom:4px}',
        '.rk .rk-hero::before{content:"";grid-column:1/-1;width:28px;height:3px;margin:2px 0 -2px;border-radius:2px;background:var(--rk-accent)}',
        '.rk .rk-hero .h{min-width:0}',
        '.rk .rk-hero .l{margin-bottom:3px;font-size:13px;font-weight:500;color:var(--rk-g1)}',
        '.rk .rk-hero .w{font-size:34px;font-weight:400;letter-spacing:-1px;line-height:1.1;color:var(--rk-ink);overflow-wrap:anywhere}',
        '.rk .rk-hero .w .e{margin-left:3px;font-size:16px;letter-spacing:0;color:var(--rk-g1)}',
        '.rk .rk-hero .w.lang{font-size:19px;font-weight:500;letter-spacing:-.3px;line-height:1.3}',
        '.rk .rk-hero .w.groen{color:var(--rk-groen)}.rk .rk-hero .w.rood{color:var(--rk-rood)}.rk .rk-hero .w.amber{color:var(--rk-amber2)}',
        '.rk .rk-hero .o{margin-top:5px;font-size:12.5px;line-height:1.4;color:var(--rk-g1)}',
        '.rk .rk-rij{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;column-gap:16px;padding:10px 0;border-bottom:1px solid var(--rk-l2);font-size:14px}',
        '.rk .rk-details .rk-rij:last-child{border-bottom:none}',
        '.rk .rk-rij .l{min-width:0;color:var(--rk-g2)}',
        '.rk .rk-rij .w{font-weight:600;text-align:right;white-space:nowrap;color:var(--rk-ink)}',
        '.rk .rk-rij .w.lang{max-width:22em;white-space:normal}',
        '.rk .rk-rij .w.groen{color:var(--rk-groen)}.rk .rk-rij .w.rood{color:var(--rk-rood)}.rk .rk-rij .w.amber{color:var(--rk-amber2)}',
        '.rk .rk-rij .w .e{margin-left:3px;font-weight:400;color:var(--rk-g1)}',
        '.rk .rk-rij .o{grid-column:1/-1;margin-top:1px;font-size:12px;line-height:1.4;text-align:right;color:var(--rk-g1)}',
        '.rk .rk-meld{display:flex;align-items:flex-start;gap:10px;margin:12px 0 0;padding:12px 14px;border:1px solid var(--rk-aborder);border-radius:10px;background:var(--rk-awash);font-size:13.5px;line-height:1.5;color:var(--rk-amber2)}',
        '.rk .rk-meld .rk-i{margin-top:1px}',
        '.rk .rk-meld.fout{border-color:var(--rk-l1);background:var(--rk-rwash);color:var(--rk-rood)}',
        '.rk .rk-meld:first-child{margin-top:0}',
        '.rk .rk-wacht{display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 12px 22px;text-align:center;font-size:13.5px;line-height:1.5;color:var(--rk-g1)}',
        '.rk .rk-wacht .rk-i{margin-bottom:4px;color:var(--rk-b2)}',
        '.rk .rk-wacht b{font-size:15px;font-weight:500;color:var(--rk-g2)}',
        '.rk .rk-tabelwrap{margin:18px 0 0;overflow-x:auto;-webkit-overflow-scrolling:touch}',
        '.rk .rk-tabelwrap:first-child{margin-top:0}',
        '.rk .rk-tabel{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}',
        '.rk .rk-tabel th{padding:0 12px 7px 0;border:none;border-bottom:2px solid var(--rk-ink);background:none;font-size:12px;font-weight:600;letter-spacing:0;text-align:left;text-transform:none;white-space:nowrap;color:var(--rk-g1)}',
        '.rk .rk-tabel td{padding:8px 12px 8px 0;border:none;border-bottom:1px solid var(--rk-l2);background:none;vertical-align:top;white-space:nowrap;color:var(--rk-txt2)}',
        '.rk .rk-tabel th:first-child,.rk .rk-tabel td:first-child{padding-left:10px}',
        '.rk .rk-tabel td:first-child{font-weight:500;color:var(--rk-ink)}',
        '.rk .rk-tabel tr:last-child td{border-bottom:none}',
        '.rk .rk-tabel .num{text-align:right}',
        '.rk .rk-tabel td.ruim{min-width:200px;white-space:normal;line-height:1.45}',
        '.rk .rk-tabel tr.kies td{background:var(--rk-wash);font-weight:600;color:var(--rk-ink)}',
        '.rk .rk-tabel tr.kies td:first-child{box-shadow:inset 3px 0 0 var(--rk-accent)}',
        '.rk .rk-tabel .ok{display:inline-flex;align-items:center;gap:4px;color:var(--rk-groen)}',
        '.rk .rk-tabel .nok{color:var(--rk-g1)}',
        '.rk .rk-stappen{margin:16px 0 0;padding:4px 0 0;border-top:1px solid var(--rk-l1)}',
        '.rk .rk-stappen summary{display:flex;align-items:center;gap:6px;padding:9px 0 7px;border-radius:8px;list-style:none;cursor:pointer;font-size:13.5px;font-weight:500;color:var(--rk-txt2);-webkit-user-select:none;user-select:none}',
        '.rk .rk-stappen summary::-webkit-details-marker{display:none}',
        '.rk .rk-stappen summary .rk-i{color:var(--rk-g1);transition:transform .2s var(--rk-ease)}',
        '.rk .rk-stappen[open] summary .rk-i{transform:rotate(90deg)}',
        '.rk .rk-stappen ol{display:flex;flex-direction:column;gap:9px;margin:2px 0 4px;padding:13px 14px;border-radius:10px;background:var(--rk-wash);list-style:none;counter-reset:rk}',
        '.rk .rk-stappen li{position:relative;margin:0;padding:0 0 0 28px;font-size:13px;line-height:1.5;color:var(--rk-txt2);overflow-wrap:anywhere;counter-increment:rk}',
        '.rk .rk-stappen li::before{content:counter(rk);position:absolute;left:0;top:1px;display:flex;align-items:center;justify-content:center;width:18px;height:18px;border:1px solid var(--rk-b2);border-radius:50%;font-size:10.5px;font-weight:600;line-height:1;color:var(--rk-g2)}',
        '.rk .rk-opm{display:flex;align-items:flex-start;gap:8px;margin:14px 0 0;font-size:12.5px;line-height:1.5;color:var(--rk-g1)}',
        '.rk .rk-opm .rk-i{margin-top:2px;color:var(--rk-g3)}',

        /* toast */
        '.rk-toast{position:fixed;left:50%;bottom:24px;z-index:9999;max-width:92%;padding:10px 16px;border-radius:10px;background:var(--ink,#26334B);box-shadow:var(--shadow-lg,0 12px 32px rgba(38,51,75,.14));font-size:14px;color:var(--card,#FDFCFA);opacity:0;transform:translate(-50%,6px);transition:opacity .2s,transform .2s;pointer-events:none}',
        '.rk-toast.aan{opacity:1;transform:translate(-50%,0)}',

        /* beweging */
        '@keyframes rkIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
        '@keyframes rkTik{from{opacity:.35}to{opacity:1}}',
        '.rk .rk-view.rk-kom{animation:rkIn .4s var(--rk-ease)}',
        '.rk .rk-hero .w.tik{animation:rkTik .3s ease-out}',

        /* muis: zweven alleen waar het kan */
        '@media (hover:hover){.rk .rk-mod:hover{background:var(--rk-wash)}.rk .rk-mod:hover .rk-pijl,.rk .rk-item:hover .rk-pijl{color:var(--rk-ink);transform:translateX(2px)}.rk .rk-item:hover{background:var(--rk-wash)}.rk .rk-tknop:hover{background:var(--rk-wash);color:var(--rk-ink)}.rk .rk-snel button:not(.aan):hover{border-color:var(--rk-b2);background:var(--rk-wash)}.rk .rk-ster:hover{border-color:var(--rk-b2);color:var(--rk-ink)}.rk .rk-ster.aan:hover{color:var(--rk-accent);border-color:var(--rk-aborder)}.rk .rk-zoek .x:hover{background:var(--rk-wash);color:var(--rk-ink)}.rk .rk-rijen .x:hover{background:var(--rk-rwash);color:var(--rk-rood)}.rk .rk-stappen summary:hover{color:var(--rk-ink)}}',

        /* breed scherm */
        '@media (min-width:760px){' +
            '.rk .rk-head{margin-bottom:24px}' +
            '.rk .rk-mods{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;border:none;border-radius:0;background:none;box-shadow:none;overflow:visible}' +
            '.rk .rk-mod{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto 1fr auto;grid-template-areas:"ico ico" "t t" "n pijl";align-items:start;min-height:184px;padding:18px;border:1px solid var(--rk-cb);border-radius:14px;background:var(--rk-card);box-shadow:var(--rk-schaduw)}' +
            '.rk .rk-mod:last-child{border-bottom:1px solid var(--rk-cb)}' +
            '.rk .rk-mod .t{margin-top:16px}' +
            '.rk .rk-mod .d{-webkit-line-clamp:4;margin-top:4px}' +
            '.rk .rk-mod .n{align-self:end;margin-top:14px}' +
            '.rk .rk-mod .rk-pijl{align-self:end}' +
            '.rk .rk-item{padding:12px 14px 12px 18px}' +
            '.rk .rk-item .k .rk-soort{display:none}' +
            '.rk .rk-item .r .rk-soort{display:inline-flex}' +
            '.rk .rk-duo.twee{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}' +
            '.rk .rk-duo.twee>div+div{margin-top:0}' +
            '.rk .rk-paneel{padding:22px}' +
        '}',
        '@media (hover:hover) and (min-width:760px){.rk .rk-mod:hover{background:var(--rk-card);border-color:var(--rk-b2)}}',
        '@media (min-width:900px){' +
            '.rk .rk-groepen{column-count:2;column-gap:24px}' +
            '.rk .rk-calc{grid-template-columns:minmax(320px,5fr) minmax(360px,6fr);gap:20px;align-items:start}' +
            '.rk .rk-calc.solo{grid-template-columns:minmax(0,1fr)}' +
            '.rk .rk-calc:not(.solo) .rk-uitpaneel{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow-y:auto;scrollbar-width:thin}' +
        '}',
        '@media (max-width:480px){.rk .rk-paneel{padding:16px}.rk .rk-titel.klein{font-size:24px}.rk .rk-hero{gap:14px 20px}.rk .rk-tabel{font-size:12.5px}.rk .rk-tabel th,.rk .rk-tabel td{padding-right:9px}.rk .rk-tabel th:first-child,.rk .rk-tabel td:first-child{padding-left:8px}.rk .rk-tabel th:last-child,.rk .rk-tabel td:last-child{padding-right:4px}.rk .rk-tabel th,.rk .rk-tabel td{white-space:normal;overflow-wrap:break-word}.rk .rk-tabel td.num{white-space:nowrap}.rk .rk-tabel th{vertical-align:bottom}.rk .rk-tabel td.ruim{min-width:0}.rk .rk-rijen .rk-in.smal{flex-basis:72px}.rk .rk-rijen .x{width:30px}}',
        '@media (prefers-reduced-motion:reduce){.rk *,.rk *::before,.rk *::after{animation:none!important;transition:none!important}}'
    ].join('\n');

    // ------------------------------------------------------------------ hulpjes
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    // Symbolen met een index netjes zetten: I_b → I met een b in onderschrift (ook θ_e,ontwerp).
    var GRIEKS = String.fromCharCode(0x370) + '-' + String.fromCharCode(0x3FF);
    var SUB = new RegExp('([A-Za-z' + GRIEKS + '])_([A-Za-z0-9' + GRIEKS + ']+(?:,[a-z]+)*)', 'g');
    // Nummers met een koppelteken (EN 12056-2, NBN D 51-003) breken niet af op het streepje.
    var VAST = /([^\s<>]*\d-\d[^\s<>]*)/g;
    function tx(s) { return esc(s).replace(SUB, function (m, a, b) { return a + '<sub>' + b + '</sub>'; }).replace(VAST, '<span class="rk-nb">$1</span>'); }
    function ls(k, std) { try { var s = localStorage.getItem(k); return s == null ? std : JSON.parse(s); } catch (e) { return std; } }
    function lsZet(k, w) { try { localStorage.setItem(k, JSON.stringify(w)); } catch (e) {} }
    var SOORT = { exact: 'exact', indicatief: 'richtwaarde', naslag: 'naslag' };
    var SOORT_UITLEG = {
        exact: 'Formule: de uitkomst is exact voor de waarden die je invult',
        indicatief: 'Vereenvoudigde norm of vuistregel: gebruik de uitkomst als voorselectie',
        naslag: 'Tabel om iets op te zoeken'
    };
    // Een cel telt als getal als ze alleen een getal met een korte eenheid is, eventueel met (10,5 %) erachter.
    // "300 mA (30 mA nat/buiten)" of "16 A B" is tekst en blijft links staan.
    var GETAL = /^[<>~+\-−±≤≥]?\s*[Øø]?\s*\d[\d.,]*(\s?[^\s\d()]{1,8})?(\s?\(\s*[+\-−]?\d[\d.,]*\s?[^\s\d()]{0,6}\))?$/;
    var VINK = String.fromCharCode(0x2713);
    function tekst(c) { return String(c == null ? '' : c).trim(); }
    function aantalBerekeningen(m) { return m.groepen.reduce(function (a, g) { return a + g.items.length; }, 0); }

    function mount(host, opts) {
        opts = opts || {};
        if (!document.getElementById('qeRekenCss')) { var st = document.createElement('style'); st.id = 'qeRekenCss'; st.textContent = CSS; document.head.appendChild(st); }
        host.classList.add('rk'); if (opts.breed) host.classList.add('breed');
        var S = { view: 'start', mod: null, calc: null, q: '', stapel: [], fav: ls('qe_reken_fav', []), recent: ls('qe_reken_recent', []), waarden: {}, toastT: null, stappenOpen: false, hoofd: {} };

        function titel(t) { if (opts.onTitel) try { opts.onTitel(t); } catch (e) {} }
        function toast(t) {
            if (opts.toast) { try { opts.toast(t); return; } catch (e) {} }
            var el = document.getElementById('rkToast');
            if (!el) { el = document.createElement('div'); el.id = 'rkToast'; el.className = 'rk-toast'; document.body.appendChild(el); }
            el.textContent = t; el.classList.add('aan'); clearTimeout(S.toastT); S.toastT = setTimeout(function () { el.classList.remove('aan'); }, 1800);
        }
        function ga(view, payload, geenStapel) {
            if (!geenStapel) S.stapel.push({ view: S.view, mod: S.mod, calc: S.calc, q: S.q });
            S.view = view;
            if (view === 'module') { S.mod = payload; S.calc = null; }
            if (view === 'calc') { S.calc = payload; S.mod = R.moduleVan(payload.module); }
            if (view === 'start') { S.mod = null; S.calc = null; }
            render(true);
            try { window.scrollTo(0, 0); } catch (e) {}
        }
        function terug() {
            if (!S.stapel.length) return false;
            var p = S.stapel.pop();
            S.view = p.view; S.mod = p.mod; S.calc = p.calc; S.q = p.q || '';
            render(true);
            return true;
        }
        // Kruimelpad: rechtstreeks naar het begin of naar de module; de terugknop volgt die plek.
        function naarStart() { S.stapel = []; S.q = ''; ga('start', null, true); }
        function naarModule(m) { if (!m) return naarStart(); S.stapel = [{ view: 'start', mod: null, calc: null, q: '' }]; S.q = ''; ga('module', m, true); }

        // ---------------- bouwstenen
        function kopHtml(o) {
            var h = '<header class="rk-head">';
            h += '<div class="rk-kruim">' + (o.kruim || []).filter(Boolean).map(function (k, i) {
                return (i ? '<span class="s">/</span>' : '') + (k.act ? '<button type="button" data-act="' + k.act + '"' + (k.key ? ' data-key="' + esc(k.key) + '"' : '') + '>' + esc(k.t) + '</button>' : '<span>' + esc(k.t) + '</span>');
            }).join('') + '</div>';
            h += '<div class="rk-titelrij"><h1 class="rk-titel' + (o.klein ? ' klein' : '') + '">' + tx(o.titel) + '</h1>';
            if (o.ster != null) h += '<button type="button" class="rk-ster' + (o.ster ? ' aan' : '') + '" data-act="fav" aria-pressed="' + (o.ster ? 'true' : 'false') + '" title="' + (o.ster ? 'Uit je favorieten halen' : 'Bij je favorieten zetten') + '" aria-label="Favoriet">' + ico('ster', 19) + '</button>';
            h += '</div>';
            if (o.onder) h += '<p class="rk-onder">' + o.onder + '</p>';
            return h + '</header>';
        }
        function zoekHtml(plaats) {
            return '<div class="rk-zoek">' + ico('zoek', 18) + '<input type="search" id="rkQ" placeholder="' + esc(plaats) + '" value="' + esc(S.q) + '" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Zoeken">' +
                (S.q ? '<button type="button" class="x" data-act="zoekwis" aria-label="Zoekveld leegmaken">' + ico('kruis', 16) + '</button>' : '') + '</div>';
        }
        function soortHtml(b) { return '<span class="rk-soort ' + b.soort + '"><i></i>' + SOORT[b.soort] + '</span>'; }
        function itemHtml(b, metIcoon) {
            var m = R.moduleVan(b.module);
            return '<button type="button" class="rk-item' + (metIcoon ? ' met-i' : '') + '" data-act="calc" data-id="' + esc(b.id) + '">' +
                (metIcoon ? '<span class="i">' + ico(m ? m.key : 'reken', 20) + '</span>' : '') +
                '<span class="t"><b>' + tx(b.naam) + '</b><span class="k">' + tx(b.kort) + soortHtml(b) + '</span></span>' +
                '<span class="r">' + soortHtml(b) + '<span class="rk-pijl">' + ico('pijl', 16) + '</span></span></button>';
        }
        function lijstHtml(items, metIcoon) { return '<div class="rk-lijst">' + items.map(function (b) { return itemHtml(b, metIcoon); }).join('') + '</div>'; }
        function sectie(naam, n, eerst, icoon) { return '<div class="rk-sectie' + (eerst ? ' eerst' : '') + '">' + (icoon ? ico(icoon, 13) : '') + '<span>' + esc(naam) + '</span>' + (n != null ? '<span class="n">' + n + '</span>' : '') + '</div>'; }
        function leegHtml(woorden) {
            return '<div class="rk-leeg">' + ico('zoek', 30) + '<b>Niets gevonden</b><span>Probeer een ander woord of kies een van deze.</span><div class="rk-snel">' +
                woorden.map(function (w) { return '<button type="button" data-act="zoekwoord" data-q="' + esc(w) + '">' + esc(w) + '</button>'; }).join('') + '</div></div>';
        }

        // ---------------- start
        function renderStart() {
            var h = kopHtml({ kruim: [{ t: 'Verwarming · Sanitair · Elektriciteit · Ventilatie · Airco · Werf' }], titel: 'Rekenmachine' });
            h += zoekHtml('Zoek een berekening: kabel, schouw, afvoer, expansievat…');
            if (S.q.trim()) {
                var res = R.zoek(S.q);
                if (res.length) h += sectie(res.length === 1 ? 'Berekening' : 'Berekeningen', res.length, true) + lijstHtml(res, true);
                else h += leegHtml(['kabel', 'radiator', 'afvoer', 'schouw', 'koelmiddel', 'helling']);
                return h;
            }
            h += '<div class="rk-mods">' + R.modules.map(function (m) {
                return '<button type="button" class="rk-mod" data-act="mod" data-key="' + esc(m.key) + '"><span class="rk-ico">' + ico(m.key, 22) + '</span><span class="t"><b>' + esc(m.naam) + '</b><span class="d">' + esc(m.omschrijving) + '</span></span><span class="n">' + aantalBerekeningen(m) + ' berekeningen</span><span class="rk-pijl">' + ico('pijl', 16) + '</span></button>';
            }).join('') + '</div>';
            var favs = S.fav.map(R.vind).filter(Boolean), rec = S.recent.map(R.vind).filter(Boolean);
            if (favs.length || rec.length) {
                h += '<div class="rk-duo' + (favs.length && rec.length ? ' twee' : '') + '">';
                if (favs.length) h += '<div>' + sectie('Favorieten', null, false, 'ster') + lijstHtml(favs, true) + '</div>';
                if (rec.length) h += '<div>' + sectie('Recent gebruikt', null, false, 'klok') + lijstHtml(rec, true) + '</div>';
                h += '</div>';
            }
            if (!favs.length) h += '<div class="rk-tip">' + ico('lamp', 18) + '<span>Gebruik je een berekening vaak? Tik op de ster naast de titel. Ze staat dan hier bovenaan.</span></div>';
            return h;
        }
        // ---------------- module
        function renderModule() {
            var m = S.mod, h = kopHtml({ kruim: [{ t: 'Rekenmachine', act: 'kstart' }], titel: m.naam, onder: esc(m.omschrijving) + '.' });
            h += zoekHtml('Zoek in ' + m.naam.toLowerCase() + '…');
            var q = S.q.trim();
            if (q) {
                var res = R.zoek(q).filter(function (b) { return b.module === m.key; });
                if (res.length) h += sectie('Gevonden', res.length, true) + lijstHtml(res, false);
                else {
                    var woorden = [];
                    m.groepen.forEach(function (g) { g.items.forEach(function (b) { var w = b.naam.toLowerCase().split(/[^a-z0-9]+/)[0]; if (w && w.length > 3 && woorden.indexOf(w) < 0) woorden.push(w); }); });
                    h += leegHtml(woorden.slice(0, 6));
                }
                return h;
            }
            h += '<div class="rk-groepen">' + m.groepen.map(function (g) { return '<div class="rk-groep">' + sectie(g.naam, g.items.length) + lijstHtml(g.items, false) + '</div>'; }).join('') + '</div>';
            return h;
        }
        // ---------------- berekening
        function waardenVan(b) {
            if (S.waarden[b.id]) return S.waarden[b.id];
            var w = ls('qe_reken_v_' + b.id, null);
            if (!w || typeof w !== 'object') w = standaard(b);
            S.waarden[b.id] = w;
            return w;
        }
        function standaard(b) {
            var w = {};
            b.velden.forEach(function (f) {
                if (f.type === 'rijen') w[f.k] = JSON.parse(JSON.stringify(f.std || []));
                else if (f.type === 'keuze') w[f.k] = f.std != null ? f.std : (f.opties && f.opties.length ? f.opties[0].v : '');
                else if (f.type === 'vink') w[f.k] = !!f.std;
                else if (f.type === 'tekst') w[f.k] = f.std == null ? '' : f.std;
                else { w[f.k] = f.std == null ? '' : String(f.std).replace('.', ','); if (f.eh) w[f.k + '_eh'] = f.eh; }
            });
            return w;
        }
        function optiesHtml(opties, gekozen) { return (opties || []).map(function (o) { return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(gekozen) ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }).join(''); }
        function veldHtml(f, w) {
            var id = 'rk_' + f.k, h = '<div class="rk-veld" data-veld="' + esc(f.k) + '">';
            if (f.type === 'vink') return h + '<label class="rk-vink"><input type="checkbox" data-k="' + esc(f.k) + '"' + (w[f.k] ? ' checked' : '') + '><span class="box">' + ico('vink', 14) + '</span><span>' + tx(f.label) + '</span></label>' + (f.hint ? '<div class="hint">' + tx(f.hint) + '</div>' : '') + '</div>';
            var opt = f.opt ? '<span class="opt">optioneel</span>' : '';
            if (f.type === 'rijen') {
                var veel = (f.kolommen || []).length >= 3;
                h += '<div class="rk-vlabel">' + tx(f.label) + opt + '</div><div class="rk-rijen' + (veel ? ' veel' : '') + '" data-rijen="' + esc(f.k) + '">';
                (w[f.k] || []).forEach(function (rij, i) {
                    h += '<div class="rij">' + (f.kolommen || []).map(function (c) {
                        var att = ' data-rk="' + esc(f.k) + '" data-i="' + i + '" data-c="' + esc(c.k) + '" aria-label="' + esc(c.label) + '"', cel;
                        if (c.type === 'keuze') cel = '<div class="rk-in"><select' + att + '>' + optiesHtml(c.opties, rij[c.k]) + '</select></div>';
                        else cel = '<div class="rk-in' + (c.type === 'tekst' ? '' : ' smal') + '"><input type="text" ' + (c.type === 'tekst' ? '' : 'inputmode="decimal" ') + 'autocomplete="off" placeholder="' + esc(veel ? '' : c.label) + '"' + att + ' value="' + esc(rij[c.k] == null ? '' : rij[c.k]) + '"></div>';
                        return veel ? '<div class="cel"><span class="kl">' + tx(c.label) + '</span>' + cel + '</div>' : cel;
                    }).join('') + '<button type="button" class="x" data-act="rijweg" data-k="' + esc(f.k) + '" data-i="' + i + '" title="Regel weg" aria-label="Regel weg">' + ico('kruis', 15) + '</button></div>';
                });
                h += '</div><button type="button" class="rk-tknop plus" data-act="rijbij" data-k="' + esc(f.k) + '">' + ico('plus', 15) + 'Regel toevoegen</button>';
            } else {
                h += '<label for="' + id + '">' + tx(f.label) + opt + '</label><div class="rk-in">';
                if (f.type === 'keuze') h += '<select id="' + id + '" data-k="' + esc(f.k) + '">' + optiesHtml(f.opties, w[f.k]) + '</select>';
                else if (f.type === 'tekst') h += '<input id="' + id + '" type="text" autocomplete="off" data-k="' + esc(f.k) + '" value="' + esc(w[f.k]) + '">';
                else {
                    h += '<input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" data-k="' + esc(f.k) + '" value="' + esc(w[f.k]) + '"' + (f.opt ? ' placeholder="–"' : '') + '>';
                    if (f.ehs && f.ehs.length > 1) h += '<select class="rk-ehs" data-eh="' + esc(f.k) + '" aria-label="Eenheid">' + f.ehs.map(function (e) { return '<option value="' + esc(e) + '"' + (e === (w[f.k + '_eh'] || f.eh) ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') + '</select>';
                    else if (f.eh) h += '<span class="rk-eh">' + esc(f.eh) + '</span>';
                }
                h += '</div>';
                if (f.snel && f.snel.length) { var gehad = false; h += '<div class="rk-snel">' + f.snel.map(function (s) { var aan = !gehad && String(s.v).replace('.', ',') === String(w[f.k]); if (aan) gehad = true; return '<button type="button" data-act="snel" data-k="' + esc(f.k) + '" data-v="' + esc(s.v) + '"' + (aan ? ' class="aan"' : '') + '>' + esc(s.t) + '</button>'; }).join('') + '</div>'; }
            }
            if (f.hint) h += '<div class="hint">' + tx(f.hint) + '</div>';
            return h + '</div>';
        }
        function renderCalc() {
            var b = S.calc, w = waardenVan(b), m = S.mod, naslag = b.soort === 'naslag';
            var h = kopHtml({
                kruim: [{ t: 'Rekenmachine', act: 'kstart' }, m ? { t: m.naam, act: 'kmod', key: m.key } : null], titel: b.naam, klein: true, ster: S.fav.indexOf(b.id) >= 0,
                onder: tx(b.kort)
            });
            h += '<div class="rk-calc' + (naslag ? ' solo' : '') + '">';
            if (!naslag) {
                h += '<section class="rk-paneel" id="rkForm"><div class="rk-pkop"><span class="l">Invoer</span><button type="button" class="rk-tknop" data-act="wis" title="Zet alle velden terug op hun beginwaarde">' + ico('reset', 15) + 'Opnieuw</button></div>';
                if (b.uitleg) h += '<p class="rk-intro">' + tx(b.uitleg) + '</p>';
                h += b.velden.map(function (f) { return veldHtml(f, w); }).join('');
                if (b.bron) h += '<div class="rk-bron"><b>Basis</b>' + tx(b.bron) + '</div>';
                h += '</section>';
            }
            h += '<section class="rk-paneel rk-uitpaneel"><div class="rk-pkop"><span class="l">' + (naslag ? 'Naslag' : 'Uitkomst') + '</span>' +
                (naslag ? '' : '<span class="rk-label ' + b.soort + '" title="' + esc(SOORT_UITLEG[b.soort]) + '">' + SOORT[b.soort] + '</span>') +
                (naslag ? '' : '<button type="button" class="rk-tknop" data-act="kopieer" title="Kopieer invoer en uitkomst als tekst">' + ico('kopieer', 15) + 'Kopieer</button>') +
                '</div><div id="rkUit" aria-live="polite"></div></section></div>';
            return h;
        }
        function waardeHtml(u) {
            if (typeof u.w === 'number') return R.fmt(u.w, u.dec) + (u.e ? '<span class="e">' + tx(u.e) + '</span>' : '');
            return tx(u.w == null ? '–' : u.w) + (u.e ? '<span class="e">' + tx(u.e) + '</span>' : '');
        }
        function isLang(u) { return typeof u.w !== 'number' && tekst(u.w).length + tekst(u.e).length > 13; }
        function uitkomstHtml(r, b) {
            if (!r) return '';
            if (r.fout) return '<div class="rk-meld fout">' + ico('fout', 18) + '<span>' + tx(r.fout) + '</span></div>' + (r.tabel ? tabelHtml(r.tabel) : '');
            if (r.wacht) return '<div class="rk-wacht">' + ico('pen', 30) + '<b>Nog even invullen</b><span>' + tx((r.ontbreekt || []).join(', ')) + '</span></div>';
            var h = '';
            var hoofd = (r.uit || []).filter(function (u) { return u.hoofd; }), rest = (r.uit || []).filter(function (u) { return !u.hoofd; });
            var nogIets = rest.length || (r.waarsch || []).length || r.tabel || r.tabel2 || (r.stappen && r.stappen.length) || r.opm;
            if (hoofd.length) h += '<div class="rk-hero' + (nogIets ? '' : ' alleen') + '">' + hoofd.map(function (u) {
                return '<div class="h"><div class="l">' + tx(u.label) + '</div><div class="w' + (isLang(u) ? ' lang' : '') + (u.kleur ? ' ' + esc(u.kleur) : '') + '">' + waardeHtml(u) + '</div>' + (u.opm ? '<div class="o">' + tx(u.opm) + '</div>' : '') + '</div>';
            }).join('') + '</div>';
            if (rest.length) h += '<div class="rk-details">' + rest.map(function (u) {
                return '<div class="rk-rij"><span class="l">' + tx(u.label) + '</span><span class="w' + (isLang(u) ? ' lang' : '') + (u.kleur ? ' ' + esc(u.kleur) : '') + '">' + waardeHtml(u) + '</span>' + (u.opm ? '<span class="o">' + tx(u.opm) + '</span>' : '') + '</div>';
            }).join('') + '</div>';
            (r.waarsch || []).forEach(function (t) { h += '<div class="rk-meld">' + ico('letop', 18) + '<span>' + tx(t) + '</span></div>'; });
            if (r.tabel) h += tabelHtml(r.tabel);
            if (r.tabel2) h += tabelHtml(r.tabel2);
            if (r.stappen && r.stappen.length) h += '<details class="rk-stappen"' + (S.stappenOpen ? ' open' : '') + '><summary>' + ico('pijl', 15) + 'Toon berekening</summary><ol>' + r.stappen.map(function (s) { return '<li>' + tx(s) + '</li>'; }).join('') + '</ol></details>';
            if (r.opm) h += '<div class="rk-opm">' + ico('info', 15) + '<span>' + tx(r.opm) + '</span></div>';
            if (b && b.soort === 'naslag' && b.bron) h += '<div class="rk-bron"><b>Basis</b>' + tx(b.bron) + '</div>';
            return h;
        }
        // v411: getal en eenheid blijven in een tabelcel samen op één regel (300 mA, 16 A B, 3G2,5 mm²)
        var NBSP = String.fromCharCode(160);
        var EENHEID = /(\d) (mm²|cm²|m²|m³\/h|m³|mm|cm|km|mA|kA|kWh|kW\/m³|kW|kVA|VA|Wh|W\/m²|W\/m|W|kPa|Pa|mbar|bar|°C|°fH|°dH|kΩ|Ω|N·m|l\/kW|l\/min|l\/h|l\/s|m\/s|cm²\/kW|kg\/h|kg|dB|Hz|min|ml|A|V|K|l|g|h|m|s|u|%)(?![A-Za-z0-9²³\/])/g;
        function bind(s) {
            if (!s || s.indexOf(' ') < 0) return s;
            return s.replace(EENHEID, '$1' + NBSP + '$2').replace(new RegExp('(\\d' + NBSP + 'A) ([BCD])(?![A-Za-z])', 'g'), '$1' + NBSP + '$2');
        }
        function tabelHtml(t) {
            var kop = t.kop || [], rijen = t.rijen || [];
            var nk = rijen.reduce(function (a, rij) { return Math.max(a, rij.length); }, kop.length);
            var status = kop.length && tekst(kop[kop.length - 1]) === '' ? kop.length - 1 : -1;
            var num = [], ruim = [], c;
            for (c = 0; c < nk; c++) {
                num[c] = c > 0 && c !== status && rijen.some(function (rij) { return GETAL.test(tekst(rij[c])); }) &&
                    rijen.every(function (rij) { var s = tekst(rij[c]); return s === '' || s === '–' || GETAL.test(s); });
                ruim[c] = c !== status && rijen.some(function (rij) { return tekst(rij[c]).length > 34; });
            }
            var kies = typeof t.kies === 'number' ? t.kies : -1;
            if (kies < 0) rijen.some(function (rij, i) { if (rij.some(function (x) { return /kleinste|gekozen/.test(tekst(x)); })) { kies = i; return true; } return false; });
            if (kies < 0 && status >= 0) rijen.some(function (rij, i) { if (tekst(rij[status]).charAt(0) === VINK) { kies = i; return true; } return false; });
            function cel(s, ci) {
                s = bind(tekst(s));
                if (ci !== status) return tx(s);
                if (s.charAt(0) === VINK) return '<span class="ok">' + ico('vink', 14) + tx(s.slice(1).trim()) + '</span>';
                return s ? '<span class="nok">' + tx(s) + '</span>' : '';
            }
            return '<div class="rk-tabelwrap"><table class="rk-tabel"><thead><tr>' + kop.map(function (k, ci) { return '<th' + (num[ci] ? ' class="num"' : '') + '>' + tx(k) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                rijen.map(function (rij, ri) {
                    return '<tr' + (ri === kies ? ' class="kies"' : '') + '>' + rij.map(function (x, ci) { var kl = (num[ci] ? 'num' : '') + (ruim[ci] ? ' ruim' : ''); return '<td' + (kl.trim() ? ' class="' + kl.trim() + '"' : '') + '>' + cel(x, ci) + '</td>'; }).join('') + '</tr>';
                }).join('') + '</tbody></table></div>';
        }
        function hoofdTekst(r) { return r && r.uit ? r.uit.filter(function (u) { return u.hoofd; }).map(function (u) { return (typeof u.w === 'number' ? R.fmt(u.w, u.dec) : u.w) + '|' + (u.e || ''); }).join('§') : ''; }
        function reken() {
            var b = S.calc; if (!b) return;
            var r = R.reken(b, waardenVan(b));
            S.laatste = r;
            var el = host.querySelector('#rkUit');
            if (!el) return;
            var nu = hoofdTekst(r), was = S.hoofd[b.id];
            el.innerHTML = uitkomstHtml(r, b);
            if (was != null && nu && was !== nu) el.querySelectorAll('.rk-hero .w').forEach(function (x) { x.classList.add('tik'); });
            S.hoofd[b.id] = nu;
        }
        function kopieer() {
            var b = S.calc, r = S.laatste; if (!b || !r || r.fout || r.wacht) { toast('Nog geen resultaat'); return; }
            var w = waardenVan(b), regels = [b.naam, ''];
            b.velden.forEach(function (f) {
                if (f.type === 'rijen') {
                    regels.push(f.label + ':');
                    (w[f.k] || []).forEach(function (rij) {
                        var delen = (f.kolommen || []).map(function (c) {
                            var val = rij[c.k];
                            if (c.type === 'keuze') { var o = (c.opties || []).filter(function (x) { return String(x.v) === String(val); })[0]; return o ? o.t : ''; }
                            return val == null || val === '' ? '' : c.label + ' ' + String(val).replace('.', ',');
                        }).filter(function (x) { return x; });
                        if (delen.length) regels.push('  ' + delen.join(' · '));
                    });
                    return;
                }
                var val = w[f.k];
                if (f.type === 'keuze') { var o = (f.opties || []).filter(function (x) { return String(x.v) === String(val); })[0]; val = o ? o.t : val; }
                if (f.type === 'vink') val = val ? 'ja' : 'nee';
                if (val === '' || val == null) return;
                regels.push(f.label + ': ' + val + (f.type === 'getal' || !f.type ? ' ' + (w[f.k + '_eh'] || f.eh || '') : ''));
            });
            regels.push('');
            (r.uit || []).forEach(function (u) { regels.push(u.label + ': ' + (typeof u.w === 'number' ? R.fmt(u.w, u.dec) : u.w) + (u.e ? ' ' + u.e : '') + (u.opm ? ' (' + u.opm + ')' : '')); });
            (r.waarsch || []).forEach(function (t) { regels.push('! ' + t); });
            if (b.bron) regels.push('', 'Basis: ' + b.bron);
            regels.push('QE Rekenmachine · ' + (b.soort === 'exact' ? 'exact' : 'richtwaarde'));
            var tekstUit = regels.map(function (x) { return String(x).replace(/\s+$/, ''); }).join('\n');
            var klaar = function () { toast('Gekopieerd'); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tekstUit).then(klaar, function () { fallback(tekstUit); klaar(); });
            else { fallback(tekstUit); klaar(); }
        }
        function fallback(t) { try { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) {} }
        function bewaar(b) { lsZet('qe_reken_v_' + b.id, S.waarden[b.id]); }
        function recentZet(b) {
            S.recent = [b.id].concat(S.recent.filter(function (x) { return x !== b.id; })).slice(0, 8);
            lsZet('qe_reken_recent', S.recent);
        }

        // ---------------- render + events
        function render(metBeweging) {
            var h = S.view === 'start' ? renderStart() : S.view === 'module' ? renderModule() : renderCalc();
            host.innerHTML = '<div class="rk-view' + (metBeweging ? ' rk-kom' : '') + '">' + h + '</div>';
            titel(S.view === 'start' ? 'Rekenmachine' : S.view === 'module' ? S.mod.naam : S.calc.naam);
            if (S.view === 'calc') { reken(); recentZet(S.calc); }
        }
        function zoekZet(q) {
            S.q = q; render(false);
            var el = host.querySelector('#rkQ'); if (el) { el.focus(); try { el.setSelectionRange(q.length, q.length); } catch (x) {} }
        }
        host.addEventListener('click', function (e) {
            var t = e.target.closest('[data-act]'); if (!t || !host.contains(t)) return;
            var act = t.getAttribute('data-act'), b = S.calc;
            if (act === 'mod') { S.q = ''; ga('module', R.moduleVan(t.getAttribute('data-key'))); }
            else if (act === 'calc') { S.q = ''; ga('calc', R.vind(t.getAttribute('data-id'))); }
            else if (act === 'kstart') naarStart();
            else if (act === 'kmod') naarModule(R.moduleVan(t.getAttribute('data-key')));
            else if (act === 'zoekwis') zoekZet('');
            else if (act === 'zoekwoord') zoekZet(t.getAttribute('data-q') || '');
            else if (act === 'snel' && b) {
                var k = t.getAttribute('data-k'), f = b.velden.filter(function (x) { return x.k === k; })[0], w = waardenVan(b);
                w[k] = String(t.getAttribute('data-v')).replace('.', ','); if (f && f.eh) w[k + '_eh'] = f.eh;
                var inp = host.querySelector('input[data-k="' + k + '"]'); if (inp) inp.value = w[k];
                var sel = host.querySelector('select[data-eh="' + k + '"]'); if (sel && f && f.eh) sel.value = f.eh;
                t.parentNode.querySelectorAll('button').forEach(function (x) { x.classList.toggle('aan', x === t); });
                bewaar(b); reken();
            }
            else if (act === 'rijbij' && b) { var kk = t.getAttribute('data-k'), ff = b.velden.filter(function (x) { return x.k === kk; })[0], ww = waardenVan(b), nieuw = {}; (ff.kolommen || []).forEach(function (c) { nieuw[c.k] = c.type === 'keuze' ? (c.opties[0] || {}).v : ''; }); (ww[kk] = ww[kk] || []).push(nieuw); bewaar(b); herteken(); }
            else if (act === 'rijweg' && b) { var k2 = t.getAttribute('data-k'), i2 = Number(t.getAttribute('data-i')), w2 = waardenVan(b); (w2[k2] || []).splice(i2, 1); bewaar(b); herteken(); }
            else if (act === 'wis' && b) { S.waarden[b.id] = standaard(b); bewaar(b); herteken(); }
            else if (act === 'fav' && b) {
                var i = S.fav.indexOf(b.id); if (i >= 0) S.fav.splice(i, 1); else S.fav.unshift(b.id);
                lsZet('qe_reken_fav', S.fav);
                t.classList.toggle('aan', i < 0); t.setAttribute('aria-pressed', i < 0 ? 'true' : 'false'); t.setAttribute('title', i < 0 ? 'Uit je favorieten halen' : 'Bij je favorieten zetten');
                toast(i < 0 ? 'Bij je favorieten' : 'Uit je favorieten');
            }
            else if (act === 'kopieer') kopieer();
        });
        function herteken() { var form = host.querySelector('#rkForm'); if (!form) return; var b = S.calc, w = waardenVan(b); form.querySelectorAll('.rk-veld').forEach(function (el) { var f = b.velden.filter(function (x) { return x.k === el.getAttribute('data-veld'); })[0]; if (f) el.outerHTML = veldHtml(f, w); }); reken(); }
        function opInvoer(e) {
            var el = e.target, b = S.calc;
            if (el.id === 'rkQ') { S.q = el.value; var q = S.q; clearTimeout(S.zoekT); S.zoekT = setTimeout(function () { if (S.q !== q) return; var pos = el.selectionStart; render(false); var el2 = host.querySelector('#rkQ'); if (el2) { el2.focus(); try { el2.setSelectionRange(pos, pos); } catch (x) {} } }, 120); return; }
            if (!b) return;
            var w = waardenVan(b);
            if (el.hasAttribute('data-rk')) { var k = el.getAttribute('data-rk'), i = Number(el.getAttribute('data-i')), c = el.getAttribute('data-c'); if (w[k] && w[k][i]) w[k][i][c] = el.value; }
            else if (el.hasAttribute('data-eh')) w[el.getAttribute('data-eh') + '_eh'] = el.value;
            else if (el.hasAttribute('data-k')) {
                var kk = el.getAttribute('data-k');
                w[kk] = el.type === 'checkbox' ? el.checked : el.value;
                var chips = host.querySelector('.rk-veld[data-veld="' + kk + '"] .rk-snel'); if (chips) { var eerste = false; chips.querySelectorAll('button[data-act="snel"]').forEach(function (x) { var aan = !eerste && String(x.getAttribute('data-v')).replace('.', ',') === String(el.value); if (aan) eerste = true; x.classList.toggle('aan', aan); }); }
            }
            bewaar(b); reken();
        }
        host.addEventListener('input', opInvoer);
        host.addEventListener('change', function (e) { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') opInvoer(e); });
        // "Toon berekening" blijft open terwijl je verder typt (de uitkomst wordt bij elke toets hertekend).
        host.addEventListener('toggle', function (e) { var d = e.target; if (d && d.classList && d.classList.contains('rk-stappen')) S.stappenOpen = !!d.open; }, true);

        render(false);
        return {
            terug: terug, kanTerug: function () { return S.stapel.length > 0; }, ga: ga, render: render,
            open: function (id) { var b = R.vind(id); if (b) ga('calc', b); },
            zoek: function (q) { S.q = q; S.view = 'start'; S.mod = null; S.calc = null; S.stapel = []; render(false); },
            state: function () { return { view: S.view, mod: S.mod && S.mod.key, calc: S.calc && S.calc.id, laatste: S.laatste }; }
        };
    }

    root.QERekenUI = { mount: mount, versie: 2, tx: tx, ico: ico };
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-ui */
