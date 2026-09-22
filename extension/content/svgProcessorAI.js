// svgProcessor.js
//
// Purpose: handles inline <svg> elements (common for charting libraries).
// Per the product spec, SVG is inspected directly via the DOM (fill/stroke on
// rect/circle/path/etc.) instead of being rasterized into an image — this is
// more precise and lets us position overlays exactly on each shape.
//
// We only need the *colors present* plus nearby text context (heading, title,
// aria-label, surrounding text) — Gemini reasons about meaning from that text,
// the same way a sighted user would read a chart's legend.
//
// Used by: content.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.svgProcessor = (function () {
  const { classifyColor, parseCssColor } = window.AIColorA11y.colorDetector;
  const SHAPE_TAGS = ['rect', 'circle', 'ellipse', 'path', 'polygon', 'line'];

  // Resolves a named/hex CSS color (e.g. "red", "#2ecc71") to RGB by letting
  // the browser's own CSS engine parse it via a throwaway element.
  function namedOrHexToRgb(value) {
    if (!value || value === 'none' || value === 'transparent') return null;
    const probe = document.createElement('span');
    probe.style.color = value;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return parseCssColor(computed);
  }

  function shapeColor(shape) {
    const style = getComputedStyle(shape);
    const fillAttr = shape.getAttribute('fill');
    const fill = style.fill && style.fill !== 'none' ? parseCssColor(style.fill) : namedOrHexToRgb(fillAttr);
    if (fill) {
      const c = classifyColor(fill.r, fill.g, fill.b, fill.a);
      if (c) return c;
    }
    const strokeAttr = shape.getAttribute('stroke');
    const stroke = style.stroke && style.stroke !== 'none' ? parseCssColor(style.stroke) : namedOrHexToRgb(strokeAttr);
    if (stroke) return classifyColor(stroke.r, stroke.g, stroke.b, stroke.a);
    return null;
  }

  function nearestHeadingFor(svg) {
    let node = svg;
    for (let i = 0; i < 6 && node; i++) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (/^H[1-4]$/.test(sibling.tagName)) return sibling.textContent.trim();
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }

  function findCandidates() {
    const svgs = document.querySelectorAll('svg');
    const candidates = [];
    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;

      const shapes = [];
      for (const tag of SHAPE_TAGS) {
        svg.querySelectorAll(tag).forEach((shape) => {
          const color = shapeColor(shape);
          if (color) shapes.push({ shape, color });
        });
      }
      const distinctColors = new Set(shapes.map((s) => s.color));
      if (distinctColors.size === 0) continue;

      const title = svg.querySelector('title, desc');
      candidates.push({
        type: 'svg',
        svg,
        shapes,
        context: {
          heading: nearestHeadingFor(svg),
          svgTitle: title ? title.textContent.trim() : '',
          ariaLabel: svg.getAttribute('aria-label') || '',
          nearbyText: (svg.parentElement ? svg.parentElement.textContent : '').trim().slice(0, 800),
          colorsFound: Array.from(distinctColors)
        }
      });
    }
    return candidates;
  }

  return { findCandidates };
})();
