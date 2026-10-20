// The only content source is ../../content/catalog. No hand-maintained word list.
export function verifiedIpa(card) {
  const v = card.verification;
  return v?.editorialStatus === 'reviewed' &&
    v.checks?.includes('pronunciation') &&
    v.pronunciationReferences?.length > 0
    ? card.pronunciation?.ipaUs || ''
    : '';
}

export function projectCatalog(root, sourceSets) {
  const setIds = root.themes.flatMap((t) => t.sets.map((s) => s.id)).filter((id) => sourceSets[id]?.length);
  const sets = setIds.map((id) => {
    const theme = root.themes.find((t) => t.sets.some((s) => s.id === id));
    const meta = theme?.sets.find((s) => s.id === id);
    if (!meta || !Array.isArray(sourceSets[id]) || !sourceSets[id].length) throw Error(`Нет набора ${id}`);
    return { ...meta, themeId: theme.id, level: theme.level, cardIds: sourceSets[id].map((c) => c.id) };
  });
  const cards = setIds.flatMap((id) => sourceSets[id]);
  const ids = new Set();
  for (const card of cards) {
    if (!card.id || ids.has(card.id) || !setIds.includes(card.set)) throw Error('Некорректный ID карточки');
    ids.add(card.id);
    if (card.verification?.editorialStatus !== 'reviewed') throw Error(`Не проверена: ${card.id}`);
    for (const key of ['headword', 'explanationEn', 'explanationRu', 'shortRu']) {
      if (typeof card[key] !== 'string' || !card[key].trim()) throw Error(`Нет ${key}: ${card.id}`);
    }
    if (card.examples?.length !== 3 || card.examples.some((e) => !e.en || !e.ru))
      throw Error(`Примеры: ${card.id}`);
    if (card.questions?.length !== 2) throw Error(`Вопросы: ${card.id}`);
    for (const direction of ['en-to-ru', 'ru-to-en']) {
      const questions = card.questions.filter((q) => q.direction === direction);
      const q = questions[0];
      if (
        questions.length !== 1 ||
        !q.id ||
        ids.has(q.id) ||
        !q.context ||
        !q.prompt ||
        !q.explanationRu ||
        q.options?.length !== 4 ||
        new Set(q.options.map((o) => o.text)).size !== 4 ||
        !q.options.some((o) => o.id === q.correctOptionId)
      )
        throw Error(`Вопрос: ${card.id}/${direction}`);
      ids.add(q.id);
      for (const o of q.options) {
        if (!o.id || !o.text || ids.has(o.id)) throw Error(`Вариант: ${q.id}`);
        ids.add(o.id);
      }
    }
  }
  return {
    schema: 1,
    version: root.catalogVersion,
    themes: root.themes.filter((t) => sets.some((s) => s.themeId === t.id)),
    sets,
    cards,
  };
}

export function indexCatalog(data) {
  return {
    ...data,
    byId: Object.fromEntries(data.cards.map((c) => [c.id, c])),
    bySet: Object.fromEntries(data.sets.map((s) => [s.id, s])),
  };
}
