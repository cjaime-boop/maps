// ==UserScript==
// @name         Mobisond · Avisador
// @namespace    mobisond
// @version      2.17
// @description  Avisa los casos nuevos (celular, campana y grupo de Telegram), los casos Lineales sin notas de trabajo hace 25 min y los SLA a 1 hora de vencer.
// @match        https://*.service-now.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      ntfy.sh
// @connect      api.telegram.org
// @updateURL    https://cjaime-boop.github.io/maps/scripts/avisador.user.js
// @downloadURL  https://cjaime-boop.github.io/maps/scripts/avisador.user.js
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  // Cada persona tiene su propio canal (el nombre que se suscribe en la app ntfy del celular).
  // La primera vez se inventa uno al azar; se ve y se cambia desde el menú "Mi canal del celular".
  function canal() {
    var c = GM_getValue('canal', '');
    if (!c) {
      var r = '', abc = 'abcdefghijkmnpqrstuvwxyz23456789';
      for (var i = 0; i < 10; i++) r += abc[Math.floor(Math.random() * abc.length)];
      c = 'mobisond-casos-' + r;
      GM_setValue('canal', c);
    }
    return c;
  }
  var NTFY = 'https://ntfy.sh/' + canal();

  function aviso(titulo, texto, link, prioridad) {
    var h = {'Tags': 'rotating_light', 'Priority': String(prioridad || 4)};   // el título va en la URL (?t=) para que salgan bien los acentos
    if (link) h['Click'] = link;
    GM_xmlhttpRequest({method: 'POST', url: NTFY + '?t=' + encodeURIComponent(titulo), data: texto, headers: h,
      timeout: 10000, onerror: function () { console.log('[Mobisond] no se pudo mandar el aviso'); }});
    // también en la PC (notificación de Windows); al tocarla abre el caso
    try {
      GM_notification({title: titulo, text: texto, timeout: 0, silent: false,
        onclick: function () { if (link) window.open(link, '_blank'); else window.focus(); }});
    } catch (e) {}
  }

  // ---------------------------------------------------------------- grupo de Telegram (opcional)
  // Si se configura (menú "Grupo de Telegram"), cada caso nuevo se manda también al grupo, UNA sola vez aunque
  // varias PCs tengan la bandeja abierta: antes de mandar se anota el caso en un canal ntfy compartido y se fija
  // si otra PC ya lo anotó.
  function tg(metodo, datos, ok, mal) {
    GM_xmlhttpRequest({method: 'POST', url: 'https://api.telegram.org/bot' + GM_getValue('tg_token', '') + '/' + metodo,
      headers: {'Content-Type': 'application/json'}, data: JSON.stringify(datos || {}), timeout: 15000,
      onload: function (r) { var j = {}; try { j = JSON.parse(r.responseText); } catch (e) {}
        if (j.ok) { if (ok) ok(j.result); } else if (mal) mal(j.description || ('error ' + r.status)); },
      onerror: function () { if (mal) mal('sin conexión'); }});
  }
  // Token del bot del equipo, cerrado con la contraseña del equipo (AES). Sin la contraseña no sirve.
  var TG_CERRADO = 'R76sJdArgJd6X6GlESwFVg==.79LONunnZbdiJjqj.fnQwbbIKSKPKaV2VGj5utV/Wt0x73+pJI/94r+sRFiMgazicfSbOH1NzOUVg4SZiEZa6WuJAKmNPDPAiob8=';
  var TG_CHAT_EQUIPO = '-5016783082';   // número del grupo "Dispensers Mobisond"
  function b64(t) { return Uint8Array.from(atob(t), function (ch) { return ch.charCodeAt(0); }); }
  function abrirToken(clave) {
    var p = TG_CERRADO.split('.'), sub = crypto.subtle;
    return sub.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']).then(function (k) {
      return sub.deriveKey({name: 'PBKDF2', salt: b64(p[0]), iterations: 150000, hash: 'SHA-256'}, k,
                           {name: 'AES-GCM', length: 256}, false, ['decrypt']);
    }).then(function (k) { return sub.decrypt({name: 'AES-GCM', iv: b64(p[1])}, k, b64(p[2])); })
      .then(function (b) { return new TextDecoder().decode(b); });
  }
  function pedirClave(forzar) {
    var c = prompt('Contraseña del equipo Mobisond\n\nCon esto se activan los avisos al grupo de Telegram. ' +
                   'Se pide una sola vez (si no la sabés, pedísela al Chino).', '');
    if (!c) return;
    abrirToken(c.trim()).then(function (tok) {
      GM_setValue('tg_token', tok);
      if (TG_CHAT_EQUIPO && !GM_getValue('tg_chat', '')) GM_setValue('tg_chat', TG_CHAT_EQUIPO);
      alert('Listo: los casos nuevos también van al grupo de Telegram.');
    }, function () { alert('Contraseña incorrecta. Probá de nuevo desde el menú "Contraseña del equipo".'); });
  }
  if (!GM_getValue('tg_token', '') && !GM_getValue('clave_pedida', false)) {
    GM_setValue('clave_pedida', true);
    setTimeout(pedirClave, 1500);
  } else if (GM_getValue('tg_token', '') && !GM_getValue('tg_chat', '') && TG_CHAT_EQUIPO) {
    GM_setValue('tg_chat', TG_CHAT_EQUIPO);
  }

  function hayGrupo() { return GM_getValue('tg_token', '') && GM_getValue('tg_chat', ''); }
  function canalGrupo() {          // canal ntfy compartido por todas las PCs del mismo grupo (para no repetir)
    var t = String(GM_getValue('tg_chat', '')) + GM_getValue('tg_token', '').split(':')[0], h = 0;
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return 'https://ntfy.sh/mobisond-grupo-' + h.toString(36);
  }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function mensajeGrupo(f, prueba) {
    var d = f.datos;
    var linea = [d.priority, d.cmdb_ci].filter(Boolean).join(' · ');
    return '🔔 <b>' + (prueba ? 'Prueba · ' : 'Entró ') + esc(f.numero) + '</b>' + (linea ? '\n' + esc(linea) : '') +
      (d.short_description ? '\n' + esc(d.short_description) : '') + '\n<a href="' + esc(f.link) + '">Abrir en ServiceNow</a>';
  }
  // Manda al grupo una sola vez por "clave", aunque varias PCs lo detecten (se anota en un canal ntfy compartido).
  function unaVezAlGrupo(clave, html) {
    if (!hayGrupo()) return;
    var canalG = canalGrupo();
    var mandar = function () { tg('sendMessage', {chat_id: GM_getValue('tg_chat'), text: html, parse_mode: 'HTML', disable_web_page_preview: true}); };
    GM_xmlhttpRequest({method: 'GET', url: canalG + '/json?poll=1&since=12h', timeout: 10000,
      onload: function (r) {
        if (r.responseText.indexOf('"message":"' + clave + '"') >= 0) return;      // otra PC ya lo mandó
        GM_xmlhttpRequest({method: 'POST', url: canalG, data: clave, timeout: 10000});
        mandar();
      },
      onerror: mandar});
  }
  function alGrupo(f) { unaVezAlGrupo(f.id, mensajeGrupo(f)); }
  function configurarGrupo() {
    var tok = prompt('Grupo de Telegram\n\nPegá el token del bot (te lo da @BotFather, es algo como 123456:ABC-xyz).\n' +
                     'Dejalo vacío y Aceptar para desactivar el grupo.', GM_getValue('tg_token', ''));
    if (tok === null) return;
    tok = tok.trim();
    if (!tok) { GM_setValue('tg_token', ''); GM_setValue('tg_chat', ''); alert('Grupo de Telegram desactivado.'); return; }
    GM_setValue('tg_token', tok);
    alert('Ahora, en el grupo de Telegram (con el bot ya agregado), mandá el mensaje:\n\n/avisos\n\nCuando lo mandes, tocá Aceptar.');
    tg('getUpdates', {allowed_updates: ['message']}, function (ups) {
      var chat = null;
      ups.forEach(function (u) { var m = u.message; if (m && m.chat && /group/.test(m.chat.type)) chat = m.chat; });
      if (!chat) { alert('No encontré el /avisos en ningún grupo. Fijate que el bot esté agregado al grupo y probá de nuevo.'); return; }
      GM_setValue('tg_chat', String(chat.id));
      tg('sendMessage', {chat_id: chat.id, text: '✅ Listo: en este grupo van a llegar los casos nuevos de ServiceNow.'});
      alert('Listo: los casos nuevos van al grupo "' + (chat.title || chat.id) + '".\n\nLas otras PCs del equipo pueden hacer lo mismo con el mismo token: el caso llega una sola vez.');
    }, function (e) { alert('Telegram no aceptó el token: ' + e); });
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

  function texto(f) {
    var d = f.datos, partes = [];
    if (d.short_description) partes.push(d.short_description);
    Object.keys(d).forEach(function (k) {
      if (['number', 'short_description', 'sys_updated_on', 'sys_updated_by'].indexOf(k) >= 0) return;
      if (partes.length < 6 && d[k].length < 120) partes.push(d[k]);
    });
    return partes.join('\n') || 'Caso nuevo en la lista';
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
      nuevos.slice(0, 5).forEach(function (f) { aviso('Entró ' + f.numero, texto(f), f.link, 5); alGrupo(f); });
      if (nuevos.length > 5) aviso('Entraron ' + nuevos.length + ' casos', 'Y ' + (nuevos.length - 5) + ' más en la lista.', location.href, 4);
    }
    fs.forEach(function (f) { vistos[f.id] = ahora; });
    GM_setValue('vistos2', vistos);
    GM_setValue('base', true);
    GM_setValue('ultima', ahora);
  }

  // ---------------------------------------------------------------- campana en la PC
  // Página aparte que escucha el mismo canal y suena fuerte en la PC (hay que tocar "Activar" una vez).
  var CAMPANA = 'https://cjaime-boop.github.io/maps/campana.html';
  function abrirCampana() {   // le pasa el canal y el nombre de la lista vigilada (para el ⓘ de la campana)
    GM_openInTab(CAMPANA + '#c=' + canal() + '&l=' + encodeURIComponent(GM_getValue('lista_titulo', '') || ''), {active: true});
  }

  // ---------------------------------------------------------------- menú de Tampermonkey
  GM_registerMenuCommand('Vigilar esta lista', function () {
    var k = claveLista();
    if (!k) { alert('Abrí la lista de ServiceNow (la de Pending Dispatch) y volvé a elegir esta opción.'); return; }
    GM_setValue('lista', k);
    GM_setValue('lista_titulo', (document.title || '').replace(/\s*\|\s*ServiceNow\s*$/i, '').trim());
    GM_setValue('vistos2', {});
    GM_setValue('base', false);
    revisar();                         // los casos que ya están no avisan; solo los que entren desde ahora
    var n = (filas() || []).length;
    alert('Listo: vigilo esta lista (' + n + ' casos ahora). Te aviso al celular cuando entre uno nuevo.\n\n' +
          'Ahora se abre la campana: tocá "Activar campana" para que también suene en la PC.');
    abrirCampana();
  });
  function cambiarCanal() {
    var nuevo = prompt('Este es tu canal. En la app ntfy del celular tocá "+" y suscribite a este nombre ' +
                       '(si ya tenés uno, podés pegarlo acá y Aceptar):', canal());
    if (nuevo && nuevo.trim() && nuevo.trim() !== canal()) {
      GM_setValue('canal', nuevo.trim().replace(/[^\w-]/g, ''));
      alert('Listo, ahora aviso al canal: ' + GM_getValue('canal') + '\nRecargá la página para que tome el cambio.');
    }
  }
  GM_registerMenuCommand('¿Qué lista vigilo?', function () {
    var k = GM_getValue('lista', ''), tit = GM_getValue('lista_titulo', '');
    if (!k) { alert('No estoy vigilando ninguna lista. Abrí la de Pending Dispatch y elegí "Vigilar esta lista".'); return; }
    if (vigilada()) {
      alert('SÍ: esta pestaña es la que vigilo (' + (filas() || []).length + ' casos ahora).' + (tit ? '\n' + tit : ''));
    } else {
      alert('NO: esta pestaña no es la vigilada.' + (tit ? '\nVigilo: ' + tit : '') +
            '\n(Tabla ' + k.split('|')[0] + (claveLista() && claveLista().split('|')[0] === k.split('|')[0] ? ', misma tabla pero otro filtro' : '') + ')');
    }
  });
  GM_registerMenuCommand('🧪 Probar todo (celular, campana, grupo y Alexa)', function () {
    var f = (filas() || [])[0] || {numero: 'WO0000000', datos: {short_description: 'Caso de prueba'}, link: location.href};
    aviso('Entró ' + f.numero + ' (prueba)', texto(f), f.link, 4);          // celular (ntfy) + campana + notificación de la PC
    if (hayGrupo()) tg('sendMessage', {chat_id: GM_getValue('tg_chat'), text: mensajeGrupo(f, true), parse_mode: 'HTML', disable_web_page_preview: true},
                       null, function (e) { alert('El grupo de Telegram no anduvo: ' + e); });
    document.dispatchEvent(new CustomEvent('mobisond-probar-todo'));       // Alexa (si tiene su script instalado)
    alert('Prueba mandada. Fijate que llegue:\n\n• al celular (ntfy)\n• a la campana\n• al grupo de Telegram' +
          (hayGrupo() ? '' : ' (NO configurado en esta PC)') + '\n• Alexa (si la tenés en esta PC)');
  });
  GM_registerMenuCommand('⚙️ Configuración', configuracion);
  GM_registerMenuCommand('Dejar de vigilar', function () { GM_setValue('lista', ''); alert('Ya no vigilo ninguna lista.'); });

  // ---------------------------------------------------------------- controles al grupo de Telegram
  // Cada 2 minutos (desde la pestaña vigilada) se consulta ServiceNow por detrás:
  //  1) Lineales en curso, sin pausa, sin notas de trabajo hace 25 min -> avisa UNA vez (hasta que haya otra nota).
  //  2) Lineales y GPON en curso, con el SLA corriendo y a 1 hora o menos de vencer -> avisa una vez por SLA.
  var GRUPOS = {lineales: 'C-TL-MOBISOND', gpon: 'C-GZ1-MOBI'};
  var SILENCIO_MIN = 25, SLA_MIN = 60, CADA_MS = 2 * 60 * 1000;

  function token() {
    try { if (unsafeWindow.g_ck) return unsafeWindow.g_ck; } catch (e) {}
    try { var f = document.querySelector('iframe#gsft_main'); if (f && f.contentWindow.g_ck) return f.contentWindow.g_ck; } catch (e) {}
    return '';
  }
  function api(tabla, query, campos) {
    var url = location.origin + '/api/now/table/' + tabla + '?sysparm_display_value=all&sysparm_exclude_reference_link=true' +
      '&sysparm_limit=1000&sysparm_fields=' + campos + '&sysparm_query=' + encodeURIComponent(query);
    var h = {'Accept': 'application/json'}, t = token(); if (t) h['X-UserToken'] = t;
    return fetch(url, {credentials: 'same-origin', headers: h}).then(function (r) {
      if (!r.ok) throw new Error('ServiceNow ' + r.status);
      return r.json();
    }).then(function (j) { return j.result || []; });
  }
  function dv(r, c) { var v = r[c]; return v ? (v.display_value || '') : ''; }
  function vl(r, c) { var v = r[c]; return v ? (v.value || '') : ''; }
  function utc(t) { return t ? new Date(t.replace(' ', 'T') + 'Z').getTime() : 0; }
  function hhmm(ms) { var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function enCurso(r) { return /work in progress|en curso/i.test(dv(r, 'state')); }
  function pausado(r) {                // manda el subestado ("Paused"/"En pausa"); si no viene, el motivo de pausa
    var sub = dv(r, 'substate');
    return sub ? /paus/i.test(sub) : !!dv(r, 'u_pause_reason').trim();
  }
  function proyecto(r) {
    var g = dv(r, 'assignment_group').toUpperCase();
    return g.indexOf(GRUPOS.lineales) === 0 ? 'Lineales' : g.indexOf(GRUPOS.gpon) === 0 ? 'GPON' : '';
  }
  function linkCaso(r) { return location.origin + '/wm_task.do?sys_id=' + vl(r, 'sys_id'); }
  function cuerpo(r) {
    var num = dv(r, 'number').replace(/^WOT/i, 'WO');
    return esc(num) + ' · ' + esc(proyecto(r)) + (dv(r, 'cmdb_ci') ? ' · ' + esc(dv(r, 'cmdb_ci')) : '') +
      (dv(r, 'short_description') ? '\n' + esc(dv(r, 'short_description')) : '') +
      '\nAsignado: ' + esc(dv(r, 'assigned_to') || 'sin asignar') + ' · <a href="' + esc(linkCaso(r)) + '">Abrir en ServiceNow</a>';
  }

  // última nota de trabajo de cada caso. Las notas se cargan en la WO (padre), no en la WOT.
  // Primero por la tabla de notas; si no hay permiso, leyendo el campo de notas de la WO. Devuelve {sys_id de la WOT: ms}.
  function fechaJournal(t) {          // "2026-10-24 05:12:33 - Nombre (Notas de trabajo)" o "24/10/2026 05:12:33 - ..."
    var m;
    if ((m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(t))) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    if ((m = /(\d{2})[\/-](\d{2})[\/-](\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(t))) return new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime();
    return 0;
  }
  function ultimasNotas(casos) {
    var dePadre = {};                 // sys_id de la WO -> [sys_id de las WOT]
    casos.forEach(function (r) { var p = vl(r, 'parent'); if (p) (dePadre[p] = dePadre[p] || []).push(vl(r, 'sys_id')); });
    var padres = Object.keys(dePadre);
    var repartir = function (porPadre) {
      var u = {};
      Object.keys(porPadre).forEach(function (p) { (dePadre[p] || []).forEach(function (id) { u[id] = porPadre[p]; }); });
      return u;
    };
    if (!padres.length) return Promise.resolve({});
    return api('sys_journal_field', 'element=work_notes^element_idIN' + padres.join(','), 'element_id,sys_created_on').then(function (ns) {
      var u = {};
      ns.forEach(function (n) { var id = vl(n, 'element_id'), t = utc(vl(n, 'sys_created_on')); if (!u[id] || t > u[id]) u[id] = t; });
      return repartir(u);
    }, function () {
      return api('wm_order', 'sys_idIN' + padres.join(','), 'sys_id,work_notes').then(function (wos) {
        var u = {};
        wos.forEach(function (w) { var t = fechaJournal(dv(w, 'work_notes')); if (t) u[vl(w, 'sys_id')] = t; });
        return repartir(u);
      });
    });
  }

  function controles() {
    if (!hayGrupo() || !vigilada()) return;
    var ahora = Date.now();
    if (ahora - GM_getValue('ult_control', 0) < CADA_MS) return;      // la pestaña se recarga cada 30 s: se controla cada 2 min
    GM_setValue('ult_control', ahora);
    var q = 'active=true^assignment_group.nameSTARTSWITH' + GRUPOS.lineales + '^ORassignment_group.nameSTARTSWITH' + GRUPOS.gpon;
    var campos = 'sys_id,number,parent,state,substate,u_pause_reason,assignment_group,assigned_to,cmdb_ci,short_description,work_start';
    api('wm_task', q, campos).then(function (casos) {
      casos = casos.filter(enCurso);
      // pausas y entrada a "en curso" vistas desde esta PC (para empezar a contar los 25 min desde que se retoma)
      var visto = GM_getValue('ctl_visto', {}), nuevoVisto = {};
      casos.forEach(function (r) {
        var id = vl(r, 'sys_id'), v = visto[id] || {desde: ahora, pausa: 0};
        if (pausado(r)) v.pausa = ahora;
        nuevoVisto[id] = v;
      });
      GM_setValue('ctl_visto', nuevoVisto);
      if (!casos.length) return;

      // 1) sin notas de trabajo (solo Lineales, sin pausa)
      var lin = casos.filter(function (r) { return proyecto(r) === 'Lineales' && !pausado(r); });
      if (lin.length) ultimasNotas(lin).then(function (notas) {
        lin.forEach(function (r) {
          var id = vl(r, 'sys_id'), v = nuevoVisto[id];
          var base = Math.max(notas[id] || 0, utc(vl(r, 'work_start')), v.pausa || 0, notas[id] || utc(vl(r, 'work_start')) ? 0 : v.desde);
          var min = (ahora - base) / 60000;
          if (min >= SILENCIO_MIN && min < SILENCIO_MIN + 20) {     // recién cruzó los 25 min (no avisa de golpe los viejos)
            unaVezAlGrupo('nota:' + id + ':' + base, '⏱️ <b>Sin notas de trabajo hace ' + Math.floor(min) + ' min</b>\n' + cuerpo(r));
          }
        });
      });

      // 2) SLA a 1 hora de vencer (Lineales y GPON)
      var porId = {};
      casos.forEach(function (r) { porId[vl(r, 'sys_id')] = r; if (vl(r, 'parent')) porId[vl(r, 'parent')] = r; });
      api('task_sla', 'active=true^has_breached=false^taskIN' + Object.keys(porId).join(','), 'sys_id,task,stage,planned_end_time,original_breach_time')
        .then(function (slas) {
          slas.forEach(function (s) {
            if (/paus/i.test(vl(s, 'stage') + dv(s, 'stage'))) return;
            var r = porId[vl(s, 'task')]; if (!r) return;
            var vence = utc(vl(s, 'planned_end_time')), falta = (vence - ahora) / 60000;
            if (falta > 0 && falta <= SLA_MIN) {
              unaVezAlGrupo('sla:' + vl(s, 'sys_id'), '⚠️ <b>SLA vence en ' + Math.round(falta) + ' min (' + hhmm(vence) + ')</b>\n' + cuerpo(r));
            }
          });
        }, function () {});
    }, function (e) { console.log('[Mobisond] controles: ' + e.message); });
  }

  // ---------------------------------------------------------------- panel de configuración
  function configuracion() {
    var v = document.getElementById('mbs-conf'); if (v) v.remove();
    var p = document.createElement('div');
    p.id = 'mbs-conf';
    p.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center;font:14px "Segoe UI",Arial';
    var grupo = hayGrupo() ? 'activo' : 'sin configurar';
    p.innerHTML = '<div style="background:#fff;color:#1f2937;border-radius:12px;width:340px;box-shadow:0 10px 30px rgba(0,0,0,.25);overflow:hidden">' +
      '<div style="display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid #eef0f2"><b style="font-size:15px">⚙️ Configuración de avisos</b>' +
      '<span data-a="x" style="margin-left:auto;color:#9ca3af;cursor:pointer;font-size:16px">✕</span></div>' +
      [['canal', '📱 Mi canal del celular', canal()],
       ['clave', '🔑 Contraseña del equipo', GM_getValue('tg_token', '') ? 'cargada' : 'falta cargar'],
       ['grupo', '💬 Grupo de Telegram', grupo],
       ['campana', '🔔 Abrir la campana de la PC', '']].map(function (o) {
        return '<div data-a="' + o[0] + '" style="padding:11px 14px;border-bottom:1px solid #f3f4f6;cursor:pointer">' + o[1] +
               (o[2] ? '<div style="color:#6b7280;font-size:12px;margin-top:2px">' + o[2] + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    p.onclick = function (e) {
      var a = e.target.closest('[data-a]'); if (e.target === p) a = {dataset: {a: 'x'}};
      if (!a) return;
      p.remove();
      ({canal: cambiarCanal, clave: function () { pedirClave(true); }, grupo: configurarGrupo, campana: abrirCampana, x: function () {}})[a.dataset.a]();
    };
    document.body.appendChild(p);
  }

  // ---------------------------------------------------------------- cuándo revisar
  if (!claveLista()) return;
  revisar();
  setTimeout(controles, 4000);
  setInterval(controles, 30000);
  var espera = null;
  new MutationObserver(function () {
    clearTimeout(espera);
    espera = setTimeout(revisar, 1500);
  }).observe(document.body, {childList: true, subtree: true});
  setInterval(revisar, 5000);
})();
