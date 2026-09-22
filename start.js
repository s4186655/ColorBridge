// start.js
//
// One command to run everything except Ollama itself:
//   - the backend proxy (http://localhost:8787)
//   - the ColorBridge website (http://localhost:5500)
//
// Both server files just call .listen() as soon as they're loaded (there's
// no `if (require.main === module)` guard in either), so simply requiring
// them here starts both inside this one process. Ctrl+C stops both together.
//
// Ollama is a separate, longer-lived app — it isn't started here. This script
// only checks whether it's already reachable and tells you if it isn't.

const http = require('http');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

function checkOllama() {
  return new Promise((resolve) => {
    const req = http.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  console.log('AI Color Accessibility — starting backend + website\n');

  const ollamaUp = await checkOllama();
  if (!ollamaUp) {
    console.warn(`WARNING: Ollama is not reachable at ${OLLAMA_URL}.`);
    console.warn('  Start the Ollama app first, then reload the extension popup.');
    console.warn('  (The servers below will still start — this just means analysis will fail until Ollama is running.)\n');
  }

  require('./backend/server.js');
  require('./website/server.js');

  console.log('\nBoth servers are up. Press Ctrl+C to stop them.');
}

main();
