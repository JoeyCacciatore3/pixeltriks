/* Forge Studio — main.js — boot sequence */
'use strict';
(function () {
  function boot() {
    GF.view.init();
    GF.ui.init();
    GF.library.init();
    document.getElementById('empty-state').hidden = false;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
