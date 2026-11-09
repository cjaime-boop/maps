// ==UserScript==
// @name         Mobisond · Aviso de casos por Alexa
// @namespace    mobisond
// @version      1.5
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
  // ---------------------------------------------------------------- qué dice Alexa
  // La frase se arma con una plantilla que se edita en la configuración. Las <variables> se reemplazan con los datos del
  // caso (de las columnas de la lista). También vale el nombre de cualquier columna de la lista, ej. <Subestado>.
  // Hay una frase para Lineales y otra para GPON.
  var FRASES = {
    lineales: {clave: 'vm_frase_lineales', def: 'Entró un caso nuevo de Lineales. <ci>. <falla>. Prioridad <prioridad>.'},
    gpon: {clave: 'vm_frase_gpon', def: 'Entró un caso nuevo de GPON. <ci>. Prioridad <prioridad>.'}};
  var VARIABLES = [
    ['ci', 'CI afectado'], ['falla', 'ID de falla, ej. Atenuación FO'], ['prioridad', 'ej. 2 Urgente'], ['cliente', 'Claro, Edenor…'],
    ['numero', 'WO del caso'], ['proyecto', 'Lineales o GPON']];
  var CLIENTES = {CL: 'Claro', CLR: 'Claro', EDNR: 'Edenor', EDN: 'Edenor', MUNI: 'Municipalidad', TP: 'Telecom', MVS: 'Movistar', MV: 'Movistar'};
  function sinTildes(t) { return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ''); }
  function columna(f, re) {                          // valor de la primera columna cuyo nombre técnico coincide
    var d = f.datos || {}, k = Object.keys(d).filter(function (x) { return re.test(x); })[0];
    return k ? d[k] : '';
  }
  function variable(f, nombre) {
    var n = sinTildes(nombre), d = f.datos || {}, todo = Object.keys(d).map(function (k) { return d[k]; }).join(' ');
    if (n === 'ci') return columna(f, /(^|\.)cmdb_ci$/i) || columna(f, /(^|[._])ci([._]|$)|configuration_item/i);
    if (n === 'prioridad') return (columna(f, /(^|\.)priority$/i) || columna(f, /prior/i)).replace(/\s*-\s*/g, ' ').trim();   // "2 - Alta" -> "2 Alta"
    if (n === 'proyecto') return proyectoDe(f) === 'gpon' ? 'GPON' : proyectoDe(f) === 'lineales' ? 'Lineales' : '';
    if (n === 'falla' || n === 'iddefalla') {
      var tf = Object.keys(f.titulos || {}).filter(function (x) { return /falla/.test(x); })[0];
      return tf ? d[f.titulos[tf]] || '' : columna(f, /falla|fault/i);
    }
    if (n === 'cliente') {
      var m = /TSO_C_TL_([A-Z0-9]+)_/i.exec(columna(f, /service_offering/i) || todo);
      return m ? (CLIENTES[m[1].toUpperCase()] || m[1]) : '';
    }
    if (n === 'numero' || n === 'wo') return f.numero || '';
    // cualquier otra: por el título de la columna o su nombre técnico
    var col = (f.titulos || {})[n] || Object.keys(d).filter(function (k) { return sinTildes(k) === n || sinTildes(k.split('.').pop()) === n; })[0];
    return col ? d[col] || '' : null;              // null = no existe esa variable (queda escrita tal cual)
  }
  // de qué proyecto es el caso: por el grupo (columna o filtro de la lista), el service offering o el CI
  function proyectoDe(f) {
    var d = f.datos || {}, todo = Object.keys(d).map(function (k) { return d[k]; }).join(' ').toUpperCase();
    var grupo = function (t) { return /C-TL-MOBISOND/.test(t) ? 'lineales' : /C-GZ1-MOBI/.test(t) ? 'gpon' : ''; };
    return grupo(todo) ||                                                   // el grupo, si está como columna
           (/TSO_C_TL_/.test(todo) ? 'lineales' : '') ||                     // el service offering de Lineales
           (/(^|\s)GPON-|(^|\s)G[A-Z]{3}-[RC]\d/.test(columna(f, /cmdb_ci/i).toUpperCase()) ? 'gpon' : '') ||
           grupo((claveLista() || '').toUpperCase()) || 'lineales';        // el filtro de la lista
  }
  function plantillaDe(pr) { return GM_getValue(FRASES[pr].clave, '') || FRASES[pr].def; }
  function fraseAlexa(f, plantilla) {
    var t = (plantilla || plantillaDe(proyectoDe(f))).replace(/<([^<>]{1,40})>/g, function (todo, nombre) {
      var v = variable(f, nombre.trim());
      return v === null ? todo : String(v).replace(/[_|]+/g, ' ').slice(0, 120);
    });
    // prolijo si alguna variable vino vacía: sin espacios dobles ni ". ." ni "de ."
    return t.replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1')
            .replace(/\b(de|del|en|la|el|Prioridad)([.,;:])/gi, '$2').replace(/\s+([.,;:])/g, '$1')
            .replace(/([.,;:])(\s*[.,;:])+/g, '$1').replace(/^[\s.,;:]+/, '').replace(/[\s,;:]+$/, '').trim();
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
    var titulos = {};
    t.querySelectorAll('thead th').forEach(function (th) {
      var n = th.getAttribute('name') || ''; cols.push(n);
      var tt = (th.innerText || th.textContent || '').replace(/\s+/g, ' ').trim();
      if (n && tt) titulos[sinTildes(tt)] = n;
    });
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
      out.push({id: id, numero: numero, datos: datos, titulos: titulos,
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
  function abrirConfig() {
    var viejo = document.getElementById('mobisond-alexa'); if (viejo) viejo.remove();
    var host = document.createElement('div'); host.id = 'mobisond-alexa';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
    var sh = host.attachShadow({mode: 'open'});
    var k = GM_getValue('lista', ''), tit = GM_getValue('lista_titulo', ''), activo = GM_getValue('vm_activo', true);
    var tok = GM_getValue('vm_token', '');
    var est = !GM_getValue('vm_token', '') ? ['#fff7ed', '#7c2d12', '⚠️ <b>Falta configurar</b> el token y el dispositivo de Voice Monkey'] :
              !k ? ['#fff7ed', '#7c2d12', '⚠️ <b>No vigila ninguna lista</b> · abrí Pending Dispatch y elegí "🔊 Alexa: vigilar esta lista"'] :
              [activo ? '#e5f4e4' : '#f1f5f9', activo ? '#14532d' : '#475569',
               (activo ? '✅ <b>Activa</b>' : '🔇 <b>Desactivada</b>') + ' · vigila <b>' + esc(tit || k.split('|')[0]) + '</b>' +
               (vigilada() ? ' (esta pestaña · ' + (filas() || []).length + ' casos)' : ' (otra pestaña)')];
    sh.innerHTML = '<style>' +
      '*{box-sizing:border-box;font-family:"Segoe UI",Roboto,Arial,sans-serif}' +
      '.fondo{position:absolute;inset:0;background:rgba(15,23,42,.35)}' +
      '.p{position:absolute;top:70px;right:40px;width:410px;max-height:calc(100vh - 90px);overflow:auto;background:#fff;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.25);overflow:hidden;font-size:13.5px;color:#111827}' +
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
      'textarea{width:100%;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;font-size:13px;resize:vertical;min-height:52px}' +
      '.vs{display:flex;flex-wrap:wrap;gap:5px}.v{border:1px solid #bfdbfe;background:#eff6ff;color:#1e40af;border-radius:12px;padding:2px 8px;font-size:12px;cursor:pointer}' +
      '.v:hover{background:#dbeafe}.oye{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;padding:6px 8px;font-size:12.5px;color:#334155}' +
      '.lnk{color:#2563eb;cursor:pointer;font-size:12px;margin-left:auto}' +
      '</style><div class="fondo"></div><div class="p">' +
      '<div class="h">🔊 Alexa · Mobisond<small>v' + esc(typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '') + '</small><span class="x" title="Cerrar">✕</span></div>' +
      '<div class="b"><div class="e" style="background:' + est[0] + ';color:' + est[1] + '">' + est[2] + '</div>' +
      '<div class="f"><span class="k">Anunciar casos</span><label class="ll"><input id="act" type="checkbox"' + (activo ? ' checked' : '') + '><span></span></label></div>' +
      '<div class="f"><span class="k">Token Voice Monkey</span><input id="tok" type="password" placeholder="voicemonkey.io → API" value="' + esc(tok) + '"></div>' +
      '<div class="f"><span class="k">Dispositivo</span><input id="dis" type="text" placeholder="ej. eco-oficina" value="' + esc(GM_getValue('vm_device', '')) + '"></div>' +
      '<div class="f"><span class="k">Qué dice</span><span class="gr">tocá una variable para agregarla donde está el cursor</span></div>' +
      ['lineales', 'gpon'].map(function (pr) {
        return '<div class="f"><b style="font-size:12.5px">' + (pr === 'gpon' ? '🟣 GPON' : '🔵 Lineales') + '</b>' +
               '<span class="lnk" data-res="' + pr + '">↺ original</span></div>' +
               '<textarea id="fra_' + pr + '">' + esc(plantillaDe(pr)) + '</textarea><div class="oye" id="oye_' + pr + '"></div>';
      }).join('') +
      '<div class="vs">' + VARIABLES.map(function (v) { return '<span class="v" title="' + esc(v[1]) + '">&lt;' + v[0] + '&gt;</span>'; }).join('') + '</div>' +
      '<div class="bs"><button id="pro">🔈 Probar</button><button id="sim">🧪 Simular caso nuevo</button>' + (k ? '<button id="dej">🚫 Dejar de vigilar</button>' : '') + '<button id="gua" class="g">Guardar</button></div>' +
      '<div class="msg" id="msg"></div></div></div>';
    var $ = function (id) { return sh.getElementById(id); }, msg = function (t) { $('msg').textContent = t; };
    var cerrar = function () { host.remove(); };
    sh.querySelector('.fondo').onclick = cerrar; sh.querySelector('.x').onclick = cerrar;
    var guardar = function () {
      GM_setValue('vm_token', $('tok').value.trim()); GM_setValue('vm_device', $('dis').value.trim());
      GM_setValue('vm_activo', $('act').checked);
      ['lineales', 'gpon'].forEach(function (pr) {
        var fr = $('fra_' + pr).value.trim(); GM_setValue(FRASES[pr].clave, fr && fr !== FRASES[pr].def ? fr : '');
      });
      marcarTitulo();
    };
    // vista previa: cómo sonaría con el primer caso de ese proyecto en la lista (o con uno de ejemplo)
    var ejemplo = {
      lineales: {numero: 'WO0097001', datos: {cmdb_ci: 'WICAP_IPRAN_LMT_CF136_CF05440', priority: '2 - Urgente', u_falla: 'ATENUACIÓN FO',
        service_offering: 'TSO_C_TL_CL_LAMA_BA'}, titulos: {iddefalla: 'u_falla'}},
      gpon: {numero: 'WO0097002', datos: {cmdb_ci: 'GPON-GFLR-C9190-901', priority: '3 - Moderada', assignment_group: 'C-GZ1-MOBI'}, titulos: {}}};
    var ultimo = 'fra_lineales';
    var previa = function () {
      ['lineales', 'gpon'].forEach(function (pr) {
        var f = (vigilada() && (filas() || []).filter(function (x) { return proyectoDe(x) === pr; })[0]) || ejemplo[pr];
        $('oye_' + pr).innerHTML = '🔈 <b>Así suena:</b> ' + esc(fraseAlexa(f, $('fra_' + pr).value.trim() || FRASES[pr].def));
      });
    };
    ['lineales', 'gpon'].forEach(function (pr) {
      $('fra_' + pr).oninput = previa;
      $('fra_' + pr).onfocus = function () { ultimo = 'fra_' + pr; };
    });
    sh.querySelectorAll('.v').forEach(function (b) {
      b.onmousedown = function (e) { e.preventDefault(); };          // que no le saque el foco al cuadro de texto
      b.onclick = function () {
        var ta = $(ultimo), ini = ta.selectionStart, fin = ta.selectionEnd, txt = b.textContent;
        ta.value = ta.value.slice(0, ini) + txt + ta.value.slice(fin);
        ta.focus(); ta.selectionStart = ta.selectionEnd = ini + txt.length; previa();
      };
    });
    sh.querySelectorAll('[data-res]').forEach(function (l) {
      l.onclick = function () { var pr = l.getAttribute('data-res'); $('fra_' + pr).value = FRASES[pr].def; previa(); };
    });
    previa();
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
