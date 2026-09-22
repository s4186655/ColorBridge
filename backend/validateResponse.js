// validateResponse.js
//
// Never trusts the model's output blindly. Ollama's `format` parameter already
// guarantees the SHAPE of the JSON, so this file is not about parsing repair
// any more — it is about SAFETY. It enforces the rules a 4B model does not
// reliably follow on its own, deterministically, in code.
//
// The two guards below exist because of failures observed while testing:
//
//   1. Shown a photo of people in red and green shirts with a caption that
//      listed the shirt colours, the model answered is_color_semantic = true
//      and mapped red -> "shirt colour". It did, however, always label
//      visual_type correctly as "photograph" / "decorative_image". So we trust
//      the classification and override the verdict.
//
//   2. The same run produced meanings that merely described the picture
//      ("shirt colour", "second person") rather than naming a data value.
//      A meaning like that can't be turned into a useful symbol, so it is
//      dropped.
//
// Anything rejected here degrades to "no colour-coded information found",
// which makes the extension leave the page completely untouched.

const { SUPPORTED_COLORS } = require('./analysisSchema');

const VALID_COLORS = new Set(SUPPORTED_COLORS);

// Visual types where colour is the subject, not the encoding.
const NON_DATA_VISUAL_TYPE = /photo|portrait|decorative|logo|avatar|artwork|illustration|product|banner|scenery|landscape|selfie|thumbnail/i;

// Meanings that just describe the picture instead of naming a data value.
const MEANING_IS_A_DESCRIPTION = /^(the\s+)?(\w+\s+)?colou?r$|colou?r of|shirt|clothing|person|people|object|background|decorat/i;
const MEANING_IS_BARE_COLOR = new RegExp(`^(${SUPPORTED_COLORS.join('|')})$`, 'i');

function normalizeConfidence(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  // Models sometimes answer 95 when asked for 0.95; a JSON schema of type
  // "number" can't prevent that, so fold it back into range here.
  const scaled = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, scaled));
}

function isUsableMeaning(meaning) {
  if (typeof meaning !== 'string') return false;
  const text = meaning.trim();
  if (text.length < 2) return false;
  if (MEANING_IS_BARE_COLOR.test(text)) return false;
  if (MEANING_IS_A_DESCRIPTION.test(text)) return false;
  return true;
}

function parseAndValidate(rawText) {
  const SAFE_FALLBACK = {
    is_color_semantic: false,
    visual_type: 'unknown',
    confidence: 0,
    evidence: '',
    mappings: []
  };

  let parsed;
  try {
    // Kept tolerant of code fences in case a model/provider is ever used that
    // doesn't support grammar-constrained output.
    const cleaned = String(rawText).trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```$/, '');
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { ...SAFE_FALLBACK, error: 'Model response was not valid JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ...SAFE_FALLBACK, error: 'Model response was not a JSON object.' };
  }

  const visualType = (typeof parsed.visual_type === 'string' ? parsed.visual_type : 'unknown').slice(0, 60);
  const evidence = (typeof parsed.evidence === 'string' ? parsed.evidence : '').slice(0, 300);
  const confidence = normalizeConfidence(parsed.confidence);

  const rawMappings = Array.isArray(parsed.mappings) ? parsed.mappings : [];
  const seenColors = new Set();
  const mappings = [];
  let droppedMeanings = 0;

  for (const m of rawMappings) {
    if (!m || typeof m.color !== 'string') continue;
    const color = m.color.toLowerCase().trim();
    if (!VALID_COLORS.has(color) || seenColors.has(color)) continue;
    if (!isUsableMeaning(m.meaning)) { droppedMeanings++; continue; }

    seenColors.add(color);
    mappings.push({
      color,
      meaning: m.meaning.trim().slice(0, 100),
      symbol: typeof m.symbol === 'string' ? m.symbol.trim().slice(0, 8) : '',
      confidence: normalizeConfidence(m.confidence)
    });
  }

  // Guard 1: colour is the subject of the picture, not an encoding.
  if (NON_DATA_VISUAL_TYPE.test(visualType)) {
    return {
      is_color_semantic: false,
      visual_type: visualType,
      confidence,
      evidence,
      mappings: [],
      rejected: `Treated as a picture rather than data (visual_type "${visualType}"), so the page was left unchanged.`
    };
  }

  // Guard 2: nothing survived that could become a meaningful symbol.
  if (mappings.length === 0) {
    return {
      is_color_semantic: false,
      visual_type: visualType,
      confidence,
      evidence,
      mappings: [],
      rejected: droppedMeanings
        ? 'The colours were described rather than explained, so no symbol could be chosen.'
        : 'No colour in this graphic was found to carry meaning.'
    };
  }

  return {
    is_color_semantic: Boolean(parsed.is_color_semantic),
    visual_type: visualType,
    confidence,
    evidence,
    mappings
  };
}

module.exports = { parseAndValidate, isUsableMeaning, normalizeConfidence, NON_DATA_VISUAL_TYPE };
