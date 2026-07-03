/**
 * Studio — Composição Editorial
 * -----------------------------------------------------
 * Vanilla JS. Sem dependências externas.
 * Anima apenas transform / opacity (GPU friendly).
 */

(() => {
  'use strict';

  /* =====================================================
     CONFIGURAÇÃO
     ===================================================== */
  const TOTAL_IMAGES      = 15;
  const IMAGE_BASE_PATH    = 'assets/images/';
  const STAGGER_MS        = 2000;   // intervalo entre a entrada de cada fotografia
  const HOLD_MS           = 3000;   // pausa com a composição completa
  const EXIT_STAGGER_MS   = 350;    // intervalo entre a saída de cada fotografia
  const ROTATION_RANGE    = 6;      // graus, -6 a +6
  const SCALE_MIN         = 0.95;
  const SCALE_MAX         = 1.05;
  const PARALLAX_STRENGTH = 0.02;   // ~2%

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  const canvas = document.getElementById('canvas');

  // Estado da galeria
  let photoElements = [];   // elementos .photo, na ordem em que entraram
  let cycleTimer     = null;
  let isRunning      = false;

  /* =====================================================
     DISTRIBUIÇÃO ORGÂNICA (GRADE COM VARIAÇÃO ALEATÓRIA)
     -----------------------------------------------------
     Em vez de posições puramente aleatórias — que tendem a
     aglomerar no centro e deixar cantos vazios — a tela é
     dividida em células invisíveis. Cada fotografia recebe
     uma célula (em ordem embaralhada) e depois "quebra" os
     limites dela com escala e deslocamento aleatórios,
     produzindo uma cobertura completa e ainda assim orgânica,
     como fotografias espalhadas à mão sobre uma mesa.
     ===================================================== */
  const GRID_ROWS_RANGE = [3, 5]; // varia a cada ciclo para nunca repetir o mesmo padrão
  const GRID_COLS_RANGE = [3, 5];

  // área segura vertical: sangra quase até as bordas, para cobertura total;
  // o menu e o rodapé ficam acima das fotos (z-index maior) e continuam legíveis
  const AREA_TOP = -4;     // %
  const AREA_BOTTOM = 100; // %
  const AREA_MARGIN_X = -3; // %

  let gridCells = [];

  /**
   * Constrói e embaralha as células da grade. A quantidade de linhas
   * e colunas varia levemente em cada ciclo, para que a composição
   * nunca pareça mecânica ou repetitiva entre uma volta e outra.
   */
  function buildOrganicGrid() {
    const rows = Math.floor(
      GRID_ROWS_RANGE[0] + Math.random() * (GRID_ROWS_RANGE[1] - GRID_ROWS_RANGE[0] + 1)
    );
    const cols = Math.floor(
      GRID_COLS_RANGE[0] + Math.random() * (GRID_COLS_RANGE[1] - GRID_COLS_RANGE[0] + 1)
    );

    const cellW = (100 - AREA_MARGIN_X * 2) / cols;
    const cellH = (AREA_BOTTOM - AREA_TOP) / rows;
    const cells = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        cells.push({
          x: AREA_MARGIN_X + col * cellW,
          y: AREA_TOP + row * cellH,
          w: cellW,
          h: cellH,
        });
      }
    }

    // embaralha (Fisher–Yates) para que a ordem de entrada
    // nunca corresponda à ordem espacial da grade
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    return cells;
  }

  /**
   * Calcula posição e tamanho de uma fotografia a partir da
   * célula que lhe foi atribuída, com folga generosa para que
   * ela "escape" da célula e se sobreponha às vizinhas, inclusive
   * sangrando levemente para fora da tela.
   */
  function randomPosition(cell) {
    const growW = 0.9 + Math.random() * 0.8; // 90%–170% da célula
    const growH = 0.9 + Math.random() * 0.8;

    const w = cell.w * growW;
    const h = cell.h * growH;

    const jitterX = (Math.random() - 0.5) * cell.w * 0.8;
    const jitterY = (Math.random() - 0.5) * cell.h * 0.8;

    let x = cell.x + (cell.w - w) / 2 + jitterX;
    let y = cell.y + (cell.h - h) / 2 + jitterY;

    // permite leve sangria fora da viewport, mantendo a maior parte visível
    x = Math.max(-w * 0.35, Math.min(100 - w * 0.65, x));
    y = Math.max(-h * 0.3, Math.min(100 - h * 0.7, y));

    return { x, y, w, h };
  }

  /** Retorna rotação aleatória entre -6° e +6°. */
  function randomRotation() {
    return (Math.random() * ROTATION_RANGE * 2) - ROTATION_RANGE;
  }

  /** Retorna escala aleatória entre 95% e 105%. */
  function randomScale() {
    return SCALE_MIN + Math.random() * (SCALE_MAX - SCALE_MIN);
  }

  /* =====================================================
     CRIAÇÃO DE ELEMENTOS
     ===================================================== */

  /**
   * Cria o elemento DOM de uma fotografia (ainda invisível),
   * já posicionado com suas variações aleatórias.
   */
  function createImage(index, isPrimary = false, cell = null) {
    let position;

    if (isPrimary) {
      const w = 40, h = 46;
      position = { x: 50 - w / 2, y: 50 - h / 2, w, h };
    } else {
      position = randomPosition(cell);
    }

    const rotation = isPrimary ? 0 : randomRotation();
    const scale = isPrimary ? 1 : randomScale();

    const figure = document.createElement('figure');
    figure.className = 'photo';
    figure.style.left   = position.x + '%';
    figure.style.top    = position.y + '%';
    figure.style.width  = position.w + 'vw';
    figure.style.height = position.h + 'vh';
    figure.style.zIndex = String(2 + index);

    // guarda os valores-alvo para a animação de entrada
    figure.dataset.rotation = rotation.toFixed(2);
    figure.dataset.scale = scale.toFixed(3);

    const fileNumber = String(index + 1).padStart(2, '0');
    const fileName = `image${fileNumber}.jpg`;

    const img = document.createElement('img');
    img.alt = `Fotografia ${fileNumber} da composição editorial`;
    img.loading = index < 2 ? 'eager' : 'lazy';
    img.decoding = 'async';

    // fallback visual enquanto as imagens reais não são fornecidas
    img.addEventListener('error', () => {
      const placeholder = document.createElement('div');
      placeholder.className = 'photo__placeholder';
      placeholder.textContent = fileNumber;
      img.replaceWith(placeholder);
    }, { once: true });

    img.src = IMAGE_BASE_PATH + fileName;
    figure.appendChild(img);

    return figure;
  }

  /* =====================================================
     ANIMAÇÕES
     ===================================================== */

  /** Anima a entrada de uma fotografia: fade + scale + translateY. */
  function animateIn(figure) {
    const rotation = figure.dataset.rotation;
    const scale = figure.dataset.scale;

    // força o estado inicial antes de aplicar a transição
    requestAnimationFrame(() => {
      figure.style.transform =
        `translate3d(0, 0, 0) scale(${scale}) rotate(${rotation}deg)`;
      figure.classList.add('is-visible');
    });
  }

  /** Anima a saída de uma fotografia: fade + leve escala para baixo. */
  function animateOut(figure) {
    figure.classList.remove('is-visible');
    figure.style.transform = 'translate3d(0, 14px, 0) scale(0.92) rotate(0deg)';
  }

  /* =====================================================
     CARREGAMENTO DA GALERIA
     ===================================================== */

  /**
   * Monta a composição: mostra a imagem principal imediatamente,
   * depois revela as demais fotografias em intervalos de ~2s.
   */
  function loadImages() {
    canvas.innerHTML = '';
    photoElements = [];
    gridCells = buildOrganicGrid();

    // imagem principal — aparece primeiro, sempre centralizada
    const primary = createImage(0, true);
    canvas.appendChild(primary);
    photoElements.push(primary);
    animateIn(primary);

    if (prefersReducedMotion) {
      // movimento reduzido: mostra tudo de forma simples, sem escalonamento
      for (let i = 1; i < TOTAL_IMAGES; i++) {
        const cell = gridCells[(i - 1) % gridCells.length];
        const figure = createImage(i, false, cell);
        canvas.appendChild(figure);
        photoElements.push(figure);
        figure.classList.add('is-visible');
        figure.style.transform = 'none';
      }
      return;
    }

    let index = 1;
    cycleTimer = setInterval(() => {
      if (index >= TOTAL_IMAGES) {
        clearInterval(cycleTimer);
        scheduleReverse();
        return;
      }
      const cell = gridCells[(index - 1) % gridCells.length];
      const figure = createImage(index, false, cell);
      canvas.appendChild(figure);
      photoElements.push(figure);
      animateIn(figure);
      index += 1;
    }, STAGGER_MS);
  }

  /* =====================================================
     LOOP CONTÍNUO
     ===================================================== */

  /** Aguarda a composição completa e então inicia a animação inversa. */
  function scheduleReverse() {
    cycleTimer = setTimeout(loopGallery, HOLD_MS);
  }

  /**
   * Remove as fotografias uma a uma, na ordem inversa da entrada,
   * até restar apenas a imagem principal.
   */
  function loopGallery() {
    // ordem inversa, excluindo a imagem principal (índice 0)
    const removable = photoElements.slice(1).reverse();
    let step = 0;

    cycleTimer = setInterval(() => {
      if (step >= removable.length) {
        clearInterval(cycleTimer);
        restartLoop();
        return;
      }
      const figure = removable[step];
      animateOut(figure);
      // remove do DOM após a transição terminar
      setTimeout(() => figure.remove(), 1200);
      step += 1;
    }, EXIT_STAGGER_MS);
  }

  /** Reinicia o ciclo completo, mantendo o loop infinito. */
  function restartLoop() {
    photoElements = photoElements.slice(0, 1); // mantém a imagem principal
    setTimeout(loadImages, 400);
  }

  /* =====================================================
     PARALLAX (mouse e acelerômetro)
     ===================================================== */

  function initParallax() {
    if (prefersReducedMotion) return;

    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;
    let ticking = false;

    function applyTransform() {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      canvas.style.transform =
        `translate3d(${currentX}px, ${currentY}px, 0)`;

      if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
        requestAnimationFrame(applyTransform);
      } else {
        ticking = false;
      }
    }

    function requestTick() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(applyTransform);
      }
    }

    // desktop: movimento do mouse
    window.addEventListener('mousemove', (event) => {
      const { innerWidth, innerHeight } = window;
      const relX = (event.clientX / innerWidth) - 0.5;
      const relY = (event.clientY / innerHeight) - 0.5;
      targetX = relX * innerWidth * PARALLAX_STRENGTH;
      targetY = relY * innerHeight * PARALLAX_STRENGTH;
      requestTick();
    });

    // tablets: acelerômetro, quando disponível
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (event) => {
        if (event.gamma === null || event.beta === null) return;
        const relX = Math.max(-1, Math.min(1, event.gamma / 30));
        const relY = Math.max(-1, Math.min(1, (event.beta - 45) / 30));
        targetX = relX * window.innerWidth * PARALLAX_STRENGTH;
        targetY = relY * window.innerHeight * PARALLAX_STRENGTH;
        requestTick();
      });
    }
  }

  /* =====================================================
     NAVEGAÇÃO (fade suave, preparado para futuras páginas)
     ===================================================== */

  function initMenu() {
    const stage = document.getElementById('stage');
    document.querySelectorAll('.site-menu__link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const target = link.dataset.target;
        stage.classList.add('is-transitioning');
        setTimeout(() => {
          stage.classList.remove('is-transitioning');
          // aqui entraria a navegação real para /target quando as páginas existirem
          console.info(`Navegação preparada para: ${target}`);
        }, 500);
      });
    });
  }

  /* =====================================================
     INICIALIZAÇÃO
     ===================================================== */

  function init() {
    initMenu();
    initParallax();
    loadImages();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
