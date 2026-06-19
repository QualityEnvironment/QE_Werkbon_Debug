/* =========================================================
   QE Werkbon — Vloeibare login-animatie
   Vanilla port van de Claude Design "Animated Login" (handoff-export).

   Twee publieke functies op window.QELiquidLogin:
   - playIntro()           : logo, label en kaart schuiven in wanneer het
                             loginscherm verschijnt (showLogin).
   - beginTransition(build) : bij login-succes. Toont een overlay over het
                             loginscherm, roept build() (= app.showApp()) erachter
                             aan, laat het QE-logo vloeibaar wegsmelten tot een
                             draaiend laad-wiel dat als sliert wegvliegt, en faadt
                             daarna de overlay uit zodat de app verschijnt.

   VEILIG ONTWORPEN: raakt de e-mail/PIN/showApp-logica nooit aan, en als
   animaties niet mogelijk zijn (oude WebView, prefers-reduced-motion, ontbrekende
   elementen) wordt de app altijd gewoon getoond. Een noodtimer (6 s) zorgt dat
   de gebruiker nooit vastzit achter de overlay.
   ========================================================= */
(function (global) {
  'use strict';

  var OV_ID = 'liquidTransition';
  var anims = [];

  function el(id) { return document.getElementById(id); }
  function ov() { return el(OV_ID); }
  function q(sel) { var o = ov(); return o ? o.querySelector(sel) : null; }

  function prefersReduced() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function canAnimate() {
    return typeof Element !== 'undefined' && Element.prototype &&
           typeof Element.prototype.animate === 'function';
  }
  function setStyle(node, obj) { if (node) { try { Object.assign(node.style, obj); } catch (e) {} } }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function anim(node, frames, opts) {
    if (!node || !canAnimate()) return { finished: Promise.resolve(), cancel: function () {} };
    var a = node.animate(frames, Object.assign({ fill: 'forwards', easing: 'cubic-bezier(.4,0,.2,1)' }, opts));
    anims.push(a);
    return a;
  }
  function cancelAll() {
    anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    anims = [];
  }

  // ---- INTRO: logo / label / kaart schuiven in ----
  function playIntro() {
    var stage = el('loginLogoStage');
    var label = el('loginSubtitle');
    var card = document.querySelector('#loginScreen .login-card');
    try {
      if (!canAnimate() || prefersReduced()) {
        [stage, label, card].forEach(function (n) { setStyle(n, { opacity: '1', transform: 'none' }); });
        return;
      }
      // begin-staat synchroon zetten (vóór de eerste paint) zodat er geen flits is
      setStyle(stage, { opacity: '0', transform: 'translateY(36px) scale(.86)' });
      setStyle(label, { opacity: '0', transform: 'translateY(16px)' });
      setStyle(card, { opacity: '0', transform: 'translateY(64px)' });
      var E = 'cubic-bezier(.2,.8,.2,1)';
      anim(stage, [
        { opacity: 0, transform: 'translateY(36px) scale(.86)' },
        { opacity: 1, transform: 'translateY(0) scale(1.04)', offset: .7 },
        { opacity: 1, transform: 'translateY(0) scale(1)' }
      ], { duration: 760, easing: 'cubic-bezier(.2,.75,.25,1.1)' });
      anim(label, [
        { opacity: 0, transform: 'translateY(16px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 440, delay: 280, easing: E });
      anim(card, [
        { opacity: 0, transform: 'translateY(64px)' },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: 640, delay: 180, easing: E });
    } catch (e) {
      // nooit de login onzichtbaar laten
      [stage, label, card].forEach(function (n) { setStyle(n, { opacity: '1', transform: 'none' }); });
    }
  }

  // zet de overlay-mark terug naar het scherpe 1:1-logo
  function resetMark() {
    setStyle(q('#llLogoStage'), { transform: 'none', opacity: '1' });
    setStyle(q('#llWhiteTile'), { opacity: '1', transform: 'scale(1)' });
    setStyle(q('#llOrangeFly'), { opacity: '1', transform: 'none' });
    setStyle(q('#llOrangeGoo'), { opacity: '1' });
    setStyle(q('#llSqRect'), { opacity: '1', transform: 'none' });
    ['#llOdrip1', '#llOdrip2', '#llOdrip3'].forEach(function (id) { setStyle(q(id), { opacity: '0', transform: 'none' }); });
    var og = q('#llOrangeGoo'); if (og) og.removeAttribute('filter');
    var pg = q('#llPurpleGoo'); if (pg) pg.removeAttribute('filter');
    setStyle(q('#llPurpleFly'), { opacity: '1', transform: 'none' });
    setStyle(q('#llRingSpin'), { transform: 'none' });
    setStyle(q('#llRing'), { strokeDasharray: 'none', strokeDashoffset: '0', strokeWidth: '21', opacity: '1' });
    setStyle(q('#llSwoosh'), { opacity: '1', transform: 'none' });
  }

  function setGoo() {
    ['#qe-gooblurO', '#qe-gooblurP'].forEach(function (id) { var b = q(id); if (b) b.setAttribute('stdDeviation', '7'); });
  }

  // plaats het overlay-logo exact over het login-logo (naadloze overgang)
  function alignToLoginLogo() {
    try {
      var src = el('loginLogoStage'), stage = q('#llLogoStage');
      if (!src || !stage) return;
      var r = src.getBoundingClientRect();
      if (!r || !r.width) return;
      setStyle(stage, {
        position: 'absolute', margin: '0',
        left: r.left + 'px', top: r.top + 'px',
        width: r.width + 'px', height: r.height + 'px'
      });
    } catch (e) {}
  }

  // ---- DE MELT: vierkant vloeit weg & wordt opgeslorpt, swoosh → ring,
  //      ring → draaiend wiel, daarna omhoog getrokken tot sliert ----
  async function melt() {
    var liq = 'cubic-bezier(.55,0,.5,1)';
    var E = 'cubic-bezier(.4,0,.2,1)';
    var C = 232.5; // 2·π·37 — omtrek van de ring

    // tegel lost op; logo groeit & zakt richting midden
    anim(q('#llWhiteTile'), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.12)' }], { duration: 440, easing: E });
    anim(q('#llLogoStage'), [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(64px) scale(1.3)' }], { duration: 700, easing: 'cubic-bezier(.3,.7,.2,1)' });

    // 1. oranje vierkant vervloeit: zakt, druipt, wordt in de ring gezogen
    var og = q('#llOrangeGoo'); if (og) og.setAttribute('filter', 'url(#qe-gooO)');
    anim(q('#llSqRect'), [
      { transform: 'scale(1,1)', offset: 0 },
      { transform: 'scale(1.04,.9)', offset: .25 },
      { transform: 'scale(.86,1.02)', offset: .5 },
      { transform: 'scale(.34,.34)', opacity: 1, offset: .82 },
      { transform: 'scale(.05,.05)', opacity: 0, offset: 1 }
    ], { duration: 900, easing: liq });
    [['#llOdrip1', 34, 760], ['#llOdrip2', 42, 880], ['#llOdrip3', 30, 700]].forEach(function (cfg, i) {
      anim(q(cfg[0]), [
        { opacity: 0, transform: 'translateY(0) scale(.6)' },
        { opacity: 1, transform: 'translateY(2px) scale(1)', offset: .25 },
        { opacity: 1, transform: 'translateY(' + (cfg[1] * .6) + 'px) scale(.85)', offset: .6 },
        { opacity: 0, transform: 'translateY(' + cfg[1] + 'px) scale(.4)' }
      ], { duration: cfg[2], delay: 120 + i * 70, easing: 'cubic-bezier(.4,0,.7,1)' });
    });

    await wait(260);

    // 2. de swoosh vloeit omhoog en smelt in de ring
    var pg = q('#llPurpleGoo'); if (pg) pg.setAttribute('filter', 'url(#qe-gooP)');
    anim(q('#llSwoosh'), [
      { transform: 'translateY(0) scaleX(1)', opacity: 1, offset: 0 },
      { transform: 'translateY(-14px) scaleX(.7)', opacity: 1, offset: .5 },
      { transform: 'translateY(-30px) scaleX(.25)', opacity: 0, offset: 1 }
    ], { duration: 560, easing: liq });
    anim(q('#llRing'), [{ strokeWidth: 21 }, { strokeWidth: 27, offset: .5 }, { strokeWidth: 22 }], { duration: 620, easing: 'ease-in-out' });
    anim(q('#llRingSpin'), [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: .5 }, { transform: 'scale(1)' }], { duration: 620, easing: 'ease-in-out' });

    await wait(540);

    // 3. de volle donut opent tot een hol, draaiend wiel (laad-wiel)
    anim(q('#llRing'), [
      { strokeDasharray: C + ' 0.001', strokeDashoffset: 0 },
      { strokeDasharray: (C * 0.7) + ' ' + (C * 0.3), strokeDashoffset: 0 }
    ], { duration: 420, easing: E });
    setStyle(q('#llRing'), { strokeDasharray: (C * 0.7) + ' ' + (C * 0.3) });
    await wait(260);
    var spin = null;
    if (canAnimate() && q('#llRingSpin')) {
      spin = q('#llRingSpin').animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 950, iterations: Infinity, easing: 'linear' });
      anims.push(spin);
    }

    await wait(1500);

    // 4. verzamel tot druppel, trek dan omhoog tot een dunne sliert die wegvliegt
    try { if (spin) spin.cancel(); } catch (e) {}
    setStyle(q('#llRingSpin'), { transform: 'none' });
    anim(q('#llRing'), [
      { strokeDasharray: (C * 0.7) + ' ' + (C * 0.3), strokeWidth: 22 },
      { strokeDasharray: C + ' 0.001', strokeWidth: 52, offset: .55 },
      { strokeDasharray: C + ' 0.001', strokeWidth: 82 }
    ], { duration: 320, easing: 'cubic-bezier(.4,0,.6,1)' });
    setStyle(q('#llRing'), { strokeWidth: '82', strokeDasharray: 'none' });
    anim(q('#llPurpleFly'), [{ transform: 'scale(1)' }, { transform: 'scale(1.12) translateY(6px)' }, { transform: 'scale(.96) translateY(2px)' }], { duration: 300, easing: 'cubic-bezier(.4,0,.6,1)' });
    await wait(240);
    var bp = q('#qe-gooblurP'); if (bp) bp.setAttribute('stdDeviation', '10');
    var fly = anim(q('#llPurpleFly'), [
      { transform: 'translateY(0) scaleX(1) scaleY(1)', opacity: 1, offset: 0 },
      { transform: 'translateY(12px) scaleX(1.18) scaleY(.66)', opacity: 1, offset: .12 },
      { transform: 'translateY(-120px) scaleX(.5) scaleY(1.9)', opacity: 1, offset: .4 },
      { transform: 'translateY(-380px) scaleX(.18) scaleY(3.4)', opacity: 1, offset: .73 },
      { transform: 'translateY(-820px) scaleX(.04) scaleY(5.4)', opacity: 0, offset: 1 }
    ], { duration: 820, easing: 'cubic-bezier(.5,0,.75,.3)' });
    await fly.finished;
  }

  // ---- volledige login → app overgang ----
  function beginTransition(buildApp) {
    var built = false, done = false;
    function build() {
      if (built) return; built = true;
      if (typeof buildApp === 'function') { try { buildApp(); } catch (e) {} }
    }
    function cleanup() {
      cancelAll();
      var o = ov();
      if (o) { o.style.display = 'none'; o.style.opacity = '0'; o.style.pointerEvents = 'none'; }
    }
    function fadeOut() {
      if (done) return; done = true;
      var o = ov();
      if (o && canAnimate() && !prefersReduced()) {
        var a = o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease', fill: 'forwards' });
        a.onfinish = cleanup;
        setTimeout(cleanup, 700);
      } else {
        cleanup();
      }
    }

    var o = ov();
    // geen animatie mogelijk → bouw de app en toon ze meteen
    if (!o || !q('#llRing') || !canAnimate() || prefersReduced()) {
      build();
      cleanup();
      return;
    }

    try {
      cancelAll();
      resetMark();
      setGoo();
      alignToLoginLogo();
      o.style.display = 'block';
      o.style.pointerEvents = 'auto';
      o.style.opacity = '0';
      // noodtimer: de gebruiker zit nooit vast achter de overlay
      var started = false;
      function go() {
        if (started) return; started = true;
        o.style.opacity = '1';
        build(); // showApp() draait nu onzichtbaar achter de overlay
        melt().then(function () { clearTimeout(safety); fadeOut(); })
              .catch(function () { clearTimeout(safety); fadeOut(); });
      }
      var safety = setTimeout(function () { build(); fadeOut(); }, 6000);
      // zachte cover-in over het loginscherm, dán de app erachter bouwen
      var cover = o.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease', fill: 'forwards' });
      cover.onfinish = go;
      // mocht onfinish niet vuren (zeldzaam), toch tóch doorgaan
      setTimeout(go, 320);
    } catch (e) {
      build();
      cleanup();
    }
  }

  global.QELiquidLogin = { playIntro: playIntro, beginTransition: beginTransition };
})(window);
