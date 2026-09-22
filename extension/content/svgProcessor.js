// svgProcessor.js  (LOCAL VLM PIPELINE)
//
// Handles inline <svg> charts — what D3, ECharts, Highcharts and Recharts all
// produce. SVG is the best case for this extension: the shapes are real DOM
// nodes, so we can read each one's fill and its exact rectangle. No pixel
// guessing, and overlays land precisely on the bar or slice they belong to.
//
// Rasterising an SVG for the model has one trap worth knowing about. Serialising
// a live <svg> loses every colour that came from a stylesheet, because those
// colours are not attributes on the nodes — the exported image comes out black
// or unstyled. inlineComputedPaint() copies each node's *computed* fill and
// stroke onto the clone as attributes before serialising, which is what keeps
// the picture the model sees identical to the one the user sees.
//
// Other pipelines: svgProcessorHardcode.js, svgProcessorAI.js.

window.AIColorA11y = window.AIColorA11y || {};

window.AIColorA11y.svgProcessor = (function () {
  const { classifyColor, parseCssColor, resolveCssColor } = window.AIColorA11y.colorDetector;

  const SHAPE_SELECTOR = 'rect, circle, ellipse, path, polygon, polyline, line';
  const PAINT_PROPS = ['fill', 'stroke', 'stop-color', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-width'];

  function paintToRgb(computedValue, attrValue) {
    if (computedValue && computedValue !== 'none' && !computedValue.startsWith('url(')) {
      const parsed = parseCssColor(computedValue);
      if (parsed) return parsed;
    }
    if (attrValue && !attrValue.startsWith('url(')) return resolveCssColor(attrValue);
    return null;
  }

  function shapeColor(shape) {
    const style = getComputedStyle(shape);

    const fill = paintToRgb(style.fill, shape.getAttribute('fill'));
    if (fill) {
      const c = classifyColor(fill.r, fill.g, fill.b, fill.a);
      if (c) return c;
    }
    const stroke = paintToRgb(style.stroke, shape.getAttribute('stroke'));
    if (stroke) {
      const strokeWidth = parseFloat(style.strokeWidth || '1');
      // A hairline stroke is usually an axis or gridline, not data.
      if (strokeWidth >= 1.5) return classifyColor(stroke.r, stroke.g, stroke.b, stroke.a);
    }
    return null;
  }

  // Every recognisably-coloured shape inside one <svg>, with viewport rects.
  // Returns [{ shape, color, rect }].
  function collectShapes(svgRoot) {
    if (!svgRoot) return [];
    const out = [];
    for (const shape of svgRoot.querySelectorAll(SHAPE_SELECTOR)) {
      const rect = shape.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue; // gridlines, ticks
      const color = shapeColor(shape);
      if (color) out.push({ shape, color, rect });
    }
    return out;
  }

  // Text drawn inside the chart (axis labels, the legend Highcharts renders as
  // <text>) — often the single most useful context we can give the model.
  function collectText(svgRoot) {
    if (!svgRoot) return '';
    const parts = [];
    const title = svgRoot.querySelector('title, desc');
    if (title) parts.push(title.textContent.trim());
    for (const t of svgRoot.querySelectorAll('text')) {
      const s = t.textContent.trim();
      if (s) parts.push(s);
    }
    return parts.join(' | ');
  }

  function inlineComputedPaint(liveNode, cloneNode) {
    if (liveNode.nodeType !== 1) return;
    const computed = getComputedStyle(liveNode);
    for (const prop of PAINT_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none' && value !== 'normal') {
        cloneNode.setAttribute(prop, value);
      }
    }
    const liveKids = liveNode.children;
    const cloneKids = cloneNode.children;
    for (let i = 0; i < liveKids.length && i < cloneKids.length; i++) {
      inlineComputedPaint(liveKids[i], cloneKids[i]);
    }
  }

  // Renders the <svg> to a PNG data URL for the model to look at.
  function rasterize(svgRoot) {
    return new Promise((resolve, reject) => {
      const rect = svgRoot.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));

      const clone = svgRoot.cloneNode(true);
      inlineComputedPaint(svgRoot, clone);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      if (!clone.getAttribute('viewBox') && svgRoot.viewBox && svgRoot.viewBox.baseVal) {
        const vb = svgRoot.viewBox.baseVal;
        if (vb.width && vb.height) clone.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
      }

      const markup = new XMLSerializer().serializeToString(clone);
      const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));

      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          // Charts usually assume a light page behind them; without this a
          // transparent SVG renders on black and the model sees nothing.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not rasterise this SVG.'));
      };
      image.src = url;
    });
  }

  return { collectShapes, collectText, rasterize, shapeColor };
})();
