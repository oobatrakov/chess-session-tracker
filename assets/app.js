import { ApiError } from './http.js';
import { getProvider, otherProvider, PROVIDER_LABELS, PROVIDER_IDS } from './providers/index.js';
import {
  CLASS_LABELS,
  OUTCOME_LABELS,
  PERIODS,
  TIME_CLASSES,
  aggregateOpenings,
  aggregateOpponents,
  chartSeries,
  latestEndTime,
  mergeGames,
  restartSessionState,
  selectGames,
  summarize,
} from './session.js';
import {
  computeAccuracy,
  computeColorStats,
  computeLossCauses,
  computeStreaks,
  computeTimeOfDay,
  computeTips,
  monthlyRatingSeries,
} from './insights.js';
import { buildRatingChart, CLASS_COLORS } from './chart.js';
import { pickQuote } from './quotes.js';
import { createDemoState } from './demo.js';

const STORAGE_KEY = 'chess-session-tracker:v2';
const LONGTERM_KEY = 'chess-session-tracker:longterm:v1';
const LONGTERM_TTL = 24 * 60 * 60 * 1000;
const POLL_MS = 30_000;
const MANUAL_COOLDOWN_MS = 4_000;
const DAY = 86_400;
const HISTORY_DAYS = 90;
const MARGIN_DAYS = 45;
const CHART_POINTS_LIMIT = 300;

const PLACEHOLDER_AVATAR = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
     <rect width="64" height="64" rx="14" fill="#1a2332"/>
     <text x="32" y="45" font-size="34" text-anchor="middle" fill="#8fb4ff">&#9822;</text>
   </svg>`,
)}`;

const SORT_LABELS = {
  rating: 'По рейтингу',
  score: 'По очкам',
};

const el = (id) => document.getElementById(id);

const ui = {
  setup: el('setup'),
  session: el('session'),
  form: el('start-form'),
  username: el('username'),
  timeClass: el('time-class'),
  startBtn: el('start-btn'),
  startLabel: el('start-btn')?.querySelector('.btn-label'),
  spinner: el('start-btn')?.querySelector('.spinner'),
  setupError: el('setup-error'),
  sessionError: el('session-error'),
  sessionNote: el('session-note'),
  quote: el('quote'),
  quoteText: el('quote-text'),
  quoteAuthor: el('quote-author'),
  sitePicker: el('site-picker'),
  avatar: el('avatar'),
  displayName: el('display-name'),
  profileLink: el('profile-link'),
  demoBadge: el('demo-badge'),
  providerBadge: el('provider-badge'),
  statusPill: el('status-pill'),
  statusText: el('status-text'),
  livePill: el('live-pill'),
  liveText: el('live-text'),
  refreshBtn: el('refresh-btn'),
  resetBtn: el('reset-btn'),
  endBtn: el('end-btn'),
  filters: el('filters'),
  wins: el('wins'),
  losses: el('losses'),
  draws: el('draws'),
  winrateValue: el('winrate-value'),
  winrateSub: el('winrate-sub'),
  accuracyMiniValue: el('accuracy-mini-value'),
  accuracyMiniSub: el('accuracy-mini-sub'),
  streakValue: el('streak-value'),
  streakSub: el('streak-sub'),
  colorDonuts: el('color-donuts'),
  ratingDelta: el('rating-delta'),
  ratingRows: el('rating-rows'),
  ratingSub: el('rating-sub'),
  last10: el('last10'),
  last10Empty: el('last10-empty'),
  tips: el('tips'),
  logCount: el('log-count'),
  logBody: el('log-body'),
  periodChips: el('period-chips'),
  analyticsStats: el('analytics-stats'),
  chart: el('chart'),
  chartCaption: el('chart-caption'),
  chartLegend: el('chart-legend'),
  opponentsBody: el('opponents-body'),
  opponentsSort: el('opponents-sort'),
  openingsBody: el('openings-body'),
  accuracyValue: el('accuracy-value'),
  accuracySub: el('accuracy-sub'),
  colorStats: el('color-stats'),
  streaks: el('streaks'),
  timeOfDay: el('time-of-day'),
  longtermChart: el('longterm-chart'),
  longtermCaption: el('longterm-caption'),
  longtermBtn: el('longterm-btn'),
};

let state = loadState();
let pollTimer = null;
let syncing = false;
let lastSyncAt = 0;
let lastError = '';
let lastManualAt = 0;
let filtersKey = '';
let freshGames = 0;
let selectedProvider = state?.provider ?? 'chesscom';
let noteTimer = null;
let longterm = { status: 'idle', series: null, fetchedAt: 0, error: '' };
let liveGame = null;

/* ---------- утилиты ---------- */

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);

const formatDelta = (value) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0');

const deltaClass = (value) => (value > 0 ? 'up' : value < 0 ? 'down' : 'flat');

const percent = (value) => `${Math.round(value * 100)}%`;

function plural(count, forms) {
  const tens = Math.abs(count) % 100;
  const ones = tens % 10;
  if (tens > 10 && tens < 20) return forms[2];
  if (ones === 1) return forms[0];
  if (ones >= 2 && ones <= 4) return forms[1];
  return forms[2];
}

