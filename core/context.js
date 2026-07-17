/* PixelTriks — context.js
   Global UI context keys + when-clause evaluation (VS Code style).
   One reader (sync) turns app state into boolean keys; every surface gates
   visibility with the SAME when expressions ('docOpen && !mode3d') instead
   of re-deriving state its own way. */
'use strict';
window.GF = window.GF || {};

GF.context = (function () {
  const keys = {};
  const cbs = [];
  const parsed = {};   // when-expr string → compiled predicate

  function set(k, v) {
    v = !!v;
    if (keys[k] === v) return;
    keys[k] = v;
    cbs.forEach(fn => { try { fn(k, v); } catch (e) {} });
  }
  function get(k) { return !!keys[k]; }
  function onChange(fn) { cbs.push(fn); }

  /* --- tiny when-clause parser: identifiers, !, &&, ||, parens --- */
  function compile(expr) {
    const toks = expr.match(/[A-Za-z_][A-Za-z0-9_]*|&&|\|\||[!()]/g) || [];
    let i = 0;
    function primary() {
      const t = toks[i++];
      if (t === '!') { const f = primary(); return () => !f(); }
      if (t === '(') { const f = or(); if (toks[i++] !== ')') throw new Error('when: missing ) in "' + expr + '"'); return f; }
      if (!t || !/^[A-Za-z_]/.test(t)) throw new Error('when: bad token in "' + expr + '"');
      return () => !!keys[t];
    }
    function and() { let f = primary(); while (toks[i] === '&&') { i++; const g = primary(), h = f; f = () => h() && g(); } return f; }
    function or()  { let f = and();     while (toks[i] === '||') { i++; const g = and(), h = f;     f = () => h() || g(); } return f; }
    const fn = or();
    if (i !== toks.length) throw new Error('when: trailing tokens in "' + expr + '"');
    return fn;
  }
  function evaluate(expr) {
    if (!expr) return true;
    return (parsed[expr] || (parsed[expr] = compile(expr)))();
  }

  /* --- app-state sync: the one place UI state becomes context keys --- */
  function sync() {
    const D = GF.doc, S = GF.scene3d, V = GF.view;
    set('docOpen', D && D.doc.open);
    set('mode3d', document.body.dataset.mode === '3d');
    set('selectionActive', GF.select && GF.select.has && GF.select.has());
    set('has3dSelection', S && S.selected && !!S.selected());
    set('animPlaying', GF.animation && GF.animation.isPlaying && GF.animation.isPlaying());
    const tool = V && V.view ? V.view.tool : null;
    set('painting', tool === 'brush' || tool === 'fill' || tool === 'gradient');
    set('textTool', tool === 'text');
  }

  return { set, get, onChange, evaluate, sync };
})();
