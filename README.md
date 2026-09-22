# AI Color Accessibility

A Chrome extension for people who cannot reliably tell colours apart. Click any
chart, table or status label and a **vision-language model running on your own
machine** works out what its colours mean *from the page around it*, then marks
that meaning with symbols instead of colour.

```
COLOUR  ->  SEMANTIC MEANING  ->  NON-COLOUR REPRESENTATION
```

The model is never told that green is good. It reads the legend, the heading,
the caption and the chart itself, and decides per page. The same two colours on
the demo page produce three different answers:

| Where | green | red |
|---|---|---|
| Quarterly financial chart | price increase &uarr; | price decrease &darr; |
| Quiz results | correct &#10003; | incorrect &#10005; |
| Network load chart | **low load &darr;** | **high load &uarr;** |

Note the third row: the arrows are the other way round, because on that page
green means *less*, not *better*. That inversion is the whole point of the
project, and it is produced by the model reading the legend — not by any rule
in the code.

**Nothing leaves your computer.** No Gemini, no OpenAI, no cloud API.

---

## What runs where

```
Chrome extension
   |  clicks, screenshots, symbol drawing        (deterministic, no AI)
   v
localhost:8787   Node proxy: prompt, JSON schema, safety guards
   |
   v
localhost:11434  Ollama running qwen3-vl:4b-instruct
```

The model answers exactly one question: *what does this colour mean here?*
Everything else — which pixels are that colour, where a symbol goes, whether to
draw anything at all — is ordinary deterministic code. The model can never edit
the page.

The Node proxy in the middle is not decoration: Ollama rejects requests whose
`Origin` is a `chrome-extension://` URL (its default allowlist covers
localhost, `file://` and `app://` but not extensions), so a direct call from the
extension gets a 403. Proxying avoids asking you to reconfigure Ollama.

---

## Setup

### 1. Ollama + the model

```bash
winget install --id Ollama.Ollama --exact
ollama pull qwen3-vl:4b-instruct
```

**The `-instruct` tag matters.** Plain `qwen3-vl:4b` is the *thinking* variant:
it spends 300-400 tokens reasoning, and when combined with structured output it
returns an empty response. Instruct is both correct and about twice as fast.

### 2. Turn on the integrated GPU (big speedup on laptops)

Ollama detects integrated GPUs but skips them unless you opt in. On this
machine that single flag took an analysis from **76s to about 10-30s**:

```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_IGPU_ENABLE','1','User')
```

Restart Ollama, then confirm with `ollama ps` — the `PROCESSOR` column should
read `100% GPU` rather than `100% CPU`. If your GPU has no working Vulkan
driver, leave the flag off; everything still works on CPU, just slower.

### 3. Backend + website

One command from the project root starts both the backend proxy
(`localhost:8787`) and the ColorBridge website (`localhost:5500`):

```bash
npm install --prefix backend
npm start
```

