// test-vlm.js  —  Phase A standalone check
//
// Verifies the local VLM works AT ALL, and measures how slow it is, before any
// extension code depends on it. Nothing here imports Express or touches the
// browser — it is just: image in, structured JSON out.
//
//   node test-vlm.js <image-path> [--context "text around the image"]
//   node test-vlm.js <image-path> --model qwen3-vl:2b
//
// The timing breakdown matters for the go/no-go decision: `prompt eval` is the
// vision tower chewing through image tokens, `generation` is the JSON coming
// back. If prompt eval dominates, shrink the image; if generation dominates,
// shrink the model.

const fs = require('fs');
const path = require('path');
const { buildPrompt } = require('./promptBuilder');
const { ANALYSIS_SCHEMA } = require('./analysisSchema');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3-vl:4b';

function parseArgs(argv) {
  const args = { imagePath: null, context: '', model: DEFAULT_MODEL };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--context') args.context = argv[++i] || '';
    else if (argv[i] === '--model') args.model = argv[++i] || DEFAULT_MODEL;
    else if (!args.imagePath) args.imagePath = argv[i];
  }
  return args;
}

function ns(nanoseconds) {
  if (typeof nanoseconds !== 'number') return 'n/a';
  return `${(nanoseconds / 1e9).toFixed(1)}s`;
}

async function main() {
  const { imagePath, context, model } = parseArgs(process.argv);

  if (!imagePath) {
    console.error('Usage: node test-vlm.js <image-path> [--context "..."] [--model qwen3-vl:2b]');
    process.exit(1);
  }
  if (!fs.existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }

  const imageBase64 = fs.readFileSync(imagePath).toString('base64');
  const sizeKb = Math.round(Buffer.byteLength(imageBase64, 'utf8') / 1024);

  const prompt = buildPrompt({
    context: {
      nearbyText: context,
      visualKind: path.extname(imagePath).replace('.', '') || 'image'
    }
  });

  console.log(`model   : ${model}`);
  console.log(`image   : ${path.basename(imagePath)} (${sizeKb} KB base64)`);
  console.log(`context : ${context ? `"${context}"` : '(none)'}`);
  console.log('sending to Ollama...\n');

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        images: [imageBase64],
        format: ANALYSIS_SCHEMA,
        stream: false,
        keep_alive: '10m',
        options: { temperature: 0 }
      })
    });
  } catch (err) {
    console.error(`Could not reach Ollama at ${OLLAMA_URL}.`);
    console.error('Is the Ollama app running? Start it, then retry.');
    console.error(`(${err.message})`);
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`Ollama returned HTTP ${response.status}`);
    console.error(body.slice(0, 500));
    if (/not found/i.test(body)) {
      console.error(`\nThe model is probably not pulled yet. Run:  ollama pull ${model}`);
    }
    process.exit(1);
  }

  const data = await response.json();
  const wallSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log('--- TIMING ---');
  console.log(`wall clock      : ${wallSeconds}s`);
  console.log(`model load      : ${ns(data.load_duration)}`);
  console.log(`prompt eval     : ${ns(data.prompt_eval_duration)}  (${data.prompt_eval_count ?? '?'} tokens - image + text in)`);
  console.log(`generation      : ${ns(data.eval_duration)}  (${data.eval_count ?? '?'} tokens out)`);

  console.log('\n--- RAW RESPONSE ---');
  console.log(data.response);

  console.log('\n--- PARSED ---');
  try {
    const parsed = JSON.parse(data.response);
    console.log(JSON.stringify(parsed, null, 2));

    console.log('\n--- SUMMARY ---');
    console.log(`colour carries meaning : ${parsed.is_color_semantic}`);
    console.log(`visual type            : ${parsed.visual_type}`);
    console.log(`confidence             : ${parsed.confidence}`);
    console.log(`evidence               : ${parsed.evidence}`);
    for (const m of parsed.mappings || []) {
      console.log(`  ${m.color.padEnd(7)} -> ${String(m.meaning).padEnd(20)} ${m.symbol}   (${m.confidence})`);
    }
  } catch (err) {
    console.error(`\nResponse was not valid JSON even though a schema was supplied: ${err.message}`);
    process.exit(1);
  }
}

main();
