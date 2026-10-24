// ==UserScript==
// @name         Mobisond · Resumen de turno (WhatsApp)
// @namespace    mobisond
// @version      1.3
// @description  Arma el mensaje de fin de turno (Lineales y GPON) con los números del día, listo para pegar en WhatsApp.
// @match        https://*.service-now.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @updateURL    https://cjaime-boop.github.io/maps/scripts/resumen.user.js
// @downloadURL  https://cjaime-boop.github.io/maps/scripts/resumen.user.js
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  if (window.top !== window.self) return;          // solo en la ventana principal, no en los marcos de adentro

  var GRUPOS = {lineales: 'C-TL-MOBISOND', gpon: 'C-GZ1-MOBI'};
  // Cliente: sale del Service offering (TSO_C_TL_<cliente>_<zona>_BA)
  var CLIENTES = {CL: 'CLR', EDNR: 'EDN', MUNI: 'MUNI', TP: 'TP'};   // cómo se escribe cada cliente en "Casos en mano"
  var VERIFICACION = /verificaci[oó]n del cliente/i;

  var HOY = '@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()';

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

  function armar() {
    var g = grupoQ();
    // casos del día: los que entraron hoy, los que se cerraron hoy y todo lo que sigue abierto
    var q = g + '^opened_atON' + 'Today' + HOY +
            '^NQ' + g + '^closed_atON' + 'Today' + HOY +
            '^NQ' + g + '^active=true';
    var campos = 'sys_id,number,parent,active,state,substate,u_pause_reason,priority,opened_at,closed_at,assignment_group,service_offering,cmdb_ci';
    return api('wm_task', q, campos).then(function (casos) {
      var vistos = {};
      casos = casos.filter(function (r) { var n = dv(r, 'number'); if (vistos[n]) return false; vistos[n] = 1; return true; });
      if (!casos.length) return {casos: casos, vencidos: {}};
      // SLA vencido hoy: puede estar en la WOT o en su WO padre
      var ids = [], dePadre = {};
      casos.forEach(function (r) {
        if (!esHoy(val(r, 'opened_at'))) return;   // vencidos: solo los casos creados hoy (no los de arrastre)
        ids.push(val(r, 'sys_id'));
        var p = val(r, 'parent'); if (p) { ids.push(p); dePadre[p] = dv(r, 'number'); }
      });
      if (!ids.length) return {casos: casos, vencidos: {}};
      var qs = 'taskIN' + ids.join(',') + '^has_breached=true';
      return api('task_sla', qs, 'task,has_breached,planned_end_time').then(function (slas) {
        var porId = {};
        casos.forEach(function (r) { porId[val(r, 'sys_id')] = dv(r, 'number'); });
        var venc = {};
        slas.forEach(function (s) { var t = val(s, 'task'); var n = porId[t] || dePadre[t]; if (n) venc[n] = 1; });
        return {casos: casos, vencidos: venc};
      }, function () { return {casos: casos, vencidos: null}; });   // si no deja leer los SLA, se completa a mano
    }).then(function (d) { return texto(d.casos, d.vencidos); });
  }

  function calcular(casos, venc, proy) {
    var r = {ingresados: 0, resueltos: 0, acumulados: 0, verificacion: 0, pausas: [], sinAtender: 0, claroSin: 0,
             enMano: [], vencidos: 0, emergencia: false};
    casos.forEach(function (c) {
      if (proyecto(c) !== proy) return;
      if (/cancel/i.test(dv(c, 'state'))) return;   // los cancelados no cuentan para nada
      var n = dv(c, 'number');
      var abierto = !cerrado(c);
      if (val(c, 'opened_at') && esHoy(val(c, 'opened_at'))) {
        r.ingresados++;
        if (/^[12]\b/.test(dv(c, 'priority')) || /^[12]$/.test(val(c, 'priority'))) r.emergencia = true;
      }
      if (!abierto && val(c, 'closed_at') && esHoy(val(c, 'closed_at')) && !/cancel/i.test(dv(c, 'state'))) r.resueltos++;
      if (venc && venc[n] && esHoy(val(c, 'opened_at'))) r.vencidos++;
      if (!abierto) return;
      r.acumulados++;
      var pausa = dv(c, 'u_pause_reason').trim();
      var estado = dv(c, 'state');
      if (pausa && VERIFICACION.test(pausa)) r.verificacion++;
      else if (pausa) r.pausas.push(pausa);
      else if (/work in progress|en curso/i.test(estado)) r.enMano.push(cliente(c));
      else { r.sinAtender++; if (cliente(c) === 'CLR') r.claroSin++; }
    });
    if (!venc) r.vencidos = '?';
    return r;
  }

  // opened_at / closed_at vienen en UTC ("2026-10-24 13:05:00"); se comparan con el día de hoy en la hora de la PC
  function esHoy(utc) {
    var d = new Date(utc.replace(' ', 'T') + 'Z');
    var h = new Date();
    return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate();
  }

  function enManoTxt(lista, conCliente) {
    if (!lista.length) return '0';
    if (!conCliente) return String(lista.length);
    var partes = contar(lista.map(function (x) { return x || 'sin cliente'; }));
    return lista.length + ' / ' + partes.map(function (p) { return p[1] + ' - ' + p[0]; }).join(' / ');
  }

  function saludo() {                              // 6 a 12 días · 12 a 20 tardes · 20 a 6 noches
    var h = new Date().getHours();
    return h >= 6 && h < 12 ? 'Buenos días' : h >= 12 && h < 20 ? 'Buenas tardes' : 'Buenas noches';
  }

  function texto(casos, venc) {
    var L = calcular(casos, venc, 'lineales');
    var G = calcular(casos, venc, 'gpon');
    var t = [];
    t.push(saludo() + ';', '', '*Lineales*', '');
    t.push('Casos ingresados: ' + L.ingresados);
    t.push('Casos resueltos: ' + L.resueltos);
    t.push('Casos totales acumulados: ' + L.acumulados);
    t.push('Casos en verificación: ' + L.verificacion);
    t.push('Casos pausados: ' + L.pausas.length);
    contar(L.pausas).forEach(function (p) { t.push('- ' + p[1] + ' ' + p[0]); });
    t.push('');
    t.push('Casos vencidos: ' + L.vencidos);
    t.push('Casos totales sin atender: ' + L.sinAtender);
    t.push('Casos de Claro sin atender: ' + L.claroSin);
    t.push('Casos en mano: ' + enManoTxt(L.enMano, true));
    t.push('', '', '*GPON*', '');
    t.push('Casos ingresados: ' + G.ingresados);
    t.push('Casos resueltos : ' + G.resueltos);
    t.push('Casos acumulados: ' + G.acumulados);
    t.push('Casos en verificacion: ' + G.verificacion);
    t.push('Casos pausados: ' + G.pausas.length);
    contar(G.pausas).forEach(function (p) { t.push('* ' + (p[1] > 1 ? p[1] + ' ' : '') + p[0]); });
    t.push('');
    t.push('Casos vencidos: ' + G.vencidos);
    t.push('Casos sin atender: ' + G.sinAtender);
    t.push('Alguna emergencia: ' + (G.emergencia ? 'sí' : 'no'));
    t.push('Casos en mano: ' + enManoTxt(G.enMano, false));
    return {texto: t.join('\n'), sinSla: !venc};
  }

  // ---------- pantalla ----------
  var css = document.createElement('style');
  css.textContent =
    '#mbs-res-btn{position:fixed;right:18px;bottom:18px;z-index:2147483000;background:#1b5b8b;color:#fff;font:700 13px "Segoe UI",Arial;' +
    'border:0;border-radius:22px;padding:9px 15px;box-shadow:0 3px 10px rgba(0,0,0,.25);cursor:pointer;opacity:.9}' +
    '#mbs-res-btn:hover{opacity:1}' +
    '#mbs-res{position:fixed;right:18px;bottom:64px;z-index:2147483001;width:380px;max-height:calc(100vh - 90px);display:flex;flex-direction:column;' +
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

  var btn = document.createElement('button');
  btn.id = 'mbs-res-btn';
  btn.textContent = '📋 Resumen de turno';
  btn.onclick = abrir;
  document.body.appendChild(btn);
  GM_registerMenuCommand('Resumen de turno', abrir);

  function abrir() {
    var p = document.getElementById('mbs-res');
    if (p) p.remove();
    p = document.createElement('div');
    p.id = 'mbs-res';
    var hoy = new Date();
    var fecha = ('0' + hoy.getDate()).slice(-2) + '/' + ('0' + (hoy.getMonth() + 1)).slice(-2);
    p.innerHTML = '<div class="h"><b>Resumen de turno</b><span title="Cerrar">✕</span></div>' +
      '<div class="sub">Hoy ' + fecha + ' · desde las 00:00 · podés corregir el texto antes de copiar</div>' +
      '<textarea spellcheck="false">Buscando los casos del día…</textarea>' +
      '<div class="ft"><button class="b1">Copiar para WhatsApp</button><button class="b2">Actualizar</button></div>';
    document.body.appendChild(p);
    var ta = p.querySelector('textarea'), sub = p.querySelector('.sub'), b1 = p.querySelector('.b1');
    p.querySelector('.h span').onclick = function () { p.remove(); };
    p.querySelector('.b2').onclick = abrir;
    b1.onclick = function () {
      GM_setClipboard(ta.value, 'text');
      b1.textContent = '✓ Copiado';
      setTimeout(function () { b1.textContent = 'Copiar para WhatsApp'; }, 1800);
    };
    armar().then(function (r) {
      ta.value = r.texto;
      if (r.sinSla) { sub.textContent = 'No pude leer los SLA: completá "Casos vencidos" a mano (está con ?)'; sub.className = 'sub av'; }
    }, function (e) {
      ta.value = 'No pude traer los casos.\n\n' + e.message;
    });
  }
})();
