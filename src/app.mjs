import { indexCatalog, verifiedIpa } from './catalog.mjs';
import { reduce, currentAttempt, eligible, tally, wordState, studyStart } from './learning.mjs';
import { openStore } from './storage.mjs';
import { setupPwa } from './pwa.mjs';
import { COLORS, LEVELS, currentColor } from './settings.mjs';
import { dayPlan, week, dueText, dayBetween } from './day.mjs';
import { createSearch } from './search.mjs';
import { encodeBackup, decodeBackup, MAX_BYTES } from './backup.mjs';
import { locationOf } from './navigation.mjs';
import { sessionResult } from './results.mjs';
import { encodeAndroidBackup } from './android-backup.mjs';

const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
const errorBox = document.querySelector('#error');
const praiseBox = document.querySelector('#norm-praise');
let praisePending = false,
  praiseTimer;
const dismissPraise = () => {
  praiseBox.hidden = true;
  clearTimeout(praiseTimer);
};
praiseBox.addEventListener('click', dismissPraise);
async function checkPraise() {
  if (praisePending || document.hidden) return;
  praisePending = true;
  try {
    const praise = await store.claimNormPraise();
    if (praise) {
      document.querySelector('#praise-phrase').textContent = praise.phrase;
      praiseBox.hidden = false;
      clearTimeout(praiseTimer);
      praiseTimer = setTimeout(dismissPraise, 5000);
    }
  } catch {
    // Progress was already committed. An optional notice must not report its write as a lost answer.
  } finally {
    praisePending = false;
  }
}
new ResizeObserver(() => {
  if (!nav.hidden)
    document.documentElement.style.setProperty('--nav-height', `${nav.getBoundingClientRect().height}px`);
}).observe(nav);
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const en = (text) => `<span lang="en">${escape(text)}</span>`;
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${
    {
      home: '<path d="m3 10 9-7 9 7v10H4V10m5 10v-7h6v7"/>',
      sets: '<rect x="3" y="5" width="14" height="16" rx="2"/><path d="M7 2h12a2 2 0 0 1 2 2v13M7 10h6M7 14h5"/>',
      training: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m10 8 6 4-6 4Z"/>',
      profile: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      left: '<path d="M19 12H5m6-7-7 7 7 7"/>',
      right: '<path d="M5 12h14m-6-7 7 7-7 7"/>',
      bookmark: '<path d="M6 3h12v19l-6-4-6 4Z"/>',
      eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
    }[name] || ''
  }</svg>`;
const button = (action, label, cls = '', attrs = '') =>
  `<button type="button" data-action="${action}" class="${cls}" ${attrs}>${label}</button>`;
const route = (view, label, cls = '') => button('navigate', label, cls, `data-view="${view}"`);
let state, catalog, store, channel;
let search,
  restoreOffer = null,
  copyNote = '';
const openDetails = new Map();
let busy = false;
let pending = Promise.resolve();
let example = 0;
let visible = new Set();
let renderedCard;
let pwa = { offline: false, status: 'Готовим офлайн-доступ…', build: '' };
const set = () => catalog.bySet[state.selectedSetId];
const card = () => catalog.byId[state.cursors[state.selectedSetId]];
const active = () => state.session && !state.session.completed;
const count = () => eligible(state, catalog, Date.now()).length;
const statusName = (id) =>
  ({ new: 'Новое', learning: state.words[id]?.solid ? 'Закреплено' : 'Учу', known: 'Знаю' })[
    wordState(state, id)
  ];
const setProgress = (s) => {
  const t = tally(state, s.cardIds);
  const done = s.cardIds.length - t.new;
  return `${s.cardIds.length} слов · ${done ? `${done} разобрано` : 'не начат'}`;
};
const title = (text, over = '') =>
  `${over ? `<p class="eyebrow">${escape(over)}</p>` : ''}<h1 tabindex="-1">${escape(text)}</h1>`;
const back = (view, label) => route(view, `<span aria-hidden="true">←</span> ${escape(label)}`, 'back');

function focusText(text, phrases = []) {
  const ranges = [];
  for (const phrase of phrases || []) {
    if (!phrase) continue;
    let start = text.toLowerCase().indexOf(phrase.toLowerCase());
    while (start >= 0) {
      ranges.push([start, start + phrase.length]);
      start = text.toLowerCase().indexOf(phrase.toLowerCase(), start + phrase.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let end = 0,
    html = '';
  for (const [from, to] of ranges)
    if (from >= end) {
      html +=
        escape(text.slice(end, from)) + `<span class="focus-word">${escape(text.slice(from, to))}</span>`;
      end = to;
    }
  return html + escape(text.slice(end));
}
function reveal(key, text, label, english = false, focus = []) {
  const open = visible.has(key);
  return button(
    'translation',
    `<span class="translation-text ${open ? '' : 'veiled'}" ${open ? '' : 'aria-hidden="true"'} ${english ? 'lang="en"' : ''}>${focusText(text, focus)}</span><span class="eye">${icon('eye')}</span>`,
    `translation ${open ? 'revealed' : ''}`,
    `data-key="${key}" aria-expanded="${open}" aria-label="${open ? 'Скрыть' : 'Показать'} ${label}${open ? ': ' + escape(text) : ''}"`,
  );
}
function setRows(sets = catalog.sets) {
  return sets
    .map((s) =>
      button(
        'selectSet',
        `<span><strong>${escape(s.title)}</strong><small>${setProgress(s)}</small></span><span class="arrow" aria-hidden="true">→</span>`,
        'set-row',
        `data-set-id="${s.id}"`,
      ),
    )
    .join('');
}
function welcome() {
  return `<section class="welcome"><p class="welcome-greeting">Привет! Это VocaVoca</p>
    <div class="welcome-art" data-asset-state="ready" aria-hidden="true"><img src="./images/vocavoca-welcome-B-illustration.png" width="1315" height="1196" alt="" decoding="async"></div>
    <h1 tabindex="-1">Больше слов.<br>Больше способов<br>выразить себя.</h1>
    <p class="lede">Учи английские слова и выражения на понятных примерах. Тренируйся, чтобы запомнить их надолго.</p>
    ${route('sets', `Давай начнём <span class="button-arrow" aria-hidden="true">${icon('right')}</span>`, 'primary wide welcome-start')}
    </section>`;
}
function home() {
  if (!state.onboarded) return welcome();
  const s = set(),
    c = card();
  const plan = dayPlan(state, catalog);
  const suggested = [
    s,
    ...catalog.sets.filter((item) => item.level === state.settings.level && item.id !== s?.id),
  ]
    .filter(Boolean)
    .slice(0, 3);
  const done = s ? s.cardIds.length - tally(state, s.cardIds).new : 0;
  return `<section class="home-screen"><header class="home-header"><p class="brand">VocaVoca</p></header>${title('Продолжим?')}
    <section class="home-continue"><h2>${escape(s?.title || 'Выбери свой набор')}</h2>
    <p>${active() ? 'Осталась незавершённая тренировка' : c ? `Следующая карточка: <strong lang="en">${escape(c.headword)}</strong>` : 'Слова для повседневной жизни'}</p>
    ${s ? `<div class="progress" role="img" aria-label="${done} из ${s.cardIds.length} слов разобрано"><progress value="${done}" max="${s.cardIds.length}"></progress></div><p class="progress-caption">${done} из ${s.cardIds.length} слов разобрано</p>` : ''}
    ${route(active() ? 'session' : s ? 'card' : 'sets', `Продолжить <span class="button-arrow" aria-hidden="true">${icon('right')}</span>`, 'primary wide')}</section>
    <div class="section-heading"><h2>Ваши наборы</h2>${route('sets', 'Все', 'text-link')}</div>
    <div class="home-sets">${suggested.map((item) => button('selectSet', `<span class="set-symbol ${item.id === s?.id ? 'current' : ''}">${icon('sets')}</span><span class="set-row-copy"><strong>${escape(item.title)}</strong><small>${setProgress(item)}</small></span><span class="chevron" aria-hidden="true">›</span>`, 'set-row', `data-set-id="${item.id}"`)).join('')}</div>
    <section class="home-study"><div class="day-line">${route('training', active() ? 'Тренировка не закончена' : `Повторить · ${plan.due}`, 'text-link')}<span>${plan.learned >= plan.norm ? 'Норма на сегодня выполнена · ' : ''}Новых ${plan.learned} из ${plan.norm}</span></div>
    ${button('startFeed', 'Учить новые слова →', 'secondary wide', 'data-scope=""')}${route('scope', 'Что учить: выбрать тему или набор', 'text-link')}</section></section>`;
}
const select = (label, attr, chosen, options) =>
  `<label class="field">${escape(label)}<select ${attr}>${options.map(([value, text]) => `<option value="${escape(value)}" ${String(chosen) === String(value) ? 'selected' : ''}>${escape(text)}</option>`).join('')}</select></label>`;
const dictButton = (key, value, label) =>
  button(
    'dictionary',
    label,
    'chip',
    `data-key="${key}" data-value="${escape(value)}" aria-pressed="${state.dictionary[key] === value}"`,
  );
function wordRow(c, why = '') {
  const w = state.words[c.id];
  return button(
    'openCard',
    `<span><strong lang="en">${escape(c.headword)}</strong><small>${escape(c.shortRu)}</small>${why ? `<small>по форме: ${escape(why)}</small>` : ''}</span><span class="word-state">${statusName(c.id)}${w?.status === 'learning' ? `<small>${dueText(w.dueAt)}</small>${stageDots(w)}` : ''}</span>`,
    'word-row',
    `data-card-id="${c.id}"`,
  );
}
function stageDots(word) {
  if (word?.status !== 'learning' || word.solid) return '';
  const dots = Math.min(5, Math.max(0, word.stage));
  const label =
    dots === 1 ? 'Пройдена 1 пауза из 5' : `Пройдено ${dots} ${dots > 1 && dots < 5 ? 'паузы' : 'пауз'} из 5`;
  return `<span class="dots" role="img" aria-label="${label}">${[1, 2, 3, 4, 5].map((n) => `<i aria-hidden="true" class="${n <= dots ? 'filled' : ''}"></i>`).join('')}</span>`;
}
function progressLine(ids) {
  const t = tally(state, ids);
  return `<p class="fine">Новых ${t.new} · учу ${t.learning} · закреплено ${t.solid} · знаю ${t.known}</p>`;
}
function mineWords() {
  const groups = [
    ['today', 'Учу — сегодня'],
    ['week', 'Учу — на этой неделе'],
    ['later', 'Учу — позже'],
    ['solid', 'Закреплено'],
    ['known', 'Знаю'],
  ];
  const lists = Object.fromEntries(groups.map(([key]) => [key, []]));
  const daysToMonday = 7 - ((new Date(studyStart(Date.now())).getDay() + 6) % 7);
  const missing = [];
  for (const w of Object.values(state.words)) {
    if (!['learning', 'known'].includes(w.status)) continue;
    const c = catalog.byId[w.cardId];
    if (!c) {
      missing.push(w);
      continue;
    }
    const day = dayBetween(Date.now(), w.dueAt);
    const group =
      w.status === 'known'
        ? 'known'
        : w.solid
          ? 'solid'
          : day <= 0
            ? 'today'
            : day < daysToMonday
              ? 'week'
              : 'later';
    lists[group].push(c);
  }
  const content = groups
    .map(([key, label]) => {
      const cards = lists[key].sort(
        (a, b) =>
          (state.words[a.id].dueAt || 0) - (state.words[b.id].dueAt || 0) ||
          a.headword.localeCompare(b.headword),
      );
      if (!cards.length) return '';
      const folded =
        cards.length > 20 &&
        ['later', 'solid', 'known'].includes(key) !== state.dictionary.folded.includes(key);
      return `<section class="word-group">${cards.length > 20 ? button('fold', `${label} · ${cards.length} ${folded ? '+' : '−'}`, 'group-toggle', `data-key="${key}" aria-expanded="${!folded}"`) : `<h2>${label} · ${cards.length}</h2>`}${folded ? '' : cards.map((c) => wordRow(c)).join('')}</section>`;
    })
    .join('');
  return (
    content +
      missing
        .map(
          (w) =>
            `<p>Карточка ${escape(w.cardId)} недоступна; прогресс сохранён. ${button('remove', 'Убрать из моих слов', 'text-link', `data-card-id="${escape(w.cardId)}"`)}</p>`,
        )
        .join('') ||
    `<p>Пока пусто. Нажми «Учить» или «Знаю» на карточке.</p>${route('home', 'К новым словам →', 'text-link')}`
  );
}
function setsPage() {
  const d = state.dictionary;
  const header = `${title('Наборы', 'Слова для жизни')}<label class="search-field">Найти слово<input id="word-search" type="search" value="${escape(d.query)}" placeholder="Слово или перевод" autocomplete="off" autocapitalize="none" data-dict="query"></label><div class="segments">${dictButton('tab', 'themes', 'Темы')}${dictButton('tab', 'mine', 'Мои слова')}${dictButton('tab', 'letters', 'А–Я')}</div>`;
  if (d.query.trim()) {
    const found = search.find(d.query);
    const suggestions = found.length ? [] : search.suggest(d.query);
    return (
      header +
      `<p class="fine" role="status">Найдено: ${found.length}</p>` +
      (found.length
        ? found.map(({ card, why }) => wordRow(card, why.join(', '))).join('')
        : `<p>Ничего не нашлось.</p><p>${suggestions.length ? 'Возможно, ты искал:' : 'Проверь написание или поищи по-русски.'}</p>${suggestions.map((word) => dictButton('query', word, escape(word))).join('')}`)
    );
  }
  if (d.tab === 'mine') return header + mineWords();
  if (d.tab === 'letters') {
    const kind = (c) =>
      c.partOfSpeech === 'phrasal-verb' ? 'phrasal-verb' : c.kind === 'expression' ? 'expression' : 'word';
    const shown = catalog.cards
      .filter(
        (c) =>
          (!d.filterLevel || catalog.bySet[c.set].level === d.filterLevel) &&
          (!d.type || kind(c) === d.type) &&
          (!d.state ||
            (state.words[c.id]?.status === 'learning' && state.words[c.id]?.solid
              ? 'solid'
              : wordState(state, c.id)) === d.state),
      )
      .sort((a, b) =>
        a.headword
          .replace(/^[^\p{L}\p{N}]+/u, '')
          .toLowerCase()
          .localeCompare(b.headword.replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase()),
      );
    const filters = `<details class="filters"><summary>Фильтры</summary>${select('Уровень', 'data-dict="filterLevel"', d.filterLevel, [['', 'Все'], ...LEVELS])}${select(
      'Мои слова',
      'data-dict="state"',
      d.state,
      [
        ['', 'Все'],
        ['new', 'Новые'],
        ['learning', 'Учу'],
        ['solid', 'Закреплено'],
        ['known', 'Знаю'],
      ],
    )}${select('Тип', 'data-dict="type"', d.type, [
      ['', 'Все'],
      ['word', 'Слова'],
      ['phrasal-verb', 'Фразовые глаголы'],
      ['expression', 'Выражения'],
    ])}</details>`;
    const chips = ['filterLevel', 'state', 'type']
      .filter((key) => d[key])
      .map((key) =>
        button(
          'dictionary',
          `${escape({ beginner: 'Начальный', middle: 'Средний', new: 'Новые', learning: 'Учу', solid: 'Закреплено', known: 'Знаю', word: 'Слова', 'phrasal-verb': 'Фразовые глаголы', expression: 'Выражения' }[d[key]])} ×`,
          'chip',
          `data-key="${key}" data-value=""`,
        ),
      )
      .join('');
    let letter = '';
    const initial = (c) => c.headword.replace(/^[^\p{L}\p{N}]+/u, '')[0].toUpperCase();
    const letters = [...new Set(shown.map(initial))];
    return (
      header +
      filters +
      chips +
      `<p class="fine">Найдено: ${shown.length}</p>` +
      `<nav class="alphabet" aria-label="Перейти к букве">${letters.map((l) => button('letter', escape(l), 'letter-button', `data-letter="${escape(l)}"`)).join('')}</nav>` +
      shown
        .map((c) => {
          const next = initial(c);
          const heading =
            next !== letter
              ? `<h2 id="letter-${escape(next)}" tabindex="-1" class="letter-heading">${escape(next)}</h2>`
              : '';
          letter = next;
          return heading + wordRow(c);
        })
        .join('')
    );
  }
  const themes = catalog.themes.filter((t) => t.level === d.level);
  return (
    header +
    select('Уровень наборов', 'data-dict="level"', d.level, LEVELS) +
    themes
      .map((t) => {
        const sets = catalog.sets.filter((s) => s.themeId === t.id);
        const ids = sets.flatMap((s) => s.cardIds);
        return button(
          'theme',
          `<span><strong>${escape(t.title)}</strong><small>${sets.length} наборов · ${ids.length} слов</small>${progressLine(ids)}</span><span aria-hidden="true">→</span>`,
          'set-row',
          `data-theme-id="${t.id}"`,
        );
      })
      .join('') +
    `<p class="fine">${catalog.cards.length} карточек из общего каталога. Здесь только наборы с готовыми карточками.</p>`
  );
}
function themePage() {
  const theme = catalog.themes.find((t) => t.id === state.themeId);
  if (!theme) return setsPage();
  const sets = catalog.sets.filter((s) => s.themeId === theme.id);
  return `${back('sets', 'Все темы')}${title(theme.title)}<p>${escape(theme.about)}</p>${progressLine(sets.flatMap((s) => s.cardIds))}${button('startFeed', 'Учить всю тему →', 'primary wide', `data-scope="theme:${theme.id}"`)}${setRows(sets)}`;
}
function scopePage() {
  const shown = state.scopeLevel || state.settings.level;
  return `${back('home', 'Главная')}${title('Что учить')}${select('Посмотреть темы уровня', 'id="scope-level"', shown, LEVELS)}${shown === state.settings.level ? button('startFeed', 'Все темы уровня →', 'primary wide', 'data-scope=""') : '<p class="fine">Можно выбрать тему или набор. Уровень в Профиле не изменится.</p>'}${catalog.themes
    .filter((t) => t.level === shown)
    .map(
      (t) =>
        `<details class="scope-theme"><summary>${escape(t.title)}</summary>${button('startFeed', 'Вся тема →', 'text-link', `data-scope="theme:${t.id}"`)}${catalog.sets
          .filter((s) => s.themeId === t.id)
          .map((s) => button('startFeed', escape(s.title), 'set-row', `data-scope="set:${s.id}"`))
          .join('')}</details>`,
    )
    .join('')}`;
}
function triagePage() {
  const s = set();
  if (!s) return setsPage();
  const fresh = s.cardIds.filter((id) => wordState(state, id) === 'new');
  return `${back('set', s.title)}${title('Отметить знакомые')}<p>Нажми на слово, чтобы открыть перевод. «Знаю» уберёт его из ленты.</p>${undoBar()}${fresh
    .map((id) => {
      const c = catalog.byId[id];
      return `<div class="triage-row"><span>${button('triageReveal', en(c.headword), 'triage-word', `data-card-id="${id}" aria-expanded="${visible.has(id)}"`)}${visible.has(id) ? `<small>${escape(c.shortRu)}</small>` : ''}</span>${button('know', 'Знаю', 'chip', `data-card-id="${id}"`)}</div>`;
    })
    .join(
      '',
    )}${fresh.length ? button('startFeed', `Учить набор · ${fresh.length} →`, 'primary wide', `data-scope="set:${s.id}"`) : '<p>Все новые слова набора разобраны.</p>'}`;
}
function undoBar() {
  return state.undo
    ? `<div class="undo" role="status">«${escape(catalog.byId[state.undo.cardId]?.headword || state.undo.cardId)}» отмечено знакомым. ${button('undoKnow', 'Отменить', 'text-link')}</div>`
    : '';
}
function setPage() {
  const s = set();
  if (!s) return setsPage();
  const t = tally(state, s.cardIds);
  return `<section class="set-screen"><div class="screen-heading">${route('theme', icon('left'), 'heading-back')}${title(s.title)}</div>
    <div class="word-list set-words">${[...s.cardIds]
      .sort((a, b) => catalog.byId[a].headword.localeCompare(catalog.byId[b].headword))
      .map((id) => {
        const c = catalog.byId[id];
        return button(
          'openCard',
          `<span><strong lang="en">${escape(c.headword)}</strong><small>${escape(c.shortRu)}</small></span>${wordState(state, id) === 'new' ? '' : `<span class="word-state">${statusName(id)}</span>`}`,
          'word-row',
          `data-card-id="${id}"`,
        );
      })
      .join('')}</div>
    ${route('card', 'Продолжить', 'primary wide set-continue')}
    <details class="set-details"><summary>О наборе и занятиях</summary><p class="muted">${setProgress(s)}</p><p>${escape(s.about)}</p>
    ${s.cardIds.length !== t.new ? `<p class="fine">Учу ${t.learning} · закреплено ${t.solid} · знаю ${t.known}</p>` : ''}
    ${s.cardIds.length < s.plan ? `<p class="fine">Сейчас ${s.cardIds.length} слов из ${s.plan} по плану. Остальные придут с обновлениями.</p>` : ''}
    ${button('startFeed', t.new ? `Учить набор · ${t.new}` : 'Листать набор', 'secondary wide', `data-scope="set:${s.id}" ${t.new ? '' : 'data-browse-all="true"'}`)}
    ${t.new ? route('triage', 'Отметить знакомые', 'text-link') : ''}${t.learning + t.solid ? button('start', 'Тренировка по набору →', 'text-link', `data-set-id="${s.id}"`) : ''}</details></section>`;
}
function cardPage() {
  const c = card(),
    s = set();
  if (state.cardMode === 'feed' && state.feed?.finished)
    return `${title('Новые слова разобраны')}<p>В выбранной области новых слов больше нет. Можно повторить выбранные слова или открыть другой набор.</p>${undoBar()}${route('training', 'К тренировкам →', 'primary wide')}${route('scope', 'Выбрать, что учить', 'text-link')}`;
  if (!c || !s)
    return `${title('Карточка недоступна')}<p>Сохранённый ID больше не входит в эту версию пилота. Прогресс сохранён.</p>${route('sets', 'К наборам', 'primary')}`;
  if (renderedCard !== c.id) {
    visible.clear();
    if (!state.settings.explanationOnTap) visible.add('definition');
    example = 0;
    renderedCard = c.id;
  }
  const ipa = verifiedIpa(c);
  const i = s.cardIds.indexOf(c.id);
  const e = c.examples[example];
  const w = state.words[c.id];
  const feed = state.cardMode === 'feed';
  const plan = dayPlan(state, catalog);
  const dots = stageDots(w);
  const backButton = button(
    state.cardReturn ? 'cardBack' : 'navigate',
    `${icon('left')}<span>${escape(s.title)}</span>`,
    'card-back',
    `data-view="set" aria-label="Назад: ${escape(s.title)}"`,
  );
  return `<section class="dictionary-card">${backButton}${feed ? `<div class="day-line">${route('training', active() ? 'Тренировка не закончена' : `Повторить ${plan.due}`, 'text-link')}<span>${plan.learned >= plan.norm ? 'Норма на сегодня выполнена · ' : ''}Новых ${plan.learned} из ${plan.norm}</span></div>${route('scope', 'Что учить →', 'text-link')}` : ''}
    <div class="card-meta"><span class="part-of-speech" lang="en">${escape(c.partOfSpeech)}</span><span>${wordState(state, c.id) === 'new' ? '' : statusName(c.id)} ${dots}</span></div>${c.register?.length ? `<p class="register fine">${escape(c.register.join(' · '))}</p>` : ''}
    <h1 class="headword" data-long="${c.headword.length > 14}" tabindex="-1" lang="en">${escape(c.headword)}</h1>
    ${ipa ? `<p class="ipa" aria-label="Международная транскрипция">${escape(ipa)}</p>` : '<p class="fine">Произношение пока не подтверждено</p>'}
    ${c.usage ? `<p class="usage"><span class="fine">Как употреблять</span><br><span lang="en">${escape(c.usage)}</span></p>` : ''}
    <p class="definition" lang="en">${escape(c.explanationEn)}</p>
    ${reveal('word', c.shortRu, 'перевод слова')}${reveal('definition', c.explanationRu, 'перевод определения')}
    <div class="example"><p class="example-en" lang="en">${focusText(e.en, e.enFocus)}</p>${reveal(`example-${example}`, e.ru, 'перевод примера', false, e.ruFocus)}
    <div class="example-controls" aria-label="Примеры">${[0, 1, 2].map((n) => button('example', '<span></span>', `example-dot ${n === example ? 'selected' : ''}`, `data-index="${n}" aria-label="Показать пример ${n + 1}" aria-pressed="${n === example}"`)).join('')}<span class="sr-only" aria-live="polite">Пример ${example + 1} из 3</span></div></div>
    ${c.confusion ? `<p class="confusion"><span class="fine">Не путать</span><br>${c.confusion.card && catalog.byId[c.confusion.card] ? button('openCard', escape(c.confusion.text), 'text-link', `data-card-id="${c.confusion.card}"`) : escape(c.confusion.text)}</p>` : ''}
    ${w?.status === 'learning' ? `<p class="fine">Следующее повторение — ${dueText(w.dueAt)}.</p>` : ''}${undoBar()}
    <div class="card-controls"><div class="card-actions">
    ${button('move', icon('left'), 'quiet-arrow previous-card', `data-delta="-1" aria-label="Предыдущая карточка" ${(feed ? state.feed.position === 0 : i === 0) ? 'disabled' : ''}`)}
    ${wordState(state, c.id) === 'known' ? button('unknow', 'Вернуть в новые', 'secondary', `data-card-id="${c.id}"`) : button('know', 'Знаю', 'secondary', `data-card-id="${c.id}"`)}${button('learn', `${icon('bookmark')}<span>${wordState(state, c.id) === 'learning' ? 'Учу' : 'Учить'}</span>`, 'primary', `data-card-id="${c.id}" ${wordState(state, c.id) === 'learning' ? 'disabled' : ''}`)}
    ${button('move', icon('right'), 'quiet-arrow next-card', `data-delta="1" aria-label="Следующая карточка" ${!feed && i === s.cardIds.length - 1 ? 'disabled' : ''}`)}
    </div><span class="sr-only">${feed ? `Карточка ${state.feed.position + 1}` : `${i + 1} из ${s.cardIds.length}`}</span></div>
    ${wordState(state, c.id) === 'learning' ? button('remove', 'Убрать из повторения', 'text-link', `data-card-id="${c.id}"`) : ''}
    ${wordState(state, c.id) === 'learning' ? route('training', active() ? 'Продолжить тренировку →' : 'К тренировкам →', 'text-link') : ''}</section>`;
}
function training() {
  const due = count();
  const future = eligible(state, catalog, Date.now(), 'practice').length;
  return `${title('Тренировки', 'Немного, но регулярно')}<p class="lede">Вспомни слова, которые выбрал учить.</p>
    ${active() ? `<section class="continue"><h2>Ты уже начал</h2><p>Ответы сохранены. Продолжи с того же вопроса.</p>${route('session', 'Продолжить тренировку →', 'primary wide')}</section>` : ''}
    <section class="training-block"><h2>Повторить сегодня</h2><p>${due ? `${due} слов ждут повторения. В одном подходе — до пяти.` : 'На сегодня всё. Новые слова появятся здесь после нажатия «Учить».'}</p>
    ${button('start', 'Начать повторение →', 'primary wide', `data-mode="due" ${due && !active() ? '' : 'disabled'}`)}</section>
    <section class="training-block"><h2>Потренироваться ещё</h2><p>Слова, срок которых ещё не наступил. До срока практика не сдвигает расписание.</p>
    ${button('start', future ? `Потренироваться · ${future}` : 'Пока нет слов для тренировки', 'secondary wide', `data-mode="practice" ${future && !active() ? '' : 'disabled'}`)}${!active() ? route('trainSets', 'Тренировка по набору →', 'text-link') : ''}</section>
    ${weekBlock()}${route('sets', 'Выбрать слова в наборах →', 'text-link')}`;
}
function trainSets() {
  const sets = catalog.sets.filter((s) => s.cardIds.some((id) => wordState(state, id) === 'learning'));
  return `${back('training', 'Тренировки')}${title('Тренировка по набору')}<p>Только выбранные тобой слова. Сначала те, которым пора. Их первые ответы обновляют расписание; практика остальных сроки не меняет.</p>${sets.length ? sets.map((s) => button('start', `${escape(s.title)} →`, 'set-row', `data-set-id="${s.id}"`)).join('') : '<p>Пока нет наборов с выбранными словами. Нажми «Учить» на карточке.</p>'}`;
}
function weekBlock() {
  return `<section class="training-block"><h2>Последние 7 дней</h2><div class="week">${week(state)
    .map(
      (day) =>
        `<div class="week-day" title="${new Date(day.day).toLocaleDateString('ru')}: ${day.status}"><span>${new Date(day.day).toLocaleDateString('ru', { weekday: 'short' })}</span><span class="day-mark" aria-label="${day.status}">${day.status === 'Норма выполнена' ? '✓' : day.status === 'Занимался' ? '●' : '○'}</span></div>`,
    )
    .join('')}</div><p class="fine">○ без занятия · ● занимался · ✓ норма новых слов</p></section>`;
}
function sessionPage() {
  const session = state.session;
  if (!session) return training();
  if (session.completed) {
    const result = sessionResult(state);
    const plan = dayPlan(state, catalog);
    const groups = result.groups
      .map(
        ([key, rows]) =>
          `<section class="result-group"><h2>${key === 'removed' ? 'Убраны из повторения' : key === 'practice' ? 'Практика · срок не изменился' : `Повторим ${dueText(Number(key))}`}</h2>${rows
            .map((r) => {
              const text = `<span>${en(catalog.byId[r.cardId]?.headword || r.cardId)}<small>${r.correct ? 'Верно с первой попытки' : 'Была ошибка'}${!r.scheduled && r.active ? ` · повторим ${dueText(r.dueAt)}` : ''}</small></span><span aria-hidden="true">${r.correct ? '✓' : '×'}</span>`;
              return catalog.byId[r.cardId]
                ? button('openCard', text, 'word-row', `data-card-id="${r.cardId}"`)
                : `<p>${text}<small>Карточка недоступна в текущем каталоге</small></p>`;
            })
            .join('')}</section>`,
      )
      .join('');
    const next = plan.due
      ? button('start', `Повторить ещё · ${Math.min(5, plan.due)}`, 'primary wide', 'data-mode="due"')
      : plan.learned < plan.norm
        ? button(
            'startFeed',
            `Новые слова · до нормы ${plan.norm - plan.learned}`,
            'primary wide',
            'data-scope=""',
          )
        : route('home', 'Продолжить', 'primary wide');
    return `${title('Подход завершён')}<p class="result-number">${result.correct}<span> / ${result.total}</span></p><p class="lede">Верно с первой попытки</p><p>${plan.due ? `К повторению осталось: ${plan.due}.` : 'На сегодня повторений больше нет.'}</p><p class="muted">${result.scheduled ? 'Расписание обновлено по первым ответам.' : 'Практика не изменила расписание.'}</p>${result.skipped ? `<p class="fine">Пропущено без ответа: ${result.skipped}. Слова удалены из повторения или недоступны.</p>` : ''}${groups}${next}${button('showMine', 'К списку', 'secondary wide')}${route('home', 'На главную', 'text-link')}`;
  }
  const a = currentAttempt(state),
    q = a.question;
  const total = session.attempts.filter((x) => !x.retry && !x.skipped).length;
  const number = session.attempts.slice(0, session.position + 1).filter((x) => !x.retry && !x.skipped).length;
  const label = a.retry
    ? 'Ещё раз после ошибки'
    : `${a.kind === 'recall' ? 'Вспомни сам' : 'Выбери ответ'} · ${number} из ${total}`;
  const attrs = `data-attempt-id="${a.id}"`;
  const answered = a.answer !== null;
  let answers;
  if (a.kind === 'choice') {
    answers = `<div class="options">${q.options
      .map((o) => {
        const right = answered && o.id === q.correctOptionId;
        const wrong = answered && o.id === a.answer.optionId && !a.answer.correct;
        return button(
          'answer',
          `${escape(o.text)}${right ? '<span>✓ Верный ответ</span>' : wrong ? '<span>× Твой ответ</span>' : ''}`,
          `option ${right ? 'right' : wrong ? 'wrong' : ''}`,
          `${attrs} data-option-id="${o.id}" ${answered ? 'disabled' : ''} ${q.direction === 'ru-to-en' ? 'lang="en"' : ''}`,
        );
      })
      .join('')}</div>`;
  } else {
    const c = catalog.byId[a.cardId];
    answers = a.revealed
      ? `<div class="recall-answer"><p class="example-en" lang="en">${escape(q.options.find((o) => o.id === q.correctOptionId).text)}</p>${c && verifiedIpa(c) ? `<p>${en(c.headword)} · ${escape(verifiedIpa(c))}</p>` : ''}<p>${escape(c?.shortRu)}</p><p>${escape(q.explanationRu)}</p></div>${answered ? '' : `<p class="fine">«Вспомнил» — если сказал эту фразу или очень близкую.</p><div class="card-actions">${button('answer', 'Не вспомнил', 'secondary', `${attrs} data-option-id="forgot"`)}${button('answer', 'Вспомнил', 'primary', `${attrs} data-option-id="recalled"`)}</div>`}`
      : button('reveal', 'Показать ответ', 'primary wide', attrs);
  }
  return `${back('training', 'Закончить позже')}${title(label)}<p class="question-context ${q.direction === 'en-to-ru' ? 'english' : ''}" ${q.direction === 'en-to-ru' ? 'lang="en"' : ''}>${escape(q.context)}</p><p>${a.kind === 'recall' ? 'Скажи по-английски вслух, затем открой ответ.' : escape(q.prompt)}</p>${answers}
    ${answered ? `<section class="feedback" role="status"><h2>${a.answer.correct ? 'Верно' : 'Пока не получилось'}</h2>${a.kind === 'choice' ? `<p>${escape(q.explanationRu)}</p>` : ''}<div class="answer-progress">${a.answer.scheduled ? stageDots(state.words[a.cardId]) : ''}<p class="fine">${a.retry ? 'Повтор ошибки. Расписание не изменилось.' : a.answer.scheduled ? (a.answer.correct ? `${state.words[a.cardId].solid ? 'Закреплено. ' : ''}Следующее повторение — ${dueText(state.words[a.cardId].dueAt)}.` : 'Была ошибка — начнём сначала. Повторим в конце подхода и завтра.') : 'Практика: расписание не изменилось.'}</p></div></section>${button('advance', 'Далее →', 'primary wide', attrs)}` : ''}
    ${answered || a.revealed ? button('openCard', 'Карточка слова →', 'text-link', `data-card-id="${a.cardId}"`) : ''}`;
}
function profile() {
  const t = tally(
    state,
    catalog.cards.map((c) => c.id),
  );
  return `${title('Профиль', 'Твоё пространство')}<h2>Прогресс на этом устройстве</h2><p>Учу ${t.learning} · закреплено ${t.solid} · знаю ${t.known}</p><p>Сохранено ответов: ${state.answers.length}</p>
    ${LEVELS.map(([id, label]) => `<details class="scope-theme"><summary>${label}</summary>${progressLine(catalog.sets.filter((s) => s.level === id).flatMap((s) => s.cardIds))}</details>`).join('')}
    ${route('profileCopy', 'Копия прогресса →', 'set-row')}${route('profileLearning', 'Обучение →', 'set-row')}${route('profileLook', 'Оформление →', 'set-row')}${route('profileReminder', 'Напоминание →', 'set-row')}${route('profileHow', 'Как устроено занятие →', 'set-row')}${route('profileAbout', 'О VocaVoca и установка →', 'set-row')}
    ${weekBlock()}${scheduleBlock()}
    <p class="muted">Прогресс хранится в этом браузере. Очистка данных сайта, приватный режим или освобождение места системой могут его удалить. Сохраняй копию в файл; автоматической синхронизации нет.</p>
    <section class="training-block"><h2>Без интернета</h2><p id="offline-status" role="status">${escape(pwa.status)}</p><p>Перед первым занятием без сети дождись сообщения о готовности офлайн-доступа.</p></section>
    <p class="fine">Каталог ${escape(catalog.version)} · сборка ${escape(pwa.build || '…')}</p>`;
}
function scheduleBlock() {
  const groups = new Map();
  Object.values(state.words)
    .filter((w) => w.status === 'learning' && catalog.byId[w.cardId])
    .sort((a, b) => a.dueAt - b.dueAt)
    .forEach((w) => {
      const key = dueText(w.dueAt);
      groups.set(key, (groups.get(key) || 0) + 1);
    });
  return `<details class="scope-theme"><summary>Когда повторим</summary>${groups.size ? [...groups].map(([day, n]) => `<p>${day} · ${n} слов</p>`).join('') : '<p>Пока нет выбранных слов.</p>'}</details>`;
}
function profileLearning() {
  return `${back('profile', 'Профиль')}${title('Обучение')}${select('Уровень', 'data-setting="level"', state.settings.level, LEVELS)}<p class="fine">Уровень меняет темы новых слов. Выбранные слова и прогресс остаются.</p>
    ${select(
      'Новых слов в день',
      'data-setting="dailyNew"',
      state.settings.dailyNew,
      [5, 10, 15, 20].map((n) => [n, String(n)]),
    )}<p class="fine">Считаются слова, отмеченные «Учить» и оставшиеся в твоём списке. Можно заниматься больше нормы.</p>
    ${select('Перевод объяснения', 'data-setting="explanationOnTap"', state.settings.explanationOnTap, [
      ['true', 'По нажатию'],
      ['false', 'Сразу'],
    ])}<p class="fine">Переводы слова и примеров открываются независимо, по нажатию.</p>`;
}
function profileLook() {
  return `${back('profile', 'Профиль')}${title('Оформление')}${select(
    'Тема',
    'data-setting="theme"',
    state.settings.theme,
    [
      ['system', 'Как на устройстве'],
      ['light', 'Светлая'],
      ['dark', 'Тёмная'],
    ],
  )}
    ${select(
      'Цвет закладки и кнопок',
      'data-setting="ribbonColor"',
      state.settings.ribbonColor,
      COLORS.map(([id, label]) => [id, label]),
    )}
    ${select('Каждый день новый цвет', 'data-setting="dailyColor"', state.settings.dailyColor, [
      ['false', 'Выключено'],
      ['true', 'По дням недели'],
    ])}<p class="fine">Сейчас — ${currentColor(state.settings)[1].toLowerCase()}. Размер текста можно менять средствами браузера.</p>`;
}
function profileReminder() {
  return `${back('profile', 'Профиль')}${title('Напоминание')}<p class="lede">Фоновые напоминания пока недоступны.</p><p>Закрытая веб-страница не может надёжно запускать ежедневное напоминание, как Android. В этой версии уведомления не запланированы.</p><p>Для регулярного времени занятия можно создать ежедневное напоминание в приложении «Напоминания» на iPhone. Оно не будет знать, остались ли слова к повторению.</p>`;
}
function profileHow() {
  return `${back('profile', 'Профиль')}${title('Как устроено занятие')}<ol class="how"><li><h2>Выбери слова</h2><p>Листай набор или тему. «Знаю» убирает знакомое из новых, «Учить» добавляет слово в повторение сегодня. Сам просмотр ничего не добавляет.</p></li><li><h2>Повтори по смыслу</h2><p>До пяти слов за подход. После ошибки слово повторится в конце один раз. Результат считается по первым попыткам.</p></li><li><h2>Возвращайся через паузу</h2><p>Паузы: 1, 3, 7, 14 и 30 дней. Через 7 дней вместо вариантов нужно вспомнить ответ самому. Ошибка возвращает к паузе в один день.</p></li><li><h2>Закрепляй</h2><p>Верное вспоминание после паузы в 30 дней даёт «Закреплено». Дальше — 60, 120 и 240 дней. Это история ответов, а не обещание владения словом.</p></li></ol><p class="fine">Учебный день начинается в 04:00 по местному времени. Тренировка раньше срока не сдвигает расписание.</p>`;
}
function profileAbout() {
  return `${back('profile', 'Профиль')}${title('VocaVoca')}<p>${catalog.cards.length} карточек · ${catalog.sets.length} готовых наборов</p><p>Каталог ${escape(catalog.version)} · сборка ${escape(pwa.build)}</p><h2>На главный экран iPhone</h2><p>Открой сайт в Safari. В меню «Поделиться» выбери «На экран Домой», включи «Открывать как веб-приложение», если этот пункт есть, и нажми «Добавить».</p><p class="fine">Для установки нужен HTTPS-адрес. Перед первым открытием без интернета дождись готовности офлайн-доступа в «Профиле».</p><h2>Шрифты</h2><p>Literata и Golos Text из Android-проекта, свободная лицензия OFL.</p><p><a href="./licenses/Literata-OFL.txt">Лицензия Literata</a> · <a href="./licenses/GolosText-OFL.txt">Лицензия Golos</a></p><p class="fine">Аккаунты и автоматическая копия Google Drive не подключены. Аудио не входит в текущие возможности VocaVoca.</p>`;
}
function profileCopy() {
  const offered = restoreOffer?.decoded;
  return `${back('profile', 'Профиль')}${title('Копия прогресса')}<p>Файл содержит выбранные слова, ответы, расписание, настройки и незавершённую тренировку. Файл создаётся на устройстве.</p>
    ${button('export', 'Сохранить копию в файл', 'primary wide')}<p class="fine">${state.lastCopyAt ? `Последняя подготовленная копия: ${new Date(state.lastCopyAt).toLocaleString('ru')}. Убедись, что файл сохранён.` : 'Копия ещё не создавалась.'}</p>
    ${button('exportAndroid', 'Подготовить файл для Android', 'secondary wide')}
    <label class="file-label">Восстановить из файла<input id="backup-file" type="file" accept=".json,.gz,.vvbak,application/json,application/gzip,application/octet-stream"></label>
    <p class="fine">Принимаются копии Web и Android версий 1–3. Экспорт для Android использует формат 3. Это ручной перенос с заменой прогресса, без синхронизации. Напоминания здесь не включаются. Сохраняй файл вне данных сайта.</p>
    ${copyNote ? `<p role="status">${escape(copyNote)}</p>` : ''}
    ${offered ? `<section class="restore-preview"><h2>Восстановить из копии?</h2><p>Копия от ${new Date(offered.createdAt).toLocaleString('ru')}. В ней ${Object.values(offered.state.words).filter((w) => ['learning', 'known'].includes(w.status)).length} выбранных и знакомых слов, ${offered.state.answers.length} ответов.</p><p>Сейчас на устройстве: ${Object.values(state.words).filter((w) => ['learning', 'known'].includes(w.status)).length} слов, ${state.answers.length} ответов.</p><p>Текущий прогресс будет заменён целиком. Перед заменой сохранится локальный снимок прежнего состояния.</p>${button('confirmRestore', 'Восстановить эту копию', 'primary wide')}${button('cancelRestore', 'Отмена', 'secondary wide')}</section>` : ''}`;
}
function render(focus = false) {
  main
    .querySelectorAll('details')
    .forEach((el) =>
      openDetails.set(`${main.dataset.view}:${el.querySelector('summary')?.textContent}`, el.open),
    );
  document.documentElement.dataset.theme =
    state.settings.theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : state.settings.theme;
  document.documentElement.dataset.color = currentColor(state.settings)[0];
  document.querySelector('meta[name="theme-color"]').content =
    document.documentElement.dataset.theme === 'dark' ? '#25231f' : '#f4f1e9';
  const pages = {
    home,
    sets: setsPage,
    theme: themePage,
    set: setPage,
    triage: triagePage,
    card: cardPage,
    scope: scopePage,
    training,
    trainSets,
    session: sessionPage,
    profile,
    profileLearning,
    profileLook,
    profileCopy,
    profileReminder,
    profileHow,
    profileAbout,
  };
  main.innerHTML = (pages[state.view] || home)();
  main.dataset.view = state.view;
  const welcoming = state.view === 'home' && !state.onboarded;
  document.body.dataset.screen = welcoming ? 'welcome' : state.view;
  nav.hidden = welcoming;
  main.querySelector('.heading-back')?.setAttribute('aria-label', 'Назад к теме');
  main.querySelectorAll('details').forEach((el) => {
    el.open = openDetails.get(`${state.view}:${el.querySelector('summary')?.textContent}`) || false;
  });
  const selected = state.view.startsWith('profile')
    ? 'profile'
    : ['sets', 'theme', 'set', 'triage', 'card'].includes(state.view)
      ? 'sets'
      : ['session', 'trainSets'].includes(state.view)
        ? 'training'
        : state.view === 'scope'
          ? 'home'
          : state.view;
  nav.innerHTML = [
    ['home', 'Главная'],
    ['sets', 'Наборы'],
    ['training', 'Тренировки'],
    ['profile', 'Профиль'],
  ]
    .map(([view, label]) =>
      button(
        'navigate',
        `${icon(view)}<span>${label}</span>`,
        selected === view ? 'selected' : '',
        `data-view="${view}" data-tab="true" ${selected === view ? 'aria-current="page"' : ''}`,
      ),
    )
    .join('');
  if (focus) {
    window.scrollTo(0, 0);
    main.querySelector('h1')?.focus({ preventScroll: true });
  }
  void checkPraise();
}
function showError(error) {
  errorBox.hidden = false;
  errorBox.textContent = `Изменения не сохранены. ${error.message || 'Нет доступа к хранилищу. Попробуй открыть приложение снова.'}`;
}
async function dispatch(command) {
  const previous = state ? locationOf(state) : null;
  state = await store.update((s) => reduce(s, command, catalog));
  const next = locationOf(state);
  if (
    command.type !== 'history' &&
    previous &&
    ['view', 'selectedSetId', 'cardId', 'cardMode', 'feedPosition'].some((key) => previous[key] !== next[key])
  ) {
    history.pushState({ voca: next }, '', location.href);
  }
  channel?.postMessage('changed');
}
async function handle(target) {
  const { action, ...data } = target.dataset;
  if (action === 'letter') {
    const heading = document.getElementById(`letter-${data.letter}`);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
    return;
  }
  const oldView = state.view;
  const oldCard = card()?.id;
  if (action === 'triageReveal') {
    visible.has(data.cardId) ? visible.delete(data.cardId) : visible.add(data.cardId);
    render();
    return;
  }
  if (action === 'fold') {
    const folded = state.dictionary.folded.includes(data.key)
      ? state.dictionary.folded.filter((key) => key !== data.key)
      : [...state.dictionary.folded, data.key];
    await dispatch({ type: 'dictionary', key: 'folded', value: folded });
    render();
    return;
  }
  if (action === 'export' || action === 'exportAndroid') {
    const current = await store.read();
    const android = action === 'exportAndroid';
    const text = android
      ? await encodeAndroidBackup(current, catalog.version)
      : await encodeBackup(current, catalog.version);
    const url = URL.createObjectURL(
      new Blob([text], { type: android ? 'application/octet-stream' : 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `vocavoca-${android ? 'android' : 'web'}-${new Date().toISOString().slice(0, 10)}.${android ? 'vvbak' : 'json'}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    await dispatch({ type: 'copySaved' });
    copyNote = 'Файл подготовлен. Сохрани его в «Файлы» или другое выбранное место.';
    render();
    return;
  }
  if (action === 'cancelRestore') {
    restoreOffer = null;
    copyNote = 'Восстановление отменено. Прогресс не изменён.';
    render();
    return;
  }
  if (action === 'confirmRestore') {
    if (!restoreOffer) return;
    state = await store.replace(
      reduce(restoreOffer.decoded.state, { type: 'reconcile' }, catalog),
      restoreOffer.revision,
    );
    restoreOffer = null;
    channel?.postMessage('changed');
    history.replaceState({ voca: locationOf(state) }, '', location.href);
    render(true);
    return;
  }
  if (action === 'translation') {
    visible.has(data.key) ? visible.delete(data.key) : visible.add(data.key);
    render();
    main.querySelector(`[data-key="${data.key}"]`)?.focus({ preventScroll: true });
    return;
  }
  if (action === 'example') {
    example = Number(data.index);
    render();
    main.querySelector(`.example-controls [data-index="${data.index}"]`)?.focus({ preventScroll: true });
    return;
  }
  if (action === 'move') {
    if (state.cardMode === 'feed') await dispatch({ type: 'feedMove', delta: Number(data.delta) });
    else {
      const ids = set().cardIds;
      const id = ids[ids.indexOf(card().id) + Number(data.delta)];
      if (id) await dispatch({ type: 'browseMove', cardId: id });
    }
  } else {
    if (
      action === 'know' &&
      wordState(state, data.cardId) === 'learning' &&
      !window.confirm('Отметить «Знаю» и убрать из повторения? История ответов останется.')
    )
      return;
    if (action === 'remove' && !window.confirm('Убрать слово из повторения? История ответов останется.'))
      return;
    await dispatch({ type: action, ...data });
  }
  errorBox.hidden = true;
  render(oldView !== state.view || oldCard !== card()?.id || action === 'advance');
  if (action === 'answer' || action === 'reveal')
    main.querySelector('.feedback, .recall-answer')?.scrollIntoView({ block: 'nearest' });
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-action]');
  if (!target || target.disabled || busy || !state) return;
  busy = true;
  pending = pending
    .then(() => handle(target))
    .catch(showError)
    .finally(() => {
      busy = false;
    });
});
document.addEventListener('input', (event) => {
  const input = event.target;
  if (!input.matches('input[data-dict]')) return;
  const value = input.value,
    start = input.selectionStart;
  pending = pending
    .then(async () => {
      await dispatch({ type: 'dictionary', key: input.dataset.dict, value });
      render();
      const field = document.querySelector('#word-search');
      field?.focus({ preventScroll: true });
      try {
        field?.setSelectionRange(start, start);
      } catch {}
    })
    .catch(showError);
});
document.addEventListener('change', (event) => {
  const field = event.target;
  if (field.id === 'scope-level') {
    pending = pending
      .then(async () => {
        await dispatch({ type: 'scopeLevel', value: field.value });
        render();
        document.getElementById('scope-level')?.focus({ preventScroll: true });
      })
      .catch(showError);
  }
  if (field.matches('select[data-setting],select[data-dict]')) {
    const key = field.dataset.setting || field.dataset.dict;
    const value =
      key === 'dailyNew'
        ? Number(field.value)
        : ['dailyColor', 'explanationOnTap'].includes(key)
          ? field.value === 'true'
          : field.value;
    pending = pending
      .then(async () => {
        await dispatch({ type: field.dataset.setting ? 'settings' : 'dictionary', key, value });
        renderedCard = null;
        render();
        document
          .querySelector(`[data-${field.dataset.setting ? 'setting' : 'dict'}="${key}"]`)
          ?.focus({ preventScroll: true });
      })
      .catch(showError);
  }
  if (field.id === 'backup-file' && field.files[0]) {
    const file = field.files[0];
    restoreOffer = null;
    copyNote = 'Проверяем копию…';
    pending = pending
      .then(async () => {
        if (file.size > MAX_BYTES) throw Error('Файл больше допустимых 8 МБ.');
        const decoded = await decodeBackup(await file.arrayBuffer());
        state = await store.read();
        restoreOffer = { decoded, revision: state.revision };
        copyNote = 'Файл проверен. Прогресс ещё не изменён.';
        render();
      })
      .catch((error) => {
        copyNote = error.message;
        render();
      });
  }
});
let touchStart = null;
main.addEventListener(
  'touchstart',
  (event) => {
    if (state?.view === 'card' && !event.target.closest('button,a,input'))
      touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    else touchStart = null;
  },
  { passive: true },
);
main.addEventListener(
  'touchend',
  (event) => {
    if (!touchStart) return;
    const dx = event.changedTouches[0].clientX - touchStart.x,
      dy = event.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.5)
      main.querySelector(`[data-action="move"][data-delta="${dx < 0 ? 1 : -1}"]`)?.click();
  },
  { passive: true },
);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state?.settings.theme === 'system') render();
});
window.addEventListener('popstate', (event) => {
  if (!state || !event.state?.voca) return;
  pending = pending
    .then(async () => {
      await dispatch({ type: 'history', location: event.state.voca });
      render(true);
    })
    .catch(showError);
});
try {
  const response = await fetch('./catalog.json');
  if (!response.ok) throw Error('Не удалось загрузить словарь. Открой приложение с интернетом.');
  catalog = indexCatalog(await response.json());
  const forms = await fetch('./search-forms.json').then((r) => {
    if (!r.ok) throw Error('Не удалось загрузить поиск.');
    return r.json();
  });
  search = createSearch(catalog.cards, forms.irregular);
  store = await openStore();
  state = await store.update((s) => reduce(s, { type: 'reconcile' }, catalog));
  history.replaceState({ voca: locationOf(state) }, '', location.href);
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel('vocavoca-pwa-progress');
    channel.onmessage = async () => {
      try {
        await pending;
        state = await store.read();
        render();
      } catch (error) {
        showError(error);
      }
    };
  }
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      try {
        await pending;
        state = await store.update((s) => reduce(s, { type: 'reconcile' }, catalog));
        render();
      } catch (error) {
        showError(error);
      }
    }
  });
  await Promise.race([
    Promise.allSettled([
      document.fonts.load('600 16px Golos'),
      document.fonts.load('600 16px Literata'),
      document.fonts.load('italic 400 16px Literata'),
    ]),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  render();
  setupPwa(
    (status) => {
      pwa = { ...pwa, ...status };
      const label = document.querySelector('#offline-status');
      if (label) label.textContent = pwa.status;
    },
    () => pending,
  );
} catch (error) {
  main.innerHTML = `${title('Не удалось открыть VocaVoca')}<p>${escape(error.message)}</p><p>Данные не сброшены. Проверь доступ к хранилищу и интернету, затем перезагрузи страницу.</p>`;
}
