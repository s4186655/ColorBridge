// semanticMapper.js  (HARDCODE PIPELINE — no AI involved)
//
// Fixed, per-section color -> symbol rules, written by hand instead of being
// decided by Gemini at runtime. Each table below corresponds to one part of
// the demo page:
//
//   DOM_SYMBOL_MAP        Part B (quiz correctness) + Part C (status badges)
//   SVG_RISK_SYMBOL_MAP    Part F (risk gauge)
//   ARROW_DIRECTION_MAP    Part A (candlestick chart)
//   PHOTO_SYMBOL_MAP       Part D (team photo) + Part E (recolored chart)
//
// The AI-pipeline equivalent of this file is semanticMapperAI.js (unchanged) —
// there, meaning is inferred per-page by Gemini instead of being fixed here.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.semanticMapper = (function () {
  // Only green and red are ever transformed, anywhere in this pipeline. Any
  // other color (yellow, orange, blue, ...) is intentionally left OUT of
  // every table below, so it is never looked up and never gets an overlay —
  // it stays exactly as the page rendered it.

  // Part B / Part C: green -> correct/completed, red -> incorrect/failed.
  const DOM_SYMBOL_MAP = {
    green: { symbol: '✓', label: 'correct / completed' }, // ✓
    red: { symbol: '✕', label: 'incorrect / failed' } // ✕
  };

  // Part F: green -> low risk (shield), red -> high risk (skull).
  const SVG_RISK_SYMBOL_MAP = {
    green: { symbol: '\u{1F6E1}', label: 'low risk' }, // 🛡️
    red: { symbol: '\u{1F480}', label: 'high risk' } // 💀
  };

  // Part A: green candle -> up arrow, red candle -> down arrow.
  const ARROW_DIRECTION_MAP = {
    green: 'up',
    red: 'down'
  };

  // Part D / Part E: green -> checkmark(s), red -> X mark(s). The actual
  // repeat COUNT (1-3) comes from colorDetector.getDepthTier() at the call
  // site (imageProcessor.js), not from this table.
  const PHOTO_SYMBOL_MAP = {
    green: { symbol: '✓', label: 'positive marker' }, // ✓
    red: { symbol: '✕', label: 'negative marker' } // ✕
  };

  return { DOM_SYMBOL_MAP, SVG_RISK_SYMBOL_MAP, ARROW_DIRECTION_MAP, PHOTO_SYMBOL_MAP };
})();
