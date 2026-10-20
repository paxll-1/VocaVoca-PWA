// Port of BackupFormat.kt v3. No network, permissions or reminder scheduling.
import { initialState } from './learning.mjs';
import { validateState } from './storage.mjs';
const MAX_FILE = 8 * 1024 * 1024;
const MAX_UNPACKED = 32 * 1024 * 1024;
const bytesOf = (s) => new TextEncoder().encode(s);
const hash = async (s) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytesOf(s)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const check = (ok, field) => {
  if (!ok) throw Error(`Некорректная копия Android: ${field}.`);
};
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const text = (s) => typeof s === 'string';
const bool = (v) => typeof v === 'boolean';
const unique = (items, key) => new Set(items.map(key)).size === items.length;
async function transform(bytes, pack) {
  const Stream = pack ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (!Stream) throw Error('Браузер не поддерживает gzip-копии Android. Копия Web остаётся доступной.');
  const reader = new Blob([bytes]).stream().pipeThrough(new Stream('gzip')).getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > (pack ? MAX_FILE : MAX_UNPACKED)) {
      await reader.cancel();
      throw Error('Копия превышает допустимый размер.');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

export async function decodeAndroidBackup(bytes) {
  check(bytes.byteLength <= MAX_FILE, 'размер больше 8 МБ');
  const envelope = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await transform(bytes, false)),
  );
  check(
    envelope.format === 'vocavoca-progress' && [1, 2, 3].includes(envelope.formatVersion),
    'формат или версия не поддерживаются',
  );
  check(text(envelope.payload) && (await hash(envelope.payload)) === envelope.sha256, 'контрольная сумма');
  const p = JSON.parse(envelope.payload),
    v = envelope.formatVersion;
  check(
    integer(p.createdAt) && integer(p.revision) && text(p.catalogVersion) && p.catalogVersion.length,
    'заголовок',
  );
  for (const key of ['words', 'sessions', 'attempts', 'answers', 'questions'])
    check(Array.isArray(p[key]), key);
  p.known ??= [];
  check(Array.isArray(p.known), 'known');
  for (const [key, field] of [
    ['words', 'cardId'],
    ['known', 'cardId'],
    ['sessions', 'id'],
    ['attempts', 'id'],
    ['answers', 'id'],
  ])
    check(
      unique(p[key], (o) => o[field]),
      `повторяющиеся ${key}`,
    );
  check(
    unique(p.attempts, (a) => `${a.sessionId}:${a.ordinal}`),
    'порядок попыток',
  );
  check(p.sessions.filter((s) => !s.completed).length <= 1, 'несколько незавершённых тренировок');
  const state = initialState();
  state.revision = p.revision;
  state.onboarded = true;
  if (p.settings !== null) {
    const s = p.settings;
    check(
      s &&
        bool(s.reminderEnabled) &&
        integer(s.reminderHour) &&
        s.reminderHour <= 23 &&
        integer(s.reminderMinute) &&
        s.reminderMinute <= 59,
      'напоминание',
    );
    check(text(s.theme) && (s.level === undefined || text(s.level)), 'настройки');
    state.settings = {
      theme: s.theme,
      ribbonColor: s.ribbonColor ?? 'orange',
      dailyColor: s.dailyColor ?? false,
      level: s.level || 'beginner',
      dailyNew: s.dailyNew ?? 10,
      explanationOnTap: s.explanationOnTap ?? false,
    };
    // Kept as data for a file round trip; never used to request notification permissions.
    state.androidReminder = {
      reminderEnabled: s.reminderEnabled,
      reminderHour: s.reminderHour,
      reminderMinute: s.reminderMinute,
    };
    state.dictionary.level = state.settings.level;
  }
  p.words.forEach((w) => {
    check(typeof w.cardId === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(w.cardId), 'ID слова');
    check(
      bool(w.active) &&
        integer(w.reviewStage) &&
        w.reviewStage <= 8 &&
        integer(w.enrollment) &&
        w.enrollment >= 1 &&
        ['dueAt', 'selectedAt', 'updatedAt'].every((k) => integer(w[k])) &&
        (w.solid === undefined || bool(w.solid)),
      'слово',
    );
    state.words[w.cardId] = {
      cardId: w.cardId,
      status: w.active ? 'learning' : 'inactive',
      stage: w.reviewStage,
      dueAt: w.dueAt,
      selectedAt: w.selectedAt,
      updatedAt: w.updatedAt,
      enrollment: w.enrollment,
      solid: w.solid ?? false,
    };
  });
  p.known.forEach((w) => {
    check(typeof w.cardId === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(w.cardId), 'ID знакомого слова');
    check(integer(w.markedAt) && state.words[w.cardId]?.status !== 'learning', 'знакомое слово');
    state.words[w.cardId] = {
      ...(state.words[w.cardId] || {}),
      cardId: w.cardId,
      status: 'known',
      knownAt: w.markedAt,
      updatedAt: state.words[w.cardId]?.updatedAt ?? w.markedAt,
    };
  });
  const kind = (o) => {
    check(v >= 3 ? ['choice', 'recall'].includes(o.kind) : o.kind === undefined, 'тип ответа');
    return v >= 3 ? o.kind : 'choice';
  };
  const answers = new Map(
    p.answers.map((a) => {
      check(
        integer(a.revision) && a.revision >= 1 && a.revision <= p.revision && text(a.zoneId),
        'ревизия ответа',
      );
      const event = {
        attemptId: a.id,
        sessionId: a.sessionId,
        cardId: a.cardId,
        enrollment: a.enrollment,
        questionId: a.questionId,
        direction: a.direction,
        kind: kind(a),
        optionId: a.chosenOptionId,
        correct: a.correct,
        retry: a.retry,
        scheduled: a.scheduled ?? true,
        answeredAt: a.answeredAt,
        zone: a.zoneId,
        revision: a.revision,
      };
      return [a.id, event];
    }),
  );
  const sessions = p.sessions
    .map((s) => {
      check(
        integer(s.createdAt) &&
          integer(s.algorithmVersion) &&
          s.algorithmVersion >= 1 &&
          s.algorithmVersion <= 2 &&
          bool(s.completed) &&
          (s.training === undefined || bool(s.training)) &&
          (s.setId === undefined || text(s.setId)),
        'тренировка или версия алгоритма',
      );
      const attempts = p.attempts
        .filter((a) => a.sessionId === s.id)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((a) => {
          check(
            integer(a.ordinal) && integer(a.questionIndex) && text(p.questions[a.questionIndex]),
            'индекс вопроса',
          );
          const q = JSON.parse(p.questions[a.questionIndex]);
          check(Array.isArray(q.options), 'варианты вопроса');
          let options = q.options;
          if (a.optionOrder !== undefined) {
            check(
              Array.isArray(a.optionOrder) &&
                a.optionOrder.length === options.length &&
                unique(a.optionOrder, (id) => id) &&
                a.optionOrder.every((id) => options.some((o) => o.id === id)),
              'порядок вариантов',
            );
            options = a.optionOrder.map((id) => q.options.find((o) => o.id === id));
          }
          const answer = answers.get(a.id) || null;
          const k = kind(a);
          check(k !== 'recall' || q.direction === 'ru-to-en', 'направление вспоминания');
          check(a.chosenOptionId === (answer?.optionId ?? null), 'ответ не соответствует попытке');
          if (answer)
            check(
              answer.sessionId === s.id &&
                answer.cardId === a.cardId &&
                answer.enrollment === a.enrollment &&
                answer.kind === k &&
                answer.questionId === q.id &&
                answer.direction === q.direction &&
                answer.retry === a.retry &&
                (k === 'recall'
                  ? ['recalled', 'forgot'].includes(answer.optionId) &&
                    answer.correct === (answer.optionId === 'recalled')
                  : options.some((o) => o.id === answer.optionId) &&
                    answer.correct === (answer.optionId === q.correct)),
              'связь ответа и вопроса',
            );
          return {
            id: a.id,
            ordinal: a.ordinal,
            cardId: a.cardId,
            enrollment: a.enrollment,
            kind: k,
            retry: a.retry,
            skipped: a.skipped,
            revealed: !!answer,
            answer,
            question: {
              id: q.id,
              direction: q.direction,
              context: q.context,
              prompt: q.prompt,
              correctOptionId: q.correct,
              explanationRu: q.explanation,
              options,
            },
          };
        });
      return {
        id: s.id,
        startedAt: s.createdAt,
        position: s.position,
        completed: s.completed,
        algorithmVersion: s.algorithmVersion,
        mode: s.training ? 'practice' : 'due',
        setId: s.setId || null,
        attempts,
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt);
  check(sessions.reduce((n, s) => n + s.attempts.length, 0) === p.attempts.length, 'попытка без тренировки');
  const attemptIds = new Set(p.attempts.map((a) => a.id));
  check(
    p.answers.every((a) => attemptIds.has(a.id)),
    'ответ без попытки',
  );
  state.answers = [...answers.values()].sort(
    (a, b) => a.revision - b.revision || a.answeredAt - b.answeredAt,
  );
  state.session = sessions.find((s) => !s.completed) || sessions.at(-1) || null;
  state.sessionArchive = sessions.filter((s) => s !== state.session);
  state.view = state.session && !state.session.completed ? 'session' : 'home';
  return {
    state: validateState(state),
    createdAt: p.createdAt,
    catalogVersion: p.catalogVersion,
    source: 'Android',
  };
}

export async function encodeAndroidBackup(input, catalogVersion, now = Date.now()) {
  const state = validateState(structuredClone(input));
  const sessions = [...state.sessionArchive, ...(state.session ? [state.session] : [])];
  const attemptIds = new Set(sessions.flatMap((s) => s.attempts.map((a) => a.id)));
  if (state.answers.some((a) => !attemptIds.has(a.attemptId)))
    throw Error(
      'В ранней копии Web нет снимков старых вопросов. Экспорт Android остановлен, чтобы не потерять историю. Сохрани полную копию Web.',
    );
  const questions = [],
    questionIndex = new Map(),
    attempts = [];
  for (const s of sessions)
    for (const [ordinal, a] of s.attempts.entries()) {
      const q = a.question;
      const snapshot = JSON.stringify({
        id: q.id,
        direction: q.direction,
        context: q.context,
        prompt: q.prompt,
        correct: q.correctOptionId,
        explanation: q.explanationRu,
        options: [...q.options].sort((a, b) => a.id.localeCompare(b.id)),
      });
      if (!questionIndex.has(snapshot)) {
        questionIndex.set(snapshot, questions.length);
        questions.push(snapshot);
      }
      attempts.push({
        id: a.id,
        sessionId: s.id,
        ordinal,
        cardId: a.cardId,
        enrollment: a.enrollment,
        questionIndex: questionIndex.get(snapshot),
        optionOrder: q.options.map((o) => o.id),
        retry: a.retry,
        skipped: a.skipped,
        chosenOptionId: a.answer?.optionId ?? null,
        kind: a.kind,
      });
    }
  const answers = state.answers.map((a, i) => ({
    id: a.attemptId,
    sessionId: a.sessionId,
    cardId: a.cardId,
    enrollment: a.enrollment,
    questionId: a.questionId,
    direction: a.direction,
    answeredAt: a.answeredAt,
    retry: a.retry,
    correct: a.correct,
    chosenOptionId: a.optionId,
    zoneId: a.zone,
    revision: a.revision || i + 1,
    scheduled: a.scheduled,
    kind: a.kind,
  }));
  const revision = answers.reduce((n, a) => Math.max(n, a.revision), state.revision);
  const payload = JSON.stringify({
    createdAt: now,
    revision,
    catalogVersion,
    settings: {
      ...state.settings,
      ...(state.androidReminder || { reminderEnabled: false, reminderHour: 20, reminderMinute: 0 }),
    },
    words: Object.values(state.words)
      .filter((w) => w.enrollment >= 1)
      .map((w) => ({
        cardId: w.cardId,
        active: w.status === 'learning',
        reviewStage: w.stage,
        dueAt: w.dueAt,
        selectedAt: w.selectedAt,
        updatedAt: w.updatedAt,
        enrollment: w.enrollment,
        solid: w.solid,
      })),
    known: Object.values(state.words)
      .filter((w) => w.status === 'known')
      .map((w) => ({ cardId: w.cardId, markedAt: w.knownAt ?? w.updatedAt })),
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.startedAt,
      position: s.position,
      completed: s.completed,
      algorithmVersion: s.algorithmVersion,
      training: s.mode === 'practice' || !!s.setId,
      setId: s.setId || '',
    })),
    questions,
    attempts,
    answers,
  });
  const unpacked = bytesOf(
    JSON.stringify({ format: 'vocavoca-progress', formatVersion: 3, sha256: await hash(payload), payload }),
  );
  if (unpacked.length > MAX_UNPACKED) throw Error('Распакованная копия больше 32 МБ.');
  const bytes = await transform(unpacked, true);
  // Re-read before offering a file: missing legacy metadata must not produce a partial export.
  await decodeAndroidBackup(bytes);
  return bytes;
}
