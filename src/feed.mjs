// Android CardFeed: persisted history; new passes shuffle and avoid a repeated boundary card.
export function shuffleIds(ids, random = Math.random) {
  const queue = [...ids];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue;
}
export function feedNext(feed, ids, eligible, random = Math.random) {
  if (feed.position < feed.history.length - 1)
    return { ...feed, position: feed.position + 1, finished: false };
  let queue = feed.remaining.filter((id) => ids.includes(id) && eligible(id));
  if (!queue.length) {
    queue = shuffleIds(ids.filter(eligible), random);
    if (!queue.length) return { ...feed, finished: true };
    if (queue.length > 1 && queue[0] === feed.history[feed.position]) queue.push(queue.shift());
  }
  return {
    ...feed,
    history: [...feed.history, queue[0]],
    position: feed.position + 1,
    remaining: queue.slice(1),
    finished: false,
  };
}
export function scopeIds(state, catalog, scope = state.feed?.scope || '') {
  if (scope.startsWith('set:')) return catalog.bySet[scope.slice(4)]?.cardIds || [];
  return catalog.sets
    .filter((s) =>
      scope.startsWith('theme:') ? s.themeId === scope.slice(6) : s.level === state.settings.level,
    )
    .flatMap((s) => s.cardIds);
}

export const catalogKey = (catalog) => catalog.provenance?.sha256 || catalog.version;
export function reconcileFeed(feed, ids, catalogVersion, random = Math.random) {
  if (!feed || feed.catalogVersion === catalogVersion) return feed;
  const allowed = new Set(ids);
  const valid = [...feed.history, ...feed.remaining].every((id) => allowed.has(id));
  if (!valid) {
    const queue = shuffleIds(ids, random);
    return {
      ...feed,
      catalogVersion,
      history: queue.slice(0, 1),
      position: 0,
      remaining: queue.slice(1),
      finished: !queue.length,
    };
  }
  const seen = new Set([...feed.history, ...feed.remaining]);
  const added = shuffleIds(
    ids.filter((id) => !seen.has(id)),
    random,
  );
  if (!feed.history.length && added.length)
    return {
      ...feed,
      catalogVersion,
      history: added.slice(0, 1),
      position: 0,
      remaining: [...feed.remaining, ...added.slice(1)],
      finished: false,
    };
  return {
    ...feed,
    catalogVersion,
    remaining: [...feed.remaining, ...added],
    finished: feed.finished && !added.length,
  };
}
