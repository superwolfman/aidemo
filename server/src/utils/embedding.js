const DIMENSIONS = 96;

export function tokenize(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function embedText(text) {
  const vector = Array.from({ length: DIMENSIONS }, () => 0);
  const tokens = tokenize(text);

  tokens.forEach((token) => {
    const index = hashToken(token) % DIMENSIONS;
    vector[index] += 1 + Math.min(token.length, 12) / 12;
  });

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

export function keywordOverlap(query, content) {
  const queryTokens = new Set(tokenize(query));
  if (!queryTokens.size) return 0;
  const contentTokens = new Set(tokenize(content));
  let hits = 0;
  queryTokens.forEach((token) => {
    if (contentTokens.has(token)) hits += 1;
  });
  return hits / queryTokens.size;
}

export function splitIntoChunks(text, size = 560, overlap = 80) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let buffer = '';

  paragraphs.forEach((paragraph) => {
    const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (next.length <= size) {
      buffer = next;
      return;
    }

    if (buffer) chunks.push(buffer);
    if (paragraph.length <= size) {
      buffer = paragraph;
      return;
    }

    for (let start = 0; start < paragraph.length; start += size - overlap) {
      chunks.push(paragraph.slice(start, start + size));
    }
    buffer = '';
  });

  if (buffer) chunks.push(buffer);
  return chunks;
}
