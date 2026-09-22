// domColorScanner.js  (LOCAL VLM PIPELINE)
//
// Finds plain HTML elements that carry colour through CSS rather than through
// an image: status pills, coloured table cells, red/green figures in a report.
//
// Unlike the earlier pipelines this one does NOT hunt across the whole page.
// The user has already pointed at the thing they care about, so the job here
// is narrower and more exact: given a container, list every coloured leaf
// inside it, with its precise rectangle.
//
// Exports the individual predicates as well, because selectionMode.js needs
// them to decide how far up the ancestor chain a click should travel.
//
// Other pipelines: domColorScannerHardcode.js, domColorScannerAI.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.domColorScanner = (function () {
  const { classifyColor, parseCssColor } = window.AIColorA11y.colorDetector;

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IMG', 'CANVAS', 'IFRAME', 'VIDEO']);

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
    return style.visibility !== 'hidden'
      && style.display !== 'none'
      && parseFloat(style.opacity || '1') > 0.05;
  }

  // A coloured background (a pill or a filled cell) is a stronger signal than
  // coloured text, so it wins when an element has both.
  function detectedColorOf(el) {
    const style = getComputedStyle(el);
    const fg = parseCssColor(style.color);
    const bg = parseCssColor(style.backgroundColor);
    const bgColor = bg && bg.a > 40 ? classifyColor(bg.r, bg.g, bg.b, bg.a) : null;
    const fgColor = fg ? classifyColor(fg.r, fg.g, fg.b, fg.a) : null;
    return bgColor || fgColor;
  }

  // Every coloured leaf inside `root`, in document order.
  // Returns [{ el, color, rect }].
  function scanWithin(root) {
    if (!root || !root.querySelectorAll) return [];
    const found = [];

    // The container itself can be the coloured thing (a single status pill).
    if (root.nodeType === 1 && isLeafish(root) && isVisible(root)) {
      const ownColor = detectedColorOf(root);
      if (ownColor) found.push({ el: root, color: ownColor, rect: root.getBoundingClientRect() });
    }

    for (const el of root.querySelectorAll('*')) {
      if (!isLeafish(el) || !isVisible(el)) continue;
      const color = detectedColorOf(el);
      if (color) found.push({ el, color, rect: el.getBoundingClientRect() });
    }
    return found;
  }

  // Cheap count used while walking up from a click. Stops early because
  // selectionMode only ever asks "are there at least 2 here?".
  function countColoredLeaves(root, stopAt = 2) {
    if (!root || !root.querySelectorAll) return 0;
    let n = 0;
    for (const el of root.querySelectorAll('*')) {
      if (!isLeafish(el) || !isVisible(el)) continue;
      if (detectedColorOf(el)) {
        n++;
        if (n >= stopAt) return n;
      }
    }
    return n;
  }

  function distinctColors(items) {
    return Array.from(new Set(items.map((i) => i.color)));
  }

  return { scanWithin, countColoredLeaves, distinctColors, isLeafish, isVisible, detectedColorOf };
})();
