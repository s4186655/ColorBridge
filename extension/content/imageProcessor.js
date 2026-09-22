// imageProcessor.js  (LOCAL VLM PIPELINE)
//
// Pixel work: turn an <img> or <canvas> into a bitmap we can both send to the
// model and measure, then find where each colour actually sits inside it.
//
// Every function that produces a bitmap returns the same shape:
//
//   { canvas, ctx, scale }
//
// where `scale` converts bitmap pixels to CSS pixels, so a caller can always
// do  pageX = elementRect.left + box.x * scale  without caring which capture
// route was taken. That uniformity is deliberate: the three routes have three
// DIFFERENT and easy-to-confuse ratios —
//
//   <img> drawn at natural size : rect.width / naturalWidth
//   <canvas>                    : canvas.clientWidth / canvas.width   <-- NOT devicePixelRatio
//   screenshot crop             : 1 / devicePixelRatio
//
// Using devicePixelRatio for a canvas is the single most likely way to end up
// with overlays drifting off their bars, because a canvas has its own backing
// store whose size is unrelated to the display's pixel density.
//
// Other pipelines: imageProcessorHardcode.js, imageProcessorAI.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.imageProcessor = (function () {
  const { classifyColor } = window.AIColorA11y.colorDetector;

  const MAX_BLOBS = 60; // an overlay per bar is useful; 500 is noise

  function newCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
  }

  // Reading pixels back from a canvas that has cross-origin content drawn into
  // it throws SecurityError. Callers fall back to the screenshot route.
  function isReadable(ctx) {
    try {
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch (err) {
      return false;
    }
  }

  // <img> — draw at natural resolution, which is sharper than a screenshot and
  // free of anything overlapping the image on screen.
  function drawImageElement(img) {
    const rect = img.getBoundingClientRect();
    const naturalW = img.naturalWidth || rect.width;
    const naturalH = img.naturalHeight || rect.height;
    if (!naturalW || !naturalH) return null;

    const { canvas, ctx } = newCanvas(naturalW, naturalH);
    try {
      ctx.drawImage(img, 0, 0, naturalW, naturalH);
    } catch (err) {
      return null;
    }
    if (!isReadable(ctx)) return null;
    return { canvas, ctx, scale: rect.width / naturalW };
  }

  // <canvas> — copy its backing store. Nothing is re-rendered, so a chart
  // library's own output is captured exactly, without tooltips or a sticky
  // header sitting on top of it the way a screenshot would.
  function drawCanvasElement(sourceCanvas) {
    if (!sourceCanvas.width || !sourceCanvas.height) return null;
    const { canvas, ctx } = newCanvas(sourceCanvas.width, sourceCanvas.height);
    try {
      ctx.drawImage(sourceCanvas, 0, 0);
    } catch (err) {
      return null; // tainted by a cross-origin image drawn into it
    }
    if (!isReadable(ctx)) return null;

    const clientWidth = sourceCanvas.clientWidth || sourceCanvas.getBoundingClientRect().width;
    return { canvas, ctx, scale: clientWidth ? clientWidth / sourceCanvas.width : 1 };
  }

  // A WebGL canvas without preserveDrawingBuffer reads back as blank. Detect
  // that so the caller can fall back rather than analyse an empty rectangle.
  function looksBlank(ctx, width, height) {
    const step = Math.max(1, Math.floor(Math.min(width, height) / 12));
    let first = null;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
        if (a === 0) continue;
        const key = `${r},${g},${b}`;
        if (first === null) first = key;
        else if (key !== first) return false;
      }
    }
    return true;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load the captured image.'));
      image.src = src;
    });
  }

  // Screenshot route: crop a full-viewport capture down to one element.
  // Works for anything on screen, including canvases we can't read directly.
  async function cropFromScreenshot(screenshotDataUrl, rect) {
    const dpr = window.devicePixelRatio || 1;
    const image = await loadImage(screenshotDataUrl);
    const { canvas, ctx } = newCanvas(rect.width * dpr, rect.height * dpr);
    ctx.drawImage(
      image,
      Math.round(rect.left * dpr), Math.round(rect.top * dpr),
      canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    );
    return { canvas, ctx, scale: 1 / dpr };
  }

  // Grid + flood-fill: downsample the bitmap into cells, classify each cell's
  // average colour, then merge touching cells of the same colour into regions.
  // Good enough for the solid fills charts are made of, and much cheaper than
  // true per-pixel segmentation.
  function detectBlobs(ctx, width, height, cellSize = 8) {
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    const grid = new Array(cols * rows).fill(null);

    const full = ctx.getImageData(0, 0, width, height).data;
    const sampleCell = (col, row) => {
      const x0 = col * cellSize;
      const y0 = row * cellSize;
      const x1 = Math.min(x0 + cellSize, width);
      const y1 = Math.min(y0 + cellSize, height);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          r += full[i]; g += full[i + 1]; b += full[i + 2]; a += full[i + 3];
          n++;
        }
      }
      return n ? classifyColor(r / n, g / n, b / n, a / n) : null;
    };

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) grid[row * cols + col] = sampleCell(col, row);
    }

    const visited = new Array(grid.length).fill(false);
    const blobs = [];
    const totalCells = cols * rows;

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
        const neighbours = [
          row > 0 ? idx - cols : -1,
          row < rows - 1 ? idx + cols : -1,
          col > 0 ? idx - 1 : -1,
          col < cols - 1 ? idx + 1 : -1
        ];
        for (const n of neighbours) {
          if (n >= 0 && !visited[n] && grid[n] === color) {
            visited[n] = true;
            stack.push(n);
          }
        }
      }

      if (cells.length < 2) continue; // speckle
      if (cells.length > totalCells * 0.7) continue; // a coloured backdrop, not a datum

      let minCol = cols, maxCol = 0, minRow = rows, maxRow = 0;
      for (const idx of cells) {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
      }

      blobs.push({
        color,
        cellCount: cells.length,
        box: {
          x: minCol * cellSize,
          y: minRow * cellSize,
          width: (maxCol - minCol + 1) * cellSize,
          height: (maxRow - minRow + 1) * cellSize
        }
      });
    }

    // Biggest regions first, so if we have to cut the list we keep the ones
    // that actually represent data.
    blobs.sort((a, b) => b.cellCount - a.cellCount);
    return blobs.slice(0, MAX_BLOBS);
  }

  function toBase64(canvas) {
    return canvas.toDataURL('image/png').split(',')[1];
  }

  return {
    drawImageElement,
    drawCanvasElement,
    cropFromScreenshot,
    detectBlobs,
    looksBlank,
    isReadable,
    toBase64,
    loadImage
  };
})();
