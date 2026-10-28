// ==UserScript==
// @name         Mobisond · Aviso de casos por Alexa
// @namespace    mobisond
// @version      1.4
// @description  Cuando entra un caso nuevo en la lista que vigilás de ServiceNow, Alexa lo anuncia (Voice Monkey). Activalo solo donde tengas el Echo.
// @match        https://*.service-now.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api-v3.voicemonkey.io
// @updateURL    https://cjaime-boop.github.io/maps/scripts/alexa.user.js
// @downloadURL  https://cjaime-boop.github.io/maps/scripts/alexa.user.js
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  // ---------------------------------------------------------------- Alexa (Voice Monkey)
  // El token y el dispositivo se cargan desde el menú de Tampermonkey ("Alexa: configurar") y quedan guardados en esta PC.
  function alexa(frase, alTerminar) {
    var token = GM_getValue('vm_token', ''), disp = GM_getValue('vm_device', '');
    if (!token || !disp || !GM_getValue('vm_activo', true)) { if (alTerminar) alTerminar('Alexa no está configurada.'); return; }
    var h = new Date().getHours(), d = GM_getValue('vm_silencio_desde', -1), a = GM_getValue('vm_silencio_hasta', -1);
    if (!alTerminar && d >= 0 && a >= 0 && (d < a ? (h >= d && h < a) : (h >= d || h < a))) return;   // horario silencioso
    GM_xmlhttpRequest({method: 'POST', url: 'https://api-v3.voicemonkey.io/announce',
      headers: {'Content-Type': 'application/json'},
      data: JSON.stringify({token: token, device: disp, speech: frase.slice(0, 300)}),
      timeout: 15000,
      onload: function (r) {
        var ok = r.status === 200, err = '';
        try { var j = JSON.parse(r.responseText); ok = ok && j.success; err = j.error || ''; } catch (e) {}
        if (alTerminar) alTerminar(ok ? 'Listo: Alexa debería estar hablando.' : 'Voice Monkey respondió un error: ' + (err || r.status));
      },
      onerror: function () { if (alTerminar) alTerminar('No pude conectar con Voice Monkey.'); }});
  }
  // Alexa dice el CI afectado y la prioridad (columnas de la lista: cmdb_ci y priority, o parecidas)
  function ciDe(f) {
    var d = f.datos || {}, k = Object.keys(d);
    var col = k.filter(function (x) { return /(^|\.)cmdb_ci$/i.test(x); })[0] ||
              k.filter(function (x) { return /(^|[._])ci([._]|$)|configuration_item|cmdb_ci/i.test(x); })[0];
    return col ? d[col] : '';
  }
  function prioridadDe(f) {
    var d = f.datos || {};
    var col = Object.keys(d).filter(function (x) { return /(^|\.)priority$/i.test(x); })[0] ||
              Object.keys(d).filter(function (x) { return /prior/i.test(x); })[0];
    return col ? d[col].replace(/\s*-\s*/g, ' ').trim() : '';          // "2 - Alta" -> "2 Alta"
  }
  // "Entró un caso nuevo. <CI afectado>. Prioridad <prioridad>."
  function fraseAlexa(f) {
    var ci = ciDe(f), pr = prioridadDe(f);
    return 'Entró un caso nuevo.' + (ci ? ' ' + ci.replace(/[_|]+/g, ' ').slice(0, 120) + '.' : '') +
           (pr ? ' Prioridad ' + pr + '.' : '');
  }

  // ---------------------------------------------------------------- qué lista se vigila
  // Se elige con el menú de Tampermonkey: "Vigilar esta lista". Se reconoce por la tabla y el filtro de la URL.
  function claveLista() {
    var u = new URL(location.href);
    var tabla = (u.pathname.match(/\/([a-z0-9_]+)_list\.do/i) || [])[1];
    if (!tabla) return null;
    var q = u.searchParams.get('sysparm_query') || '';
    return tabla + '|' + q;
  }
  function vigilada() { var k = claveLista(); return k && GM_getValue('lista', '') === k; }

  function filas() {
    var t = document.querySelector('table.list_table[glide_table]') || document.querySelector('table.list_table');
    if (!t) return null;
    var tabla = t.getAttribute('glide_table') || (claveLista() || '').split('|')[0];
    var cols = [];
    t.querySelectorAll('thead th').forEach(function (th) { cols.push(th.getAttribute('name') || ''); });
    var out = [];
    t.querySelectorAll('tbody tr[sys_id], tbody tr.list_row').forEach(function (tr) {
      var id = tr.getAttribute('sys_id');
      if (!id) return;
      var celdas = tr.querySelectorAll('td');
      var datos = {};
      celdas.forEach(function (td, i) {
        var n = cols[i] || '';
        var txt = (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim();
        if (n && txt) datos[n] = txt;
      });
      var a = tr.querySelector('a.formlink, a.linked');
      var numero = (datos.number || (a && a.textContent.trim()) || id.slice(0, 8)).replace(/^WOT/i, 'WO');
      out.push({id: id, numero: numero, datos: datos,
        link: location.origin + '/' + tabla + '.do?sys_id=' + id});
    });
    return out;
  }

  // vistos: sys_id -> última vez que estuvo en la lista. Si un caso sale y vuelve a entrar
  // después de 2 minutos, avisa de nuevo (volvió a Pending Dispatch).
  var OLVIDO_MS = 2 * 60 * 1000;
  function revisar() {
    if (!vigilada()) return;
    var fs = filas();
    if (!fs) return;
    var ahora = Date.now();
    var vistos = GM_getValue('vistos2', {});
    // si la pestaña estuvo cerrada o la PC dormida un rato, se toma lo que hay como punto de partida (sin avisar)
    var base = GM_getValue('base', false) && ahora - GM_getValue('ultima', 0) < OLVIDO_MS;
    Object.keys(vistos).forEach(function (id) { if (ahora - vistos[id] > OLVIDO_MS) delete vistos[id]; });
    var nuevos = fs.filter(function (f) { return !vistos[f.id]; });
    if (base && nuevos.length) {
      alexa(nuevos.length === 1 ? fraseAlexa(nuevos[0]) : 'Entraron ' + nuevos.length + ' casos nuevos.');
    }
    fs.forEach(function (f) { vistos[f.id] = ahora; });
    GM_setValue('vistos2', vistos);
    GM_setValue('base', true);
    GM_setValue('ultima', ahora);
  }

  // ---------------------------------------------------------------- ícono en el título de la pestaña
  // Marcas compartidas con el Avisador, siempre en este orden después del segundero del Refrescador:
  // 🔔 (casos nuevos al grupo) · 🔊/🔇 (Alexa) · 🤖 Bot · (atiende el bot). Cada script toca solo la suya.
  var MARCAS = ['🔔 ', '🔊 ', '🔇 ', '🤖 Bot · '];
  function ponerMarca(quitar, poner) {
    if (window.top !== window.self) return;
    var t = document.title || '';
    var m = t.match(/^(\(\d+ s\)|\(⏸\)|\(sin conexión\)|⚠ SESIÓN CERRADA ·)\s*/), pre = m ? m[0] : '', resto = t.slice(pre.length), hay = {}, seguir = true;
    while (seguir) { seguir = false; MARCAS.forEach(function (k) { if (resto.indexOf(k) === 0) { hay[k] = 1; resto = resto.slice(k.length); seguir = true; } }); }
    quitar.forEach(function (k) { delete hay[k]; });
    if (poner) hay[poner] = 1;
    var nuevo = pre + MARCAS.filter(function (k) { return hay[k]; }).join('') + resto;
    if (nuevo !== t) document.title = nuevo;
  }
  function marcarTitulo() {
    ponerMarca(['🔊 ', '🔇 '], vigilada() ? (GM_getValue('vm_activo', true) ? '🔊 ' : '🔇 ') : null);
  }

  // ---------------------------------------------------------------- cuadro de configuración
  function horas() {
    var d = GM_getValue('vm_silencio_desde', -1), a = GM_getValue('vm_silencio_hasta', -1);
    return d >= 0 && a >= 0 ? [d, a] : ['', ''];
  }
  function abrirConfig() {
    var viejo = document.getElementById('mobisond-alexa'); if (viejo) viejo.remove();
    var host = document.createElement('div'); host.id = 'mobisond-alexa';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
    var sh = host.attachShadow({mode: 'open'});
    var k = GM_getValue('lista', ''), tit = GM_getValue('lista_titulo', ''), activo = GM_getValue('vm_activo', true);
    var tok = GM_getValue('vm_token', ''), h = horas();
    var est = !GM_getValue('vm_token', '') ? ['#fff7ed', '#7c2d12', '⚠️ <b>Falta configurar</b> el token y el dispositivo de Voice Monkey'] :
              !k ? ['#fff7ed', '#7c2d12', '⚠️ <b>No vigila ninguna lista</b> · abrí Pending Dispatch y elegí "🔊 Alexa: vigilar esta lista"'] :
              [activo ? '#e5f4e4' : '#f1f5f9', activo ? '#14532d' : '#475569',
               (activo ? '✅ <b>Activa</b>' : '🔇 <b>Desactivada</b>') + ' · vigila <b>' + esc(tit || k.split('|')[0]) + '</b>' +
               (vigilada() ? ' (esta pestaña · ' + (filas() || []).length + ' casos)' : ' (otra pestaña)')];
    sh.innerHTML = '<style>' +
      '*{box-sizing:border-box;font-family:"Segoe UI",Roboto,Arial,sans-serif}' +
      '.fondo{position:absolute;inset:0;background:rgba(15,23,42,.35)}' +
      '.p{position:absolute;top:70px;right:40px;width:410px;background:#fff;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.25);overflow:hidden;font-size:13.5px;color:#111827}' +
      '.h{background:#1e3a5f;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px}' +
      '.h small{margin-left:auto;font-weight:400;opacity:.8}.x{cursor:pointer;margin-left:10px;font-size:18px;opacity:.85}' +
      '.b{padding:12px 16px;display:flex;flex-direction:column;gap:10px}' +
      '.e{border-radius:8px;padding:8px 10px;line-height:1.4}' +
      '.f{display:flex;align-items:center;gap:8px}.k{width:125px;color:#6b7280;flex:none}' +
      'input[type=text],input[type=password],input[type=number]{flex:1;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:13px;min-width:0}' +
      'input[type=number]{flex:none;width:58px}' +
      '.ll{position:relative;width:40px;height:22px;flex:none}.ll input{opacity:0;width:0;height:0}' +
      '.ll span{position:absolute;inset:0;border-radius:11px;background:#cbd5e1;cursor:pointer;transition:.15s}' +
      '.ll span:before{content:"";position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}' +
      '.ll input:checked+span{background:#2563eb}.ll input:checked+span:before{transform:translateX(18px)}' +
      '.bs{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}' +
      'button{border:1px solid #d1d5db;border-radius:7px;padding:6px 10px;background:#f9fafb;font-size:13px;cursor:pointer}' +
      'button:hover{border-color:#2563eb}.g{background:#2563eb;color:#fff;border-color:#2563eb;margin-left:auto}' +
      '.msg{color:#374151;font-size:12.5px;min-height:16px}.gr{color:#6b7280;font-size:12px}' +
      '</style><div class="fondo"></div><div class="p">' +
      '<div class="h">🔊 Alexa · Mobisond<small>v' + esc(typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '') + '</small><span class="x" title="Cerrar">✕</span></div>' +
      '<div class="b"><div class="e" style="background:' + est[0] + ';color:' + est[1] + '">' + est[2] + '</div>' +
      '<div class="f"><span class="k">Anunciar casos</span><label class="ll"><input id="act" type="checkbox"' + (activo ? ' checked' : '') + '><span></span></label></div>' +
      '<div class="f"><span class="k">Token Voice Monkey</span><input id="tok" type="password" placeholder="voicemonkey.io → API" value="' + esc(tok) + '"></div>' +
      '<div class="f"><span class="k">Dispositivo</span><input id="dis" type="text" placeholder="ej. eco-oficina" value="' + esc(GM_getValue('vm_device', '')) + '"></div>' +
      '<div class="f"><span class="k">No hablar de</span><input id="d" type="number" min="0" max="23" value="' + h[0] + '"> a <input id="a" type="number" min="0" max="23" value="' + h[1] + '"> h <span class="gr">(vacío = siempre)</span></div>' +
      '<div class="bs"><button id="pro">🔈 Probar</button><button id="sim">🧪 Simular caso nuevo</button>' + (k ? '<button id="dej">🚫 Dejar de vigilar</button>' : '') + '<button id="gua" class="g">Guardar</button></div>' +
      '<div class="msg" id="msg"></div></div></div>';
    var $ = function (id) { return sh.getElementById(id); }, msg = function (t) { $('msg').textContent = t; };
    var cerrar = function () { host.remove(); };
    sh.querySelector('.fondo').onclick = cerrar; sh.querySelector('.x').onclick = cerrar;
    var guardar = function () {
      GM_setValue('vm_token', $('tok').value.trim()); GM_setValue('vm_device', $('dis').value.trim());
      GM_setValue('vm_activo', $('act').checked);
      var d = $('d').value.trim(), a = $('a').value.trim();
      var ok = d !== '' && a !== '' && +d >= 0 && +d <= 23 && +a >= 0 && +a <= 23;
      GM_setValue('vm_silencio_desde', ok ? +d : -1); GM_setValue('vm_silencio_hasta', ok ? +a : -1);
      marcarTitulo();
    };
    $('act').onchange = function () { GM_setValue('vm_activo', $('act').checked); marcarTitulo(); msg($('act').checked ? 'Alexa va a anunciar los casos nuevos.' : 'Alexa ya no anuncia los casos.'); };
    $('gua').onclick = function () { guardar(); msg('Guardado. Probando…'); alexa('Hola, soy el aviso de casos de Mobisond.', function (m) { msg(m); }); };
    $('pro').onclick = function () { guardar(); msg('Probando…'); alexa('Prueba de Mobisond. Si me escuchás, los avisos por Alexa funcionan.', function (m) { msg(m); }); };
    $('sim').onclick = function () {
      guardar(); var f = (filas() || [])[0];
      if (!f) return msg('No veo casos en esta pestaña para simular: abrí la lista de Pending Dispatch.');
      msg('Simulando con ' + f.numero + '…'); alexa(fraseAlexa(f), function (m) { msg(m); });
    };
    if ($('dej')) $('dej').onclick = function () { GM_setValue('lista', ''); marcarTitulo(); msg('Ya no vigilo ninguna lista.'); $('dej').remove(); };
    document.body.appendChild(host);
  }
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ---------------------------------------------------------------- menú de Tampermonkey
  GM_registerMenuCommand('🔊 Alexa: vigilar esta lista', function () {
    var k = claveLista();
    if (!k) { alert('Abrí la lista de ServiceNow (la de Pending Dispatch) y volvé a elegir esta opción.'); return; }
    GM_setValue('lista', k);
    GM_setValue('lista_titulo', (document.title || '').replace(/^(\(\d+ s\)|\(⏸\)|\(sin conexión\))\s*/, '').replace(/^(🔔 |🔊 |🔇 |🤖 Bot · )+/, '').replace(/\s*\|\s*ServiceNow\s*$/i, '').trim());
    GM_setValue('vistos2', {});
    GM_setValue('base', false);
    revisar();                         // los casos que ya están no avisan; solo los que entren desde ahora
    marcarTitulo();
    var n = (filas() || []).length;
    alert('🔊 Listo: vigilo esta lista (' + n + ' casos ahora). Alexa va a anunciar los que entren desde ahora.' +
          (GM_getValue('vm_token', '') ? '' : '\n\nFalta configurar Voice Monkey: menú → ⚙️ Alexa: configuración.'));
  });
  GM_registerMenuCommand('⚙️ Alexa: configuración', abrirConfig);
  // "Probar todo" del avisador: Alexa también habla (si está configurada en esta PC)
  document.addEventListener('mobisond-probar-todo', function () {
    if (!GM_getValue('vm_token', '')) return;
    var f = (filas() || [])[0];
    alexa(f ? fraseAlexa(f) : 'Prueba de Mobisond. Si me escuchás, Alexa anda.', function (msg) { if (!/Listo/.test(msg)) alert(msg); });
  });

  // ---------------------------------------------------------------- cuándo revisar
  if (!claveLista()) return;
  revisar(); marcarTitulo();
  setInterval(marcarTitulo, 3000);
  var espera = null;
  new MutationObserver(function () {
    clearTimeout(espera);
    espera = setTimeout(revisar, 1500);
  }).observe(document.body, {childList: true, subtree: true});
  setInterval(revisar, 5000);
})();