function profileLabel(url, username) {
  try {
    const parsed = new URL(url);
    return `${parsed.host.replace(/^www\./, '')}${parsed.pathname}`;
  } catch {
    return username;
  }
}

function timeAgo(timestamp) {
  if (!timestamp) return 'только что';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return 'только что';
  if (seconds < 60) return `${seconds} с назад`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.floor(minutes / 60)} ч назад`;
}

function friendlyError(error) {
  switch (error?.kind) {
    case 'notfound':
      return error.message || 'Пользователь не найден.';
    case 'network':
      return 'Нет связи с сервисом. Проверьте интернет — обновление продолжится автоматически.';
    case 'ratelimit':
      return 'Сервис ограничил частоту запросов. Подождите минуту.';
    case 'timeout':
      return 'Сервис не ответил вовремя. Попробуйте ещё раз.';
    default:
      return error?.message || 'Что-то пошло не так. Попробуйте ещё раз.';
  }
}

function showAlert(node, message) {
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function showNote(message) {
  if (!ui.sessionNote) return;
  ui.sessionNote.textContent = message;
  ui.sessionNote.hidden = !message;
  clearTimeout(noteTimer);
  if (message) noteTimer = setTimeout(() => { ui.sessionNote.hidden = true; }, 9000);
}

function saveState() {
  if (!state) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* переполнение хранилища не должно ломать приложение */
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 2 || !parsed.provider || !parsed.username || !Array.isArray(parsed.games)) return null;
    // Чистим сохранённую сессию от контролей, которые больше не учитываются.
    parsed.games = parsed.games.filter((game) => TIME_CLASSES.includes(game.timeClass));
    return parsed;
  } catch {
    return null;
  }
}

function longtermCacheKey() {
  return state ? `${LONGTERM_KEY}:${state.provider}:${state.username}` : '';
}

function loadLongtermCache() {
  longterm = { status: 'idle', series: null, fetchedAt: 0, error: '' };
  if (!state) return;
  try {
    const raw = localStorage.getItem(longtermCacheKey());
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Date.now() - data.fetchedAt < LONGTERM_TTL && data.series) {
      longterm = { status: 'ready', series: data.series, fetchedAt: data.fetchedAt, error: '' };
    }
  } catch {
    /* кеш не обязателен */
  }
}

function saveLongtermCache() {
  try {
    localStorage.setItem(longtermCacheKey(), JSON.stringify({ fetchedAt: longterm.fetchedAt, series: longterm.series }));
  } catch {
    /* кеш не обязателен */
  }
}

/* ---------- площадка и контроли ---------- */

function providerClasses(providerId) {
  return getProvider(providerId).classes ?? [];
}

function renderSiteTabs() {
  if (!ui.sitePicker) return;
  ui.sitePicker.innerHTML = PROVIDER_IDS.map((providerId) => {
    const active = providerId === selectedProvider;
    return `<button type="button" class="site-tab${active ? ' is-active' : ''}" data-provider="${providerId}"
      role="tab" aria-selected="${active}">${PROVIDER_LABELS[providerId]}</button>`;
  }).join('');
}

function renderClassOptions() {
  if (!ui.timeClass) return;
  const allowed = providerClasses(selectedProvider);
  const previous = ui.timeClass.value;
  ui.timeClass.innerHTML = [
    '<option value="all">Все</option>',
    ...TIME_CLASSES.filter((timeClass) => allowed.includes(timeClass)).map(
      (timeClass) => `<option value="${timeClass}">${CLASS_LABELS[timeClass]}</option>`,
    ),
  ].join('');
  ui.timeClass.value = previous && (previous === 'all' || allowed.includes(previous)) ? previous : 'all';
}

/* ---------- запуск/остановка сессии ---------- */

function setStarting(active) {
  if (ui.startBtn) ui.startBtn.disabled = active;
  if (ui.spinner) ui.spinner.hidden = !active;
  if (ui.startLabel) ui.startLabel.textContent = active ? 'Подключаюсь…' : 'Начать сессию';
}

async function resolveProfile(providerId, name) {
  try {
    const profile = await getProvider(providerId).getProfile(name);
    return { providerId, profile };
  } catch (error) {
    if (error?.kind !== 'notfound') throw error;
    const alternative = otherProvider(providerId);
    const profile = await getProvider(alternative).getProfile(name).catch(() => null);
    if (!profile) {
      throw new ApiError(`Ник «${name}» не найден ни на Chess.com, ни на Lichess.`, { kind: 'notfound' });
    }
    return { providerId: alternative, profile, switched: true };
  }
}

async function startSession(providerId, name, timeClass, period = 'session') {
  setStarting(true);
  showAlert(ui.setupError, '');
  try {
    const { providerId: resolvedId, profile, switched } = await resolveProfile(providerId, name);
    const provider = getProvider(resolvedId);
    selectedProvider = resolvedId;
    renderSiteTabs();
    renderClassOptions();

    const ratings = await provider.getRatings(profile.username).catch(() => ({}));
    const nowSec = Math.floor(Date.now() / 1000);
    const fromSec = nowSec - (HISTORY_DAYS + MARGIN_DAYS) * DAY;
    const rawGames = await provider.getGames(profile.username, { fromSec, toSec: nowSec });
    const games = mergeGames([], rawGames);

    const allowedClasses = provider.classes ?? [];
    const chosenClass = timeClass === 'all' || allowedClasses.includes(timeClass) ? timeClass : 'all';

    state = {
      v: 2,
      provider: resolvedId,
      username: profile.username,
      displayName: profile.displayName || profile.username,
      avatar: profile.avatar || '',
      profileUrl: profile.profileUrl,
      startedAt: Date.now(),
      sinceEndTime: latestEndTime(games),
      anchors: ratings,
      games,
      timeClass: chosenClass,
      period: PERIODS.some((item) => item.id === period) ? period : 'session',
      opponentsSort: 'rating',
      lastSyncAt: Date.now(),
      demo: false,
    };

    filtersKey = '';
    lastSyncAt = Date.now();
    lastError = '';
    liveGame = null;
    loadLongtermCache();
    saveState();
    render();
    if (switched) {
      showNote(`Ник найден на ${PROVIDER_LABELS[resolvedId]} — переключил площадку автоматически.`);
    }
    startPolling();
  } catch (error) {
    showAlert(ui.setupError, friendlyError(error));
  } finally {
    setStarting(false);
  }
}

function startPolling() {
  stopPolling();
  refresh({ reason: 'start' });
  pollTimer = setInterval(() => refresh(), POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function endSession() {
  if (!state) return;
  const played = summarize(state, { timeClass: state.timeClass, period: 'session' }).total;
  if (played > 0 && !window.confirm(`Завершить сессию? Статистика (${played} партий) будет очищена.`)) {
    return;
  }
  stopPolling();
  state = null;
  liveGame = null;
  lastError = '';
  lastSyncAt = 0;
  filtersKey = '';
  longterm = { status: 'idle', series: null, fetchedAt: 0, error: '' };
  saveState();
  render();
  ui.username?.focus();
}

/** Сбрасывает отсчёт сессии, не выходя из аккаунта: история остаётся для графиков. */
function restartSession() {
  if (!state || state.demo) return;
  const played = summarize(state, { timeClass: state.timeClass, period: 'session' }).total;
  if (
    played > 0 &&
    !window.confirm(
      `Сбросить сессию? Отсчёт начнётся заново, а ${played} ${plural(played, ['партия', 'партии', 'партий'])} останется в истории для графиков.`,
    )
  ) {
    return;
  }

  state = restartSessionState(state);
  freshGames = 0;
  lastError = '';
  filtersKey = '';
  saveState();
  render();
  showNote('Сессия сброшена: отсчёт начат заново, история осталась в аналитике.');
  refresh({ reason: 'reset' });
}

/* ---------- загрузка партий ---------- */

async function refresh({ manual = false, reason = '' } = {}) {
  if (!state || state.demo || syncing) return;
  if (manual && Date.now() - lastManualAt < MANUAL_COOLDOWN_MS) return;
  if (manual) lastManualAt = Date.now();

  syncing = true;
  updateStatusText();

  try {
    const provider = getProvider(state.provider);
    const nowSec = Math.floor(Date.now() / 1000);
    const fromSec = nowSec - 3 * DAY;
    const raw = await provider.getGames(state.username, { fromSec, toSec: nowSec });
    const before = state.games.length;
    const games = mergeGames(state.games, raw);

    state.games = games;
    state.lastSyncAt = Date.now();
    lastSyncAt = Date.now();
    lastError = '';
    showAlert(ui.sessionError, '');

    if (games.length > before) {
      freshGames = games.length - before;
      setTimeout(() => { freshGames = 0; }, 2600);
    }

    try {
      liveGame = (await provider.getCurrentGame?.(state.username)) ?? null;
    } catch {
      liveGame = null;
    }

    saveState();
    render();

    if (reason === 'start' && games.length === before && !state.sinceEndTime) {
      setTimeout(() => refresh({ reason: 'catchup' }), 1500);
    }
  } catch (error) {
    lastError = friendlyError(error);
    showAlert(ui.sessionError, lastError);
  } finally {
    syncing = false;
    updateStatusText();
  }
}

async function loadLongterm() {
  if (!state || state.demo || longterm.status === 'loading') return;
  longterm = { ...longterm, status: 'loading', error: '' };
  renderLongterm();

  try {
    const provider = getProvider(state.provider);
    const nowSec = Math.floor(Date.now() / 1000);
    const games = await provider.getGames(state.username, { fromSec: nowSec - 365 * DAY, toSec: nowSec });
    longterm = {
      status: 'ready',
      series: monthlyRatingSeries(games),
      fetchedAt: Date.now(),
      error: '',
    };
    saveLongtermCache();
  } catch (error) {
    longterm = { status: 'error', series: null, fetchedAt: 0, error: friendlyError(error) };
  }

  renderLongterm();
}

/* ---------- отрисовка ---------- */

function render() {
  const active = Boolean(state);
  if (ui.setup) ui.setup.hidden = active;
  if (ui.session) ui.session.hidden = !active;
  document.body.classList.toggle('has-session', active);

  if (!active) {
    renderSiteTabs();
    updateStatusText();
    return;
  }

  const provider = getProvider(state.provider);
  ui.avatar.src = state.avatar || PLACEHOLDER_AVATAR;
  ui.avatar.alt = `Аватар ${state.displayName || state.username}`;
  ui.displayName.textContent = state.displayName || state.username;
  ui.profileLink.textContent = profileLabel(state.profileUrl, state.username);
  ui.profileLink.href = state.profileUrl;
  ui.demoBadge.hidden = !state.demo;
  if (ui.providerBadge) {
    ui.providerBadge.textContent = provider.label;
    ui.providerBadge.dataset.provider = state.provider;
  }
  ui.refreshBtn.disabled = Boolean(state.demo);
  ui.resetBtn.disabled = Boolean(state.demo);
  ui.endBtn.disabled = false;

  const summary = summarize(state, { timeClass: state.timeClass, period: 'session' });

  ui.wins.textContent = String(summary.wins);
  ui.losses.textContent = String(summary.losses);
  ui.draws.textContent = String(summary.draws);

  renderRating(summary);
  renderScoreStats(summary);
  renderFilters();
  renderLast10(summary);
  renderLiveGame();
  renderLog(summary);
  renderAnalytics();
  renderInsights();
  updateStatusText();
  showAlert(ui.sessionError, lastError);
}

function renderRating(summary) {
  const classes = summary.byClass.filter((bucket) => bucket.games > 0);

  if (!classes.length) {
    ui.ratingDelta.hidden = false;
    ui.ratingDelta.textContent = '±0';
    ui.ratingDelta.className = 'rating-delta flat';
    ui.ratingRows.hidden = true;
    ui.ratingSub.textContent = 'партий пока нет';
    return;
  }

  if (classes.length === 1) {
    const bucket = classes[0];
    ui.ratingDelta.hidden = false;
    ui.ratingDelta.textContent = bucket.delta == null ? '—' : formatDelta(bucket.delta);
    ui.ratingDelta.className = `rating-delta ${bucket.delta == null ? 'flat' : deltaClass(bucket.delta)}`;
    ui.ratingRows.hidden = true;
    ui.ratingSub.textContent =
      bucket.anchor != null && bucket.current != null
        ? `${CLASS_LABELS[bucket.class] ?? bucket.class} · ${bucket.anchor} → ${bucket.current}`
        : 'нет данных о рейтинге';
    return;
  }

  ui.ratingDelta.hidden = true;
  ui.ratingRows.hidden = false;
  ui.ratingSub.textContent = 'изменение по каждому контролю';
  ui.ratingRows.innerHTML = classes
    .map((bucket) => {
      const label = CLASS_LABELS[bucket.class] ?? bucket.class;
      const arrow = bucket.anchor != null && bucket.current != null ? `${bucket.anchor} → ${bucket.current}` : '—';
      const delta = bucket.delta == null ? '—' : formatDelta(bucket.delta);
      return `<div class="rating-row">
        <span class="rating-row-name">${escapeHtml(label)} <span class="muted">${bucket.games}</span></span>
        <span class="rating-row-arrow mono">${escapeHtml(arrow)}</span>
        <span class="rating-row-delta mono ${bucket.delta == null ? 'flat' : deltaClass(bucket.delta)}">${escapeHtml(delta)}</span>
      </div>`;
    })
    .join('');
}

function renderScoreStats(summary) {
  const games = summary.rows.slice().reverse();
  const total = summary.total;

  const winrate = total ? Math.round((summary.wins / total) * 100) : null;
  ui.winrateValue.textContent = winrate == null ? '—' : `${winrate}%`;
  ui.winrateValue.className = `mini-value ${winrate == null ? 'flat' : winrate >= 50 ? 'up' : 'down'}`;
  ui.winrateSub.textContent = total ? `${summary.wins} из ${total}` : 'нет партий';

  const accuracy = computeAccuracy(games);
  ui.accuracyMiniValue.textContent = accuracy.avg == null ? '—' : `${accuracy.avg}%`;
  ui.accuracyMiniValue.className = `mini-value ${
    accuracy.avg == null ? 'flat' : accuracy.avg >= 75 ? 'up' : accuracy.avg < 65 ? 'down' : ''
  }`.trim();
  ui.accuracyMiniSub.textContent =
    accuracy.avg == null
      ? 'нет данных'
      : `${accuracy.games} ${plural(accuracy.games, ['партия', 'партии', 'партий'])}`;

  const streaks = computeStreaks(games);
  const current = streaks.current;
  const streakLabels = { win: 'побед подряд', loss: 'поражений подряд', draw: 'ничьих подряд' };
  if (current.count) {
    const sign = current.outcome === 'win' ? '+' : current.outcome === 'loss' ? '−' : '=';
    ui.streakValue.textContent = current.outcome === 'win' ? `🔥 ${sign}${current.count}` : `${sign}${current.count}`;
    ui.streakValue.className = `mini-value ${current.outcome === 'win' ? 'up' : current.outcome === 'loss' ? 'down' : 'flat'}`;
    ui.streakSub.textContent = streakLabels[current.outcome] ?? '';
  } else {
    ui.streakValue.textContent = '—';
    ui.streakValue.className = 'mini-value flat';
    ui.streakSub.textContent = 'нет партий';
  }

  const colorStats = computeColorStats(games);
  ui.colorDonuts.innerHTML = colorStats
    .map((row) => {
      const played = row.games;
      const name = row.color === 'white' ? 'Белые' : 'Чёрные';
      const pieceClass = row.color === 'white' ? 'white' : 'black';
      const score = played ? Math.round(row.score * 100) : null;
      const title = played
        ? `${name}: ${row.wins}–${row.draws}–${row.losses} (${score}% очков)`
        : `${name}: нет партий`;
      const w = played ? (row.wins / played) * 100 : 0;
      const d = played ? (row.draws / played) * 100 : 0;
      const l = played ? (row.losses / played) * 100 : 0;
      return `<div class="color-donut" role="img" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">
        <span class="donut${played ? '' : ' is-empty'}" style="--w:${w}; --d:${d}; --l:${l}">
          <b class="donut-piece ${pieceClass}" aria-hidden="true">♞</b>
        </span>
        <span class="donut-score">${score == null ? '—' : `${score}%`}</span>
      </div>`;
    })
    .join('');
}

function renderFilters() {
  const periodGames = selectGames(state.games, {
    period: state.period,
    timeClass: 'all',
    sinceEndTime: state.sinceEndTime,
  });

  const counts = { all: periodGames.length };
  for (const game of periodGames) {
    counts[game.timeClass] = (counts[game.timeClass] ?? 0) + 1;
  }

  if (!periodGames.length) {
    ui.filters.hidden = true;
    ui.filters.innerHTML = '';
    filtersKey = 'empty';
    return;
  }
  ui.filters.hidden = false;

  const options = ['all', ...TIME_CLASSES.filter((timeClass) => counts[timeClass])];
  const key = `${state.period}|${state.timeClass}|${options.map((timeClass) => `${timeClass}:${counts[timeClass]}`).join(',')}`;
  if (key === filtersKey) return;
  filtersKey = key;

  ui.filters.innerHTML = options
    .map((timeClass) => {
      const active = timeClass === state.timeClass;
      return `<button type="button" class="chip${active ? ' is-active' : ''}"
        data-class="${timeClass}" role="tab" aria-selected="${active}">
        ${escapeHtml(CLASS_LABELS[timeClass] ?? timeClass)}
        <span class="chip-count">${counts[timeClass] ?? 0}</span>
      </button>`;
    })
    .join('');
}

function renderLast10(summary) {
  // Свежая партия — справа: разворачиваем список «новые первыми» в хронологию.
  const games = summary.last10.slice().reverse();
  ui.last10Empty.hidden = games.length > 0;
  ui.last10.innerHTML = games
    .map((game, index) => {
      const outcome = OUTCOME_LABELS[game.outcome] ?? game.outcome;
      const color = game.color === 'white' ? 'белые' : 'чёрные';
      const rating = game.opponentRating ? ` (${game.opponentRating})` : '';
      const delta = game.ratingDiff == null ? '' : ` · ${formatDelta(game.ratingDiff)}`;
      const tip = `${outcome} · ${color} · ${game.opponent}${rating} · ${CLASS_LABELS[game.timeClass] ?? game.timeClass}${delta}`;
      const href = game.url ? ` href="${escapeHtml(game.url)}" target="_blank" rel="noreferrer"` : '';
      const tag = game.url ? 'a' : 'span';
      const latest = index === games.length - 1;
      const icon = `<${tag} class="game-icon ${game.outcome} ${game.color === 'white' ? 'white' : 'black'}${latest ? ' is-latest' : ''}"${href} title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">
        <span class="game-color" aria-hidden="true"></span>
      </${tag}>`;
      return latest ? `<span class="latest-wrap">${icon}</span>` : icon;
    })
    .join('');

  if (freshGames > 0) {
    ui.last10.classList.remove('is-fresh');
    void ui.last10.offsetWidth;
    ui.last10.classList.add('is-fresh');
  }
}

function renderLiveGame() {
  if (!ui.livePill) return;
  if (!liveGame) {
    ui.livePill.hidden = true;
    return;
  }
  ui.livePill.hidden = false;
  const label = CLASS_LABELS[liveGame.timeClass] ?? 'Партия';
  ui.liveText.textContent = liveGame.opponent ? `${label} · против ${liveGame.opponent}` : `${label} · ваш ход`;
  if (liveGame.url) {
    ui.liveText.href = liveGame.url;
    ui.liveText.removeAttribute('aria-disabled');
  } else {
    ui.liveText.removeAttribute('href');
  }
}

function renderLog(summary) {
  ui.logCount.textContent = summary.total ? `— ${summary.total}` : '';

  if (!summary.rows.length) {
    ui.logBody.innerHTML = '<tr><td colspan="5" class="log-empty">Партий пока нет. Сыграйте — и они появятся здесь.</td></tr>';
    return;
  }

  ui.logBody.innerHTML = summary.rows
    .map((game) => {
      const date = new Date(game.endTime * 1000);
      const when = date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const opponent = game.url
        ? `<a href="${escapeHtml(game.url)}" target="_blank" rel="noreferrer">${escapeHtml(game.opponent)}</a>`
        : escapeHtml(game.opponent);
      const opponentRating = game.opponentRating ? ` <span class="muted">${game.opponentRating}</span>` : '';
      const rating = game.myRating ?? '—';
      const delta =
        game.ratingDiff == null
          ? ''
          : ` <span class="mono ${deltaClass(game.ratingDiff)}">${formatDelta(game.ratingDiff)}</span>`;
      return `<tr>
        <td class="mono">${escapeHtml(when)}</td>
        <td>${game.color === 'white' ? 'белые' : 'чёрные'}</td>
        <td>${opponent}${opponentRating}</td>
        <td class="res-${game.outcome}">${escapeHtml(OUTCOME_LABELS[game.outcome] ?? game.outcome)}</td>
        <td class="mono">${rating}${delta}</td>
      </tr>`;
    })
    .join('');
}

/* ---------- аналитика ---------- */

function periodGames() {
  if (!state) return [];
  return selectGames(state.games, {
    period: state.period,
    timeClass: state.timeClass,
    sinceEndTime: state.sinceEndTime,
  });
}

function renderAnalytics() {
  const games = periodGames();

  renderPeriodChips();

  const summary = summarize(state, { timeClass: state.timeClass, period: state.period });
  ui.analyticsStats.textContent = summary.total
    ? `${summary.total} партий · ${summary.wins}–${summary.losses}–${summary.draws}`
    : 'пока пусто';

  renderChart(games);
  renderSortChips();
  renderOpponents(aggregateOpponents(games, { limit: 5, sortBy: state.opponentsSort ?? 'rating' }));
  renderOpenings(aggregateOpenings(games));
  renderTips(games);
}

function chipMarkup(items, activeValue, name) {
  return items
    .map((item) => {
      const active = item.id === activeValue;
      return `<button type="button" class="chip chip--sm${active ? ' is-active' : ''}"
        data-${name}="${item.id}" role="tab" aria-selected="${active}">${escapeHtml(item.label)}</button>`;
    })
    .join('');
}

function renderPeriodChips() {
  const key = `${state.period}`;
  if (ui.periodChips.dataset.key === key) return;
  ui.periodChips.dataset.key = key;
  ui.periodChips.innerHTML = chipMarkup(PERIODS, state.period, 'period');
}

function renderSortChips() {
  const items = Object.entries(SORT_LABELS).map(([id, label]) => ({ id, label }));
  const active = state.opponentsSort ?? 'rating';
  const key = active;
  if (ui.opponentsSort.dataset.key === key) return;
  ui.opponentsSort.dataset.key = key;
  ui.opponentsSort.innerHTML = items
    .map((item) => {
      const isActive = item.id === active;
      return `<button type="button" class="chip chip--xs${isActive ? ' is-active' : ''}"
        data-sort="${item.id}" role="tab" aria-selected="${isActive}">${escapeHtml(item.label)}</button>`;
    })
    .join('');
}

function renderChart(games) {
  const chartGames = games.filter((game) => game.myRating != null);
  if (!chartGames.length) {
    ui.chart.innerHTML = '<div class="chart-empty">Нет данных о рейтинге за выбранный период</div>';
    ui.chartCaption.textContent = '';
    ui.chartLegend.innerHTML = '';
    return;
  }

  const byClass = new Map();
  for (const game of chartGames) {
    if (!byClass.has(game.timeClass)) byClass.set(game.timeClass, []);
    byClass.get(game.timeClass).push(game);
  }

  const classes = [...byClass.keys()]
    .filter((timeClass) => TIME_CLASSES.includes(timeClass))
    .sort((a, b) => TIME_CLASSES.indexOf(a) - TIME_CLASSES.indexOf(b));

  const toPoint = (game) => ({
    value: game.myRating,
    endTime: game.endTime,
    outcome: game.outcome,
    opponent: game.opponent,
    ratingDiff: game.ratingDiff,
  });

  if (state.timeClass === 'all' && classes.length > 1) {
    const series = classes
      .filter((timeClass) => byClass.get(timeClass).length >= 2)
      .map((timeClass) => ({
        label: CLASS_LABELS[timeClass],
        timeClass,
        color: CLASS_COLORS[timeClass],
        points: byClass.get(timeClass).map(toPoint).slice(-CHART_POINTS_LIMIT),
      }));

    if (series.length >= 2) {
      const shown = series.reduce((sum, item) => sum + item.points.length, 0);
      ui.chart.innerHTML = buildRatingChart(series, { showOutcomes: false });
      ui.chartCaption.textContent =
        shown < chartGames.length
          ? `${chartGames.length} партий · на графике последние ${shown}`
          : `${chartGames.length} партий · ${series.length} контроля`;
      ui.chartLegend.innerHTML = series
        .map(
          (item) =>
            `<span class="legend-item"><span class="legend-dot" style="background:${item.color}"></span>${escapeHtml(item.label)}</span>`,
        )
        .join('');
      return;
    }
  }

  const targetClass =
    state.timeClass !== 'all'
      ? state.timeClass
      : classes.slice().sort((a, b) => byClass.get(b).length - byClass.get(a).length)[0];

  const points = chartSeries(byClass.get(targetClass) ?? []).slice(-CHART_POINTS_LIMIT);
  if (!points.length) {
    ui.chart.innerHTML = '<div class="chart-empty">Нет данных о рейтинге за выбранный период</div>';
    ui.chartCaption.textContent = '';
    ui.chartLegend.innerHTML = '';
    return;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.value - first.value;
  ui.chart.innerHTML = buildRatingChart(points);
  ui.chartCaption.textContent = `${first.value} → ${last.value} (${formatDelta(delta)}) · ${points.length} партий · ${CLASS_LABELS[targetClass] ?? ''}`;
  ui.chartLegend.innerHTML = '';
}

function renderOpponents(rows) {
  if (!rows.length) {
    ui.opponentsBody.innerHTML = '<tr><td colspan="4" class="log-empty">Пока нет партий за этот период</td></tr>';
    return;
  }

  ui.opponentsBody.innerHTML = rows
    .map((row) => {
      const rating = row.avgRating ? `<span class="muted">${row.avgRating}</span>` : '';
      const score = Math.round(row.score * 100);
      return `<tr>
        <td class="cell-name">${escapeHtml(row.name)} ${rating}</td>
        <td class="mono num">${row.games}</td>
        <td class="mono small">${row.wins}–${row.losses}–${row.draws}</td>
        <td class="mono num ${score >= 50 ? 'up' : 'down'}">${score}%</td>
      </tr>`;
    })
    .join('');
}

function renderOpenings(rows) {
  if (!rows.length) {
    ui.openingsBody.innerHTML = '<tr><td colspan="4" class="log-empty">Пока нет партий за этот период</td></tr>';
    return;
  }

  ui.openingsBody.innerHTML = rows
    .map((row) => {
      const eco = row.eco ? `<span class="eco">${escapeHtml(row.eco)}</span>` : '';
      const score = Math.round(row.score * 100);
      return `<tr>
        <td class="cell-opening">${eco}<span class="opening-name">${escapeHtml(row.name ?? 'Без дебюта')}</span></td>
        <td class="mono num">${row.games}</td>
        <td class="mono small">${row.wins}–${row.losses}–${row.draws}</td>
        <td class="mono num ${score >= 50 ? 'up' : 'down'}">${score}%</td>
      </tr>`;
    })
    .join('');
}

function renderTips(games) {
  const tips = computeTips({
    games,
    accuracy: computeAccuracy(games),
    colorStats: computeColorStats(games),
    lossCauses: computeLossCauses(games),
    timeOfDay: computeTimeOfDay(games),
  });

  if (!tips.length) {
    ui.tips.hidden = true;
    ui.tips.textContent = '';
    return;
  }

  ui.tips.hidden = false;
  ui.tips.textContent = tips.join(' ');
}

/* ---------- дополнительные блоки ---------- */

function renderInsights() {
  const games = periodGames();

  const accuracy = computeAccuracy(games);
  if (accuracy.avg == null) {
    ui.accuracyValue.textContent = '—';
    ui.accuracyValue.className = 'insight-value flat';
    ui.accuracySub.textContent = 'Нет данных о точности за период';
  } else {
    ui.accuracyValue.textContent = `${accuracy.avg}%`;
    ui.accuracyValue.className = `insight-value ${accuracy.avg >= 75 ? 'up' : accuracy.avg < 65 ? 'down' : ''}`;
    const parts = [`по ${accuracy.games} партиям`];
    if (accuracy.winAvg != null) parts.push(`в победах ${accuracy.winAvg}%`);
    if (accuracy.lossAvg != null) parts.push(`в поражениях ${accuracy.lossAvg}%`);
    ui.accuracySub.textContent = parts.join(' · ');
  }

  renderColorStats(games);
  renderStreaks(games);
  renderTimeOfDay(games);
  renderLongterm();
}

function renderColorStats(games) {
  const stats = computeColorStats(games);
  ui.colorStats.innerHTML = stats
    .map((row) => {
      const label = row.color === 'white' ? 'Белые' : 'Чёрные';
      return `<div class="color-row">
        <span>${label}</span>
        <span class="color-bar"><span style="width:${Math.round(row.score * 100)}%; background:${row.color === 'white' ? 'var(--win)' : 'var(--accent)'}"></span></span>
        <span class="color-value">${row.games ? percent(row.score) : '—'} <span class="color-games">${row.games}</span></span>
      </div>`;
    })
    .join('');
}

function renderStreaks(games) {
  const streaks = computeStreaks(games);
  const current =
    streaks.current.outcome === 'win'
      ? `+${streaks.current.count}`
      : streaks.current.outcome === 'loss'
        ? `−${streaks.current.count}`
        : '0';

  const rows = [
    ['Сейчас', streaks.current.count ? `${current} ${OUTCOME_LABELS[streaks.current.outcome] ?? ''}` : '—'],
    ['Лучшая серия побед', `${streaks.bestWin}`],
    ['Без поражений', `${streaks.bestUnbeaten}`],
  ];

  ui.streaks.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="streak-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`,
    )
    .join('');
}

