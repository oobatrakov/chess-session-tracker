import { ApiError } from './http.js';
import { getProvider, otherProvider, PROVIDER_LABELS, PROVIDER_IDS } from './providers/index.js';
import {
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
  totalPlayTime,
} from './session.js';
import {
  applyStaticTranslations,
  classLabel,
  gamesWord,
  getLanguage,
  getLocale,
  LANG_STORAGE_KEY,
  outcomeLabel,
  periodLabel,
  setLanguage as setI18nLanguage,
  sortLabel,
  t,
  timeBucketLabel,
} from './i18n.js';
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
  langSwitch: el('lang-switch'),
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
  playtime: el('playtime'),
  playtimeValue: el('playtime-value'),
  winrateValue: el('winrate-value'),
  accuracyMiniValue: el('accuracy-mini-value'),
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
  chartTip: el('chart-tip'),
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
let chartTipTimer = null;
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

function formatPlayTime(seconds) {
  if (seconds < 60) return t('duration.sec', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return minutes < 10 && rest
      ? t('duration.minSec', { min: minutes, sec: rest })
      : t('duration.min', { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t('duration.hourMin', { hours, min: rest }) : t('duration.hour', { count: hours });
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
  if (!timestamp) return t('time.justNow');
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return t('time.justNow');
  if (seconds < 60) return t('time.secAgo', { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('time.minAgo', { count: minutes });
  return t('time.hourAgo', { count: Math.floor(minutes / 60) });
}

function friendlyError(error) {
  switch (error?.kind) {
    case 'notfound':
      return error.message || t('error.userNotFound');
    case 'network':
      return t('error.network');
    case 'ratelimit':
      return t('error.ratelimit');
    case 'timeout':
      return t('error.timeout');
    default:
      return error?.message || t('error.generic');
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
    `<option value="all">${t('setup.all')}</option>`,
    ...TIME_CLASSES.filter((timeClass) => allowed.includes(timeClass)).map(
      (timeClass) => `<option value="${timeClass}">${classLabel(timeClass)}</option>`,
    ),
  ].join('');
  ui.timeClass.value = previous && (previous === 'all' || allowed.includes(previous)) ? previous : 'all';
}

/* ---------- запуск/остановка сессии ---------- */

function setStarting(active) {
  if (ui.startBtn) ui.startBtn.disabled = active;
  if (ui.spinner) ui.spinner.hidden = !active;
  if (ui.startLabel) ui.startLabel.textContent = active ? t('setup.connecting') : t('setup.start');
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
      throw new ApiError(t('error.usernameNotFound', { name }), { kind: 'notfound' });
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
      showNote(t('note.switched', { provider: PROVIDER_LABELS[resolvedId] }));
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
  if (
    played > 0 &&
    !window.confirm(t('dialog.end', { count: played, games: gamesWord(played) }))
  ) {
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
    !window.confirm(t('dialog.reset', { count: played, games: gamesWord(played) }))
  ) {
    return;
  }

  state = restartSessionState(state);
  freshGames = 0;
  lastError = '';
  filtersKey = '';
  saveState();
  render();
  showNote(t('note.reset'));
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
  ui.avatar.alt = t('player.avatar', { name: state.displayName || state.username });
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
  renderPlaytime(summary);
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
    ui.ratingSub.textContent = t('session.noGames');
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
        ? `${classLabel(bucket.class)} · ${bucket.anchor} → ${bucket.current}`
        : t('session.noRatingData');
    return;
  }

  ui.ratingDelta.hidden = true;
  ui.ratingRows.hidden = false;
  ui.ratingSub.textContent = t('session.ratingByClass');
  ui.ratingRows.innerHTML = classes
    .map((bucket) => {
      const label = classLabel(bucket.class);
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

  const accuracy = computeAccuracy(games);
  ui.accuracyMiniValue.textContent = accuracy.avg == null ? '—' : `${accuracy.avg}%`;
  ui.accuracyMiniValue.className = `mini-value ${
    accuracy.avg == null ? 'flat' : accuracy.avg >= 75 ? 'up' : accuracy.avg < 65 ? 'down' : ''
  }`.trim();

  const streaks = computeStreaks(games);
  const current = streaks.current;
  if (current.count) {
    const sign = current.outcome === 'win' ? '+' : current.outcome === 'loss' ? '−' : '=';
    const icon = current.outcome === 'win' ? '🔥' : current.outcome === 'loss' ? '☁️' : '🤝';
    ui.streakValue.textContent = `${icon} ${sign}${current.count}`;
    ui.streakValue.className = `mini-value ${current.outcome === 'win' ? 'up' : current.outcome === 'loss' ? 'down' : 'flat'}`;
    ui.streakSub.textContent = t(`streak.${current.outcome}`);
  } else {
    ui.streakValue.textContent = '—';
    ui.streakValue.className = 'mini-value flat';
    ui.streakSub.textContent = t('streak.none');
  }

  const colorStats = computeColorStats(games);
  ui.colorDonuts.innerHTML = colorStats
    .map((row) => {
      const played = row.games;
      const name = t(`color.${row.color}`);
      const pieceClass = row.color === 'white' ? 'white' : 'black';
      const score = played ? Math.round(row.score * 100) : null;
      const title = played
        ? t('color.title', {
            name,
            wins: row.wins,
            draws: row.draws,
            losses: row.losses,
            score,
          })
        : t('color.titleEmpty', { name });
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

function renderPlaytime(summary) {
  if (!ui.playtime || !ui.playtimeValue) return;
  const seconds = totalPlayTime(summary.rows);
  if (!seconds) {
    ui.playtime.hidden = true;
    return;
  }
  ui.playtime.hidden = false;
  ui.playtimeValue.textContent = formatPlayTime(seconds);
  ui.playtime.title = t('session.playtimeTitle');
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
        ${escapeHtml(classLabel(timeClass))}
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
      const outcome = outcomeLabel(game.outcome);
      const color = game.color === 'white' ? t('color.white') : t('color.black');
      const rating = game.opponentRating ? ` (${game.opponentRating})` : '';
      const delta = game.ratingDiff == null ? '' : ` · ${formatDelta(game.ratingDiff)}`;
      const tip = `${outcome} · ${color} · ${game.opponent}${rating} · ${classLabel(game.timeClass)}${delta}`;
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
  const label =
    liveGame.timeClass && liveGame.timeClass !== 'unknown'
      ? classLabel(liveGame.timeClass)
      : t('player.liveFallback');
  ui.liveText.textContent = liveGame.opponent
    ? t('player.liveVs', { label, opponent: liveGame.opponent })
    : t('player.liveYourTurn', { label });
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
    ui.logBody.innerHTML = `<tr><td colspan="5" class="log-empty">${escapeHtml(t('log.empty'))}</td></tr>`;
    return;
  }

  ui.logBody.innerHTML = summary.rows
    .map((game) => {
      const date = new Date(game.endTime * 1000);
      const when = date.toLocaleString(getLocale(), {
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
        <td>${game.color === 'white' ? t('color.white') : t('color.black')}</td>
        <td>${opponent}${opponentRating}</td>
        <td class="res-${game.outcome}">${escapeHtml(outcomeLabel(game.outcome))}</td>
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
  ui.analyticsStats.textContent = summary.total ? t('analytics.selectedPeriod') : t('analytics.empty');

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
  const key = `${state.period}|${getLanguage()}`;
  if (ui.periodChips.dataset.key === key) return;
  ui.periodChips.dataset.key = key;
  const items = PERIODS.map((period) => ({ id: period.id, label: periodLabel(period.id) }));
  ui.periodChips.innerHTML = chipMarkup(items, state.period, 'period');
}

function renderSortChips() {
  const items = ['rating', 'score'].map((id) => ({ id, label: sortLabel(id) }));
  const active = state.opponentsSort ?? 'rating';
  const key = `${active}|${getLanguage()}`;
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

function hideChartTip() {
  if (!ui.chartTip) return;
  ui.chartTip.hidden = true;
  document.querySelectorAll('.chart-focus').forEach((node) => node.setAttribute('hidden', ''));
}

function showChartTip(hit, clientX, clientY) {
  if (!ui.chartTip) return;
  const data = hit.dataset;
  if (!data.rating) return;

  const diffValue = data.diff == null || data.diff === '' ? null : Number(data.diff);
  const diff =
    diffValue == null || !Number.isFinite(diffValue)
      ? ''
      : `<span class="chart-tip-diff ${deltaClass(diffValue)}">${formatDelta(diffValue)}</span>`;
  const outcome = data.outcome ? outcomeLabel(data.outcome) : '';
  const color = data.color === 'white' ? t('color.white') : data.color === 'black' ? t('color.black') : '';
  const outcomeLine = outcome
    ? `<div class="chart-tip-outcome ${data.outcome}">${escapeHtml(outcome)}${color ? ` · ${color}` : ''}</div>`
    : '';

  const details = [];
  if (data.opponent) {
    details.push(t('tooltip.vs', {
      name: `${escapeHtml(data.opponent)}${data.opponentRating ? ` (${data.opponentRating})` : ''}`,
    }));
  }
  const controlLabel = data.timeClass ? classLabel(data.timeClass) : data.series;
  if (controlLabel) details.push(escapeHtml(controlLabel));
  const detailsLine = details.length ? `<div class="chart-tip-sub">${details.join(' · ')}</div>` : '';

  const date = new Date(Number(data.time) * 1000);
  const dateText =
    data.kind === 'month'
      ? date.toLocaleDateString(getLocale(), { month: 'long', year: 'numeric' })
      : date.toLocaleString(getLocale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  ui.chartTip.innerHTML = `<div class="chart-tip-value">${escapeHtml(data.rating)}${diff}</div>${outcomeLine}${detailsLine}<div class="chart-tip-date">${escapeHtml(dateText)}</div>`;
  ui.chartTip.hidden = false;

  const rect = ui.chartTip.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY - rect.height - 12;
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - 14;
  if (top < 8) top = clientY + 18;
  left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - rect.height - 8));
  ui.chartTip.style.left = `${left}px`;
  ui.chartTip.style.top = `${top}px`;

  const focus = hit.ownerSVGElement?.querySelector('.chart-focus');
  if (focus) {
    focus.removeAttribute('hidden');
    focus.setAttribute('cx', hit.getAttribute('cx'));
    focus.setAttribute('cy', hit.getAttribute('cy'));
  }
}

function bindChartTooltip(container) {
  if (!container) return;
  container.addEventListener('pointermove', (event) => {
    const hit = event.target.closest?.('.chart-hit');
    if (!hit) {
      hideChartTip();
      return;
    }
    showChartTip(hit, event.clientX, event.clientY);
  });
  container.addEventListener('pointerleave', hideChartTip);
  container.addEventListener('pointerdown', (event) => {
    const hit = event.target.closest?.('.chart-hit');
    if (!hit) return;
    showChartTip(hit, event.clientX, event.clientY);
    clearTimeout(chartTipTimer);
    chartTipTimer = setTimeout(hideChartTip, 2600);
  });
}

function renderChart(games) {
  hideChartTip();
  const chartGames = games.filter((game) => game.myRating != null);
  if (!chartGames.length) {
    ui.chart.innerHTML = `<div class="chart-empty">${escapeHtml(t('analytics.chartEmpty'))}</div>`;
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
    timeClass: game.timeClass,
    color: game.color,
    outcome: game.outcome,
    opponent: game.opponent,
    ratingDiff: game.ratingDiff,
  });

  if (state.timeClass === 'all' && classes.length > 1) {
    const series = classes
      .filter((timeClass) => byClass.get(timeClass).length >= 2)
      .map((timeClass) => ({
        label: classLabel(timeClass),
        timeClass,
        color: CLASS_COLORS[timeClass],
        points: byClass.get(timeClass).map(toPoint).slice(-CHART_POINTS_LIMIT),
      }));

    if (series.length >= 2) {
      const shown = series.reduce((sum, item) => sum + item.points.length, 0);
      ui.chart.innerHTML = buildRatingChart(series, { showOutcomes: false });
      ui.chartCaption.textContent =
        shown < chartGames.length
          ? t('analytics.chartMultiShown', {
              count: chartGames.length,
              games: gamesWord(chartGames.length),
              shown,
            })
          : t('analytics.chartMulti', {
              count: chartGames.length,
              games: gamesWord(chartGames.length),
              series: series.length,
            });
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
    ui.chart.innerHTML = `<div class="chart-empty">${escapeHtml(t('analytics.chartEmpty'))}</div>`;
    ui.chartCaption.textContent = '';
    ui.chartLegend.innerHTML = '';
    return;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.value - first.value;
  ui.chart.innerHTML = buildRatingChart(points);
  ui.chartCaption.textContent = t('analytics.chartSingle', {
    from: first.value,
    to: last.value,
    delta: formatDelta(delta),
    count: points.length,
    games: gamesWord(points.length),
    class: classLabel(targetClass),
  });
  ui.chartLegend.innerHTML = '';
}

function renderOpponents(rows) {
  if (!rows.length) {
    ui.opponentsBody.innerHTML = `<tr><td colspan="4" class="log-empty">${escapeHtml(t('analytics.periodEmpty'))}</td></tr>`;
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
    ui.openingsBody.innerHTML = `<tr><td colspan="4" class="log-empty">${escapeHtml(t('analytics.periodEmpty'))}</td></tr>`;
    return;
  }

  ui.openingsBody.innerHTML = rows
    .map((row) => {
      const eco = row.eco ? `<span class="eco">${escapeHtml(row.eco)}</span>` : '';
      const score = Math.round(row.score * 100);
      return `<tr>
        <td class="cell-opening">${eco}<span class="opening-name">${escapeHtml(row.name ?? t('opening.none'))}</span></td>
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
    ui.accuracySub.textContent = t('insights.accuracyEmpty');
  } else {
    ui.accuracyValue.textContent = `${accuracy.avg}%`;
    ui.accuracyValue.className = `insight-value ${accuracy.avg >= 75 ? 'up' : accuracy.avg < 65 ? 'down' : ''}`;
    const parts = [t('insights.accuracySample', { count: accuracy.games })];
    if (accuracy.winAvg != null) parts.push(t('insights.accuracyWin', { value: accuracy.winAvg }));
    if (accuracy.lossAvg != null) parts.push(t('insights.accuracyLoss', { value: accuracy.lossAvg }));
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
      const label = t(`color.${row.color}`);
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
    [t('insights.streakCurrent'), streaks.current.count ? `${current} ${outcomeLabel(streaks.current.outcome)}` : '—'],
    [t('insights.streakBestWin'), `${streaks.bestWin}`],
    [t('insights.streakUnbeaten'), `${streaks.bestUnbeaten}`],
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
    ui.timeOfDay.innerHTML = `<div class="insight-sub">${escapeHtml(t('insights.todEmpty'))}</div>`;
    return;
  }

  ui.timeOfDay.innerHTML = buckets
    .map(
      (bucket) => `<div class="tod-row">
        <span>${escapeHtml(timeBucketLabel(bucket.id))}</span>
        <span class="tod-bar"><span style="width:${Math.round(bucket.score * 100)}%"></span></span>
        <span class="tod-value">${percent(bucket.score)}</span>
        <span class="tod-games">${bucket.games}</span>
      </div>`,
    )
    .join('');
}

function renderLongterm() {
  hideChartTip();
  if (!ui.longtermBtn) return;

  const loading = longterm.status === 'loading';
  ui.longtermBtn.disabled = loading || !state || state.demo;
  ui.longtermBtn.textContent = loading ? t('insights.longtermLoading') : t('insights.longtermBtn');

  if (longterm.series) {
    const classes =
      state.timeClass === 'all'
        ? Object.keys(longterm.series).filter((timeClass) => TIME_CLASSES.includes(timeClass))
        : [state.timeClass];

    const series = classes
      .filter((timeClass) => (longterm.series[timeClass] ?? []).length)
      .map((timeClass) => ({
        label: classLabel(timeClass),
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
      ui.longtermCaption.textContent = t('insights.longtermCaption', {
        parts: parts.join(' · '),
        ago: timeAgo(longterm.fetchedAt),
      });
      return;
    }
  }

  if (longterm.status === 'error') {
    ui.longtermChart.innerHTML = `<div class="chart-empty">${escapeHtml(longterm.error)}</div>`;
    ui.longtermCaption.textContent = '';
    return;
  }

  ui.longtermChart.innerHTML = `<div class="chart-empty">${escapeHtml(t('insights.longtermEmpty'))}</div>`;
  ui.longtermCaption.textContent = '';
}

/* ---------- язык ---------- */

function renderLangSwitch() {
  if (!ui.langSwitch) return;
  const active = getLanguage();
  ui.langSwitch.querySelectorAll('button[data-lang]').forEach((button) => {
    const isActive = button.dataset.lang === active;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function renderQuote() {
  const quote = pickQuote(getLanguage());
  if (ui.quoteText) ui.quoteText.textContent = `«${quote.text}»`;
  if (ui.quoteAuthor) ui.quoteAuthor.textContent = quote.author;
}

function detectLanguage() {
  try {
    const query = new URLSearchParams(window.location.search).get('lang');
    if (query === 'ru' || query === 'en') return query;
  } catch {
    /* ignore */
  }
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* ignore */
  }
  const nav = String(navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase();
  return nav.startsWith('ru') ? 'ru' : nav ? 'en' : 'ru';
}

function applyLanguage(lang, { persist = true } = {}) {
  setI18nLanguage(lang);
  if (persist) {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', lang);
    window.history.replaceState(null, '', url);
  } catch {
    /* ignore */
  }

  document.documentElement.lang = lang;
  applyStaticTranslations();
  renderLangSwitch();
  renderQuote();
  renderSiteTabs();
  renderClassOptions();
  filtersKey = '';
  if (state) render();
  else updateStatusText();
}

/* ---------- статус, карточка, CSV ---------- */

function updateStatusText() {
  if (!state || !ui.statusText || !ui.statusPill) return;

  if (state.demo) {
    ui.statusPill.dataset.tone = 'demo';
    ui.statusText.textContent = t('status.demo');
    return;
  }
  if (syncing) {
    ui.statusPill.dataset.tone = 'sync';
    ui.statusText.textContent = t('status.syncing');
    return;
  }
  if (lastError) {
    ui.statusPill.dataset.tone = 'error';
    ui.statusText.textContent = t('status.error');
    return;
  }
  ui.statusPill.dataset.tone = 'live';
  ui.statusText.textContent = t('status.updated', { ago: timeAgo(lastSyncAt) });
}

/* ---------- события ---------- */

ui.langSwitch?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-lang]');
  if (!button) return;
  const lang = button.dataset.lang;
  if (!lang || lang === getLanguage()) return;
  applyLanguage(lang);
});

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
    showAlert(ui.setupError, t('setup.enterUsername'));
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

bindChartTooltip(ui.chart);
bindChartTooltip(ui.longtermChart);
window.addEventListener('scroll', hideChartTip, { passive: true });
window.addEventListener('resize', hideChartTip);

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

  const initialLang = detectLanguage();
  setI18nLanguage(initialLang);
  document.documentElement.lang = initialLang;
  applyStaticTranslations();
  renderLangSwitch();
  renderQuote();

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
