// visualCapture.js  (LOCAL VLM PIPELINE)
//
// One entry point — captureVisual(el, kind) — that turns whatever the user
// clicked into the two things the rest of the pipeline needs:
//
//   imageBase64 : the picture the model looks at
//   regions     : where each colour actually is, in page coordinates
//
// The routes differ per kind, and each picks the most faithful source
// available, falling back to a tab screenshot when the page won't let us read
// pixels directly (cross-origin images taint a canvas).
//
// THE TRAP THIS FILE EXISTS TO AVOID: chrome.tabs.captureVisibleTab photographs
// the composited viewport. Anything this extension has drawn — a hover outline,
// symbols from a previous run — appears in that photograph and becomes part of
// the model's input. withUiHidden() takes everything down and waits for a real
// paint before the shutter, then puts it back.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.visualCapture = (function () {
  const { imageProcessor, svgProcessor, domColorScanner } = window.AIColorA11y;

  const OVERLAY_ATTR = 'data-ai-color-a11y';
  const UI_ATTR = 'data-ai-color-a11y-ui';

  // Two frames, because one only guarantees the style change was applied —
  // not that the compositor has drawn it.
  function waitForNextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function toPageRect(clientRect) {
    return {
      left: clientRect.left + window.scrollX,
      top: clientRect.top + window.scrollY,
      width: clientRect.width,
      height: clientRect.height
    };
  }

  function isFullyInViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  }

  // Chrome rate-limits captureVisibleTab to roughly two calls a second and
  // fails the extras, so keep a floor between shutters.
  let lastCaptureAt = 0;
  async function captureTab() {
    const MIN_GAP_MS = 600;
    const elapsed = Date.now() - lastCaptureAt;
    if (elapsed < MIN_GAP_MS) await new Promise((r) => setTimeout(r, MIN_GAP_MS - elapsed));
    lastCaptureAt = Date.now();

    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' });
    if (!response || !response.dataUrl) {
      throw new Error(response && response.error ? response.error : 'Could not capture the page.');
    }
    return response.dataUrl;
  }

  async function withUiHidden(fn) {
    const hidden = [];
    document.querySelectorAll(`[${OVERLAY_ATTR}], [${UI_ATTR}]`).forEach((el) => {
      if (el.tagName === 'STYLE') return;
      hidden.push([el, el.style.visibility]);
      el.style.visibility = 'hidden';
    });

    await waitForNextPaint();
    try {
      return await fn();
    } finally {
      hidden.forEach(([el, previous]) => { el.style.visibility = previous; });
    }
  }

  // Converts a blob box (bitmap pixels) into a page rectangle.
  function blobToPageRect(blob, elementClientRect, scale) {
    return {
      left: elementClientRect.left + window.scrollX + blob.box.x * scale,
      top: elementClientRect.top + window.scrollY + blob.box.y * scale,
      width: blob.box.width * scale,
      height: blob.box.height * scale
    };
  }

  async function screenshotBitmap(el) {
    if (!isFullyInViewport(el)) {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await waitForNextPaint();
    }
    const dataUrl = await withUiHidden(() => captureTab());
    return imageProcessor.cropFromScreenshot(dataUrl, el.getBoundingClientRect());
  }

  function regionsFromBitmap(bitmap, el) {
    const blobs = imageProcessor.detectBlobs(bitmap.ctx, bitmap.canvas.width, bitmap.canvas.height);
    const clientRect = el.getBoundingClientRect();
    return blobs.map((blob) => ({
      color: blob.color,
      pageRect: blobToPageRect(blob, clientRect, bitmap.scale),
      weight: blob.cellCount
    }));
  }

  function regionsFromElements(items) {
    return items.map((item) => ({
      color: item.color,
      pageRect: toPageRect(item.rect || item.el.getBoundingClientRect()),
      element: item.el || item.shape,
      weight: 1
    }));
  }

  async function captureVisual(el, kind) {
    const elementPageRect = toPageRect(el.getBoundingClientRect());

    // --- inline SVG: exact shape rectangles, no pixel guessing at all -------
    if (kind === 'svg') {
      const shapes = svgProcessor.collectShapes(el);
      let imageBase64;
      try {
        imageBase64 = (await svgProcessor.rasterize(el)).split(',')[1];
      } catch (err) {
        const bitmap = await screenshotBitmap(el);
        imageBase64 = imageProcessor.toBase64(bitmap.canvas);
      }
      return { imageBase64, regions: regionsFromElements(shapes), elementPageRect };
    }

    // --- DOM cluster: exact element rectangles ------------------------------
    if (kind === 'dom') {
      const items = domColorScanner.scanWithin(el);
      const bitmap = await screenshotBitmap(el); // the model should see the layout
      return {
        imageBase64: imageProcessor.toBase64(bitmap.canvas),
        regions: regionsFromElements(items),
        elementPageRect
      };
    }

    // --- canvas: read the backing store if we're allowed to -----------------
    if (kind === 'canvas') {
      let bitmap = imageProcessor.drawCanvasElement(el);
      if (bitmap && imageProcessor.looksBlank(bitmap.ctx, bitmap.canvas.width, bitmap.canvas.height)) {
        bitmap = null; // WebGL without preserveDrawingBuffer reads back empty
      }
      if (!bitmap) bitmap = await screenshotBitmap(el);
      return {
        imageBase64: imageProcessor.toBase64(bitmap.canvas),
        regions: regionsFromBitmap(bitmap, el),
        elementPageRect
      };
    }

    // --- raster <img> -------------------------------------------------------
    let bitmap = imageProcessor.drawImageElement(el);
    if (!bitmap) bitmap = await screenshotBitmap(el); // cross-origin image
    return {
      imageBase64: imageProcessor.toBase64(bitmap.canvas),
      regions: regionsFromBitmap(bitmap, el),
      elementPageRect
    };
  }

  return { captureVisual, withUiHidden, waitForNextPaint, toPageRect, isFullyInViewport, captureTab };
})();
