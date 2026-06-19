/* =========================================================
   QE Werkbon — Celebrations (Claude Design "Betaling" + "Uitklokken")
   Vanilla, zelfstandig. Twee geanimeerde feedback-overlays:
     - QECeleb.paymentSuccess({ amountText, methodLabel, onDone })
     - QECeleb.clockOut({ weekend, name, timeText, hoursText, onDone })
   Ring vult → icoon morpht naar vinkje → glow + stralen + confetti + tekst.
   VEILIG: bij elke fout (of geen animatie mogelijk) wordt onDone meteen
   aangeroepen zodat de flow nooit blokkeert. Respecteert reduce-motion.
   Geluid: betaling + weekdag = kort gegenereerd toontje; weekend gebruikt
   de bestaande mp3 (app._playWeekendJingle, los aangeroepen in _clockOut).
   ========================================================= */
(function (global) {
  'use strict';

  function reduceMotion() {
    try { return global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  function elem(tag, style, html) {
    var n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (html != null) n.innerHTML = html;
    return n;
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function run(cfg) {
    var done = false, root, raf, canvas, ctx, parts = [], start = null, audioCtx = null, dismissTimer = null;

    function cleanup() {
      if (raf) cancelAnimationFrame(raf);
      if (dismissTimer) clearTimeout(dismissTimer);
      if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
      if (root && root.parentNode) { try { root.parentNode.removeChild(root); } catch (e) {} }
    }
    function finish() {
      if (done) return; done = true;
      try { cleanup(); } catch (e) {}
      if (typeof cfg.onDone === 'function') { try { cfg.onDone(); } catch (e) {} }
    }

    try {
      if (!document.body) { finish(); return; }

      root = elem('div',
        'position:fixed;inset:0;z-index:4000;display:flex;flex-direction:column;align-items:center;' +
        'justify-content:center;background:' + cfg.bg + ';font-family:Roboto,system-ui,sans-serif;' +
        'text-align:center;padding:0 32px;box-sizing:border-box;opacity:0;transition:opacity .25s ease;');

      canvas = elem('canvas', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;');
      root.appendChild(canvas);

      var stage = elem('div', 'position:relative;width:160px;height:160px;display:flex;align-items:center;justify-content:center;z-index:2;');
      var glow = elem('div', 'position:absolute;width:160px;height:160px;border-radius:50%;opacity:0;background:radial-gradient(circle,' + cfg.glow + ' 0%,transparent 70%);');
      var rays = elem('div', 'position:absolute;width:210px;height:210px;border-radius:50%;opacity:0;' +
        'background:conic-gradient(' + cfg.ray + ' 0deg,transparent 16deg,transparent 40deg,' + cfg.ray + ' 56deg,transparent 80deg,transparent 104deg,' + cfg.ray + ' 120deg,transparent 144deg,transparent 168deg,' + cfg.ray + ' 184deg,transparent 208deg,transparent 232deg,' + cfg.ray + ' 248deg,transparent 272deg,transparent 296deg,' + cfg.ray + ' 312deg,transparent 336deg,transparent 360deg);');
      var ring = elem('div', 'position:absolute;width:116px;height:116px;',
        '<svg width="116" height="116" viewBox="0 0 116 116" style="transform:rotate(-90deg)">' +
        '<circle cx="58" cy="58" r="52" fill="none" stroke="rgba(0,30,69,.08)" stroke-width="6"/>' +
        '<circle class="qec-rf" cx="58" cy="58" r="52" fill="none" stroke="' + cfg.accent + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="327" stroke-dashoffset="327"/></svg>');
      var badge = elem('div', 'position:relative;width:92px;height:92px;border-radius:50%;background:#fff;box-shadow:0 6px 20px ' + cfg.shadow + ';display:flex;align-items:center;justify-content:center;transform:scale(0);');
      var icon = elem('div', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:1;', cfg.icon);
      var check = elem('div', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transform:scale(.6);',
        '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="' + cfg.accent + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>');
      badge.appendChild(icon); badge.appendChild(check);
      stage.appendChild(glow); stage.appendChild(rays); stage.appendChild(ring); stage.appendChild(badge);
      root.appendChild(stage);

      var txt = elem('div', 'position:relative;z-index:2;margin-top:26px;opacity:0;transform:translateY(10px);');
      txt.innerHTML =
        '<div style="font-size:26px;font-weight:700;color:#001E45;letter-spacing:-.3px;">' + (cfg.title || '') + '</div>' +
        '<div style="font-size:15px;color:#6E7681;margin-top:8px;">' + (cfg.subtitle || '') + '</div>' +
        (cfg.detail ? '<div style="margin-top:16px;display:inline-flex;align-items:center;gap:7px;background:' + cfg.pill + ';border-radius:999px;padding:8px 15px;font-size:14px;font-weight:600;color:' + cfg.pillText + ';">' + cfg.detail + '</div>' : '');
      root.appendChild(txt);

      var hint = elem('div', 'position:absolute;bottom:38px;left:0;right:0;text-align:center;font-size:13px;color:#9AA1AD;opacity:0;z-index:2;', 'Tik om verder te gaan');
      root.appendChild(hint);

      document.body.appendChild(root);
      root.offsetWidth; root.style.opacity = '1';
      root.addEventListener('click', finish);

      var ringEl = ring.querySelector('.qec-rf');

      if (reduceMotion() || typeof requestAnimationFrame !== 'function') {
        badge.style.transform = 'scale(1)'; icon.style.opacity = '0';
        check.style.opacity = '1'; check.style.transform = 'scale(1)';
        if (ringEl) ringEl.style.strokeDashoffset = '0';
        glow.style.opacity = '.6'; txt.style.opacity = '1'; txt.style.transform = 'none'; hint.style.opacity = '1';
        dismissTimer = setTimeout(finish, 2400);
        return;
      }

      var dpr = global.devicePixelRatio || 1, W = 0, H = 0;
      function sizeCanvas() { W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx = canvas.getContext('2d'); if (ctx) ctx.scale(dpr, dpr); }
      sizeCanvas();
      function rnd(a, b) { return Math.random() * (b - a) + a; }

      if (cfg.chime && cfg.chime.length) { try { playChime(cfg.chime); } catch (e) {} }

      function drawConfetti(t) {
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        if (t > cfg.confettiStart && (cfg.loopConfetti || t < cfg.confettiStart + 1.0)) {
          if (cfg.burst) {
            if (t < cfg.confettiStart + 0.55 && Math.random() < 0.9)
              parts.push({ x: W / 2 + rnd(-46, 46), y: H * 0.34, vx: rnd(-2.4, 2.4), vy: rnd(-3.6, -1.2), g: 0.11, s: rnd(2.5, 5), life: 1, col: cfg.cols[(Math.random() * cfg.cols.length) | 0] });
          } else if (Math.random() < cfg.spawn) {
            parts.push({ x: rnd(0, W), y: H + 5, vx: rnd(-0.35, 0.35), vy: rnd(-1.6, -0.6), g: 0, s: rnd(2, 4.6), life: rnd(0.6, 1), col: cfg.cols[(Math.random() * cfg.cols.length) | 0], ph: Math.random() * 6 });
          }
        }
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          p.vy += (p.g || 0); p.x += p.vx + (p.ph != null ? Math.sin(t + p.ph) * 0.3 : 0); p.y += p.vy;
          p.life -= (cfg.burst ? 0.014 : 0.004);
          ctx.globalAlpha = Math.max(0, p.life) * (cfg.burst ? 1 : 0.85);
          ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
        parts = parts.filter(function (p) { return p.life > 0 && p.y > -14; });
      }

      function frame(ts) {
        if (done) return;
        if (start == null) start = ts;
        var t = (ts - start) / 1000;
        var seg = function (a, b) { return clamp01((t - a) / (b - a)); };
        var eo = function (x) { return 1 - Math.pow(1 - x, 3); };
        var back = function (x) { var s = 1.6, k = x - 1; return 1 + (s + 1) * k * k * k + s * k * k; };

        badge.style.transform = 'scale(' + clamp01(back(seg(0.05, 0.5))) + ')';
        if (ringEl) ringEl.style.strokeDashoffset = (327 * (1 - seg(0.4, 1.4))) + '';
        icon.style.opacity = (1 - eo(seg(1.2, 1.45))) + '';
        var cp = clamp01(back(seg(1.4, 1.8)));
        check.style.opacity = cp + ''; check.style.transform = 'scale(' + (0.6 + 0.4 * cp) + ')';
        glow.style.opacity = (0.6 * eo(seg(1.5, 2.1)) * (0.85 + 0.15 * Math.sin(t * 3))) + '';
        rays.style.opacity = (0.45 * eo(seg(1.7, 2.4))) + ''; rays.style.transform = 'rotate(' + (t * 16) + 'deg)';
        txt.style.opacity = eo(seg(1.7, 2.1)) + ''; txt.style.transform = 'translateY(' + (10 * (1 - eo(seg(1.7, 2.1)))) + 'px)';
        hint.style.opacity = (eo(seg(2.7, 3.1)) * 0.9) + '';

        drawConfetti(t);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      dismissTimer = setTimeout(finish, cfg.autodismiss || 5500);

      function playChime(notes) {
        var AC = global.AudioContext || global.webkitAudioContext; if (!AC) return;
        audioCtx = new AC();
        var master = audioCtx.createGain(); master.gain.value = 0.14; master.connect(audioCtx.destination);
        var base = audioCtx.currentTime + 0.95;
        notes.forEach(function (n) {
          var s = base + n[0]; var o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.type = 'triangle'; o.frequency.value = n[1]; o.connect(g); g.connect(master);
          g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(1, s + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, s + n[2]); o.start(s); o.stop(s + n[2] + 0.05);
        });
      }
    } catch (e) { finish(); }
  }

  var CARD_ICON = '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#6A2C91" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>';
  var CLOCK_ICON = '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#F99D3E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  function paymentSuccess(o) {
    o = o || {};
    run({
      bg: '#F7F8FA', accent: '#2E9E63', glow: 'rgba(46,158,99,.5)', ray: 'rgba(46,158,99,.18)', shadow: 'rgba(46,158,99,.26)',
      icon: CARD_ICON, title: 'Betaling geslaagd', subtitle: o.methodLabel || '', detail: o.amountText || '',
      pill: '#DCFCE7', pillText: '#15803D', cols: ['#2E9E63', '#22C55E', '#86EFAC', '#BBF7D0'],
      burst: true, confettiStart: 1.5, loopConfetti: false,
      chime: [[0, 783.99, .18], [0.14, 1046.5, .18], [0.30, 1318.5, .55]],
      autodismiss: 4200, onDone: o.onDone
    });
  }

  function clockOut(o) {
    o = o || {};
    var weekend = !!o.weekend;
    run({
      bg: '#F7F8FA', accent: '#F99D3E', glow: 'rgba(249,157,62,.5)', ray: 'rgba(249,157,62,.16)', shadow: 'rgba(249,157,62,.30)',
      icon: CLOCK_ICON, title: weekend ? 'Fijn weekend!' : 'Tot morgen!',
      subtitle: (weekend ? 'Tot maandag' : 'Fijn gewerkt vandaag') + (o.name ? ', ' + o.name : ''),
      detail: ((o.timeText || '') + (o.hoursText ? ' · ' + o.hoursText : '')),
      pill: '#FFF3E0', pillText: '#B45309',
      cols: weekend ? ['#F99D3E', '#6A2C91', '#22C55E', '#3B82F6', '#FFD9A6', '#FFB868'] : ['#F99D3E', '#FFB868', '#E88A2A', '#FFD9A6'],
      burst: false, confettiStart: 2.0, loopConfetti: true, spawn: weekend ? 0.8 : 0.5,
      // weekend = bestaande mp3 (app._playWeekendJingle, los); weekdag = kort toontje
      chime: weekend ? null : [[0, 523.25, .22], [0.16, 659.25, .22], [0.32, 783.99, .5]],
      autodismiss: weekend ? 7000 : 5200, onDone: o.onDone
    });
  }

  global.QECeleb = { paymentSuccess: paymentSuccess, clockOut: clockOut };
})(window);
