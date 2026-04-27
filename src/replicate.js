// ============================================================================
//  SONDER — REPLICATE PROXY (feeling extraction)
// ============================================================================
//  Uses the ITP-IMA Replicate proxy so we can call from the browser without
//  exposing an API key (and without CORS pain).
//
//  Model: openai/gpt-5-structured  → returns clean json_output we can trust.
//
//  Single export:
//     extractFeelings(text) → string[]  (top 10 lowercased feelings)
// ============================================================================

const PROXY = 'https://itp-ima-replicate-proxy.web.app/api/create_n_get';

const FEELING_CACHE = new Map();   // text → string[]   (in-memory only)

const PROMPT_TEMPLATE = (text) => `Read this short personal note about a music memory:

"${text}"

Return the TOP 10 feelings the writer was experiencing in that moment, ordered most → least dominant. Use single-word lowercase feelings only (e.g. "nostalgic", "hopeful", "heartbroken", "energized", "lonely", "rage", "calm", "euphoric", "melancholy", "tender"). No duplicates, no punctuation.

Format strictly as JSON:
{
  "feelings": ["feeling1", "feeling2", "feeling3", "feeling4", "feeling5", "feeling6", "feeling7", "feeling8", "feeling9", "feeling10"]
}`;

export async function extractFeelings(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (FEELING_CACHE.has(trimmed)) return FEELING_CACHE.get(trimmed);

  const body = {
    model: 'openai/gpt-5-structured',
    input: { prompt: PROMPT_TEMPLATE(trimmed) }
  };

  let res;
  try {
    res = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.warn('[replicate] network error:', e.message);
    return [];
  }
  if (!res.ok) {
    console.warn('[replicate] non-OK:', res.status);
    return [];
  }
  let json;
  try { json = await res.json(); } catch { return []; }

  // openai/gpt-5-structured returns either { output: { json_output: {...} } }
  // or { output: '<raw text>' }. Handle both.
  let payload = json?.output?.json_output ?? json?.output ?? null;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }

  let feelings = payload?.feelings;
  // Some calls return an array directly.
  if (!feelings && Array.isArray(payload)) feelings = payload;
  if (!Array.isArray(feelings)) {
    console.warn('[replicate] unexpected payload shape:', payload);
    return [];
  }

  feelings = feelings
    .map((f) => String(f || '').toLowerCase().trim().replace(/[^a-z\- ]/g, ''))
    .filter(Boolean)
    .slice(0, 10);

  // dedupe while preserving order
  const seen = new Set();
  const unique = [];
  for (const f of feelings) {
    if (seen.has(f)) continue;
    seen.add(f);
    unique.push(f);
  }

  FEELING_CACHE.set(trimmed, unique);
  return unique;
}


// ============================================================================
//  generateImage(prompt) — flux-schnell via the same proxy.
// ============================================================================
//  Used by the demo seed for evocative "where the song was heard" photos.
//  Returns an https URL on success, null on failure (caller falls back).
// ============================================================================
const IMAGE_CACHE = new Map();

export async function generateImage(prompt) {
  const trimmed = (prompt || '').trim();
  if (!trimmed) return null;
  if (IMAGE_CACHE.has(trimmed)) return IMAGE_CACHE.get(trimmed);

  const body = {
    model: 'black-forest-labs/flux-schnell',
    input: {
      prompt: trimmed,
      num_outputs: 1,
      aspect_ratio: '1:1',
      output_format: 'jpg',
      output_quality: 80
    }
  };

  let res;
  try {
    res = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) { console.warn('[replicate-img] network error:', e.message); return null; }
  if (!res.ok) { console.warn('[replicate-img] non-OK:', res.status); return null; }

  let json;
  try { json = await res.json(); } catch { return null; }

  // flux-schnell returns output: 'url' or output: ['url', ...].
  let out = json?.output;
  if (Array.isArray(out)) out = out[0];
  if (typeof out !== 'string' || !out.startsWith('http')) {
    console.warn('[replicate-img] unexpected payload:', json);
    return null;
  }
  IMAGE_CACHE.set(trimmed, out);
  return out;
}
