// ==UserScript==
// @name         Mobisond · Aviso de casos por Alexa
// @namespace    mobisond
// @version      1.3
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

  // ---------------------------------------------------------------- menú de Tampermonkey
  GM_registerMenuCommand('Alexa: vigilar esta lista', function () {
    var k = claveLista();
    if (!k) { alert('Abrí la lista de ServiceNow (la de Pending Dispatch) y volvé a elegir esta opción.'); return; }
    GM_setValue('lista', k);
    GM_setValue('lista_titulo', (document.title || '').replace(/\s*\|\s*ServiceNow\s*$/i, '').trim());
    GM_setValue('vistos2', {});
    GM_setValue('base', false);
    revisar();                         // los casos que ya están no avisan; solo los que entren desde ahora
    var n = (filas() || []).length;
    alert('Listo: vigilo esta lista (' + n + ' casos ahora). Alexa va a anunciar los que entren desde ahora.');
  });
  GM_registerMenuCommand('Alexa: simular caso nuevo (con el primero de la lista)', function () {
    var f = (filas() || [])[0];
    if (!f) { alert('No veo casos en esta lista para simular.'); return; }
    alexa(fraseAlexa(f), function (msg) { if (!/Listo/.test(msg)) alert(msg); });
  });
  // "Probar todo" del avisador: Alexa también habla (si está configurada en esta PC)
  document.addEventListener('mobisond-probar-todo', function () {
    if (!GM_getValue('vm_token', '')) return;
    var f = (filas() || [])[0];
    alexa(f ? fraseAlexa(f) : 'Prueba de Mobisond. Si me escuchás, Alexa anda.', function (msg) { if (!/Listo/.test(msg)) alert(msg); });
  });
  GM_registerMenuCommand('Alexa: configurar', function () {
    var t = prompt('Token de la API de Voice Monkey (lo ves en voicemonkey.io, sección API):', GM_getValue('vm_token', ''));
    if (t === null) return;
    var d = prompt('ID del dispositivo Speaker de Voice Monkey (por ejemplo: eco-cocina):', GM_getValue('vm_device', ''));
    if (d === null) return;
    var s = prompt('Horario en que Alexa NO habla, como "0-7" (de 0 a 7 h). Vacío = habla siempre:',
                   GM_getValue('vm_silencio_desde', -1) >= 0 ? GM_getValue('vm_silencio_desde') + '-' + GM_getValue('vm_silencio_hasta') : '');
    GM_setValue('vm_token', t.trim()); GM_setValue('vm_device', d.trim()); GM_setValue('vm_activo', true);
    var m = (s || '').match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
    GM_setValue('vm_silencio_desde', m ? +m[1] : -1); GM_setValue('vm_silencio_hasta', m ? +m[2] : -1);
    alexa('Hola, soy el aviso de casos de Mobisond.', function (msg) { alert(msg); });
  });
  GM_registerMenuCommand('Alexa: probar', function () {
    alexa('Prueba de Mobisond. Si me escuchás, los avisos por Alexa funcionan.', function (msg) { alert(msg); });
  });
  GM_registerMenuCommand('Alexa: activar / desactivar', function () {
    var on = !GM_getValue('vm_activo', true); GM_setValue('vm_activo', on);
    alert(on ? 'Alexa va a anunciar los casos nuevos.' : 'Alexa ya no anuncia los casos.');
  });
  GM_registerMenuCommand('Alexa: ¿Qué lista vigilo?', function () {
    var k = GM_getValue('lista', ''), tit = GM_getValue('lista_titulo', '');
    if (!k) { alert('No estoy vigilando ninguna lista. Abrí la de Pending Dispatch y elegí "Alexa: vigilar esta lista".'); return; }
    if (vigilada()) {
      alert('SÍ: esta pestaña es la que vigilo (' + (filas() || []).length + ' casos ahora).' + (tit ? '\n' + tit : ''));
    } else {
      alert('NO: esta pestaña no es la vigilada.' + (tit ? '\nVigilo: ' + tit : '') +
            '\n(Tabla ' + k.split('|')[0] + (claveLista() && claveLista().split('|')[0] === k.split('|')[0] ? ', misma tabla pero otro filtro' : '') + ')');
    }
  });
  GM_registerMenuCommand('Alexa: dejar de vigilar', function () { GM_setValue('lista', ''); alert('Ya no vigilo ninguna lista.'); });

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
