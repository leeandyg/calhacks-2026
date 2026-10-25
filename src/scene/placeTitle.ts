// A short, human title for a saved place, derived on-device from the painted environment's
// description (the art store's env.concept). No AI call, so it also works in the offline demo.

const ARTICLES = new Set(['a', 'an', 'the']);
const STOP_WORDS = new Set(['at', 'in', 'on', 'of', 'with', 'and', 'the', 'a', 'an', 'to', 'for']);
const MAX_WORDS = 4;
const MAX_CHARS = 28;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** A short title from the environment description, falling back to the first source label. */
export function placeTitle(concept: string | undefined, objects: { label: string }[]): string {
  const clause = (concept ?? '').split(/[.,;\n—]/)[0].trim();
  const raw = clause.split(/\s+/).filter(Boolean);
  if (raw[0] && ARTICLES.has(raw[0].toLowerCase())) raw.shift();
  const words: string[] = [];
  for (const word of raw) {
    if (words.length >= MAX_WORDS) break;
    if (words.length > 0 && STOP_WORDS.has(word.toLowerCase())) break;
    words.push(word);
  }
  let title = '';
  for (const word of words.map(titleCase)) {
    const next = title ? `${title} ${word}` : word;
    if (next.length > MAX_CHARS) break;
    title = next;
  }
  if (!title && words[0]) title = titleCase(words[0]).slice(0, MAX_CHARS);
  return title || objects[0]?.label || 'Untitled place';
}
