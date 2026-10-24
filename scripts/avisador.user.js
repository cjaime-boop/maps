// ==UserScript==
// @name         Mobisond · Aviso de casos nuevos (ServiceNow → celular)
// @namespace    mobisond
// @version      2.6
// @description  Cuando entra un caso nuevo en la lista que vigilás de ServiceNow, te llega una notificación al celular (app ntfy) y a la PC. (Alexa va en otro script.)
// @match        https://*.service-now.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_openInTab
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
  function alGrupo(f) {
    if (!hayGrupo()) return;
    var canalG = canalGrupo();
    GM_xmlhttpRequest({method: 'GET', url: canalG + '/json?poll=1&since=6h', timeout: 10000,
      onload: function (r) {
        if (r.responseText.indexOf('"message":"' + f.id + '"') >= 0) return;      // otra PC ya lo mandó
        GM_xmlhttpRequest({method: 'POST', url: canalG, data: f.id, timeout: 10000});
        tg('sendMessage', {chat_id: GM_getValue('tg_chat'), text: mensajeGrupo(f), parse_mode: 'HTML', disable_web_page_preview: true});
      },
      onerror: function () { tg('sendMessage', {chat_id: GM_getValue('tg_chat'), text: mensajeGrupo(f), parse_mode: 'HTML', disable_web_page_preview: true}); }});
  }
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
  GM_registerMenuCommand('Mi canal del celular', function () {
    var nuevo = prompt('Este es tu canal. En la app ntfy del celular tocá "+" y suscribite a este nombre ' +
                       '(si ya tenés uno, podés pegarlo acá y Aceptar):', canal());
    if (nuevo && nuevo.trim() && nuevo.trim() !== canal()) {
      GM_setValue('canal', nuevo.trim().replace(/[^\w-]/g, ''));
      alert('Listo, ahora aviso al canal: ' + GM_getValue('canal') + '\nRecargá la página para que tome el cambio.');
    }
  });
  GM_registerMenuCommand('Abrir la campana de la PC', abrirCampana);
  GM_registerMenuCommand('Mandar aviso de prueba', function () {
    aviso('Prueba Mobisond', 'Si te llegó esto, los avisos de casos nuevos funcionan.', location.href, 3);
  });
  GM_registerMenuCommand('Simular caso nuevo (con el primero de la lista)', function () {
    var f = (filas() || [])[0];
    if (!f) { alert('No veo casos en esta lista para simular.'); return; }
    aviso('Entró ' + f.numero + ' (simulacro)', texto(f), f.link, 4);
  });
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
  GM_registerMenuCommand('Grupo de Telegram', configurarGrupo);
  GM_registerMenuCommand('Mandar prueba al grupo', function () {
    if (!hayGrupo()) { alert('Primero configurá el grupo (menú "Grupo de Telegram").'); return; }
    var f = (filas() || [])[0] || {numero: 'WO0000000', datos: {short_description: 'Caso de prueba'}, link: location.href};
    tg('sendMessage', {chat_id: GM_getValue('tg_chat'), text: mensajeGrupo(f, true), parse_mode: 'HTML', disable_web_page_preview: true},
       function () { alert('Prueba mandada al grupo.'); }, function (e) { alert('No se pudo: ' + e); });
  });
  GM_registerMenuCommand('Dejar de vigilar', function () { GM_setValue('lista', ''); alert('Ya no vigilo ninguna lista.'); });

  // ---------------------------------------------------------------- cuándo revisar
  if (!claveLista()) return;
  revisar();
  var espera = null;
  new MutationObserver(function () {
    clearTimeout(espera);
    espera = setTimeout(revisar, 1500);
  }).observe(document.body, {childList: true, subtree: true});
  setInterval(revisar, 5000);
})();
