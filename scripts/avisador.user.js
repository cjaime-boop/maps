// ==UserScript==
// @name         Mobisond · Avisador
// @namespace    mobisond
// @version      2.50
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
// @connect      supabase.co
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

  // ---------------------------------------------------------------- grupo de Telegram
  // Con la contraseña del equipo, los avisos van al grupo "Dispensers Mobisond". Aunque varias PCs detecten lo
  // mismo, sale UNA sola vez: Supabase hace de árbitro (ver unaVezAlGrupo).
  function tg(metodo, datos, ok, mal) {
    GM_xmlhttpRequest({method: 'POST', url: 'https://api.telegram.org/bot' + GM_getValue('tg_token', '') + '/' + metodo,
      headers: {'Content-Type': 'application/json'}, data: JSON.stringify(datos || {}), timeout: 15000,
      onload: function (r) { var j = {}; try { j = JSON.parse(r.responseText); } catch (e) {}
        if (j.ok) { if (ok) ok(j.result); return; }
        // si el grupo pasó a "supergrupo", Telegram le cambia el número: se actualiza solo
        if (j.parameters && j.parameters.migrate_to_chat_id) GM_setValue('tg_chat', String(j.parameters.migrate_to_chat_id));
        console.log('[Mobisond] Telegram ' + metodo + ': ' + (j.description || r.status));
        if (mal) mal(j.description || ('error ' + r.status)); },
      ontimeout: function () { console.log('[Mobisond] Telegram ' + metodo + ': tardó demasiado'); if (mal) mal('tardó demasiado'); },
      onerror: function () { console.log('[Mobisond] Telegram ' + metodo + ': sin conexión'); if (mal) mal('sin conexión'); }});
  }
  // Token del bot del equipo, cerrado con la contraseña del equipo (AES). Sin la contraseña no sirve.
  var TG_CERRADO = 'R76sJdArgJd6X6GlESwFVg==.79LONunnZbdiJjqj.fnQwbbIKSKPKaV2VGj5utV/Wt0x73+pJI/94r+sRFiMgazicfSbOH1NzOUVg4SZiEZa6WuJAKmNPDPAiob8=';
  var TG_CHAT_EQUIPO = '-5016783082';   // número del grupo "Dispensers Mobisond"
  function b64(t) { return Uint8Array.from(atob(t), function (ch) { return ch.charCodeAt(0); }); }
  function abrirToken(clave, cerrado) {
    var p = (cerrado || TG_CERRADO).split('.'), sub = crypto.subtle;
    return sub.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']).then(function (k) {
      return sub.deriveKey({name: 'PBKDF2', salt: b64(p[0]), iterations: 150000, hash: 'SHA-256'}, k,
                           {name: 'AES-GCM', length: 256}, false, ['decrypt']);
    }).then(function (k) { return sub.decrypt({name: 'AES-GCM', iv: b64(p[1])}, k, b64(p[2])); })
      .then(function (b) { return new TextDecoder().decode(b); });
  }
  function pedirClave(intento, alTerminar) {      // intento: 1, 2, 3 (si se equivoca la vuelve a pedir)
    intento = intento || 1;
    var fin = alTerminar || function () {};
    var c = prompt((intento > 1 ? 'Contraseña incorrecta, probá de nuevo.\n\n' : '') +
                   'Contraseña del equipo Mobisond\n\nCon esto se activan los avisos al grupo de Telegram y el bot. ' +
                   'Se pide una sola vez (si no la sabés, pedísela al Chino).', '');
    if (!c) { fin(false); return; }
    abrirToken(c.trim()).then(function (tok) {
      GM_setValue('tg_token', tok);
      if (TG_CHAT_EQUIPO && !GM_getValue('tg_chat', '')) GM_setValue('tg_chat', TG_CHAT_EQUIPO);
      alert('Listo: los casos nuevos también van al grupo de Telegram.');
      fin(true);
    }, function () {
      if (intento < 3) pedirClave(intento + 1, fin);
      else { alert('Contraseña incorrecta. Probá de nuevo desde ⚙️ Configuración → Contraseña del equipo.'); fin(false); }
    });
  }
  if (!GM_getValue('tg_token', '') && !GM_getValue('clave_pedida', false)) {
    GM_setValue('clave_pedida', true);
    setTimeout(pedirClave, 1500);
  } else if (GM_getValue('tg_token', '') && !GM_getValue('tg_chat', '') && TG_CHAT_EQUIPO) {
    GM_setValue('tg_chat', TG_CHAT_EQUIPO);
  }

  function hayGrupo() { return GM_getValue('tg_token', '') && GM_getValue('tg_chat', ''); }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function colorPrio(p) { return /^1/.test(p) ? '🔴' : /^2/.test(p) ? '🟠' : /^3/.test(p) ? '🟡' : '⚪'; }
  // bloque común de los avisos: WO en negrita, CI, descripción en cursiva, (extra) y link
  function bloqueCaso(wo, ci, desc, link, extra) {
    return '\n\n<b>' + esc(wo) + '</b>' + (ci ? '\n' + esc(ci) : '') +
      (desc ? '\n\n<i>' + esc(desc) + '</i>' : '') + '\n\n' + (extra ? extra + '\n' : '') +
      '🔗 <a href="' + esc(link) + '">Abrir en ServiceNow</a>';
  }
  var DRAMA = ['Se terminó la paz 😩', 'Arriba, que hay laburo 💪', 'Nadie lo pidió, pero llegó 🙃', 'A ponerse las pilas ⚡',
               'Y justo cuando estaba todo tranquilo… 😬', 'Atención, atención 📢'];
  function mensajeGrupo(f, prueba) {
    var d = f.datos, prio = d.priority || '';
    var titulo = prueba ? '🧪 <b>Prueba de caso nuevo</b>'
                        : '🚨🚨 <b>¡Entró un caso!</b> 🚨🚨\n<i>' + DRAMA[Math.floor(Math.random() * DRAMA.length)] + '</i>';
    var lineaPrio = prio ? '\n\n' + colorPrio(prio) + ' <b>' + esc(prio) + '</b>' + (/^1/.test(prio) && !prueba ? ' 🔥' : '') : '';
    return titulo + lineaPrio + bloqueCaso(f.numero, d.cmdb_ci, d.short_description, f.link);
  }
  // Manda al grupo una sola vez por "clave", aunque varias PCs lo detecten (Supabase decide quién lo manda).
  function unaVezAlGrupo(clave, html, responderA, chatId, alTerminar) {   // chatId: para contestar por privado (si no, al grupo)
    if (!hayGrupo()) return;
    var datos = {chat_id: chatId || GM_getValue('tg_chat'), text: html, parse_mode: 'HTML', disable_web_page_preview: true};
    if (responderA) datos.reply_to_message_id = responderA;
    var fin = alTerminar || function () {};
    var decidido = false;
    var mandar = function (por) {
      if (decidido) return; decidido = true;
      tg('sendMessage', datos, function () {
        botLog('mandado ' + clave.slice(0, 30) + (por ? ' (' + por + ')' : '')); fin(true);
      }, function (e) { botLog('Telegram no dejó mandar (' + clave.slice(0, 30) + '): ' + e); fin(false); });
    };
    // los comandos los lee una sola PC (Supabase o Telegram se los da a una): se contestan directo
    if (/^cmd:/.test(clave)) { mandar(); return; }
    // casos y alertas: Supabase hace de árbitro, solo la primera PC que lo pide lo manda.
    // Si Supabase no responde, se manda igual (mejor repetido que perdido).
    sbRpc('bot_reclamar', {p_aviso: clave, p_pc: pcId()}).then(function (gano) {
      if (gano === false) { decidido = true; botLog('ya lo mandó otra PC: ' + clave.slice(0, 30)); fin(true); return; }
      mandar();
    }, function (e) { mandar('Supabase no respondió: ' + e.message); });
  }
  function alGrupo(f) { botLog('caso nuevo ' + f.numero); unaVezAlGrupo(f.id, mensajeGrupo(f)); }
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
      // el número que se muestra es el de la WO (columna Parent); si la lista no la tiene, el de la WOT
      var numero = datos.parent || datos.number || (a && a.textContent.trim()) || id.slice(0, 8);
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
    alert('Listo: vigilo esta lista (' + n + ' casos ahora). Te aviso cuando entre uno nuevo.\n\nAhora se abre la campana de la PC.');
    // si todavía no cargó la contraseña del equipo, se pide ahora (sin ella no hay grupo de Telegram ni bot)
    if (!GM_getValue('tg_token', '')) pedirClave(1, function () { abrirCampana(); });
    else abrirCampana();
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
  GM_registerMenuCommand('🧪 Probar todo (celular, campana y grupo)', function () {
    var f = (filas() || [])[0] || {numero: 'WO0000000', datos: {short_description: 'Caso de prueba'}, link: location.href};
    aviso('Entró ' + f.numero + ' (prueba)', texto(f), f.link, 4);          // celular (ntfy) + campana + notificación de la PC
    if (hayGrupo()) tg('sendMessage', {chat_id: GM_getValue('tg_chat'), text: mensajeGrupo(f, true), parse_mode: 'HTML', disable_web_page_preview: true},
                       null, function (e) { alert('El grupo de Telegram no anduvo: ' + e); });
    alert('Prueba mandada. Fijate que llegue:\n\n• al celular (ntfy)\n• a la campana\n• al grupo de Telegram' +
          (hayGrupo() ? '' : ' (NO configurado en esta PC)') + '\n\n(Alexa no se prueba acá: para eso está "Alexa: probar".)');
  });
  GM_registerMenuCommand('⚙️ Configuración', configuracion);
  GM_registerMenuCommand('🔧 Revisar bot', function () {          // diagnóstico temporal de /bandeja
    var info = ['Versión ' + (typeof GM_info !== 'undefined' ? GM_info.script.version : '?'), 'Pestaña vigilada: ' + (vigilada() ? 'SÍ' : 'NO'), 'Esta pestaña atiende avisos y bot: ' + (soyLider() ? 'SÍ' : 'NO'), 'Grupo guardado: ' + (GM_getValue('tg_chat', '') || 'ninguno'),
                'Token: ' + (GM_getValue('tg_token', '') ? 'cargado' : 'falta'), 'Último leído: ' + GM_getValue('tg_offset', 0)];
    tg('getWebhookInfo', {}, function (w) {
      info.push('Webhook: ' + (w.url ? w.url : 'no') + (w.last_error_message ? '\nÚltimo error de Telegram: ' + w.last_error_message : '') +
                (w.pending_update_count ? '\nPendientes en Telegram: ' + w.pending_update_count : ''));
      if (w.url) {
        info.push('', 'Lo último que hizo el bot:'); GM_getValue('tg_log', []).forEach(function (l) { info.push('  ' + l); });
        alert(info.join('\n')); return;
      }
      tg('getUpdates', {timeout: 0, allowed_updates: ['message']}, function (ups) {
        info.push('Mensajes pendientes: ' + ups.length);
        ups.slice(-3).forEach(function (u) { var m = u.message || {}; info.push('  #' + u.update_id + ' ' + (m.chat ? m.chat.id + ' ' + (m.chat.title || '') : '') + ': ' + (m.text || '(sin texto)')); });
        info.push('', 'Lo último que hizo el bot:'); GM_getValue('tg_log', []).forEach(function (l) { info.push('  ' + l); });
        alert(info.join('\n'));
      }, function (e) { info.push('getUpdates ERROR: ' + e); alert(info.join('\n')); });
    }, function (e) { info.push('Telegram ERROR: ' + e); alert(info.join('\n')); });
  });
  GM_registerMenuCommand('Dejar de vigilar', function () { GM_setValue('lista', ''); alert('Ya no vigilo ninguna lista.'); });

  // ---------------------------------------------------------------- controles al grupo de Telegram
  // Cada 2 minutos (desde la pestaña que atiende en cada PC) se consulta ServiceNow por detrás:
  //  1) Lineales en curso, sin pausa, sin notas de trabajo DE MOBISOND hace 25 min -> avisa UNA vez (hasta que haya otra nota).
  //  2) Lineales y GPON en curso, con el SLA NETO corriendo y a 1 hora o menos de vencer -> avisa una vez.
  //  3) Lineales y GPON en curso, cuando se les vence el SLA NETO -> avisa una vez.
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
  function cuerpo(r, extra) {          // extra: renglón (ya en HTML) antes del link, ej. "📝 Última: …"
    return bloqueCaso(woDe(r), dv(r, 'cmdb_ci'), dv(r, 'short_description'), linkCaso(r), extra);
  }

  // última nota de trabajo de cada caso. Las notas se cargan en la WO (padre), no en la WOT.
  // Primero por la tabla de notas; si no hay permiso, leyendo el campo de notas de la WO. Devuelve {sys_id de la WOT: ms}.
  function fechaJournal(t) {          // "2026-10-24 05:12:33 - Nombre (Notas de trabajo)" o "24/10/2026 05:12:33 - ..."
    var m;
    if ((m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(t))) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    if ((m = /(\d{2})[\/-](\d{2})[\/-](\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(t))) return new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime();
    return 0;
  }
  // Notas que cuentan para los 25 min: solo las de gente de Mobisond (dispatchers y cuadrillas), no las de ATC.
  // Los nombres van como huella (no en texto) porque esta página es pública. Para sumar a alguien: pasarle el nombre al Chino.
  var MOBISOND = '3a43955d,3ce1b201,67b9421b,6af39483,741191b9,79418083,7ec80380,87ff9936,8d58e69,92e5413a,a1ef4970,b4a2cc16,c0c7e2b3,c49b7506,d43073f7,dfd95c3e,ed70c375,ee876403'.split(',');
  function huella(t) { var x = 0; for (var i = 0; i < t.length; i++) x = (x * 31 + t.charCodeAt(i)) >>> 0; return x.toString(16); }
  function normNom(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  function esNuestro(nombre) {         // "Juan Pérez" o "Juan Carlos Pérez" (nombre + último apellido)
    var n = normNom(nombre); if (!n) return false;
    var p = n.split(' ');
    return MOBISOND.indexOf(huella(n)) >= 0 || (p.length > 2 && MOBISOND.indexOf(huella(p[0] + ' ' + p[p.length - 1])) >= 0) ||
           (p.length > 2 && MOBISOND.indexOf(huella(p[0] + ' ' + p[p.length - 2])) >= 0);
  }
  // todas las entradas de un campo de notas: "2026-10-24 05:12:33 - Juan Pérez (Notas de trabajo)" / "(Additional comments)"
  function notasDelTexto(t) {
    var re = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4} \d{2}:\d{2}:\d{2}) - (.+?) \((?:Notas de trabajo|Work notes|Comentarios adicionales|Additional comments|Comentarios)\)/gi, m, out = [];
    while ((m = re.exec(t || ''))) out.push({t: fechaJournal(m[1]), quien: m[2].trim()});
    return out;
  }
  // Última actividad de gente de Mobisond en la WO (padre): notas de trabajo, comentarios adicionales y fotos/archivos subidos.
  // Se leen por dos caminos y se toma la más nueva: los campos de la WO (texto) y la tabla de notas
  // (que a veces viene vacía por permisos). Devuelve {sys_id de la WOT: {t, quien}}.
  function ultimasNotas(casos) {
    var dePadre = {};                 // sys_id de la WO -> [sys_id de las WOT]
    casos.forEach(function (r) { var p = vl(r, 'parent'); if (p) (dePadre[p] = dePadre[p] || []).push(vl(r, 'sys_id')); });
    var padres = Object.keys(dePadre);
    if (!padres.length) return Promise.resolve({});
    var mejor = {};                   // sys_id de la WO -> {t, quien}
    var sumar = function (wo, n) { if (n && n.t && esNuestro(n.quien) && (!mejor[wo] || n.t > mejor[wo].t)) mejor[wo] = n; };
    var porTexto = api('wm_order', 'sys_idIN' + padres.join(','), 'sys_id,work_notes,comments').then(function (wos) {
      wos.forEach(function (w) {
        notasDelTexto(dv(w, 'work_notes') + '\n' + dv(w, 'comments')).forEach(function (n) { sumar(vl(w, 'sys_id'), n); });
      });
    }, function (e) { console.log('[Mobisond] notas (WO): ' + e.message); });
    var porTabla = api('sys_journal_field', 'element=work_notes^ORelement=comments^element_idIN' + padres.join(','), 'element_id,sys_created_on,sys_created_by').then(function (ns) {
      var usuarios = {};
      ns.forEach(function (n) { if (vl(n, 'sys_created_by')) usuarios[vl(n, 'sys_created_by')] = 1; });
      if (!Object.keys(usuarios).length) return;
      // el autor viene como usuario (ej. jperez): se busca el nombre completo para saber si es de Mobisond
      return api('sys_user', 'user_nameIN' + Object.keys(usuarios).join(','), 'user_name,name').then(function (us) {
        var nom = {}; us.forEach(function (x) { nom[vl(x, 'user_name')] = dv(x, 'name'); });
        ns.forEach(function (n) { sumar(vl(n, 'element_id'), {t: utc(vl(n, 'sys_created_on')), quien: nom[vl(n, 'sys_created_by')] || ''}); });
      });
    }).catch(function () {});
    // fotos y archivos subidos (a la WO o a la WOT) también cuentan
    var woDeWot = {}; casos.forEach(function (r) { if (vl(r, 'parent')) woDeWot[vl(r, 'sys_id')] = vl(r, 'parent'); });
    var porAdjuntos = api('sys_attachment', 'table_sys_idIN' + padres.concat(Object.keys(woDeWot)).join(','), 'table_sys_id,sys_created_on,sys_created_by').then(function (as) {
      var usuarios = {};
      as.forEach(function (a) { if (vl(a, 'sys_created_by')) usuarios[vl(a, 'sys_created_by')] = 1; });
      if (!Object.keys(usuarios).length) return;
      return api('sys_user', 'user_nameIN' + Object.keys(usuarios).join(','), 'user_name,name').then(function (us) {
        var nom = {}; us.forEach(function (x) { nom[vl(x, 'user_name')] = dv(x, 'name'); });
        as.forEach(function (a) {
          var dueño = woDeWot[vl(a, 'table_sys_id')] || vl(a, 'table_sys_id');
          sumar(dueño, {t: utc(vl(a, 'sys_created_on')), quien: (nom[vl(a, 'sys_created_by')] || ''), foto: true});
        });
      });
    }).catch(function (e) { console.log('[Mobisond] adjuntos: ' + (e && e.message)); });
    return Promise.all([porTexto, porTabla, porAdjuntos]).then(function () {
      var u = {};
      Object.keys(mejor).forEach(function (p) { (dePadre[p] || []).forEach(function (id) { u[id] = mejor[p]; }); });
      return u;
    });
  }

  function controles() {
    if (!hayGrupo() || !soyLider()) return;
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
          var nota = notas[id] || {t: 0, quien: ''};
          var base = Math.max(nota.t, utc(vl(r, 'work_start')), v.pausa || 0, nota.t || utc(vl(r, 'work_start')) ? 0 : v.desde);
          var min = (ahora - base) / 60000;
          if (min >= SILENCIO_MIN && min < SILENCIO_MIN + 20) {     // recién cruzó los 25 min (no avisa de golpe los viejos)
            var claveNota = 'nota:' + id + ':' + (nota.t || utc(vl(r, 'work_start')) || 0) + ':' + Math.floor((v.pausa || 0) / 1800000);
            unaVezAlGrupo(claveNota, '⏱️ <b>' + Math.floor(min) + ' min sin notas de Mobisond</b>' +
                          cuerpo(r, '📝 ' + (nota.t ? 'Última: ' + esc(nota.quien || 'sin nombre') + (nota.foto ? ' (foto)' : '') + ' · ' + hhmm(nota.t) : 'Todavía sin notas')));
          }
        });
      });

      // 2) SLA a 1 hora de vencer (Lineales y GPON)
      var porId = {};
      casos.forEach(function (r) { porId[vl(r, 'sys_id')] = r; if (vl(r, 'parent')) porId[vl(r, 'parent')] = r; });
      api('task_sla', 'active=true^taskIN' + Object.keys(porId).join(','), 'sys_id,task,sla,stage,has_breached,planned_end_time,original_breach_time')
        .then(function (slas) {
          slas.forEach(function (s) {
            if (!/neto/i.test(dv(s, 'sla'))) return;                         // solo el SLA NETO
            var r = porId[vl(s, 'task')]; if (!r) return;
            // se venció: aviso una vez (solo si se venció hace menos de 30 min, para no avisar de golpe los viejos)
            if (vl(s, 'has_breached') === 'true') {
              var cuando = utc(vl(s, 'original_breach_time') || vl(s, 'planned_end_time'));
              if (cuando && ahora - cuando < 30 * 60000) {
                unaVezAlGrupo('venc:' + vl(s, 'sys_id'), '🔴 <b>SLA neto vencido</b> · ' + hhmm(cuando) + cuerpo(r));
              }
              return;
            }
            if (/paus/i.test(vl(s, 'stage') + dv(s, 'stage'))) return;
            var vence = utc(vl(s, 'planned_end_time')), falta = (vence - ahora) / 60000;
            if (falta > 0 && falta <= SLA_MIN) {
              unaVezAlGrupo('sla:' + vl(s, 'sys_id'), '⚠️ <b>SLA neto vence en ' + Math.round(falta) + ' min</b> · ' + hhmm(vence) + cuerpo(r));
            }
          });
        }, function () {});
    }, function (e) { console.log('[Mobisond] controles: ' + e.message); });
  }

  // ---------------------------------------------------------------- comandos del grupo (/bandeja)
  // La pestaña que atiende en cada PC toma los pedidos cada 5 s (de Supabase, o de Telegram si no hay Supabase).
  // Si varias PCs están prendidas, cada pedido lo contesta una sola.
  function woDe(r) { return dv(r, 'parent') || dv(r, 'number').replace(/^WOT/i, 'WO'); }
  function textoBandeja() {
    var q = 'active=true^assignment_group.nameSTARTSWITH' + GRUPOS.lineales + '^ORassignment_group.nameSTARTSWITH' + GRUPOS.gpon;
    return api('wm_task', q, 'sys_id,number,parent,state,substate,u_pause_reason,assignment_group,assigned_to,cmdb_ci').then(function (casos) {
      var out = ['📋 <b>Bandeja</b> · ' + hhmm(Date.now())];
      ['Lineales', 'GPON'].forEach(function (pr) {
        var cs = casos.filter(function (r) { return proyecto(r) === pr; });
        var curso = [], verif = [], pausa = [], sin = [];
        cs.forEach(function (r) {
          var motivo = dv(r, 'u_pause_reason').trim();
          if (!enCurso(r)) sin.push(r);
          else if (pausado(r) && /verificaci/i.test(motivo)) verif.push(r);
          else if (pausado(r)) pausa.push(r);
          else curso.push(r);
        });
        var fila = function (r, abajo, alLado) {      // abajo: renglón en cursiva debajo; alLado: en cursiva en el mismo renglón
          var t = '• ' + esc(woDe(r)) + ' · ' + esc(dv(r, 'cmdb_ci') || 'sin CI') + (alLado ? ' · <i>' + esc(alLado) + '</i>' : '');
          if (abajo) t += '\n   <i>' + esc(abajo) + '</i>';
          return t;
        };
        var grupo = function (titulo, lista, abajo, alLado) {
          if (!lista.length) return;
          out.push('', '<b>' + titulo + ' (' + lista.length + ')</b>');
          lista.forEach(function (r) { out.push(fila(r, abajo && abajo(r), alLado && alLado(r))); });
        };
        out.push('', (pr === 'Lineales' ? '🔧' : '📡') + ' <b>' + pr + '</b> · ' + cs.length + (cs.length === 1 ? ' abierto' : ' abiertos'));
        if (!cs.length) return;
        grupo('▶️ En curso', curso, function (r) { return dv(r, 'assigned_to'); });
        grupo('⏸️ Pausados', pausa, function (r) { return dv(r, 'u_pause_reason'); });
        grupo('🔍 Verificación del cliente', verif);
        if (sin.length) grupo('⏳ Sin atender', sin, null, function (r) { return dv(r, 'state'); });
        else out.push('', '⏳ Sin atender: 0');
      });
      return out.join('\n');
    });
  }
  // registro corto de lo que hace el bot (se ve en "🔧 Revisar bot")
  function botLog(t) {
    var l = GM_getValue('tg_log', []); l.push(hhmm(Date.now()) + ' ' + t); GM_setValue('tg_log', l.slice(-8));
    console.log('[Mobisond] ' + t);
  }
  // Los comandos se anotan como pendientes ANTES de confirmarle a Telegram que se leyeron, así si la pestaña
  // se recarga (refrescador) en el medio, se contestan igual en la próxima carga.
  function atenderPendientes() {
    var pend = GM_getValue('tg_pend', []);
    if (!pend.length) return;
    var p = pend[0];
    if (Date.now() - p.cuando > 10 * 60 * 1000) { GM_setValue('tg_pend', pend.slice(1)); botLog('descarto ' + p.cmd + ' viejo'); return; }
    if (atenderPendientes.ocupado) return;
    atenderPendientes.ocupado = true;
    var listo = function (que) {
      atenderPendientes.ocupado = false;
      GM_setValue('tg_pend', GM_getValue('tg_pend', []).filter(function (x) { return x.id !== p.id; }));
      botLog(p.cmd + ': ' + que);
      if (p.sb) sbRpc('bot_listo', {p_id: p.id}).catch(function () {});   // Supabase: avisar que ya se contestó
    };
    if (p.chat && !p.verificado) {           // privado: ¿es del grupo del equipo?
      tg('getChatMember', {chat_id: GM_getValue('tg_chat'), user_id: p.quien}, function (mb) {
        atenderPendientes.ocupado = false;
        if (/creator|administrator|member/.test(mb.status)) {
          GM_setValue('tg_pend', GM_getValue('tg_pend', []).map(function (x) { if (x.id === p.id) x.verificado = true; return x; }));
          atenderPendientes();
        } else {
          tg('sendMessage', {chat_id: p.chat, text: 'Este bot es solo para el equipo de Mobisond.'});
          listo('privado de alguien de afuera, rechazado');
        }
      }, function (e) { listo('no pude verificar al usuario: ' + e); });
      return;
    }
    if (p.cmd === '/caso') {
      textoCaso((p.texto || '').trim().split(/\s+/)[1]).then(function (t) {
        unaVezAlGrupo('cmd:' + p.id, t, p.msg, p.chat, function (ok) { listo(ok ? 'contestado' : 'no se pudo contestar'); });
      }, function (e) { unaVezAlGrupo('cmd:' + p.id, 'No pude leer el caso de ServiceNow (' + esc(e.message) + ').', p.msg, p.chat); listo('error ServiceNow ' + e.message); });
      return;
    }
    if (p.cmd === '/bandeja') {
      textoBandeja().then(function (t) {
        unaVezAlGrupo('cmd:' + p.id, t, p.msg, p.chat, function (ok) { listo(ok ? 'contestado' + (p.chat && String(p.chat) !== String(GM_getValue('tg_chat')) ? ' por privado' : '') : 'no se pudo contestar'); });
      }, function (e) { unaVezAlGrupo('cmd:' + p.id, 'No pude leer la bandeja de ServiceNow (' + esc(e.message) + ').', p.msg, p.chat); listo('error ServiceNow ' + e.message); });
    } else listo('comando desconocido');
  }
  function duracion(min) {
    min = Math.round(Math.abs(min));
    return min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min';
  }
  function textoCaso(arg) {
    var n = (arg || '').trim().toUpperCase();
    if (!n) return Promise.resolve('Decime qué caso: <code>/caso WO0096818</code> (también sirve el WOT o el CS).');
    var q = /^WOT/.test(n) ? 'number=' + n : /^WO/.test(n) ? 'parent.number=' + n : /^CS/.test(n) ? 'short_descriptionSTARTSWITH' + n : 'number=' + n;
    var campos = 'sys_id,number,parent,state,substate,u_pause_reason,priority,assigned_to,cmdb_ci,short_description,opened_at,assignment_group,active';
    return api('wm_task', q + '^ORDERBYDESCopened_at', campos).then(function (rs) {
      if (!rs.length) return 'No encontré el caso ' + esc(n) + '.';
      var r = rs[0], ahora = Date.now();
      var ids = [vl(r, 'sys_id')]; if (vl(r, 'parent')) ids.push(vl(r, 'parent'));
      return Promise.all([
        ultimasNotas([r]).catch(function () { return {}; }),
        api('task_sla', 'active=true^taskIN' + ids.join(','), 'sla,stage,has_breached,planned_end_time,business_time_left').catch(function () { return null; })
      ]).then(function (res) {
        var nota = res[0][vl(r, 'sys_id')], slas = res[1];
        var prio = dv(r, 'priority'), color = /^1/.test(prio) ? '🔴' : /^2/.test(prio) ? '🟠' : /^3/.test(prio) ? '🟡' : '⚪';
        var out = ['🔎 <b>' + esc(woDe(r)) + '</b>', esc(dv(r, 'cmdb_ci') || 'sin CI')];
        if (dv(r, 'short_description')) out.push('<i>' + esc(dv(r, 'short_description')) + '</i>');
        out.push('', '📌 <b>Estado</b>',
                 esc(dv(r, 'state')) + (pausado(r) ? ' · ⏸️ ' + esc(dv(r, 'u_pause_reason') || 'en pausa') : ''),
                 color + ' Prioridad ' + esc(prio || '—'),
                 '👷 ' + esc(dv(r, 'assigned_to') || 'sin asignar'));
        out.push('', '📝 <b>Última actividad Mobisond</b>');
        if (nota && nota.t) out.push(esc(nota.quien || 'sin nombre') + (nota.foto ? ' (foto)' : ''), 'hace ' + duracion((ahora - nota.t) / 60000) + ' · ' + hhmm(nota.t));
        else out.push('ninguna todavía');
        out.push('', '⏱️ <b>SLA neto</b>');
        var neto = (slas || []).filter(function (x) { return /neto/i.test(dv(x, 'sla')); })[0];
        if (slas === null) out.push('no lo pude leer');
        else if (!neto) out.push(vl(r, 'active') === 'false' ? 'caso cerrado' : 'sin SLA activo');
        else {
          var vence = utc(vl(neto, 'planned_end_time')), falta = (vence - ahora) / 60000;
          var enPausa = /paus/i.test(vl(neto, 'stage') + dv(neto, 'stage'));
          if (vl(neto, 'has_breached') === 'true') out.push('🔴 Vencido' + (enPausa ? ' (ahora pausado)' : ''));
          else if (enPausa) {                                       // pausado: la fecha de vencimiento no sirve; "3 Hours 4 Minutes" -> "3 h 4 min"
            var resta = dv(neto, 'business_time_left').replace(/\s*(Hours?|Horas?)/i, ' h').replace(/\s*(Minutes?|Minutos?)/i, ' min')
              .replace(/\s*(Seconds?|Segundos?)/i, ' s').replace(/\s*(Days?|D[ií]as?)/i, ' d');   // SN en inglés o en español
            out.push('⏸️ Pausado' + (resta ? ' · le quedan ' + esc(resta) : ''));
          }
          else if (falta <= 0) out.push('🔴 Vencido');
          else out.push((falta <= 60 ? '⚠️ ' : '🟢 ') + 'Quedan ' + duracion(falta) + ' · vence ' + hhmm(vence));
        }
        out.push('', '🔗 <a href="' + esc(linkCaso(r)) + '">Abrir en ServiceNow</a>');
        return out.join('\n');
      });
    });
  }
  // ---- modo Supabase: el bot vive en una Edge Function (siempre prendida) que anota en Supabase los pedidos
  // que necesitan ServiceNow; esta PC los toma de ahí. Se usa si el bot tiene el "webhook" apuntando a Supabase.
  var SB_URL = 'https://gnqvhlpknxtdnzuxfybc.supabase.co', SB_PUBLICA = 'sb_publishable_dUhjyCfRfNtLVLfOYnJ1WA_hfPD3kk9';
  var SB_CLAVE_CERRADA = 'bJrezExAXJxoyFvb0o308Q==.ZboOXClNC9Ip+ElA.W16qHZOZc4b+j9Hh2sXBpphx4IDVonNvZwAhN85Fr2uV4530JZFIgoc/QytC6qN8';
  var sbClave = null, modoBot = null;           // modoBot: 'supabase' | 'telegram' (se averigua al cargar)
  function sbRpc(fn, args) {
    var ir = sbClave ? Promise.resolve(sbClave) : abrirToken(GM_getValue('tg_token', ''), SB_CLAVE_CERRADA).then(function (c) { sbClave = c; return c; });
    return ir.then(function (clave) {
      args.p_clave = clave;
      return new Promise(function (ok, mal) {
        GM_xmlhttpRequest({method: 'POST', url: SB_URL + '/rest/v1/rpc/' + fn, timeout: 10000,
          headers: {'apikey': SB_PUBLICA, 'Content-Type': 'application/json'}, data: JSON.stringify(args),
          onload: function (r) { if (r.status < 300) { try { ok(JSON.parse(r.responseText || 'null')); } catch (e) { ok(null); } } else mal(new Error('Supabase ' + r.status)); },
          onerror: function () { mal(new Error('sin conexión con Supabase')); }, ontimeout: function () { mal(new Error('Supabase tardó')); }});
      });
    });
  }
  function pcId() {
    var id = GM_getValue('pc_id', '');
    if (!id) { id = 'pc-' + Math.random().toString(36).slice(2, 10); GM_setValue('pc_id', id); }
    return id;
  }
  var tomando = false;
  function tomarDeSupabase() {
    if (tomando) return;
    tomando = true;
    sbRpc('bot_tomar', {p_pc: pcId()}).then(function (filas) {
      tomando = false;
      if (!filas || !filas.length) return;
      var pend = GM_getValue('tg_pend', []);
      filas.forEach(function (f) {
        if (pend.some(function (x) { return x.id === f.id; })) return;
        botLog('recibí ' + f.cmd + ' (Supabase)');
        pend.push({id: f.id, msg: f.msg_id, cmd: f.cmd, texto: f.texto, cuando: Date.now(), chat: f.chat_id, verificado: true, sb: true});
      });
      GM_setValue('tg_pend', pend);
      atenderPendientes();
    }, function (e) { tomando = false; botLog('Supabase: ' + e.message); });
  }

  var leyendo = false;
  function comandos() {
    if (!hayGrupo() || !soyLider()) return;
    atenderPendientes();
    if (GM_getValue('tg_cmds', 0) < 4) {     // menú de comandos del bot (aparece al escribir "/" en el grupo)
      tg('setMyCommands', {commands: [{command: 'bandeja', description: 'Casos abiertos de Lineales y GPON'},
                                      {command: 'caso', description: 'Detalle de un caso: /caso WO0096818'},
                                      {command: 'activos', description: 'Quién está activo ahora y quién entra'}]}, function () { GM_setValue('tg_cmds', 4); });
    }
    if (modoBot === null) {                    // ¿el bot está conectado a Supabase?
      modoBot = 'esperando';
      tg('getWebhookInfo', {}, function (w) { modoBot = /supabase/.test(w.url || '') ? 'supabase' : 'telegram';
        if (GM_getValue('modo_bot', '') !== modoBot) { GM_setValue('modo_bot', modoBot); botLog('modo del bot: ' + modoBot); } },   // se anota solo si cambia
         function () { modoBot = null; });
      return;
    }
    if (modoBot === 'supabase') { tomarDeSupabase(); return; }
    if (modoBot !== 'telegram' || leyendo) return;

    leyendo = true;
    tg('getUpdates', {offset: GM_getValue('tg_offset', 0), timeout: 0, allowed_updates: ['message']}, function (ups) {
      leyendo = false;
      if (!ups.length) return;
      var pend = GM_getValue('tg_pend', []);
      ups.forEach(function (u) {
        var m = u.message;
        if (!m || !m.chat) return;
        if (m.migrate_to_chat_id) { GM_setValue('tg_chat', String(m.migrate_to_chat_id)); botLog('el grupo cambió de número'); return; }
        if (!m.text || m.text.charAt(0) !== '/') return;
        var cmd = m.text.trim().split(/[\s@]/)[0].toLowerCase();
        var privado = m.chat.type === 'private';
        if (!privado && String(m.chat.id) !== String(GM_getValue('tg_chat'))) {
          GM_setValue('tg_chat', String(m.chat.id));          // el bot está en un solo grupo: si cambió el número, se toma el nuevo
          botLog('grupo nuevo: ' + m.chat.id);
        }
        botLog('recibí ' + cmd + (privado ? ' por privado de ' + (m.from && m.from.first_name || '?') : ''));
        // por privado solo se contesta a quien esté en el grupo del equipo (se revisa al atenderlo)
        pend.push({id: u.update_id, msg: m.message_id, cmd: cmd, texto: m.text, cuando: Date.now(), chat: privado ? m.chat.id : null, quien: privado && m.from ? m.from.id : null});
      });
      GM_setValue('tg_pend', pend);
      GM_setValue('tg_offset', ups[ups.length - 1].update_id + 1);
      atenderPendientes();
    }, function (e) { leyendo = false; botLog('no pude leer el grupo: ' + e); });
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
      ({canal: cambiarCanal, clave: function () { pedirClave(1); }, grupo: configurarGrupo, campana: abrirCampana, x: function () {}})[a.dataset.a]();
    };
    document.body.appendChild(p);
  }

  // ---------------------------------------------------------------- casos nuevos "por detrás" (respaldo)
  // Si nadie tiene la lista vigilada, igual se avisan al grupo los casos que entran: la pestaña que atiende
  // le pregunta a ServiceNow cada 30 s por los WOT de Mobisond abiertos en los últimos 15 min.
  // Usa la misma clave que el aviso de la lista (el sys_id), así Supabase no deja que salga dos veces.
  function casosPorDetras() {
    if (!hayGrupo() || !soyLider()) return;
    var ahora = Date.now();
    if (ahora - GM_getValue('ult_nuevos', 0) < 25000) return;
    GM_setValue('ult_nuevos', ahora);
    var q = 'active=true^opened_at>javascript:gs.minutesAgoStart(15)^assignment_group.nameSTARTSWITH' + GRUPOS.lineales +
            '^ORassignment_group.nameSTARTSWITH' + GRUPOS.gpon;
    api('wm_task', q, 'sys_id,number,parent,priority,cmdb_ci,short_description,opened_at').then(function (rs) {
      var avisados = GM_getValue('nuevos_avisados', {});
      Object.keys(avisados).forEach(function (k) { if (ahora - avisados[k] > 60 * 60000) delete avisados[k]; });
      rs.forEach(function (r) {
        var id = vl(r, 'sys_id');
        if (avisados[id]) return;
        avisados[id] = ahora;
        var f = {id: id, numero: woDe(r), link: linkCaso(r),
                 datos: {priority: dv(r, 'priority'), cmdb_ci: dv(r, 'cmdb_ci'), short_description: dv(r, 'short_description')}};
        botLog('caso nuevo (por detrás) ' + f.numero);
        unaVezAlGrupo(id, mensajeGrupo(f));
      });
      GM_setValue('nuevos_avisados', avisados);
    }, function (e) { console.log('[Mobisond] casos por detrás: ' + e.message); });
  }

  // ---------------------------------------------------------------- una pestaña "atiende" por PC
  // Los controles (25 min, SLA) y los comandos del bot no necesitan la lista vigilada: alcanza con cualquier
  // pestaña de ServiceNow abierta. Para no repetir, en cada PC los atiende una sola pestaña (la "líder");
  // si se cierra, otra toma la posta a los 15 s.
  function idPestaña() {
    var id = null;
    try { id = sessionStorage.getItem('mbs_tab'); } catch (e) {}
    if (!id) { id = 't' + Math.random().toString(36).slice(2, 9); try { sessionStorage.setItem('mbs_tab', id); } catch (e) {} }
    return id;
  }
  var MI_TAB = idPestaña();
  function soyLider() {
    if (window.top !== window.self) return false;      // solo la ventana principal (no los marcos de adentro)
    if (!token()) return false;                         // y que tenga la sesión de ServiceNow a mano para consultar
    var l = GM_getValue('lider', null), ahora = Date.now();
    if (!l || l.id === MI_TAB || ahora - l.t > 15000) { GM_setValue('lider', {id: MI_TAB, t: ahora}); return true; }
    return false;
  }

  // ---------------------------------------------------------------- cuándo revisar
  setTimeout(controles, 4000);
  setInterval(controles, 30000);
  setTimeout(comandos, 2000);
  setInterval(comandos, 5000);
  setInterval(soyLider, 5000);            // mantiene el turno de esta pestaña mientras esté abierta
  setTimeout(casosPorDetras, 6000);
  setInterval(casosPorDetras, 30000);
  if (!claveLista()) return;              // casos nuevos: solo en la lista vigilada
  revisar();
  var espera = null;
  new MutationObserver(function () {
    clearTimeout(espera);
    espera = setTimeout(revisar, 1500);
  }).observe(document.body, {childList: true, subtree: true});
  setInterval(revisar, 5000);
})();
