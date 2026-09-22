// overlayManager.js
//
// Purpose: the ONLY part of the extension that touches the live page's visual
// output. It never deletes or rewrites existing page content — it only adds
// small, absolutely-positioned, non-interactive badge elements on top of it,
// and can remove every one of them again (used when the user turns the
// extension OFF, or before re-running analysis).
//
// Used by: content.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.overlayManager = (function () {
  const OVERLAY_CLASS = 'ai-color-a11y-overlay';
  let overlays = [];
  let styleInjected = false;

  function injectStyle() {
    if (styleInjected || document.getElementById('ai-color-a11y-style')) {
      styleInjected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = 'ai-color-a11y-style';
    style.textContent = `
      .${OVERLAY_CLASS} {
        position: absolute;
        pointer-events: none;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, "Segoe UI", Arial, sans-serif;
        font-weight: 700;
        color: #111111;
        background: rgba(255, 255, 255, 0.9);
        border: 1.5px solid #111111;
        border-radius: 4px;
        line-height: 1;
        box-sizing: border-box;
      }
    `;
    document.head.appendChild(style);
    styleInjected = true;
  }

  // rect: {left, top, width, height} in PAGE coordinates (i.e. already includes
  // scroll offset), as produced by content.js's toPageRect().
  function addOverlay(rect, symbol, label) {
    injectStyle();
    const el = document.createElement('div');
    el.className = OVERLAY_CLASS;
    el.textContent = symbol;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label || symbol);
    if (label) el.title = label;

    const size = Math.max(14, Math.min(28, Math.round(Math.min(rect.width, rect.height) || 18)));
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${Math.max(rect.width, size)}px`;
    el.style.height = `${Math.max(rect.height, size)}px`;
    el.style.fontSize = `${size * 0.8}px`;

    document.body.appendChild(el);
    overlays.push(el);
    return el;
  }

  function clearAll() {
    overlays.forEach((el) => el.remove());
    overlays = [];
  }

  function count() {
    return overlays.length;
  }

  return { addOverlay, clearAll, count };
})();
