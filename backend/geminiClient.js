// geminiClient.js
//
// Purpose: the only file that talks to the Gemini API. Reads the API key from
// process.env.GEMINI_API_KEY (set via backend/.env, never committed to git,
// never sent to or stored in the Chrome extension). Uses the plain REST API
// with Node's built-in fetch (Node 18+) to keep the dependency list minimal.

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function callGemini({ prompt, imageBase64 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server. Copy backend/.env.example to backend/.env and fill it in.');
  }

  const parts = [{ text: prompt }];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: 'image/png', data: imageBase64 } });
  }

  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini API error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const text =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;

  if (!text) {
    throw new Error('Gemini API returned no usable content (it may have been blocked by safety filters).');
  }
  return text;
}

module.exports = { callGemini };
