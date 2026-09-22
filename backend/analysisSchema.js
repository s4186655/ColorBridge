// analysisSchema.js
//
// The single source of truth for the shape of a VLM analysis result.
//
// This schema is passed to Ollama as the `format` parameter, which makes
// llama.cpp build a grammar from it and constrain decoding — the model
// literally cannot emit a response that doesn't match this shape. That is why
// the rest of the pipeline doesn't need to repair markdown fences or
// half-finished JSON the way a plain "please return JSON" prompt would.
//
// Two deliberate design choices:
//
// 1. `evidence` is listed FIRST. Grammar-constrained decoding fills required
//    properties in the order given, so the model has to state what it actually
//    saw before it commits to a verdict. This measurably improves small models
//    and doubles as a "why" we can show the user.
//
// 2. `color` is an enum of exactly the five buckets colorDetector.js can
//    classify. A mapping for any other colour name would be unusable — the
//    browser side would never find a matching region — so the grammar rules
//    them out at generation time instead of us discarding them later.
//
// Used by: ollamaClient.js, test-vlm.js, validateResponse.js.

const SUPPORTED_COLORS = ['red', 'green', 'yellow', 'orange', 'blue'];

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    evidence: { type: 'string' },
    is_color_semantic: { type: 'boolean' },
    visual_type: { type: 'string' },
    confidence: { type: 'number' },
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          color: { type: 'string', enum: SUPPORTED_COLORS },
          meaning: { type: 'string' },
          symbol: { type: 'string' },
          confidence: { type: 'number' }
        },
        required: ['color', 'meaning', 'symbol', 'confidence']
      }
    }
  },
  required: ['evidence', 'is_color_semantic', 'visual_type', 'confidence', 'mappings']
};

module.exports = { ANALYSIS_SCHEMA, SUPPORTED_COLORS };
