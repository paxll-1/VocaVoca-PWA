import { initialState, VIEWS } from './learning.mjs';
import { validSettings } from './settings.mjs';
import { normPraise } from './day.mjs';
const STORE = 'state';
const KEY = 'current';
const stableId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value);
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const validEvent = (a) =>
  record(a) &&
  stableId(a.cardId) &&
  stableId(a.attemptId) &&
  stableId(a.sessionId) &&
  stableId(a.questionId) &&
  stableId(a.optionId) &&
  ['en-to-ru', 'ru-to-en'].includes(a.direction) &&
  ['choice', 'recall'].includes(a.kind) &&
  Number.isFinite(a.answeredAt) &&
  a.answeredAt >= 0 &&
  typeof a.correct === 'boolean' &&
  typeof a.retry === 'boolean' &&
  typeof a.scheduled === 'boolean';
function validAttempt(a) {
  const q = a?.question;
  return (
    record(a) &&
    stableId(a.id) &&
    stableId(a.cardId) &&
    Number.isInteger(a.enrollment) &&
    a.enrollment > 0 &&
    ['choice', 'recall'].includes(a.kind) &&
    typeof a.retry === 'boolean' &&
    typeof a.skipped === 'boolean' &&
    typeof a.revealed === 'boolean' &&
    record(q) &&
    stableId(q.id) &&
    ['en-to-ru', 'ru-to-en'].includes(q.direction) &&
    ['context', 'prompt', 'explanationRu'].every((k) => typeof q[k] === 'string' && q[k].length > 0) &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    q.options.every((o) => stableId(o.id) && typeof o.text === 'string' && o.text.length > 0) &&
    new Set(q.options.map((o) => o.id)).size === 4 &&
    q.options.some((o) => o.id === q.correctOptionId) &&
    (a.answer === null ||
      (validEvent(a.answer) &&
        a.answer.attemptId === a.id &&
        a.answer.cardId === a.cardId &&
        a.answer.questionId === q.id))
  );
}
export function validateState(value) {
  if (value?.schema === 1) value = { ...initialState(), ...value, schema: 2 };
  if (value?.schema === 2 && value.sessionArchive === undefined) value = { ...value, sessionArchive: [] };
  if (
    !value ||
    value.schema !== 2 ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.onboarded !== 'boolean' ||
    !record(value.words) ||
    !record(value.cursors) ||
    !Array.isArray(value.answers) ||
    !VIEWS.includes(value.view) ||
    !validSettings(value.settings) ||
    !value.dictionary ||
    typeof value.dictionary.query !== 'string'
  ) {
    throw Error('Сохранение повреждено или создано другой версией. Оно оставлено без изменений.');
  }
  for (const [id, w] of Object.entries(value.words)) {
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(id) ||
      id !== w.cardId ||
      !['known', 'learning', 'inactive'].includes(w.status) ||
      (w.status === 'learning' &&
        (!Number.isInteger(w.stage) ||
          w.stage < 0 ||
          w.stage > 8 ||
          !Number.isFinite(w.dueAt) ||
          !Number.isFinite(w.selectedAt) ||
          !Number.isInteger(w.enrollment)))
    ) {
      throw Error('Не удалось прочитать прогресс. Сохранение оставлено без изменений.');
    }
  }
  const sessions = [...(value.sessionArchive || []), ...(value.session ? [value.session] : [])];
  if (
    !Array.isArray(value.sessionArchive) ||
    sessions.some(
      (session) =>
        !stableId(session.id) ||
        typeof session.completed !== 'boolean' ||
        !Number.isSafeInteger(session.startedAt) ||
        !Array.isArray(session.attempts) ||
        !Number.isInteger(session.position) ||
        session.position < 0 ||
        session.position > session.attempts.length ||
        session.attempts.some((a) => !validAttempt(a) || (a.answer && a.answer.sessionId !== session.id)) ||
        new Set(session.attempts.map((a) => a.id)).size !== session.attempts.length,
    ) ||
    value.sessionArchive.some((s) => !s.completed) ||
    new Set(sessions.map((s) => s.id)).size !== sessions.length
  ) {
    throw Error('Не удалось прочитать тренировку. Сохранение оставлено без изменений.');
  }
  if (
    value.answers.some((a) => !validEvent(a)) ||
    new Set(value.answers.map((a) => a.attemptId)).size !== value.answers.length
  ) {
    throw Error('История ответов повреждена. Сохранение оставлено без изменений.');
  }
  if (
    !Array.isArray(value.dictionary.folded) ||
    (value.feed &&
      (!Array.isArray(value.feed.history) ||
        !Array.isArray(value.feed.remaining) ||
        !Number.isInteger(value.feed.position) ||
        value.feed.position < 0 ||
        value.feed.position > Math.max(0, value.feed.history.length - 1)))
  )
    throw Error('Сохранённая навигация повреждена.');
  return value;
}
export function openStore(factory = globalThis.indexedDB, name = 'vocavoca-pwa-pilot') {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(Error('Браузер не предоставил локальное хранилище.'));
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Закройте другие вкладки VocaVoca и повторите открытие.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      const transact = (mode, change, backup = false) =>
        new Promise((ok, fail) => {
          const tx = db.transaction(STORE, mode);
          const store = tx.objectStore(STORE);
          let result;
          let failure;
          tx.oncomplete = () => ok(result);
          tx.onabort = () => fail(failure || tx.error || Error('Не удалось сохранить изменения.'));
          tx.onerror = () => {}; // onabort handles errors once, without reporting a successful write.
          const get = store.get(KEY);
          get.onsuccess = () => {
            try {
              const state = get.result === undefined ? initialState() : validateState(get.result);
              result = change ? validateState(change(state)) : state;
              if (change) {
                if (backup) store.put(state, 'beforeRestore');
                store.put(result, KEY);
              }
            } catch (error) {
              failure = error;
              tx.abort();
            }
          };
        });
      resolve({
        read: () => transact('readonly'),
        update: (change) => transact('readwrite', change),
        // Separate device preference, like Android praisedDay: never part of progress or backups.
        claimNormPraise: (now = Date.now()) =>
          new Promise((ok, fail) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            let result = null,
              failure;
            tx.oncomplete = () => ok(result);
            tx.onabort = () => fail(failure || tx.error || Error('Не удалось сохранить отметку нормы.'));
            tx.onerror = () => {};
            const get = store.get(KEY);
            get.onsuccess = () => {
              try {
                const praise = normPraise(
                  get.result === undefined ? initialState() : validateState(get.result),
                  now,
                );
                if (!praise) return;
                const seen = store.get('praisedDay');
                seen.onsuccess = () => {
                  if (seen.result !== praise.day) {
                    store.put(praise.day, 'praisedDay');
                    result = praise;
                  }
                };
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
          }),
        replace: (replacement, expectedRevision) =>
          transact(
            'readwrite',
            (current) => {
              if (current.revision !== expectedRevision)
                throw Error('Прогресс изменился после предпросмотра. Открой файл заново.');
              const restored = validateState(structuredClone(replacement));
              const lastAnswer = restored.answers.reduce((n, a) => Math.max(n, a.revision || 0), 0);
              return { ...restored, revision: Math.max(current.revision, restored.revision, lastAnswer) + 1 };
            },
            true,
          ),
        close: () => db.close(),
      });
    };
  });
}
