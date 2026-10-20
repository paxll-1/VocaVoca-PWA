import { studyStart } from './learning.mjs';

// Android ResultScreen: unique first attempts, current enrollment and actual answer events.
export function sessionResult(state) {
  const seen = new Set();
  const attempts = (state.session?.attempts || []).filter((a) => {
    if (a.retry || seen.has(a.cardId)) return false;
    seen.add(a.cardId);
    return true;
  });
  const rows = attempts
    .filter((a) => a.answer)
    .map((a) => {
      const word = state.words[a.cardId];
      const active = word?.status === 'learning' && word.enrollment === a.enrollment;
      return {
        cardId: a.cardId,
        correct: a.answer.correct,
        scheduled: a.answer.scheduled,
        dueAt: active ? word.dueAt : null,
        active,
        group: !active ? 'removed' : !a.answer.scheduled ? 'practice' : String(studyStart(word.dueAt)),
      };
    });
  rows.sort(
    (a, b) =>
      Number(!a.active) - Number(!b.active) ||
      Number(!a.scheduled) - Number(!b.scheduled) ||
      (a.scheduled && b.scheduled ? (a.dueAt || 0) - (b.dueAt || 0) : 0) ||
      Number(a.correct) - Number(b.correct),
  );
  const groups = new Map();
  rows.forEach((row) => groups.set(row.group, [...(groups.get(row.group) || []), row]));
  return {
    total: rows.length,
    correct: rows.filter((r) => r.correct).length,
    skipped: attempts.filter((a) => a.skipped && !a.answer).length,
    groups: [...groups],
    scheduled: rows.some((r) => r.scheduled),
  };
}
