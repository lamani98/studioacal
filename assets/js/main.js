(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------
     1) Revelação suave dos itens conforme o scroll
     ------------------------------------------------------------ */
  var revealEls = document.querySelectorAll('.reveal');

  if (revealEls.length) {
    if ('IntersectionObserver' in window && !prefersReducedMotion) {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
      );
      revealEls.forEach(function (el) { io.observe(el); });
    } else {
      // Sem suporte a IntersectionObserver ou com "reduzir movimento" ativo:
      // mostra tudo de imediato, sem animação.
      revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    }
  }

  /* ------------------------------------------------------------
     2) Loader — some assim que a página está pronta
     ------------------------------------------------------------ */
  var loader = document.querySelector('.loader');
  if (loader) {
    var hideLoader = function () {
      loader.classList.add('loader--done');
    };
    if (document.readyState === 'complete') {
      setTimeout(hideLoader, 700);
    } else {
      window.addEventListener('load', function () {
        setTimeout(hideLoader, 700);
      });
    }
    // Rede de segurança: nunca deixa o loader preso na tela.
    setTimeout(hideLoader, 2500);
  }

  /* ------------------------------------------------------------
     3) Cursor customizado — imagem que segue o mouse e troca ao clicar
        Só em dispositivos com mouse de verdade (pointer: fine).
     ------------------------------------------------------------ */
//   var supportsFinePointer = window.matchMedia('(pointer: fine)').matches;

//   if (supportsFinePointer && !prefersReducedMotion) {
//     document.documentElement.classList.add('has-custom-cursor');

//     var cursor = document.createElement('div');
//     cursor.className = 'custom-cursor custom-cursor--hidden';
//     cursor.setAttribute('aria-hidden', 'true');

//     var cursorImg = document.createElement('img');
//     cursorImg.src = 'assets/img/cursor2.png';
//     cursorImg.alt = '';
//     cursor.appendChild(cursorImg);
//     document.body.appendChild(cursor);

//     var mouseX = window.innerWidth / 2;
//     var mouseY = window.innerHeight / 2;
//     var cursorX = mouseX;
//     var cursorY = mouseY;
//     var EASE = 0.2;

//     function renderCursor() {
//       cursorX += (mouseX - cursorX) * EASE;
//       cursorY += (mouseY - cursorY) * EASE;
//       cursor.style.transform = 'translate(' + cursorX + 'px, ' + cursorY + 'px) translate(-50%, -50%)';
//       requestAnimationFrame(renderCursor);
//     }
//     requestAnimationFrame(renderCursor);

//     window.addEventListener('mousemove', function (e) {
//       mouseX = e.clientX;
//       mouseY = e.clientY;
//       cursor.classList.remove('custom-cursor--hidden');
//     });

//     document.addEventListener('mouseleave', function () {
//       cursor.classList.add('custom-cursor--hidden');
//     });

//     window.addEventListener('mousedown', function () {
//       cursor.classList.add('custom-cursor--click');
//       cursorImg.src = 'assets/img/cursor2.png';
//     });

//     window.addEventListener('mouseup', function () {
//       cursor.classList.remove('custom-cursor--click');
//       cursorImg.src = 'assets/img/cursor2.png';
//     });

//     // Cresce um pouco sobre links, botões e imagens clicáveis.
//     var hoverSelector = 'a, button, label, .media-link';
//     document.addEventListener('mouseover', function (e) {
//       if (e.target.closest(hoverSelector)) {
//         cursor.classList.add('custom-cursor--hover');
//       }
//     });
//     document.addEventListener('mouseout', function (e) {
//       if (e.target.closest(hoverSelector)) {
//         cursor.classList.remove('custom-cursor--hover');
//       }
//     });
//   }
})();
