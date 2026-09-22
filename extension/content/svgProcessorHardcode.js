// svgProcessor.js  (HARDCODE PIPELINE — no AI involved)
//
// Handles inline <svg> elements — Part F's risk gauge. Inspects fill/stroke
// directly via the DOM (no rasterization needed), then looks the detected
// color up directly in semanticMapper.SVG_RISK_SYMBOL_MAP: green -> shield,
// red -> skull. Any other color (the SVG_RISK_SYMBOL_MAP lookup returns
// nothing) is skipped entirely and left untouched.
//
// The AI-pipeline equivalent of this file is svgProcessorAI.js (unchanged) —
// there, Gemini decides the meaning/symbol from context instead of this fixed table.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.svgProcessor = (function () {
  const { classifyColor, parseCssColor } = window.AIColorA11y.colorDetector;
  const { SVG_RISK_SYMBOL_MAP } = window.AIColorA11y.semanticMapper;
  const SHAPE_TAGS = ['rect', 'circle', 'ellipse', 'path', 'polygon', 'line'];

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

  // Returns { shape, color, symbol, label } for every recognizably-colored
  // shape inside every <svg> on the page.
  function findCandidates() {
    const svgs = document.querySelectorAll('svg');
    const candidates = [];
    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;

      for (const tag of SHAPE_TAGS) {
        svg.querySelectorAll(tag).forEach((shape) => {
          const color = shapeColor(shape);
          const mapping = color ? SVG_RISK_SYMBOL_MAP[color] : null;
          if (mapping) {
            candidates.push({ shape, color, symbol: mapping.symbol, label: mapping.label });
          }
        });
      }
    }
    return candidates;
  }

  return { findCandidates };
})();
