// server.js
//
// A small local proxy that sits between the Chrome extension and the model.
//
// Why it exists at all, given the model is already local: Ollama rejects
// requests whose Origin is a chrome-extension:// URL (its default allowlist
// covers localhost, file://, app:// and a few others, but not extensions), so
// a page-less fetch from the extension gets a 403. Going through Node avoids
// asking the user to set OLLAMA_ORIGINS, and gives one place to build prompts,
// enforce the schema and validate what comes back.
//
//   POST /analyze   { image, context }  ->  validated analysis JSON
//   GET  /health                        ->  is the local stack ready?
//
// Nothing here talks to the internet when VLM_PROVIDER=ollama (the default).

// Load backend/.env by an absolute path (not the process's cwd) so this file
// keeps working when it's launched from the project root by the combined
// `npm start` script instead of `cd backend && node server.js`.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const ollamaClient = require('./ollamaClient');
const { parseAndValidate } = require('./validateResponse');

const PROVIDER = (process.env.VLM_PROVIDER || 'ollama').toLowerCase();

const app = express();
app.use(cors());
// Screenshots of a chart are typically 20-200 KB base64; the ceiling is
// generous so a large dashboard crop can't fail for size alone.
app.use(express.json({ limit: '12mb' }));

app.get('/health', async (req, res) => {
  if (PROVIDER !== 'ollama') {
    return res.json({
      ok: Boolean(process.env.GEMINI_API_KEY),
      provider: PROVIDER,
      note: 'Using the legacy cloud provider. Set VLM_PROVIDER=ollama to run fully locally.'
    });
  }
  const health = await ollamaClient.checkHealth();
  res.json({ provider: 'ollama', ...health });
});

app.post('/analyze', async (req, res) => {
  const { image, context } = req.body || {};

  if (!image) {
    return res.status(400).json({ error: 'No image supplied.', code: 'bad_request' });
  }

  const startedAt = Date.now();
  try {
    // Accept a full data: URL as well as bare base64, so callers don't have to
    // remember which one this endpoint wants.
    const imageBase64 = String(image).replace(/^data:image\/\w+;base64,/, '');

    let rawText;
    let timings = null;

    if (PROVIDER === 'ollama') {
      const result = await ollamaClient.analyzeImage({ imageBase64, context: context || {} });
      rawText = result.rawText;
      timings = result.timings;
    } else {
      // Legacy cloud path, kept working but no longer the default.
      const { callGemini } = require('./geminiClient');
      const { buildPrompt } = require('./promptBuilder');
      rawText = await callGemini({ prompt: buildPrompt({ context: context || {} }), imageBase64 });
    }

    const analysis = parseAndValidate(rawText);

    console.log(
      `[analyze] ${analysis.visual_type} | semantic=${analysis.is_color_semantic} | ` +
      `confidence=${analysis.confidence} | ${analysis.mappings.length} mapping(s) | ` +
      `${Date.now() - startedAt}ms`
    );

    res.json({ ...analysis, provider: PROVIDER, timings });
  } catch (err) {
    console.error(`[analyze] ${err.code || 'error'}: ${err.message}`);
    // 503: the model host is the thing that's unavailable, not this request.
    res.status(err.code === 'bad_request' ? 400 : 503).json({
      error: err.message || 'Analysis failed.',
      code: err.code || 'error',
      hint: err.hint
    });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, async () => {
  console.log(`AI Color Accessibility backend listening on http://localhost:${PORT}`);
  console.log(`provider: ${PROVIDER}`);

  if (PROVIDER === 'ollama') {
    const health = await ollamaClient.checkHealth();
    if (health.ok) {
      console.log(`ready: ${health.model} via ${health.url}`);
    } else {
      console.warn(`NOT READY: ${health.message}`);
      if (health.hint) console.warn(`   ${health.hint}`);
    }
  } else if (!process.env.GEMINI_API_KEY) {
    console.warn('WARNING: VLM_PROVIDER is not "ollama" and GEMINI_API_KEY is unset.');
  }
});
