// Port of Android ReviewSchedule v2, StudyDay, AnswerKind and ReviewRepository.
// Dates deliberately use local calendar arithmetic, including DST; day starts at 04:00.
import { DEFAULT_SETTINGS, validSettings } from './settings.mjs';
import { feedNext, scopeIds, shuffleIds, reconcileFeed, catalogKey } from './feed.mjs';
import { locationOf, tabOf, applyLocation } from './navigation.mjs';
export const VIEWS = [
  'home',
  'sets',
  'theme',
  'set',
  'triage',
  'card',
  'scope',
  'training',
  'trainSets',
  'session',
  'profile',
  'profileLearning',
  'profileLook',
  'profileCopy',
  'profileReminder',
  'profileHow',
  'profileAbout',
];
export const PAUSES = [1, 3, 7, 14, 30, 60, 120, 240];
export function studyStart(time, days = 0) {
  const date = new Date(time);
  const beforeFour = date.getHours() < 4;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - Number(beforeFour) + days,
    4,
  ).getTime();
}
export const isDue = (dueAt, now) => dueAt < studyStart(now, 1);
export function after(stage, correct, now) {
  if (!Number.isInteger(stage) || stage < 0 || stage > 8) throw Error('Неверная ступень');
  const next = correct ? Math.min(stage + 1, 8) : 1;
  return { stage: next, dueAt: studyStart(now, PAUSES[next - 1]) };
}
export const kindOf = (word) => (word.solid || word.stage >= 3 ? 'recall' : 'choice');
export const wordState = (state, id) =>
  state.words[id]?.status === 'inactive' ? 'new' : state.words[id]?.status || 'new';
