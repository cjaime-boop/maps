// ==UserScript==
// @name         Mobisond · Vigía de CTO (SGT)
// @namespace    mobisond
// @version      1.3
// @description  Con SGT abierto y la sesión iniciada, revisa cada 30 segundos las CTO que se vigilan desde QGIS (plugin 📡 Vigía de CTO) y sube cómo están. El login lo hacés vos; la sesión de SGT no sale del navegador.
// @match        https://sgtmobile.claro.com.ar/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      gnqvhlpknxtdnzuxfybc.supabase.co
// @updateURL    https://cjaime-boop.github.io/maps/scripts/sgt_vigia.user.js
// @downloadURL  https://cjaime-boop.github.io/maps/scripts/sgt_vigia.user.js
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  if (window.top !== window.self) return;

  var SB_URL = 'https://gnqvhlpknxtdnzuxfybc.supabase.co', SB_PUBLICA = 'sb_publishable_dUhjyCfRfNtLVLfOYnJ1WA_hfPD3kk9';
  var API = '/SgtMobileBackend/filter/getVecindarioSplitter/';
  var CADA_MS = 30 * 1000;              // una vuelta cada 30 segundos (si una vuelta tarda más, la siguiente arranca enseguida)
  var ENTRE_MS = 200;                   // pausa entre CTO, para no cargar a SGT
  var YO = pcId();                                                   // esta PC (en Supabase: una sola PC revisa a la vez)
  var PESTANA = Math.random().toString(36).slice(2, 8);              // esta pestaña (en la PC: una sola pestaña revisa)

  function pcId() {
    var id = GM_getValue('pc_id', '');
    if (!id) { id = 'pc-' + Math.random().toString(36).slice(2, 10); GM_setValue('pc_id', id); }
    return id;
  }
  function clave() { return GM_getValue('vigia_clave', ''); }
  function pedirClave() {
    var c = prompt('Vigía de CTO: pegá la clave (te la pasa quien administra el Vigía).', clave());
    if (c !== null) { GM_setValue('vigia_clave', c.trim()); ciclo(true); }
  }
  GM_registerMenuCommand('Cargar clave del Vigía', pedirClave);
  GM_registerMenuCommand('Revisar ahora', function () { ciclo(true); });

  function rpc(fn, args) {
    args.p_clave = clave();
    return new Promise(function (ok, mal) {
      GM_xmlhttpRequest({method: 'POST', url: SB_URL + '/rest/v1/rpc/' + fn, timeout: 15000,
        headers: {'apikey': SB_PUBLICA, 'Content-Type': 'application/json'}, data: JSON.stringify(args),
        onload: function (r) {
          if (r.status < 300) { try { ok(JSON.parse(r.responseText || 'null')); } catch (e) { ok(null); } }
          else mal(new Error(/clave incorrecta/.test(r.responseText) ? 'clave' : 'Supabase ' + r.status));
        },
        onerror: function () { mal(new Error('sin conexión')); }, ontimeout: function () { mal(new Error('Supabase tardó')); }});
    });
  }
  function dormir(ms) { return new Promise(function (s) { setTimeout(s, ms); }); }
  function hhmm(d) { d = d || new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  // ---------------------------------------------------------------- cartelito abajo a la izquierda
  var cartel = document.createElement('div');
  cartel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;font:12px Segoe UI,Arial,sans-serif;' +
    'padding:6px 11px;border-radius:14px;box-shadow:0 2px 8px #0003;cursor:pointer;color:#fff;background:#6b7280;user-select:none';
  cartel.title = 'Vigía de CTO (clic: revisar ahora)';
  cartel.onclick = function () { if (!clave()) pedirClave(); else ciclo(true); };
  document.body.appendChild(cartel);
  var COLORES = {ok: '#2e7d32', gris: '#6b7280', mal: '#c62828', aviso: '#b26a00'};
  function mostrar(txt, color, detalle) {
    cartel.textContent = '📡 ' + txt;
    cartel.style.background = COLORES[color] || COLORES.gris;
    if (detalle) cartel.title = detalle + '\n\n(clic: revisar ahora)';
  }

  // ---------------------------------------------------------------- una CTO
  // Mismas reglas que el vuelco: puertos con flecha = Up/Down; caída = todos en Down.
  // "2026-11-10 01:03:00" (hora de acá), ISO, dd/mm/aaaa o milisegundos -> Date (o null si es "--")
  function aFecha(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
    var s = String(v).trim(), m;
    if (!s || s === '--') return null;
    if (/^\d{10,13}$/.test(s)) return new Date(s.length === 10 ? +s * 1000 : +s);
    m = s.match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?/);
    if (m && !/(Z|[+-]\d\d:?\d\d)$/i.test(s)) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    m = s.match(/^(\d\d)\/(\d\d)\/(\d{4})[ T](\d\d):(\d\d)(?::(\d\d))?/);
    if (m) return new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function estadoDe(data) {
    var con = data.filter(function (p) { return p.estadoONT === 'Up' || p.estadoONT === 'Down'; });
    var down = con.filter(function (p) { return p.estadoONT === 'Down'; }).length;
    var e = !con.length ? 'sin' : down === con.length ? 'caida' : down ? 'parcial' : 'ok';
    // potencia: la de la primera casilla; si no tiene lectura, la del primer cliente andando que tenga
    function lectura(p) { var v = parseFloat(String(p && p.rxPower).replace(',', '.')); return isNaN(v) ? null : v; }
    var pot = lectura(data[0]);
    if (pot === null) {
      var up = data.filter(function (p) { return p.estadoONT === 'Up' && lectura(p) !== null; })[0];
      pot = up ? lectura(up) : null;
    }
    // caída: desde el "Último Apagado" más reciente de los clientes en Down (cuando se cayó el último)
    var apagado = null;
    if (e === 'caida') {
      con.forEach(function (p) {
        var f = aFecha(p.lastDownTime);
        if (f && (!apagado || f > apagado)) apagado = f;
      });
    }
    return {estado: e, caidos: down, total: con.length, potencia: pot === null ? null : String(pot),
            apagado: apagado ? apagado.toISOString() : null};
  }
  function consultar(id, token) {
    return fetch(API + encodeURIComponent(id), {headers: {'Authorization': token}}).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('sesion');
      if (!r.ok) return {estado: 'error', caidos: null, total: null};
      return r.json().then(function (j) {
        var d = (j && j.data) || [];
        return d.length ? estadoDe(d) : {estado: 'error', caidos: null, total: null};   // no está en SGT
      });
    });
  }

  // ---------------------------------------------------------------- la vuelta
  var corriendo = false, timer = null, avisoSesion = false;
  var inicio = 0;
  function proxima(ms) { clearTimeout(timer); timer = setTimeout(ciclo, ms); }

  function ciclo(forzar) {
    if (corriendo) return;
    if (!clave()) { mostrar('Vigía: falta la clave (clic)', 'aviso'); return; }
    var token = localStorage.getItem('token');
    if (!token || /\/login/i.test(location.pathname)) {
      mostrar('Vigía: iniciá sesión en SGT', 'mal');
      if (!avisoSesion) { avisoSesion = true; rpc('vigia_sesion', {p_pc: YO, p_sesion: 'vencida'}).catch(function () {}); }
      return proxima(60000);
    }
    var otra = GM_getValue('vigia_pestana', null);
    if (otra && otra.id !== PESTANA && Date.now() - otra.t < 45000) {
      mostrar('Vigía: lo está revisando otra pestaña de SGT', 'gris');
      return proxima(CADA_MS);
    }
    GM_setValue('vigia_pestana', {id: PESTANA, t: Date.now()});
    corriendo = true; inicio = Date.now();
    rpc('vigia_lista', {p_pc: YO}).then(function (r) {
      if (!r.turno) {
        mostrar('Vigía: lo está revisando otra PC', 'gris', 'SGT está abierto en otra PC y ya está revisando las CTO. Si la cerraron, esta toma el control en un minuto y medio.');
        return;
      }
      var ctos = r.ctos || [];
      if (!ctos.length) { mostrar('Vigía: no hay CTO vigiladas', 'gris'); return rpc('vigia_guardar', {p_pc: YO, p_res: []}); }
      var res = [], caidas = 0, i = 0;
      function siguiente() {
        if (i >= ctos.length) return Promise.resolve();
        var c = ctos[i++];
        mostrar('Vigía: revisando ' + i + '/' + ctos.length, 'gris');
        GM_setValue('vigia_pestana', {id: PESTANA, t: Date.now()});
        return consultar(c.sgt, token).then(function (e) {
          e.cto = c.cto; res.push(e);
          if (e.estado === 'caida') caidas++;
          if (res.length % 5 === 0) rpc('vigia_guardar', {p_pc: YO, p_res: res.slice(-5)}).catch(function () {});
        }, function (err) {
          if (err.message === 'sesion') throw err;
          res.push({cto: c.cto, estado: 'error', caidos: null, total: null});
        }).then(function () { return dormir(ENTRE_MS); }).then(siguiente);
      }
      return siguiente().then(function () {
        return rpc('vigia_guardar', {p_pc: YO, p_res: res.slice(Math.floor(res.length / 5) * 5)});
      }).then(function () {
        avisoSesion = false;
        var det = res.map(function (e) {
          return ({caida: '🔴', parcial: '🟡', ok: '🟢', sin: '⚪', error: '⚠️'}[e.estado] || '·') + ' ' + e.cto +
            (e.total ? '  ' + (e.total - e.caidos) + '/' + e.total + ' operativos' + (e.potencia ? ' · ' + e.potencia + ' dBm' : '') : e.estado === 'error' ? '  (no la encontré en SGT)' : '');
        }).join('\n');
        mostrar('Vigía: ' + ctos.length + ' CTO · ' + caidas + ' caída' + (caidas === 1 ? '' : 's') + ' · ' + hhmm(), caidas ? 'mal' : 'ok', det);
      });
    }).catch(function (err) {
      if (err.message === 'sesion') {
        mostrar('Vigía: se cortó la sesión de SGT, entrá de nuevo', 'mal');
        avisoSesion = true;
        return rpc('vigia_sesion', {p_pc: YO, p_sesion: 'vencida'}).catch(function () {});
      }
      if (err.message === 'clave') return mostrar('Vigía: la clave no es correcta (clic)', 'aviso');
      mostrar('Vigía: ' + err.message + ' · reintento en 1 min', 'aviso');
      return 'reintentar';
    }).then(function (x) {
      corriendo = false;
      GM_setValue('vigia_pestana', {id: PESTANA, t: Date.now()});
      proxima(x === 'reintentar' ? 60000 : Math.max(2000, CADA_MS - (Date.now() - inicio)));
    });
  }

  window.addEventListener('beforeunload', function () {
    var o = GM_getValue('vigia_pestana', null);
    if (o && o.id === PESTANA) GM_setValue('vigia_pestana', null);
  });
  mostrar('Vigía: arrancando…', 'gris');
  setTimeout(ciclo, 8000);
})();
