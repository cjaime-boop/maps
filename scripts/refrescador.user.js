// ==UserScript==
// @name         Mobisond · Refrescador de pestañas
// @namespace    mobisond
// @version      2.9
// @description  Refresca la página entera cada 30 segundos en las pestañas que elijas (cualquier página). Refresca siempre, aunque estés escribiendo o usando la página. Muestra la cuenta en el título y, en ServiceNow, avisa si se cerró la sesión.
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

  // ---------------------------------------------------------------- menú
  GM_registerMenuCommand('Refrescar esta pestaña cada ' + SEG + ' s', function () {
    var p = paginas(); p[miClave] = limpio(document.title) || location.hostname;
    GM_setValue('refrescar_paginas', p);
    arrancar();
  });
  GM_registerMenuCommand('Dejar de refrescar esta pestaña', function () {
    var p = paginas();
    if (p[miClave]) { delete p[miClave]; GM_setValue('refrescar_paginas', p); }
    if (corriendo) corriendo();
  });
  GM_registerMenuCommand('¿Qué pestañas refresco?', function () {
    var p = paginas(), n = Object.keys(p);
    alert('Refrescador de pestañas v' + GM_info.script.version + '\n\n' + (n.length ? 'Refresco cada ' + SEG + ' s:\n• ' + n.map(function (k) { return p[k]; }).join('\n• ') +
                     '\n\nEsta pestaña: ' + (p[miClave] ? 'SÍ' : 'NO')
                   : 'No estoy refrescando ninguna pestaña.'));
  });

  GM_registerMenuCommand('Cambiar cada cuántos segundos (ahora ' + SEG + ' s)', function () {
    var v = prompt('¿Cada cuántos segundos refresco? (entre 5 y 3600)', SEG);
    if (v === null) return;
    var n = Math.round(Number(String(v).replace(',', '.')));
    if (!(n >= 5 && n <= 3600)) { alert('Poné un número entre 5 y 3600.'); return; }
    GM_setValue('segundos', n);     // vale para todas las pestañas; las que ya están andando lo toman al toque
  });

  // ---------------------------------------------------------------- refresco
  var corriendo = null;
  function arrancar() {
    if (corriendo || !paginas()[miClave]) return;
    try { sessionStorage.setItem('mobisond_refresca', '1'); } catch (e) {}   // el Avisador no usa esta pestaña para trabajar
    var proximo = Date.now() + SEG * 1000, pausa = false, apagado = false;
    try {
      GM_addValueChangeListener('segundos', function (n, viejo, nuevo) {
        SEG = Number(nuevo) || 30; proximo = Date.now() + SEG * 1000; pintar();
      });
    } catch (e) {}

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
      document.title = limpio(document.title); corriendo = null;
    };
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
