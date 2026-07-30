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

  /* --- app-state sync: the one place UI state becomes context keys ---
     3D-only: the app is always in 3D mode. The 2D-editor keys (docOpen,
     selectionActive, painting, textTool) are retained as always-false so
     existing when-clauses still evaluate without referencing removed modules. */
  function sync() {
    const S = GF.scene3d;
    set('docOpen', S && S.count && S.count() > 0);   // "something to act on" — 3D objects
    set('mode3d', true);
    set('selectionActive', false);
    set('has3dSelection', S && S.selected && !!S.selected());
    set('animPlaying', GF.animation && GF.animation.isPlaying && GF.animation.isPlaying());
    set('paint3dActive', GF.paint3d && GF.paint3d.isActive && GF.paint3d.isActive());
    set('painting', GF.paint3d && GF.paint3d.isActive && GF.paint3d.isActive()); // keep 2D alias alive
    set('textTool', false);
  }

  // Wire paint3d onChange so context stays reactive — not just pull-based
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      if (GF.paint3d && GF.paint3d.onChange) GF.paint3d.onChange(() => sync());
    });
  }

  return { set, get, onChange, evaluate, sync };
})();
