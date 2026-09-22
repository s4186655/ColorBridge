// imageProcessor.js
//
// Purpose: handles raster <img> elements (PNG/JPG charts, or SVGs rendered as
// an <img src="..."> so their internals aren't DOM-inspectable). Two jobs:
//
//   1. findCandidates() — locate <img> elements and decide, from surrounding
//      text/alt/heading, whether they look chart-like at all. Plain photos
//      (no chart keywords nearby) never even get sent to Gemini — this is the
//      first line of defense against false positives on ordinary photographs.
//
//   2. cropToElement()/detectBlobs() — given a full-page screenshot (captured
//      by the background service worker via chrome.tabs.captureVisibleTab,
//      which is NOT subject to canvas cross-origin tainting), crop it down to
//      one image element and find contiguous same-colored regions ("blobs")
//      using a simple grid + BFS merge. This is a lightweight stand-in for
//      full connected-component analysis — good enough for bars/candles/
//      badges, which are contiguous rectangular regions of solid color.
//
// Local pixel analysis only ever answers "WHERE is this color" — Gemini
// (called from content.js) answers "WHAT does this color mean".
//
// Used by: content.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.imageProcessor = (function () {
  const { classifyColor } = window.AIColorA11y.colorDetector;

  const CHART_KEYWORDS = /(chart|graph|candle|stock|price|plot|diagram|trend|risk|status|correct|legend|dashboard|data)/i;

  function nearestHeadingFor(img) {
    let node = img;
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

  function looksChartLike(img, heading, nearbyText) {
    const haystack = `${img.alt || ''} ${img.getAttribute('src') || ''} ${heading} ${nearbyText}`;
    return CHART_KEYWORDS.test(haystack);
  }

  function findCandidates() {
    const imgs = document.querySelectorAll('img');
    const candidates = [];
    for (const img of imgs) {
      const rect = img.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) continue;

      const heading = nearestHeadingFor(img);
      const nearbyText = (img.parentElement ? img.parentElement.textContent : '').trim().slice(0, 800);
      const figure = img.closest('figure');
      const figcaption = figure ? figure.querySelector('figcaption') : null;

      candidates.push({
        type: 'image',
        img,
        chartLike: looksChartLike(img, heading, nearbyText),
        context: {
          heading,
          altText: img.alt || '',
          caption: figcaption ? figcaption.textContent.trim() : '',
          nearbyText
        }
      });
    }
    return candidates;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  // Crops a full-page screenshot dataURL down to one element's viewport rect.
  async function cropToElement(fullScreenshotDataUrl, el) {
    const rect = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const image = await loadImage(fullScreenshotDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      image,
      Math.round(rect.left * dpr),
      Math.round(rect.top * dpr),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return { canvas, ctx, rect };
  }

  // Grid-based blob detection: downsample into cells, classify each cell's
  // average color, then BFS-merge adjacent same-colored cells into blobs.
  function detectBlobs(ctx, width, height, cellSize = 8) {
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    const grid = new Array(cols * rows).fill(null);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * cellSize;
        const y = row * cellSize;
        const w = Math.min(cellSize, width - x);
        const h = Math.min(cellSize, height - y);
        if (w <= 0 || h <= 0) continue;
        const data = ctx.getImageData(x, y, w, h).data;
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
          n++;
        }
        if (n === 0) continue;
        grid[row * cols + col] = classifyColor(r / n, g / n, b / n, a / n);
      }
    }

    const visited = new Array(grid.length).fill(false);
    const blobs = [];
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i] || visited[i]) continue;
      const color = grid[i];
      const stack = [i];
      visited[i] = true;
      const cells = [];
      while (stack.length) {
        const idx = stack.pop();
        cells.push(idx);
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const neighbors = [
          row > 0 ? idx - cols : -1,
          row < rows - 1 ? idx + cols : -1,
          col > 0 ? idx - 1 : -1,
          col < cols - 1 ? idx + 1 : -1
        ];
        for (const n of neighbors) {
          if (n >= 0 && !visited[n] && grid[n] === color) {
            visited[n] = true;
            stack.push(n);
          }
        }
      }
      if (cells.length < 2) continue;

      let minCol = cols, maxCol = 0, minRow = rows, maxRow = 0;
      for (const idx of cells) {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
      }
      blobs.push({
        color,
        box: {
          x: minCol * cellSize,
          y: minRow * cellSize,
          width: (maxCol - minCol + 1) * cellSize,
          height: (maxRow - minRow + 1) * cellSize
        },
        cellCount: cells.length
      });
    }
    return blobs;
  }

  return { findCandidates, cropToElement, detectBlobs };
})();
