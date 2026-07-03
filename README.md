# Studio ACAL — versão HTML + CSS puro

Esta é a versão estática do site, **sem nenhum JavaScript**: apenas HTML
semântico e uma única folha de estilos (`assets/css/style.css`). Não há
build, framework ou CMS — basta abrir os arquivos `.html` em um navegador ou
publicar a pasta em qualquer hospedagem estática.

## Como rodar

Não há instalação. Duas opções:

1. Abra `index.html` diretamente no navegador.
2. Ou sirva a pasta com qualquer servidor estático, por exemplo:
   ```bash
   npx serve .
   ```

## Estrutura

```
index.html              # Home — narrativa contínua
processo.html
studio.html
contato.html
404.html
sitemap.xml
robots.txt
projetos/
  casa-aroeira.html
  galeria-cumbuca.html
  estudio-taruma.html
  casa-ipe.html
assets/
  css/style.css          # toda a identidade visual e as animações
```

## O que muda em relação à versão com JavaScript

Como o site é só HTML + CSS, algumas interações que normalmente dependeriam
de JS foram recriadas com técnicas 100% CSS:

| Recurso | Como foi feito sem JS |
|---|---|
| Menu fullscreen | `checkbox` escondido + `<label>` (technique "checkbox hack"), com `:checked ~` controlando o `clip-path` do painel |
| Scroll suave | `html { scroll-behavior: smooth; }` |
| Revelações no scroll | `animation-timeline: view()` (scroll-driven animations nativas do CSS), com `@supports` para não quebrar em navegadores sem suporte — o conteúdo já nasce visível e a animação é só um reforço |
| Loader / logotipo se desenhando | `@keyframes` com `stroke-dashoffset`, disparado automaticamente ao carregar a página (sem precisar de JS para iniciar) |
| Cursor "Explorar" | Como não é possível seguir a posição real do mouse sem JS, o efeito foi adaptado para um estado de `:hover` central sobre cada imagem (`.media-link`), com o mesmo selo "Explorar" |
| Hover discreto em links | Sublinhados e textos auxiliares revelados com `:hover`, no lugar do cursor customizado |

`prefers-reduced-motion` é respeitado em todas as animações.

## Conteúdo

Os textos (manifesto, conceito dos projetos, materiais, equipe) seguem
exatamente o conteúdo definido no briefing original. As fotografias são
texturas em gradiente (`.tone--a` a `.tone--f`, definidas em `style.css`) —
um placeholder neutro que evita depender de imagens externas. Para usar
fotografia real, troque qualquer `<div class="tone ...">` por uma tag
`<img>` com `loading="lazy"`, mantendo a mesma classe de `aspect-ratio`
(`ratio-16-9`, `ratio-4-5` etc.) no contêiner.

## SEO

Cada página tem `<title>` e `<meta description>` próprios, há
`sitemap.xml` e `robots.txt` na raiz, e a home inclui um bloco
`schema.org/ArchitectureFirm` em JSON-LD (sem necessidade de JS — é apenas
um `<script type="application/ld+json">` estático).

## Próximos passos sugeridos

- Substituir os placeholders de cor por fotografia real do portfólio.
- Caso decida reintroduzir JavaScript no futuro, os pontos mais beneficiados
  seriam: cursor customizado seguindo o mouse de verdade, smooth scroll mais
  refinado (Lenis) e transições entre páginas.
