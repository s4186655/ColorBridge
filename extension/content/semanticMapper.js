// semanticMapper.js  (LOCAL VLM PIPELINE)
//
// Turns a meaning the VLM inferred into a glyph to draw.
//
// There is NO colour -> meaning table in this file, and there must never be
// one: that mapping is exactly what the VLM decides per page. What lives here
// is the last step, meaning -> symbol, plus one accessibility guarantee the
// model cannot be trusted to make.
//
// That guarantee: the symbol must not itself depend on colour. During testing
// the model twice proposed a red circle and a green circle as its "symbols",
// which would be useless for the person this extension exists for. Any such
// glyph is rejected here and replaced with a shape-based one.
//
// Other pipelines: semanticMapperHardcode.js, semanticMapperAI.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.semanticMapper = (function () {
  // Glyphs that carry their meaning through COLOUR rather than shape.
  // Coloured circles/squares/hearts, plus the traffic light.
  const COLOR_DEPENDENT_SYMBOL = /[\u{1F534}-\u{1F53D}\u{1F7E0}-\u{1F7EB}\u{1F49A}-\u{1F49C}\u{2B1B}\u{2B1C}\u{26AA}\u{26AB}\u{1F6A6}\u{1F535}]/u;

  // Fallback only — used when the model's own symbol is missing or unusable.
  // Ordered: the first keyword that matches wins.
  const MEANING_SYMBOLS = [
    { keywords: ['increase', 'rise', 'rising', 'up', 'gain', 'growth', 'higher', 'bullish', 'profit'], symbol: '↑' },
    { keywords: ['decrease', 'fall', 'falling', 'down', 'loss', 'decline', 'lower', 'bearish', 'drop'], symbol: '↓' },
    { keywords: ['correct', 'success', 'pass', 'complete', 'done', 'approved', 'valid', 'available', 'online', 'active', 'yes'], symbol: '✓' },
    { keywords: ['incorrect', 'fail', 'error', 'rejected', 'invalid', 'unavailable', 'offline', 'blocked', 'no'], symbol: '✕' },
    { keywords: ['warning', 'caution', 'alert', 'risk', 'moderate', 'medium', 'partial', 'degraded'], symbol: '⚠' },
    { keywords: ['pending', 'waiting', 'progress', 'processing', 'queued', 'scheduled'], symbol: '⏳' },
    { keywords: ['high', 'maximum', 'peak', 'heavy', 'busy', 'severe'], symbol: '▲' },
    { keywords: ['low', 'minimum', 'light', 'quiet', 'minor'], symbol: '▼' },
    { keywords: ['stable', 'unchanged', 'flat', 'neutral', 'same'], symbol: '↔' }
  ];

  const GENERIC_MARKERS = ['●', '■', '▲', '♦', '★', '✦'];

  function isUsableSymbol(symbol) {
    if (typeof symbol !== 'string') return false;
    const s = symbol.trim();
    if (s.length === 0) return false;
    if (Array.from(s).length > 2) return false; // a word, not a glyph
    // Reject short abbreviations like "UP" or "OK": they read as text, not as
    // a mark, and won't line up inside a small badge. A single letter or digit
    // is fine ("A", "1"), and so is anything containing a real symbol.
    if (/^[a-z0-9]{2,}$/i.test(s)) return false;
    if (COLOR_DEPENDENT_SYMBOL.test(s)) return false; // useless without colour vision
    return true;
  }

  function fallbackFor(meaning) {
    const lower = String(meaning || '').toLowerCase();
    for (const entry of MEANING_SYMBOLS) {
      if (entry.keywords.some((k) => lower.includes(k))) return entry.symbol;
    }
    return null;
  }

  // Picks the glyph for one mapping.
  //   index — position of this mapping in the list, used only to keep distinct
  //           generic markers apart when nothing better can be derived, so two
  //           unnamed categories never render as the same shape.
  function getSymbol(meaning, modelSymbol, index = 0) {
    if (isUsableSymbol(modelSymbol)) return modelSymbol.trim();
    return fallbackFor(meaning) || GENERIC_MARKERS[index % GENERIC_MARKERS.length];
  }

  // Human-readable label for the overlay's aria-label / tooltip.
  function describe(mapping) {
    const meaning = String(mapping.meaning || '').trim();
    return meaning ? `${meaning} (shown as ${mapping.color} on this page)` : mapping.color;
  }

  return { getSymbol, describe, isUsableSymbol, MEANING_SYMBOLS };
})();
