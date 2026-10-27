// ==UserScript==
// @name         Mobisond · Móviles Ituran → QGIS
// @namespace    mobisond
// @version      2.3
// @description  Pasa las posiciones de los móviles de Ituran al plugin "Móviles Ituran" de QGIS de esta misma PC (127.0.0.1). No sale nada de la computadora.
// @match        https://web2.ituran.com.ar/*
// @match        http://web2.ituran.com.ar/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      127.0.0.1
// @updateURL    https://cjaime-boop.github.io/maps/scripts/ituran.user.js
// @downloadURL  https://cjaime-boop.github.io/maps/scripts/ituran.user.js
// @run-at       document-start
// ==/UserScript==
(function () {
  'use strict';
  var W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  var PUERTOS = [8787, 8788, 8789, 8790];
  var PATENTE = /\b([A-Z]{2}\s?\d{3}\s?[A-Z]{2}|[A-Z]{3}\s?\d{3})\b/;
  var PATENTE_SOLA = /^([A-Z]{2}\s?\d{3}\s?[A-Z]{2}|[A-Z]{3}\s?\d{3})$/;
  var moviles = {};          // patente -> último dato
  var nodos = {};            // número interno de Ituran -> {patente, grupo, modelo}
  var gruposVistos = {};     // patente -> grupo, guardado: si un dato llega sin grupo se usa el último conocido
  try { gruposVistos = JSON.parse(GM_getValue('grupos', '{}')) || {}; } catch (e) {}
  function recordarGrupo(pat, g) {
    if (!pat || !g || gruposVistos[pat] === g) return;
    gruposVistos[pat] = g; GM_setValue('grupos', JSON.stringify(gruposVistos));
  }
  function mejorGrupo(a, b) {                // un móvil puede estar en varias carpetas: gana la de GPON / Lineales
    var bueno = function (g) { return /gpon|lineal/i.test(g || ''); };
    if (!a) return b || ''; if (!b) return a;
    return bueno(b) && !bueno(a) ? b : a;
  }
  var ultimoPedido = null;   // el último pedido que trajo posiciones (se repite si la página se frena)
  var ultimaPos = 0, enviando = false, pendiente = false, ultimoRepite = 0;
  function cada() { var c = Number(GM_getValue('cada', 30)) || 30; return Math.max(15, Math.min(c, 600)); }   // segundos (lo elige QGIS)

  // ---------------------------------------------------------------- 1) la pestaña nunca "se duerme"
  // Chrome frena las pestañas en segundo plano y muchas páginas dejan de pedir posiciones si no se ven.
  // Se le dice a la página que siempre está visible.
  try {
    Object.defineProperty(W.document, 'visibilityState', {get: function () { return 'visible'; }, configurable: true});
    Object.defineProperty(W.document, 'hidden', {get: function () { return false; }, configurable: true});
    W.document.addEventListener('visibilitychange', function (e) { e.stopImmediatePropagation(); }, true);
  } catch (e) {}

  // ---------------------------------------------------------------- 2) conexión con QGIS (127.0.0.1)
  function codigo() { return String(GM_getValue('codigo', '') || ''); }
  function puerto() { return Number(GM_getValue('puerto', 0)) || 0; }
  function mandar(ruta, datos, ok, mal) {
    var p = puerto();
    if (!p || !codigo()) { if (mal) mal('sin vincular'); return; }
    GM_xmlhttpRequest({method: 'POST', url: 'http://127.0.0.1:' + p + ruta, data: JSON.stringify(datos), timeout: 5000,
      headers: {'Content-Type': 'application/json', 'X-Codigo': codigo()},
      onload: function (r) {
        if (r.status === 200) {
          try { var cfg = JSON.parse(r.responseText || '{}'); if (cfg && cfg.cada) GM_setValue('cada', Number(cfg.cada)); } catch (e) {}   // QGIS manda la frecuencia
          if (ok) ok();
        } else if (mal) mal(r.status === 403 ? 'código' : 'error ' + r.status);
      },
      onerror: function () { if (mal) mal('QGIS apagado'); }, ontimeout: function () { if (mal) mal('QGIS no responde'); }});
  }
  // busca en qué puerto está escuchando QGIS (si el botón de Móviles Ituran está apretado)
  function buscarPuerto(listo) {
    var i = 0;
    (function probar() {
      if (i >= PUERTOS.length) { listo(0); return; }
      var p = PUERTOS[i++];
      GM_xmlhttpRequest({method: 'GET', url: 'http://127.0.0.1:' + p + '/hola', timeout: 2000,
        onload: function (r) { if (/moviles_ituran/.test(r.responseText || '')) { GM_setValue('puerto', p); listo(p); } else probar(); },
        onerror: probar, ontimeout: probar});
    })();
  }
  GM_registerMenuCommand('🔗 Conectar con QGIS', function () {
    var c = prompt('Móviles Ituran\n\nEn QGIS apretá el botón de Móviles Ituran: el panel muestra un código de 6 números.\nEscribilo acá:', codigo());
    if (c === null) return;
    c = c.replace(/\D/g, '');
    if (c.length !== 6) { alert('El código tiene 6 números.'); return; }
    GM_setValue('codigo', c);
    buscarPuerto(function (p) {
      if (!p) { alert('Código guardado, pero QGIS no está escuchando.\nApretá el botón de Móviles Ituran en QGIS y recargá esta página.'); return; }
      mandar('/estado', estado(), function () { alert('✅ Conectado con QGIS. Los móviles van a aparecer en unos segundos.'); enviarPosiciones(); },
             function (e) { alert(e === 'código' ? 'El código no coincide con el que muestra QGIS.' : 'No pude hablar con QGIS (' + e + ').'); });
    });
  });

  // ---------------------------------------------------------------- 3) leer posiciones de lo que trae la página
  function num(v) { var n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return typeof n === 'number' && isFinite(n) ? n : null; }
  function enArgentina(lat, lon) { return lat > -56 && lat < -21 && lon > -74 && lon < -53; }
  function coord(o, re, min, max) {
    var mejor = null;
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k) || !re.test(k) || /plat|id$/i.test(k)) continue;
      var n = num(o[k]);
      if (n !== null && n > min && n < max) { if (/^(lat|latitude|latitud|lng|lon|long|longitude|longitud)$/i.test(k)) return n; if (mejor === null) mejor = n; }
    }
    return mejor;
  }
  function campo(o, re, tipo, evitar) {
    for (var k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k) || !re.test(k) || (evitar && evitar.test(k))) continue;
      var v = o[k];
      if (tipo === 'txt' && (typeof v === 'string' || typeof v === 'number') && String(v).trim()) return String(v).trim();
      if (tipo === 'num' && num(v) !== null) return num(v);
    }
    return null;
  }
  // la lista de vehículos (árbol de carpetas de Ituran): número interno -> patente, grupo y modelo
  function leerArbol(d) {
    if (!d || !d.NodesData) return false;
    var grupoDe = {}, carpetas = d.FoldersData || {}, porCarpeta = d.FolderToNodesDic || {};
    Object.keys(porCarpeta).forEach(function (c) {
      var nom = (carpetas[c] && carpetas[c].Name) || '';
      if (nom) (porCarpeta[c] || []).forEach(function (n) { grupoDe[String(n)] = mejorGrupo(grupoDe[String(n)], nom); });
    });
    Object.keys(d.NodesData).forEach(function (id) {
      var n = d.NodesData[id] || {}, pat = String(n.Plate || n.Label || '').replace(/\s/g, '').toUpperCase();
      if (!pat) return;
      var ant = nodos[String(id)] || {};
      var g = grupoDe[String(id)] || ant.grupo || gruposVistos[pat] || '';
      recordarGrupo(pat, g);
      nodos[String(id)] = {patente: pat, grupo: g, modelo: n.Model || ant.modelo || '', etiqueta: n.Label || '', nombre: comentarios(n) || ant.nombre || ''};
    });
    return true;
  }
  // los comentarios de Ituran (Comment1, Comment2...) = quién maneja el móvil: "Diego D'olivo / Hugo Romero"
  function comentarios(o) {
    var ks = Object.keys(o || {}).filter(function (k) { return /^(comment|coment|remark)/i.test(k); }).sort(), vs = [];
    ks.forEach(function (k) { var v = o[k]; if ((typeof v === 'string' || typeof v === 'number') && String(v).trim() && vs.indexOf(String(v).trim()) < 0) vs.push(String(v).trim()); });
    return vs.join(' / ');
  }
  function nodoDe(x, claveP) {
    if (claveP !== undefined && nodos[String(claveP)]) return nodos[String(claveP)];
    for (var k in x) { var v = x[k]; if ((typeof v === 'number' || typeof v === 'string') && nodos[String(v).trim()]) return nodos[String(v).trim()]; }
    return null;
  }
  function recorrer(x, salida, prof, claveP) {
    if (!x || prof > 12) return;
    if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) recorrer(x[i], salida, prof + 1); return; }
    if (typeof x === 'string') {
      var t = x.trim();
      if ((t[0] === '{' || t[0] === '[') && t.length > 20) { try { recorrer(JSON.parse(t), salida, prof + 1); } catch (e) {} }
      return;
    }
    if (typeof x !== 'object') return;
    var lat = coord(x, /^(y|lt)$|lat/i, -56, -21), lon = coord(x, /^(x|ln)$|lng|lon/i, -74, -53);
    if (lat === null || lon === null || !enArgentina(lat, lon)) {
      for (var kc in x) {                                  // coordenadas en un sub-objeto (position: {lat, lng})
        var c = x[kc];
        if (c && typeof c === 'object' && !Array.isArray(c)) {
          var la = coord(c, /^(y|lt)$|lat/i, -56, -21), lo = coord(c, /^(x|ln)$|lng|lon/i, -74, -53);
          if (la !== null && lo !== null && enArgentina(la, lo)) { lat = la; lon = lo; break; }
        }
      }
    }
    if (lat !== null && lon !== null && enArgentina(lat, lon)) {
      var nd = nodoDe(x, claveP);
      var pat = nd ? nd.patente : campo(x, /plate|patente|licen|matric/i, 'txt');
      if (pat && !PATENTE_SOLA.test(String(pat).trim().toUpperCase())) pat = null;
      // sin campo de patente: solo un texto que sea ENTERO una patente en mayúsculas (no "Ing 748" de una dirección)
      if (!pat) { for (var k in x) { var v = x[k]; if (typeof v === 'string' && !/addr|direcc|address|location|ubic|street|calle|desc|name|nombre/i.test(k) && PATENTE_SOLA.test(v.trim())) { pat = v.trim(); break; } } }
      if (pat) {
        pat = String(pat).replace(/\s/g, '').toUpperCase();
        if (!nd) { for (var idn in nodos) { if (nodos[idn].patente === pat) { nd = nodos[idn]; break; } } }
        if (!nd && Object.keys(nodos).length) pat = null;     // ya conocemos la flota: lo que no está en la lista no es nuestro
      }
      if (pat) {
        salida.push({patente: pat, modelo: nd ? nd.modelo : '', lat: lat, lon: lon, nombre: comentarios(x) || (nd && nd.nombre) || '',
          // la hora del GPS (no la de apagado, alta, etc.)
          hora: campo(x, /gps.?time|gpsdate|fecha.?gps|positiontime|lastpos|datetime|^time$|^date$|^fecha$|^hora$/i, 'txt') ||
                campo(x, /time|date|fecha|hora/i, 'txt', /ignit|encend|apag|alta|creat|install|expir|birth|start|stop|off|on$/i) || '',
          velocidad: campo(x, /speed|veloc|kmh/i, 'num'),
          direccion: campo(x, /addr|direcc|address|location|ubic|street|calle/i, 'txt') || '',
          grupo: (nd && nd.grupo) || gruposVistos[pat] || campo(x, /group|grupo|fleet|flota/i, 'txt') || ''});
      }
    }
    for (var k2 in x) { if (Object.prototype.hasOwnProperty.call(x, k2) && (x[k2] && typeof x[k2] === 'object' || typeof x[k2] === 'string')) recorrer(x[k2], salida, prof + 1, k2); }
  }
  function analizar(texto, pedido) {
    if (!texto || typeof texto !== 'string' || texto.length < 30) return;
    var t = texto.trim(), j = null, salida = [];
    if (t[0] === '{' || t[0] === '[') { try { j = JSON.parse(t); } catch (e) {} }
    if (j && leerArbol(j.d || j)) return;
    if (j) recorrer(j, salida, 0);
    if (!salida.length) return;
    salida.forEach(function (v) { moviles[v.patente] = v; });
    ultimaPos = Date.now();
    if (pedido && pedido.url) ultimoPedido = pedido;        // este pedido trae posiciones: es el que se repite
    programar();
  }
  function programar() {
    if (pendiente) return;
    pendiente = true;
    setTimeout(function () { pendiente = false; enviarPosiciones(); }, 2000);
  }
  function estado() {
    return {pagina: location.href.slice(0, 200), moviles: Object.keys(moviles).length, cada: cada(), arbol: Object.keys(nodos).length,
            ultima_posicion: ultimaPos ? Math.round((Date.now() - ultimaPos) / 1000) : null, repite: !!ultimoPedido};
  }
  function enviarPosiciones() {
    var lista = Object.keys(moviles).map(function (k) {
      var v = moviles[k];
      for (var id in nodos) {
        if (nodos[id].patente !== v.patente) continue;
        if (!v.nombre && nodos[id].nombre) v.nombre = nodos[id].nombre;
        if (nodos[id].grupo) v.grupo = nodos[id].grupo;          // el grupo de la lista de Ituran manda
        break;
      }
      if (!v.grupo && gruposVistos[v.patente]) v.grupo = gruposVistos[v.patente];
      if (v.grupo) recordarGrupo(v.patente, v.grupo);
      return v;
    });
    if (!lista.length || enviando) return;
    enviando = true;
    mandar('/posiciones', {moviles: lista, estado: estado()}, function () { enviando = false; }, function (e) {
      enviando = false;
      if (e === 'QGIS apagado') buscarPuerto(function () {});     // QGIS se reinició o cambió de puerto
    });
  }

  // ---------------------------------------------------------------- 4) escuchar lo que pide la página
  var XO = W.XMLHttpRequest.prototype.open, XS = W.XMLHttpRequest.prototype.send, XH = W.XMLHttpRequest.prototype.setRequestHeader;
  W.XMLHttpRequest.prototype.open = function (m, u) { this.__mb = {metodo: m, url: String(u), cab: {}}; return XO.apply(this, arguments); };
  W.XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__mb) this.__mb.cab[k] = v; return XH.apply(this, arguments); };
  W.XMLHttpRequest.prototype.send = function (cuerpo) {
    var x = this, info = x.__mb;
    if (info) info.cuerpo = typeof cuerpo === 'string' ? cuerpo : null;
    x.addEventListener('load', function () {
      try {
        var txt = (!x.responseType || x.responseType === 'text') ? x.responseText : x.responseType === 'json' ? JSON.stringify(x.response) : null;
        analizar(txt, info && (info.cuerpo !== null || /get/i.test(info.metodo)) ? info : null);
      } catch (e) {}
    });
    return XS.apply(this, arguments);
  };
  if (W.fetch) {
    var F = W.fetch;
    W.fetch = function (rec, opc) {
      var info = {metodo: (opc && opc.method) || (rec && rec.method) || 'GET', url: String((rec && rec.url) || rec), cab: (opc && opc.headers) || {},
                  cuerpo: opc && typeof opc.body === 'string' ? opc.body : null};
      return F.apply(this, arguments).then(function (r) {
        try { r.clone().text().then(function (t) { analizar(t, info); }); } catch (e) {}
        return r;
      });
    };
  }
  if (W.WebSocket) {                                     // actualizaciones en vivo (SignalR)
    var WS = W.WebSocket;
    W.WebSocket = function (u, p) {
      var s = p ? new WS(u, p) : new WS(u);
      s.addEventListener('message', function (ev) { if (typeof ev.data === 'string') analizar(ev.data.replace(/\u001e/g, ''), null); });
      return s;
    };
    W.WebSocket.prototype = WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { W.WebSocket[k] = WS[k]; });
  }

  // ---------------------------------------------------------------- 5) cada X segundos (lo que elijas en QGIS) se le piden las posiciones a Ituran
  setInterval(function () {
    var c = cada() * 1000;
    if (!ultimoPedido || Date.now() - ultimaPos < c || Date.now() - ultimoRepite < c) return;   // si Ituran ya trajo hace poco, no hace falta
    ultimoRepite = Date.now();
    try {
      var x = new W.XMLHttpRequest();
      x.open(ultimoPedido.metodo || 'GET', ultimoPedido.url, true);
      var cab = ultimoPedido.cab || {};
      Object.keys(cab).forEach(function (k) { try { x.setRequestHeader(k, cab[k]); } catch (e) {} });
      x.send(ultimoPedido.cuerpo || null);               // la respuesta pasa por el mismo lector de arriba
    } catch (e) {}
  }, 5000);

  // ---------------------------------------------------------------- 6) latido: QGIS sabe que Ituran sigue abierto
  setInterval(function () {
    if (!codigo()) return;
    mandar('/estado', estado(), null, function (e) { if (e === 'QGIS apagado') buscarPuerto(function () {}); });
  }, 15000);
  setTimeout(function () { if (codigo()) buscarPuerto(function () {}); }, 1500);
})();
