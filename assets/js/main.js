/* ==========================================================================
   STUDIO ACAL — main.js
   Camada de interatividade, fluidez e microinterações.
   Não depende de nenhuma classe/atributo novo no HTML ou CSS: todos os
   estados dinâmicos (barra de progresso, header retrátil, reveals, active
   state do menu) são aplicados via inline style pelo próprio script.
   Vanilla JS (ES2022+). Sem dependências externas.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG — constantes centralizadas
     ------------------------------------------------------------------------ */
  const CONFIG = {
    EASE: 'cubic-bezier(0.22, 1, 0.36, 1)',   // mesma curva usada no CSS (--ease-editorial)
    EASE_SOFT: 'cubic-bezier(0.16, 1, 0.3, 1)',
    DURATION_FAST: 280,
    DURATION_BASE: 520,
    DURATION_SLOW: 800,
    REVEAL_DISTANCE: 32,          // px de deslocamento nos reveals fade
    REVEAL_STAGGER: 70,           // ms entre itens irmãos revelados juntos
    REVEAL_THRESHOLD: 0.16,
    REVEAL_ROOT_MARGIN: '0px 0px -8% 0px',
    HEADER_HIDE_AT: 120,          // px de scroll a partir do qual o header pode esconder
    SCROLLSPY_ROOT_MARGIN: '-40% 0px -55% 0px',
    TILT_MAX_DEG: 6,
    MAGNETIC_STRENGTH: 0.28,
    MAGNETIC_MAX: 14,
    LOADER_REMOVE_AFTER: 3400,    // ms — cobre draw(1.6s@0.3s) + fill + fade(0.9s@2.4s) do CSS
  };

  /* ------------------------------------------------------------------------
     UTILS
     ------------------------------------------------------------------------ */
  const qs = (sel, ctx = document) => ctx.querySelector(sel);
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const isTouchDevice = () =>
    'ontouchstart' in window || navigator.maxTouchPoints > 0;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const lerp = (a, b, t) => a + (b - a) * t;

  function debounce(fn, wait = 150) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  /** Garante no máximo uma execução de `fn` por frame, sempre com o último payload. */
  function rafThrottle(fn) {
    let scheduled = false;
    let lastArgs = null;
    return (...args) => {
      lastArgs = args;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        fn(...lastArgs);
      });
    };
  }

  /** Testa suporte a listener passivo (evita custo de detecção repetida). */
  const supportsPassive = (() => {
    let supported = false;
    try {
      const opts = Object.defineProperty({}, 'passive', {
        get() { supported = true; return true; }
      });
      window.addEventListener('testPassive', null, opts);
      window.removeEventListener('testPassive', null, opts);
    } catch (_) { /* ignora */ }
    return supported;
  })();
  const passiveOpt = supportsPassive ? { passive: true } : false;

  /* ------------------------------------------------------------------------
     ESTADO GLOBAL DO MÓDULO
     ------------------------------------------------------------------------ */
  const state = {
    reducedMotion: prefersReducedMotion(),
    touch: isTouchDevice(),
    lastScrollY: window.scrollY,
    scrollDir: 'up',
    headerHidden: false,
    ticking: false,
    observers: [],
    listeners: [],   // { target, type, handler, opts } — para destroy()
    heroInView: true,
  };

  const dom = {};

  /* ------------------------------------------------------------------------
     CACHE DOM — evita reconsultas repetidas ao DOM
     ------------------------------------------------------------------------ */
  function cacheDOM() {
    dom.header = qs('.site-header');
    dom.menuToggle = qs('.menu-toggle');
    dom.menuPanel = qs('.menu-panel');
    dom.menuLinks = qsa('.menu-links a');
    dom.hero = qs('.hero');
    dom.heroScroll = qs('.hero__scroll');
    dom.heroTone = dom.hero ? qs('.tone', dom.hero) : null;
    dom.loader = qs('.loader');
    dom.revealEls = qsa('.reveal');
    dom.mediaLinks = qsa('.media-link');
    dom.tiltTargets = qsa('.project-block__media, .project-block__side .tone, .team-card, .process-step__media');
    dom.magneticTargets = qsa('.link-line, .menu-trigger, .menu-close, .contact__links a');
    dom.sections = qsa('main [id]'); // seções endereçáveis por âncora (ex.: #projetos, #contato)
    dom.hashNavLinks = qsa('a[href^="#"]');
    dom.pageNavLinks = qsa('.menu-links a[href$=".html"], .brand[href]');
  }

  /* ------------------------------------------------------------------------
     LOADER — apenas orquestra o que já é feito em CSS puro
     ------------------------------------------------------------------------ */
  function setupLoader() {
    if (!dom.loader) return;

    // Trava o scroll enquanto a intro roda, exceto se o usuário preferir menos movimento.
    if (!state.reducedMotion) {
      document.documentElement.style.overflow = 'hidden';
    }

    const release = () => {
      document.documentElement.style.overflow = '';
      dom.loader.style.pointerEvents = 'none';
      dom.loader.setAttribute('aria-hidden', 'true');
      // Remove do fluxo após o fade do CSS terminar, liberando memória/composição.
      dom.loader.remove();
      document.dispatchEvent(new CustomEvent('app:loaded'));
    };

    if (state.reducedMotion) {
      release();
      return;
    }

    let released = false;
    const safeRelease = () => {
      if (released) return;
      released = true;
      release();
    };

    dom.loader.addEventListener('animationend', (e) => {
      if (e.target === dom.loader) safeRelease();
    });
    // Fallback: garante liberação mesmo se algum navegador não disparar o evento.
    setTimeout(safeRelease, CONFIG.LOADER_REMOVE_AFTER);
  }

  /* ------------------------------------------------------------------------
     REVEAL — Intersection Observer exclusivamente (nunca scroll events)
     ------------------------------------------------------------------------ */

  // Heurística de classificação automática do tipo de entrada, com base na
  // função estrutural do elemento (sem exigir novas classes no HTML).
  const REVEAL_RULES = [
    { test: el => el.matches('.manifesto .heading'), type: 'blur' },
    { test: el => el.matches('.project-block__media'), type: 'scale' },
    { test: el => el.matches('.project-block__side'), type: 'fade-left' },
    { test: el => el.matches('.project-block__head'), type: 'fade-up' },
    { test: el => el.matches('.contact__links'), type: 'fade-up' },
    { test: el => el.matches('.contact .heading'), type: 'fade-up' },
    { test: el => el.matches('.grid.grid-12') && !el.matches('.project-block *'), type: 'fade-right' },
    { test: el => el.matches('.process-step, .process-step *'), type: 'fade-up' },
    { test: el => el.matches('.team-card'), type: 'scale' },
    { test: el => el.matches('.materials-list li'), type: 'fade-left' },
    { test: el => el.matches('.next-project'), type: 'fade-up' },
    { test: el => el.matches('.center'), type: 'fade-up' },
  ];

  function classifyReveal(el) {
    const rule = REVEAL_RULES.find(r => r.test(el));
    return rule ? rule.type : 'fade-up';
  }

  // Estado inicial (oculto) por tipo — só transform/opacity/filter, compositor-friendly.
  function initialTransform(type) {
    const d = `${CONFIG.REVEAL_DISTANCE}px`;
    switch (type) {
      case 'fade-up':    return `translateY(${d})`;
      case 'fade-down':  return `translateY(-${d})`;
      case 'fade-left':  return `translateX(-${d})`;
      case 'fade-right': return `translateX(${d})`;
      case 'scale':      return 'scale(0.94)';
      case 'blur':       return 'translateY(14px)';
      default:           return 'none';
    }
  }

  function setupAnimations() {
    if (state.reducedMotion || !dom.revealEls.length) return;

    dom.revealEls.forEach((el, i) => {
      const type = classifyReveal(el);
      el.dataset.revealType = type;
      el.style.opacity = '0';
      el.style.transform = initialTransform(type);
      if (type === 'blur') el.style.filter = 'blur(10px)';
      el.style.willChange = 'opacity, transform, filter';
      // pequeno stagger determinístico entre elementos que entram juntos
      el.dataset.revealDelay = String((i % 4) * CONFIG.REVEAL_STAGGER);
    });
  }

  function revealElement(el) {
    const type = el.dataset.revealType || 'fade-up';
    const delay = Number(el.dataset.revealDelay || 0);
    const duration = type === 'scale' ? CONFIG.DURATION_SLOW : CONFIG.DURATION_BASE;

    el.style.transition =
      `opacity ${duration}ms ${CONFIG.EASE} ${delay}ms, ` +
      `transform ${duration}ms ${CONFIG.EASE} ${delay}ms, ` +
      `filter ${duration}ms ${CONFIG.EASE} ${delay}ms`;

    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.filter = 'none';
    });

    // Libera will-change após a transição para não reter camadas de composição.
    const cleanup = () => {
      el.style.willChange = '';
      el.removeEventListener('transitionend', cleanup);
    };
    el.addEventListener('transitionend', cleanup);
  }

  function setupRevealObserver() {
    if (state.reducedMotion || !dom.revealEls.length) return null;

    const io = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        revealElement(entry.target);
        observer.unobserve(entry.target);
      });
    }, {
      threshold: CONFIG.REVEAL_THRESHOLD,
      rootMargin: CONFIG.REVEAL_ROOT_MARGIN,
    });

    dom.revealEls.forEach(el => io.observe(el));
    state.observers.push(io);

    // Mutation Observer: cobre conteúdo inserido dinamicamente depois do load
    // (ex.: paginação de projetos, includes futuros) sem exigir novo binding manual.
    const mo = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return;
          const candidates = node.matches('.reveal') ? [node] : qsa('.reveal', node);
          candidates.forEach(el => {
            if (el.dataset.revealType) return; // já processado
            const type = classifyReveal(el);
            el.dataset.revealType = type;
            el.style.opacity = '0';
            el.style.transform = initialTransform(type);
            if (type === 'blur') el.style.filter = 'blur(10px)';
            io.observe(el);
          });
        });
      });
    });
    mo.observe(qs('main') || document.body, { childList: true, subtree: true });
    state.observers.push(mo);

    return io;
  }

  /* ------------------------------------------------------------------------
     NAVEGAÇÃO — menu, scroll suave, header retrátil, scrollspy
     ------------------------------------------------------------------------ */

  function closeMenu() {
    if (dom.menuToggle) dom.menuToggle.checked = false;
  }

  function smoothScrollTo(targetEl) {
    if (!targetEl) return;

    const headerOffset = dom.header ? dom.header.getBoundingClientRect().height : 0;
    const targetY = targetEl.getBoundingClientRect().top + window.scrollY - headerOffset - 8;

    if (state.reducedMotion) {
      window.scrollTo(0, targetY);
      return;
    }

    const startY = window.scrollY;
    const distance = targetY - startY;
    const duration = clamp(Math.abs(distance) * 0.5, 400, 1000);
    let startTime = null;

    // easeInOutCubic — sensação natural de aceleração/desaceleração
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    function step(ts) {
      if (startTime === null) startTime = ts;
      const elapsed = ts - startTime;
      const progress = clamp(elapsed / duration, 0, 1);
      window.scrollTo(0, startY + distance * ease(progress));
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function setupSmoothAnchors() {
    dom.hashNavLinks.forEach(link => {
      const hash = link.getAttribute('href');
      if (!hash || hash === '#' || hash.length < 2) return;
      const target = qs(hash);
      if (!target) return; // link para âncora em outra página

      addListener(link, 'click', (e) => {
        e.preventDefault();
        closeMenu();
        smoothScrollTo(target);
        history.pushState(null, '', hash);
      });
    });

    // Seta de "role" do hero leva à próxima seção
    if (dom.heroScroll) {
      dom.heroScroll.style.cursor = 'pointer';
      addListener(dom.heroScroll, 'click', () => {
        const next = dom.hero.nextElementSibling;
        if (next) smoothScrollTo(next);
      });
    }
  }

  function setupMenuBehavior() {
    if (!dom.menuToggle) return;

    // Fecha o menu ao navegar para uma seção/página
    dom.menuLinks.forEach(link => addListener(link, 'click', closeMenu));

    // Fecha com Esc, sem depender de mouse
    addListener(document, 'keydown', (e) => {
      if (e.key === 'Escape' && dom.menuToggle.checked) closeMenu();
    });

    // Marca a página atual no menu (útil em processo.html, studio.html, contato.html)
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
      const isMatch = link.getAttribute('href') === `#${id}`;
      link.style.color = isMatch ? 'var(--oxide)' : '';
      if (isMatch) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  function setupScrollSpy() {
    const idSections = dom.sections.filter(s => s.id);
    if (!idSections.length) return;

    const spyLinks = dom.menuLinks.filter(l => (l.getAttribute('href') || '').startsWith('#'));
    if (!spyLinks.length) return;

    const io = new IntersectionObserver((entries) => {
      // escolhe a seção mais visível dentre as que estão intersectando
      const visible = entries.filter(e => e.isIntersecting);
      if (!visible.length) return;
      const top = visible.reduce((a, b) => (a.intersectionRatio > b.intersectionRatio ? a : b));
      setActiveHashLink(top.target.id);
    }, { rootMargin: CONFIG.SCROLLSPY_ROOT_MARGIN, threshold: 0.01 });

    idSections.forEach(sec => io.observe(sec));
    state.observers.push(io);
  }

  function setupHeaderAutoHide() {
    if (!dom.header) return;
    dom.header.style.transition = `transform ${CONFIG.DURATION_BASE}ms ${CONFIG.EASE}`;
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
    setupMenuBehavior();
    setupSmoothAnchors();
    setupScrollSpy();
    setupHeaderAutoHide();
  }

  /* ------------------------------------------------------------------------
     SCROLL EFFECTS — barra de progresso + parallax sutil do hero
     (única frente onde eventos de scroll são usados, nunca para reveals)
     ------------------------------------------------------------------------ */

  function createProgressBar() {
    const bar = document.createElement('div');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'height:2px', 'width:100%',
      'transform-origin:0 0', 'transform:scaleX(0)',
      'background:var(--ink, #14130f)', 'z-index:100',
      'transition:transform 80ms linear', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(bar);
    return bar;
  }

  function setupScrollEffects() {
    const progressBar = createProgressBar();

    if (dom.hero) {
      const heroIO = new IntersectionObserver(([entry]) => {
        state.heroInView = entry.isIntersecting;
      }, { threshold: 0 });
      heroIO.observe(dom.hero);
      state.observers.push(heroIO);
    }

    const onScroll = rafThrottle(() => {
      const doc = document.documentElement;
      const currentY = window.scrollY;
      const maxScroll = doc.scrollHeight - doc.clientHeight;
      const progress = maxScroll > 0 ? clamp(currentY / maxScroll, 0, 1) : 0;

      progressBar.style.transform = `scaleX(${progress})`;
      updateHeaderVisibility(currentY);

      if (!state.reducedMotion && state.heroInView && dom.heroTone) {
        const shift = clamp(currentY * 0.18, 0, 120);
        dom.heroTone.style.transform = `translate3d(0, ${shift}px, 0)`;
      }

      state.lastScrollY = currentY;
    });

    addListener(window, 'scroll', onScroll, passiveOpt);
    onScroll(); // estado inicial correto em reloads com scroll restaurado
  }

  /* ------------------------------------------------------------------------
     CARDS — tilt sutil em imagens/blocos de projeto (apenas ponteiro fino)
     ------------------------------------------------------------------------ */

  function setupCards() {
    if (state.touch || state.reducedMotion || !dom.tiltTargets.length) return;

    dom.tiltTargets.forEach(card => {
      card.style.transition = `transform ${CONFIG.DURATION_FAST}ms ${CONFIG.EASE_SOFT}`;
      card.style.transformStyle = 'preserve-3d';

      const onMove = (e) => {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;   // 0..1
        const py = (e.clientY - rect.top) / rect.height;   // 0..1
        const rx = (0.5 - py) * CONFIG.TILT_MAX_DEG;
        const ry = (px - 0.5) * CONFIG.TILT_MAX_DEG;
        card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      };

      const onLeave = () => {
        card.style.transform = 'perspective(900px) rotateX(0) rotateY(0)';
      };

      addListener(card, 'pointermove', onMove);
      addListener(card, 'pointerleave', onLeave);
    });
  }

  /* ------------------------------------------------------------------------
     BOTÕES / LINKS — efeito magnético sutil
     ------------------------------------------------------------------------ */

  function setupButtons() {
    if (state.touch || state.reducedMotion || !dom.magneticTargets.length) return;

    dom.magneticTargets.forEach(btn => {
      btn.style.transition = `transform ${CONFIG.DURATION_FAST}ms ${CONFIG.EASE_SOFT}`;

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
     FORMS — genérico e defensivo (não há forms nesta página; preparado
     para processo.html/contato.html ou futuras páginas do site)
     ------------------------------------------------------------------------ */

  function setupForms() {
    const forms = qsa('form');
    if (!forms.length) return;

    forms.forEach(form => {
      const fields = qsa('input, textarea, select', form);

      fields.forEach(field => {
        // feedback visual de foco sem exigir CSS novo
        addListener(field, 'focus', () => {
          field.style.transition = `border-color ${CONFIG.DURATION_FAST}ms ${CONFIG.EASE}`;
          field.style.outline = 'none';
        });
      });

      addListener(form, 'submit', (e) => {
        const invalid = fields.find(f => f.hasAttribute('required') && !f.value.trim());
        if (invalid) {
          e.preventDefault();
          invalid.focus();
          invalid.style.borderColor = 'var(--oxide, #7a3621)';
        }
      });
    });
  }

  /* ------------------------------------------------------------------------
     ACCORDIONS / MODAIS / TOOLTIPS — genéricos via data-attributes.
     Não há nenhum destes elementos na página atual; ficam prontos para
     quando existirem, sem custo se ausentes (early return).
     ------------------------------------------------------------------------ */

  function setupAccordions() {
    const triggers = qsa('[data-accordion-trigger]');
    if (!triggers.length) return;

    triggers.forEach(trigger => {
      const panel = document.getElementById(trigger.getAttribute('aria-controls') || '');
      if (!panel) return;

      panel.style.overflow = 'hidden';
      panel.style.transition = `height ${CONFIG.DURATION_BASE}ms ${CONFIG.EASE}`;
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
      const close = () => {
        modal.style.opacity = '0';
        modal.style.pointerEvents = 'none';
        opener.focus();
      };
      const open = () => {
        modal.style.transition = `opacity ${CONFIG.DURATION_BASE}ms ${CONFIG.EASE}`;
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
        qs('[tabindex], a, button, input', modal)?.focus();
      };

      addListener(opener, 'click', open);
      if (closeBtn) addListener(closeBtn, 'click', close);
      addListener(modal, 'click', (e) => { if (e.target === modal) close(); });
      addListener(document, 'keydown', (e) => {
        if (e.key === 'Escape' && modal.style.pointerEvents === 'auto') close();
      });
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
        `transition:opacity ${CONFIG.DURATION_FAST}ms ${CONFIG.EASE}`,
        'transform:translateY(4px)', 'font-size:0.75rem',
      ].join(';');
      el.style.position = el.style.position || 'relative';
      el.appendChild(tip);

      addListener(el, 'pointerenter', () => { tip.style.opacity = '1'; });
      addListener(el, 'pointerleave', () => { tip.style.opacity = '0'; });
    });
  }

  /* ------------------------------------------------------------------------
     PERFORMANCE — utilitários transversais (resize/orientation, visibilidade)
     ------------------------------------------------------------------------ */

  function setupPerformance() {
    // Recalcula estados dependentes de layout sem custo por frame
    const onResize = debounce(() => {
      state.touch = isTouchDevice();
    }, 200);
    addListener(window, 'resize', onResize, passiveOpt);

    if ('ResizeObserver' in window && dom.hero) {
      const ro = new ResizeObserver(debounce(() => {
        // mantém o parallax coerente após mudanças de viewport/orientação
        if (dom.heroTone) dom.heroTone.style.transform = 'translate3d(0,0,0)';
      }, 150));
      ro.observe(dom.hero);
      state.observers.push(ro);
    }

    // Pausa trabalho supérfluo quando a aba não está visível
    addListener(document, 'visibilitychange', () => {
      document.body.style.animationPlayState = document.hidden ? 'paused' : 'running';
    });

    // Reage a mudança de preferência de movimento em tempo real
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = () => { state.reducedMotion = motionQuery.matches; };
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
  }

  /* ------------------------------------------------------------------------
     EVENT BINDING HELPER — registra e guarda referência para destroy()
     ------------------------------------------------------------------------ */
  function addListener(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    state.listeners.push({ target, type, handler, opts });
  }

  function bindEvents() {
    // ponto único reservado para listeners globais adicionais no futuro
    addListener(window, 'pageshow', () => {
      // Garante header visível ao voltar via cache do navegador (bfcache)
      if (dom.header) dom.header.style.transform = 'translateY(0)';
      state.headerHidden = false;
    });
  }

  /* ------------------------------------------------------------------------
     SETUP OBSERVERS — agrega os observers de conteúdo (reveal)
     ------------------------------------------------------------------------ */
  function setupObservers() {
    setupRevealObserver();
  }

  /* ------------------------------------------------------------------------
     DESTROY — limpeza completa (útil em navegação SPA-like ou testes)
     ------------------------------------------------------------------------ */
  function destroy() {
    state.listeners.forEach(({ target, type, handler, opts }) => {
      target.removeEventListener(type, handler, opts);
    });
    state.listeners = [];

    state.observers.forEach(observer => observer.disconnect());
    state.observers = [];
  }

  /* ------------------------------------------------------------------------
     INIT
     ------------------------------------------------------------------------ */
  function init() {
    cacheDOM();
    setupLoader();
    setupAnimations();
    setupObservers();
    setupNavigation();
    setupScrollEffects();
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
    init(); // script tem `defer`, DOM já deve estar pronto, mas garante robustez
  }

  // Exposto apenas para depuração manual em ambiente de desenvolvimento.
  window.__studioAcal = { destroy, state };
})();

const videos = document.querySelectorAll("video");

const observer = new IntersectionObserver((entries)=>{

    entries.forEach(entry=>{

        const video = entry.target;

        if(entry.isIntersecting){

            video.currentTime = 0;
            video.play();

        }else{

            video.pause();

        }

    });

},{
    threshold:.5
});

videos.forEach(video=>observer.observe(video));