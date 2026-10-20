// Port of Android WordSearch: exact, word-prefix, inflected forms, then typo suggestions.
export const norm = (text) =>
  text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[’`]/g, "'")
    .replace(/[?!.,…"«»:;()/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const slots = new Set([
  'someone',
  'somebody',
  'something',
  'your',
  "one's",
  "someone's",
  'yourself',
  'oneself',
]);
const pronouns = new Set([
  'me',
  'you',
  'him',
  'her',
  'us',
  'them',
  'it',
  'my',
  'your',
  'his',
  'its',
  'our',
  'their',
  'myself',
  'yourself',
  'himself',
  'herself',
  'ourselves',
  'themselves',
  'someone',
  'somebody',
  'something',
  "someone's",
  "one's",
  'oneself',
]);
const doubled = /([bdfgklmnprtvz])\1$/;
export function lemmas(word, irregular = {}) {
  const result = new Set([word, ...(irregular[word] || [])]);
  const add = (base) => {
    if (base.length > 1) result.add(base);
  };
  if (word.endsWith('ies')) add(word.slice(0, -3) + 'y');
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1));
  if (word.endsWith('ied')) add(word.slice(0, -3) + 'y');
  for (const ending of ['ed', 'ing'])
    if (word.endsWith(ending)) {
      const base = word.slice(0, -ending.length);
      add(base);
      add(base + 'e');
      if (doubled.test(base)) add(base.slice(0, -1));
      if (ending === 'ing' && base.endsWith('y')) add(base.slice(0, -1) + 'ie');
    }
  return result;
}
export function distance(a, b, limit = Infinity) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
export function createSearch(cards, forms) {
  const irregular = {};
  forms.split(',').forEach((entry) => {
    const [base, ...variants] = entry.split(':');
    variants
      .filter((v) => v !== base)
      .forEach((v) => {
        (irregular[v] ||= []).push(base);
      });
  });
  const lines = cards.map((card) => ({
    card,
    head: norm(card.headword),
    words: norm(card.headword).split(' '),
    ru: norm(card.shortRu),
  }));
  return {
    find(query) {
      const q = norm(query);
      if (!q) return [];
      const tokens = q.split(' '),
        bases = tokens.map((t) => lemmas(t, irregular));
      const found = [];
      for (const line of lines) {
        if (line.head === q) {
          found.push({ card: line.card, rank: 0, why: [] });
          continue;
        }
        if ([line.head, line.ru].some((t) => t.startsWith(q) || t.includes(' ' + q))) {
          found.push({ card: line.card, rank: 1, why: [] });
          continue;
        }
        for (let start = 0; start <= line.words.length - tokens.length; start++) {
          const why = [];
          const fits = tokens.every((token, k) => {
            const head = line.words[start + k];
            if (token === head) return true;
            if ((slots.has(head) && pronouns.has(token)) || bases[k].has(head)) {
              why.push(`${token} → ${head}`);
              return true;
            }
            return k === tokens.length - 1 && token.length >= 2 && head.startsWith(token);
          });
          if (fits && why.length) {
            found.push({ card: line.card, rank: 2, why });
            break;
          }
        }
      }
      return found.sort(
        (a, b) =>
          a.rank - b.rank || a.card.headword.toLowerCase().localeCompare(b.card.headword.toLowerCase()),
      );
    },
    suggest(query) {
      const q = norm(query);
      if (!/[a-z]/.test(q)) return [];
      const limit = q.length <= 4 ? 1 : 2,
        best = new Map();
      for (const line of lines) {
        let cost = distance(q, line.head, limit);
        if (!q.includes(' '))
          line.words
            .filter((w) => w.length > 3)
            .forEach((w) => {
              cost = Math.min(cost, distance(q, w, limit));
            });
        if (cost <= limit && cost < (best.get(line.card.headword) ?? Infinity))
          best.set(line.card.headword, cost);
      }
      return [...best]
        .sort((a, b) => a[1] - b[1])
        .slice(0, 3)
        .map(([word]) => word);
    },
  };
}
