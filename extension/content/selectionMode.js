// selectionMode.js  (LOCAL VLM PIPELINE)
//
// "Click the chart you want explained." Analysis is expensive locally (tens of
// seconds), so the user aims it instead of the extension guessing.
//
// Two things shape the implementation:
//
// 1. The popup CLOSES the moment the user clicks the page. So progress and
//    results have to be shown on the page itself. This module owns that
//    status pill as well as the hover outline.
//
// 2. All of our own UI lives in a CLOSED shadow root on a host tagged
//    data-ai-color-a11y-ui. That keeps the host page's CSS from reaching in,
//    keeps overlayManager.clearAll() (which sweeps data-ai-color-a11y) from
//    deleting it, and gives visualCapture.withUiHidden() one thing to hide
//    before it takes a screenshot.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.selectionMode = (function () {
  const { domColorScanner } = window.AIColorA11y;

  const UI_ATTR = 'data-ai-color-a11y-ui';
  const IDLE_TIMEOUT_MS = 45000;
  const MAX_ASCENT = 12;

  let host = null;
  let root = null;
  let outlineEl = null;
  let labelEl = null;
  let statusEl = null;
  let cursorStyle = null;

  let active = false;
  let onPick = null;
  let hovered = null;
  let rafPending = false;
  let idleTimer = null;

  // ---------------------------------------------------------------- UI ----

  function ensureUi() {
    if (host && document.documentElement.contains(host)) return;

    host = document.createElement('div');
    host.setAttribute(UI_ATTR, '1');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);

    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .outline {
          position: fixed; box-sizing: border-box; display: none;
          border: 2px dashed #0b57d0; border-radius: 4px;
          background: rgba(11, 87, 208, 0.08);
          pointer-events: none; transition: all 60ms linear;
        }
        .label {
          position: fixed; display: none;
          font: 600 11px/1.5 -apple-system, "Segoe UI", Arial, sans-serif;
          background: #0b57d0; color: #fff; padding: 2px 7px;
          border-radius: 3px; white-space: nowrap; pointer-events: none;
        }
        .status {
          position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
          display: none; align-items: center; gap: 9px; max-width: 78vw;
          font: 500 13px/1.45 -apple-system, "Segoe UI", Arial, sans-serif;
          background: #1b1b1b; color: #fff;
          padding: 10px 16px; border-radius: 999px;
          box-shadow: 0 4px 18px rgba(0,0,0,.3); pointer-events: none;
        }
        .status.error { background: #8c1d18; }
        .status.done  { background: #14622b; }
        .spinner {
          width: 13px; height: 13px; flex: none; border-radius: 50%;
          border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
          animation: spin .8s linear infinite; display: none;
        }
        .status.busy .spinner { display: block; }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
      <div class="outline"></div>
      <div class="label"></div>
      <div class="status"><span class="spinner"></span><span class="text"></span></div>
    `;
    outlineEl = root.querySelector('.outline');
    labelEl = root.querySelector('.label');
    statusEl = root.querySelector('.status');
  }

  function showStatus(text, tone = 'busy') {
    ensureUi();
    statusEl.className = `status ${tone}`;
    statusEl.querySelector('.text').textContent = text;
    statusEl.style.display = 'flex';
  }

  function hideStatus() {
    if (statusEl) statusEl.style.display = 'none';
  }

  function showOutline(el, kindLabel) {
    const r = el.getBoundingClientRect();
    outlineEl.style.display = 'block';
    outlineEl.style.left = `${r.left}px`;
    outlineEl.style.top = `${r.top}px`;
    outlineEl.style.width = `${r.width}px`;
    outlineEl.style.height = `${r.height}px`;

    labelEl.style.display = 'block';
    labelEl.textContent = kindLabel;
    // Sit above the box unless it's hard against the top of the viewport.
    labelEl.style.left = `${Math.max(4, r.left)}px`;
    labelEl.style.top = r.top > 22 ? `${r.top - 20}px` : `${r.bottom + 4}px`;
  }

  function hideOutline() {
    if (outlineEl) outlineEl.style.display = 'none';
    if (labelEl) labelEl.style.display = 'none';
    hovered = null;
  }

  // -------------------------------------------------- target resolution ----

  function outermostSvg(node) {
    let svg = node.tagName && node.tagName.toLowerCase() === 'svg' ? node : node.ownerSVGElement;
    while (svg && svg.parentNode && svg.parentNode.ownerSVGElement) svg = svg.parentNode.ownerSVGElement;
    return svg;
  }

  function bigEnough(el) {
    const r = el.getBoundingClientRect();
    return r.width >= 24 && r.height >= 24;
  }

  // Walks up from a coloured leaf until it reaches something that holds at
  // least two coloured things — a table, a row of pills, a legend block.
  function resolveCluster(startNode) {
    let node = startNode;

    // A cell belongs to its table; that's the unit a reader understands.
    if (node.closest) {
      const cell = node.closest('td, th');
      if (cell) {
        const table = cell.closest('table');
        if (table && domColorScanner.countColoredLeaves(table) >= 2) return table;
        const row = cell.closest('tr');
        if (row) return row;
      }
    }

    // Climb until we reach something that holds at least two coloured things
    // and is still smaller than most of the screen. Returning the FIRST such
    // ancestor is what keeps the selection tight — an earlier version also
    // bailed out when a box grew a lot between levels, but that fired before
    // the real group was ever reached (a coloured <span> would be returned
    // instead of the list it belongs to).
    const viewportArea = window.innerWidth * window.innerHeight;
    for (let i = 0; i < MAX_ASCENT && node && node !== document.body; i++) {
      const rect = node.getBoundingClientRect();
      if (rect.width * rect.height <= viewportArea * 0.6) {
        if (domColorScanner.countColoredLeaves(node) >= 2) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  // Which element did the user actually mean?
  // Returns { el, kind } or null.
  function resolveVisual(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    let node = path[0] || event.target;
    if (!node || node.nodeType !== 1) return null;
    if (host && (node === host || host.contains(node))) return null;

    const graphic = ascendForGraphic(node);
    if (graphic) return graphic;

    // A chart tooltip or an invisible hit-layer can sit over the chart and
    // swallow the click. Look at what is underneath the cursor instead.
    const style = getComputedStyle(node);
    if (style.position === 'absolute' || style.position === 'fixed') {
      const stack = document.elementsFromPoint(event.clientX, event.clientY) || [];
      for (const candidate of stack) {
        if (host && (candidate === host || host.contains(candidate))) continue;
        const found = ascendForGraphic(candidate);
        if (found) return found;
      }
    }

    const cluster = resolveCluster(node);
    return cluster ? { el: cluster, kind: 'dom' } : null;
  }

  function ascendForGraphic(startNode) {
    let node = startNode;
    for (let i = 0; i < MAX_ASCENT && node && node !== document.body; i++) {
      const tag = node.tagName && node.tagName.toUpperCase();

      if (tag === 'CANVAS' && bigEnough(node)) return { el: node, kind: 'canvas' };

      if (tag === 'SVG' || node.ownerSVGElement) {
        const svg = outermostSvg(node);
        if (svg && bigEnough(svg)) return { el: svg, kind: 'svg' };
      }

      if (tag === 'IMG' && bigEnough(node)) return { el: node, kind: 'img' };

      node = node.parentElement;
    }
    return null;
  }

  const KIND_LABELS = {
    canvas: 'Canvas chart',
    svg: 'Vector chart',
    img: 'Image',
    dom: 'Colour-coded section'
  };

  // ------------------------------------------------------------ events ----

  function onPointerMove(event) {
    if (!active || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!active) return;
      const found = resolveVisual(event);
      if (!found) { hideOutline(); return; }
      if (found.el === hovered) return;
      hovered = found.el;
      showOutline(found.el, KIND_LABELS[found.kind] || 'Visual');
    });
  }

  function swallow(event) {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }

  function onClick(event) {
    if (!active) return;
    swallow(event);

    const found = resolveVisual(event);
    if (!found) {
      showStatus('Nothing colour-coded there — try a chart, a table or a status label.', 'error');
      setTimeout(() => { if (active) showStatus('Click the chart you want explained.', ''); }, 2600);
      return;
    }

    const callback = onPick;
    exit({ keepStatus: true });
    if (callback) callback(found.el, found.kind);
  }

  function onKeyDown(event) {
    if (!active) return;
    if (event.key === 'Escape') {
      swallow(event);
      exit();
    }
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (active) exit(); }, IDLE_TIMEOUT_MS);
  }

  const CAPTURE = { capture: true, passive: false };
  const SWALLOWED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'dblclick'];

  function enter(pickHandler) {
    if (active) { exit(); return; }
    ensureUi();
    active = true;
    onPick = pickHandler;

    cursorStyle = document.createElement('style');
    cursorStyle.setAttribute(UI_ATTR, '1');
    cursorStyle.textContent = '*{cursor:crosshair !important;}';
    document.head.appendChild(cursorStyle);

    window.addEventListener('pointermove', onPointerMove, CAPTURE);
    window.addEventListener('click', onClick, CAPTURE);
    window.addEventListener('keydown', onKeyDown, CAPTURE);
    SWALLOWED.forEach((type) => window.addEventListener(type, swallow, CAPTURE));
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);

    showStatus('Click the chart you want explained.  (Esc to cancel)', '');
    resetIdleTimer();
  }

  function exit({ keepStatus = false } = {}) {
    if (!active) return;
    active = false;
    onPick = null;
    clearTimeout(idleTimer);

    window.removeEventListener('pointermove', onPointerMove, CAPTURE);
    window.removeEventListener('click', onClick, CAPTURE);
    window.removeEventListener('keydown', onKeyDown, CAPTURE);
    SWALLOWED.forEach((type) => window.removeEventListener(type, swallow, CAPTURE));
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibilityChange);

    if (cursorStyle) { cursorStyle.remove(); cursorStyle = null; }
    hideOutline();
    if (!keepStatus) hideStatus();
  }

  function onPageHide() { exit(); }
  function onVisibilityChange() { if (document.hidden) exit(); }

  function teardown() {
    exit();
    if (host) { host.remove(); host = null; root = null; }
  }

  return { enter, exit, teardown, showStatus, hideStatus, isActive: () => active, resolveVisual };
})();