function renderTimeOfDay(games) {
  const buckets = computeTimeOfDay(games).filter((bucket) => bucket.games > 0);

  if (!buckets.length) {
    ui.timeOfDay.innerHTML = '<div class="insight-sub">Пока нет партий за период</div>';
    return;
  }

  ui.timeOfDay.innerHTML = buckets
    .map(
      (bucket) => `<div class="tod-row">
        <span>${bucket.label}</span>
        <span class="tod-bar"><span style="width:${Math.round(bucket.score * 100)}%"></span></span>
        <span class="tod-value">${percent(bucket.score)}</span>
        <span class="tod-games">${bucket.games}</span>
      </div>`,
    )
    .join('');
}

function renderLongterm() {
  if (!ui.longtermBtn) return;

  const loading = longterm.status === 'loading';
  ui.longtermBtn.disabled = loading || !state || state.demo;
  ui.longtermBtn.textContent = loading ? 'Загружаю…' : 'За 12 месяцев';

  if (longterm.series) {
    const classes =
      state.timeClass === 'all'
        ? Object.keys(longterm.series).filter((timeClass) => TIME_CLASSES.includes(timeClass))
        : [state.timeClass];

    const series = classes
      .filter((timeClass) => (longterm.series[timeClass] ?? []).length)
      .map((timeClass) => ({
        label: CLASS_LABELS[timeClass],
        timeClass,
        color: CLASS_COLORS[timeClass],
        points: longterm.series[timeClass],
      }));

    if (series.length) {
      ui.longtermChart.innerHTML = buildRatingChart(series, { height: 220, showOutcomes: false });
      const parts = series.map((item) => {
        const first = item.points[0];
        const last = item.points[item.points.length - 1];
        return `${item.label}: ${first.value} → ${last.value}`;
      });
      ui.longtermCaption.textContent = `${parts.join(' · ')} · закешировано ${timeAgo(longterm.fetchedAt)}`;
      return;
    }
  }

  if (longterm.status === 'error') {
    ui.longtermChart.innerHTML = `<div class="chart-empty">${escapeHtml(longterm.error)}</div>`;
    ui.longtermCaption.textContent = '';
    return;
  }

  ui.longtermChart.innerHTML =
    '<div class="chart-empty">Нажмите «За 12 месяцев», чтобы подгрузить историю рейтинга.</div>';
  ui.longtermCaption.textContent = '';
}

