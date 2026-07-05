/* PixelTriks — timeline-ui.js
   Animation playback controls wired to the bottom action bar.
   Play/pause button + time display in the ab-center group. */
'use strict';
window.GF = window.GF || {};

GF.timelineUI = (function () {
  const $ = s => document.querySelector(s);
  const A = () => GF.animation;

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  function wire() {
    const playBtn = $('#ab-play');
    if (playBtn) playBtn.addEventListener('click', () => {
      A().isPlaying() ? A().pause() : A().play();
    });
    A().onChange(render);
    render();
  }

  function render() {
    const timeEl = $('#ab-time');
    const playBtn = $('#ab-play');
    if (timeEl) timeEl.textContent = formatTime(A().getTime()) + ' / ' + formatTime(A().getDuration());
    if (playBtn) {
      const svg = playBtn.querySelector('svg');
      if (svg) {
        svg.innerHTML = A().isPlaying()
          ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
          : '<polygon points="6,4 20,12 6,20"/>';
      }
    }
  }

  if (typeof window !== 'undefined') {
    const go = () => { if ($('#ab-play')) wire(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }

  return { render };
})();
