// semanticMapper.js
//
// Purpose: centralized lookup of "meaning" -> "non-color symbol". This is used
// ONLY as a fallback when Gemini's response doesn't include a usable symbol for
// a mapping it returned. Gemini's own symbol choice is always preferred, since
// it has full context about the specific visual — this table just guarantees
// we never render nothing.
//
// IMPORTANT: this file never decides what a color MEANS. It only decides how
// to draw a meaning once Gemini has already determined it from context.
//
// Used by: content.js (when applying mappings returned by the backend).

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.semanticMapper = (function () {
  const MEANING_SYMBOLS = [
    { keywords: ['increase', 'up', 'gain', 'rising', 'growth'], symbol: '↑' },
    { keywords: ['decrease', 'down', 'loss', 'falling', 'decline'], symbol: '↓' },
    { keywords: ['correct', 'success', 'pass', 'complete', 'completed', 'done', 'approved', 'valid'], symbol: '✓' },
    { keywords: ['incorrect', 'fail', 'failure', 'failed', 'error', 'rejected', 'invalid'], symbol: '✕' },
    { keywords: ['warning', 'caution', 'risk', 'moderate', 'medium'], symbol: '⚠' },
    { keywords: ['pending', 'waiting', 'progress', 'processing'], symbol: '⏳' },
    { keywords: ['high'], symbol: '▲' },
    { keywords: ['low'], symbol: '▼' }
  ];

  function isUsableSymbol(symbol) {
    return typeof symbol === 'string' && symbol.trim().length > 0 && symbol.trim().length <= 3;
  }

  // Chooses the best non-color symbol for a semantic meaning.
  function getSymbol(meaning, aiSymbol) {
    if (isUsableSymbol(aiSymbol)) return aiSymbol.trim();
    const lower = (meaning || '').toLowerCase();
    for (const entry of MEANING_SYMBOLS) {
      if (entry.keywords.some((k) => lower.includes(k))) return entry.symbol;
    }
    return '●'; // generic marker, last resort
  }

  return { getSymbol, MEANING_SYMBOLS };
})();
