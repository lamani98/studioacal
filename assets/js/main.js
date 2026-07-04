/* ==========================================================================
   STUDIO ACAL — main.js (v2 "cinematic")
   Camada de interatividade premium inspirada na fluidez de navegação de
   sites como apple.com — sem copiar layout, assets ou conteúdo, apenas o
   NÍVEL de acabamento das transições.

   Não altera HTML/CSS: todo estado dinâmico é aplicado via inline style
   e DOM manipulado em runtime (ex.: split de palavras em títulos).

   Vanilla JS (ES2022+). Zero dependências externas.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------------ */
  const CONFIG = {
    EASE: 'cubic-bezier(0.22, 1, 0.36, 1)',      // --ease-editorial do CSS
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

    // motor de scroll suave (inércia estilo trackpad premium)
    WHEEL_MULTIPLIER: 1,
    SCROLL_DAMPING: 0.20,          // 0-1, menor = mais "flutuante"
    SCROLL_SETTLE_EPSILON: 0.4,

    // parallax / profundidade
    PARALLAX_FACTOR: 0.14,
    DEPTH_EXIT_SCALE: 0.94,
    DEPTH_ACTIVATE_MARGIN: '35% 0px 35% 0px',

    TILT_MAX_DEG: 7,
    MAGNETIC_STRENGTH: 0.3,
    MAGNETIC_MAX: 16,
    LAZY_ACTIVATE_MARGIN: '200px',

    LOADER_REMOVE_AFTER: 3400,
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
    try {
      window.addEventListener('t', null, { get passive() { ok = true; return true; } });
    } catch (_) { /* noop */ }
    return ok;
  })();
  const passiveOpt = supportsPassive ? { passive: true } : false;

  /** Divide um heading em palavras encapsuladas para reveal tipográfico
   *  cinematográfico (cada palavra "sobe" para dentro do quadro), mantendo
   *  acessibilidade via aria-label no container original. Idempotente. */
  function splitWords(el) {
    if (el.dataset.split === 'true') return qsa('.word-inner', el);
    const original = el.textContent.trim();
    el.setAttribute('aria-label', original);
    el.textContent = '';
    original.split(/\s+/).forEach((word, i) => {
      const mask = document.createElement('span');
      mask.setAttribute('aria-hidden', 'true');
      mask.style.display = 'inline-block';
      mask.style.overflow = 'hidden';
      mask.style.verticalAlign = 'top';
      mask.style.paddingBottom = '0.08em'; // evita corte de descendentes (ex.: "ç", "p")

      const inner = document.createElement('span');
      inner.className = 'word-inner';
      inner.textContent = word;
      inner.style.display = 'inline-block';
      inner.style.willChange = 'transform, opacity';
      inner.style.transform = 'translateY(115%)';
      inner.style.opacity = '0';
      inner.dataset.index = String(i);

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
     TICKER — laço único de requestAnimationFrame compartilhado.
     Módulos se inscrevem/desinscrevem; o laço só roda enquanto houver
     assinantes ativos (lazy activation, sem custo em ocioso).
     ------------------------------------------------------------------------ */
  const Ticker = (() => {
    const subs = new Set();
    let running = false;
    let lastTime = 0;

    function tick(now) {
      const dt = lastTime ? now - lastTime : 16.6;
      lastTime = now;
      subs.forEach(fn => fn(now, dt));
      if (subs.size) requestAnimationFrame(tick);
      else running = false;
    }

    return {
      add(fn) {
        subs.add(fn);
        if (!running) { running = true; lastTime = 0; requestAnimationFrame(tick); }
      },
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
    dom.heroContent = qs('.hero__content');
    dom.heroTitle = qs('.hero h1');
    dom.heroEyebrow = dom.hero ? qs('.eyebrow', dom.hero) : null;
    dom.heroTone = dom.hero ? qs('.tone', dom.hero) : null;
    dom.heroScroll = qs('.hero__scroll');
    dom.loader = qs('.loader');
    dom.revealEls = qsa('.reveal');
    dom.sections = qsa('main > section');
    dom.mediaLinks = qsa('.media-link');
    dom.tiltTargets = qsa('.project-block__media, .project-block__side .tone, .team-card, .process-step__media');
    dom.magneticTargets = qsa('.link-line, .menu-trigger, .menu-close, .contact__links a, .brand');
    dom.parallaxEls = qsa('.section .tone, .manifesto .heading');
    dom.idSections = qsa('main [id]');
    dom.hashNavLinks = qsa('a[href^="#"]');
    dom.pageNavLinks = qsa('.menu-links a[href$=".html"], .brand[href]');
    dom.projectTitles = qsa('.project-block__title');
  }

  /* ------------------------------------------------------------------------
     LOADER + INTRO CHOREOGRAPHY
     ------------------------------------------------------------------------ */
  function setupLoader() {
    if (!dom.loader) { playHeroIntro(); return; }

    if (!state.reducedMotion) document.documentElement.style.overflow = 'hidden';

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      document.documentElement.style.overflow = '';
      dom.loader.style.pointerEvents = 'none';
      dom.loader.setAttribute('aria-hidden', 'true');
      dom.loader.remove();
      document.dispatchEvent(new CustomEvent('app:loaded'));
      playHeroIntro();
    };

    if (state.reducedMotion) { release(); return; }

    dom.loader.addEventListener('animationend', (e) => { if (e.target === dom.loader) release(); });
    setTimeout(release, CONFIG.LOADER_REMOVE_AFTER);
  }

  /** Choreography de entrada do hero: título entra palavra a palavra,
   *  eyebrow e indicador de scroll seguem em cascata — a "cena de abertura". */
  function playHeroIntro() {
    if (state.reducedMotion || !dom.heroTitle) return;

    const titleWords = splitWords(dom.heroTitle);
    playWords(titleWords, { delayBase: 80, stagger: CONFIG.WORD_STAGGER });

    if (dom.heroEyebrow) {
      dom.heroEyebrow.style.opacity = '0';
      dom.heroEyebrow.style.transform = 'translateY(14px)';
      dom.heroEyebrow.style.transition = `opacity ${CONFIG.DUR_BASE}ms ${CONFIG.EASE} 420ms, transform ${CONFIG.DUR_BASE}ms ${CONFIG.EASE} 420ms`;
      requestAnimationFrame(() => {
        dom.heroEyebrow.style.opacity = '1';
        dom.heroEyebrow.style.transform = 'translateY(0)';
      });
    }

    if (dom.heroScroll) {
      dom.heroScroll.style.opacity = '0';
      dom.heroScroll.style.transition = `opacity ${CONFIG.DUR_BASE}ms ${CONFIG.EASE} 900ms`;
      requestAnimationFrame(() => { dom.heroScroll.style.opacity = '1'; });
    }
  }

  /* ------------------------------------------------------------------------
     SMOOTH SCROLL — inércia estilo "trackpad premium" via wheel + lerp.
     Não substitui a rolagem nativa: apenas suaviza a resposta ao mouse
     wheel em desktop. Toque, teclado e leitores de tela usam o
     comportamento nativo, sem interferência.
     ------------------------------------------------------------------------ */
  const SmoothScroll = (() => {
    let target = window.scrollY;
    let current = window.scrollY;
    let active = false;
    let enabled = false;

    function normalizeDelta(e) {
      // Chrome entrega pixels; Firefox às vezes entrega "linhas".
      const mult = e.deltaMode === 1 ? 18 : 1;
      return e.deltaY * mult;
    }

    function onWheel(e) {
      if (e.ctrlKey) return;               // preserva zoom do navegador
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // scroll horizontal intencional
      e.preventDefault();

      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      target = clamp(target + normalizeDelta(e) * CONFIG.WHEEL_MULTIPLIER, 0, max);

      if (!active) { active = true; Ticker.add(tick); }
    }

    function tick() {
      current = lerp(current, target, CONFIG.SCROLL_DAMPING);
      window.scrollTo(0, current);

      if (Math.abs(target - current) < CONFIG.SCROLL_SETTLE_EPSILON) {
        current = target;
        window.scrollTo(0, current);
        active = false;
        Ticker.remove(tick);
      }
    }

    function resync() {
      // Mantém o motor coerente com rolagens nativas (teclado, âncoras, touch).
      if (!active) { target = window.scrollY; current = target; }
    }

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
    if (state.reducedMotion || media.coarsePointer.matches) return;
    SmoothScroll.init();
  }

  /* ------------------------------------------------------------------------
     REVEAL — IntersectionObserver reversível (entra E sai de cena),
     com classificação automática de tipo por função estrutural do
     elemento e reforço tipográfico (split-words) em headings-chave.
     ------------------------------------------------------------------------ */
  const REVEAL_RULES = [
    { test: el => el.matches('.manifesto .heading'), type: 'blur-words' },
    { test: el => el.matches('.project-block__title'), type: 'words' },
    { test: el => el.matches('.project-block__media'), type: 'clip' },
    { test: el => el.matches('.project-block__side'), type: 'fade-left' },
    { test: el => el.matches('.project-block__head'), type: 'fade-up' },
    { test: el => el.matches('.contact .heading'), type: 'words' },
    { test: el => el.matches('.contact__links'), type: 'fade-up' },
    { test: el => el.matches('.grid.grid-12') && !el.closest('.project-block__head, .project-block__media, .project-block__side'), type: 'fade-right' },
    { test: el => el.matches('.process-step, .process-step *'), type: 'fade-up' },
    { test: el => el.matches('.team-card'), type: 'scale' },
    { test: el => el.matches('.materials-list li'), type: 'fade-left' },
    { test: el => el.matches('.next-project'), type: 'scale' },
    { test: el => el.matches('.center'), type: 'fade-up' },
  ];

  function classifyReveal(el) {
    return (REVEAL_RULES.find(r => r.test(el)) || {}).type || 'fade-up';
  }

  function initialTransform(type, dir) {
    const d = `${CONFIG.REVEAL_DISTANCE}px`;
    const sign = dir === 'up' ? -1 : 1;
    switch (type) {
      case 'fade-up':
      case 'blur-words':
        return `translateY(${sign * CONFIG.REVEAL_DISTANCE}px)`;
      case 'fade-left':  return `translateX(-${d})`;
      case 'fade-right': return `translateX(${d})`;
      case 'scale':       return 'scale(0.92)';
      default:             return 'none';
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
    if (type === 'blur-words') el.style.filter = 'blur(14px)';
  }

  function fireReveal(el, index) {
    const type = el.dataset.revealType;
    const delay = (index % 4) * CONFIG.GROUP_STAGGER;

    if (type === 'words') {
      playWords(splitWords(el), { delayBase: delay });
      return;
    }
    if (type === 'clip') {
      el.style.transition = `clip-path ${CONFIG.DUR_SLOW}ms ${CONFIG.EASE_SNAP} ${delay}ms`;
      requestAnimationFrame(() => { el.style.clipPath = 'inset(0 0 0 0%)'; });
      return;
    }

    const duration = type === 'scale' ? CONFIG.DUR_SLOW : CONFIG.DUR_BASE;
    el.style.transition =
      `opacity ${duration}ms ${CONFIG.EASE} ${delay}ms, ` +
      `transform ${duration}ms ${CONFIG.EASE} ${delay}ms, ` +
      `filter ${duration}ms ${CONFIG.EASE} ${delay}ms`;

    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.filter = 'none';
    });
  }

  function setupReveal() {
    if (state.reducedMotion || !dom.revealEls.length) return;

    dom.revealEls.forEach((el, i) => {
      el.dataset.revealType = classifyReveal(el);
      el.dataset.revealIndex = String(i);
      el.style.willChange = 'opacity, transform, filter, clip-path';
      armReveal(el);
    });

    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const el = entry.target;
        if (entry.isIntersecting) {
          fireReveal(el, Number(el.dataset.revealIndex));
        } else if (entry.boundingClientRect.top > 0) {
          // Só re-arma quando o elemento saiu por CIMA da viewport ao
          // rolar para trás — evita "resetar" itens que já ficaram atrás.
          armReveal(el);
        }
      });
    }, { threshold: CONFIG.REVEAL_THRESHOLD, rootMargin: CONFIG.REVEAL_ROOT_MARGIN });

    dom.revealEls.forEach(el => io.observe(el));
    state.observers.push(io);

    // MutationObserver: cobre conteúdo inserido dinamicamente após o load.
    const mo = new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        const found = node.matches('.reveal') ? [node] : qsa('.reveal', node);
        found.forEach(el => {
          if (el.dataset.revealType) return;
          el.dataset.revealType = classifyReveal(el);
          el.dataset.revealIndex = '0';
          armReveal(el);
          io.observe(el);
        });
      }));
    });
    mo.observe(qs('main') || document.body, { childList: true, subtree: true });
    state.observers.push(mo);
  }

  /* ------------------------------------------------------------------------
     DEPTH & PARALLAX — camadas com profundidade real, calculadas apenas
     enquanto o elemento está próximo da viewport (ativação lazy via IO),
     e interpoladas suavemente no Ticker compartilhado.
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
        const distFromCenter = (center - vh / 2) / vh; // -~1..~1

        // Parallax leve: a camada de imagem se move um pouco mais devagar
        // que o scroll, criando sensação de profundidade entre planos.
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

    dom.parallaxEls.forEach(el => {
      el.style.willChange = 'transform';
      io.observe(el);
    });
    if (dom.heroTone) io.observe(dom.heroTone);

    state.observers.push(io);
  }

  /** Transição entre seções quase imperceptível: a seção que está saindo
   *  pela parte de cima recua sutilmente em escala/opacidade, como se a
   *  câmera avançasse de plano — só roda enquanto a seção está próxima
   *  do topo (ativação lazy via IO), nunca em scroll global constante. */
  function setupSectionTransitions() {
    if (state.reducedMotion || !dom.sections.length) return;

    const tracked = new Set();

    function frame() {
      const vh = window.innerHeight;
      tracked.forEach(sec => {
        const rect = sec.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= vh) return;
        // progresso de saída: 0 quando o topo da seção está no topo da viewport,
        // 1 quando a seção já rolou completamente para fora por cima.
        const progress = clamp(-rect.top / Math.max(rect.height, 1), 0, 1);
        if (progress <= 0) {
          sec.style.opacity = '';
          sec.style.transform = '';
          sec.style.filter = '';
          return;
        }
        const scale = lerp(1, CONFIG.DEPTH_EXIT_SCALE, progress);
        const opacity = lerp(1, 0.55, progress);
        sec.style.transform = `scale(${scale.toFixed(4)})`;
        sec.style.opacity = opacity.toFixed(3);
      });
    }

    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) tracked.add(entry.target);
        else { tracked.delete(entry.target); entry.target.style.transform = ''; entry.target.style.opacity = ''; }
      });
      if (tracked.size) Ticker.add(frame); else Ticker.remove(frame);
    }, { rootMargin: '0px 0px -60% 0px', threshold: 0 });

    dom.sections.forEach(sec => {
      sec.style.willChange = 'transform, opacity';
      sec.style.transformOrigin = 'top center';
      io.observe(sec);
    });
    state.observers.push(io);
  }

  /* ------------------------------------------------------------------------
     NAVEGAÇÃO — menu, scroll suave por âncora, header retrátil, scrollspy
     ------------------------------------------------------------------------ */
  function closeMenu() { if (dom.menuToggle) dom.menuToggle.checked = false; }

  function scrollToTarget(targetEl) {
    if (!targetEl) return;
    const offset = dom.header ? dom.header.getBoundingClientRect().height : 0;
    const y = targetEl.getBoundingClientRect().top + window.scrollY - offset - 8;

    if (state.reducedMotion) { window.scrollTo(0, y); return; }
    if (SmoothScroll.isEnabled) { SmoothScroll.jumpTo(y); return; }

    // Fallback com easing próprio quando o motor de wheel está desativado
    // (touch/coarse pointer), preservando a sensação de movimento natural.
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
        e.preventDefault();
        closeMenu();
        scrollToTarget(target);
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

    const currentPath = location.pathname.replace(/\/$/, '').split('/').pop() || 'index.html';
    dom.pageNavLinks.forEach(link => {
      const linkPath = (link.getAttribute('href') || '').split('/').pop();
      if (linkPath === currentPath) {
        link.style.color = 'var(--oxide)';
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  function setActiveHashLink(id) {
    dom.menuLinks.forEach(link => {
      const match = link.getAttribute('href') === `#${id}`;
      link.style.color = match ? 'var(--oxide)' : '';
      if (match) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
    });
  }

  function setupScrollSpy() {
    const idSections = dom.idSections.filter(s => s.id);
    if (!idSections.length || !dom.menuLinks.length) return;

    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting);
      if (!visible.length) return;
      const top = visible.reduce((a, b) => (a.intersectionRatio > b.intersectionRatio ? a : b));
      setActiveHashLink(top.target.id);
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0.01 });

    idSections.forEach(sec => io.observe(sec));
    state.observers.push(io);
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
    setupScrollSpy();
  }

  /* ------------------------------------------------------------------------
     SCROLL EFFECTS — barra de progresso + leitura de direção/posição
     (única frente que usa scroll contínuo; nunca para reveals)
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

    // A barra/header precisam refletir a posição real do documento a
    // cada frame apenas enquanto há rolagem em curso; usamos o próprio
    // evento de scroll só para (des)ligar o Ticker — nunca para animar.
    let scrollTimeout;
    const onScroll = () => {
      Ticker.add(frame);
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => Ticker.remove(frame), 120);
    };

    addListener(window, 'scroll', onScroll, passiveOpt);
    frame(); // estado inicial correto (ex.: reload com scroll restaurado)
  }

  /* ------------------------------------------------------------------------
     CURSOR GLOW — camada sutil de profundidade que segue o ponteiro com
     suavização (lerp), reforçando a sensação premium sem distrair.
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

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let x = mouseX;
    let y = mouseY;
    let visible = false;

    function frame() {
      x = lerp(x, mouseX, 0.12);
      y = lerp(y, mouseY, 0.12);
      glow.style.transform = `translate3d(${x}px, ${y}px, 0) translate3d(-50%,-50%,0)`;
    }

    addListener(window, 'pointermove', (e) => {
      mouseX = e.clientX; mouseY = e.clientY;
      if (!visible) { visible = true; glow.style.opacity = '1'; Ticker.add(frame); }
    }, passiveOpt);

    addListener(document, 'mouseleave', () => {
      visible = false; glow.style.opacity = '0'; Ticker.remove(frame);
    });
  }

  /* ------------------------------------------------------------------------
     CARDS — tilt 3D sutil, com ativação lazy (listener só perto da viewport)
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
     BOTÕES / LINKS — efeito magnético sutil
     ------------------------------------------------------------------------ */
  function setupButtons() {
    if (state.reducedMotion || !state.fineWide || !dom.magneticTargets.length) return;

    dom.magneticTargets.forEach(btn => {
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
    });
  }

  /* ------------------------------------------------------------------------
     FORMS / ACCORDIONS / MODALS / TOOLTIPS — genéricos e defensivos.
     Nenhum existe nesta página; ficam prontos para as demais do site,
     sem custo algum quando ausentes (early return).
     ------------------------------------------------------------------------ */
  function setupForms() {
    const forms = qsa('form');
    if (!forms.length) return;
    forms.forEach(form => {
      const fields = qsa('input, textarea, select', form);
      fields.forEach(field => addListener(field, 'focus', () => {
        field.style.transition = `border-color ${CONFIG.DUR_FAST}ms ${CONFIG.EASE}`;
      }));
      addListener(form, 'submit', (e) => {
        const invalid = fields.find(f => f.hasAttribute('required') && !f.value.trim());
        if (invalid) { e.preventDefault(); invalid.focus(); invalid.style.borderColor = 'var(--oxide, #7a3621)'; }
      });
    });
  }

  function setupAccordions() {
    const triggers = qsa('[data-accordion-trigger]');
    if (!triggers.length) return;
    triggers.forEach(trigger => {
      const panel = document.getElementById(trigger.getAttribute('aria-controls') || '');
      if (!panel) return;
      panel.style.overflow = 'hidden';
      panel.style.transition = `height ${CONFIG.DUR_BASE}ms ${CONFIG.EASE}`;
      panel.style.height = trigger.getAttribute('aria-expanded') === 'true' ? 'auto' : '0px';
      addListener(trigger, 'click', () => {
        const expanded = trigger.getAttribute('aria-expanded') === 'true';
        trigger.setAttribute('aria-expanded', String(!expanded));
        panel.style.height = expanded ? '0px' : `${panel.scrollHeight}px`;
      });
    });
  }

  function setupModals() {
    const openers = qsa('[data-modal-target]');
    if (!openers.length) return;
    openers.forEach(opener => {
      const modal = document.getElementById(opener.getAttribute('data-modal-target'));
      if (!modal) return;
      const closeBtn = qs('[data-modal-close]', modal);
      const close = () => { modal.style.opacity = '0'; modal.style.pointerEvents = 'none'; opener.focus(); };
      const open = () => {
        modal.style.transition = `opacity ${CONFIG.DUR_BASE}ms ${CONFIG.EASE}`;
        modal.style.opacity = '1'; modal.style.pointerEvents = 'auto';
        qs('[tabindex], a, button, input', modal)?.focus();
      };
      addListener(opener, 'click', open);
      if (closeBtn) addListener(closeBtn, 'click', close);
      addListener(modal, 'click', e => { if (e.target === modal) close(); });
      addListener(document, 'keydown', e => { if (e.key === 'Escape' && modal.style.pointerEvents === 'auto') close(); });
    });
  }

  function setupTooltips() {
    const targets = qsa('[data-tooltip]');
    if (!targets.length) return;
    targets.forEach(el => {
      const tip = document.createElement('span');
      tip.textContent = el.getAttribute('data-tooltip');
      tip.setAttribute('role', 'tooltip');
      tip.style.cssText = [
        'position:absolute', 'opacity:0', 'pointer-events:none',
        `transition:opacity ${CONFIG.DUR_FAST}ms ${CONFIG.EASE}`,
        'transform:translateY(4px)', 'font-size:0.75rem',
      ].join(';');
      el.style.position = el.style.position || 'relative';
      el.appendChild(tip);
      addListener(el, 'pointerenter', () => { tip.style.opacity = '1'; });
      addListener(el, 'pointerleave', () => { tip.style.opacity = '0'; });
    });
  }

  /* ------------------------------------------------------------------------
     PERFORMANCE — utilitários transversais
     ------------------------------------------------------------------------ */
  function setupPerformance() {
    addListener(window, 'resize', debounce(() => {
      state.fineWide = media.fineWide.matches;
    }, 200), passiveOpt);

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
    setupLoader();          // dispara playHeroIntro() ao concluir
    setupSmoothScroll();
    setupReveal();
    setupDepthLayers();
    setupSectionTransitions();
    setupNavigation();
    setupScrollEffects();
    setupCursorGlow();
    setupCards();
    setupButtons();
    setupForms();
    setupAccordions();
    setupModals();
    setupTooltips();
    setupPerformance();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__studioAcal = { destroy, state };
})();