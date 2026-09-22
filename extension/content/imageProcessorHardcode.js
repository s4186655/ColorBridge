// imageProcessor.js  (HARDCODE PIPELINE — no AI involved)
//
// Handles raster <img> elements. Uses the same local pixel pipeline as the AI
// version (crop a full-tab screenshot down to the element, grid+BFS blob
// clustering) but resolves what to draw from a fixed rule keyed off the
// image's `id` instead of asking Gemini:
//
//   #financialChart  (Part A)  -> arrows, length scaled to each candle's own height
//   #teamPhoto       (Part D)  -> stacked check/X marks, count scaled to color darkness
//   #ambiguousChart  (Part E)  -> same rule as Part D (per spec: identical treatment)
//   anything else               -> left untouched (no rule defined for it)
//
// This file also computes each blob's *depth tier* (how dark vs. pale its
// average color is) via colorDetector.getDepthTier(), used for Part D/E's
// "darker shade = more symbols" rule.
//
// The AI-pipeline equivalent of this file is imageProcessorAI.js (unchanged) —
// there, the crop is sent to Gemini instead of being matched against a fixed id table.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.imageProcessor = (function () {
  const { classifyColor, getDepthTier } = window.AIColorA11y.colorDetector;

  // Which hardcoded rule applies to which demo image, by element id.
  const IMAGE_MODE_BY_ID = {
    financialChart: 'arrows',
    teamPhoto: 'depth-symbols',
    ambiguousChart: 'depth-symbols'
  };

  function findCandidates() {
    const imgs = document.querySelectorAll('img');
    const candidates = [];
    for (const img of imgs) {
      const mode = IMAGE_MODE_BY_ID[img.id];
      if (!mode) continue;
      const rect = img.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;
      candidates.push({ type: 'image', img, mode });
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
  // Each returned blob also carries its own average RGB + depth tier (1-3),
  // resampled precisely over its final bounding box.
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
      const box = {
        x: minCol * cellSize,
        y: minRow * cellSize,
        width: (maxCol - minCol + 1) * cellSize,
        height: (maxRow - minRow + 1) * cellSize
      };

      const sample = ctx.getImageData(box.x, box.y, Math.min(box.width, width - box.x), Math.min(box.height, height - box.y)).data;
      let sr = 0, sg = 0, sb = 0, sn = 0;
      for (let i = 0; i < sample.length; i += 4) {
        sr += sample[i]; sg += sample[i + 1]; sb += sample[i + 2]; sn++;
      }
      const avg = sn > 0 ? { r: sr / sn, g: sg / sn, b: sb / sn } : { r: 128, g: 128, b: 128 };

      blobs.push({
        color,
        box,
        cellCount: cells.length,
        depthTier: getDepthTier(avg.r, avg.g, avg.b),
        avgColor: avg // exact detected RGB, used to render an accurate swatch in the legend panel
      });
    }
    return blobs;
  }

  return { findCandidates, cropToElement, detectBlobs };
})();
