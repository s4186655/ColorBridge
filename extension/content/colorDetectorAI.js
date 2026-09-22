// colorDetector.js
//
// Purpose: pure color-space math. Given RGB(A) values (from getComputedStyle or
// pixel data), classify them into one of a small set of named color buckets
// ("red", "green", "yellow", "orange", "blue") using HSV, which is much more
// robust to anti-aliasing, shade variation, and compression artifacts than
// comparing exact RGB values.
//
// This file has NO knowledge of what colors "mean" — that is decided by Gemini
// (see semanticMapper.js for local fallback symbols, and the backend for the
// actual AI call). This file only answers "what color is this, roughly?".
//
// Used by: domColorScanner.js, svgProcessor.js, imageProcessor.js.

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
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
  }

  // Returns 'red' | 'green' | 'yellow' | 'orange' | 'blue' | null.
  // null means "not a meaningfully-saturated color" (grayscale, near-black,
  // near-white, or near-transparent) and should be ignored by callers.
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

  // Parses "rgb(r,g,b)" / "rgba(r,g,b,a)" strings, as returned by getComputedStyle.
  function parseCssColor(cssColor) {
    if (!cssColor) return null;
    const m = cssColor.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
    const [r, g, b, a = 1] = parts;
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a: a * 255 };
  }

  function colorDistance(c1, c2) {
    return Math.sqrt(
      Math.pow(c1.r - c2.r, 2) + Math.pow(c1.g - c2.g, 2) + Math.pow(c1.b - c2.b, 2)
    );
  }

  return { rgbToHsv, classifyColor, parseCssColor, colorDistance };
})();
