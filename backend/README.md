# Backend — local VLM proxy

Sits between the Chrome extension and Ollama. Builds the prompt, enforces the
JSON schema, and applies the safety guards. Nothing here reaches the internet
when `VLM_PROVIDER=ollama` (the default).

## Run

```bash
npm install
npm start
```

No `.env` is needed; defaults match a standard Ollama install. Copy
`.env.example` to `.env` only if you want to change the model or port.

Check it:

```bash
curl http://localhost:8787/health
```

```json
{ "provider": "ollama", "ok": true, "model": "qwen3-vl:4b-instruct", "modelInstalled": true }
```

If `ok` is false the response carries a `hint` saying what to fix.

## API

### `POST /analyze`

```json
{
  "image": "<base64 PNG, with or without the data: prefix>",
  "context": {
    "documentTitle": "Acme Investor Relations",
    "heading": "Quarterly Financial Performance",
    "legendText": "Green candles indicate the stock price increased that day.",
    "nearbyText": "...",
    "altText": "Candlestick chart",
    "visualKind": "img",
    "colorsFound": ["green", "red"]
  }
}
```

```json
{
  "is_color_semantic": true,
  "visual_type": "financial_chart",
  "confidence": 0.95,
  "evidence": "Legend states: 'Green candles indicate the stock price increased that day.'",
  "mappings": [
    { "color": "green", "meaning": "price increase", "symbol": "↑", "confidence": 0.95 },
    { "color": "red",   "meaning": "price decrease", "symbol": "↓", "confidence": 0.95 }
  ],
  "provider": "ollama",
  "timings": { "totalMs": 10198, "promptEvalMs": 96, "generateMs": 10011 }
}
```

When colour turns out to carry no meaning, `is_color_semantic` is `false`,
`mappings` is empty, and `rejected` explains why. Errors return 503 with
`error` and usually a `hint`.

`colorsFound` matters: the prompt tells the model to use only those colour
names, so its answer can actually be matched to regions on the page.

## Files

| File | Job |
|---|---|
| `server.js` | the two routes |
| `ollamaClient.js` | the LocalVLMClient — the only thing that talks to the model |
| `promptBuilder.js` | the prompt, including the greyscale test and the field caps |
| `analysisSchema.js` | JSON schema Ollama compiles into a decoding grammar |
| `validateResponse.js` | safety guards; never trusts the verdict blindly |
| `test-vlm.js` | standalone model check with a timing breakdown |
| `test-validate.js` | guard unit tests — instant, no model required |
| `make-test-images.js` | PNG fixtures written with zlib and no dependencies |
| `geminiClient.js` | the older cloud path, used only if `VLM_PROVIDER=gemini` |

## Notes worth keeping

- **Use an `-instruct` model tag.** Plain `qwen3-vl:4b` is the thinking
  variant; with structured output it returns an empty `response` and puts
  everything in `thinking`. `ollamaClient.js` detects this and says so.
- **`keep_alive: '10m'`** keeps the model resident. Loading it costs ~9s.
- **Do not bother resizing images.** Measured: identical prompt-token count
  (1099) and prompt-eval time for every size from 840x400 down to 252x120.
- **Guards over prompting.** The model labelled a photo `visual_type:
  "photograph"` while still claiming its colours were meaningful.
  `validateResponse.js` trusts the label and discards the claim.
