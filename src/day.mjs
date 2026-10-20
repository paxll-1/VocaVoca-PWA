import { studyStart, eligible } from './learning.mjs';
const stamp = (time) => {
  const d = new Date(studyStart(time));
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
};
export const dayBetween = (now, then) => Math.round((stamp(then) - stamp(now)) / 86400000);
const learnedOn = (state, now) =>
  Object.values(state.words).filter((w) => w.status === 'learning' && dayBetween(now, w.selectedAt) === 0)
    .length;
// Android VocabularyViewModel.checkPraise / Daily.praisePhrase: local study day, once on this device.
export function normPraise(state, now = Date.now()) {
  if (learnedOn(state, now) < state.settings.dailyNew) return null;
  const date = new Date(studyStart(now));
  return {
    day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    phrase: [
      'Вы молодец!',
      'Так держать!',
      'Отличная работа!',
      'Хороший темп!',
      'Прекрасно!',
      'Замечательно!',
      'Браво!',
    ][(date.getDay() + 6) % 7],
  };
}
export function dayPlan(state, catalog, now = Date.now()) {
  return {
    due: eligible(state, catalog, now).length,
    learned: learnedOn(state, now),
    norm: state.settings.dailyNew,
  };
}
export function week(state, now = Date.now()) {
  return Array.from({ length: 7 }, (_, i) => {
    const day = studyStart(now, i - 6);
    const learned = learnedOn(state, day);
    const practiced = state.answers.some((a) => dayBetween(day, a.answeredAt) === 0);
    return {
      day,
      learned,
      status:
        learned >= state.settings.dailyNew
          ? 'Норма выполнена'
          : practiced || learned
            ? 'Занимался'
            : 'Без занятия',
    };
  });
}
export function dueText(then, now = Date.now()) {
  const days = dayBetween(now, then);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  const date = new Date(studyStart(then));
  if (days < 7)
    return ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'][
      date.getDay()
    ];
  return date.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}