/* ---------- статус, карточка, CSV ---------- */

function updateStatusText() {
  if (!state || !ui.statusText || !ui.statusPill) return;

  if (state.demo) {
    ui.statusPill.dataset.tone = 'demo';
    ui.statusText.textContent = 'демо-режим';
    return;
  }
  if (syncing) {
    ui.statusPill.dataset.tone = 'sync';
    ui.statusText.textContent = 'обновляю…';
    return;
  }
  if (lastError) {
    ui.statusPill.dataset.tone = 'error';
    ui.statusText.textContent = 'нет связи, повторяю';
    return;
  }
  ui.statusPill.dataset.tone = 'live';
  ui.statusText.textContent = `обновлено ${timeAgo(lastSyncAt)}`;
}

/* ---------- события ---------- */

ui.sitePicker?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-provider]');
  if (!button) return;
  selectedProvider = button.dataset.provider;
  renderSiteTabs();
  renderClassOptions();
  showAlert(ui.setupError, '');
});

ui.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = ui.username.value.trim();
  if (!name) {
    showAlert(ui.setupError, 'Введите имя пользователя.');
    ui.username.focus();
    return;
  }
  startSession(selectedProvider, name, ui.timeClass.value);
});

ui.filters.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-class]');
  if (!button || !state) return;
  state.timeClass = button.dataset.class;
  saveState();
  render();
});

