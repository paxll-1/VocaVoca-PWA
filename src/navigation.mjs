// Browser history changes navigation only, never restores an older learning snapshot.
export function locationOf(state) {
  return {
    view: state.view,
    selectedSetId: state.selectedSetId,
    themeId: state.themeId,
    cardId: state.cursors[state.selectedSetId] || null,
    cardMode: state.cardMode,
    feedPosition: state.cardMode === 'feed' ? state.feed?.position : null,
    cardReturn: state.cardReturn,
  };
}
export function tabOf(view) {
  if (view.startsWith('profile')) return 'profile';
  if (['training', 'session', 'trainSets'].includes(view)) return 'training';
  if (['sets', 'theme', 'set', 'triage', 'card'].includes(view)) return 'sets';
  return 'home';
}
export function applyLocation(state, location, catalog, views) {
  if (!location || !views.includes(location.view)) throw Error('Недоступная страница истории');
  state.view = location.view;
  if (location.selectedSetId && catalog.bySet[location.selectedSetId])
    state.selectedSetId = location.selectedSetId;
  if (location.cardId && catalog.byId[location.cardId]) {
    state.selectedSetId = catalog.byId[location.cardId].set;
    state.cursors[state.selectedSetId] = location.cardId;
  }
  state.themeId = location.themeId || null;
  state.cardMode = location.cardMode === 'feed' && state.feed ? 'feed' : 'browse';
  if (
    state.cardMode === 'feed' &&
    Number.isInteger(location.feedPosition) &&
    location.feedPosition >= 0 &&
    location.feedPosition < state.feed.history.length
  ) {
    state.feed.position = location.feedPosition;
    state.feed.finished = false;
  }
  state.cardReturn = location.cardReturn || null;
}
