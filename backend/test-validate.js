// test-validate.js
//
// Checks the safety guards in validateResponse.js against REAL responses
// captured from qwen3-vl:4b-instruct during Phase A testing. These run in
// milliseconds and need no model, so they can be run on every change:
//
//   node test-validate.js

const assert = require('assert');
const { parseAndValidate } = require('./validateResponse');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('validateResponse guards\n');

check('accepts a genuine financial chart', () => {
  const r = parseAndValidate(JSON.stringify({
    evidence: "The surrounding text explicitly states: 'Green candles indicate the stock price increased that day.'",
    is_color_semantic: true,
    visual_type: 'financial_chart',
    confidence: 0.95,
    mappings: [
      { color: 'green', meaning: 'price increase', symbol: '↑', confidence: 0.95 },
      { color: 'red', meaning: 'price decrease', symbol: '↓', confidence: 0.95 }
    ]
  }));
  assert.strictEqual(r.is_color_semantic, true);
  assert.strictEqual(r.mappings.length, 2);
  assert.strictEqual(r.mappings[0].symbol, '↑');
});

check('accepts a status dashboard including yellow', () => {
  const r = parseAndValidate(JSON.stringify({
    evidence: 'Design review: Completed. Load testing: Failed.',
    is_color_semantic: true,
    visual_type: 'status_dashboard',
    confidence: 0.95,
    mappings: [
      { color: 'green', meaning: 'Completed', symbol: '✓', confidence: 0.95 },
      { color: 'yellow', meaning: 'Pending', symbol: '⏳', confidence: 0.95 },
      { color: 'red', meaning: 'Failed', symbol: '✗', confidence: 0.95 }
    ]
  }));
  assert.strictEqual(r.is_color_semantic, true);
  assert.strictEqual(r.mappings.length, 3);
});

// This is the exact response the model gave for a photo of people in red and
// green shirts whose caption listed the shirt colours. The model said true;
// the guard must override it.
check('overrides the model on a photograph (observed false positive)', () => {
  const r = parseAndValidate(JSON.stringify({
    evidence: "The text explicitly states 'Shirt colours from left to right: red, green, red, green.'",
    is_color_semantic: true,
    visual_type: 'photograph',
    confidence: 0.95,
    mappings: [
      { color: 'red', meaning: 'shirt colour', symbol: '🔴', confidence: 0.95 },
      { color: 'green', meaning: 'shirt colour', symbol: '🟢', confidence: 0.95 }
    ]
  }));
  assert.strictEqual(r.is_color_semantic, false, 'a photograph must never be transformed');
  assert.deepStrictEqual(r.mappings, []);
  assert.ok(r.rejected, 'should explain why it was rejected');
});

check('overrides on decorative_image too', () => {
  const r = parseAndValidate(JSON.stringify({
    evidence: 'A team photo.',
    is_color_semantic: true,
    visual_type: 'decorative_image',
    confidence: 0.9,
    mappings: [{ color: 'red', meaning: 'increase', symbol: '↑', confidence: 0.9 }]
  }));
  assert.strictEqual(r.is_color_semantic, false);
});

check('drops meanings that describe the picture instead of data', () => {
  const r = parseAndValidate(JSON.stringify({
    evidence: 'x',
    is_color_semantic: true,
    visual_type: 'bar_chart',
    confidence: 0.9,
    mappings: [
      { color: 'red', meaning: 'the second person', symbol: '2', confidence: 0.9 },
      { color: 'green', meaning: 'revenue growth', symbol: '↑', confidence: 0.9 }
    ]
  }));
  assert.strictEqual(r.mappings.length, 1, 'only the data meaning should survive');
  assert.strictEqual(r.mappings[0].meaning, 'revenue growth');
});

check('rejects entirely when every meaning is a description', () => {
  const r = parseAndValidate(JSON.stringify({
    evidence: 'x',
    is_color_semantic: true,
    visual_type: 'bar_chart',
    confidence: 0.9,
    mappings: [{ color: 'red', meaning: 'red', symbol: '■', confidence: 0.9 }]
  }));
  assert.strictEqual(r.is_color_semantic, false);
  assert.ok(/described|no colour/i.test(r.rejected));
});

check('folds a 0-100 confidence back into 0-1', () => {
  const r = parseAndValidate(JSON.stringify({
    evidence: 'x',
    is_color_semantic: true,
    visual_type: 'bar_chart',
    confidence: 95,
    mappings: [{ color: 'green', meaning: 'growth', symbol: '↑', confidence: 92 }]
  }));
  assert.strictEqual(r.confidence, 0.95);
  assert.strictEqual(r.mappings[0].confidence, 0.92);
});

check('ignores duplicate colours', () => {
  const r = parseAndValidate(JSON.stringify({
    evidence: 'x',
    is_color_semantic: true,
    visual_type: 'bar_chart',
    confidence: 0.9,
    mappings: [
      { color: 'green', meaning: 'growth', symbol: '↑', confidence: 0.9 },
      { color: 'green', meaning: 'decline', symbol: '↓', confidence: 0.4 }
    ]
  }));
  assert.strictEqual(r.mappings.length, 1);
  assert.strictEqual(r.mappings[0].meaning, 'growth');
});

check('survives malformed JSON without throwing', () => {
  const r = parseAndValidate('not json at all');
  assert.strictEqual(r.is_color_semantic, false);
  assert.ok(r.error);
});

check('strips markdown fences if a model ever emits them', () => {
  const r = parseAndValidate('```json\n' + JSON.stringify({
    evidence: 'x',
    is_color_semantic: true,
    visual_type: 'bar_chart',
    confidence: 0.9,
    mappings: [{ color: 'green', meaning: 'growth', symbol: '↑', confidence: 0.9 }]
  }) + '\n```');
  assert.strictEqual(r.is_color_semantic, true);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
