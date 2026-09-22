// colorDetector.js  (LOCAL VLM PIPELINE)
//
// Pure colour maths. Classifies an RGB(A) value into one of five named buckets
// using HSV, which tolerates anti-aliasing, gradients and JPEG artefacts far
// better than comparing RGB values directly.
//
// This file knows nothing about meaning. It answers "what colour is this,
// roughly?" so the rest of the pipeline can answer "and where is it?" — the
// question of what the colour MEANS belongs to the VLM alone.
//
// The five buckets are deliberately the same five listed in the model's JSON
// schema (backend/analysisSchema.js). A mapping for any colour this file
// cannot recognise would be unusable, because nothing on the page could be
// matched to it.
//
// Other pipelines: colorDetectorHardcode.js, colorDetectorAI.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.colorDetector = (function () {
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  // Returns 'red' | 'green' | 'yellow' | 'orange' | 'blue' | null.
  // null means "not a meaningfully saturated colour" — greys, near-black,
  // near-white and near-transparent pixels, which callers should ignore.
  function classifyColor(r, g, b, a) {
    if (a !== undefined && a < 40) return null;
    const { h, s, v } = rgbToHsv(r, g, b);
    if (s < 0.18 || v < 0.15) return null;
    if (v > 0.98 && s < 0.25) return null;

    if (h >= 345 || h < 12) return 'red';
    if (h >= 12 && h < 45) return 'orange';
    if (h >= 45 && h < 70) return 'yellow';
    if (h >= 70 && h < 170) return 'green';
    if (h >= 190 && h < 260) return 'blue';
    return null;
  }

  // Parses "rgb(r,g,b)" / "rgba(r,g,b,a)" as returned by getComputedStyle.
  function parseCssColor(cssColor) {
    if (!cssColor) return null;
    const m = cssColor.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
    const [r, g, b, a = 1] = parts;
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a: a * 255 };
  }

  // Resolves any CSS colour notation ("red", "#2ecc71", "hsl(...)") to RGB by
  // letting the browser's own parser do it.
  function resolveCssColor(value) {
    if (!value || value === 'none' || value === 'transparent') return null;
    const probe = document.createElement('span');
    probe.style.color = value;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return parseCssColor(computed);
  }

  return { rgbToHsv, classifyColor, parseCssColor, resolveCssColor };
})();
