// domColorScanner.js  (HARDCODE PIPELINE — no AI involved)
//
// Finds plain HTML elements that use CSS color (text or background) to encode
// information — Part B's correct/incorrect quiz answers and Part C's status
// badges. Detection heuristics (leaf-ish elements, grouping under a shared
// container so a single stray colored link doesn't trigger anything) are the
// same as the AI pipeline; the only difference is what happens once a colored
// element is found: instead of sending it to Gemini, we look it up directly
// in semanticMapper.DOM_SYMBOL_MAP and are done.
//
// The AI-pipeline equivalent of this file is domColorScannerAI.js (unchanged).

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.domColorScanner = (function () {
  const { classifyColor, parseCssColor } = window.AIColorA11y.colorDetector;
  const { DOM_SYMBOL_MAP } = window.AIColorA11y.semanticMapper;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'CANVAS', 'IFRAME']);

  function isLeafish(el) {
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (el.children.length > 2) return false;
    const text = (el.textContent || '').trim();
    return text.length > 0 && text.length <= 60;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && parseFloat(style.opacity || '1') > 0.05;
  }

  function detectedColorOf(el) {
    const style = getComputedStyle(el);
    const fg = parseCssColor(style.color);
    const bg = parseCssColor(style.backgroundColor);
    const fgColor = fg ? classifyColor(fg.r, fg.g, fg.b, fg.a) : null;
    const bgColor = bg && bg.a > 40 ? classifyColor(bg.r, bg.g, bg.b, bg.a) : null;
    return bgColor || fgColor; // a colored background (badge/pill) wins over colored text
  }

  function groupKey(el) {
    let node = el;
    for (let i = 0; i < 4 && node.parentElement; i++) {
      node = node.parentElement;
      const tag = node.tagName;
      if (['TABLE', 'UL', 'OL', 'SECTION', 'ARTICLE'].includes(tag)) return node;
      const className = node.className && node.className.toString ? node.className.toString() : '';
      if (/card|panel|status|result|list|grid|row/i.test(className)) return node;
    }
    return el.parentElement || el;
  }

  // Returns a flat list of { el, color, symbol, label } for every colored
  // leaf element found in a "real" group (>=2 distinct colors, or 3+ items of
  // one color), skipping any color with no fixed mapping (e.g. blue links).
  function findCandidates() {
    const all = document.body.querySelectorAll('*');
    const colored = [];
    for (const el of all) {
      if (!isLeafish(el) || !isVisible(el)) continue;
      const color = detectedColorOf(el);
      if (color && DOM_SYMBOL_MAP[color]) colored.push({ el, color });
    }

    const groups = new Map();
    for (const item of colored) {
      const key = groupKey(item.el);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    const candidates = [];
    for (const items of groups.values()) {
      const distinctColors = new Set(items.map((i) => i.color));
      if (distinctColors.size < 2 && items.length < 3) continue;

      for (const item of items) {
        const mapping = DOM_SYMBOL_MAP[item.color];
        candidates.push({ el: item.el, color: item.color, symbol: mapping.symbol, label: mapping.label });
      }
    }
    return candidates;
  }

  return { findCandidates };
})();