`npm start` runs `start.js`, which checks whether Ollama is reachable (and
warns if it isn't) and then loads both servers in the same process — Ctrl+C
stops both together. `http://localhost:8787/health` should report the model
as ready. No `.env` is required; the defaults are correct for a standard
install.

Only need the backend on its own? `npm start --prefix backend` still works
exactly as before.

### 4. Extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** &rarr; select the `extension/` folder.
3. Pin it to the toolbar.

### 5. Try it

Open `demo/index.html`, turn the extension **ON**, press
**Select a chart to analyse**, then click any graphic on the page.

Instructions and progress appear *on the page*, not in the popup — the popup
closes the moment you click the page. The one exception is PDFs — see
[PDF support](#pdf-support) below.

---

## Measured performance

Intel Core Ultra 7 155H, 32 GB RAM, Intel Arc integrated graphics, Windows 11.

| | CPU only | iGPU (Vulkan) |
|---|---|---|
| First analysis (model load included) | 76 s | ~31 s |
| Later analyses (prompt cache warm) | ~43 s | **10-20 s** |

Two things that turned out **not** to help, both measured rather than assumed:

- **Shrinking the image does nothing.** qwen3-vl normalises any input to about
  the same image-token budget — 1099 tokens for every size from 840x400 down to
  252x120, with prompt-eval time flat across all of them. Send a reasonable
  size and move on.
- The static half of the prompt *is* cached between calls, which is why
  prompt-eval can drop to under 100 ms on a repeat run while generation stays
  around 10 s. Generation is the floor.

If it is still too slow, set `OLLAMA_MODEL=qwen3-vl:2b-instruct` in
`backend/.env`.

---

## Not transforming things that only look colourful

An accessibility aid that scribbles symbols over a family photo is worse than
none. Three independent gates have to agree before anything is drawn:

1. **The model** decides `is_color_semantic`, guided by a greyscale test —
   would a reader lose a *fact about data*, or only lose knowing what colour an
   object is?
2. **The backend** overrides the model when it contradicts itself. Shown a
   photo of people in red and green shirts *with a caption listing the shirt
   colours*, the model answered `is_color_semantic: true` and mapped
   red &rarr; "shirt colour" — but it still labelled `visual_type:
   "photograph"`. `validateResponse.js` trusts the classification and throws
   the verdict away. It also drops meanings that merely describe the picture.
3. **The extension** refuses to act below `confidence 0.6` and says so instead.

Measured on the demo page:

| Section | Detected colours | Outcome |
|---|---|---|
| A. Candlestick chart | green, red | green &rarr; price increase, red &rarr; price decrease (0.95) |
| B. Quiz results | green, red | green &rarr; correct, red &rarr; incorrect |
| C. Status dashboard | green, orange, red | completed / pending / failed |
| D. Network load (canvas) | green, red | **low load &darr; / high load &uarr;** |
| E. Risk scale (SVG) | green, orange, red | low / medium / high risk |
| F. Team photo | blue, green, red, yellow, orange (24 regions) | `decorative_image` &rarr; **nothing drawn** |
| G. Unlabelled chart | green, red | confidence 0.5 &rarr; **nothing drawn** |

One more safeguard worth naming: the model twice proposed a red circle and a
green circle as its "symbols". A coloured dot is useless to the person this
extension exists for, so `semanticMapper.js` rejects colour-dependent glyphs
and substitutes a shape-based one.

---

## How a click becomes symbols

| Kind | Picture sent to the model | How colour positions are found | Why |
|---|---|---|---|
| `<svg>` | the SVG re-rendered to PNG | **the shape rectangles themselves** | exact; no pixel guessing at all |
| `<canvas>` | its backing store | colour-region clustering | sharper than a screenshot, and free of tooltips drawn over it |
| `<img>` | drawn at natural size | colour-region clustering | falls back to a screenshot if the image is cross-origin |
| DOM cluster | screenshot of the container | each element's own rectangle | the model needs to see the layout; positions come from the DOM |

Three details that are easy to get wrong and are handled deliberately:

- **A screenshot captures our own overlays.** `chrome.tabs.captureVisibleTab`
  photographs the composited viewport, so a hover outline or last run's symbols
  become part of the model's input. `visualCapture.withUiHidden()` takes
  everything down and waits for a real paint before the shutter.
- **A canvas is not scaled by `devicePixelRatio`.** It has its own backing
  store; the correct ratio is `clientWidth / width`. On the test machine those
  differ by 22%, which is the difference between symbols on the bars and
  symbols beside them.
- **Serialising an SVG loses stylesheet colours.** They are not attributes on
  the nodes, so the exported picture comes out unstyled.
  `inlineComputedPaint()` copies the computed fill and stroke onto the clone
  first.

---

## Project layout

```
extension/
  content/
    colorDetector.js     RGB -> one of five colour buckets (HSV)
    semanticMapper.js    meaning -> glyph; rejects colour-dependent glyphs
    overlayManager.js    draws and removes every symbol
    imageProcessor.js    bitmaps + colour-region clustering
    svgProcessor.js      SVG shapes and rasterisation
    domColorScanner.js   coloured HTML elements
    contextCollector.js  the page text sent with the picture
    visualCapture.js     one entry point per visual kind
    selectionMode.js     click-to-select UI, in a closed shadow root
    usageTracker.js      analysis quota + the Pro override (see below)
    accountSync.js       runs only on the ColorBridge site; relays the account tier
    content.js           orchestrates one analysis
  background/service-worker.js    screenshots + backend calls
  popup/
    popup.html/js/css              on/off, health, launcher, account status
    pdfCapture.js                  the PDF-only capture/select/result flow
website/
  index.html/style.css/app.js      the ColorBridge site (2 hardcoded demo accounts)
  server.js                        static file server, fixed port 5500
backend/
  server.js            POST /analyze, GET /health
  ollamaClient.js      the LocalVLMClient
  promptBuilder.js     the prompt, including the greyscale test
  analysisSchema.js    JSON schema Ollama compiles into a grammar
  validateResponse.js  the safety guards
  test-vlm.js          standalone model check with timings
  test-validate.js     guard unit tests (no model needed)
  make-test-images.js  PNG fixtures, no dependencies
demo/index.html
```

### Two older pipelines are kept alongside

Same filenames with a suffix, unchanged and inactive:

- `*Hardcode.js` — fixed colour rules, no AI at all.
- `*AI.js` + `backend/geminiClient.js` — the earlier Gemini version.

To switch, point `manifest.json`'s `content_scripts` list and
`popup.js`'s `CONTENT_SCRIPT_FILES` at the suffixed files. For Gemini also set
`VLM_PROVIDER=gemini` in `backend/.env`.

---

## Accounts and the free-tier limit

One click on a visual is one analysis, which is why the extension asks you to
aim it instead of scanning whole pages. `usageTracker.js` caps the free tier
at **10 analyses per rolling 24 hours** — a sliding window, not a daily
refill, so using all 10 and waiting doesn't grant extras on top of unused
ones.

There is **no account server**. The `website/` folder is a local demo with
two hardcoded accounts (`free@colorbridge.app` / `pro@colorbridge.app`,
passwords in `website/README.md`) whose session lives only in that page's own
`localStorage`. The extension is linked to it in exactly one place:
`extension/content/accountSync.js` is a content script that runs *only* on
`http://localhost:5500/*` and copies the signed-in account's tier into
`chrome.storage.local`. If that tier is `"pro"`, `usageTracker.checkQuota()`
returns unlimited. Nothing else about the website — the displayed name, the
upgrade box, sign-out — reaches the extension at all.

Practical effect: sign into the Pro demo account on the website, in the same
browser as the extension, and the 10/day limit lifts within about two
seconds. See `website/README.md#how-the-pro-link-works` for the full
mechanism, including how to point it at a real domain later.

---

## PDF support

Verified directly: Chrome's built-in PDF viewer is a sandboxed extension page
that **no other extension's content script can reach**, on either Manifest V2
or V3. That's a platform restriction, not something to work around — it rules
out click-to-select, the on-page status pill and drawing symbols onto the PDF
itself.

What still works: `chrome.tabs.captureVisibleTab` needs no content script, so
PDFs get a different flow that runs entirely inside the popup
(`extension/popup/pdfCapture.js`):

1. The popup detects a PDF tab (URL ends in `.pdf`) and shows **Capture this
   PDF page** instead of the normal button.
2. It screenshots the tab and displays it right there in the popup.
3. Drag a box around one chart. There's no page text to read automatically,
   so an optional textarea lets you paste the legend by hand.
4. The crop goes through the same pipeline as everywhere else — colour
   detection, the local model, the same confidence gates — and the answer is
   drawn onto the cropped image and listed as text, directly in the popup
   (which stays open for this flow instead of auto-closing).

---

## Known limitations

- **Speed.** 10-20 s per analysis with the iGPU, more on CPU. Fundamental to
  running a vision model locally; the click-to-select design is the mitigation.
- **WebGL canvases** created without `preserveDrawingBuffer` read back blank.
  Detected, and the screenshot route is used instead.
- **Cross-origin iframes** never deliver the click, so charts inside them
  cannot be selected.
- **Colour-bucket boundaries.** Amber sits between yellow and orange; the
  prompt tells the model which names the browser measured, and unmatched
  mappings fall back to a neighbouring bucket.
- **Overlays are cleared when a chart resizes.** Charts re-render and stale
  symbols would point at nothing.
- The free-tier counter is local and honest, not enforced.

## Testing

```bash
cd backend
node test-validate.js                          # safety guards, instant, no model
node make-test-images.js                       # regenerate PNG fixtures
node test-vlm.js test-images/candles.png --context "Green candles indicate the stock price increased."
```

Then the demo page, section by section, against the table above.
