// domColorScanner.js
//
// Purpose: finds plain HTML elements that use CSS color (text color or
// background color) to encode information — e.g. a "Completed" badge with a
// green background, or a price change rendered in red text. This is NOT an
// image or SVG; it's the most common real-world case (status labels,
// correctness indicators, colored table cells) and needs no screenshot at all.
//
// Detection strategy:
//   1. Find small "leaf-ish" elements (short text, few children) whose
//      computed text/background color classifies to a named color bucket.
//   2. Group nearby colored elements under a shared container (table, list,
//      section, card) so they can be analyzed together as one "visual".
//   3. Only keep groups with at least two distinctly-colored items (or 3+
//      same-colored items), to avoid flagging a single random colored link.
//
// Used by: content.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.domColorScanner = (function () {
  const { classifyColor, parseCssColor } = window.AIColorA11y.colorDetector;

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
    // A colored background (badge/pill) is a stronger signal than colored text.
    return bgColor || fgColor;
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

  function nearestHeading(el) {
    let node = el;
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
    const all = document.body.querySelectorAll('*');
    const colored = [];
    for (const el of all) {
      if (!isLeafish(el) || !isVisible(el)) continue;
      const color = detectedColorOf(el);
      if (color) colored.push({ el, color });
    }

    const groups = new Map();
    for (const item of colored) {
      const key = groupKey(item.el);
      if (!groups.has(key)) groups.set(key, { container: key, items: [] });
      groups.get(key).items.push(item);
    }

    const candidates = [];
    for (const { container, items } of groups.values()) {
      const distinctColors = new Set(items.map((i) => i.color));
      if (distinctColors.size < 2 && items.length < 3) continue;

      candidates.push({
        type: 'dom',
        container,
        items,
        context: {
          heading: nearestHeading(container),
          nearbyText: container.textContent.trim().slice(0, 800),
          colorsFound: Array.from(distinctColors)
        }
      });
    }
    return candidates;
  }

  return { findCandidates };
})();
