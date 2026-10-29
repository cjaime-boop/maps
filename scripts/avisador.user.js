// ==UserScript==
// @name         Mobisond · Avisador
// @namespace    mobisond
// @version      3.31
// @description  Avisa los casos nuevos (celular, campana y grupo de Telegram), los Lineales sin notas hace 25 min, los SLA y los aceptados; comandos del bot (/status, /bandeja, /autoasignar…).
// @match        https://*.service-now.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        unsafeWindow
// @grant        GM_setClipboard
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
  function tg(metodo, datos, ok, mal, intento) {
    GM_xmlhttpRequest({method: 'POST', url: 'https://api.telegram.org/bot' + GM_getValue('tg_token', '') + '/' + metodo,
      headers: {'Content-Type': 'application/json'}, data: JSON.stringify(datos || {}), timeout: 15000,
      onload: function (r) { var j = {}; try { j = JSON.parse(r.responseText); } catch (e) {}
        if (j.ok) { if (ok) ok(j.result); return; }
        // muchos mensajes juntos: Telegram pide esperar unos segundos -> se reintenta solo (hasta 3 veces)
        var espera = j.parameters && j.parameters.retry_after;
        if ((j.error_code === 429 || r.status === 429) && espera && (intento || 0) < 3) {
          setTimeout(function () { tg(metodo, datos, ok, mal, (intento || 0) + 1); }, (espera + 1) * 1000); return;
        }
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
  var DRAMA = ['Se terminó la paz 😩', 'Nadie lo pidió, pero llegó 🙃', 'Y justo cuando estaba todo tranquilo… 😬',
               'Atención, atención 📢', 'Agarrate que hay movimiento 🎢', 'El mate va a tener que esperar 🧉',
               '¿Alguien dijo fibra? 🧵', 'Otro más para la colección 📦', 'No es simulacro 🚨',
               'Que no cunda el pánico… todavía 😅', 'Café cargado y a la cancha ☕', 'Se cortó algo en algún lado ✂️'];
  function mensajeGrupo(f, prueba, extra) {
    var d = f.datos, prio = d.priority || '';
    var titulo = prueba ? '🧪 <b>Prueba de caso nuevo</b>'
                        : '🚨🚨 <b>¡Entró un caso!</b> 🚨🚨\n\n<i>' + DRAMA[Math.floor(Math.random() * DRAMA.length)] + '</i>';
    var pr = f.proyecto === 'GPON' ? '🟣 <b>GPON</b>' : f.proyecto === 'Lineales' ? '🔵 <b>Lineales</b>' : '';   // pedido de Iván
    var lineaPrio = prio ? '\n\n' + colorPrio(prio) + ' <b>' + esc(prio) + '</b>' + (/^1/.test(prio) && !prueba ? ' 🔥' : '') + (pr ? '  ·  ' + pr : '') : pr ? '\n\n' + pr : '';
    return titulo + lineaPrio + bloqueCaso(f.numero, d.cmdb_ci, d.short_description, f.link, extra);
  }
  // GPON: si el CI del caso nuevo (o las otras CTO de su rama) ya tuvieron casos en los últimos 90 días, se agrega al aviso
  // (con la causa del cierre). La rama es el nombre de la CTO sin el último número: GMRN-R0503-007 -> GMRN-R0503.
  function ramaDe(ci) { var m = /^(.+-[^-]+)-\d{1,4}$/.exec(String(ci || '').trim()); return m ? m[1] : ''; }
  function ctoCorta(ci) { return String(ci || ''); }      // la CTO completa (GMRN-R0503-008): el primer tramo es la zona
  var Q90 = '^opened_at>=javascript:gs.daysAgoStart(90)';
  function linkLista(q) { return location.origin + '/wm_task_list.do?sysparm_query=' + encodeURIComponent(q + '^ORDERBYDESCopened_at'); }
  // casos de una consulta, uno por WO, sin cancelados, del más nuevo al más viejo
  function casosDe(q, sacarWO) {
    return api('wm_task', q + '^ORDERBYDESCopened_at', 'sys_id,number,parent,opened_at,state,cmdb_ci').then(function (otros) {
      var vistos = {}, lista = [];
      if (sacarWO) vistos[sacarWO] = 1;
      otros.forEach(function (o) {
        if (/cancel/i.test(dv(o, 'state'))) return;           // los cancelados no cuentan
        var w = woDe(o); if (vistos[w]) return; vistos[w] = 1; lista.push(o);
      });
      return lista;
    });
  }
  // un renglón por caso: "• WO · dd/mm · (CTO) · causa del cierre". Igual que /caso: el formulario puede estar en las notas
  // de la WO o de la WOT, o en los campos de cierre. Los abiertos dicen "🟢 abierto".
  function renglonesCausa(lista, conCTO) {
    if (!lista.length) return Promise.resolve([]);
    var padres = lista.map(function (o) { return vl(o, 'parent'); }).filter(Boolean);
    return Promise.all([
      padres.length ? api('wm_order', 'sys_idIN' + padres.join(','), '').catch(function () { return []; }) : [],
      api('wm_task', 'sys_idIN' + lista.map(function (o) { return vl(o, 'sys_id'); }).join(','), '').catch(function () { return []; })
    ]).then(function (rr) {
      var porId = {}; rr[0].concat(rr[1]).forEach(function (w) { porId[vl(w, 'sys_id')] = w; });
      return lista.map(function (o) {
        var d = new Date(utc(vl(o, 'opened_at')));
        var regs = [porId[vl(o, 'parent')], porId[vl(o, 'sys_id')]];
        var fc = formularioCierre(regs) || {}, dc = datosCierre(regs);
        var c0 = fc['CAUSA DE LA AFECTACION'] || dc.causa.join(' · ');
        var cerrado = /cerrado|closed|resuelto|resolved|complet/i.test(dv(o, 'state'));
        var causa = c0 ? esc(c0) : cerrado ? 'sin formulario de cierre' : '🟢 abierto';
        return '• ' + esc(woDe(o)) + ' · ' + ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) +
               (conCTO ? ' · <b>' + esc(ctoCorta(dv(o, 'cmdb_ci'))) + '</b>' : '') + ' · ' + causa;
      });
    });
  }
  var LINEA = '━━━━━━━━━━━━━━';
  function antecedentesGPON(id) {
    var paso = api('wm_task', 'sys_id=' + id, 'sys_id,parent,cmdb_ci,assignment_group').then(function (rs) {
      var r = rs[0];
      if (!r || proyecto(r) !== 'GPON' || !vl(r, 'cmdb_ci')) return '';
      var ci = vl(r, 'cmdb_ci'), rama = ramaDe(dv(r, 'cmdb_ci'));
      var qCI = 'cmdb_ci=' + ci + Q90, qRama = rama ? 'cmdb_ci.nameSTARTSWITH' + rama + '-' + Q90 + '^cmdb_ci!=' + ci : '';
      return Promise.all([casosDe(qCI + '^sys_id!=' + id, woDe(r)), rama ? casosDe(qRama, woDe(r)).catch(function () { return []; }) : []]).then(function (x) {
        var mismo = x[0], deRama = x[1];
        return Promise.all([renglonesCausa(mismo.slice(0, 3), false), renglonesCausa(deRama.slice(0, 3), true)]).then(function (ls) {
          var t = '';
          if (mismo.length) {
            t += LINEA + '\n🔁🚨 <b>¡Posible reincidencia!</b> 🚨🔁\n\n<i>Este CI ya tuvo ' + (mismo.length === 1 ? 'otro caso' : mismo.length + ' casos') +
                 ' en los últimos 90 días 😱</i>\n\n' + ls[0].join('\n') +
                 (mismo.length > 3 ? '\n<i>… y ' + (mismo.length - 3) + ' más</i> · <a href="' + esc(linkLista(qCI)) + '">📋 Ver los ' + mismo.length + ' en ServiceNow</a>' : '') + '\n';
          }
          if (deRama.length) {
            t += LINEA + '\n🌿 <b>Misma rama (' + esc(rama) + ')</b>\n\n<i>Otras CTO de la rama tuvieron ' + (deRama.length === 1 ? '1 caso' : deRama.length + ' casos') +
                 ' en los últimos 90 días</i>\n\n' + ls[1].join('\n') +
                 (deRama.length > 3 ? '\n<i>… y ' + (deRama.length - 3) + ' más</i> · <a href="' + esc(linkLista(qRama)) + '">📋 Ver los ' + deRama.length + ' en ServiceNow</a> · <code>/rama ' + esc(rama) + '</code>' : '') + '\n';
          }
          return t ? t + LINEA + '\n' : '';
        });
      });
    }).catch(function () { return ''; });
    var limite = new Promise(function (ok) { setTimeout(function () { ok(''); }, 8000); });   // si tarda, el aviso sale igual
    return Promise.race([paso, limite]);
  }
  // /rama GMRN-R0503 (o una CTO: GMRN-R0503-007): todos los casos de la rama en los últimos 90 días, agrupados por CTO
  function textoRama(arg) {
    var a = String(arg || '').trim().toUpperCase();
    if (!a) return Promise.resolve('Decime la rama o una CTO: <code>/rama GMRN-R0503</code> o <code>/rama GMRN-R0503-007</code>');
    var rama = ramaDe(a) || a.replace(/-$/, '');
    var q = 'cmdb_ci.nameSTARTSWITH' + rama + '-' + Q90;
    return casosDe(q).then(function (lista) {
      if (!lista.length) return '🌿 <b>Rama ' + esc(rama) + '</b> · últimos 90 días\n\n<i>Ningún caso en esa rama.</i> Fijate que esté bien escrita (ej. <code>/rama GMRN-R0503</code>).';
      var muestra = lista.slice(0, 30);
      return renglonesCausa(muestra, false).then(function (rs) {
        var porCTO = {}, orden = [];
        muestra.forEach(function (o, i) {
          var c = dv(o, 'cmdb_ci') || 'sin CI';
          if (!porCTO[c]) { porCTO[c] = []; orden.push(c); }
          porCTO[c].push(rs[i]);
        });
        var total = {}; lista.forEach(function (o) { var c = dv(o, 'cmdb_ci') || 'sin CI'; total[c] = (total[c] || 0) + 1; });
        orden.sort(function (x, y) { return x < y ? -1 : x > y ? 1 : 0; });
        return '🌿 <b>Rama ' + esc(rama) + '</b> · últimos 90 días\n\n<i>' + lista.length + (lista.length === 1 ? ' caso' : ' casos') + ' en ' +
          Object.keys(total).length + (Object.keys(total).length === 1 ? ' CTO' : ' CTO') + '</i>\n\n' +
          orden.map(function (c) { return '<b>' + esc(ctoCorta(c)) + '</b> (' + total[c] + ')\n' + porCTO[c].join('\n'); }).join('\n\n') +
          (lista.length > 30 ? '\n\n<i>Muestro los 30 más nuevos de ' + lista.length + '.</i>' : '') +
          '\n\n🔗 <a href="' + esc(linkLista(q)) + '">Ver todos en ServiceNow</a>';
      });
    });
  }
  function avisoCasoNuevo(f) {
    // el proyecto (GPON / Lineales) sale del grupo de asignación; si la lista no lo trae, se pregunta (hasta 8 s)
    var proy = f.proyecto ? Promise.resolve(f.proyecto) : Promise.race([
      api('wm_task', 'sys_id=' + f.id, 'sys_id,assignment_group').then(function (rs) { return rs[0] ? proyecto(rs[0]) : ''; }).catch(function () { return ''; }),
      new Promise(function (ok) { setTimeout(function () { ok(''); }, 8000); })]);
    Promise.all([antecedentesGPON(f.id), proy]).then(function (x) {
      f.proyecto = x[1] || '';
      unaVezAlGrupo(f.id, mensajeGrupo(f, false, x[0] || ''));
    });
  }
  // Manda al grupo una sola vez por "clave", aunque varias PCs lo detecten (Supabase decide quién lo manda).
  function unaVezAlGrupo(clave, html, responderA, chatId, alTerminar, reintento, primero) {   // chatId: para contestar por privado (si no, al grupo)
    if (!hayGrupo()) return;
    var gane = false;
    var datos = {chat_id: chatId || GM_getValue('tg_chat'), text: html, parse_mode: 'HTML', disable_web_page_preview: true};
    if (responderA) datos.reply_to_message_id = responderA;
    var fin = alTerminar || function () {};
    var decidido = false;
    var mandar = function (por) {
      if (decidido) return; decidido = true;
      tg('sendMessage', datos, function () {
        botLog('mandado ' + clave.slice(0, 30) + (por ? ' (' + por + ')' : '')); fin(true);
      }, function (e) {
        botLog('Telegram no dejó mandar (' + clave.slice(0, 30) + '): ' + e);
        if (!/^cmd:/.test(clave)) {             // aviso que no salió: se suelta en Supabase y se reintenta en 1 min (hasta 3 veces)
          if (gane) sbRpc('bot_soltar', {p_aviso: clave}).catch(function () {});
          var n = (reintento || 0) + 1;
          if (n <= 3) {
            var cola = GM_getValue('tg_reintentos', []).filter(function (x) { return x.clave !== clave; });
            cola.push({clave: clave, html: html, chat: datos.chat_id, n: n, cuando: Date.now() + 60000, primero: primero || Date.now()});
            GM_setValue('tg_reintentos', cola.slice(-20));
          }
        }
        fin(false);
      });
    };
    // los comandos los lee una sola PC (Supabase o Telegram se los da a una): se contestan directo
    if (/^cmd:/.test(clave)) { mandar(); return; }
    // casos y alertas: Supabase hace de árbitro, solo la primera PC que lo pide lo manda.
    // Si Supabase no responde, se manda igual (mejor repetido que perdido).
    sbRpc('bot_reclamar', {p_aviso: clave, p_pc: pcId()}).then(function (gano) {
      if (gano === false) { decidido = true; botLog('ya lo mandó otra PC: ' + clave.slice(0, 30)); fin(true); return; }
      gane = true;
      mandar();
    }, function (e) { mandar('Supabase no respondió: ' + e.message); });
  }
  // avisos que Telegram no dejó mandar: la pestaña que atiende los reintenta (sobreviven a las recargas)
  function reintentarAvisos() {
    var cola = GM_getValue('tg_reintentos', []);
    if (!cola.length) return;
    // un aviso que no pudo salir en 5 minutos ya quedó viejo (el caso pudo cambiar): se descarta, no se manda tarde
    var ahora = Date.now(), vigente = function (x) { return ahora - (x.primero || 0) < 5 * 60000; };
    var listos = cola.filter(function (x) { return x.cuando <= ahora && vigente(x); });
    var viejos = cola.filter(function (x) { return !vigente(x); });
    GM_setValue('tg_reintentos', cola.filter(function (x) { return x.cuando > ahora && vigente(x); }));
    viejos.forEach(function (x) { botLog('descarto aviso viejo: ' + x.clave.slice(0, 30)); });
    listos.forEach(function (x) { botLog('reintento ' + x.n + ': ' + x.clave.slice(0, 30)); unaVezAlGrupo(x.clave, x.html, null, x.chat, null, x.n, x.primero); });
  }
  function alGrupo(f) { botLog('caso nuevo ' + f.numero); avisoCasoNuevo(f); }
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
  GM_registerMenuCommand('🔔 Vigilar esta lista (Pending Dispatch)', function () {
    var k = claveLista();
    if (!k) { alert('Abrí la lista de ServiceNow (la de Pending Dispatch) y volvé a elegir esta opción.'); return; }
    GM_setValue('lista', k);
    GM_setValue('lista_titulo', (document.title || '').replace(/^(\(\d+ s\)|\(⏸\)|\(sin conexión\))\s*/, '').replace(/^(🔔 |🔊 |🔇 |🤖 Bot · )+/, '').replace(/\s*\|\s*ServiceNow\s*$/i, '').trim());
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
  // Probar todo: celular (ntfy), campana, notificación de la PC y grupo. Devuelve el texto para mostrar.
  function probarTodo() {
    var f = (filas() || [])[0] || {numero: 'WO0000000', datos: {short_description: 'Caso de prueba'}, link: location.href};
    aviso('Entró ' + f.numero + ' (prueba)', texto(f), f.link, 4);
    if (hayGrupo()) tg('sendMessage', {chat_id: GM_getValue('tg_chat'), text: mensajeGrupo(f, true), parse_mode: 'HTML', disable_web_page_preview: true},
                       null, function (e) { alert('El grupo de Telegram no anduvo: ' + e); });
    return 'Prueba mandada. Fijate que llegue al celular (ntfy), a la campana y al grupo de Telegram' +
           (hayGrupo() ? '.' : ' (el grupo NO está configurado en esta PC).') + ' Alexa se prueba desde su propia configuración.';
  }
  // Revisar bot: diagnóstico (versión, pestaña, grupo, webhook y lo último que hizo el bot). Llama a listo(texto).
  function revisarBot(listo) {
    var info = ['Versión ' + (typeof GM_info !== 'undefined' ? GM_info.script.version : '?'), 'Pestaña vigilada: ' + (vigilada() ? 'SÍ' : 'NO'), 'Esta pestaña atiende avisos y bot: ' + (soyLider() ? 'SÍ' : 'NO') + (meRefresca() ? ' (es la que recarga el Refrescador)' : '') + (noAtiende() ? ' (se le sacó con "Dejar de vigilar")' : ''), 'Grupo guardado: ' + (GM_getValue('tg_chat', '') || 'ninguno'),
                'Token: ' + (GM_getValue('tg_token', '') ? 'cargado' : 'falta'), 'Último leído: ' + GM_getValue('tg_offset', 0)];
    var log = function () { info.push('', 'Lo último que hizo el bot:'); GM_getValue('tg_log', []).forEach(function (l) { info.push('  ' + l); }); };
    tg('getWebhookInfo', {}, function (w) {
      info.push('Webhook: ' + (w.url ? w.url : 'no') + (w.last_error_message ? '\nÚltimo error de Telegram: ' + w.last_error_message : '') +
                (w.pending_update_count ? '\nPendientes en Telegram: ' + w.pending_update_count : ''));
      if (w.url) { log(); listo(info.join('\n')); return; }
      tg('getUpdates', {timeout: 0, allowed_updates: ['message']}, function (ups) {
        info.push('Mensajes pendientes: ' + ups.length);
        ups.slice(-3).forEach(function (u) { var m = u.message || {}; info.push('  #' + u.update_id + ' ' + (m.chat ? m.chat.id + ' ' + (m.chat.title || '') : '') + ': ' + (m.text || '(sin texto)')); });
        log(); listo(info.join('\n'));
      }, function (e) { info.push('getUpdates ERROR: ' + e); listo(info.join('\n')); });
    }, function (e) { info.push('Telegram ERROR: ' + e); listo(info.join('\n')); });
  }
  // "Dejar de vigilar" le saca a ESTA pestaña la lista y el bot (queda anotado en la pestaña, sobrevive a las recargas).
  // Vuelve a atender si se elige "Vigilar bot" en ella.
  function noAtiende() { try { return !!sessionStorage.getItem('mbs_no_bot'); } catch (e) { return false; } }
  GM_registerMenuCommand('🤖 Vigilar bot (esta pestaña)', function () {
    if (window.top !== window.self || !token()) { alert('Esta pestaña no puede atender el bot (no tiene la sesión de ServiceNow a mano).'); return; }
    try { sessionStorage.removeItem('mbs_no_bot'); } catch (e) {}
    GM_setValue('bot_elegida', MI_TAB);
    GM_setValue('lider', {id: MI_TAB, t: Date.now(), refresca: meRefresca()});
    soyLider();
    alert('🤖 Listo: esta pestaña atiende el bot y los avisos.' + (meRefresca() ? '\n\nOjo: es la que recarga el Refrescador; las consultas largas se pueden cortar.' : '') +
          '\n\nSi la cerrás, otra pestaña toma la posta sola.');
  });
  GM_registerMenuCommand('🚫 Dejar de vigilar', function () {
    var lista = vigilada(), bot = GM_getValue('bot_elegida', '') === MI_TAB || (GM_getValue('lider', {}) || {}).id === MI_TAB;
    if (lista) GM_setValue('lista', '');
    try { sessionStorage.setItem('mbs_no_bot', '1'); } catch (e) {}
    if (GM_getValue('bot_elegida', '') === MI_TAB) GM_setValue('bot_elegida', '');
    if ((GM_getValue('lider', {}) || {}).id === MI_TAB) GM_setValue('lider', null);   // otra pestaña o PC lo toma enseguida
    marcarTitulo(false);
    alert('🚫 Listo: esta pestaña ya no vigila' + (lista ? ' la lista' : '') + (lista && bot ? ' ni' : '') + (bot ? ' el bot' : '') + (!lista && !bot ? ' nada (no estaba vigilando)' : '') + '.' +
          (bot ? '\n\nEl bot lo toma sola otra pestaña o PC con ServiceNow abierto.' : '') +
          '\n\nPara volver: "Vigilar esta lista" o "🤖 Vigilar bot" en el menú.');
  });
  GM_registerMenuCommand('⚙️ Configuración', configuracion);

  // ---------------------------------------------------------------- controles al grupo de Telegram
  // Cada 2 minutos (desde la pestaña que atiende en cada PC) se consulta ServiceNow por detrás:
  //  1) Lineales (y GPON P1/P2) en curso, sin pausa, sin notas de trabajo DE MOBISOND hace 25 min -> avisa UNA vez (hasta que haya otra nota).
  //  2) Lineales y GPON en curso, con el SLA NETO corriendo y a 1 hora o menos de vencer -> avisa una vez.
  //  3) Lineales y GPON en curso, cuando se les vence el SLA NETO -> avisa una vez.
  //  4) Lineales y GPON, cuando un caso pasa a "Aceptado por el cliente" -> avisa una vez.
  //  5) Lineales y GPON, cuando el cliente NO acepta (sale de Verificación del cliente y vuelve a trabajo) -> avisa una vez.
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
      if (r.status === 401) sesionPerdida();
      if (!r.ok) throw new Error('ServiceNow ' + r.status);
      sesionOk();
      return r.json();
    }).then(function (j) { return j.result || []; });
  }
  // ---- sesión de ServiceNow vencida: la PC deja de atender. Si hay otra PC con sesión, sigue esa sin avisar nada;
  // si no queda ninguna, a los 10 min Supabase avisa al grupo "Se perdió la conexión a ServiceNow" (y "Volvió" al volver).
  function sesionCaida() { var c = GM_getValue('sn_caida', 0); return !!c; }
  function sesionPerdida() {
    if (GM_getValue('sn_caida', 0)) return;
    GM_setValue('sn_caida', Date.now());
    botLog('se cerró la sesión de ServiceNow (401): esta PC deja de atender');
  }
  function sesionOk() {
    var c = GM_getValue('sn_caida', 0);
    if (!c) return;
    GM_setValue('sn_caida', 0);
    botLog('volvió la sesión de ServiceNow (estuvo caída ' + Math.round((Date.now() - c) / 60000) + ' min)');
  }
  // con la sesión caída, cada 1 min se prueba una consulta chiquita para saber cuándo vuelve
  setInterval(function () {
    if (!sesionCaida() || window.top !== window.self || !token()) return;
    api('sys_user', 'sys_idISNOTEMPTY^ORDERBYsys_id', 'sys_id').catch(function () {});
  }, 60000);
  function dv(r, c) { var v = r[c]; return v ? (v.display_value || '') : ''; }
  function vl(r, c) { var v = r[c]; return v ? (v.value || '') : ''; }
  function utc(t) { return t ? new Date(t.replace(' ', 'T') + 'Z').getTime() : 0; }
  function hhmm(ms) { var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function enCurso(r) { return /work in progress|en curso/i.test(dv(r, 'state')); }
  function pausado(r) {                // manda el subestado ("Paused"/"En pausa"); si no viene, el motivo de pausa
    var sub = dv(r, 'substate');
    return sub ? /paus/i.test(sub) : !!dv(r, 'u_pause_reason').trim();
  }
  // Estado "Aceptado" / "En camino": el técnico ya tomó el caso (no está sin atender). Ojo: es el ESTADO,
  // distinto del motivo de pausa "Aceptado por el cliente".
  function enCamino(r) { return /^(accepted|aceptad[oa]|on travel|travel|en camino|en viaje|de viaje|viajando|en route|on route|in route|en ruta)\b/i.test(dv(r, 'state').trim()); }   // "Accepted" / "On Travel" (inglés) o "Aceptado" / "En camino" / "En viaje" (español)
  // "Aceptado por el cliente": el caso sigue En curso pero ya está resuelto, esperando el cierre
  function aceptado(r) { var t = dv(r, 'u_pause_reason') + ' ' + dv(r, 'substate'); return /acept/i.test(t) && !/no acept/i.test(t); }   // ojo: "No aceptado por el cliente" es un rechazo
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
    while ((m = re.exec(t || ''))) out.push({t: fechaJournal(m[1]), quien: m[2].trim(), st: m.index, ini: re.lastIndex});
    out.forEach(function (n, i) {      // el texto de cada nota: desde su encabezado hasta el siguiente
      n.txt = (t || '').slice(n.ini, i + 1 < out.length ? out[i + 1].st : undefined)
        .replace(/\[\/?code\]|<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    });
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
    var falloWO = null;               // si no se pudieron leer las notas de la WO, no se sabe nada: no se avisa con datos a medias
    var sumar = function (wo, n) { if (n && n.t && esNuestro(n.quien) && (!mejor[wo] || n.t > mejor[wo].t)) mejor[wo] = n; };
    var porTexto = api('wm_order', 'sys_idIN' + padres.join(','), 'sys_id,work_notes,comments').then(function (wos) {
      wos.forEach(function (w) {
        notasDelTexto(dv(w, 'work_notes') + '\n' + dv(w, 'comments')).forEach(function (n) { sumar(vl(w, 'sys_id'), n); });
      });
    }, function (e) { falloWO = e; console.log('[Mobisond] notas (WO): ' + e.message); });
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
      if (falloWO) throw new Error('no pude leer las notas de la WO (' + falloWO.message + ')');
      var u = {};
      Object.keys(mejor).forEach(function (p) { (dePadre[p] || []).forEach(function (id) { u[id] = mejor[p]; }); });
      return u;
    });
  }

  // ---- Casos abiertos para el panel de QGIS: la PC que atiende el bot sube la bandeja a Supabase cada 2 min
  function coordsDeNota(txt) {                 // la ÚLTIMA ubicación escrita en la nota (pases de turno con varias): [lat, lon, tipo]
    var arg = function (a, b) { return a < -21 && a > -56 && b < -53 && b > -74; }, mejor = null, m;
    var probar = function (re, tipo) {
      re.lastIndex = 0;
      while ((m = re.exec(txt))) if (arg(+m[1], +m[2]) && (!mejor || m.index >= mejor.i) &&
               !(mejor && mejor.c[0] === +m[1] && mejor.c[1] === +m[2])) mejor = {i: m.index, c: [+m[1], +m[2], tipo]};   // la misma del link: queda como link
    };
    probar(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/g, 'maps');
    probar(/(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)[^\s"']*?(?:[@=]|q=|ll=|query=)(-?\d{1,2}\.\d{3,})(?:,|%2C)\s*(-?\d{1,3}\.\d{3,})/gi, 'maps');
    probar(/(-\d{2}\.\d{4,})\s*[,; ]\s*(-\d{2}\.\d{4,})/g, 'coordenadas');
    return mejor ? mejor.c : null;
  }
  // Campo "Latitud y longitud" del caso: se averigua solo qué campo es (una vez cada 3 días) mirando una WOT completa
  var RE_LATLON = /latitud|latitude|longitud|longitude|coordenad|(^|_)(lat|lon|lng)(_|$)/i;
  function camposLatLon() { var c = GM_getValue('latlon_campos', null); return c && c.campos ? c : null; }
  function averiguarLatLon(r) {
    var c = GM_getValue('latlon_campos', null);
    if (c && Date.now() - c.t < (c.campos.length ? 3 : 1) * 86400000) return;
    GM_setValue('latlon_campos', {t: Date.now(), tabla: 'wm_task', campos: []});
    var mirar = function (tabla, id) {
      return api(tabla, 'sys_id=' + id, '').then(function (x) { return Object.keys(x[0] || {}).filter(function (k) { return RE_LATLON.test(k); }).slice(0, 4); });
    };
    mirar('wm_task', vl(r, 'sys_id')).then(function (ks) {
      if (ks.length || !vl(r, 'parent')) return {tabla: 'wm_task', campos: ks};
      return mirar('wm_order', vl(r, 'parent')).then(function (k2) { return {tabla: 'wm_order', campos: k2}; });
    }).then(function (res) { res.t = Date.now(); GM_setValue('latlon_campos', res); botLog('latitud/longitud del caso: ' + (res.campos.join(', ') || 'no encontré el campo')); },
            function () {});
  }
  function latLonDeTexto(t) {          // "-34.58648, -58.846" / "-34,58648 ; -58,846" -> [lat, lon] en Argentina
    var ns = (String(t || '').match(/-?\d{1,3}[.,]\d{3,}/g) || []).map(function (x) { return +x.replace(',', '.'); });
    var lat = ns.filter(function (n) { return n < -21 && n > -56; })[0], lon = ns.filter(function (n) { return n < -56 && n > -74 || (n < -53 && n > -74 && n !== lat); })[0];
    return lat != null && lon != null ? [lat, lon] : null;
  }
  function subirBandeja(casos) {
    var padres = [], ids = [];
    casos.forEach(function (r) { ids.push(vl(r, 'sys_id')); if (vl(r, 'parent')) { ids.push(vl(r, 'parent')); if (padres.indexOf(vl(r, 'parent')) < 0) padres.push(vl(r, 'parent')); } });
    var avisoNotas = '', deCache = 0;
    var extraLL = (camposLatLon() || {}).tabla === 'wm_order' && camposLatLon().campos.length ? ',' + camposLatLon().campos.join(',') : '';
    // mientras se leen las notas, el refrescador no recarga la pestaña (si recarga en el medio, la lectura se corta)
    var marca = String(Date.now()), marcada = false;
    try { if (!localStorage.getItem('mobisond_ocupado')) { localStorage.setItem('mobisond_ocupado', marca); marcada = true; } } catch (e) {}
    var soltar = function () { try { if (marcada && localStorage.getItem('mobisond_ocupado') === marca) localStorage.removeItem('mobisond_ocupado'); } catch (e) {} };
    var esperar = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    // las notas de las WO: si falla, se reintenta (sin los campos extra, después de a 5 WO); si igual falla, se usan las
    // últimas notas leídas bien de cada WO (guardadas) y QGIS avisa solo si faltan
    var leerWOs = function () {
      if (!padres.length) return Promise.resolve([]);
      return api('wm_order', 'sys_idIN' + padres.join(','), 'sys_id,work_notes,comments' + extraLL).catch(function (e1) {
        return esperar(3000).then(function () { return api('wm_order', 'sys_idIN' + padres.join(','), 'sys_id,work_notes,comments'); })
          .catch(function () {
            var tandas = [], i;
            for (i = 0; i < padres.length; i += 5) tandas.push(padres.slice(i, i + 5));
            return Promise.all(tandas.map(function (t) { return api('wm_order', 'sys_idIN' + t.join(','), 'sys_id,work_notes,comments'); }))
              .then(function (rs) { return [].concat.apply([], rs); });
          })
          .catch(function (e2) { avisoNotas = 'No pude leer las notas de las WO (' + ((e2 && e2.message) || (e1 && e1.message) || 'error') + ')'; return null; });
      });
    };
    Promise.all([
      leerWOs(),
      ids.length ? api('task_sla', 'active=true^taskIN' + ids.join(','), 'task,sla,stage,has_breached,planned_end_time,business_time_left').catch(function () { return []; }) : []
    ]).then(function (res) {
      var notasDe = {}, slaDe = {};
      var woRec = {};
      soltar();
      var cache = GM_getValue('notas_cache', {});
      if (res[0] === null) {                       // no se pudieron leer: las últimas que se leyeron bien
        padres.forEach(function (p) { if (cache[p]) { notasDe[p] = cache[p].n; deCache++; } });
        if (deCache === padres.length) avisoNotas = '';
        res[0] = [];
      }
      res[0].forEach(function (w) { woRec[vl(w, 'sys_id')] = w; notasDe[vl(w, 'sys_id')] = notasDelTexto(dv(w, 'work_notes') + '\n' + dv(w, 'comments')); });
      if (res[0].length) {                          // se guardan (las últimas 6 de cada WO abierta) para la próxima vez
        var nuevo = {};
        padres.forEach(function (p) {
          var ns = notasDe[p] ? notasDe[p].slice().sort(function (a, b) { return b.t - a.t; }).slice(0, 6)
            .map(function (n) { return {t: n.t, quien: n.quien, txt: (n.txt || '').slice(0, 600)}; }) : null;
          if (ns) nuevo[p] = {n: ns, t: Date.now()}; else if (cache[p]) nuevo[p] = cache[p];
        });
        GM_setValue('notas_cache', nuevo);
      }
      if (!avisoNotas && !deCache && padres.length) {
        var conTexto = res[0].filter(function (w) { return (dv(w, 'work_notes') + dv(w, 'comments')).trim(); }).length;
        var leidas = Object.keys(notasDe).filter(function (k) { return notasDe[k].length; }).length;
        if (!res[0].length) avisoNotas = 'ServiceNow no devolvió las WO (' + padres.length + ' pedidas)';
        else if (!conTexto) avisoNotas = 'Las WO llegaron sin notas (¿permisos de la sesión?)';
        else if (!leidas) avisoNotas = 'No entendí el formato de las notas: ' + (dv(res[0][0], 'work_notes') || '').slice(0, 60);
      }
      if (avisoNotas) botLog('casos abiertos: ' + avisoNotas);
      var ll = camposLatLon();
      var latLonCaso = function (r) {                // si las notas no traen coordenadas: el campo del caso
        if (!ll || !ll.campos.length) return null;
        var rec = ll.tabla === 'wm_order' ? woRec[vl(r, 'parent')] : r;
        if (!rec) return null;
        return latLonDeTexto(ll.campos.map(function (k) { return (vl(rec, k) || dv(rec, k) || ''); }).join(' ; '));
      };
      res[1].forEach(function (x) { if (/neto/i.test(dv(x, 'sla')) && !/cancel/i.test(vl(x, 'stage'))) slaDe[vl(x, 'task')] = x; });
      var lista = casos.map(function (r) {
        var ns = (notasDe[vl(r, 'parent')] || []).slice().sort(function (a, b) { return b.t - a.t; });
        var nuestra = ns.filter(function (n) { return esNuestro(n.quien); })[0];
        var ubic = null;
        ns.some(function (n) { var c = coordsDeNota(n.txt || ''); if (c) ubic = {lat: c[0], lon: c[1], fuente: c[2], t: n.t}; return !!c; });
        var lc = ubic ? null : latLonCaso(r);       // el campo del caso va aparte: QGIS lo usa como último recurso
        var sla = slaDe[vl(r, 'sys_id')] || slaDe[vl(r, 'parent')];
        var estado = enCamino(r) ? 'camino' : !enCurso(r) ? 'sin' : aceptado(r) ? 'aceptado' :
                     pausado(r) && /verificaci/i.test(dv(r, 'u_pause_reason')) ? 'verif' : pausado(r) ? 'pausado' : 'curso';
        return {
          wo: woDe(r), wot: dv(r, 'number'), ci: dv(r, 'cmdb_ci'), proyecto: proyecto(r),
          prio: vl(r, 'priority'), prio_txt: dv(r, 'priority'), estado: estado, estado_txt: dv(r, 'state'),
          motivo: dv(r, 'u_pause_reason'), tecnico: dv(r, 'assigned_to'), abierto: utc(vl(r, 'opened_at')) || null,
          link: linkCaso(r), descripcion: dv(r, 'short_description'),
          sla: sla ? {vence: utc(vl(sla, 'planned_end_time')) || null, vencido: vl(sla, 'has_breached') === 'true',
                      pausado: /paus/i.test(vl(sla, 'stage') + dv(sla, 'stage')), resta: dv(sla, 'business_time_left')} : null,
          nota: nuestra ? {t: nuestra.t, quien: nuestra.quien, txt: (nuestra.txt || '').slice(0, 160)} : null,
          ubic: ubic, latlon_caso: lc ? {lat: lc[0], lon: lc[1], fuente: 'caso'} : null,
          aviso_notas: avisoNotas || null, pc: pcId()
        };
      });
      return sbRpc('bot_casos_abiertos', {p_pc: pcId(), p_casos: lista});
    }).catch(function (e) { soltar(); console.log('[Mobisond] casos abiertos (QGIS): ' + (e && e.message)); });   // si la tabla no existe, no pasa nada
  }

  function controles() {
    if (!hayGrupo() || !soyLider()) return;
    var ahora = Date.now();
    if (ahora - GM_getValue('ult_control', 0) < CADA_MS) return;      // la pestaña se recarga cada 30 s: se controla cada 2 min
    // PC que vuelve después de más de 10 min sin controlar (apagada, sin sesión): esta vuelta solo anota, no avisa
    // cambios de prioridad / aceptados / no aceptados viejos
    var ausente = ahora - GM_getValue('ult_control', 0) > 10 * 60000;
    GM_setValue('ult_control', ahora);
    var q = 'active=true^assignment_group.nameSTARTSWITH' + GRUPOS.lineales + '^ORassignment_group.nameSTARTSWITH' + GRUPOS.gpon;
    var campos = 'sys_id,number,parent,state,substate,u_pause_reason,priority,assignment_group,assigned_to,cmdb_ci,short_description,work_start,opened_at';
    var ll = camposLatLon();
    if (ll && ll.tabla === 'wm_task' && ll.campos.length) campos += ',' + ll.campos.join(',');
    api('wm_task', q, campos).then(function (casos) {
      if (casos.length) averiguarLatLon(casos[0]);
      subirBandeja(casos);
      // CAMBIO DE PRIORIDAD (todos los abiertos, también los que todavía no están en curso). La primera vez solo se anotan.
      var prios = GM_getValue('prio_vistos', {}), prioIni = GM_getValue('prio_iniciado', false), priosNuevo = {};
      casos.forEach(function (r) {
        var id = vl(r, 'sys_id'), p = vl(r, 'priority'), txt = dv(r, 'priority');
        priosNuevo[id] = {v: p, t: txt};
        var antes = prios[id];
        if (prioIni && !ausente && antes && antes.v && p && antes.v !== p) {
          var sube = +p < +antes.v;
          unaVezAlGrupo('prio:' + id + ':' + antes.v + '>' + p,
            '🔀 <b>Cambió la prioridad</b> ' + (sube ? '⬆️' : '⬇️') + '\n\n' +
            colorPrio(antes.t || antes.v) + ' ' + esc(antes.t || antes.v) + ' → ' + colorPrio(txt || p) + ' ' + esc(txt || p) +
            (/^1/.test(txt || p) ? ' 🔥' : '') + cuerpo(r));
        }
      });
      GM_setValue('prio_vistos', priosNuevo);
      GM_setValue('prio_iniciado', true);
      var todos = casos;                 // los avisos de SLA miran todos los abiertos, no solo los "en curso"
      casos = casos.filter(enCurso);
      // pausas y entrada a "en curso" vistas desde esta PC (para empezar a contar los 25 min desde que se retoma)
      var visto = GM_getValue('ctl_visto', {}), nuevoVisto = {};
      var enVerif = function (r) { return /verificaci/i.test(dv(r, 'u_pause_reason')) && pausado(r); };
      casos.forEach(function (r) {
        var id = vl(r, 'sys_id'), antes = visto[id], v = antes ? {desde: antes.desde, pausa: antes.pausa, verif: antes.verif} : {desde: ahora, pausa: 0};
        if (pausado(r)) v.pausa = ahora;
        // NO ACEPTADO: estaba en Verificación del cliente y ahora volvió a trabajo (sin pausa) o dice "No aceptado"
        var noAcept = /no acept/i.test(dv(r, 'u_pause_reason'));
        if (!ausente && ((antes && antes.verif && !enVerif(r) && !aceptado(r) && (!pausado(r) || noAcept)) || (noAcept && antes && !antes.noAcept))) {
          unaVezAlGrupo('rech:' + id + ':' + Math.floor(ahora / 1800000),
            '❌ <b>El cliente no aceptó el caso</b>\n\n<i>Vuelve a estar en curso</i>' + cuerpo(r, '👷 ' + esc(dv(r, 'assigned_to') || 'sin asignar')));
        }
        v.verif = enVerif(r); v.noAcept = noAcept;
        nuevoVisto[id] = v;
      });
      GM_setValue('ctl_visto', nuevoVisto);

      // 0) casos que pasaron a "Aceptado por el cliente" (Lineales y GPON). La primera vez solo se anotan los que ya estaban.
      var acept = GM_getValue('acept_vistos', {}), primeraVez = !GM_getValue('acept_iniciado', false) || ausente, aceptNuevo = {};
      casos.filter(aceptado).forEach(function (r) {
        var id = vl(r, 'sys_id');
        aceptNuevo[id] = acept[id] || ahora;
        if (!acept[id] && !primeraVez) {
          unaVezAlGrupo('acept:' + id, '✅ <b>¡Caso aceptado por el cliente!</b> 🎉' + cuerpo(r, '👷 ' + esc(dv(r, 'assigned_to') || 'sin asignar')));
        }
      });
      GM_setValue('acept_vistos', aceptNuevo);
      GM_setValue('acept_iniciado', true);

      // 1) sin notas de trabajo: P1 y P2 de Lineales y GPON, sin pausa ni aceptados
      var p12 = function (r) { return /^[12]$/.test(vl(r, 'priority')) || /^[12]\b/.test(dv(r, 'priority')); };
      var lin = casos.filter(function (r) {
        return (proyecto(r) === 'Lineales' || proyecto(r) === 'GPON') && p12(r) && !pausado(r) && !aceptado(r);   // solo P1 y P2
      });
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
      }, function (e) { botLog('25 min: no avisé, ' + e.message + ' (reintento en la próxima vuelta)'); });

      // 2) SLA neto a 1 hora de vencer y vencido (Lineales y GPON): cualquier estado del caso, solo P1 a P3, solo con el SLA corriendo
      var p123 = function (r) { return /^[123]$/.test(vl(r, 'priority')) || /^[123]\b/.test(dv(r, 'priority')); };
      var porId = {};
      todos.filter(p123).forEach(function (r) { porId[vl(r, 'sys_id')] = r; if (vl(r, 'parent')) porId[vl(r, 'parent')] = r; });
      if (!Object.keys(porId).length) return;
      api('task_sla', 'active=true^taskIN' + Object.keys(porId).join(','), 'sys_id,task,sla,stage,has_breached,planned_end_time,original_breach_time')
        .then(function (slas) {
          slas.forEach(function (s) {
            if (!/neto/i.test(dv(s, 'sla'))) return;                         // solo el SLA NETO
            var r = porId[vl(s, 'task')]; if (!r) return;
            if (/paus/i.test(vl(s, 'stage') + dv(s, 'stage'))) return;       // SLA pausado: no avisa
            // se venció: aviso una vez (solo si se venció hace menos de 30 min, para no avisar de golpe los viejos)
            if (vl(s, 'has_breached') === 'true') {
              var cuando = utc(vl(s, 'original_breach_time') || vl(s, 'planned_end_time'));
              if (cuando && ahora - cuando < 30 * 60000) {
                unaVezAlGrupo('venc:' + vl(s, 'sys_id'), '🔴 <b>SLA neto vencido</b> · ' + hhmm(cuando) + cuerpo(r));
              }
              return;
            }
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
  // "/bandeja gpon" o "/bandeja lineales" (también tl / lin): solo ese proyecto. Sin nada: los dos.
  function filtroBandeja(texto) {
    var a = String(texto || '').toLowerCase().split(/\s+/).slice(1).join(' ');
    return /gpon/.test(a) ? 'GPON' : /lin|^tl\b|\btl\b/.test(a) ? 'Lineales' : '';
  }
  function textoBandeja(solo) {
    var q = 'active=true^assignment_group.nameSTARTSWITH' + GRUPOS.lineales + '^ORassignment_group.nameSTARTSWITH' + GRUPOS.gpon;
    return api('wm_task', q, 'sys_id,number,parent,state,substate,u_pause_reason,assignment_group,assigned_to,cmdb_ci').then(function (casos) {
      var out = ['📋 <b>Bandeja' + (solo ? ' ' + solo : '') + '</b> · ' + hhmm(Date.now())];
      (solo ? [solo] : ['Lineales', 'GPON']).forEach(function (pr) {
        var cs = casos.filter(function (r) { return proyecto(r) === pr; });
        var curso = [], verif = [], pausa = [], sin = [], acep = [], camino = [];
        cs.forEach(function (r) {
          var motivo = dv(r, 'u_pause_reason').trim();
          if (enCamino(r)) camino.push(r);
          else if (!enCurso(r)) sin.push(r);
          else if (aceptado(r)) acep.push(r);
          else if (pausado(r) && /verificaci/i.test(motivo)) verif.push(r);
          else if (pausado(r)) pausa.push(r);
          else curso.push(r);
        });
        var fila = function (r, abajo, alLado) {      // WO en negrita; abajo con sangría el CI y (en cursiva) el detalle
          var t = '• <b>' + esc(woDe(r)) + '</b>\n   ' + esc(dv(r, 'cmdb_ci') || 'sin CI') + (alLado ? ' · <i>' + esc(alLado) + '</i>' : '');
          if (abajo) t += '\n   <i>' + esc(abajo) + '</i>';
          return t;
        };
        var grupo = function (titulo, lista, abajo, alLado) {
          if (!lista.length) return;
          out.push('', '<b>' + titulo + ' (' + lista.length + ')</b>');
          lista.forEach(function (r) { out.push(fila(r, abajo && abajo(r), alLado && alLado(r))); });
        };
        if (pr === 'GPON' && !solo) out.push('', '━━━━━━━━━━━━━━━━━━━━');      // separador entre Lineales y GPON
        out.push('', (pr === 'Lineales' ? '🔧' : '📡') + ' <b>' + pr + '</b>', '', cs.length + (cs.length === 1 ? ' abierto' : ' abiertos'));
        if (!cs.length) return;
        grupo('▶️ En curso', curso, function (r) { return dv(r, 'assigned_to'); });
        grupo('🚗 Aceptados / En camino', camino, function (r) { return dv(r, 'state') + ' · ' + (dv(r, 'assigned_to') || 'sin asignar'); });
        grupo('⏸️ Pausados', pausa, function (r) { return dv(r, 'u_pause_reason'); });
        grupo('🔍 Verificación del cliente', verif);
        grupo('✅ Aceptados por el cliente', acep);
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
    var latido = null;
    var listo = function (que) {
      atenderPendientes.ocupado = false;
      if (latido) clearInterval(latido);
      try { localStorage.removeItem('mobisond_ocupado'); } catch (e) {}
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
    // pedido largo en curso: Supabase no se lo da a otra PC y el refrescador no recarga la pestaña en el medio
    try { localStorage.setItem('mobisond_ocupado', String(Date.now())); } catch (e) {}
    if (p.sb) latido = setInterval(function () { sbRpc('bot_sigo', {p_id: p.id, p_pc: pcId()}).catch(function () {}); }, 20000);
    if (p.cmd === '/rama') {
      textoRama((p.texto || '').trim().split(/\s+/).slice(1).join(' ')).then(function (t) {
        unaVezAlGrupo('cmd:' + p.id, t, p.msg, p.chat, function (ok) { listo(ok ? 'contestado' : 'no se pudo contestar'); });
      }, function (e) { unaVezAlGrupo('cmd:' + p.id, 'No pude leer la rama de ServiceNow (' + esc(e.message) + ').', p.msg, p.chat); listo('error ServiceNow ' + e.message); });
      return;
    }
    if (p.cmd === '/caso') {
      textoCaso((p.texto || '').trim().split(/\s+/)[1]).then(function (t) {
        unaVezAlGrupo('cmd:' + p.id, t, p.msg, p.chat, function (ok) { listo(ok ? 'contestado' : 'no se pudo contestar'); });
      }, function (e) { unaVezAlGrupo('cmd:' + p.id, 'No pude leer el caso de ServiceNow (' + esc(e.message) + ').', p.msg, p.chat); listo('error ServiceNow ' + e.message); });
      return;
    }
    if (p.cmd === '/semana') {
      var fs = fechaDeTexto((p.texto || '').trim().split(/\s+/).slice(1).join(' '));
      // /semana a mano = semana en curso; el automático de los lunes (pedido sin mensaje) = semana pasada
      var automatico = p.id < 0 && !p.msg;
      var hoySem = new Date(); hoySem.setHours(0, 0, 0, 0);
      var semanaTxt = fs === 'mal' ? Promise.resolve('No entendí la fecha. Usalo así: <code>/semana 13-10-2026</code>')
        : fs && fs > hoySem ? Promise.resolve('Esa fecha todavía no llegó 🙂')
        : (RESUMEN.limpiarGraf(), RESUMEN.semana(fs || (automatico ? undefined : hoySem)));
      semanaTxt.then(function (t) {
        conGraficos(p, t, function (ok) { listo(ok ? 'contestado' : 'no se pudo contestar'); });
      }, function (e) { unaVezAlGrupo('cmd:' + p.id, 'No pude armar el resumen semanal (' + esc(e.message) + ').', p.msg, p.chat); listo('error ServiceNow ' + e.message); });
      return;
    }
    if (p.cmd === '/mes') {
      // "/mes" = mes en curso; "/mes 09-2026" o "/mes 9/2026" = ese mes; el automático del 1° (pedido sin mensaje) = mes pasado
      var am = /(\d{1,2})[\/.-](\d{4})/.exec((p.texto || '').split(/\s+/).slice(1).join(' ')), autoMes = p.id < 0 && !p.msg;
      var hoyM = new Date(); hoyM.setHours(0, 0, 0, 0);
      var fm = am ? new Date(+am[2], +am[1] - 1, 1) : (autoMes ? undefined : hoyM);
      var mesTxt = (am && (+am[1] < 1 || +am[1] > 12)) ? Promise.resolve('No entendí el mes. Usalo así: <code>/mes 09-2026</code>')
        : fm && fm > hoyM ? Promise.resolve('Ese mes todavía no llegó 🙂') : (RESUMEN.limpiarGraf(), RESUMEN.mes(fm));
      mesTxt.then(function (t) {
        conGraficos(p, t, function (ok) { listo(ok ? 'contestado' : 'no se pudo contestar'); });
      }, function (e) { unaVezAlGrupo('cmd:' + p.id, 'No pude armar el resumen mensual (' + esc(e.message) + ').', p.msg, p.chat); listo('error ServiceNow ' + e.message); });
      return;
    }
    if (p.cmd === '/status') {
      resumenTelegram((p.texto || '').trim().split(/\s+/).slice(1).join(' ')).then(function (t) {
        unaVezAlGrupo('cmd:' + p.id, t, p.msg, p.chat, function (ok) { listo(ok ? 'contestado' : 'no se pudo contestar'); });
      }, function (e) { unaVezAlGrupo('cmd:' + p.id, 'No pude armar el resumen (' + esc(e.message) + ').', p.msg, p.chat); listo('error ServiceNow ' + e.message); });
      return;
    }
    if (p.cmd === '/bandeja') {
      textoBandeja(filtroBandeja(p.texto)).then(function (t) {
        unaVezAlGrupo('cmd:' + p.id, t, p.msg, p.chat, function (ok) { listo(ok ? 'contestado' + (p.chat && String(p.chat) !== String(GM_getValue('tg_chat')) ? ' por privado' : '') : 'no se pudo contestar'); });
      }, function (e) { unaVezAlGrupo('cmd:' + p.id, 'No pude leer la bandeja de ServiceNow (' + esc(e.message) + ').', p.msg, p.chat); listo('error ServiceNow ' + e.message); });
    } else listo('comando desconocido');
  }
  function duracion(min) {
    min = Math.round(Math.abs(min));
    return min >= 60 ? Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '') : min + ' min';
  }
  function textoCaso(arg) {
    var n = (arg || '').trim().toUpperCase();
    if (!n) return Promise.resolve('Decime qué caso: <code>/caso WO0096818</code> (también sirve el WOT o el CS).');
    var q = /^WOT/.test(n) ? 'number=' + n : /^WO/.test(n) ? 'parent.number=' + n : /^CS/.test(n) ? 'short_descriptionSTARTSWITH' + n : 'number=' + n;
    var campos = 'sys_id,number,parent,state,substate,u_pause_reason,priority,assigned_to,cmdb_ci,short_description,opened_at,closed_at,assignment_group,active';
    return api('wm_task', q + '^ORDERBYDESCopened_at', campos).then(function (rs) {
      if (!rs.length) return 'No encontré el caso ' + esc(n) + '.';
      var r = rs[0], ahora = Date.now();
      if (vl(r, 'active') === 'false') return textoCerrado(r);
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
                 esc(dv(r, 'state')) + (aceptado(r) ? ' · ✅ ' + esc(dv(r, 'u_pause_reason') || 'aceptado') : pausado(r) ? ' · ⏸️ ' + esc(dv(r, 'u_pause_reason') || 'en pausa') : ''),
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
  // ---- /caso de un caso cerrado: tiempos, si cumplió el SLA neto y datos del cierre
  var SEM_C = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  function fechaC(ms) { var d = new Date(ms); return SEM_C[d.getDay()] + ' ' + ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear() + ' ' + hhmm(ms); }
  function msDur(v) { return v ? utc(v) : 0; }            // duración de SN: "1970-01-02 03:04:00" = 1 d 3 h 4 min
  // formulario de cierre que el dispatcher pega en las notas de la WO ("CAUSA DE LA AFECTACION: …", "ID de CIERRE: …", etc.)
  function formularioCierre(regs) {
    var txt = regs.map(function (x) { return x ? dv(x, 'work_notes') + '\n' + dv(x, 'comments') : ''; }).join('\n');
    var i = txt.search(/CAUSA DE LA AFECTACI/i);              // el journal viene de lo más nuevo a lo más viejo: el primero es el último cierre
    if (i < 0) return null;
    var ini = txt.lastIndexOf('\n\n', i); ini = ini < 0 ? 0 : ini;
    var f = {};
    txt.slice(ini).split('\n').some(function (l, k) {
      if (k > 2 && /^\s*\d{2}[-\/]\d{2}[-\/]\d{4} \d{2}:\d{2}(:\d{2})? - /.test(l)) return true;   // empieza otra nota
      var m = /^\s*([^:]{2,70}?)\s*:\s*(.*)$/.exec(l);
      if (m) { var k2 = m[1].toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); if (!(k2 in f)) f[k2] = m[2].trim(); }
      return false;
    });
    return f;
  }
  function datosCierre(regs) {
    var causa = [], idc = [], bt = [], notas = '';
    function suma(lista, v) { v = String(v || '').trim(); if (v && lista.indexOf(v) < 0) lista.push(v); }
    regs.forEach(function (x) {
      if (!x) return;
      Object.keys(x).forEach(function (k) {                // campos del formulario de cierre (los nombres cambian según la tabla)
        var v = dv(x, k);
        if (!v || typeof v !== 'string' || v.length > 120 || /^(sys_|closed_|close_notes|comments|work_notes|description|short_desc)/.test(k)) return;
        if (/caus/i.test(k)) suma(causa, v);
        else if (/cierre|close_code|closure/i.test(k)) suma(idc, v);
        else if (/botella|(^|_)bt(_|$)/i.test(k)) suma(bt, v);
      });
      if (!notas && dv(x, 'close_notes')) notas = dv(x, 'close_notes');
      var txt = dv(x, 'comments') + '\n' + dv(x, 'work_notes');   // formulario de cierre copiado en la WO (lo más nuevo primero)
      var m;
      if (!causa.length && (m = /causa(?: de (?:la )?(?:afectaci[oó]n|falla))?\s*[:=]\s*([^\n]{2,80})/i.exec(txt))) suma(causa, m[1]);
      if (!idc.length && (m = /id\s*(?:de\s*)?cierre\s*[:=]\s*([^\n]{2,80})/i.exec(txt))) suma(idc, m[1]);
      if (!bt.length && (m = /\b(?:BT|botella)\s*[:=]\s*([A-Z0-9][A-Z0-9_\-]{5,40})/i.exec(txt))) suma(bt, m[1].toUpperCase());
    });
    return {causa: causa, idc: idc, bt: bt, notas: notas};
  }
  function textoCerrado(r) {
    var padre = vl(r, 'parent');
    var ids = [vl(r, 'sys_id')]; if (padre) ids.push(padre);
    return Promise.all([
      api('wm_task', 'sys_id=' + vl(r, 'sys_id'), '').then(function (x) { return x[0]; }).catch(function () { return null; }),
      padre ? api('wm_order', 'sys_id=' + padre, '').then(function (x) { return x[0]; }).catch(function () { return null; }) : null,
      api('task_sla', 'taskIN' + ids.join(','), 'sla,stage,has_breached,start_time,end_time,planned_end_time,duration,pause_duration').catch(function () { return null; })
    ]).then(function (res) {
      var wot = res[0] || r, wo = res[1], slas = res[2];
      var prio = dv(r, 'priority'), color = /^1/.test(prio) ? '🔴' : /^2/.test(prio) ? '🟠' : /^3/.test(prio) ? '🟡' : '⚪';
      var cancel = /cancel/i.test(dv(r, 'state'));
      var out = ['🔎 <b>' + esc(woDe(r)) + '</b> · ' + (cancel ? '🚫 Cancelado' : '✅ Cerrado'), esc(dv(r, 'cmdb_ci') || 'sin CI')];
      if (dv(r, 'short_description')) out.push('<i>' + esc(dv(r, 'short_description')) + '</i>');
      out.push('', '📌 <b>Estado</b>',
               esc(dv(r, 'state')) + (aceptado(r) ? ' · ✅ ' + esc(dv(r, 'u_pause_reason') || 'aceptado') : ''),
               color + ' Prioridad ' + esc(prio || '—'),
               '👷 ' + esc(dv(r, 'assigned_to') || 'sin asignar'));
      // tiempos
      var ab = utc(vl(r, 'opened_at')), ce = utc(vl(wot, 'closed_at') || vl(r, 'closed_at'));
      var neto = (slas || []).filter(function (x) { return /neto/i.test(dv(x, 'sla')) && !/cancel/i.test(vl(x, 'stage') + dv(x, 'stage')); })
                             .sort(function (a, b) { return utc(vl(b, 'start_time')) - utc(vl(a, 'start_time')); })[0];
      var pausa = neto ? msDur(vl(neto, 'pause_duration')) : 0;
      out.push('', '🕐 <b>Tiempos</b>');
      if (ab) out.push('Abierto: ' + fechaC(ab));
      if (ce) out.push('Cerrado: ' + fechaC(ce));
      if (ab && ce) out.push('Total ' + duracion((ce - ab) / 60000) + (pausa ? ' · en pausa ' + duracion(pausa / 60000) : ''));
      // SLA neto: lo que tardó descontando pausas, contra el objetivo (vencimiento planificado − inicio − pausas)
      out.push('', '⏱️ <b>SLA neto</b>');
      if (cancel) out.push('caso cancelado');
      else if (slas === null) out.push('no lo pude leer');
      else if (!neto) out.push('sin SLA neto');
      else {
        var ini = utc(vl(neto, 'start_time')), fin = utc(vl(neto, 'end_time')) || ce;
        var tardo = fin && ini ? fin - ini - pausa : 0;
        var obj = utc(vl(neto, 'planned_end_time')) && ini ? utc(vl(neto, 'planned_end_time')) - ini - pausa : 0;
        var de = obj > 0 ? ' de ' + duracion(obj / 60000) : '';
        if (vl(neto, 'has_breached') === 'true') out.push('🔴 Vencido' + (tardo && obj && tardo > obj ? ' por ' + duracion((tardo - obj) / 60000) : '') + (tardo ? ' · ' + duracion(tardo / 60000) + de : ''));
        else out.push('🟢 Cumplido' + (tardo ? ' · ' + duracion(tardo / 60000) + de : ''));
      }
      // cierre
      var fc = formularioCierre([wo, wot]) || {}, dc = datosCierre([wo, wot]);
      var si = function (v) { return /^s[ií]/i.test(v || ''); };
      var lineas = [];
      var causa = fc['CAUSA DE LA AFECTACION'] || dc.causa.join(' · '), idc = fc['ID DE CIERRE'] || dc.idc.join(' · ');
      if (causa) lineas.push('Causa: ' + esc(causa));
      if (idc) lineas.push('ID de cierre: ' + esc(idc));
      var cable = fc['NOMBRE DEL CABLE'], elem = fc['ELEMENTO AFECTADO'];
      if (cable || elem) lineas.push('Cable: ' + esc([cable, elem].filter(Boolean).join(' · ')));
      if (si(fc['REASIGNACIONES'])) lineas.push('Reasignación: ' + esc((fc['DESDE'] || '?') + ' → ' + (fc['HASTA'] || '?')));
      if (fc['BAJA BUFFER Y FO'] || fc['ALTA BUFFER Y FO']) lineas.push('Buffers: ' + esc([fc['BAJA BUFFER Y FO'] ? 'baja ' + fc['BAJA BUFFER Y FO'] : '', fc['ALTA BUFFER Y FO'] ? 'alta ' + fc['ALTA BUFFER Y FO'] : ''].filter(Boolean).join(' · ')));
      if (si(fc['NUEVA BOTELLA'])) lineas.push('🆕 Botella nueva' + (fc['CANTIDAD DE BOTELLAS'] ? ': ' + esc(fc['CANTIDAD DE BOTELLAS']) : ''));
      if (si(fc['COLOCACION POSTES'])) lineas.push('Colocación de postes: sí');
      if (!fc['DESDE'] && dc.bt.length) lineas.push('BT: ' + esc(dc.bt.join(', ')));
      var tareas = fc['TAREAS REALIZADAS'] || ((dc.notas.match(/[a-záéíóúñ]/gi) || []).length >= 10 ? dc.notas : '');   // close notes con "." no sirven
      if (tareas) { var nt = tareas.replace(/\s+/g, ' ').trim(); lineas.push('<i>"' + esc(nt.length > 180 ? nt.slice(0, 177) + '…' : nt) + '"</i>'); }
      if (lineas.length) out.push.apply(out, ['', '🛠️ <b>Cierre</b>'].concat(lineas));
      out.push('', '🔗 <a href="' + esc(linkCaso(r)) + '">Abrir en ServiceNow</a>');
      return out.join('\n');
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
  var tomando = false, ultTomar = 0;
  var CADA_TOMAR_MS = 10000;          // cada cuánto se le pregunta a Supabase por pedidos del bot (y se avisa "estoy viva")
  function tomarDeSupabase() {
    if (tomando || Date.now() - ultTomar < CADA_TOMAR_MS - 500) return;
    tomando = true; ultTomar = Date.now();
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
    reintentarAvisos();
    atenderPendientes();
    if (GM_getValue('tg_cmds', 0) < 16) {     // menú de comandos del bot (aparece al escribir "/" en el grupo)
      tg('setMyCommands', {commands: [{command: 'bandeja', description: 'Casos abiertos (o /bandeja gpon, /bandeja lineales)'},
                                      {command: 'caso', description: 'Detalle de un caso: /caso WO0096818'},
                                      {command: 'activos', description: 'Quién está activo ahora y quién entra'},
                                      {command: 'status', description: 'Resumen del día (o /status gpon, /status lineales)'},
                                      {command: 'semana', description: 'Resumen de esta semana (o /semana 13-10-2026)'},
                                      {command: 'mes', description: 'Resumen de este mes (o /mes 09-2026)'},
                                      {command: 'historial', description: 'Qué pasó cerca de una botella, coordenadas o link'},
                                      {command: 'autoasignar', description: 'Asignación automática: ver, on u off'},
                                      {command: 'rama', description: 'Casos de una rama GPON en 90 días: /rama GMRN-R0503'},
                                      {command: 'pcs', description: 'PCs conectadas y su versión del Avisador'}]}, function () { GM_setValue('tg_cmds', 16); });
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
    var viejo = document.getElementById('mobisond-avisador'); if (viejo) viejo.remove();
    var host = document.createElement('div'); host.id = 'mobisond-avisador';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
    var sh = host.attachShadow({mode: 'open'});
    var e2 = function (t) { return esc(t == null ? '' : t).replace(/"/g, '&quot;'); };
    var ok = function (t) { return '<span class="ok">' + t + '</span>'; }, av = function (t) { return '<span class="av">' + t + '</span>'; };
    var k = GM_getValue('lista', ''), tit = GM_getValue('lista_titulo', '');
    var lider = GM_getValue('lider', null), atiendo = !!(lider && lider.id === MI_TAB && Date.now() - lider.t < 15000);
    var ver = typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '';
    var estado = function () {
      var aa = autoAsig ? (autoAsig.estado === 'on' ? '<b>prendida</b>' : '<b>apagada</b>') : 'sin dato todavía';
      return '🔔 ' + (!k ? av('No vigila ninguna lista') + ' · abrí Pending Dispatch y elegí "🔔 Vigilar esta lista"' :
                      'Vigila <b>' + e2(tit || k.split('|')[0]) + '</b> · ' + (vigilada() ? ok('esta pestaña (' + (filas() || []).length + ' casos)') : 'en otra pestaña')) + '<br>' +
             '🤖 Bot: ' + (noAtiende() ? av('esta pestaña no lo atiende (Dejar de vigilar)') : atiendo ? ok('lo atiende esta pestaña') : 'lo atiende otra pestaña o PC') + '<br>' +
             '🤖 Asignación automática: ' + aa + ' <span class="gr">(se cambia con /autoasignar)</span><br>' +
             '🔐 Sesión de ServiceNow: ' + (sesionCaida() ? av('cerrada, recargá la página') : ok('OK')) + ' · PC <code>' + e2(pcId()) + '</code>';
    };
    sh.innerHTML = '<style>' +
      '*{box-sizing:border-box;font-family:"Segoe UI",Roboto,Arial,sans-serif}' +
      '.fondo{position:absolute;inset:0;background:rgba(15,23,42,.35)}' +
      '.p{position:absolute;top:70px;right:40px;width:430px;max-height:calc(100vh - 90px);overflow:auto;background:#fff;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.25);font-size:13.5px;color:#111827}' +
      '.h{background:#1e3a5f;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px}' +
      '.h small{margin-left:auto;font-weight:400;opacity:.8}.x{cursor:pointer;margin-left:10px;font-size:18px;opacity:.85}' +
      '.b{padding:12px 16px;display:flex;flex-direction:column;gap:9px}' +
      '.e{border-radius:8px;padding:8px 10px;line-height:1.6;background:#f1f5f9}.ok{color:#15803d}.av{color:#b45309}.gr{color:#6b7280}' +
      'code{font-family:Consolas,monospace;font-size:12.5px}' +
      '.sec{font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}' +
      '.row{display:flex;align-items:center;padding:8px 10px;border:1px solid #eef0f3;border-radius:8px;cursor:pointer}.row:hover{border-color:#2563eb}' +
      '.row .v{margin-left:auto;color:#2563eb;font-size:12.5px}' +
      '.bs{display:flex;gap:8px;flex-wrap:wrap}' +
      'button{border:1px solid #d1d5db;border-radius:7px;padding:6px 10px;background:#f9fafb;font-size:13px;cursor:pointer}button:hover{border-color:#2563eb}' +
      '.msg{color:#374151;font-size:12.5px;line-height:1.45}' +
      'pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px Consolas,monospace;background:#f8fafc;border:1px solid #eef0f3;border-radius:8px;padding:8px;max-height:260px;overflow:auto}' +
      '</style><div class="fondo"></div><div class="p">' +
      '<div class="h">🔔 Avisador · Mobisond<small>v' + e2(ver) + '</small><span class="x" title="Cerrar">✕</span></div>' +
      '<div class="b"><div class="e" id="est">' + estado() + '</div>' +
      '<div class="sec">Ajustes de esta PC</div>' +
      [['canal', '📱 Mi canal del celular', canal()],
       ['clave', '🔑 Contraseña del equipo', GM_getValue('tg_token', '') ? 'cargada' : 'falta cargar'],
       ['grupo', '💬 Grupo de Telegram', hayGrupo() ? 'activo' : 'sin configurar'],
       ['campana', '🔔 Abrir la campana de la PC', '']].map(function (o) {
        return '<div class="row" data-a="' + o[0] + '">' + o[1] + '<span class="v">' + e2(o[2]) + ' ›</span></div>';
      }).join('') +
      '<div class="sec">Herramientas</div>' +
      '<div class="bs"><button id="pro">🧪 Probar todo</button><button id="rev">🔧 Revisar bot</button></div>' +
      '<div class="msg" id="msg"></div></div></div>';
    var $ = function (id) { return sh.getElementById(id); };
    var cerrar = function () { host.remove(); };
    sh.querySelector('.fondo').onclick = cerrar; sh.querySelector('.x').onclick = cerrar;
    sh.querySelectorAll('.row').forEach(function (r) {
      r.onclick = function () {
        cerrar();   // los ajustes usan las ventanitas de siempre (prompt / alert)
        ({canal: cambiarCanal, clave: function () { pedirClave(1); }, grupo: configurarGrupo, campana: abrirCampana})[r.dataset.a]();
      };
    });
    $('pro').onclick = function () { $('msg').textContent = probarTodo(); };
    $('rev').onclick = function () {
      $('msg').textContent = 'Revisando…';
      revisarBot(function (t) { if (!host.isConnected) return; $('msg').innerHTML = '<pre>' + esc(t) + '</pre>'; });
    };
    // el estado de la asignación automática se lee de Supabase al abrir
    sbRpc('bot_autoasignar', {p_on: null, p_quien: null}).then(function (e) { autoAsig = e; autoAsigT = Date.now(); if (host.isConnected) $('est').innerHTML = estado(); }, function () {});
    document.body.appendChild(host);
  }

  // ---------------------------------------------------------------- casos nuevos "por detrás" (respaldo)
  // Si nadie tiene la lista vigilada, igual se avisan al grupo los casos que entran: la pestaña que atiende
  // le pregunta a ServiceNow cada 30 s por los WOT de Mobisond abiertos en los últimos 15 min.
  // Usa la misma clave que el aviso de la lista (el sys_id), así Supabase no deja que salga dos veces.
  // En la misma consulta se ve si alguno lleva 7 min en Pending Dispatch sin asignar.
  var PENDIENTE_MIN = 7;               // minutos en Pending Dispatch sin asignar antes de avisar
  // ---- ASIGNACIÓN AUTOMÁTICA (/autoasignar on|off en Telegram; el estado vive en Supabase). Arranca apagada.
  // A los 7 min sin asignar: la cuadrilla activa del proyecto (cuadro ACTIVOS de la planilla de horarios, que Supabase
  // guarda cada 5 min) con menos casos abiertos. Cuadrilla de la planilla -> cuenta de ServiceNow (la pasa el Chino).
  // la tabla cuadrilla -> cuenta de ServiceNow vive en Supabase (no en este repo público): viene con el estado
  function cuentas() { try { return JSON.parse((autoAsig && autoAsig.cuentas) || '[]'); } catch (e) { return []; } }
  var autoAsig = null, autoAsigT = 0;
  function normNom(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, ''); }
  function cuentaDe(nombrePlanilla, proy) {           // "Hugo - Dylan" -> la cuenta de Hugo (solo la parte antes del guion)
    var k = normNom(String(nombrePlanilla).split(' - ')[0]);
    return cuentas().filter(function (c) { return c.proyecto === proy && normNom(c.clave) === k; })[0] || null;
  }
  // cuadrillas de GPON según la tabla "Semana …" de la planilla: las que ENTRAN a las 7 (inicio) o TERMINAN a las 19 (fin) ese día
  function turnoGPON(semanas, dia, fin) {
    var nombreDia = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][dia.getDay()];
    var dd = ('0' + dia.getDate()).slice(-2) + '/' + ('0' + (dia.getMonth() + 1)).slice(-2);
    var tabla = null;
    semanas.forEach(function (t) {                       // la semana que incluye ese día ("Semana 26/10 al 01/11"); si no, la primera con ese día
      var m = /(\d{1,2})\/(\d{1,2})\D+(\d{1,2})\/(\d{1,2})/.exec(t.titulo || '');
      if (m) {
        var y = dia.getFullYear(), ini = new Date(y, m[2] - 1, +m[1], 0, 0), finS = new Date(y, m[4] - 1, +m[3], 23, 59);
        if (finS < ini) finS.setFullYear(y + 1);
        if (dia >= ini && dia <= finS) tabla = t;
      }
    });
    if (!tabla) tabla = semanas.filter(function (t) { return (t.dias || []).indexOf(nombreDia) >= 0; })[0] || null;
    if (!tabla) return {error: 'no encontré la semana del ' + dd + ' en la planilla'};
    var col = tabla.dias.indexOf(nombreDia);
    if (col < 0) return {error: 'no encontré el ' + nombreDia + ' en la planilla'};
    var nombres = [];
    tabla.filas.forEach(function (f) {
      if (!cuentaDe(f.nombre, 'GPON')) return;
      var rangos = [], m, re = /(\d{1,2})\s*a\s*(\d{1,2})/gi, txt = f.horas[col] || '';
      while ((m = re.exec(txt))) rangos.push([+m[1], +m[2]]);
      if (rangos.some(function (x) { return fin ? x[1] === 19 : x[0] === 7; })) nombres.push(f.nombre);
    });
    return {nombres: nombres, dia: nombreDia.replace('miercoles', 'miércoles').replace('sabado', 'sábado') + ' ' + dd};
  }
  function apiPatch(tabla, id, datos) {
    var h = {'Accept': 'application/json', 'Content-Type': 'application/json'}, t = token(); if (t) h['X-UserToken'] = t;
    return fetch(location.origin + '/api/now/table/' + tabla + '/' + id + '?sysparm_fields=assigned_to&sysparm_display_value=all',
                 {method: 'PATCH', credentials: 'same-origin', headers: h, body: JSON.stringify(datos)}).then(function (r) {
      if (r.status === 401) sesionPerdida();
      if (!r.ok) throw new Error('ServiceNow ' + r.status);
      return r.json();
    }).then(function (j) { return j.result || {}; });
  }
  function autoAsignar(r, min, avisoSin) {
    var id = vl(r, 'sys_id'), proy = proyecto(r) || 'Lineales';
    var act = null;
    try { act = JSON.parse(autoAsig.activos || 'null'); } catch (e) {}
    var viejo = !autoAsig.activos_t || Date.now() - new Date(autoAsig.activos_t).getTime() > 30 * 60000;
    if (!act || viejo) return avisoSin('No lo asigné: no tengo la planilla de horarios al día');
    var nombres = (proy === 'GPON' ? act.gpon : act.tl) || [], porque = 'activo en ' + proy;
    // GPON fuera de horario (19 a 07): P3 o más baja -> las que arrancan a las 7; P1/P2 -> las que terminaron a las 19
    var hora = new Date().getHours();
    if (proy === 'GPON' && (hora >= 19 || hora < 7)) {
      var alta = /^[12]\b/.test(dv(r, 'priority')) || /^[12]$/.test(vl(r, 'priority'));
      var dia = new Date(); dia.setHours(12, 0, 0, 0);
      if (alta && hora < 7) dia.setDate(dia.getDate() - 1);            // P1/P2 de madrugada: las de la tarde anterior
      if (!alta && hora >= 19) dia.setDate(dia.getDate() + 1);          // P3+ a la noche: las de mañana a la mañana
      var turno = turnoGPON(act.semanas || [], dia, alta);
      if (turno.error) return avisoSin('No lo asigné: ' + turno.error);
      nombres = turno.nombres;
      porque = 'fuera de horario · ' + (alta ? 'P1/P2 → la que terminó a las 19' : 'P3 o menor → la que entra a las 7') + ' (' + turno.dia + ')';
      if (!nombres.length) return avisoSin('No lo asigné: ' + (alta ? 'nadie de GPON terminó a las 19' : 'nadie de GPON entra a las 7') + ' el ' + turno.dia + ' (francos)');
    }
    if (!nombres.length) return avisoSin('No lo asigné: no hay nadie activo en ' + proy);
    var cand = [], raros = [];
    nombres.forEach(function (n) { var c = cuentaDe(n, proy); if (c) { if (cand.indexOf(c) < 0) cand.push(c); } else raros.push(String(n).split(' - ')[0]); });
    if (!cand.length) return avisoSin('No lo asigné: no reconozco a ' + raros.join(', ') + ' en la tabla de cuentas');
    // árbitro: con varias PCs, asigna una sola
    sbRpc('bot_reclamar', {p_aviso: 'asig:' + id, p_pc: pcId()}).then(function (gano) {
      if (gano === false) return;
      var usuarios = cand.map(function (c) { return c.usuario; });
      return Promise.all([
        api('wm_task', 'active=true^assigned_to.user_nameIN' + usuarios.join(','), 'assigned_to.user_name'),
        api('sys_user', 'user_nameIN' + usuarios.join(','), 'sys_id,user_name'),
        api('wm_task', 'sys_id=' + id, 'assigned_to,state')
      ]).then(function (res) {
        var ahora = res[2][0];
        if (!ahora || vl(ahora, 'assigned_to') || !/pending dispatch|pendiente/i.test(dv(ahora, 'state'))) { botLog('autoasignar: ' + woDe(r) + ' ya no está sin asignar'); return; }
        var cuenta = {}; res[0].forEach(function (t) { var u = vl(t, 'assigned_to.user_name'); cuenta[u] = (cuenta[u] || 0) + 1; });
        var sysDe = {}; res[1].forEach(function (u) { sysDe[vl(u, 'user_name')] = vl(u, 'sys_id'); });
        var elegible = cand.filter(function (c) { return sysDe[c.usuario]; });
        if (!elegible.length) return avisoSin('No lo asigné: no encontré las cuentas ' + usuarios.join(', ') + ' en ServiceNow');
        elegible.sort(function (a, b) { return (cuenta[a.usuario] || 0) - (cuenta[b.usuario] || 0); });   // empate: el orden de la planilla
        var c = elegible[0], n = cuenta[c.usuario] || 0;
        return apiPatch('wm_task', id, {assigned_to: sysDe[c.usuario]}).then(function (x) {
          if (vl(x, 'assigned_to') !== sysDe[c.usuario]) throw new Error('ServiceNow no tomó el cambio');
          botLog('autoasignar: ' + woDe(r) + ' -> ' + c.quien + ' (' + c.usuario + ')');
          var prio = dv(r, 'priority');
          unaVezAlGrupo('asigok:' + id, '🤖 <b>Asignado automáticamente</b>\n\n<i>Estuvo ' + Math.floor(min) + ' min sin asignar</i>' +
            (prio ? '\n\n' + colorPrio(prio) + ' <b>' + esc(prio) + '</b>' : '') +
            cuerpo(r, '👉 <b>Asignado automáticamente a:</b>\n\n👷 <b>' + esc(c.quien) + '</b> (' + esc(c.usuario) + ')\n'));
        }, function (e) {
          botLog('autoasignar: no pude asignar ' + woDe(r) + ': ' + e.message);
          avisoSin('No lo pude asignar (' + e.message + '): asignalo a mano');
        });
      });
    }).catch(function (e) { botLog('autoasignar: ' + e.message); avisoSin(''); });
  }

  function casosPorDetras() {
    if (!hayGrupo() || !soyLider()) return;
    var ahora = Date.now();
    if (ahora - GM_getValue('ult_nuevos', 0) < 25000) return;
    GM_setValue('ult_nuevos', ahora);
    if (ahora - autoAsigT > 60000) {
      sbRpc('bot_autoasignar', {p_on: null, p_quien: null}).then(function (e) { autoAsig = e; autoAsigT = Date.now(); }, function () {});
    }
    var q = 'active=true^opened_at>javascript:gs.minutesAgoStart(15)^assignment_group.nameSTARTSWITH' + GRUPOS.lineales +
            '^ORassignment_group.nameSTARTSWITH' + GRUPOS.gpon;
    api('wm_task', q, 'sys_id,number,parent,priority,cmdb_ci,short_description,opened_at,state,assigned_to,assignment_group').then(function (rs) {
      // SIN ASIGNAR: sigue en Pending Dispatch, sin nadie asignado, 7 min (o más) después de entrar -> avisa una vez
      rs.forEach(function (r) {
        var min = (ahora - utc(vl(r, 'opened_at'))) / 60000;
        if (min >= PENDIENTE_MIN && /pending dispatch|pendiente/i.test(dv(r, 'state')) && !vl(r, 'assigned_to')) {
          var prio = dv(r, 'priority');
          var avisoSin = function (motivo) {
            unaVezAlGrupo('pend:' + vl(r, 'sys_id'), '⏰ <b>Caso sin asignar hace ' + Math.floor(min) + ' min</b>\n\n<i>' +
              (motivo ? esc(motivo) : 'Sigue en Pending Dispatch') + '</i>' +
              (prio ? '\n\n' + colorPrio(prio) + ' <b>' + esc(prio) + '</b>' : '') + cuerpo(r));
          };
          // prendida / apagada: manda lo que diga Supabase. Si el dato de esta pestaña tiene más de 1 min (o recién recargó), se lee antes de decidir.
          var decidir = function () { if (autoAsig && autoAsig.estado === 'on') autoAsignar(r, min, avisoSin); else avisoSin(''); };
          if (autoAsig && Date.now() - autoAsigT < 60000) decidir();
          else sbRpc('bot_autoasignar', {p_on: null, p_quien: null}).then(function (e) { autoAsig = e; autoAsigT = Date.now(); decidir(); },
                     function (e) { avisoSin('No pude leer de Supabase si la asignación automática está prendida (' + e.message + ')'); });
        }
      });
      var avisados = GM_getValue('nuevos_avisados', {});
      Object.keys(avisados).forEach(function (k) { if (ahora - avisados[k] > 60 * 60000) delete avisados[k]; });
      rs.forEach(function (r) {
        var id = vl(r, 'sys_id');
        if (avisados[id]) return;
        avisados[id] = ahora;
        var f = {id: id, numero: woDe(r), link: linkCaso(r), proyecto: proyecto(r),
                 datos: {priority: dv(r, 'priority'), cmdb_ci: dv(r, 'cmdb_ci'), short_description: dv(r, 'short_description')}};
        botLog('caso nuevo (por detrás) ' + f.numero);
        avisoCasoNuevo(f);
      });
      GM_setValue('nuevos_avisados', avisados);
    }, function (e) { console.log('[Mobisond] casos por detrás: ' + e.message); });
  }

  // ---------------------------------------------------------------- resumen de turno (botón 📋 y /status)
  // Arma el mensaje de fin de turno (Lineales y GPON) con los números del día. Antes era un script aparte.
  var RESUMEN = (function () {
    var GRUPOS = {lineales: 'C-TL-MOBISOND', gpon: 'C-GZ1-MOBI'};
    // Cliente: sale del Service offering (TSO_C_TL_<cliente>_<zona>_BA)
    var CLIENTES = {CL: 'CLR', EDNR: 'EDN', MUNI: 'MUNI', TP: 'TP'};   // cómo se escribe cada cliente en "Casos en mano"
    var VERIFICACION = /verificaci[oó]n del cliente/i;

    // DÍA del resumen (medianoche local). Por defecto hoy; se cambia con armar(fecha).
    var DIA = new Date(); DIA.setHours(0, 0, 0, 0);
    function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function esDiaHoy() { var h = new Date(); h.setHours(0, 0, 0, 0); return DIA.getTime() === h.getTime(); }
    function ini() { return "javascript:gs.dateGenerate('" + iso(DIA) + "','start')"; }
    function fin() { return "javascript:gs.dateGenerate('" + iso(DIA) + "','end')"; }
    function rangoDia() { return iso(DIA) + '@' + ini() + '@' + fin(); }      // para los "ON" de ServiceNow

    function token() {
      var w = unsafeWindow;
      if (w.g_ck) return w.g_ck;
      try { var f = document.querySelector('iframe#gsft_main'); if (f && f.contentWindow.g_ck) return f.contentWindow.g_ck; } catch (e) {}
      return '';
    }

    function api(tabla, query, campos) {
      var url = location.origin + '/api/now/table/' + tabla + '?sysparm_display_value=all&sysparm_exclude_reference_link=true' +
        '&sysparm_limit=2000&sysparm_fields=' + campos + '&sysparm_query=' + encodeURIComponent(query);
      var h = {'Accept': 'application/json'};
      var t = token(); if (t) h['X-UserToken'] = t;
      return fetch(url, {credentials: 'same-origin', headers: h}).then(function (r) {
        if (!r.ok) throw new Error('ServiceNow respondió ' + r.status + (r.status === 401 ? ' (¿se cerró la sesión?)' : ''));
        return r.json();
      }).then(function (j) { return j.result || []; });
    }

    function dv(reg, campo) { var v = reg[campo]; return v ? (v.display_value || '') : ''; }
    function val(reg, campo) { var v = reg[campo]; return v ? (v.value || '') : ''; }
    // Consultas con muchos sys_id: se parten en tandas (una URL con cientos de ids es demasiado larga y ServiceNow
    // la rechaza). armar(ids) devuelve la consulta de cada tanda; se juntan todos los resultados.
    // prioridad baja (4 - Baja / Low, o 5): sus vencidos no cuentan en el contador
    function prioBaja(c) { return /^[45]$/.test(val(c, 'priority')) || /^[45]\b|baja|low|planning/i.test(dv(c, 'priority')); }
    function apiIN(tabla, ids, armar, campos, tam) {
      tam = tam || 80;
      var tandas = [];
      for (var i = 0; i < ids.length; i += tam) tandas.push(ids.slice(i, i + tam));
      return tandas.reduce(function (prom, t) {
        return prom.then(function (acum) { return api(tabla, armar(t), campos).then(function (r) { return acum.concat(r); }); });
      }, Promise.resolve([]));
    }

    function cliente(reg) {
      var so = dv(reg, 'service_offering');
      var m = /^TSO_C_TL_([A-Z0-9]+)_/i.exec(so);
      if (!m) return '';
      return CLIENTES[m[1].toUpperCase()] || m[1].toUpperCase();
    }

    function proyecto(reg) {
      var g = dv(reg, 'assignment_group').toUpperCase();
      if (g.indexOf(GRUPOS.lineales) === 0) return 'lineales';
      if (g.indexOf(GRUPOS.gpon) === 0) return 'gpon';
      return '';
    }

    function grupoQ() {
      return 'assignment_group.nameSTARTSWITH' + GRUPOS.lineales + '^ORassignment_group.nameSTARTSWITH' + GRUPOS.gpon;
    }

    function cerrado(reg) {
      return val(reg, 'active') === 'false';
    }

    function contar(lista) {                         // ['a','b','a'] -> [['a',2],['b',1]]
      var c = {}, orden = [];
      lista.forEach(function (x) { if (!(x in c)) { c[x] = 0; orden.push(x); } c[x]++; });
      return orden.map(function (k) { return [k, c[k]]; });
    }

    function armar(fecha, solo) {          // solo: 'Lineales' o 'GPON' (/status gpon); sin nada, los dos
      DIA = fecha ? new Date(fecha.getTime()) : new Date(); DIA.setHours(0, 0, 0, 0);
      var g = grupoQ();
      // casos "vivos" ese día: abiertos antes de que termine el día y (todavía abiertos o cerrados desde ese día)
      var q = g + '^opened_at<=' + fin() + '^active=true^ORclosed_at>=' + ini();
      var campos = 'sys_id,number,parent,active,state,substate,u_pause_reason,priority,opened_at,closed_at,assignment_group,service_offering,cmdb_ci';
      return api('wm_task', q, campos).then(function (casos) {
        var vistos = {};
        casos = casos.filter(function (r) { var n = dv(r, 'number'); if (vistos[n]) return false; vistos[n] = 1; return true; });
        if (!casos.length) return {casos: casos, vencidos: {}};
        // SLA vencido hoy: puede estar en la WOT o en su WO padre
        var ids = [], dePadre = {};
        casos.forEach(function (r) {
          ids.push(val(r, 'sys_id'));
          var p = val(r, 'parent'); if (p) { ids.push(p); dePadre[p] = dv(r, 'number'); }
        });
        if (!ids.length) return {casos: casos, vencidos: {}};
        // el NETO se filtra abajo, por nombre
        return apiIN('task_sla', ids, function (t) { return 'taskIN' + t.join(',') + '^has_breached=true'; },
                     'task,sla,stage,has_breached,planned_end_time,original_breach_time').then(function (slas) {
          var porId = {};
          casos.forEach(function (r) { porId[val(r, 'sys_id')] = dv(r, 'number'); });
          var venc = {};
          var ahora = Date.now();
          slas.forEach(function (s) {
            // vencido = el SLA se venció HOY (no importa qué día entró el caso).
            // Se usa el momento original del vencimiento: si el caso estuvo pausado, el otro campo se corre y daba falsos vencidos.
            if (!/neto/i.test(dv(s, 'sla'))) return;
            if (/cancel/i.test(val(s, 'stage') + ' ' + dv(s, 'stage'))) return;   // SLA cancelado (lo reemplazó otro): no cuenta
            var cuando = val(s, 'original_breach_time') || val(s, 'planned_end_time');
            if (!cuando || !esHoy(cuando) || new Date(cuando.replace(' ', 'T') + 'Z').getTime() > ahora) return;
            var t = val(s, 'task'); var n = porId[t] || dePadre[t]; if (n) venc[n] = 1;
          });
          return {casos: casos, vencidos: venc};
        }, function () { return {casos: casos, vencidos: null}; });   // si no deja leer los SLA, se completa a mano
      }).then(function (d) {
        return verificadosHoy(d.casos).then(function (vh) { return texto(d.casos, d.vencidos, vh, solo); });
      });
    }

    // RESUELTOS = casos que hoy pasaron a "Verificación del cliente" (aunque después se hayan cerrado o pasado a
    // "Aceptado"). Se busca por dos caminos y se juntan:
    //  a) el historial de cambios (sys_audit) del motivo de pausa, si el usuario tiene permiso para verlo;
    //  b) el comentario automático que deja ServiceNow en la WO ("Se espera la verificación del cliente").
    // Devuelve {número de WOT: true} o null si no se pudo leer nada.
    function fechaEntrada(t) {           // "2026-10-24 05:12:33" o "24/10/2026 05:12:33" (hora local de la PC)
      var m;
      if ((m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(t))) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      if ((m = /(\d{2})[\/-](\d{2})[\/-](\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(t))) return new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
      return null;
    }
    function hoyLocal(d) { var h = DIA; return d && d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate(); }
    // RESUELTO = el PRIMER pase a verificación de cada caso ("Se espera la verificación del cliente" o el motivo
    // de pausa que cambia a Verificación). Cuenta una sola vez, ese día, aunque después lo rechacen y se vuelva a
    // verificar, o aparezcan duplicados por casos hijos.
    function primerasVerif(casos) {      // {número de WOT: {d: fecha del primer pase, de}} o null si no se pudo leer
      var porId = {}, padres = [];
      casos.forEach(function (c) {
        porId[val(c, 'sys_id')] = dv(c, 'number');
        var p = val(c, 'parent'); if (p) { porId[p] = dv(c, 'number'); padres.push(p); }
      });
      var ids = Object.keys(porId);
      if (!ids.length) return Promise.resolve({});
      var hist = {}, leido = false; verificadosHoy.historial = false;              // número de WOT -> [{d, t: 'V'|'R', de}]
      var anotar = function (n, d, t, de) { if (n && d && !isNaN(d)) (hist[n] = hist[n] || []).push({d: d, t: t, de: de}); };
      var porAudit = apiIN('sys_audit', ids, function (t) { return 'fieldname=u_pause_reason^documentkeyIN' + t.join(','); },
                         'documentkey,oldvalue,newvalue,sys_created_on').then(function (as) {
        leido = true; verificadosHoy.historial = true;
        as.forEach(function (a) {
          var nuevo = val(a, 'newvalue') + ' ' + dv(a, 'newvalue'), viejo = val(a, 'oldvalue') + ' ' + dv(a, 'oldvalue');
          var d = new Date(val(a, 'sys_created_on').replace(' ', 'T') + 'Z'), n = porId[val(a, 'documentkey')];
          if (/verific/i.test(nuevo)) anotar(n, d, 'V', 'historial');
          else if (/rechaz|no acept/i.test(nuevo) || (/verific/i.test(viejo) && !nuevo.trim())) anotar(n, d, 'R', 'historial');
        });
      }, function () {});
      var porComentario = padres.length ? apiIN('wm_order', padres, function (t) { return 'sys_idIN' + t.join(','); }, 'sys_id,comments,work_notes', 40).then(function (wos) {
        leido = true;
        wos.forEach(function (w) {
          // cada entrada empieza con "fecha hora - Autor (Comentarios adicionales)".
          // "Caso hijo … cerrado, verifique…" no es un pase a verificación: se descarta.
          var txt = dv(w, 'comments') + '\n' + dv(w, 'work_notes');
          var re = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4} \d{2}:\d{2}:\d{2}) - [^\n]*\n([\s\S]*?)(?=\n\s*(?:\d{4}-\d{2}-\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4}) \d{2}:\d{2}:\d{2} - |$)/g, m;
          while ((m = re.exec(txt))) {
            var n = porId[val(w, 'sys_id')];
            if (/(rechazad[oa]|no aceptad[oa]) por el cliente/i.test(m[2])) anotar(n, fechaEntrada(m[1]), 'R', 'comentario');
            else if (/espera la verificaci[oó]n del cliente/i.test(m[2]) && !/hijo/i.test(m[2])) anotar(n, fechaEntrada(m[1]), 'V', 'comentario');
          }
        });
      }, function () {}) : Promise.resolve();
      return Promise.all([porAudit, porComentario]).then(function () {
        if (!leido) return null;
        var primeros = {};
        Object.keys(hist).forEach(function (n) {
          var ev = hist[n].sort(function (a, b) { return a.d - b.d; }), valido = null;
          ev.forEach(function (e) { if (e.t === 'V' && !valido) valido = e; });   // el primero; los rechazos no cambian nada
          if (valido) primeros[n] = valido;
        });
        return primeros;
      });
    }
    // {número de WOT: "comentario 14:05"} de los que tuvieron su primer pase a verificación el DÍA del resumen
    function verificadosHoy(casos) {
      return primerasVerif(casos).then(function (primeros) {
        if (!primeros) return null;
        var hoy = {};
        Object.keys(primeros).forEach(function (n) {
          var valido = primeros[n];
          if (hoyLocal(valido.d)) {
            hoy[n] = valido.de + ' ' + ('0' + valido.d.getHours()).slice(-2) + ':' + ('0' + valido.d.getMinutes()).slice(-2);
          }
        });
        return hoy;
      });
    }

    function calcular(casos, venc, proy, vh) {
      var r = {resueltosDet: [], ingresados: 0, resueltos: 0, acumulados: 0, verificacion: 0, pausas: [], sinAtender: 0, claroSin: 0, sinNoche: 0,
               enMano: [], vencidos: 0, vencidosWO: [], emergencia: false};
      casos.forEach(function (c) {
        if (proyecto(c) !== proy) return;
        if (/cancel/i.test(dv(c, 'state'))) return;   // los cancelados no cuentan para nada
        var n = dv(c, 'number');
        var abierto = !cerrado(c);
        if (val(c, 'opened_at') && esHoy(val(c, 'opened_at'))) {
          r.ingresados++;
          if (/^[12]\b/.test(dv(c, 'priority')) || /^[12]$/.test(val(c, 'priority'))) r.emergencia = true;
        }
        // resueltos: los que hoy pasaron a "Verificación del cliente" (si no se pudo leer, los cerrados hoy)
        if (vh ? vh[n] : (!abierto && val(c, 'closed_at') && esHoy(val(c, 'closed_at')))) {
          r.resueltos++;
          r.resueltosDet.push((dv(c, 'parent') || n) + (vh && typeof vh[n] === 'string' ? ' (' + vh[n] + ')' : ' (cerrado hoy)'));
        }
        if (venc && venc[n] && !prioBaja(c)) {      // los de prioridad baja no cuentan como vencidos
          r.vencidos++;
          var wo = dv(c, 'parent') || n.replace(/^WOT/i, 'WO');
          if (r.vencidosWO.indexOf(wo) < 0) r.vencidosWO.push(wo);
        }
        if (!abierto) return;
        r.acumulados++;
        var pausa = dv(c, 'u_pause_reason').trim();
        var estado = dv(c, 'state');
        if (pausa && VERIFICACION.test(pausa)) r.verificacion++;
        else if (pausa) r.pausas.push(pausa);
        else if (/work in progress|en curso/i.test(estado) || enCamino(c)) r.enMano.push(cliente(c));   // aceptado / en camino = en mano
        else {
          r.sinAtender++;
          if (cliente(c) === 'CLR') r.claroSin++;
          var p12 = /^[12]$/.test(val(c, 'priority')) || /^[12]\b/.test(dv(c, 'priority'));
          if (!p12 && fueraDeVentana(val(c, 'opened_at'))) r.sinNoche++;   // GPON: de P3 para abajo se trabaja de 7 a 19 (P1/P2 siempre)
        }
      });
      if (!venc) r.vencidos = '?';
      return r;
    }

    // ingresó después de las 19 (o antes de las 7): fuera de la ventana de trabajo de GPON
    function fueraDeVentana(utc) {
      if (!utc) return false;
      var h = new Date(utc.replace(' ', 'T') + 'Z').getHours();
      return h >= 19 || h < 7;
    }

    // opened_at / closed_at vienen en UTC ("2026-10-24 13:05:00"); se comparan con el día de hoy en la hora de la PC
    function esHoy(utc) {
      var d = new Date(utc.replace(' ', 'T') + 'Z');
      var h = DIA;                                     // el día del resumen (hoy, o el elegido)
      return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate();
    }

    function enManoTxt(lista, conCliente) {
      if (lista === null) return '—';
      if (!lista.length) return '0';
      if (!conCliente) return String(lista.length);
      var partes = contar(lista.map(function (x) { return x || 'sin cliente'; }));
      return lista.length + ' / ' + partes.map(function (p) { return p[1] + ' - ' + p[0]; }).join(' / ');
    }

    function saludo() {                              // 6 a 12 días · 12 a 20 tardes · 20 a 6 noches
      var h = new Date().getHours();
      return h >= 6 && h < 12 ? 'Buenos días' : h >= 12 && h < 20 ? 'Buenas tardes' : 'Buenas noches';
    }

    function vencTxt(r) {               // "2 / WO0096818 / WO0096820"
      if (r.vencidos === '?' || !r.vencidos) return String(r.vencidos);
      return r.vencidos + ' / ' + r.vencidosWO.join(' / ');
    }

    function texto(casos, venc, vh, solo) {
      var L = calcular(casos, venc, 'lineales', vh);
      var G = calcular(casos, venc, 'gpon', vh);
      if (!esDiaHoy()) {
        // acumulados, verificación, pausados, sin atender y en mano son "cómo está la bandeja ahora":
        // de un día anterior no se pueden saber, quedan con —
        [L, G].forEach(function (r) {
          r.acumulados = r.verificacion = r.sinAtender = r.claroSin = '—'; r.sinNoche = 0;
          r.pausas = []; r.pausasTxt = '—'; r.enMano = null;
        });
      }
      var t = [];
      t.push(esDiaHoy() ? saludo() + ';' : 'Resumen del ' + ('0' + DIA.getDate()).slice(-2) + '/' + ('0' + (DIA.getMonth() + 1)).slice(-2) + '/' + DIA.getFullYear());
      if (solo !== 'GPON') {
      t.push('', '*Lineales*', '');
      t.push('Casos ingresados: ' + L.ingresados);
      t.push('Casos resueltos: ' + L.resueltos);
      t.push('Casos totales acumulados: ' + L.acumulados);
      t.push('Casos en verificación: ' + L.verificacion);
      t.push('Casos pausados: ' + (L.pausasTxt || L.pausas.length));
      contar(L.pausas).forEach(function (p) { t.push('- ' + p[1] + ' ' + p[0]); });
      t.push('');
      t.push('Casos vencidos: ' + vencTxt(L));
      t.push('Casos totales sin atender: ' + L.sinAtender);
      t.push('Casos de Claro sin atender: ' + L.claroSin);
      t.push('Casos en mano: ' + enManoTxt(L.enMano, true));
      }
      if (solo !== 'Lineales') {
      t.push.apply(t, (solo ? [''] : ['', '']).concat(['*GPON*', '']));   // con los dos, doble renglón antes de GPON
      t.push('Casos ingresados: ' + G.ingresados);
      t.push('Casos resueltos : ' + G.resueltos);
      t.push('Casos acumulados: ' + G.acumulados);
      t.push('Casos en verificacion: ' + G.verificacion);
      t.push('Casos pausados: ' + (G.pausasTxt || G.pausas.length));
      contar(G.pausas).forEach(function (p) { t.push('* ' + (p[1] > 1 ? p[1] + ' ' : '') + p[0]); });
      t.push('');
      t.push('Casos vencidos: ' + vencTxt(G));
      t.push('Casos sin atender: ' + G.sinAtender + (G.sinNoche ? ' (' + G.sinNoche + ' post 19:00 hs)' : ''));
      t.push('Alguna emergencia: ' + (G.emergencia ? 'sí' : 'no'));
      t.push('Casos en mano: ' + enManoTxt(G.enMano, false));
      }
      return {dia: new Date(DIA.getTime()), hoy: esDiaHoy(), texto: t.join('\n'), sinSla: !venc, sinVerif: !vh,
              detalle: 'Resueltos Lineales: ' + (L.resueltosDet.join(', ') || 'ninguno') + ' · GPON: ' + (G.resueltosDet.join(', ') || 'ninguno')};
    }

    // ---------- pantalla ----------
    function montar() {
    var css = document.createElement('style');
    css.textContent =
      '#mbs-res-btn{position:fixed;right:18px;bottom:18px;z-index:2147483000;background:#1b5b8b;color:#fff;font:700 13px "Segoe UI",Arial;' +
      'border:0;border-radius:22px;padding:9px 15px;box-shadow:0 3px 10px rgba(0,0,0,.25);cursor:pointer;opacity:.9}' +
      '#mbs-res-btn:hover{opacity:1}' +
      '#mbs-res{position:fixed;right:18px;bottom:18px;z-index:2147483001;width:380px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;' +
      'background:#fff;color:#1f2937;border:1px solid #cfd6de;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);font:13px "Segoe UI",Arial}' +
      '#mbs-res .h{display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid #eef0f2}' +
      '#mbs-res .h b{font-size:14px}#mbs-res .h span{margin-left:auto;color:#9ca3af;cursor:pointer;font-size:16px}' +
      '#mbs-res .sub{padding:6px 12px;color:#6b7280;font-size:11.5px;background:#f8fafc;border-bottom:1px solid #eef0f2}' +
      '#mbs-res .sub.av{color:#b45309}' +
      '#mbs-res textarea{flex:1;min-height:420px;border:0;outline:0;resize:none;padding:10px 14px;font:12.5px/1.45 "Segoe UI",Arial;color:#1f2937}' +
      '#mbs-res .ft{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #eef0f2}' +
      '#mbs-res .ft button{border-radius:7px;padding:8px 12px;font:600 13px "Segoe UI",Arial;cursor:pointer}' +
      '#mbs-res .b1{flex:1;background:#1b5b8b;color:#fff;border:0}#mbs-res .b2{background:#fff;border:1px solid #cfd6de;color:#1f2937}';
    document.head.appendChild(css);

    // el resumen de turno ya no está en el menú: se pide por Telegram con /status (usa armar())
    }

    function abrir(fechaElegida) {
      var p = document.getElementById('mbs-res');
      if (p) p.remove();
      p = document.createElement('div');
      p.id = 'mbs-res';
      var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      var dia = fechaElegida instanceof Date ? fechaElegida : hoy;
      var esHoyElegido = dia.getTime() === hoy.getTime();
      p.innerHTML = '<div class="h"><b>Resumen de turno</b>' +
        '<input type="date" class="fecha" style="margin-left:10px;font:12px \'Segoe UI\',Arial;border:1px solid #cfd6de;border-radius:6px;padding:2px 4px" max="' + iso(hoy) + '" value="' + iso(dia) + '">' +
        '<span title="Cerrar">✕</span></div>' +
        '<div class="sub">' + (esHoyElegido ? 'Hoy · desde las 00:00' : 'Día anterior: acumulados, pausados y en mano no se pueden saber (—)') + ' · podés corregir el texto antes de copiar</div>' +
        '<textarea spellcheck="false">Buscando los casos del día…</textarea>' +
        '<div class="ft"><button class="b1">Copiar para WhatsApp</button><button class="b2">Actualizar</button></div>';
      document.body.appendChild(p);
      var ta = p.querySelector('textarea'), sub = p.querySelector('.sub'), b1 = p.querySelector('.b1');
      p.querySelector('.h span').onclick = function () { p.remove(); };
      p.querySelector('.b2').onclick = function () { abrir(dia); };
      p.querySelector('.fecha').onchange = function () {
        var v = this.value; if (!v) return;
        var x = v.split('-'); abrir(new Date(+x[0], x[1] - 1, +x[2]));
      };
      b1.onclick = function () {
        GM_setClipboard(ta.value, 'text');
        b1.textContent = '✓ Copiado';
        setTimeout(function () { b1.textContent = 'Copiar para WhatsApp'; }, 1800);
      };
      armar(dia).then(function (r) {
        ta.value = r.texto;
        var avisos = [];
        if (r.sinSla) avisos.push('No pude leer los SLA: completá "Casos vencidos" a mano (está con ?)');
        if (r.sinVerif) avisos.push('No pude ver qué casos pasaron hoy a verificación: "resueltos" son los cerrados hoy');
        if (avisos.length) { sub.textContent = avisos.join(' · '); sub.className = 'sub av'; }
        var det = document.createElement('div'); det.className = 'sub'; det.textContent = r.detalle; sub.after(det);   // para revisar qué contó
      }, function (e) {
        ta.value = 'No pude traer los casos.\n\n' + e.message;
      });
    }
    // ---------- resúmenes de período: /semana (y automático los lunes) y /mes (y automático el 1°) ----------
    var DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    function dm(d) { return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2); }
    function deUtc(t) { return t ? new Date(t.replace(' ', 'T') + 'Z') : null; }
    function lunesDe(d) { var l = new Date(d.getTime()); l.setHours(0, 0, 0, 0); l.setDate(l.getDate() - ((l.getDay() + 6) % 7)); return l; }

    // Junta los números de un período [desde, hasta] (fechas locales, días completos)
    function periodo(desde, hasta) {
      var finP = new Date(hasta.getTime()); finP.setHours(23, 59, 59, 999);
      var dentro = function (d) { return d && d >= desde && d <= finP; };
      var ini = "javascript:gs.dateGenerate('" + iso(desde) + "','start')", fin = "javascript:gs.dateGenerate('" + iso(hasta) + "','end')";
      var q = grupoQ() + '^opened_at<=' + fin + '^active=true^ORclosed_at>=' + ini;
      var campos = 'sys_id,number,parent,active,state,priority,opened_at,closed_at,assignment_group,service_offering,cmdb_ci';
      return api('wm_task', q, campos).then(function (casos) {
        var vistos = {};
        casos = casos.filter(function (r) {
          var n = dv(r, 'number'); if (vistos[n] || /cancel/i.test(dv(r, 'state'))) return false; vistos[n] = 1; return true;
        });
        var ids = [], dePadre = {}, porId = {};
        casos.forEach(function (r) {
          ids.push(val(r, 'sys_id')); porId[val(r, 'sys_id')] = dv(r, 'number');
          var p = val(r, 'parent'); if (p) { ids.push(p); dePadre[p] = dv(r, 'number'); }
        });
        var slas = ids.length ? apiIN('task_sla', ids, function (t) { return 'taskIN' + t.join(',') + '^has_breached=true'; }, 'task,sla,stage,planned_end_time,original_breach_time')
          .catch(function () { return null; }) : Promise.resolve([]);
        return Promise.all([Promise.resolve({}), slas]).then(function (res) {   // "Resueltos" ya no va: se muestran los cerrados
          var prim = res[0] || {}, venc = {}, vencAlguna = {};
          (res[1] || []).forEach(function (sv) {
            if (!/neto/i.test(dv(sv, 'sla'))) return;
            if (/cancel/i.test(val(sv, 'stage') + ' ' + dv(sv, 'stage'))) return;   // SLA cancelado: no cuenta
            var d = deUtc(val(sv, 'original_breach_time') || val(sv, 'planned_end_time'));
            var n = porId[val(sv, 'task')] || dePadre[val(sv, 'task')];
            if (n) vencAlguna[n] = 1;                                      // se venció alguna vez (para "en término")
            if (n && dentro(d) && d.getTime() <= Date.now()) venc[n] = 1;
          });
          var calc = function (proy) {
            var r = {ing: 0, res: 0, venc: [], vencBaja: [], vencCli: [], emerg: 0, clientes: [], porDia: {}, vDia: {}, cerr: 0, cerrVenc: 0, cerrTodos: 0};
            casos.forEach(function (c) {
              if (proyecto(c) !== proy) return;
              var n = dv(c, 'number'), ab = deUtc(val(c, 'opened_at'));
              if (dentro(ab)) {
                r.ing++;
                if (/^[12]$/.test(val(c, 'priority')) || /^[12]\b/.test(dv(c, 'priority'))) r.emerg++;
                if (proy === 'lineales') r.clientes.push(cliente(c) || 'otro');
                var k = iso(ab); r.porDia[k] = (r.porDia[k] || 0) + 1;
                if (vencAlguna[n] && !prioBaja(c)) r.vDia[k] = (r.vDia[k] || 0) + 1;   // gráficos: vencidos por día de ingreso
              }
              if (prim[n] && dentro(prim[n].d)) r.res++;
              if (venc[n]) (prioBaja(c) ? r.vencBaja : r.venc).push(dv(c, 'parent') || n);   // baja: aparte, no afecta el % en término
              if (venc[n] && !prioBaja(c) && proy === 'lineales') r.vencCli.push(cliente(c) || 'otro');
              // en término: de los CERRADOS en el período (sin cancelados ni prioridad baja), cuántos sin SLA neto vencido
              if (val(c, 'active') === 'false' && dentro(deUtc(val(c, 'closed_at')))) r.cerrTodos++;   // cerrados en el período (todas las prioridades)
              if (val(c, 'active') === 'false' && dentro(deUtc(val(c, 'closed_at'))) && !prioBaja(c)) {
                r.cerr++;
                if (vencAlguna[n]) r.cerrVenc++;
              }
            });
            r.pct = r.cerr ? Math.round((r.cerr - r.cerrVenc) * 100 / r.cerr) : null;
            return r;
          };
          var cis = contar(casos.filter(function (c) { return dentro(deUtc(val(c, 'opened_at'))) && dv(c, 'cmdb_ci'); })
                                .map(function (c) { return dv(c, 'cmdb_ci'); }))
                    .filter(function (p) { return p[1] > 1; }).sort(function (a, b) { return b[1] - a[1]; });
          return {L: calc('lineales'), G: calc('gpon'), cis: cis, sinVerif: false, sinSla: res[1] === null};
        });
      });
    }
    // textos comunes
    function vencTxtP(r) { return r.venc.length ? r.venc.length + ' / ' + r.venc.join(' / ') : '0'; }
    function vencBajaTxt(r) { return r.vencBaja.length ? ['Vencidos (prioridad baja): ' + esc(r.vencBaja.length + ' / ' + r.vencBaja.join(' / '))] : []; }
    function cumplTxt(r) {
      if (r.pct === null) return 'En término: — (sin cerrados)';
      return 'En término: ' + r.pct + '% (' + (r.cerr - r.cerrVenc) + ' de ' + r.cerr + (r.cerr === 1 ? ' cerrado' : ' cerrados') +
             (r.cerr !== r.cerrTodos ? ', sin prioridad baja)' : ')');
    }
    function diaCargado(r) {
      var top = Object.keys(r.porDia).sort(function (a, b) { return r.porDia[b] - r.porDia[a]; })[0];
      if (!top) return null;
      var x = top.split('-'), dd = new Date(+x[0], x[1] - 1, +x[2]);
      return 'Día más cargado: ' + DIAS_SEM[dd.getDay()] + ' ' + dm(dd) + ' (' + r.porDia[top] + (r.porDia[top] === 1 ? ' caso)' : ' casos)');
    }
    function semanaCargada(r) {
      var porSem = {};
      Object.keys(r.porDia).forEach(function (k) { var x = k.split('-'), l = iso(lunesDe(new Date(+x[0], x[1] - 1, +x[2]))); porSem[l] = (porSem[l] || 0) + r.porDia[k]; });
      var top = Object.keys(porSem).sort(function (a, b) { return porSem[b] - porSem[a]; })[0];
      if (!top) return null;
      var x = top.split('-'), l = new Date(+x[0], x[1] - 1, +x[2]), d = new Date(l.getTime()); d.setDate(d.getDate() + 6);
      return 'Semana más cargada: ' + dm(l) + ' al ' + dm(d) + ' (' + porSem[top] + (porSem[top] === 1 ? ' caso)' : ' casos)');
    }
    function vencCliTxt(r) {             // "Vencidos por cliente: 2 CLR · 1 EDN" (solo Lineales, sin prioridad baja)
      return r.vencCli && r.vencCli.length ? ['Vencidos por cliente: ' + esc(contar(r.vencCli).sort(function (a, b) { return b[1] - a[1]; })
                                                 .map(function (p) { return p[1] + ' ' + p[0]; }).join(' · '))] : [];
    }
    function porCliente(r) {
      return r.clientes.length ? 'Por cliente: ' + esc(contar(r.clientes).sort(function (a, b) { return b[1] - a[1]; })
                                                   .map(function (p) { return p[1] + ' ' + p[0]; }).join(' · ')) : null;
    }
    function avisosDatos(d) {
      var o = [];
      if (d.sinVerif) o.push('⚠️ <i>No pude ver los pases a verificación: "Resueltos" puede estar incompleto</i>');
      if (d.sinSla) o.push('⚠️ <i>No pude leer los SLA: "Vencidos" queda incompleto</i>');
      return o.length ? ['', o.join('\n')] : [];
    }
    var SEP = ['', '━━━━━━━━━━━━━━━━━━━━', ''];

    // Semana de lunes a domingo. Sin fecha: la semana pasada (el automático de los lunes). Con fecha: la semana que
    // la contiene (/semana a mano pasa hoy = semana en curso, del lunes hasta hoy).
    function semana(fechaRef) {
      var ref = fechaRef ? new Date(fechaRef.getTime()) : new Date(Date.now() - 7 * 864e5);
      var lunes = lunesDe(ref), domingo = new Date(lunes.getTime()); domingo.setDate(domingo.getDate() + 6);
      return periodo(lunes, domingo).then(function (d) {
        var L = d.L, G = d.G, hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
        var encurso = domingo >= hoy0;           // semana en curso: va del lunes hasta hoy
        ultimo = {tipo: 'semana', desde: lunes, hasta: encurso ? hoy0 : domingo, hastaTitulo: domingo, L: L, G: G};
        var out = ['📅 <b>Resumen semanal</b> · ' + dm(lunes) + ' al ' + (encurso ? dm(hoy0) + ' <i>(semana en curso)</i>' : dm(domingo)), '', '🔧 <b>Lineales</b>', '',
                   'Ingresados: ' + L.ing, 'Cerrados: ' + L.cerrTodos, 'Vencidos: ' + esc(vencTxtP(L))].concat(vencCliTxt(L), vencBajaTxt(L), [cumplTxt(L)]);
        if (porCliente(L)) out.push(porCliente(L));
        if (diaCargado(L)) out.push(diaCargado(L));
        out = out.concat(SEP, ['📡 <b>GPON</b>', '', 'Ingresados: ' + G.ing, 'Cerrados: ' + G.cerrTodos, 'Vencidos: ' + esc(vencTxtP(G))], vencBajaTxt(G), [cumplTxt(G),
                               'Emergencias (P1/P2): ' + G.emerg]);
        if (diaCargado(G)) out.push(diaCargado(G));
        var cis = d.cis.slice(0, 5);
        if (cis.length) { out = out.concat(SEP, ['🔁 <b>CIs que más se repitieron</b>']); cis.forEach(function (p) { out.push('• ' + esc(p[0]) + ' · ' + p[1] + ' casos'); }); }
        return out.concat(avisosDatos(d)).join('\n');
      });
    }

    // Mes calendario. Sin fecha: el mes pasado (el automático del 1°). Con fecha: ese mes (/mes a mano = mes en curso).
    // Compara con el mes anterior.
    function mes(fechaRef) {
      var hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
      var ref = fechaRef ? new Date(fechaRef.getTime()) : new Date(hoy0.getFullYear(), hoy0.getMonth() - 1, 1);
      var ini = new Date(ref.getFullYear(), ref.getMonth(), 1), fin = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      var encurso = fin >= hoy0;
      var iniAnt = new Date(ini.getFullYear(), ini.getMonth() - 1, 1), finAnt = new Date(ini.getFullYear(), ini.getMonth(), 0);
      return Promise.all([periodo(ini, encurso ? hoy0 : fin), periodo(iniAnt, finAnt).catch(function () { return null; })]).then(function (r) {
        var d = r[0], a = r[1], L = d.L, G = d.G, mesAnt = MESES[iniAnt.getMonth()];
        ultimo = {tipo: 'mes', desde: ini, hasta: encurso ? hoy0 : fin, L: L, G: G};
        var cmp = function (x, y, pts) {             // ▲ / ▼ / = contra el mes anterior
          if (y === null || y === undefined || x === null) return '';
          var dif = x - y;
          return ' <i>(' + (dif > 0 ? '▲ ' + dif : dif < 0 ? '▼ ' + (-dif) : '=') + (pts && dif ? ' pts' : '') + ' vs ' + mesAnt + ')</i>';
        };
        var bloque = function (p, pa, gpon) {
          var o = ['Ingresados: ' + p.ing + cmp(p.ing, pa && pa.ing), 'Cerrados: ' + p.cerrTodos + cmp(p.cerrTodos, pa && pa.cerrTodos), 'Vencidos: ' + esc(vencTxtP(p))]
                  .concat(vencCliTxt(p), vencBajaTxt(p), [cumplTxt(p) + cmp(p.pct, pa && pa.pct, true)]);
          if (gpon) o.push('Emergencias (P1/P2): ' + p.emerg);
          else if (porCliente(p)) o.push(porCliente(p));
          if (semanaCargada(p)) o.push(semanaCargada(p));
          if (diaCargado(p)) o.push(diaCargado(p));
          return o;
        };
        var out = ['🗓️ <b>Resumen mensual</b> · ' + MESES[ini.getMonth()] + ' ' + ini.getFullYear() + (encurso ? ' <i>(hasta hoy ' + dm(hoy0) + ')</i>' : ''),
                   '', '🔧 <b>Lineales</b>', ''].concat(bloque(L, a && a.L), SEP, ['📡 <b>GPON</b>', ''], bloque(G, a && a.G, true));
        var cis = d.cis.slice(0, 5);
        if (cis.length) { out = out.concat(SEP, ['🔁 <b>CIs que más se repitieron</b>']); cis.forEach(function (p) { out.push('• ' + esc(p[0]) + ' · ' + p[1] + ' casos'); }); }
        return out.concat(avisosDatos(d)).join('\n');
      });
    }
    function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    if (window.top === window.self) montar();
    var ultimo = null;                     // datos del último /semana o /mes (para los gráficos)
    return {armar: armar, semana: semana, mes: mes, ultimoGraf: function () { return ultimo; }, limpiarGraf: function () { ultimo = null; }};
  })();
  // ---------------------------------------------------------------- gráficos de /semana y /mes (una foto por proyecto)
  // Barras por día con los casos INGRESADOS ese día; la parte roja son los de esos que se vencieron (SLA neto, sin prioridad baja).
  // Se dibujan en un canvas en la misma pestaña y van a Telegram como foto, antes del texto.
  var GRAF = (function () {
    var TX = '#1f2937', MU = '#6b7280', GR = '#e5e7eb', RED = '#dc2626', FUENTE = '"Segoe UI", Roboto, Arial, sans-serif';
    var DSEM = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    function dd(d) { return ('0' + d.getDate()).slice(-2); }
    function ddmm(d) { return dd(d) + '/' + ('0' + (d.getMonth() + 1)).slice(-2); }
    function isoD(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + dd(d); }
    function pct(a, b) { return a ? Math.round(100 * b / a) : 0; }
    function lienzo(w, h) {
      var c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
      var x = c.getContext('2d'); x.scale(2, 2); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.textBaseline = 'alphabetic';
      return {c: c, x: x};
    }
    function texto(x, t, px, py, tam, color, peso, alin) {
      x.font = (peso || '400') + ' ' + tam + 'px ' + FUENTE; x.fillStyle = color; x.textAlign = alin || 'left'; x.fillText(t, px, py);
      return x.measureText(t).width;
    }
    function rect(x, px, py, w, h, color, r) {
      if (h <= 0 || w <= 0) return;
      x.fillStyle = color; r = Math.min(r || 0, w / 2, h / 2); x.beginPath();
      if (x.roundRect) x.roundRect(px, py, w, h, r); else x.rect(px, py, w, h);
      x.fill();
    }
    function chip(x, cx, cy, ing, ven) {   // % EN TÉRMINO (ingresados que no se vencieron): verde 100, amarilla más de 80, roja 80 o menos
      if (!ing) { texto(x, '—', cx, cy, 12, MU, '400', 'center'); return; }
      var p = 100 - pct(ing, ven);
      var bg = p <= 80 ? '#fee2e2' : p < 100 ? '#fef3c7' : '#dcfce7', fg = p <= 80 ? '#991b1b' : p < 100 ? '#92400e' : '#166534';
      rect(x, cx - 23, cy - 14, 46, 20, bg, 10); texto(x, p + '%', cx, cy, 11.5, fg, '700', 'center');
    }
    function leyenda(x, color, conFinde) {
      var px = 24, items = [[color, 'En término'], [RED, 'Vencidos']].concat(conFinde ? [['#f1f5f9', 'Fin de semana']] : []);
      items.forEach(function (it) {
        rect(x, px, 72, 12, 12, it[0], 2); if (it[0] === '#f1f5f9') { x.strokeStyle = '#cbd5e1'; x.strokeRect(px + 0.5, 72.5, 11, 11); }
        px += 18 + texto(x, it[1], px + 18, 83, 12.5, TX) + 20;
      });
      if (!conFinde) texto(x, '% = en término sobre ingresados', px, 83, 12.5, MU);
    }
    // datos: {proy, color, dias: [Date], ing: [n], ven: [n], titulo}
    function barras(x, dt, x0, y0, x1, y1, mes) {
      var vmax = Math.max(4, Math.ceil((Math.max.apply(null, dt.ing.concat([0])) + 1) / 4) * 4), n = dt.dias.length, cw = (x1 - x0) / n, bw = cw * (mes ? 0.66 : 0.5);
      if (mes) dt.dias.forEach(function (d, i) { if (d.getDay() === 0 || d.getDay() === 6) rect(x, x0 + cw * i, y0 - 6, cw, y1 - y0 + 6, '#f1f5f9'); });
      for (var v = 0; v <= vmax; v += vmax / 4) {
        var y = y1 - (y1 - y0) * v / vmax; x.fillStyle = GR; x.fillRect(x0, Math.round(y), x1 - x0, 1);
        texto(x, String(v), x0 - 8, y + 4, 11, MU, '400', 'right');
      }
      dt.dias.forEach(function (d, i) {
        var cx = x0 + cw * i + cw / 2, ht = (y1 - y0) * dt.ing[i] / vmax, hv = (y1 - y0) * dt.ven[i] / vmax;
        rect(x, cx - bw / 2, y1 - ht, bw, ht, dt.color, mes ? 2 : 4);
        if (dt.ven[i]) { rect(x, cx - bw / 2, y1 - hv, bw, hv, RED, 0); if (!mes && hv >= 14) texto(x, String(dt.ven[i]), cx, y1 - hv / 2 + 4, 11.5, '#fff', '700', 'center'); }
        if (dt.ing[i]) texto(x, String(dt.ing[i]), cx, y1 - ht - (mes ? 4 : 6), mes ? 9.5 : 12, TX, mes ? '400' : '700', 'center');
        if (mes) { if (i === 0 || (d.getDate()) % 5 === 0) texto(x, String(d.getDate()), cx, y1 + 16, 11, MU, '400', 'center'); }
        else { texto(x, DSEM[d.getDay()] + ' ' + dd(d), cx, y1 + 20, 12, MU, '400', 'center'); if (dt.falta && dt.falta[i]) texto(x, '—', cx, y1 + 42, 12, MU, '400', 'center'); else chip(x, cx, y1 + 42, dt.ing[i], dt.ven[i]); }
      });
    }
    function pie(x, dt, y, cuando) {
      var ti = dt.ing.reduce(function (a, b) { return a + b; }, 0), tv = dt.ven.reduce(function (a, b) { return a + b; }, 0), px = 24;
      px += texto(x, 'Ingresados ' + ti, px, y, 14, TX, '700'); px += texto(x, '  ·  ', px, y, 14, TX);
      px += texto(x, 'Vencidos ' + tv, px, y, 14, RED, '700'); px += texto(x, '  ·  ', px, y, 14, TX);
      texto(x, (ti ? 100 - pct(ti, tv) : 100) + '% en término en ' + cuando, px, y, 14, TX, '700');
    }
    function fotoSemana(dt) {
      var L = lienzo(640, 440), x = L.x;
      texto(x, dt.titulo, 24, 36, 20, TX, '700');
      texto(x, 'Casos ingresados por día: la parte roja son los que se vencieron', 24, 58, 13, MU);
      leyenda(x, dt.color, false);
      barras(x, dt, 50, 110, 620, 350, false);
      pie(x, dt, 425, 'la semana');
      return L.c;
    }
    function fotoMes(dt) {
      // fines de semana del período: pares sábado + domingo (o el que caiga dentro)
      var findes = [], hab = {d: 0, i: 0, v: 0}, fin = {d: 0, i: 0, v: 0};
      dt.dias.forEach(function (d, i) {
        var f = d.getDay() === 0 || d.getDay() === 6, t = f ? fin : hab; t.d++; t.i += dt.ing[i]; t.v += dt.ven[i];
        if (!f) return;
        var ult = findes[findes.length - 1];
        if (d.getDay() === 0 && ult && ult.sab && (d - ult.sab) < 2 * 864e5) { ult.dom = d; ult.i += dt.ing[i]; ult.v += dt.ven[i]; }
        else findes.push({sab: d.getDay() === 6 ? d : null, dom: d.getDay() === 0 ? d : null, i: dt.ing[i], v: dt.ven[i]});
      });
      var h = 534 + findes.length * 22, L = lienzo(640, h), x = L.x;
      texto(x, dt.titulo, 24, 36, 20, TX, '700');
      texto(x, 'Casos ingresados por día: la parte roja son los que se vencieron', 24, 58, 13, MU);
      leyenda(x, dt.color, true);
      barras(x, dt, 50, 100, 620, 330, true);
      pie(x, dt, 368, 'el mes');
      x.fillStyle = GR; x.fillRect(24, 388, 592, 1);
      texto(x, 'Fines de semana', 24, 414, 15, TX, '700');
      [[hab, 'Días hábiles (prom. por día)', 24], [fin, 'Fines de semana (prom. por día)', 326]].forEach(function (t) {
        rect(x, t[2], 428, 290, 58, '#f8fafc', 10); x.strokeStyle = GR; x.strokeRect(t[2] + 0.5, 428.5, 289, 57);
        texto(x, t[1], t[2] + 14, 450, 12, MU);
        texto(x, (t[0].d ? (t[0].i / t[0].d).toFixed(1).replace('.', ',') : '0') + ' ingresados', t[2] + 14, 476, 15, TX, '700');
        chip(x, t[2] + 249, 474, t[0].i, t[0].v);
      });
      var y = 514;
      texto(x, 'Fin de semana', 24, y, 11.5, MU); texto(x, 'Ingresados', 250, y, 11.5, MU); texto(x, 'Vencidos', 360, y, 11.5, MU); texto(x, 'En término', 446, y, 11.5, MU);
      findes.forEach(function (f) {
        y += 22;
        var lab = f.sab && f.dom ? 'Sáb ' + dd(f.sab) + ' y Dom ' + ddmm(f.dom) : f.sab ? 'Sáb ' + ddmm(f.sab) : 'Dom ' + ddmm(f.dom);
        texto(x, lab, 24, y, 13, TX); texto(x, String(f.i), 250, y, 13, TX, '700'); texto(x, String(f.v), 360, y, 13, RED, '700');
        chip(x, 469, y + 1, f.i, f.v);
      });
      return L.c;
    }
    // g: {tipo: 'semana'|'mes', desde, hasta, L, G} (L y G con porDia y vDia por fecha ISO). Devuelve [{blob, nombre}]
    function armar(g) {
      var dias = [];
      var hastaDib = g.tipo === 'semana' && g.hastaTitulo ? g.hastaTitulo : g.hasta;     // semana en curso: los 7 días igual (los que faltan, vacíos)
      for (var d = new Date(g.desde.getTime()); d <= hastaDib; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dias.push(d);
      var MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      var cuando = g.tipo === 'mes' ? MES[g.desde.getMonth()].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + g.desde.getFullYear()
                                    : 'Semana ' + ddmm(g.desde) + ' al ' + ddmm(g.hastaTitulo || g.hasta);
      var fotos = [['Lineales', '#2563eb', g.L], ['GPON', '#8b5cf6', g.G]].map(function (p) {
        var dt = {proy: p[0], color: p[1], dias: dias, titulo: p[0] + ' · ' + cuando, falta: dias.map(function (d) { return d > g.hasta; }),
                  ing: dias.map(function (d) { return p[2].porDia[isoD(d)] || 0; }), ven: dias.map(function (d) { return p[2].vDia[isoD(d)] || 0; })};
        return {nombre: p[0], canvas: g.tipo === 'mes' ? fotoMes(dt) : fotoSemana(dt), cuando: cuando};
      });
      return Promise.all(fotos.map(function (f) {
        return new Promise(function (ok, mal) { f.canvas.toBlob(function (b) { if (b) ok({blob: b, nombre: f.nombre, cuando: f.cuando}); else mal(new Error('no pude dibujar el gráfico')); }, 'image/png'); });
      }));
    }
    return {armar: armar};
  })();
  // manda una foto (blob PNG) al grupo o al chat del pedido
  function tgFoto(chat, blob, caption, responderA) {
    return new Promise(function (ok, mal) {
      var fd = new FormData();
      fd.append('chat_id', String(chat)); fd.append('photo', blob, 'grafico.png');
      if (caption) { fd.append('caption', caption); fd.append('parse_mode', 'HTML'); }
      if (responderA) { fd.append('reply_to_message_id', String(responderA)); fd.append('allow_sending_without_reply', 'true'); }
      GM_xmlhttpRequest({method: 'POST', url: 'https://api.telegram.org/bot' + GM_getValue('tg_token', '') + '/sendPhoto', data: fd, timeout: 30000,
        onload: function (r) { var j = {}; try { j = JSON.parse(r.responseText); } catch (e) {} if (j.ok) ok(j.result); else mal(new Error(j.description || ('error ' + r.status))); },
        ontimeout: function () { mal(new Error('Telegram tardó demasiado')); }, onerror: function () { mal(new Error('sin conexión con Telegram')); }});
    });
  }
  // primero los gráficos (si se pudieron armar), después el texto de siempre. Si los gráficos fallan, el texto sale igual.
  function conGraficos(p, texto, alTerminar) {
    var g = RESUMEN.ultimoGraf(), chat = p.chat || GM_getValue('tg_chat');
    var fotos = g ? GRAF.armar(g).then(function (fs) {
      return fs.reduce(function (cad, f) {
        return cad.then(function () { return tgFoto(chat, f.blob, '📊 <b>' + f.nombre + '</b> · ' + esc(f.cuando.replace(/^Semana/, 'semana')), p.msg); });
      }, Promise.resolve());
    }).catch(function (e) { botLog('gráficos: ' + e.message); }) : Promise.resolve();
    fotos.then(function () { unaVezAlGrupo('cmd:' + p.id, texto, p.msg, p.chat, alTerminar); });
  }
  // el resumen para Telegram: va en un recuadro que se copia con un toque, tal cual (con los * de WhatsApp)
  // "/status", "/status 09-04-2026", "/status 9/4" (sin año = este año)
  function fechaDeTexto(t) {
    var m = /(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/.exec(t || '');
    if (!m) return null;
    var a = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : new Date().getFullYear();
    var d = new Date(a, +m[2] - 1, +m[1]);
    return d.getDate() === +m[1] && d.getMonth() === +m[2] - 1 ? d : 'mal';
  }
  function resumenTelegram(arg) {
    var f = fechaDeTexto(arg);
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    if (f === 'mal') return Promise.resolve('No entendí la fecha. Usalo así: <code>/status 09-04-2026</code>');
    if (f && f > hoy) return Promise.resolve('Esa fecha todavía no llegó 🙂');
    var solo = filtroBandeja('/status ' + arg);     // /status gpon · /status lineales (se puede combinar con la fecha)
    return RESUMEN.armar(f || undefined, solo).then(function (r) {
      var t = '<pre>' + esc(r.texto) + '</pre>';
      var notas = [];
      if (r.sinSla) notas.push('No pude leer los SLA: "Casos vencidos" queda con ?');
      if (r.sinVerif) notas.push('No pude ver los pases a verificación: "resueltos" son los cerrados hoy');
      var titulo = r.hoy ? '📊 <b>Resumen del día' + (solo ? ' · ' + solo : '') + '</b>' : '📊 <b>Resumen del ' + ('0' + r.dia.getDate()).slice(-2) + '/' + ('0' + (r.dia.getMonth() + 1)).slice(-2) + '/' + r.dia.getFullYear() + (solo ? ' · ' + solo : '') + '</b>\n<i>(acumulados, pausados y en mano no se pueden saber de días anteriores)</i>';
      return titulo + '\n\n<i>Tocá el recuadro para copiarlo y pegalo en WhatsApp</i>\n⚠️ <b>Reporte creado por BOT, revisar antes de enviar</b>\n\n' + t +
             (notas.length ? '\n\n⚠️ <i>' + esc(notas.join(' · ')) + '</i>' : '');
    });
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
  // La pestaña que recarga el Refrescador (Pending Dispatch) no trabaja si hay otra de ServiceNow abierta en la PC:
  // una recarga en el medio corta las consultas largas (notas, /semana, /mes).
  function meRefresca() { try { return !!sessionStorage.getItem('mobisond_refresca'); } catch (e) { return false; } }
  function anotarPestaña() {
    var ahora = Date.now(), ps = GM_getValue('pestanas', {}), nuevo = {};
    Object.keys(ps).forEach(function (k) { if (ahora - ps[k].t < 15000) nuevo[k] = ps[k]; });
    if (window.top === window.self && token()) nuevo[MI_TAB] = {t: ahora, refresca: meRefresca()};
    else delete nuevo[MI_TAB];
    GM_setValue('pestanas', nuevo);
    return nuevo;
  }
  function hayOtraQuieta(ps) {
    return Object.keys(ps).some(function (k) { return k !== MI_TAB && !ps[k].refresca; });
  }
  // Marcas en el título (después del segundero del Refrescador): 🔔 = vigila la lista de casos nuevos, 🤖 Bot = atiende el bot
  // Marcas compartidas con el script de Alexa, siempre en este orden después del segundero del Refrescador:
  // 🔔 (casos nuevos al grupo) · 🔊/🔇 (Alexa) · 🤖 Bot · (atiende el bot). Cada script toca solo la suya.
  var MARCAS = ['🔔 ', '🔊 ', '🔇 ', '🤖 Bot · '];
  function marcarTitulo(lider) {
    if (window.top !== window.self) return;
    var t = document.title || '';
    var m = t.match(/^(\(\d+ s\)|\(⏸\)|\(sin conexión\)|⚠ SESIÓN CERRADA ·)\s*/), pre = m ? m[0] : '', resto = t.slice(pre.length), hay = {}, seguir = true;
    while (seguir) { seguir = false; MARCAS.forEach(function (k) { if (resto.indexOf(k) === 0) { hay[k] = 1; resto = resto.slice(k.length); seguir = true; } }); }
    delete hay['🔔 ']; delete hay['🤖 Bot · '];
    if (vigilada()) hay['🔔 '] = 1;
    if (lider) hay['🤖 Bot · '] = 1;
    var nuevo = pre + MARCAS.filter(function (k) { return hay[k]; }).join('') + resto;
    if (nuevo !== t) document.title = nuevo;
  }
  function soyLider() {
    var r = soyLider2();
    marcarTitulo(r);
    return r;
  }
  function soyLider2() {
    if (window.top !== window.self) return false;      // solo la ventana principal (no los marcos de adentro)
    if (!token()) return false;                         // y que tenga la sesión de ServiceNow a mano para consultar
    if (sesionCaida()) return false;                    // sesión vencida (401): no atiende hasta que vuelva
    if (noAtiende()) return false;                      // se le sacó con "Dejar de vigilar"
    var ps = anotarPestaña(), yoRefresco = meRefresca();
    var elegida = GM_getValue('bot_elegida', '');          // la que se eligió desde el menú (mientras siga abierta)
    if (elegida && elegida !== MI_TAB && ps[elegida]) return false;
    var mia = elegida === MI_TAB;
    if (!mia && yoRefresco && hayOtraQuieta(ps)) return false;  // hay otra pestaña que no se recarga: que trabaje ella
    var l = GM_getValue('lider', null), ahora = Date.now();
    if (mia || !l || l.id === MI_TAB || ahora - l.t > 15000 || (l.refresca && !yoRefresco)) {
      GM_setValue('lider', {id: MI_TAB, t: ahora, refresca: yoRefresco}); return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- /pcs: cada pestaña le cuenta a Supabase su versión y usuario
  function infoPC() {
    if (window.top !== window.self || !token() || sesionCaida() || !hayGrupo()) return;
    var u = GM_getValue('sn_usuario', null);
    var mandar = function (nombre) {
      sbRpc('bot_pc_info_guardar', {p_pc: pcId(), p_version: typeof GM_info !== 'undefined' ? GM_info.script.version : '',
                                    p_usuario: nombre || '', p_lista: !!vigilada()}).catch(function () {});
    };
    if (u && Date.now() - u.t < 6 * 3600000) return mandar(u.nombre);    // el usuario se vuelve a mirar cada 6 h
    api('sys_user', 'sys_id=javascript:gs.getUserID()', 'name,user_name').then(function (rs) {
      var nombre = rs[0] ? (dv(rs[0], 'name') || dv(rs[0], 'user_name')) : '';
      GM_setValue('sn_usuario', {nombre: nombre, t: Date.now()}); mandar(nombre);
    }, function () { mandar(u && u.nombre); });
  }
  setTimeout(infoPC, 8000);
  setInterval(infoPC, 60000);

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
