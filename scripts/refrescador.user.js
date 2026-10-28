// ==UserScript==
// @name         Mobisond · Refrescador de pestañas
// @namespace    mobisond
// @version      3.0
// @description  Refresca la página entera cada 30 segundos (o lo que elijas) en las pestañas que prendas desde ↻ Refrescador (cualquier página). Refresca siempre, aunque estés escribiendo o usando la página. Muestra la cuenta en el título y, en ServiceNow, avisa si se cerró la sesión.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @updateURL    https://cjaime-boop.github.io/maps/scripts/refrescador.user.js
// @downloadURL  https://cjaime-boop.github.io/maps/scripts/refrescador.user.js
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  if (window.top !== window) return;   // solo la página entera, nunca los recuadros de adentro
  var SEG = Number(GM_getValue('segundos', 30)) || 30;   // cada cuántos segundos (se cambia desde el menú)

  // la página se reconoce por su dirección (sin lo que va después del #)
  var miClave = location.origin + location.pathname + location.search;
  function paginas() { return GM_getValue('refrescar_paginas', {}); }
  function limpio(t) { t = String(t || ''); var r = /^(\(\d+ s\)|\(⏸\)|\(sin conexión\)|⚠ SESIÓN CERRADA ·)\s*/; while (r.test(t)) t = t.replace(r, ''); return t.trim(); }

  // ---------------------------------------------------------------- ServiceNow: sesión cerrada
  // Si después de un refresco aparece la pantalla de login, avisa: sin sesión no entra ningún caso.
  if (/service-now\.com$/i.test(location.hostname)) {
    var esLogin = /login\.do|logout/i.test(location.pathname) || !!document.querySelector('#user_name, input[name="user_name"]');
    if (esLogin) {
      if (Date.now() - GM_getValue('ultimo_refresco', 0) < 3 * 60 * 1000 && !GM_getValue('aviso_login', false)) {
        GM_setValue('aviso_login', true);
        try {
          GM_notification({title: 'ServiceNow: se cerró la sesión', text: 'La página dejó de refrescarse. Volvé a entrar para no perderte casos.',
                           timeout: 0, silent: false, onclick: function () { window.focus(); }});
        } catch (e) {}
        document.title = '⚠ SESIÓN CERRADA · ' + limpio(document.title);
      }
      return;
    }
    GM_setValue('aviso_login', false);
  }

  // ---------------------------------------------------------------- menú y cuadro
  // El menú tiene una sola opción: abre el cuadro con el deslizador (refrescar esta pestaña sí/no) y los segundos.
  var PASOS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1800, 3600];   // las paradas de la regla
  var RAPIDOS = [[15, '15 s'], [30, '30 s'], [45, '45 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']];
  var alCambiarSeg = [];
  try {
    GM_addValueChangeListener('segundos', function (n, viejo, nuevo) {
      SEG = Number(nuevo) || 30; alCambiarSeg.forEach(function (f) { f(); });
    });
  } catch (e) {}
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function prender(si) {
    var p = paginas();
    if (si) p[miClave] = limpio(document.title) || location.hostname; else delete p[miClave];
    GM_setValue('refrescar_paginas', p);
    if (si) arrancar(); else if (corriendo) corriendo();
  }
  function abrirCuadro() {
    var viejo = document.getElementById('mobisond-refrescador'); if (viejo) viejo.remove();
    var host = document.createElement('div'); host.id = 'mobisond-refrescador';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
    var sh = host.attachShadow({mode: 'open'});
    var ver = typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '';
    sh.innerHTML = '<style>' +
      '*{box-sizing:border-box;font-family:"Segoe UI",Roboto,Arial,sans-serif}' +
      '.fondo{position:absolute;inset:0;background:rgba(15,23,42,.35)}' +
      '.p{position:absolute;top:70px;right:40px;width:400px;background:#fff;border-radius:16px;box-shadow:0 16px 40px rgba(15,23,42,.28);overflow:hidden;color:#0f172a;font-size:13.5px}' +
      '.h{background:linear-gradient(135deg,#1e3a5f,#2b5c8a);color:#fff;padding:14px 18px;display:flex;align-items:center;gap:10px}' +
      '.ic{width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:17px;flex:none}' +
      '.h b{font-size:15px}.h small{display:block;font-size:11.5px;opacity:.75;font-weight:400;max-width:230px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.v{margin-left:auto;font-size:12px;opacity:.7}.x{margin-left:12px;font-size:18px;opacity:.85;cursor:pointer}' +
      '.b{padding:16px 18px 18px;display:flex;flex-direction:column;gap:16px}' +
      '.card{display:flex;align-items:center;gap:14px;padding:14px;border-radius:12px;border:1px solid #e2e8f0;cursor:pointer;transition:background .2s,border-color .2s}' +
      '.card.on{background:linear-gradient(135deg,#eff6ff,#f8fbff);border-color:#bfdbfe}' +
      '.ring{width:54px;height:54px;flex:none;position:relative}.ring svg{transform:rotate(-90deg)}' +
      '.ring span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 15px "Segoe UI";color:#1e3a5f}' +
      '.ring .off{color:#94a3b8;font-size:13px}.ring circle{transition:stroke-dashoffset .9s linear}' +
      '.tx b{font-size:14.5px;display:block}.tx small{color:#64748b;font-size:12.5px}' +
      '.ll{margin-left:auto;width:46px;height:26px;border-radius:13px;background:#cbd5e1;position:relative;flex:none;transition:background .2s}' +
      '.ll:after{content:"";position:absolute;left:3px;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}' +
      '.on .ll{background:#2563eb}.on .ll:after{transform:translateX(20px)}' +
      '.sec{display:flex;align-items:baseline;font-size:11.5px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;font-weight:600}' +
      '.sec em{margin-left:auto;font-style:normal;text-transform:none;letter-spacing:0;font-size:22px;font-weight:700;color:#1e3a5f}.sec em small{font-size:12.5px;font-weight:400;color:#64748b;margin-left:3px}' +
      '.seg{display:grid;grid-template-columns:repeat(6,1fr);background:#f1f5f9;border-radius:10px;padding:3px;gap:2px}' +
      '.seg button{border:0;background:none;text-align:center;padding:7px 0;border-radius:8px;font-size:13px;color:#334155;cursor:pointer}' +
      '.seg button:hover{background:#e2e8f0}.seg .sel,.seg .sel:hover{background:#fff;color:#1d4ed8;font-weight:700;box-shadow:0 1px 3px rgba(15,23,42,.15)}' +
      'input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:22px;background:none;margin:-4px 0 0;cursor:pointer}' +
      'input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(90deg,#2563eb var(--p),#e2e8f0 var(--p))}' +
      'input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-7px;border-radius:50%;background:#fff;border:2px solid #2563eb;box-shadow:0 1px 3px #0003}' +
      'input[type=range]::-moz-range-track{height:4px;border-radius:2px;background:linear-gradient(90deg,#2563eb var(--p),#e2e8f0 var(--p))}' +
      'input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #2563eb}' +
      '.otro{display:flex;align-items:center;gap:8px;color:#64748b;font-size:12.5px}' +
      '.otro input{width:64px;border:1px solid #cbd5e1;border-radius:7px;padding:5px 8px;font-size:13px;text-align:center}.otro input.mal{border-color:#dc2626}' +
      '.pie{font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;padding-top:12px}' +
      '</style><div class="fondo"></div><div class="p">' +
      '<div class="h"><div class="ic">↻</div><div><b>Refrescador</b><small>' + esc(limpio(document.title).replace(/\s*\|\s*ServiceNow\s*$/i, '') || location.hostname) + '</small></div><span class="v">v' + esc(ver) + '</span><span class="x" title="Cerrar">✕</span></div>' +
      '<div class="b"><div class="card" id="card"><div class="ring"><svg width="54" height="54"><circle cx="27" cy="27" r="23" fill="none" stroke-width="5" id="r0"/>' +
      '<circle cx="27" cy="27" r="23" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" stroke-dasharray="144.5" id="r1"/></svg><span id="rt"></span></div>' +
      '<div class="tx"><b>Refrescar esta pestaña</b><small id="st"></small></div><div class="ll"></div></div>' +
      '<div class="sec">Cada cuánto<em id="big"></em></div>' +
      '<div class="seg">' + RAPIDOS.map(function (r) { return '<button data-s="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div>' +
      '<input type="range" id="rg" min="0" max="' + (PASOS.length - 1) + '" step="1">' +
      '<div class="otro">¿Otro valor? <input id="otro" type="number" min="5" max="3600"> segundos (de 5 a 3600)</div>' +
      '<div class="pie">ℹ️ Se guarda solo. Vale para todas las pestañas que se refrescan.</div></div></div>';
    var $ = function (id) { return sh.getElementById(id); };
    function texto(n) { return n < 60 ? n + ' s' : n % 60 ? Math.floor(n / 60) + ' min ' + (n % 60) + ' s' : (n / 60) + ' min'; }
    function pintarSeg() {
      $('big').innerHTML = SEG < 60 || SEG % 60 ? SEG + '<small>segundos</small>' : (SEG / 60) + '<small>' + (SEG === 60 ? 'minuto' : 'minutos') + '</small>';
      sh.querySelectorAll('.seg button').forEach(function (b) { b.className = +b.dataset.s === SEG ? 'sel' : ''; });
      var i = 0; PASOS.forEach(function (v, k) { if (Math.abs(v - SEG) < Math.abs(PASOS[i] - SEG)) i = k; });
      $('rg').value = i; $('rg').style.setProperty('--p', (i / (PASOS.length - 1) * 100) + '%');
      if (sh.activeElement !== $('otro')) { $('otro').value = SEG; $('otro').className = ''; }
    }
    function pintarEstado() {
      var on = !!paginas()[miClave], e = corriendo && estadoRefresco ? estadoRefresco() : null;
      $('card').className = 'card' + (on ? ' on' : '');
      $('r0').setAttribute('stroke', on ? '#dbeafe' : '#e2e8f0');
      if (!on || !e) {
        $('r1').style.display = 'none'; $('rt').innerHTML = '<span class="off">off</span>';
        $('st').textContent = 'Apagado · la pestaña no se recarga';
      } else {
        $('r1').style.display = '';
        $('r1').setAttribute('stroke-dashoffset', e.pausa ? 0 : String(144.5 * (1 - e.r / SEG)));
        $('r1').setAttribute('stroke', e.pausa ? '#94a3b8' : e.sinRed ? '#dc2626' : '#2563eb');
        $('rt').textContent = e.pausa ? '⏸' : e.r + ' s';
        $('st').textContent = e.pausa ? 'En pausa · tocá el cartelito de abajo para seguir' : e.sinRed ? 'Sin conexión · reintento en ' + e.r + ' s' : 'Se recarga sola · próxima en ' + e.r + ' s';
      }
    }
    function guardarSeg(n) { if (n >= 5 && n <= 3600 && n !== SEG) GM_setValue('segundos', n); SEG = n; pintarSeg(); pintarEstado(); }
    var cerrar = function () { clearInterval(iv); alCambiarSeg.splice(alCambiarSeg.indexOf(pintarSeg), 1); host.remove(); };
    sh.querySelector('.fondo').onclick = cerrar; sh.querySelector('.x').onclick = cerrar;
    $('card').onclick = function () { prender(!paginas()[miClave]); pintarEstado(); };
    sh.querySelectorAll('.seg button').forEach(function (b) { b.onclick = function () { guardarSeg(+b.dataset.s); }; });
    $('rg').oninput = function () { guardarSeg(PASOS[+this.value]); };
    $('otro').oninput = function () {
      var n = Math.round(Number(String(this.value).replace(',', '.')));
      this.className = n >= 5 && n <= 3600 ? '' : 'mal';
      if (!this.className) guardarSeg(n);
    };
    $('otro').onblur = function () { pintarSeg(); };
    alCambiarSeg.push(pintarSeg);
    var iv = setInterval(pintarEstado, 1000);
    pintarSeg(); pintarEstado();
    document.body.appendChild(host);
  }
  GM_registerMenuCommand('↻ Refrescador', abrirCuadro);

  // ---------------------------------------------------------------- refresco
  var corriendo = null, estadoRefresco = null;
  function arrancar() {
    if (corriendo || !paginas()[miClave]) return;
    try { sessionStorage.setItem('mobisond_refresca', '1'); } catch (e) {}   // el Avisador no usa esta pestaña para trabajar
    var proximo = Date.now() + SEG * 1000, pausa = false, apagado = false;
    var alSeg = function () { proximo = Date.now() + SEG * 1000; pintar(); };
    alCambiarSeg.push(alSeg);

    // cartelito chico abajo a la izquierda: se toca para pausar o seguir
    var b = document.createElement('div');
    b.style.cssText = 'position:fixed;left:8px;bottom:40px;z-index:2147483647;font:12px Arial;padding:3px 9px;border-radius:12px;' +
      'background:#1f6f8b;color:#fff;opacity:.9;cursor:pointer;user-select:none;box-shadow:0 1px 4px rgba(0,0,0,.3)';
    b.title = 'Refresco automático (Mobisond). Tocá para pausar o seguir.';
    b.onclick = function (e) { e.stopPropagation(); pausa = !pausa; proximo = Date.now() + SEG * 1000; pintar(); };
    document.body.appendChild(b);

    var sinRed = false, probando = false;
    function pintar() {
      var r = Math.max(0, Math.ceil((proximo - Date.now()) / 1000));
      b.textContent = pausa ? '⏸ refresco en pausa' : sinRed ? '⚠ sin conexión · reintento en ' + r + ' s' : '↻ ' + r + ' s';
      b.style.background = pausa ? '#888' : sinRed ? '#c0392b' : '#1f6f8b';
      document.title = (pausa ? '(⏸) ' : sinRed ? '(sin conexión) ' : '(' + r + ' s) ') + limpio(document.title);
    }
    // Antes de recargar se fija si hay internet. Si no hay, NO recarga (si recarga sin internet, Chrome muestra
    // su página de error, ahí el script no corre y la pestaña queda caída para siempre). Reintenta cada 10 s
    // y recarga apenas vuelve la conexión.
    function hayConexion(listo) {
      if (navigator.onLine === false) { listo(false); return; }
      var ctl = window.AbortController ? new AbortController() : null;
      var corte = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
      fetch(location.origin + '/favicon.ico?_=' + Date.now(), {method: 'HEAD', cache: 'no-store', mode: 'no-cors',
                                                             credentials: 'omit', signal: ctl ? ctl.signal : undefined})
        .then(function () { clearTimeout(corte); listo(true); }, function () { clearTimeout(corte); listo(false); });
    }
    function ocupado() {   // el Avisador está armando un pedido del bot (/semana, /mes): se espera, hasta 3 min
      try { var t = Number(localStorage.getItem('mobisond_ocupado') || 0); return t && Date.now() - t < 3 * 60000; } catch (e) { return false; }
    }
    function recargar() {
      if (probando) return;
      if (ocupado()) { proximo = Date.now() + 5000; pintar(); return; }
      probando = true;
      hayConexion(function (ok) {
        probando = false;
        if (ok) { GM_setValue('ultimo_refresco', Date.now()); location.reload(); return; }
        sinRed = true; proximo = Date.now() + 10000; pintar();
      });
    }
    window.addEventListener('online', function () { if (!pausa && !apagado) { proximo = Date.now(); recargar(); } });
    function tic() {
      if (apagado) return;
      if (pausa) { pintar(); return; }
      if (Date.now() >= proximo) { recargar(); return; }   // refresca siempre (si hay conexión), sin esperar
      pintar();
    }
    // El reloj corre en un "worker" porque Chrome frena los relojes de las pestañas en segundo plano
    // (a veces a 1 vez por minuto). Si la página no deja crear el worker, usa un reloj común.
    var w = null, iv = null;
    try {
      w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},1000)'], {type: 'text/javascript'})));
      w.onmessage = tic;
    } catch (e) {
      iv = setInterval(tic, 1000);
    }
    corriendo = function () {
      apagado = true; if (w) w.terminate(); if (iv) clearInterval(iv); b.remove();
      try { sessionStorage.removeItem('mobisond_refresca'); } catch (e) {}
      document.title = limpio(document.title); corriendo = null; estadoRefresco = null;
      var k = alCambiarSeg.indexOf(alSeg); if (k >= 0) alCambiarSeg.splice(k, 1);
    };
    estadoRefresco = function () { return {r: Math.max(0, Math.ceil((proximo - Date.now()) / 1000)), pausa: pausa, sinRed: sinRed}; };
    pintar();
  }
  if (!paginas()[miClave]) { try { sessionStorage.removeItem('mobisond_refresca'); } catch (e) {} }
  arrancar();
  try {   // si se prende o se apaga desde otra pestaña igual
    GM_addValueChangeListener('refrescar_paginas', function () {
      if (paginas()[miClave]) arrancar(); else if (corriendo) corriendo();
    });
  } catch (e) {}
})();
