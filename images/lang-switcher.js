/*
 * Language switcher (IT / ES / EN) for static pages.
 *
 * Italian is the source language written in the HTML. Translations live in
 * window.I18N_DICT = { es: { "<italian>": "<spanish>" }, en: { ... } }, keyed by
 * the Italian text (whitespace collapsed). Text inside elements, placeholder /
 * alt / title / aria-label attributes and <title> are swapped in place, so
 * switching back to Italian restores the original markup.
 *
 * Page scripts use I18N.t('italian string') for messages they create, and
 * I18N.onChange(fn) to re-render dynamic text (dates, counters) per language.
 * Elements marked data-i18n-dyn are skipped (their content is script-owned);
 * data-i18n-skip excludes a whole subtree.
 */
(function () {
  'use strict';

  var LANGS = ['it', 'es', 'en'];
  var LOCALES = { it: 'it-IT', es: 'es-ES', en: 'en-GB' };
  var NAMES = { it: 'Italiano', es: 'Español', en: 'English' };
  var STORE_KEY = 'site_lang';
  var ATTRS = ['placeholder', 'alt', 'title', 'aria-label'];
  var INLINE = /^(A|ABBR|B|BR|CITE|CODE|EM|I|IMG|MARK|S|SMALL|SPAN|STRONG|SUB|SUP|U|TIME|WBR|LABEL)$/;
  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|SVG|IFRAME|TEXTAREA|TEMPLATE|CANVAS|VIDEO)$/;

  var ICONS = {
    it: '<svg viewBox="0 0 3 2" aria-hidden="true"><rect width="1" height="2" fill="#009246"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ce2b37"/></svg>',
    es: '<svg viewBox="0 0 3 2" aria-hidden="true"><rect width="3" height="2" fill="#aa151b"/><rect y=".5" width="3" height="1" fill="#f1bf00"/></svg>',
    en: '<svg class="ls-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
  };

  function norm(s) { return String(s).replace(/[\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim(); }

  function readLang() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    if (q && LANGS.indexOf(q) !== -1) { save(q); return q; }
    var c = document.cookie.match(/(?:^|;\s*)site_lang=([a-z]{2})/);
    if (c && LANGS.indexOf(c[1]) !== -1) return c[1];
    try {
      var s = localStorage.getItem(STORE_KEY);
      if (s && LANGS.indexOf(s) !== -1) return s;
    } catch (e) {}
    return 'it';
  }
  // Cookie is shared with the other sites on this domain (vettro reads it server-side).
  function save(l) {
    document.cookie = STORE_KEY + '=' + l + '; path=/; max-age=31536000; SameSite=Lax';
    try { localStorage.setItem(STORE_KEY, l); } catch (e) {}
  }

  var lang = readLang();
  var listeners = [];
  var units = null; // collected translatable spots, original Italian kept

  // Hide the page until the first translation runs, so non-Italian visitors
  // don't see a flash of Italian. Safety timeout in case something fails.
  var root = document.documentElement;
  root.lang = lang;
  if (lang !== 'it') {
    root.classList.add('i18n-pending');
    var hide = document.createElement('style');
    hide.textContent = 'html.i18n-pending body{visibility:hidden}';
    (document.head || root).appendChild(hide);
    setTimeout(function () { root.classList.remove('i18n-pending'); }, 1500);
  }

  function dict(l) { return (window.I18N_DICT && window.I18N_DICT[l]) || {}; }

  function t(src, l) {
    l = l || lang;
    if (l === 'it' || src == null) return src;
    var hit = dict(l)[norm(src)];
    return hit != null ? hit : src;
  }

  function hasText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && norm(n.nodeValue)) return true;
    }
    return false;
  }
  function allInline(el) {
    var all = el.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if (!INLINE.test(all[i].tagName) || all[i].hasAttribute('data-i18n-dyn')) return false;
    }
    return true;
  }

  // Walk the page once and remember every translatable spot:
  //  - "html" units: element with text and only inline children -> innerHTML
  //  - "text" units: lone text nodes inside block-level containers
  //  - "attr" units: translatable attributes
  function collect(scope) {
    var out = [];
    function walk(el) {
      if (el.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(el.tagName.toUpperCase())) return;
      if (el.hasAttribute('data-i18n-skip')) return;
      for (var a = 0; a < ATTRS.length; a++) {
        var v = el.getAttribute(ATTRS[a]);
        if (v && norm(v)) out.push({ kind: 'attr', el: el, attr: ATTRS[a], src: v });
      }
      if (SKIP.test(el.tagName.toUpperCase())) return;
      if (el.hasAttribute('data-i18n-dyn')) return;
      if (hasText(el) && allInline(el)) {
        out.push({ kind: 'html', el: el, src: el.innerHTML });
        var imgs = el.getElementsByTagName('*');
        for (var j = 0; j < imgs.length; j++) {
          for (var b = 0; b < ATTRS.length; b++) {
            var w = imgs[j].getAttribute(ATTRS[b]);
            if (w && norm(w)) out.push({ kind: 'attr-in', parent: el, idx: j, attr: ATTRS[b], src: w });
          }
        }
        return;
      }
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && norm(n.nodeValue)) out.push({ kind: 'text', node: n, src: n.nodeValue });
        else if (n.nodeType === 1) walk(n);
      }
    }
    walk(scope);
    return out;
  }

  function apply(l) {
    if (!units) units = collect(document.body);
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.kind === 'html') {
        var h = t(u.src, l);
        if (u.el.innerHTML !== h) u.el.innerHTML = h;
      } else if (u.kind === 'text') {
        var lead = u.src.match(/^\s*/)[0], tail = u.src.match(/\s*$/)[0];
        u.node.nodeValue = l === 'it' ? u.src : lead + t(u.src, l) + tail;
      } else if (u.kind === 'attr') {
        u.el.setAttribute(u.attr, t(u.src, l));
      } else if (u.kind === 'attr-in') {
        var target = u.parent.getElementsByTagName('*')[u.idx];
        if (target) target.setAttribute(u.attr, t(u.src, l));
      }
    }
    if (titleSrc == null) titleSrc = document.title;
    document.title = t(titleSrc, l);
    var md = document.querySelector('meta[name="description"]');
    if (md) {
      if (md._i18nSrc == null) md._i18nSrc = md.getAttribute('content');
      md.setAttribute('content', t(md._i18nSrc, l));
    }
  }
  var titleSrc = null;

  // A page script replaced oldRoot with a structurally identical newRoot
  // (e.g. cloneNode to drop listeners): point our units at the new nodes.
  function rebind(oldRoot, newRoot) {
    if (!units) return;
    function pathOf(n) {
      var path = [];
      while (n && n !== oldRoot) {
        if (!n.parentNode) return null;
        path.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
        n = n.parentNode;
      }
      return n === oldRoot ? path : null;
    }
    function follow(path) {
      var n = newRoot;
      for (var i = 0; i < path.length && n; i++) n = n.childNodes[path[i]];
      return n;
    }
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      var key = u.kind === 'text' ? 'node' : u.kind === 'attr-in' ? 'parent' : 'el';
      var p = pathOf(u[key]);
      if (p) { var m = follow(p); if (m) u[key] = m; }
    }
  }

  function setLang(l) {
    if (LANGS.indexOf(l) === -1) return;
    lang = l;
    save(l);
    root.lang = l;
    apply(l);
    renderSwitchers();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](l); } catch (e) { if (window.console) console.error(e); }
    }
  }

  // ---- Switcher UI -------------------------------------------------------

  var CSS =
    '.ls{position:relative;display:inline-block;font-family:inherit;line-height:1;z-index:1000}' +
    '.ls-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid rgba(0,0,0,.15);border-radius:6px;background:#fff;color:#1a1a1a;font-size:13px;font-weight:600;cursor:pointer}' +
    '.ls-btn:hover,.ls-btn:focus-visible{border-color:rgba(0,0,0,.35)}' +
    '.ls svg{width:20px;height:14px;border-radius:2px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.08)}' +
    '.ls svg.ls-globe{width:16px;height:16px;border-radius:0;box-shadow:none}' +
    '.ls-caret{font-size:10px;opacity:.6}' +
    '.ls-menu{display:none;position:absolute;right:0;top:calc(100% + 6px);min-width:150px;margin:0;padding:6px;list-style:none;background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.12)}' +
    '.ls.open .ls-menu{display:block}' +
    '.ls-menu li{margin:0;padding:0;list-style:none;line-height:1.2}' +
    '.ls button{margin:0;font-family:inherit;line-height:1.2;text-transform:none;letter-spacing:normal;box-sizing:border-box}' +
    '.ls-menu button{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:5px;background:none;color:#1a1a1a;font-size:14px;font-weight:500;text-align:left;cursor:pointer}' +
    '.ls-menu button:hover,.ls-menu button:focus-visible{background:#f2f2f2}' +
    '.ls-menu .ls-check{margin-left:auto;font-weight:700}' +
    '.ls-row{display:flex;gap:8px;flex-wrap:wrap}' +
    '.ls-row button{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid rgba(0,0,0,.15);border-radius:6px;background:#fff;color:#1a1a1a;font-size:14px;font-weight:600;cursor:pointer}' +
    '.ls-row button[aria-pressed="true"]{border-color:#1a1a1a;box-shadow:inset 0 0 0 1px #1a1a1a}' +
    '@media (max-width:767px){.ls-compact .ls-code{display:none}}';

  function renderSwitchers() {
    var spots = document.querySelectorAll('[data-lang-switcher]');
    for (var i = 0; i < spots.length; i++) renderOne(spots[i]);
  }

  function renderOne(host) {
    var mode = host.getAttribute('data-lang-switcher'); // "dropdown" | "row"
    host.setAttribute('data-i18n-skip', '');
    if (mode === 'row') {
      var row = '<div class="ls ls-row" role="group" aria-label="Language">';
      for (var i = 0; i < LANGS.length; i++) {
        var l = LANGS[i];
        row += '<button type="button" data-set-lang="' + l + '" aria-pressed="' + (l === lang) + '">' +
          ICONS[l] + '<span>' + l.toUpperCase() + '</span></button>';
      }
      host.innerHTML = row + '</div>';
      return;
    }
    var items = '';
    for (var k = 0; k < LANGS.length; k++) {
      var m = LANGS[k];
      items += '<li><button type="button" role="menuitemradio" aria-checked="' + (m === lang) + '" data-set-lang="' + m + '" lang="' + m + '">' +
        ICONS[m] + '<span>' + NAMES[m] + '</span>' + (m === lang ? '<span class="ls-check" aria-hidden="true">✓</span>' : '') + '</button></li>';
    }
    host.innerHTML =
      '<div class="ls ls-compact">' +
      '<button type="button" class="ls-btn" aria-haspopup="true" aria-expanded="false" aria-label="Language: ' + NAMES[lang] + '">' +
      ICONS[lang] + '<span class="ls-code">' + lang.toUpperCase() + '</span><span class="ls-caret" aria-hidden="true">▾</span></button>' +
      '<ul class="ls-menu" role="menu">' + items + '</ul></div>';
  }

  function closeAll(except) {
    var open = document.querySelectorAll('.ls.open');
    for (var i = 0; i < open.length; i++) {
      if (open[i] === except) continue;
      open[i].classList.remove('open');
      var b = open[i].querySelector('.ls-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
  }

  document.addEventListener('click', function (e) {
    var pick = e.target.closest && e.target.closest('[data-set-lang]');
    if (pick) {
      e.preventDefault();
      closeAll();
      setLang(pick.getAttribute('data-set-lang'));
      return;
    }
    var btn = e.target.closest && e.target.closest('.ls-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      var box = btn.parentNode;
      closeAll(box);
      var isOpen = box.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
      return;
    }
    closeAll();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  function init() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    renderSwitchers();
    if (lang !== 'it') apply(lang);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (e) { if (window.console) console.error(e); }
    }
    root.classList.remove('i18n-pending');
  }

  window.I18N = {
    t: function (src) { return t(src); },
    get lang() { return lang; },
    locale: function () { return LOCALES[lang]; },
    set: setLang,
    onChange: function (fn) { listeners.push(fn); },
    rebind: rebind,
    _collect: collect,
    _norm: norm
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
