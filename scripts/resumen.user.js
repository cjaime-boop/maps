// ==UserScript==
// @name         Mobisond · Resumen de turno (WhatsApp)
// @namespace    mobisond
// @version      2.0
// @description  YA NO HACE FALTA: el resumen de turno ahora viene dentro del Avisador. Desinstalá este script.
// @match        https://*.service-now.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://cjaime-boop.github.io/maps/scripts/resumen.user.js
// @downloadURL  https://cjaime-boop.github.io/maps/scripts/resumen.user.js
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  // El botón 📋 Resumen de turno ahora está en el Avisador (y en Telegram con /status).
  // Este script quedó vacío: avisa una sola vez que se puede desinstalar.
  if (window.top !== window.self || GM_getValue('aviso_baja', false)) return;
  GM_setValue('aviso_baja', true);
  setTimeout(function () {
    alert('Mobisond · Resumen de turno\n\nEl resumen ahora viene dentro del Avisador (mismo botón 📋, y en Telegram con /status).\n\n' +
          'Este script ya no hace nada: podés desinstalarlo desde el panel de Tampermonkey.');
  }, 3000);
})();
