/* ==========================================================================
   STUDIO ACAL — yellow_k.js (v1 "project page — cinematic")
   Script de interatividade para as páginas internas de projeto
   (ex.: projetos/yellow_k.html, projetos/estudio-taruma.html).

   Reaproveita a mesma linguagem de movimento do main.js (reveal reversível,
   parallax leve, header retrátil, cursor glow, tilt, magnetismo em links),
   adaptada à estrutura destas páginas (sem loader, com lista de materiais,
   seção "Próximo projeto" etc.) e adiciona um módulo novo: o carrossel de
   croquis com navegação por setas + lightbox "ver todos".

   Não depende de HTML/CSS extra: toda estrutura nova (carrossel, lightbox,
   estilos) é criada e injetada em runtime.

   Vanilla JS (ES2022+). Zero dependências externas.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------------ */
  const CONFIG = {
    EASE: 'cubic-bezier(0.22, 1, 0.36, 1)',
    EASE_SOFT: 'cubic-bezier(0.16, 1, 0.3, 1)',
    EASE_SNAP: 'cubic-bezier(0.65, 0, 0.35, 1)',

    DUR_FAST: 260,
    DUR_BASE: 620,
    DUR_SLOW: 900,
    DUR_WORD: 760,

    REVEAL_DISTANCE: 40,
    WORD_STAGGER: 55,
    GROUP_STAGGER: 70,
    REVEAL_THRESHOLD: [0, 0.12, 0.25, 0.4, 0.6, 0.8, 1],
    REVEAL_ROOT_MARGIN: '0px 0px -10% 0px',

    HEADER_HIDE_AT: 96,

    SCROLL_DAMPING: 0.22,
    SCROLL_SETTLE_EPSILON: 0.4,

    PARALLAX_FACTOR: 0.14,
    DEPTH_EXIT_SCALE: 0.94,
    DEPTH_ACTIVATE_MARGIN: '35% 0px 35% 0px',

    TILT_MAX_DEG: 7,
    MAGNETIC_STRENGTH: 0.3,
    MAGNETIC_MAX: 16,
    LAZY_ACTIVATE_MARGIN: '200px',

    CROQUI_TONES: ['tone--a', 'tone--b', 'tone--c', 'tone--d'],

    // ------------------------------------------------------------------
    // IMAGENS DO CARROSSEL — fonte única da verdade.
    // O número de slides do carrossel É o tamanho deste array.
    // Adicione/remova linhas aqui para ter mais ou menos croquis.
    // IMPORTANTE: confira a extensão exata do arquivo (.jpg vs .png etc.)
    // ------------------------------------------------------------------
    CROQUI_IMAGES: [
      "../assets/img/yellow-k/IMG_4108.jpg",
      "../assets/img/yellow-k/IMG_0938.jpg",
      "../assets/img/yellow-k/IMG_0052.jpg",
      "../assets/img/yellow-k/IMG_4101.jpg",
      "../assets/img/yellow-k/IMG_4090.png", 
      "../assets/img/yellow-k/IMG_4098.jpg",   
      "../assets/img/yellow-k/IMG_0977.jpg",
      "../assets/img/yellow-k/IMG_0959.jpg",
      "../assets/img/yellow-k/IMG_1004.jpg",
      "../assets/img/yellow-k/IMG_4097.jpg",
      "../assets/img/yellow-k/IMG_8954.jpg",   
      "../assets/img/yellow-k/IMG_8960.jpg",   
    ],
  };

  /* ------------------------------------------------------------------------
     UTILS
     ------------------------------------------------------------------------ */
  const qs = (sel, ctx = document) => ctx.querySelector(sel);
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  const lerp = (a, b, t) => a + (b - a) * t;

  const media = {
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)'),
    coarsePointer: window.matchMedia('(pointer: coarse)'),
    fineWide: window.matchMedia('(min-width: 861px) and (pointer: fine)'),
  };

  function debounce(fn, wait = 150) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  const supportsPassive = (() => {
    let ok = false;
    try { window.addEventListener('t', null, { get passive() { ok = true; return true; } }); } catch (_) {}
    return ok;
  })();
  const passiveOpt = supportsPassive ? { passive: true } : false;

  function splitWords(el) {
    if (el.dataset.split === 'true') return qsa('.word-inner', el);
    const original = el.textContent.trim();
    el.setAttribute('aria-label', original);
    el.textContent = '';
    original.split(/\s+/).forEach((word) => {
      const mask = document.createElement('span');
      mask.setAttribute('aria-hidden', 'true');
      mask.style.display = 'inline-block';
      mask.style.overflow = 'hidden';
      mask.style.verticalAlign = 'top';
      mask.style.paddingBottom = '0.08em';

      const inner = document.createElement('span');
      inner.className = 'word-inner';
      inner.textContent = word;
      inner.style.display = 'inline-block';
      inner.style.willChange = 'transform, opacity';
      inner.style.transform = 'translateY(115%)';
      inner.style.opacity = '0';

      mask.appendChild(inner);
      el.appendChild(mask);
      el.appendChild(document.createTextNode(' '));
    });
    el.dataset.split = 'true';
    return qsa('.word-inner', el);
  }

  function playWords(words, { delayBase = 0, stagger = CONFIG.WORD_STAGGER, duration = CONFIG.DUR_WORD } = {}) {
    words.forEach((w, i) => {
      const delay = delayBase + i * stagger;
      w.style.transition = `transform ${duration}ms ${CONFIG.EASE} ${delay}ms, opacity ${duration}ms ${CONFIG.EASE} ${delay}ms`;
      w.style.transform = 'translateY(0)';
      w.style.opacity = '1';
    });
  }

  function resetWords(words) {
    words.forEach(w => {
      w.style.transition = 'none';
      w.style.transform = 'translateY(115%)';
      w.style.opacity = '0';
    });
  }

  /* ------------------------------------------------------------------------
     TICKER
     ------------------------------------------------------------------------ */
  const Ticker = (() => {
    const subs = new Set();
    let running = false;
    let lastTime = 0;

    function tick(now) {
      lastTime = now;
      subs.forEach(fn => fn(now));
      if (subs.size) requestAnimationFrame(tick);
      else running = false;
    }

    return {
      add(fn) { subs.add(fn); if (!running) { running = true; lastTime = 0; requestAnimationFrame(tick); } },
      remove(fn) { subs.delete(fn); },
    };
  })();

  /* ------------------------------------------------------------------------
     ESTADO GLOBAL
     ------------------------------------------------------------------------ */
  const state = {
    reducedMotion: media.reducedMotion.matches,
    fineWide: media.fineWide.matches,
    lastScrollY: window.scrollY,
    scrollDir: 'down',
    headerHidden: false,
    listeners: [],
    observers: [],
  };

  const dom = {};

  function addListener(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    state.listeners.push({ target, type, handler, opts });
  }

  /* ------------------------------------------------------------------------
     CACHE DOM
     ------------------------------------------------------------------------ */
  function cacheDOM() {
    dom.header = qs('.site-header');
    dom.menuToggle = qs('.menu-toggle');
    dom.menuLinks = qsa('.menu-links a');
    dom.hero = qs('.hero');
    dom.heroTitle = dom.hero ? qs('h1', dom.hero) : null;
    dom.heroEyebrow = dom.hero ? qs('.eyebrow', dom.hero) : null;
    dom.heroTone = dom.hero ? qs('.tone', dom.hero) : null;
    dom.heroScroll = qs('.hero__scroll');
    dom.revealEls = qsa('.reveal');
    dom.sections = qsa('main > section');
    dom.tiltTargets = qsa('.tone.banner_default_style, .materials-list li');
    dom.magneticTargets = qsa('.link-line, .menu-trigger, .menu-close, .contact__links a, .brand, .next-project a');
    dom.parallaxEls = qsa('.section .tone, .tone:not(.hero .tone)');
    dom.idSections = qsa('main [id]');
    dom.hashNavLinks = qsa('a[href^="#"]');
    dom.pageNavLinks = qsa('.menu-links a[href$=".html"], .brand[href]');
  }

  /* ------------------------------------------------------------------------
     INTRO DO HERO (sem loader nas páginas de projeto — dispara direto)
     ------------------------------------------------------------------------ */
  function playHeroIntro() {
    if (state.reducedMotion || !dom.heroTitle) return;

    const titleWords = splitWords(dom.heroTitle);
    playWords(titleWords, { delayBase: 80 });

    if (dom.heroEyebrow) {
      dom.heroEyebrow.style.opacity = '0';
      dom.heroEyebrow.style.transform = 'translateY(14px)';
      dom.heroEyebrow.style.transition = `opacity ${CONFIG.DUR_BASE}ms ${CONFIG.EASE} 120ms, transform ${CONFIG.DUR_BASE}ms ${CONFIG.EASE} 120ms`;
      requestAnimationFrame(() => {
        dom.heroEyebrow.style.opacity = '1';
        dom.heroEyebrow.style.transform = 'translateY(0)';
      });
    }

    if (dom.heroScroll) {
      dom.heroScroll.style.opacity = '0';
      dom.heroScroll.style.transition = `opacity ${CONFIG.DUR_BASE}ms ${CONFIG.EASE} 620ms`;
      requestAnimationFrame(() => { dom.heroScroll.style.opacity = '1'; });
    }
  }

  /* ------------------------------------------------------------------------
     SMOOTH SCROLL (tablets/celulares) — mesmo motor do main.js
     ------------------------------------------------------------------------ */
  const SmoothScroll = (() => {
    let target = window.scrollY;
    let current = window.scrollY;
    let active = false;
    let enabled = false;

    function normalizeDelta(e) { return e.deltaY * (e.deltaMode === 1 ? 18 : 1); }

    function onWheel(e) {
      if (e.ctrlKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      target = clamp(target + normalizeDelta(e), 0, max);
      if (!active) { active = true; Ticker.add(tick); }
    }

    function tick() {
      current = lerp(current, target, CONFIG.SCROLL_DAMPING);
      window.scrollTo(0, current);
      if (Math.abs(target - current) < CONFIG.SCROLL_SETTLE_EPSILON) {
        current = target; window.scrollTo(0, current);
        active = false; Ticker.remove(tick);
      }
    }

    function resync() { if (!active) { target = window.scrollY; current = target; } }

    function init() {
      if (enabled) return;
      enabled = true;
      addListener(window, 'wheel', onWheel, { passive: false });
      addListener(window, 'resize', debounce(resync, 120), passiveOpt);
    }

    function jumpTo(y) { target = y; if (!active) { active = true; Ticker.add(tick); } }

    return { init, resync, jumpTo, get isEnabled() { return enabled; } };
  })();

  function setupSmoothScroll() {
    if (state.reducedMotion || window.innerWidth > 1024) return;
    SmoothScroll.init();
  }

  /* ------------------------------------------------------------------------
     REVEAL — adaptado à estrutura das páginas de projeto
     ------------------------------------------------------------------------ */
  const REVEAL_RULES = [
    { test: el => el.matches('.hero__content .heading, .contact .heading'), type: 'words' },
    { test: el => el.matches('.materials-list li'), type: 'fade-left' },
    { test: el => el.matches('.next-project'), type: 'scale' },
    { test: el => el.matches('.contact__links'), type: 'fade-up' },
    { test: el => el.matches('.center'), type: 'fade-up' },
    { test: el => el.matches('.tone.ratio-16-9, .tone[style*="height"]'), type: 'clip' },
    { test: el => el.matches('.croqui-slide'), type: 'scale' },
    { test: el => el.matches('.grid > .tone'), type: 'fade-up' },
  ];

  function classifyReveal(el) {
    return (REVEAL_RULES.find(r => r.test(el)) || {}).type || 'fade-up';
  }

  function initialTransform(type, dir) {
    const d = `${CONFIG.REVEAL_DISTANCE}px`;
    const sign = dir === 'up' ? -1 : 1;
    switch (type) {
      case 'fade-up': return `translateY(${sign * CONFIG.REVEAL_DISTANCE}px)`;
      case 'fade-left': return `translateX(-${d})`;
      case 'fade-right': return `translateX(${d})`;
      case 'scale': return 'scale(0.92)';
      default: return 'none';
    }
  }

  function armReveal(el) {
    const type = el.dataset.revealType;
    if (type === 'words') { resetWords(splitWords(el)); return; }
    if (type === 'clip') {
      el.style.transition = 'none';
      el.style.clipPath = 'inset(0 0 0 100%)';
      return;
    }
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.style.transform = initialTransform(type, state.scrollDir);
  }

  function fireReveal(el, index) {
    const type = el.dataset.revealType;
    const delay = (index % 4) * CONFIG.GROUP_STAGGER;

    if (type === 'words') { playWords(splitWords(el), { delayBase: delay }); return; }
    if (type === 'clip') {
      el.style.transition = `clip-path ${CONFIG.DUR_SLOW}ms ${CONFIG.EASE_SNAP} ${delay}ms`;
      requestAnimationFrame(() => { el.style.clipPath = 'inset(0 0 0 0%)'; });
      return;
    }
    const duration = type === 'scale' ? CONFIG.DUR_SLOW : CONFIG.DUR_BASE;
    el.style.transition = `opacity ${duration}ms ${CONFIG.EASE} ${delay}ms, transform ${duration}ms ${CONFIG.EASE} ${delay}ms`;
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'none'; });
  }

  let revealIO = null;

  function registerReveal(el, index) {
    if (el.dataset.revealType) return;
    el.dataset.revealType = classifyReveal(el);
    el.dataset.revealIndex = String(index || 0);
    el.style.willChange = 'opacity, transform, filter, clip-path';
    armReveal(el);
    if (revealIO) revealIO.observe(el);
  }

  function setupReveal() {
    if (state.reducedMotion) return;

    dom.revealEls.forEach((el, i) => registerReveal(el, i));

    revealIO = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const el = entry.target;
        if (entry.isIntersecting) fireReveal(el, Number(el.dataset.revealIndex));
        else if (entry.boundingClientRect.top > 0) armReveal(el);
      });
    }, { threshold: CONFIG.REVEAL_THRESHOLD, rootMargin: CONFIG.REVEAL_ROOT_MARGIN });

    dom.revealEls.forEach(el => revealIO.observe(el));
    state.observers.push(revealIO);

    // conteúdo inserido dinamicamente depois (ex.: slides extras do carrossel)
    const mo = new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        const found = node.matches('.reveal') ? [node] : qsa('.reveal', node);
        found.forEach(el => registerReveal(el, 0));
      }));
    });
    mo.observe(qs('main') || document.body, { childList: true, subtree: true });
    state.observers.push(mo);
  }

  /* ------------------------------------------------------------------------
     PARALLAX LEVE
     ------------------------------------------------------------------------ */
  function setupDepthLayers() {
    if (state.reducedMotion) return;
    const activeEls = new Set();

    function frame() {
      const vh = window.innerHeight;
      activeEls.forEach(el => {
        if (el === dom.heroTone) {
          el.style.transform = `translate3d(0, ${clamp(window.scrollY * 0.22, 0, 140)}px, 0)`;
          return;
        }
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const distFromCenter = (center - vh / 2) / vh;
        const shift = distFromCenter * vh * CONFIG.PARALLAX_FACTOR;
        el.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
      });
    }

    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) activeEls.add(entry.target);
        else activeEls.delete(entry.target);
      });
      if (activeEls.size) Ticker.add(frame); else Ticker.remove(frame);
    }, { rootMargin: CONFIG.DEPTH_ACTIVATE_MARGIN, threshold: 0 });

    dom.parallaxEls.forEach(el => { el.style.willChange = 'transform'; io.observe(el); });
    if (dom.heroTone) io.observe(dom.heroTone);
    state.observers.push(io);
  }

  /* ------------------------------------------------------------------------
     NAVEGAÇÃO
     ------------------------------------------------------------------------ */
  function closeMenu() { if (dom.menuToggle) dom.menuToggle.checked = false; }

  function scrollToTarget(targetEl) {
    if (!targetEl) return;
    const offset = dom.header ? dom.header.getBoundingClientRect().height : 0;
    const y = targetEl.getBoundingClientRect().top + window.scrollY - offset - 8;

    if (state.reducedMotion) { window.scrollTo(0, y); return; }
    if (SmoothScroll.isEnabled) { SmoothScroll.jumpTo(y); return; }

    const startY = window.scrollY;
    const distance = y - startY;
    const duration = clamp(Math.abs(distance) * 0.5, 400, 1000);
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    let start = null;
    function step(ts) {
      if (start === null) start = ts;
      const p = clamp((ts - start) / duration, 0, 1);
      window.scrollTo(0, startY + distance * ease(p));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function setupSmoothAnchors() {
    dom.hashNavLinks.forEach(link => {
      const hash = link.getAttribute('href');
      if (!hash || hash.length < 2) return;
      const target = qs(hash);
      if (!target) return;
      addListener(link, 'click', (e) => {
        e.preventDefault(); closeMenu(); scrollToTarget(target);
        history.pushState(null, '', hash);
      });
    });

    if (dom.heroScroll && dom.hero) {
      dom.heroScroll.style.cursor = 'pointer';
      addListener(dom.heroScroll, 'click', () => {
        const next = dom.hero.nextElementSibling;
        if (next) scrollToTarget(next);
      });
    }
  }

  function setupMenuBehavior() {
    if (!dom.menuToggle) return;
    dom.menuLinks.forEach(link => addListener(link, 'click', closeMenu));
    addListener(document, 'keydown', e => { if (e.key === 'Escape' && dom.menuToggle.checked) closeMenu(); });
  }

  function updateHeaderVisibility(currentY) {
    if (!dom.header || (dom.menuToggle && dom.menuToggle.checked)) return;
    const goingDown = currentY > state.lastScrollY;
    state.scrollDir = goingDown ? 'down' : 'up';
    const shouldHide = goingDown && currentY > CONFIG.HEADER_HIDE_AT;
    if (shouldHide !== state.headerHidden) {
      state.headerHidden = shouldHide;
      dom.header.style.transform = shouldHide ? 'translateY(-110%)' : 'translateY(0)';
    }
  }

  function setupNavigation() {
    if (dom.header) dom.header.style.transition = `transform ${CONFIG.DUR_BASE}ms ${CONFIG.EASE}`;
    setupMenuBehavior();
    setupSmoothAnchors();
  }

  /* ------------------------------------------------------------------------
     BARRA DE PROGRESSO + HEADER
     ------------------------------------------------------------------------ */
  function createProgressBar() {
    const bar = document.createElement('div');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'height:2px', 'width:100%',
      'transform-origin:0 0', 'transform:scaleX(0)',
      'background:linear-gradient(90deg, var(--oxide, #7a3621), var(--ink, #14130f))',
      'z-index:100', 'pointer-events:none', 'transition:transform 60ms linear',
    ].join(';');
    document.body.appendChild(bar);
    return bar;
  }

  function setupScrollEffects() {
    const progressBar = createProgressBar();

    function frame() {
      const doc = document.documentElement;
      const currentY = window.scrollY;
      const max = doc.scrollHeight - doc.clientHeight;
      const progress = max > 0 ? clamp(currentY / max, 0, 1) : 0;
      progressBar.style.transform = `scaleX(${progress})`;
      updateHeaderVisibility(currentY);
      state.lastScrollY = currentY;
    }

    let scrollTimeout;
    const onScroll = () => {
      Ticker.add(frame);
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => Ticker.remove(frame), 120);
    };
    addListener(window, 'scroll', onScroll, passiveOpt);
    frame();
  }

  /* ------------------------------------------------------------------------
     CURSOR GLOW
     ------------------------------------------------------------------------ */
  function setupCursorGlow() {
    if (state.reducedMotion || !state.fineWide) return;

    const glow = document.createElement('div');
    glow.setAttribute('aria-hidden', 'true');
    glow.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:420px', 'height:420px',
      'border-radius:50%', 'pointer-events:none', 'z-index:1',
      'background:radial-gradient(circle, color-mix(in srgb, var(--oxide, #7a3621) 14%, transparent) 0%, transparent 70%)',
      'transform:translate3d(-50%,-50%,0)', 'opacity:0',
      'transition:opacity 400ms ease', 'mix-blend-mode:multiply', 'will-change:transform',
    ].join(';');
    document.body.appendChild(glow);

    let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2, x = mouseX, y = mouseY, visible = false;

    function frame() {
      x = lerp(x, mouseX, 0.12); y = lerp(y, mouseY, 0.12);
      glow.style.transform = `translate3d(${x}px, ${y}px, 0) translate3d(-50%,-50%,0)`;
    }

    addListener(window, 'pointermove', (e) => {
      mouseX = e.clientX; mouseY = e.clientY;
      if (!visible) { visible = true; glow.style.opacity = '1'; Ticker.add(frame); }
    }, passiveOpt);

    addListener(document, 'mouseleave', () => { visible = false; glow.style.opacity = '0'; Ticker.remove(frame); });
  }

  /* ------------------------------------------------------------------------
     TILT 3D em banners/tone
     ------------------------------------------------------------------------ */
  function setupCards() {
    if (state.reducedMotion || !state.fineWide || !dom.tiltTargets.length) return;

    dom.tiltTargets.forEach(card => {
      card.style.transition = `transform ${CONFIG.DUR_FAST}ms ${CONFIG.EASE_SOFT}`;
      card.style.transformStyle = 'preserve-3d';

      let bound = false;
      const onMove = (e) => {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        const rx = (0.5 - py) * CONFIG.TILT_MAX_DEG;
        const ry = (px - 0.5) * CONFIG.TILT_MAX_DEG;
        card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      };
      const onLeave = () => { card.style.transform = 'perspective(900px) rotateX(0) rotateY(0)'; };

      const lazyIO = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && !bound) {
          bound = true;
          addListener(card, 'pointermove', onMove);
          addListener(card, 'pointerleave', onLeave);
        }
      }, { rootMargin: CONFIG.LAZY_ACTIVATE_MARGIN });
      lazyIO.observe(card);
      state.observers.push(lazyIO);
    });
  }

  /* ------------------------------------------------------------------------
     MAGNETISMO em botões/links
     ------------------------------------------------------------------------ */
  function applyMagnetic(btn) {
    if (state.reducedMotion || !state.fineWide) return;
    btn.style.transition = `transform ${CONFIG.DUR_FAST}ms ${CONFIG.EASE_SOFT}`;
    const onMove = (e) => {
      const rect = btn.getBoundingClientRect();
      const relX = e.clientX - (rect.left + rect.width / 2);
      const relY = e.clientY - (rect.top + rect.height / 2);
      const dx = clamp(relX * CONFIG.MAGNETIC_STRENGTH, -CONFIG.MAGNETIC_MAX, CONFIG.MAGNETIC_MAX);
      const dy = clamp(relY * CONFIG.MAGNETIC_STRENGTH, -CONFIG.MAGNETIC_MAX, CONFIG.MAGNETIC_MAX);
      btn.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const onLeave = () => { btn.style.transform = 'translate(0, 0)'; };
    addListener(btn, 'pointermove', onMove);
    addListener(btn, 'pointerleave', onLeave);
  }

  function setupButtons() {
    dom.magneticTargets.forEach(applyMagnetic);
  }

  /* ------------------------------------------------------------------------
     MODAIS genéricos (usados pelo lightbox "ver todos" do carrossel)
     ------------------------------------------------------------------------ */
  function setupModals() {
    const openers = qsa('[data-modal-target]');
    if (!openers.length) return;
    openers.forEach(opener => {
      const modal = document.getElementById(opener.getAttribute('data-modal-target'));
      if (!modal) return;
      const closeBtn = qs('[data-modal-close]', modal);
      const close = () => {
        modal.style.opacity = '0';
        modal.style.pointerEvents = 'none';
        document.documentElement.style.overflow = '';
        opener.focus();
      };
      const open = () => {
        modal.style.transition = `opacity ${CONFIG.DUR_BASE}ms ${CONFIG.EASE}`;
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
        document.documentElement.style.overflow = 'hidden';
        qs('[tabindex], a, button, input', modal)?.focus();
      };
      addListener(opener, 'click', open);
      if (closeBtn) addListener(closeBtn, 'click', close);
      addListener(modal, 'click', e => { if (e.target === modal) close(); });
      addListener(document, 'keydown', e => { if (e.key === 'Escape' && modal.style.pointerEvents === 'auto') close(); });
    });
  }

  /* ------------------------------------------------------------------------
     LIGHTBOX DE IMAGEM ÚNICA — clicar num croqui expande em tela cheia.
     Fecha clicando fora da imagem, no X do canto superior direito, ou Esc.
     ------------------------------------------------------------------------ */
  let fullscreenViewer = null;

  function buildFullscreenViewer() {
    if (fullscreenViewer) return fullscreenViewer;

    const overlay = document.createElement('div');
    overlay.className = 'croqui-fullscreen';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Imagem em tela cheia');

    const closeBtn = document.createElement('button');
    closeBtn.className = 'croqui-fullscreen__close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Fechar imagem');
    closeBtn.innerHTML = '&#10005;';

    const frame = document.createElement('div');
    frame.className = 'croqui-fullscreen__frame';

    const img = document.createElement('div');
    img.className = 'croqui-fullscreen__image';
    frame.appendChild(img);

    overlay.append(closeBtn, frame);
    document.body.appendChild(overlay);

    function close() {
      overlay.classList.remove('is-open');
      document.documentElement.style.overflow = '';
      setTimeout(() => { img.style.backgroundImage = ''; }, CONFIG.DUR_BASE);
    }

    function open(url, label) {
      img.style.backgroundImage = `url('${url}')`;
      img.setAttribute('aria-label', label || '');
      overlay.classList.add('is-open');
      document.documentElement.style.overflow = 'hidden';
      closeBtn.focus();
    }

    // clicar fora da imagem (no backdrop) fecha; clicar na própria imagem, não.
    addListener(overlay, 'click', (e) => { if (e.target === overlay) close(); });
    addListener(closeBtn, 'click', close);
    addListener(document, 'keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('is-open')) close();
    });

    fullscreenViewer = { open, close };
    return fullscreenViewer;
  }

  /* ------------------------------------------------------------------------
     INJEÇÃO DE ESTILOS (carrossel + lightbox de galeria + lightbox de imagem
     única) — mantém tudo em um único arquivo JS, sem tocar no style.css.
     ------------------------------------------------------------------------ */
  function injectCroquiStyles() {
    if (qs('#croqui-carousel-styles')) return;
    const style = document.createElement('style');
    style.id = 'croqui-carousel-styles';
    style.textContent = `
      .croqui-carousel {
        position: relative;
        padding: var(--gap, 1.5rem) var(--side, 1.5rem) 0;
      }
      .croqui-carousel__viewport {
        display: flex;
        gap: var(--gap, 1.5rem);
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        scroll-behavior: smooth;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        padding-bottom: 0.5rem;
      }
      .croqui-carousel__viewport::-webkit-scrollbar { display: none; }
      .croqui-slide {
        flex: 0 0 calc((100% - 2 * var(--gap, 1.5rem)) / 3);
        scroll-snap-align: start;
        position: relative;
        cursor: pointer;
      }
      @media (max-width: 860px) {
        .croqui-slide { flex: 0 0 82%; }
      }
      .croqui-carousel__nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        border: 1px solid color-mix(in srgb, var(--ink, #14130f) 18%, transparent);
        background: color-mix(in srgb, var(--paper, #f4f1ea) 88%, transparent);
        color: var(--ink, #14130f);
        font-family: var(--font-mono, 'Space Grotesk', sans-serif);
        font-size: 1.1rem;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 5;
        transition: background 260ms ease, opacity 260ms ease, transform 260ms ease;
      }
      .croqui-carousel__nav:hover { background: var(--oxide, #7a3621); color: var(--paper, #f4f1ea); }
      .croqui-carousel__nav:disabled { opacity: 0.25; cursor: default; }
      .croqui-carousel__nav:disabled:hover { background: color-mix(in srgb, var(--paper, #f4f1ea) 88%, transparent); color: var(--ink, #14130f); }
      .croqui-carousel__nav--prev { left: -0.25rem; }
      .croqui-carousel__nav--next { right: -0.25rem; }
      @media (max-width: 860px) {
        .croqui-carousel__nav { width: 2.4rem; height: 2.4rem; }
      }

      .croqui-carousel__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem var(--side, 1.5rem) 0;
      }
      .croqui-carousel__count {
        font-family: var(--font-mono, 'Space Grotesk', sans-serif);
        font-size: 0.8rem;
        letter-spacing: 0.04em;
        opacity: 0.6;
      }
      .croqui-carousel__more {
        font-family: var(--font-mono, 'Space Grotesk', sans-serif);
        font-size: 0.85rem;
        letter-spacing: 0.02em;
        background: none;
        border: none;
        border-bottom: 1px solid currentColor;
        color: var(--ink, #14130f);
        padding: 0.15rem 0;
        cursor: pointer;
        transition: color 260ms ease, border-color 260ms ease;
      }
      .croqui-carousel__more:hover { color: var(--oxide, #7a3621); }

      .croqui-lightbox {
        position: fixed;
        inset: 0;
        z-index: 200;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4rem 1.5rem;
        background: color-mix(in srgb, var(--ink, #14130f) 92%, transparent);
        opacity: 0;
        pointer-events: none;
        transition: opacity ${CONFIG.DUR_BASE}ms ${CONFIG.EASE};
      }
      .croqui-lightbox__panel {
        position: relative;
        width: min(100%, 72rem);
        max-height: 100%;
        overflow-y: auto;
      }
      .croqui-lightbox__grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
      }
      @media (max-width: 700px) {
        .croqui-lightbox__grid { grid-template-columns: repeat(2, 1fr); }
      }
      .croqui-lightbox__grid .tone { cursor: pointer; }
      .croqui-lightbox__close {
        position: sticky;
        top: 0;
        margin-left: auto;
        display: block;
        width: 2.6rem;
        height: 2.6rem;
        border-radius: 50%;
        border: 1px solid color-mix(in srgb, var(--paper, #f4f1ea) 40%, transparent);
        background: transparent;
        color: var(--paper, #f4f1ea);
        font-size: 1rem;
        cursor: pointer;
        margin-bottom: 1rem;
        transition: background 260ms ease;
      }
      .croqui-lightbox__close:hover { background: color-mix(in srgb, var(--paper, #f4f1ea) 14%, transparent); }

      /* --- imagem única em tela cheia --- */
      .croqui-fullscreen {
        position: fixed;
        inset: 0;
        z-index: 300;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        background: color-mix(in srgb, var(--ink, #14130f) 94%, transparent);
        opacity: 0;
        pointer-events: none;
        transition: opacity ${CONFIG.DUR_BASE}ms ${CONFIG.EASE};
        cursor: zoom-out;
      }
      .croqui-fullscreen.is-open { opacity: 1; pointer-events: auto; }
      .croqui-fullscreen__frame {
        position: relative;
        width: min(100%, 60rem);
        height: min(100%, 42rem);
        cursor: default;
      }
      .croqui-fullscreen__image {
        width: 100%;
        height: 100%;
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
      }
      .croqui-fullscreen__close {
        position: fixed;
        top: 1.5rem;
        right: 1.5rem;
        width: 2.8rem;
        height: 2.8rem;
        border-radius: 50%;
        border: 1px solid color-mix(in srgb, var(--paper, #f4f1ea) 40%, transparent);
        background: color-mix(in srgb, var(--ink, #14130f) 60%, transparent);
        color: var(--paper, #f4f1ea);
        font-size: 1.1rem;
        line-height: 1;
        cursor: pointer;
        z-index: 301;
        transition: background 260ms ease, transform 260ms ease;
      }
      .croqui-fullscreen__close:hover { background: var(--oxide, #7a3621); transform: scale(1.06); }
    `;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------------
     CARROSSEL DE CROQUIS — setas para navegar + botão "ver todos" +
     clique em qualquer imagem expande em tela cheia.
     O número de slides é sempre igual ao tamanho de CONFIG.CROQUI_IMAGES.
     ------------------------------------------------------------------------ */
  function buildSlideNode(label, toneClass, url) {
    const slide = document.createElement('div');
    slide.className = 'croqui-slide reveal';
    slide.dataset.url = url;
    slide.dataset.label = label;

    const tone = document.createElement('div');
    // toneClass fica como cor de fundo — funciona como "placeholder" caso
    // a imagem não carregue (ex.: nome de arquivo errado), em vez de ficar
    // com o quadro totalmente vazio.
    tone.className = `tone ${toneClass} ratio-4-5 banner_default_style`;
    tone.style.backgroundImage = `url('${url}')`;

    const labelEl = document.createElement('span');
    labelEl.className = 'tone__label';
    labelEl.textContent = label;
    tone.appendChild(labelEl);

    slide.appendChild(tone);
    return slide;
  }

  function setupCroquisCarousel() {
    const originalBanners = qsa('.banner4, .banner5, .banner6');
    if (!originalBanners.length) return;

    const grid = originalBanners[0].closest('.grid');
    if (!grid) return;

    injectCroquiStyles();
    const viewer = buildFullscreenViewer();

    // a quantidade de slides é sempre o tamanho do array de imagens
    const images = CONFIG.CROQUI_IMAGES;
    const slides = images.map((url, i) => ({
      label: `Imagem ${String(i + 1).padStart(2, '0')}`,
      toneClass: CONFIG.CROQUI_TONES[i % CONFIG.CROQUI_TONES.length],
      url,
      index: i,
    }));

    // --- monta o carrossel ---
    const carousel = document.createElement('div');
    carousel.className = 'croqui-carousel';

    const viewport = document.createElement('div');
    viewport.className = 'croqui-carousel__viewport';
    viewport.setAttribute('tabindex', '0');
    viewport.setAttribute('aria-label', 'Galeria de croquis, use as setas para navegar');

    slides.forEach(s => viewport.appendChild(buildSlideNode(s.label, s.toneClass, s.url)));

    const prevBtn = document.createElement('button');
    prevBtn.className = 'croqui-carousel__nav croqui-carousel__nav--prev';
    prevBtn.setAttribute('aria-label', 'Croqui anterior');
    prevBtn.innerHTML = '&#8592;';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'croqui-carousel__nav croqui-carousel__nav--next';
    nextBtn.setAttribute('aria-label', 'Próximo croqui');
    nextBtn.innerHTML = '&#8594;';

    carousel.append(viewport, prevBtn, nextBtn);

    const footer = document.createElement('div');
    footer.className = 'croqui-carousel__footer';

    const count = document.createElement('span');
    count.className = 'croqui-carousel__count';
    count.textContent = `01 / ${String(slides.length).padStart(2, '0')}`;

    const moreBtn = document.createElement('button');
    moreBtn.className = 'croqui-carousel__more';
    moreBtn.type = 'button';
    moreBtn.dataset.modalTarget = 'croqui-lightbox';
    moreBtn.textContent = `Ver todos as imagensx (${slides.length})`;

    footer.append(count, moreBtn);

    // substitui a grade estática de 3 croquis pelo carrossel
    grid.replaceWith(carousel);
    carousel.after(footer);

    // --- monta o lightbox de galeria (grid com todas as imagens) ---
    const lightbox = document.createElement('div');
    lightbox.className = 'croqui-lightbox';
    lightbox.id = 'croqui-lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', 'Todos os croquis do projeto');

    const panel = document.createElement('div');
    panel.className = 'croqui-lightbox__panel';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'croqui-lightbox__close';
    closeBtn.type = 'button';
    closeBtn.dataset.modalClose = '';
    closeBtn.setAttribute('aria-label', 'Fechar galeria');
    closeBtn.innerHTML = '&#10005;';

    const lightGrid = document.createElement('div');
    lightGrid.className = 'croqui-lightbox__grid';

    slides.forEach(s => {
      const item = buildSlideNode(s.label, s.toneClass, s.url);
      item.classList.remove('reveal'); // já visível dentro do lightbox
      lightGrid.appendChild(item);
    });

    panel.append(closeBtn, lightGrid);
    lightbox.appendChild(panel);
    document.body.appendChild(lightbox);

    // --- navegação por setas (scroll nativo suave, respeitando o layout responsivo) ---
    function slideStep() {
      const first = qs('.croqui-slide', viewport);
      if (!first) return 0;
      const rect = first.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(viewport).gap || '24');
      return rect.width + gap;
    }

    function updateNavState() {
      const max = viewport.scrollWidth - viewport.clientWidth - 2;
      prevBtn.disabled = viewport.scrollLeft <= 2;
      nextBtn.disabled = viewport.scrollLeft >= max;

      const step = slideStep();
      const current = step ? Math.round(viewport.scrollLeft / step) + 1 : 1;
      count.textContent = `${String(clamp(current, 1, slides.length)).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    }

    addListener(prevBtn, 'click', () => viewport.scrollBy({ left: -slideStep(), behavior: 'smooth' }));
    addListener(nextBtn, 'click', () => viewport.scrollBy({ left: slideStep(), behavior: 'smooth' }));

    addListener(viewport, 'keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); viewport.scrollBy({ left: slideStep(), behavior: 'smooth' }); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); viewport.scrollBy({ left: -slideStep(), behavior: 'smooth' }); }
    });

    let scrollRAF;
    addListener(viewport, 'scroll', () => {
      cancelAnimationFrame(scrollRAF);
      scrollRAF = requestAnimationFrame(updateNavState);
    }, passiveOpt);

    addListener(window, 'resize', debounce(updateNavState, 150), passiveOpt);
    updateNavState();

    // clicar numa imagem do CARROSSEL abre em tela cheia
    qsa('.croqui-slide', viewport).forEach(item => {
      addListener(item, 'click', () => viewer.open(item.dataset.url, item.dataset.label));
    });

    // clicar numa imagem do LIGHTBOX "ver todos" também abre em tela cheia
    qsa('.croqui-slide', lightGrid).forEach(item => {
      addListener(item, 'click', () => viewer.open(item.dataset.url, item.dataset.label));
    });

    // efeitos de tilt + magnetismo nos novos elementos, reaproveitando os módulos existentes
    qsa('.croqui-slide .tone', viewport).forEach(el => dom.tiltTargets.push(el));
    [prevBtn, nextBtn, moreBtn].forEach(applyMagnetic);
  }

  /* ------------------------------------------------------------------------
     PERFORMANCE
     ------------------------------------------------------------------------ */
  function setupPerformance() {
    addListener(window, 'resize', debounce(() => { state.fineWide = media.fineWide.matches; }, 200), passiveOpt);
    addListener(document, 'visibilitychange', () => {
      document.body.style.animationPlayState = document.hidden ? 'paused' : 'running';
    });
    const onMotionChange = () => { state.reducedMotion = media.reducedMotion.matches; };
    if (media.reducedMotion.addEventListener) media.reducedMotion.addEventListener('change', onMotionChange);
  }

  function bindEvents() {
    addListener(window, 'pageshow', () => {
      if (dom.header) dom.header.style.transform = 'translateY(0)';
      state.headerHidden = false;
      SmoothScroll.resync();
    });
  }

  /* ------------------------------------------------------------------------
     DESTROY
     ------------------------------------------------------------------------ */
  function destroy() {
    state.listeners.forEach(({ target, type, handler, opts }) => target.removeEventListener(type, handler, opts));
    state.listeners = [];
    state.observers.forEach(o => o.disconnect());
    state.observers = [];
  }

  /* ------------------------------------------------------------------------
     INIT
     ------------------------------------------------------------------------ */
  function init() {
    cacheDOM();
    setupCroquisCarousel();   // precisa vir cedo: substitui a grade de croquis no DOM
    cacheDOM();               // recacheia após o carrossel alterar a árvore
    playHeroIntro();
    setupSmoothScroll();
    setupReveal();
    setupDepthLayers();
    setupNavigation();
    setupScrollEffects();
    setupCursorGlow();
    setupCards();
    setupButtons();
    setupModals();
    setupPerformance();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__studioAcalProject = { destroy, state };
})();