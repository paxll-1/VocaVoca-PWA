export const COLORS = [
  ['orange', 'Оранжевый', '#b8521c'],
  ['cranberry', 'Клюквенный', '#a63a4a'],
  ['plum', 'Сливовый', '#6e3f78'],
  ['teal', 'Морская волна', '#24676b'],
  ['bottle', 'Бутылочный', '#2e5e4e'],
  ['burgundy', 'Бордо', '#7e2a3a'],
  ['chocolate', 'Шоколадный', '#6b4a35'],
];
export const DEFAULT_SETTINGS = {
  level: 'beginner',
  dailyNew: 10,
  explanationOnTap: true,
  theme: 'system',
  ribbonColor: 'orange',
  dailyColor: false,
};
export const LEVELS = [
  ['beginner', 'Начальный · A1–A2'],
  ['middle', 'Средний · B1–B2'],
];
export function validSettings(value) {
  return (
    value &&
    LEVELS.some(([id]) => id === value.level) &&
    [5, 10, 15, 20].includes(value.dailyNew) &&
    typeof value.explanationOnTap === 'boolean' &&
    ['system', 'light', 'dark'].includes(value.theme) &&
    COLORS.some(([id]) => id === value.ribbonColor) &&
    typeof value.dailyColor === 'boolean'
  );
}
export function currentColor(settings, date = new Date()) {
  return settings.dailyColor
    ? COLORS[(date.getDay() + 6) % 7]
    : COLORS.find(([id]) => id === settings.ribbonColor);
}