export function tally(state, ids) {
  const result = { new: 0, learning: 0, solid: 0, known: 0 };
  ids.forEach((id) => {
    const w = state.words[id];
    result[w?.status === 'learning' && w.solid ? 'solid' : wordState(state, id)]++;
  });
  return result;
}
export function eligible(state, catalog, now, mode = 'due', setId = null) {
  return Object.values(state.words)
    .filter(
      (w) =>
        w.status === 'learning' &&
        catalog.byId[w.cardId] &&
        (setId
          ? catalog.byId[w.cardId].set === setId
          : mode === 'practice'
            ? !isDue(w.dueAt, now)
            : isDue(w.dueAt, now)),
    )
    .sort(
      (a, b) =>
        a.dueAt - b.dueAt ||
        a.selectedAt - b.selectedAt ||
        (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0),
    );
}
export function initialState() {
  return {
    schema: 2,
    revision: 0,
    onboarded: false,
    selectedSetId: null,
    cursors: {},
    view: 'home',
    words: {},
    answers: [],
    session: null,
    sessionArchive: [],
    settings: { ...DEFAULT_SETTINGS },
    feed: null,
    cardMode: 'browse',
    dictionary: {
      tab: 'themes',
      level: 'beginner',
      query: '',
      state: '',
      type: '',
      filterLevel: '',
      folded: [],
    },
    themeId: null,
    undo: null,
    cardReturn: null,
    lastCopyAt: null,
    tabRoutes: {},
  };
}
function shuffled(values, random) {
  const result = structuredClone(values);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export const currentAttempt = (state) => state.session?.attempts[state.session.position];
export function normalize(state, catalog) {
  const session = state.session;
  if (!session || session.completed) return;
  for (const a of session.attempts) {
    const word = state.words[a.cardId];
    if (
      a.answer === null &&
      (!catalog.byId[a.cardId] || word?.status !== 'learning' || word.enrollment !== a.enrollment)
    )
      a.skipped = true;
  }
  while (session.attempts[session.position]?.skipped) session.position++;
  if (session.position >= session.attempts.length) session.completed = true;
}

// Called inside one IndexedDB read/write transaction; UI never updates optimistically.
export function reduce(original, command, catalog, now = Date.now(), random = Math.random) {
  const state = structuredClone(original);
  state.feed = reconcileFeed(state.feed, scopeIds(state, catalog), catalogKey(catalog), random);
  if (state.feed && state.cardMode === 'feed') {
    const current = catalog.byId[state.feed.history[state.feed.position]];
    if (current) {
      state.selectedSetId = current.set;
      state.cursors[current.set] = current.id;
    }
  }
  normalize(state, catalog);
  const card = command.cardId && catalog.byId[command.cardId];
  switch (command.type) {
    case 'navigate':
      if (!VIEWS.includes(command.view)) throw Error('Неизвестный экран');
      if (command.tab === 'true') {
        (state.tabRoutes ||= {})[tabOf(state.view)] = locationOf(state);
        // Tapping the already selected tab returns to its root.
        const saved = state.tabRoutes[command.view];
        if (saved && tabOf(state.view) !== command.view) applyLocation(state, saved, catalog, VIEWS);
        else state.view = command.view;
      } else state.view = command.view;
      break;
    case 'history':
      applyLocation(state, command.location, catalog, VIEWS);
      break;
    case 'showMine':
      state.onboarded = true;
      state.view = 'sets';
      state.dictionary.tab = 'mine';
      break;
    case 'selectSet':
      if (!catalog.bySet[command.setId]) throw Error('Набор недоступен');
      state.onboarded = true;
      state.selectedSetId = command.setId;
      state.themeId = catalog.bySet[command.setId].themeId;
      state.cardMode = 'browse';
      state.cardReturn = null;
      state.cursors[command.setId] ||= catalog.bySet[command.setId].cardIds[0];
      state.view = 'set';
      break;
    case 'openCard':
      if (!card) throw Error('Карточка недоступна');
      state.onboarded = true;
      state.selectedSetId = card.set;
      state.cardReturn = {
        view: state.view,
        setId: original.selectedSetId,
        cardId: original.cursors[original.selectedSetId],
        cardMode: original.cardMode,
        parent: original.view === 'card' ? original.cardReturn : null,
      };
      state.cardMode = 'browse';
      state.cursors[card.set] = card.id;
      state.view = 'card';
      break;
    case 'browseMove':
      if (!card) throw Error('Карточка недоступна');
      state.selectedSetId = card.set;
      state.cursors[card.set] = card.id;
      break;
    case 'learn':
    case 'know': {
      if (!card) throw Error('Карточка недоступна');
      const old = state.words[card.id];
      if (command.type === 'learn' && old?.status === 'learning') return original;
      state.words[card.id] =
        command.type === 'learn'
          ? {
              cardId: card.id,
              status: 'learning',
              stage: 0,
              dueAt: now,
              selectedAt: now,
              updatedAt: now,
              enrollment: (old?.enrollment || 0) + 1,
              solid: false,
            }
          : { ...(old || {}), cardId: card.id, status: 'known', knownAt: now, updatedAt: now };
      if (command.type === 'know') {
        const fromFeed =
          state.cardMode === 'feed' &&
          state.view === 'card' &&
          state.feed?.history[state.feed.position] === card.id;
        state.undo = {
          cardId: card.id,
          previous: old || null,
          feed: fromFeed ? structuredClone(state.feed) : null,
        };
        if (fromFeed) {
          state.feed = feedNext(
            state.feed,
            scopeIds(state, catalog),
            (id) => wordState(state, id) === 'new',
            random,
          );
          const next = state.feed.history[state.feed.position];
          if (catalog.byId[next]) {
            state.selectedSetId = catalog.byId[next].set;
            state.cursors[state.selectedSetId] = next;
          }
        }
      }
      normalize(state, catalog);
      break;
    }
    case 'unknow':
    case 'remove': {
      const old = state.words[command.cardId];
      if (old) old.status = 'inactive';
      state.undo = null;
      normalize(state, catalog);
      break;
    }
    case 'undoKnow': {
      if (state.undo && state.words[state.undo.cardId]?.status === 'known') {
        if (state.undo.previous) state.words[state.undo.cardId] = state.undo.previous;
        else delete state.words[state.undo.cardId];
        if (state.undo.feed && catalog.byId[state.undo.cardId]) {
          state.feed = state.undo.feed;
          state.cardMode = 'feed';
          state.selectedSetId = catalog.byId[state.undo.cardId].set;
          state.cursors[state.selectedSetId] = state.undo.cardId;
          state.view = 'card';
        }
      }
      state.undo = null;
      break;
    }
    case 'settings': {
      const settings = { ...state.settings, [command.key]: command.value };
      if (!validSettings(settings)) throw Error('Неверная настройка');
      state.settings = settings;
      if (command.key === 'ribbonColor') state.settings.dailyColor = false;
      if (command.key === 'level') {
        state.dictionary.level = settings.level;
        state.feed = null;
        state.cardMode = 'browse';
      }
      break;
    }
    case 'dictionary':
      if (!['tab', 'level', 'query', 'state', 'type', 'filterLevel', 'folded'].includes(command.key))
        throw Error('Неверный фильтр');
      state.dictionary[command.key] = command.value;
      state.view = 'sets';
      break;
    case 'theme':
      if (!catalog.themes.some((t) => t.id === command.themeId)) throw Error('Тема недоступна');
      state.themeId = command.themeId;
      state.view = 'theme';
      break;
    case 'scopeLevel':
      if (!['beginner', 'middle'].includes(command.value)) throw Error('Неизвестный уровень');
      state.scopeLevel = command.value;
      break;
    case 'startFeed': {
      state.onboarded = true;
      const scope = command.scope ?? state.feed?.scope ?? '';
      const ids = scopeIds(state, catalog, scope);
      const fresh = ids.filter((id) => wordState(state, id) === 'new');
      const browseAll = command.browseAll === 'true';
      const queue = shuffleIds(browseAll ? ids : fresh, random);
      state.feed = queue.length
        ? {
            scope,
            catalogVersion: catalogKey(catalog),
            history: [queue[0]],
            position: 0,
            remaining: queue.slice(1),
            finished: false,
            browseAll,
          }
        : {
            scope,
            catalogVersion: catalogKey(catalog),
            history: [],
            position: 0,
            remaining: [],
            finished: true,
            browseAll: false,
          };
      state.cardMode = 'feed';
      state.cardReturn = null;
      state.view = 'card';
      if (queue.length) {
        state.selectedSetId = catalog.byId[queue[0]].set;
        state.cursors[state.selectedSetId] = queue[0];
      }
      break;
    }
    case 'feedMove': {
      if (!state.feed) break;
      const ids = scopeIds(state, catalog);
      if (command.delta < 0)
        state.feed = { ...state.feed, position: Math.max(0, state.feed.position - 1), finished: false };
      else
        state.feed = feedNext(
          state.feed,
          ids,
          (id) => state.feed.browseAll || wordState(state, id) === 'new',
          random,
        );
      const id = state.feed.history[state.feed.position];
      if (catalog.byId[id]) {
        state.selectedSetId = catalog.byId[id].set;
        state.cursors[state.selectedSetId] = id;
      }
      break;
    }
    case 'cardBack': {
      const previous = state.cardReturn;
      state.view = previous?.view || 'set';
      if (previous?.setId) state.selectedSetId = previous.setId;
      if (previous?.cardId) state.cursors[state.selectedSetId] = previous.cardId;
      state.cardMode = previous?.cardMode || 'browse';
      state.cardReturn = previous?.parent || null;
      break;
    }
    case 'copySaved':
      state.lastCopyAt = now;
      break;
    case 'start': {
      if (state.session && !state.session.completed) {
        state.view = 'session';
        break;
      }
      const words = eligible(state, catalog, now, command.mode, command.setId).slice(0, 5);
      if (!words.length) return original;
      const sessionId = `session-${state.revision + 1}-${now}`;
      if (state.session) (state.sessionArchive ||= []).push(state.session);
      state.session = {
        id: sessionId,
        algorithmVersion: 2,
        startedAt: now,
        mode: command.mode || 'due',
        setId: command.setId || null,
        position: 0,
        completed: false,
        attempts: words.map((w, index) => {
          const kind = kindOf(w);
          const last = state.answers.findLast((a) => a.cardId === w.cardId && !a.retry);
          const direction =
            kind === 'recall'
              ? 'ru-to-en'
              : last
                ? last.direction === 'en-to-ru'
                  ? 'ru-to-en'
                  : 'en-to-ru'
                : index % 2
                  ? 'ru-to-en'
                  : 'en-to-ru';
          const question = structuredClone(
            catalog.byId[w.cardId].questions.find((q) => q.direction === direction),
          );
          if (kind === 'choice') question.options = shuffled(question.options, random);
          return {
            id: `${sessionId}-${index}`,
            cardId: w.cardId,
            enrollment: w.enrollment,
            kind,
            question,
            retry: false,
            skipped: false,
            revealed: false,
            answer: null,
          };
        }),
      };
      state.view = 'session';
      break;
    }
    case 'reveal': {
      const a = currentAttempt(state);
      if (a?.id === command.attemptId && a.kind === 'recall' && !state.session.completed) a.revealed = true;
      break;
    }
    case 'answer': {
      const a = currentAttempt(state);
      if (!a || state.session.completed || a.id !== command.attemptId || a.answer !== null || a.skipped)
        return original;
      if (
        a.kind === 'recall'
          ? !a.revealed || !['recalled', 'forgot'].includes(command.optionId)
          : !a.question.options.some((o) => o.id === command.optionId)
      )
        throw Error('Ответ недоступен');
      const correct =
        a.kind === 'recall'
          ? command.optionId === 'recalled'
          : command.optionId === a.question.correctOptionId;
      const w = state.words[a.cardId];
      const scheduled = !a.retry && isDue(w.dueAt, now);
      const event = {
        attemptId: a.id,
        sessionId: state.session.id,
        cardId: a.cardId,
        enrollment: a.enrollment,
        questionId: a.question.id,
        direction: a.question.direction,
        kind: a.kind,
        optionId: command.optionId,
        correct,
        retry: a.retry,
        scheduled,
        answeredAt: now,
        revision: state.revision + 1,
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      a.answer = event;
      state.answers.push(event);
      if (scheduled) {
        const solid = correct && a.kind === 'recall' && (w.solid || w.stage >= 5);
        Object.assign(w, after(w.stage, correct, now), { solid, updatedAt: now });
      }
      if (!a.retry && !correct) {
        const retry = structuredClone(a);
        Object.assign(retry, {
          id: `${state.session.id}-${state.session.attempts.length}`,
          retry: true,
          revealed: false,
          answer: null,
        });
        if (a.kind === 'choice') {
          retry.question.options = shuffled(a.question.options, random);
          if (retry.question.options.every((o, i) => o.id === a.question.options[i].id))
            retry.question.options.push(retry.question.options.shift());
        }
        state.session.attempts.push(retry);
      }
      break;
    }
    case 'advance': {
      const a = currentAttempt(state);
      if (!a || state.session.completed || a.id !== command.attemptId || a.answer === null) return original;
      state.session.position++;
      normalize(state, catalog);
      break;
    }
    case 'reconcile':
      if (JSON.stringify(state) === JSON.stringify(original)) return original;
      break;
    default:
      throw Error('Неизвестное действие');
  }
  state.revision++;
  return state;
}
