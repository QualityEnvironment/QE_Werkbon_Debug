/* QE Rekenmachine — gedeelde UI (v408)
 * BRON = QE-Software/reken-ui.js; kopie in de www via `node sync-reken.js`.
 *
 * QERekenUI.mount(host, { breed, onTitel, toast }) tekent de rekenmachine in `host`
 * (app-scherm of hub-pagina). Eigen CSS (één keer ingespoten), kleuren via de tokens van de
 * gastheer (--bg/--card/--ink/--cb/--accent) met terugval. Geen netwerk, geen DOM buiten host.
 *
 * Schermen: start (zoeken, modules, favorieten, recent) → module (groepen) → berekening
 * (velden links/boven, uitkomst rechts/onder, live). instance.terug() = één stap terug
 * (true als er iets te sluiten was; de gastheer koppelt er zijn terugknop aan).
 */
(function (root) {
    'use strict';
    var R = root.QEReken;
    if (!R) throw new Error('reken-kern.js eerst laden');

    var CSS = [
        '.rk{--rk-bg:var(--bg,#F4F2ED);--rk-card:var(--card,#FDFCFA);--rk-ink:var(--ink,#26334B);--rk-muted:var(--g1,var(--muted,#7A8299));--rk-line:var(--cb,#E5E1D8);--rk-accent:var(--accent,#F99D3E);--rk-wash:var(--wash,#F1EEE6);--rk-groen:var(--green2,var(--groen,#3E7A54));--rk-rood:var(--red2,var(--rood,#B4372F));--rk-amber:var(--amber,#D97E24);--rk-btn:var(--btn,var(--ink,#26334B));--rk-btnfg:var(--btnfg,#FFFFFF);color:var(--rk-ink);font-family:inherit;line-height:1.35}',
        '.rk *{box-sizing:border-box}.rk button{font-family:inherit;cursor:pointer}.rk input,.rk select{font-family:inherit;font-size:16px;color:var(--rk-ink);background:var(--rk-card);border:1.5px solid var(--rk-line);border-radius:10px;padding:10px 12px;width:100%;min-width:0}',
        '.rk input:focus,.rk select:focus{outline:2px solid var(--rk-accent);outline-offset:1px}',
        '.rk-zoek{display:flex;gap:8px;align-items:center;margin-bottom:12px}.rk-zoek input{font-size:16px;padding:12px 14px;border-radius:12px}',
        '.rk-tegels{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
        '.rk-tegel{background:var(--rk-card);border:1.5px solid var(--rk-line);border-radius:14px;padding:14px 12px;text-align:left;color:var(--rk-ink);display:flex;flex-direction:column;gap:4px;min-height:112px}.rk-tegel:hover,.rk-tegel:focus-visible{border-color:var(--rk-accent)}',
        '.rk-tegel .e{font-size:28px;line-height:1}.rk-tegel b{font-size:15px}.rk-tegel .n{font-size:12px;color:var(--rk-muted)}',
        '.rk-kop{display:flex;align-items:center;gap:10px;margin:2px 0 10px}.rk-kop .e{font-size:26px}.rk-kop h2{font-size:18px;margin:0;font-weight:800}.rk-kop .n{font-size:12.5px;color:var(--rk-muted)}',
        '.rk-sectie{font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--rk-muted);font-weight:700;margin:16px 0 6px}',
        '.rk-lijst{display:flex;flex-direction:column;gap:6px}',
        '.rk-item{display:flex;align-items:center;gap:10px;background:var(--rk-card);border:1.5px solid var(--rk-line);border-radius:12px;padding:10px 12px;text-align:left;color:var(--rk-ink);width:100%}.rk-item:hover,.rk-item:focus-visible{border-color:var(--rk-accent)}',
        '.rk-item .t{flex:1;min-width:0}.rk-item b{display:block;font-size:14.5px}.rk-item .k{font-size:12.5px;color:var(--rk-muted)}.rk-item .pijl{color:var(--rk-muted);font-size:18px}.rk-item .e{font-size:20px}',
        '.rk-chip{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;background:var(--rk-wash);color:var(--rk-muted);white-space:nowrap}.rk-chip.exact{color:var(--rk-groen)}.rk-chip.indicatief{color:var(--rk-amber)}',
        '.rk-calc{display:grid;grid-template-columns:1fr;gap:14px}.rk.breed .rk-calc{grid-template-columns:minmax(300px,5fr) minmax(300px,6fr);align-items:start}',
        '.rk-paneel{background:var(--rk-card);border:1.5px solid var(--rk-line);border-radius:14px;padding:14px}.rk.breed .rk-uitpaneel{position:sticky;top:10px}',
        '.rk-intro{font-size:13.5px;color:var(--rk-muted);margin:0 0 10px}.rk-bron{font-size:12px;color:var(--rk-muted);margin:8px 0 0;padding-top:8px;border-top:1px dashed var(--rk-line)}',
        '.rk-veld{margin-bottom:12px}.rk-veld>label{display:block;font-size:12.5px;font-weight:700;color:var(--rk-ink);margin-bottom:4px}.rk-veld .hint{font-size:12px;color:var(--rk-muted);margin-top:3px}',
        '.rk-inrow{display:flex;gap:6px;align-items:center}.rk-inrow input{flex:1}.rk-inrow select.eh{width:auto;max-width:46%;flex:0 0 auto;padding:10px 8px}.rk-inrow .eh{flex:0 0 auto;color:var(--rk-muted);font-size:14px;min-width:34px}',
        '.rk-vink{display:flex;align-items:center;gap:8px;font-size:14px}.rk-vink input{width:20px;height:20px;padding:0;margin:0}',
        '.rk-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.rk-chips button{background:var(--rk-wash);color:var(--rk-ink);border:1px solid var(--rk-line);border-radius:999px;padding:4px 10px;font-size:12.5px;font-weight:600}.rk-chips button:hover{border-color:var(--rk-accent)}.rk-chips button.aan{border-color:var(--rk-accent);background:var(--rk-card)}',
        '.rk-rijen{width:100%;border-collapse:collapse}.rk-rijen td{padding:3px 3px 3px 0;vertical-align:middle}.rk-rijen td:last-child{width:34px;padding-right:0}.rk-rijen select,.rk-rijen input{padding:8px 9px;font-size:14px}.rk-rijen .x{background:none;border:none;color:var(--rk-muted);font-size:18px;padding:4px}.rk-rijen .x:hover{color:var(--rk-rood)}',
        '.rk-knoppen{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.rk-knop{background:var(--rk-btn);color:var(--rk-btnfg);border:none;border-radius:10px;padding:10px 14px;font-weight:700;font-size:14px}.rk-knop.stil{background:transparent;color:var(--rk-ink);border:1.5px solid var(--rk-line);font-weight:600}.rk-knop.aan{border-color:var(--rk-accent);color:var(--rk-amber)}',
        '.rk-hoofd{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}.rk-hoofd .h{flex:1 1 140px;background:var(--rk-wash);border-radius:12px;padding:10px 12px}.rk-hoofd .h .l{font-size:12px;color:var(--rk-muted)}.rk-hoofd .h .w{font-size:22px;font-weight:800;line-height:1.2;word-break:break-word}.rk-hoofd .h .w small{font-size:14px;font-weight:600;color:var(--rk-muted)}.rk-hoofd .h .o{font-size:12px;color:var(--rk-muted);margin-top:2px}',
        '.rk-rij{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--rk-line);font-size:14px}.rk-rij:last-child{border-bottom:none}.rk-rij .l{color:var(--rk-muted);flex:1}.rk-rij .w{font-weight:700;text-align:right;white-space:nowrap}.rk-rij .o{display:block;font-size:12px;color:var(--rk-muted);font-weight:400;white-space:normal;text-align:right}',
        '.rk .groen{color:var(--rk-groen)}.rk .rood{color:var(--rk-rood)}.rk .amber{color:var(--rk-amber)}',
        '.rk-waarsch{background:rgba(217,126,36,.12);border-left:3px solid var(--rk-amber);border-radius:8px;padding:8px 10px;font-size:13px;margin:8px 0}.rk-fout{background:rgba(180,55,47,.1);border-left:3px solid var(--rk-rood);border-radius:8px;padding:8px 10px;font-size:13.5px;margin:8px 0}.rk-wacht{color:var(--rk-muted);font-size:13.5px;padding:6px 0}',
        '.rk-tabelwrap{overflow-x:auto;margin:10px 0}.rk-tabel{width:100%;border-collapse:collapse;font-size:12.5px}.rk-tabel th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:var(--rk-muted);padding:5px 6px;border-bottom:1px solid var(--rk-line);white-space:nowrap}.rk-tabel td{padding:5px 6px;border-bottom:1px solid var(--rk-line);white-space:nowrap}.rk-tabel tr:last-child td{border-bottom:none}',
        '.rk-stappen{margin-top:8px}.rk-stappen summary{cursor:pointer;font-size:13px;font-weight:700;color:var(--rk-ink)}.rk-stappen ol{margin:6px 0 0;padding-left:20px;font-size:13px;color:var(--rk-muted)}.rk-stappen li{margin:3px 0;word-break:break-word}',
        '.rk-opm{font-size:12.5px;color:var(--rk-muted);margin-top:10px}',
        '.rk-leeg{color:var(--rk-muted);font-size:13.5px;padding:10px 4px}',
        '.rk-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--rk-ink);color:var(--rk-card);border-radius:10px;padding:9px 16px;font-size:14px;z-index:9999;opacity:0;transition:opacity .2s;pointer-events:none;max-width:92%}.rk-toast.aan{opacity:1}',
        '@media (max-width:560px){.rk-tegels{grid-template-columns:repeat(2,1fr)}.rk-tegel{min-height:100px;padding:12px 10px}}'
    ].join('\n');

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function ls(k, std) { try { var s = localStorage.getItem(k); return s == null ? std : JSON.parse(s); } catch (e) { return std; } }
    function lsZet(k, w) { try { localStorage.setItem(k, JSON.stringify(w)); } catch (e) {} }
    var SOORT = { exact: 'exact', indicatief: 'richtwaarde', naslag: 'naslag' };

    function mount(host, opts) {
        opts = opts || {};
        if (!document.getElementById('qeRekenCss')) { var st = document.createElement('style'); st.id = 'qeRekenCss'; st.textContent = CSS; document.head.appendChild(st); }
        host.classList.add('rk'); if (opts.breed) host.classList.add('breed');
        var S = { view: 'start', mod: null, calc: null, q: '', stapel: [], fav: ls('qe_reken_fav', []), recent: ls('qe_reken_recent', []), waarden: {}, toastT: null };

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
            render();
            try { window.scrollTo(0, 0); } catch (e) {}
        }
        function terug() {
            if (!S.stapel.length) return false;
            var p = S.stapel.pop();
            S.view = p.view; S.mod = p.mod; S.calc = p.calc; S.q = p.q || '';
            render();
            return true;
        }

        // ---------------- start
        function renderStart() {
            var h = '<div class="rk-zoek"><input type="search" id="rkQ" placeholder="Zoek een berekening (kabel, schouw, afvoer, expansievat…)" value="' + esc(S.q) + '" autocomplete="off"></div>';
            if (S.q.trim()) {
                var res = R.zoek(S.q);
                h += '<div class="rk-sectie">' + (res.length ? res.length + ' berekeningen' : 'Niets gevonden') + '</div><div class="rk-lijst">' + res.map(itemHtml).join('') + '</div>';
                if (!res.length) h += '<div class="rk-leeg">Probeer een ander woord, bv. “kabel”, “radiator”, “afvoer”, “schouw” of “bar”.</div>';
            } else {
                h += '<div class="rk-tegels">' + R.modules.map(function (m) {
                    var n = m.groepen.reduce(function (a, g) { return a + g.items.length; }, 0);
                    return '<button class="rk-tegel" data-act="mod" data-key="' + esc(m.key) + '"><span class="e">' + m.emoji + '</span><b>' + esc(m.naam) + '</b><span class="n">' + esc(m.omschrijving) + '</span><span class="n">' + n + ' berekeningen</span></button>';
                }).join('') + '</div>';
                var favs = S.fav.map(R.vind).filter(Boolean);
                if (favs.length) h += '<div class="rk-sectie">★ Favorieten</div><div class="rk-lijst">' + favs.map(itemHtml).join('') + '</div>';
                var rec = S.recent.map(R.vind).filter(Boolean);
                if (rec.length) h += '<div class="rk-sectie">Recent gebruikt</div><div class="rk-lijst">' + rec.map(itemHtml).join('') + '</div>';
            }
            return h;
        }
        function itemHtml(b) {
            var m = R.moduleVan(b.module);
            return '<button class="rk-item" data-act="calc" data-id="' + esc(b.id) + '"><span class="e">' + (m ? m.emoji : '') + '</span><span class="t"><b>' + esc(b.naam) + '</b><span class="k">' + esc(b.kort) + '</span></span><span class="rk-chip ' + b.soort + '">' + SOORT[b.soort] + '</span><span class="pijl">›</span></button>';
        }
        // ---------------- module
        function renderModule() {
            var m = S.mod, h = '<div class="rk-kop"><span class="e">' + m.emoji + '</span><div><h2>' + esc(m.naam) + '</h2><div class="n">' + esc(m.omschrijving) + '</div></div></div>';
            h += '<div class="rk-zoek"><input type="search" id="rkQ" placeholder="Zoek in ' + esc(m.naam.toLowerCase()) + '…" value="' + esc(S.q) + '" autocomplete="off"></div>';
            var q = S.q.trim();
            if (q) {
                var res = R.zoek(q).filter(function (b) { return b.module === m.key; });
                h += '<div class="rk-sectie">' + (res.length ? res.length + ' gevonden' : 'Niets gevonden in deze module') + '</div><div class="rk-lijst">' + res.map(itemHtml).join('') + '</div>';
            } else {
                m.groepen.forEach(function (g) { h += '<div class="rk-sectie">' + esc(g.naam) + '</div><div class="rk-lijst">' + g.items.map(itemHtml).join('') + '</div>'; });
            }
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
        function veldHtml(f, w) {
            var id = 'rk_' + f.k, h = '<div class="rk-veld" data-veld="' + esc(f.k) + '">';
            if (f.type === 'vink') return h + '<label class="rk-vink"><input type="checkbox" data-k="' + esc(f.k) + '"' + (w[f.k] ? ' checked' : '') + '> ' + esc(f.label) + '</label>' + (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '') + '</div>';
            h += '<label for="' + id + '">' + esc(f.label) + (f.opt ? ' <span style="font-weight:400;color:var(--rk-muted)">(optioneel)</span>' : '') + '</label>';
            if (f.type === 'keuze') {
                h += '<select id="' + id + '" data-k="' + esc(f.k) + '">' + (f.opties || []).map(function (o) { return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(w[f.k]) ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }).join('') + '</select>';
            } else if (f.type === 'tekst') {
                h += '<input id="' + id + '" type="text" data-k="' + esc(f.k) + '" value="' + esc(w[f.k]) + '">';
            } else if (f.type === 'rijen') {
                h += '<table class="rk-rijen" data-rijen="' + esc(f.k) + '"><tbody>';
                (w[f.k] || []).forEach(function (rij, i) {
                    h += '<tr>' + (f.kolommen || []).map(function (c) {
                        if (c.type === 'keuze') return '<td><select data-rk="' + esc(f.k) + '" data-i="' + i + '" data-c="' + esc(c.k) + '">' + (c.opties || []).map(function (o) { return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(rij[c.k]) ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }).join('') + '</select></td>';
                        return '<td style="width:' + (c.type === 'tekst' ? '40' : '26') + '%"><input type="text" ' + (c.type === 'tekst' ? '' : 'inputmode="decimal" ') + 'placeholder="' + esc(c.label) + '" data-rk="' + esc(f.k) + '" data-i="' + i + '" data-c="' + esc(c.k) + '" value="' + esc(rij[c.k] == null ? '' : rij[c.k]) + '"></td>';
                    }).join('') + '<td><button type="button" class="x" data-act="rijweg" data-k="' + esc(f.k) + '" data-i="' + i + '" title="Rij weg">×</button></td></tr>';
                });
                h += '</tbody></table><div class="rk-chips"><button type="button" data-act="rijbij" data-k="' + esc(f.k) + '">+ rij</button></div>';
            } else {
                h += '<div class="rk-inrow"><input id="' + id + '" type="text" inputmode="decimal" data-k="' + esc(f.k) + '" value="' + esc(w[f.k]) + '"' + (f.opt ? ' placeholder="–"' : '') + '>';
                if (f.ehs && f.ehs.length > 1) h += '<select class="eh" data-eh="' + esc(f.k) + '">' + f.ehs.map(function (e) { return '<option value="' + esc(e) + '"' + (e === (w[f.k + '_eh'] || f.eh) ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') + '</select>';
                else if (f.eh) h += '<span class="eh">' + esc(f.eh) + '</span>';
                h += '</div>';
                if (f.snel && f.snel.length) h += '<div class="rk-chips">' + f.snel.map(function (s) { return '<button type="button" data-act="snel" data-k="' + esc(f.k) + '" data-v="' + esc(s.v) + '"' + (String(s.v).replace('.', ',') === String(w[f.k]) ? ' class="aan"' : '') + '>' + esc(s.t) + '</button>'; }).join('') + '</div>';
            }
            if (f.hint) h += '<div class="hint">' + esc(f.hint) + '</div>';
            return h + '</div>';
        }
        function renderCalc() {
            var b = S.calc, w = waardenVan(b), m = S.mod;
            var h = '<div class="rk-kop"><span class="e">' + (m ? m.emoji : '') + '</span><div><h2>' + esc(b.naam) + '</h2><div class="n">' + esc(b.kort) + ' · <span class="rk-chip ' + b.soort + '">' + SOORT[b.soort] + '</span></div></div></div>';
            h += '<div class="rk-calc">';
            if (b.soort !== 'naslag') {
                h += '<div class="rk-paneel" id="rkForm">' + (b.uitleg ? '<p class="rk-intro">' + esc(b.uitleg) + '</p>' : '') + b.velden.map(function (f) { return veldHtml(f, w); }).join('');
                h += '<div class="rk-knoppen"><button type="button" class="rk-knop stil" data-act="wis">Wis</button><button type="button" class="rk-knop stil' + (S.fav.indexOf(b.id) >= 0 ? ' aan' : '') + '" data-act="fav">' + (S.fav.indexOf(b.id) >= 0 ? '★ Favoriet' : '☆ Favoriet') + '</button><button type="button" class="rk-knop stil" data-act="kopieer">Kopieer resultaat</button></div>';
                if (b.bron) h += '<div class="rk-bron"><b>Basis:</b> ' + esc(b.bron) + '</div>';
                h += '</div>';
            }
            h += '<div class="rk-paneel rk-uitpaneel" id="rkUit"></div></div>';
            return h;
        }
        function uitkomstHtml(r, b) {
            if (!r) return '';
            if (r.fout) return '<div class="rk-fout">' + esc(r.fout) + '</div>' + (r.tabel ? tabelHtml(r.tabel) : '');
            if (r.wacht) return '<div class="rk-wacht">Vul nog in: ' + esc((r.ontbreekt || []).join(', ')) + '.</div>';
            var h = '';
            var hoofd = (r.uit || []).filter(function (u) { return u.hoofd; }), rest = (r.uit || []).filter(function (u) { return !u.hoofd; });
            if (hoofd.length) h += '<div class="rk-hoofd">' + hoofd.map(function (u) { return '<div class="h"><div class="l">' + esc(u.label) + '</div><div class="w ' + esc(u.kleur || '') + '">' + waardeHtml(u) + '</div>' + (u.opm ? '<div class="o">' + esc(u.opm) + '</div>' : '') + '</div>'; }).join('') + '</div>';
            if (rest.length) h += '<div>' + rest.map(function (u) { return '<div class="rk-rij"><span class="l">' + esc(u.label) + '</span><span class="w ' + esc(u.kleur || '') + '">' + waardeHtml(u) + (u.opm ? '<span class="o">' + esc(u.opm) + '</span>' : '') + '</span></div>'; }).join('') + '</div>';
            (r.waarsch || []).forEach(function (t) { h += '<div class="rk-waarsch">' + esc(t) + '</div>'; });
            if (r.tabel) h += tabelHtml(r.tabel);
            if (r.tabel2) h += tabelHtml(r.tabel2);
            if (r.stappen && r.stappen.length) h += '<details class="rk-stappen"><summary>Toon berekening</summary><ol>' + r.stappen.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></details>';
            if (r.opm) h += '<div class="rk-opm">' + esc(r.opm) + '</div>';
            if (b && b.soort === 'naslag' && b.bron) h += '<div class="rk-bron"><b>Basis:</b> ' + esc(b.bron) + '</div>';
            return h;
        }
        function waardeHtml(u) {
            var w = typeof u.w === 'number' ? R.fmt(u.w, u.dec) : esc(u.w == null ? '–' : u.w);
            return w + (u.e ? ' <small>' + esc(u.e) + '</small>' : '');
        }
        function tabelHtml(t) {
            return '<div class="rk-tabelwrap"><table class="rk-tabel"><thead><tr>' + (t.kop || []).map(function (k) { return '<th>' + esc(k) + '</th>'; }).join('') + '</tr></thead><tbody>' + (t.rijen || []).map(function (rij) { return '<tr>' + rij.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
        }
        function reken() {
            var b = S.calc; if (!b) return;
            var r = R.reken(b, waardenVan(b));
            S.laatste = r;
            var el = host.querySelector('#rkUit');
            if (el) el.innerHTML = uitkomstHtml(r, b);
        }
        function kopieer() {
            var b = S.calc, r = S.laatste; if (!b || !r || r.fout || r.wacht) { toast('Nog geen resultaat'); return; }
            var w = waardenVan(b), regels = [b.naam, ''];
            b.velden.forEach(function (f) {
                if (f.type === 'rijen') { (w[f.k] || []).forEach(function (rij) { var o = (f.kolommen[0].opties || []).filter(function (x) { return String(x.v) === String(rij[f.kolommen[0].k]); })[0]; regels.push('  ' + (o ? o.t : '') + ': ' + (rij[f.kolommen[1] ? f.kolommen[1].k : ''] || '')); }); return; }
                var val = w[f.k];
                if (f.type === 'keuze') { var o = (f.opties || []).filter(function (x) { return String(x.v) === String(val); })[0]; val = o ? o.t : val; }
                if (f.type === 'vink') val = val ? 'ja' : 'nee';
                if (val === '' || val == null) return;
                regels.push(f.label + ': ' + val + (f.type === 'getal' ? ' ' + (w[f.k + '_eh'] || f.eh || '') : ''));
            });
            regels.push('');
            (r.uit || []).forEach(function (u) { regels.push(u.label + ': ' + (typeof u.w === 'number' ? R.fmt(u.w, u.dec) : u.w) + (u.e ? ' ' + u.e : '') + (u.opm ? ' (' + u.opm + ')' : '')); });
            (r.waarsch || []).forEach(function (t) { regels.push('! ' + t); });
            if (b.bron) regels.push('', 'Basis: ' + b.bron);
            regels.push('QE Rekenmachine · ' + (b.soort === 'exact' ? 'exact' : 'richtwaarde'));
            var tekst = regels.join('\n');
            var klaar = function () { toast('Gekopieerd'); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tekst).then(klaar, function () { fallback(tekst); klaar(); });
            else { fallback(tekst); klaar(); }
        }
        function fallback(tekst) { try { var ta = document.createElement('textarea'); ta.value = tekst; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) {} }
        function bewaar(b) { lsZet('qe_reken_v_' + b.id, S.waarden[b.id]); }
        function recentZet(b) {
            S.recent = [b.id].concat(S.recent.filter(function (x) { return x !== b.id; })).slice(0, 8);
            lsZet('qe_reken_recent', S.recent);
        }

        // ---------------- render + events
        function render() {
            var h = S.view === 'start' ? renderStart() : S.view === 'module' ? renderModule() : renderCalc();
            host.innerHTML = h;
            titel(S.view === 'start' ? 'Rekenmachine' : S.view === 'module' ? S.mod.naam : S.calc.naam);
            if (S.view === 'calc') { reken(); recentZet(S.calc); }
        }
        host.addEventListener('click', function (e) {
            var t = e.target.closest('[data-act]'); if (!t || !host.contains(t)) return;
            var act = t.getAttribute('data-act'), b = S.calc;
            if (act === 'mod') { S.q = ''; ga('module', R.moduleVan(t.getAttribute('data-key'))); }
            else if (act === 'calc') { S.q = ''; ga('calc', R.vind(t.getAttribute('data-id'))); }
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
            else if (act === 'fav' && b) { var i = S.fav.indexOf(b.id); if (i >= 0) S.fav.splice(i, 1); else S.fav.unshift(b.id); lsZet('qe_reken_fav', S.fav); t.classList.toggle('aan', i < 0); t.textContent = i < 0 ? '★ Favoriet' : '☆ Favoriet'; toast(i < 0 ? 'Bij je favorieten' : 'Uit je favorieten'); }
            else if (act === 'kopieer') kopieer();
        });
        function herteken() { var form = host.querySelector('#rkForm'); if (!form) return; var b = S.calc, w = waardenVan(b); form.querySelectorAll('.rk-veld').forEach(function (el) { var f = b.velden.filter(function (x) { return x.k === el.getAttribute('data-veld'); })[0]; if (f) el.outerHTML = veldHtml(f, w); }); reken(); }
        function opInvoer(e) {
            var el = e.target, b = S.calc;
            if (el.id === 'rkQ') { S.q = el.value; var lijst = host; var q = S.q; clearTimeout(S.zoekT); S.zoekT = setTimeout(function () { if (S.q !== q) return; var pos = el.selectionStart; render(); var el2 = host.querySelector('#rkQ'); if (el2) { el2.focus(); try { el2.setSelectionRange(pos, pos); } catch (x) {} } }, 120); return; }
            if (!b) return;
            var w = waardenVan(b);
            if (el.hasAttribute('data-rk')) { var k = el.getAttribute('data-rk'), i = Number(el.getAttribute('data-i')), c = el.getAttribute('data-c'); if (w[k] && w[k][i]) w[k][i][c] = el.value; }
            else if (el.hasAttribute('data-eh')) w[el.getAttribute('data-eh') + '_eh'] = el.value;
            else if (el.hasAttribute('data-k')) {
                var kk = el.getAttribute('data-k');
                w[kk] = el.type === 'checkbox' ? el.checked : el.value;
                var chips = host.querySelector('.rk-veld[data-veld="' + kk + '"] .rk-chips'); if (chips) chips.querySelectorAll('button[data-act="snel"]').forEach(function (x) { x.classList.toggle('aan', String(x.getAttribute('data-v')).replace('.', ',') === String(el.value)); });
            }
            bewaar(b); reken();
        }
        host.addEventListener('input', opInvoer);
        host.addEventListener('change', function (e) { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') opInvoer(e); });

        render();
        return {
            terug: terug, kanTerug: function () { return S.stapel.length > 0; }, ga: ga, render: render,
            open: function (id) { var b = R.vind(id); if (b) ga('calc', b); },
            zoek: function (q) { S.q = q; S.view = 'start'; S.mod = null; S.calc = null; S.stapel = []; render(); },
            state: function () { return { view: S.view, mod: S.mod && S.mod.key, calc: S.calc && S.calc.id, laatste: S.laatste }; }
        };
    }

    root.QERekenUI = { mount: mount, versie: 1 };
})(typeof window !== 'undefined' ? window : globalThis);
/* QE-EIND reken-ui */
