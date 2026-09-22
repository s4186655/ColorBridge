// ollamaClient.js  —  the LocalVLMClient
//
// The only file that talks to the model. Everything runs on this machine:
// requests go to http://localhost:11434 and never leave it.
//
// Three things here were learned the hard way in Phase A and are worth keeping
// in mind before changing them:
//
//   1. The model MUST be an "-instruct" tag. Plain `qwen3-vl:4b` is the
//      *thinking* variant: it spends 300-400 tokens reasoning, and combined
//      with `format` (grammar-constrained JSON) it returns an EMPTY response.
//      The instruct tag is both correct and roughly twice as fast.
//
//   2. `format` is what makes the output trustworthy. Ollama compiles the JSON
//      schema into a grammar, so the model cannot emit a wrong shape or an
//      unsupported colour name. Without it we would be repairing text.
//
//   3. `keep_alive` matters a lot. Loading the model costs ~9s; keeping it
//      resident makes every analysis after the first one much cheaper.
//
// Shrinking the image does NOT help: qwen3-vl normalises any input to roughly
// the same image-token budget (measured: 1099 tokens for every size from
// 840x400 down to 252x120). Send a reasonable size and don't bother scaling.

const { ANALYSIS_SCHEMA } = require('./analysisSchema');
const { buildPrompt } = require('./promptBuilder');

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3-vl:4b-instruct';
const DEFAULT_TIMEOUT_MS = 120000;

function config() {
  return {
    url: (process.env.OLLAMA_URL || DEFAULT_URL).replace(/\/$/, ''),
    model: process.env.OLLAMA_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  };
}

class VlmError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

async function request(path, options = {}, timeoutMs) {
  const { url } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${url}${path}`, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new VlmError('timeout', `The model did not respond within ${Math.round(timeoutMs / 1000)}s.`,
        'The first request after starting Ollama is the slowest. Try again, or switch OLLAMA_MODEL to qwen3-vl:2b.');
    }
    throw new VlmError('unreachable', `Cannot reach Ollama at ${url}.`,
      'Start the Ollama app (or run "ollama serve"), then try again.');
  } finally {
    clearTimeout(timer);
  }
}

// Reports whether the local stack is ready, so the extension can tell the user
// exactly what to fix instead of just failing at analysis time.
async function checkHealth() {
  const { url, model } = config();
  let response;
  try {
    response = await request('/api/tags', {}, 5000);
  } catch (err) {
    return { ok: false, url, model, code: err.code, message: err.message, hint: err.hint };
  }
  if (!response.ok) {
    return { ok: false, url, model, code: 'bad_response', message: `Ollama returned HTTP ${response.status}.` };
  }

  const data = await response.json().catch(() => ({ models: [] }));
  const installed = (data.models || []).map((m) => m.name);
  const hasModel = installed.some((name) => name === model || name.startsWith(`${model}:`));

  return {
    ok: hasModel,
    url,
    model,
    modelInstalled: hasModel,
    installedModels: installed,
    ...(hasModel ? {} : {
      code: 'model_missing',
      message: `Model "${model}" is not installed.`,
      hint: `Run:  ollama pull ${model}`
    })
  };
}

// The one call the rest of the app makes.
//   imageBase64 : PNG bytes, base64, WITHOUT the "data:image/png;base64," prefix
//   context     : page context collected by the extension (see promptBuilder)
// Returns the model's raw JSON text; validation happens in validateResponse.js.
async function analyzeImage({ imageBase64, context = {} }) {
  const { model, timeoutMs } = config();

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw new VlmError('bad_request', 'No image was supplied for analysis.');
  }

  const response = await request('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: buildPrompt({ context }),
      images: [imageBase64],
      format: ANALYSIS_SCHEMA,
      stream: false,
      keep_alive: '10m',
      options: { temperature: 0 }
    })
  }, timeoutMs);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (/not found|no such model/i.test(body)) {
      throw new VlmError('model_missing', `Model "${model}" is not installed.`, `Run:  ollama pull ${model}`);
    }
    throw new VlmError('bad_response', `Ollama returned HTTP ${response.status}.`, body.slice(0, 200));
  }

  const data = await response.json();

  if (!data.response || !data.response.trim()) {
    // Seen when a *thinking* model is combined with `format`: all the tokens
    // go to `thinking` and `response` comes back empty.
    throw new VlmError('empty_response', 'The model returned no answer.',
      data.thinking
        ? `"${model}" looks like a thinking model, which does not work with structured output. Use an "-instruct" tag instead.`
        : 'Try again; if it keeps happening, restart Ollama.');
  }

  return {
    rawText: data.response,
    timings: {
      totalMs: Math.round((data.total_duration || 0) / 1e6),
      loadMs: Math.round((data.load_duration || 0) / 1e6),
      promptEvalMs: Math.round((data.prompt_eval_duration || 0) / 1e6),
      generateMs: Math.round((data.eval_duration || 0) / 1e6),
      promptTokens: data.prompt_eval_count,
      generatedTokens: data.eval_count
    }
  };
}

module.exports = { analyzeImage, checkHealth, VlmError, config };