ui.periodChips.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-period]');
  if (!button || !state) return;
  state.period = button.dataset.period;
  saveState();
  render();
});

ui.opponentsSort.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-sort]');
  if (!button || !state) return;
  state.opponentsSort = button.dataset.sort;
  saveState();
  render();
});

ui.longtermBtn.addEventListener('click', loadLongterm);
ui.refreshBtn.addEventListener('click', () => refresh({ manual: true }));
ui.resetBtn.addEventListener('click', restartSession);
ui.endBtn.addEventListener('click', endSession);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state && !state.demo) refresh();
});

ui.avatar.addEventListener('error', () => {
  ui.avatar.src = PLACEHOLDER_AVATAR;
});

setInterval(updateStatusText, 1000);

/* ---------- старт ---------- */

(function init() {
  const params = new URLSearchParams(window.location.search);
  const presetUser = params.get('user');
  const presetSite = params.get('site');
  if (presetSite && PROVIDER_IDS.includes(presetSite)) selectedProvider = presetSite;
  if (presetUser) ui.username.value = presetUser.trim();

  const quote = pickQuote();
  if (ui.quoteText) ui.quoteText.textContent = `«${quote.text}»`;
  if (ui.quoteAuthor) ui.quoteAuthor.textContent = quote.author;

  if (params.get('demo') === '1') {
    state = createDemoState();
    selectedProvider = state.provider;
    lastSyncAt = Date.now();
  } else if (state) {
    selectedProvider = state.provider;
    lastSyncAt = Date.now();
    loadLongtermCache();
  } else {
    lastSyncAt = Date.now();
  }

  renderSiteTabs();
  renderClassOptions();
  render();

  if (!state && presetUser && params.get('start') === '1') {
    const timeClass = params.get('class') ?? 'all';
    startSession(selectedProvider, presetUser.trim(), timeClass, params.get('period') ?? 'session');
    return;
  }

  if (state && !state.demo) startPolling();
  if (!state) ui.username.focus();
})();
