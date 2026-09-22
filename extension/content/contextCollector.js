// contextCollector.js  (LOCAL VLM PIPELINE)
//
// Gathers the words around the selected graphic. This is the half of the
// system that makes "green means increase HERE, but correct THERE" possible —
// without it the model can only guess from the picture, which is exactly the
// guessing this project exists to avoid.
//
// What gets collected is deliberately small and local. We are not sending the
// page: we send the heading above the chart, its caption, its legend, its alt
// text and a bounded slice of the text immediately around it.
//
// Per-field caps live in backend/promptBuilder.js, which also truncates the
// MIDDLE of long runs rather than the end, because legends tend to sit at the
// start or the finish of a block of text.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.contextCollector = (function () {
  const HEADING_TAGS = /^H[1-6]$/;
  const LEGEND_HINT = /legend|key|caption|axis|series|label/i;

  function textOf(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Closest heading above the element: check previous siblings at each level
  // on the way up, which is how headings actually relate to content in HTML.
  function nearestHeading(el) {
    let node = el;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth++) {
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (HEADING_TAGS.test(sibling.tagName)) return textOf(sibling);
        const nested = sibling.querySelector && sibling.querySelector('h1,h2,h3,h4,h5,h6');
        if (nested) return textOf(nested);
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }
    const first = document.querySelector('h1');
    return first ? textOf(first) : '';
  }

  function accessibleLabel(el) {
    const direct = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'));
    if (direct) return direct.trim();
    const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledBy) {
      return labelledBy.split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .filter(Boolean)
        .join(' ');
    }
    return '';
  }

  function captionFor(el) {
    const figure = el.closest && el.closest('figure');
    if (figure) {
      const cap = figure.querySelector('figcaption');
      if (cap) return textOf(cap);
    }
    const table = el.closest && el.closest('table');
    if (table) {
      const cap = table.querySelector('caption');
      if (cap) return textOf(cap);
    }
    return '';
  }

  // Chart libraries render legends in wildly different ways: a <ul> Chart.js
  // builds next to the canvas, a div with a "legend" class, <text> inside an
  // SVG, or — very commonly — a plain sentence in the paragraph just above the
  // figure ("Green bars are hours of low network load.").
  //
  // That last case is the important one and it is easy to miss: the sentence
  // is a SIBLING of the <figure>, not an ancestor of the chart, so walking up
  // the parent chain never sees it. This walks up a few levels and inspects
  // the preceding siblings at each one.
  function legendFor(el) {
    const parts = [];

    const container = el.parentElement;
    if (container) {
      for (const node of container.querySelectorAll('[class*="legend" i], [id*="legend" i], figcaption, caption, .chartjs-legend')) {
        if (node.contains(el)) continue;
        const text = textOf(node);
        if (text && text.length < 300) parts.push(text);
        if (parts.length >= 3) break;
      }
    }

    let node = el;
    for (let level = 0; level < 3 && node && node !== document.body; level++) {
      let sibling = node.previousElementSibling;
      for (let hop = 0; sibling && hop < 3; hop++) {
        if (/^H[1-6]$/.test(sibling.tagName)) break; // crossed into another section
        const text = textOf(sibling);
        const looksLikeLegend = LEGEND_HINT.test(sibling.className || '')
          || /\b(green|red|yellow|orange|blue)\b/i.test(text);
        if (text && text.length < 400 && looksLikeLegend) parts.push(text);
        sibling = sibling.previousElementSibling;
      }
      node = node.parentElement;
    }

    return Array.from(new Set(parts)).join(' | ');
  }

  // Text immediately around the graphic. Ancestors alone are not enough — a
  // <figure> usually contains only its own caption — so the siblings on either
  // side are folded in too.
  function nearbyText(el, minChars = 200, maxLevels = 4) {
    const seen = [];
    const push = (text) => {
      if (text && !seen.includes(text)) seen.push(text);
    };

    let node = el;
    for (let level = 0; level < maxLevels && node && node !== document.body; level++) {
      push(textOf(node.previousElementSibling));
      push(textOf(node));
      push(textOf(node.nextElementSibling));
      if (seen.join(' ').length >= minChars) break;
      node = node.parentElement;
    }

    // Longest first: the richest block is the most useful, and promptBuilder
    // caps the total anyway.
    return seen.sort((a, b) => b.length - a.length).join(' ');
  }

  // kind: 'canvas' | 'svg' | 'img' | 'dom'
  function collect(el, kind, colorsFound = []) {
    const context = {
      documentTitle: document.title || '',
      heading: nearestHeading(el),
      ariaLabel: accessibleLabel(el),
      caption: captionFor(el),
      legendText: legendFor(el),
      nearbyText: nearbyText(el),
      visualKind: kind,
      colorsFound
    };

    if (kind === 'img') {
      context.altText = el.getAttribute('alt') || '';
    }
    if (kind === 'svg') {
      context.svgText = window.AIColorA11y.svgProcessor.collectText(el);
    }
    if (kind === 'canvas') {
      // Chart libraries commonly mirror the chart as hidden text inside the
      // canvas element for screen readers — free, highly relevant context.
      const fallback = textOf(el);
      if (fallback) context.svgText = fallback;
    }
    if (kind === 'dom') {
      context.svgText = textOf(el).slice(0, 400);
    }

    return context;
  }

  return { collect, nearestHeading, legendFor, nearbyText, accessibleLabel, captionFor };
})();
