// promptBuilder.js
//
// Builds the text prompt sent to the local VLM alongside the cropped image.
// Kept in its own file so the prompt can be reviewed and tuned without
// touching HTTP or validation plumbing.
//
// The prompt's whole job is to stop the model from doing the one thing that
// would make this product wrong: assuming a colour's meaning from the colour
// itself. Green means "increase" on a stock chart, "correct" on a quiz,
// "low risk" on a risk gauge and "high traffic" on some network dashboards.
// Only the surrounding page can say which.
//
// Output shape is enforced separately by analysisSchema.js (passed to Ollama
// as `format`), so this prompt describes *what to decide*, not JSON syntax.
//
// Used by: ollamaClient.js, test-vlm.js.

const FIELD_LIMITS = {
  documentTitle: 120,
  heading: 120,
  altText: 200,
  ariaLabel: 200,
  caption: 300,
  svgText: 300,
  legendText: 300,
  nearbyText: 600
};

function clean(value, limit) {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= limit) return collapsed;
  // Truncate the MIDDLE: legends and captions tend to sit at the start or the
  // end of a text run, so cutting the middle keeps the most useful parts.
  const half = Math.floor((limit - 3) / 2);
  return `${collapsed.slice(0, half)}...${collapsed.slice(-half)}`;
}

function buildContextBlock(context = {}) {
  const lines = [];
  const add = (label, value, limit) => {
    const text = clean(value, limit);
    if (text) lines.push(`${label}: "${text}"`);
  };

  add('Page title', context.documentTitle, FIELD_LIMITS.documentTitle);
  add('Nearest heading', context.heading, FIELD_LIMITS.heading);
  add('Image alt text', context.altText, FIELD_LIMITS.altText);
  add('Accessible label', context.ariaLabel, FIELD_LIMITS.ariaLabel);
  add('Caption', context.caption, FIELD_LIMITS.caption);
  add('Text inside the graphic', context.svgText, FIELD_LIMITS.svgText);
  add('Legend', context.legendText, FIELD_LIMITS.legendText);
  add('Surrounding text', context.nearbyText, FIELD_LIMITS.nearbyText);

  if (Array.isArray(context.colorsFound) && context.colorsFound.length) {
    // Naming a colour the browser did not detect makes the mapping unusable:
    // there would be no region on the page to attach the symbol to. Amber, for
    // instance, sits on the yellow/orange boundary, and the two sides must
    // agree on which name it got.
    lines.push(`Colours the browser measured in this graphic: ${context.colorsFound.join(', ')}.`);
    lines.push(`Use ONLY these colour names in your mappings, even if you would have named a shade differently.`);
  }
  if (context.visualKind) {
    lines.push(`Element type: ${context.visualKind}`);
  }

  return lines.length ? lines.join('\n') : '(no surrounding text could be read)';
}

function buildPrompt({ context = {} } = {}) {
  return `You are an accessibility assistant helping a user who cannot reliably tell colours apart.

You are shown one graphic taken from a webpage, plus the text that surrounds it.
Decide whether COLOUR is being used in this graphic to carry information — that is,
whether someone who cannot see the colour difference would lose meaning.

CONTEXT FROM THE PAGE
${buildContextBlock(context)}

THE TEST TO APPLY
Imagine this graphic reprinted in pure greyscale.
- If a reader would lose a FACT ABOUT DATA — which bars are gains, which rows
  failed, which region is high risk — then colour is carrying information.
  Answer is_color_semantic = true.
- If the only thing they would lose is knowing what colour an object happens to
  be, colour is NOT carrying information. Answer is_color_semantic = false.

Describing an object's colour is not the same as encoding data in colour.
"The person in the red shirt" tells you about a shirt, not about a value.
A photo of people in red and green shirts stays false even if the caption lists
the colours. A logo, avatar, product shot, map photo or decorative illustration
is false. If visual_type is a photograph or decorative image, is_color_semantic
MUST be false and mappings MUST be empty.

HOW TO DECIDE
- Read the legend, axis labels, captions, headings and any numbers in the image.
- A colour only counts as meaningful if the page tells you what it stands for,
  or the chart type makes it unambiguous (e.g. red/green candles on a price chart).
- NEVER assume a colour's meaning from the colour alone. Green is "increase" on a
  financial chart, "correct" on a quiz, "low risk" on a risk gauge, and "heavy load"
  on some traffic maps. Red is not automatically bad. Decide from THIS page only.
- A meaning must be a data value or category ("price increase", "failed",
  "medium risk"), never a description of the picture ("the second person").
- If the page gives you no basis to say what a colour means, say so with a low
  confidence rather than inventing a plausible-sounding meaning.

WHAT TO RETURN (as JSON)
- evidence: the specific thing you saw that decided it — quote the legend or label
  if there is one. One short sentence.
- is_color_semantic: true only if colour genuinely encodes information here.
- visual_type: a short slug, e.g. financial_chart, status_dashboard, quiz_results,
  risk_gauge, bar_chart, heatmap, photograph, decorative_image.
- confidence: 0.0-1.0 for the overall judgement. Use above 0.85 only when the page
  states the meaning outright. Use below 0.6 when you are guessing.
- mappings: one entry per colour that carries meaning. Leave the list empty when
  is_color_semantic is false.
  - meaning: what that colour stands for here, in 1-3 words (e.g. "price increase",
    "failed", "medium risk").
  - symbol: one short non-colour glyph that conveys that meaning without colour.
    Pick whatever fits best, for example an arrow for direction (up, down), a tick
    or cross for pass/fail, a warning sign for caution, an hourglass for pending.
  - confidence: 0.0-1.0 for that specific colour.`;
}

module.exports = { buildPrompt, buildContextBlock, clean, FIELD_LIMITS };
