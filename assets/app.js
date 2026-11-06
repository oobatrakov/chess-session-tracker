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
  selectGames,
  summarize,
  toCsv,
} from './session.js';
import { buildRatingChart } from './chart.js';
import { createDemoState } from './demo.js';

const STORAGE_KEY = 'chess-session-tracker:v2';
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
  sitePicker: el('site-picker'),
  avatar: el('avatar'),
  displayName: el('display-name'),
  profileLink: el('profile-link'),
  demoBadge: el('demo-badge'),
  providerBadge: el('provider-badge'),
  statusPill: el('status-pill'),
  statusText: el('status-text'),
  refreshBtn: el('refresh-btn'),
  endBtn: el('end-btn'),
  filters: el('filters'),
  wins: el('wins'),
  losses: el('losses'),
  draws: el('draws'),
  ratingDelta: el('rating-delta'),
  ratingRows: el('rating-rows'),
  ratingSub: el('rating-sub'),
  last10: el('last10'),
  last10Empty: el('last10-empty'),
  logCount: el('log-count'),
  logBody: el('log-body'),
  csvBtn: el('csv-btn'),
  periodChips: el('period-chips'),
  analyticsStats: el('analytics-stats'),
  chartClassChips: el('chart-class-chips'),
  chart: el('chart'),
  chartCaption: el('chart-caption'),
  opponentsBody: el('opponents-body'),
  openingsBody: el('openings-body'),
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

function profileLabel(url, username) {
  try {
    const parsed = new URL(url);
    return `${parsed.host.replace(/^www\./, '')}${parsed.pathname}`;
  } catch {
    return username;
  }
}

function timeAgo(timestamp) {  if (!timestamp) return 'только что';
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
    return parsed;
  } catch {
    return null;
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
  const options = [
    '<option value="all">Все</option>',
    ...TIME_CLASSES.filter((timeClass) => allowed.includes(timeClass)).map(
      (timeClass) => `<option value="${timeClass}">${CLASS_LABELS[timeClass]}</option>`,
    ),
  ];
  ui.timeClass.innerHTML = options.join('');
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
    const chosenClass =
      timeClass === 'all' || allowedClasses.includes(timeClass) ? timeClass : 'all';

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
      chartClass: null,
      lastSyncAt: Date.now(),
      demo: false,
    };

    filtersKey = '';
    lastSyncAt = Date.now();
    lastError = '';
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
  lastError = '';
  lastSyncAt = 0;
  filtersKey = '';
  saveState();
  render();
  ui.username?.focus();
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
  ui.endBtn.disabled = false;

  const summary = summarize(state, { timeClass: state.timeClass, period: 'session' });

  ui.wins.textContent = String(summary.wins);
  ui.losses.textContent = String(summary.losses);
  ui.draws.textContent = String(summary.draws);

  renderRating(summary);
  renderFilters();
  renderLast10(summary);
  renderLog(summary);
  renderAnalytics();
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

function renderFilters() {
  const sessionGames = selectGames(state.games, {
    period: 'session',
    timeClass: 'all',
    sinceEndTime: state.sinceEndTime,
  });

  const counts = { all: sessionGames.length };
  for (const game of sessionGames) {
    counts[game.timeClass] = (counts[game.timeClass] ?? 0) + 1;
  }

  if (!sessionGames.length) {
    ui.filters.hidden = true;
    ui.filters.innerHTML = '';
    filtersKey = 'empty';
    return;
  }
  ui.filters.hidden = false;

  const options = ['all', ...TIME_CLASSES.filter((timeClass) => counts[timeClass])];
  const key = `${state.timeClass}|${options.map((timeClass) => `${timeClass}:${counts[timeClass]}`).join(',')}`;
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
  const games = summary.last10;
  ui.last10Empty.hidden = games.length > 0;
  ui.last10.innerHTML = games
    .map((game) => {
      const glyph = game.outcome === 'win' ? '+' : game.outcome === 'loss' ? '−' : '=';
      const outcome = OUTCOME_LABELS[game.outcome] ?? game.outcome;
      const color = game.color === 'white' ? 'белые' : 'чёрные';
      const rating = game.opponentRating ? ` (${game.opponentRating})` : '';
      const delta = game.ratingDiff == null ? '' : ` · ${formatDelta(game.ratingDiff)}`;
      const tip = `${outcome} · ${color} · ${game.opponent}${rating} · ${CLASS_LABELS[game.timeClass] ?? game.timeClass}${delta}`;
      const href = game.url ? ` href="${escapeHtml(game.url)}" target="_blank" rel="noreferrer"` : '';
      const tag = game.url ? 'a' : 'span';
      return `<${tag} class="game-icon ${game.outcome}"${href} title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${glyph}</${tag}>`;
    })
    .join('');

  if (freshGames > 0) {
    ui.last10.classList.remove('is-fresh');
    void ui.last10.offsetWidth;
    ui.last10.classList.add('is-fresh');
  }
}

function renderLog(summary) {
  ui.logCount.textContent = summary.total ? `— ${summary.total}` : '';

  if (!summary.rows.length) {
    ui.logBody.innerHTML = '<tr><td colspan="6" class="log-empty">Партий пока нет. Сыграйте — и они появятся здесь.</td></tr>';
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
      const delta = game.ratingDiff == null ? '—' : formatDelta(game.ratingDiff);
      return `<tr>
        <td class="mono">${escapeHtml(when)}</td>
        <td>${game.color === 'white' ? 'белые' : 'чёрные'}</td>
        <td>${opponent}${opponentRating}</td>
        <td class="res-${game.outcome}">${escapeHtml(OUTCOME_LABELS[game.outcome] ?? game.outcome)}</td>
        <td class="mono">${game.myRating ?? '—'}</td>
        <td class="mono ${game.ratingDiff == null ? 'flat' : deltaClass(game.ratingDiff)}">${delta}</td>
      </tr>`;
    })
    .join('');
}

/* ---------- аналитика ---------- */

function renderAnalytics() {
  const periodGames = selectGames(state.games, {
    period: state.period,
    timeClass: state.timeClass,
    sinceEndTime: state.sinceEndTime,
  });

  renderPeriodChips();

  const summary = summarize(state, { timeClass: state.timeClass, period: state.period });
  ui.analyticsStats.textContent = summary.total
    ? `${summary.total} партий · ${summary.wins}–${summary.losses}–${summary.draws}`
    : 'пока пусто';

  renderChart(periodGames);
  renderOpponents(aggregateOpponents(periodGames));
  renderOpenings(aggregateOpenings(periodGames));
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

function renderChart(periodGames) {
  const available = [...new Set(periodGames.map((game) => game.timeClass))]
    .filter((timeClass) => TIME_CLASSES.includes(timeClass))
    .sort((a, b) => TIME_CLASSES.indexOf(a) - TIME_CLASSES.indexOf(b));

  if (!available.length) {
    ui.chartClassChips.hidden = true;
    ui.chartCaption.textContent = '';
    ui.chart.innerHTML = '<div class="chart-empty">Нет партий за выбранный период</div>';
    return;
  }

  let chartClass = state.chartClass && available.includes(state.chartClass) ? state.chartClass : null;
  if (!chartClass && state.timeClass !== 'all' && available.includes(state.timeClass)) {
    chartClass = state.timeClass;
  }
  if (!chartClass) {
    const counts = new Map();
    for (const game of periodGames) {
      if (game.myRating == null) continue;
      counts.set(game.timeClass, (counts.get(game.timeClass) ?? 0) + 1);
    }
    chartClass = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? available[0];
  }

  if (state.chartClass !== chartClass) state.chartClass = chartClass;

  ui.chartClassChips.hidden = available.length < 2;
  const chipsKey = available.join(',') + `|${chartClass}`;
  if (ui.chartClassChips.dataset.key !== chipsKey) {
    ui.chartClassChips.dataset.key = chipsKey;
    ui.chartClassChips.innerHTML = chipMarkup(
      available.map((timeClass) => ({ id: timeClass, label: CLASS_LABELS[timeClass] ?? timeClass })),
      chartClass,
      'chart-class',
    );
  }

  const games = periodGames.filter((game) => game.timeClass === chartClass);
  const points = chartSeries(games);
  const shown = points.slice(-CHART_POINTS_LIMIT);

  if (!shown.length) {
    ui.chart.innerHTML = '<div class="chart-empty">Нет данных о рейтинге за выбранный период</div>';
    ui.chartCaption.textContent = '';
    return;
  }

  const first = shown[0];
  const last = shown[shown.length - 1];
  const delta = last.value - first.value;
  const suffix = points.length > shown.length ? ` (последние ${shown.length})` : '';
  ui.chartCaption.textContent = `${first.value} → ${last.value} (${formatDelta(delta)}) · ${points.length} партий${suffix}`;
  ui.chart.innerHTML = buildRatingChart(shown);
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
      const name = row.name ?? 'Без дебюта';
      const score = Math.round(row.score * 100);
      return `<tr>
        <td class="cell-opening">${eco}<span class="opening-name">${escapeHtml(name)}</span></td>
        <td class="mono num">${row.games}</td>
        <td class="mono small">${row.wins}–${row.losses}–${row.draws}</td>
        <td class="mono num ${score >= 50 ? 'up' : 'down'}">${score}%</td>
      </tr>`;
    })
    .join('');
}

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

function downloadCsv() {
  if (!state) return;
  const summary = summarize(state, { timeClass: state.timeClass, period: 'session' });
  const csv = `\uFEFF${toCsv(summary.rows)}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `chess-session-${state.provider}-${state.username}-${date}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

ui.chartClassChips.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-chart-class]');
  if (!button || !state) return;
  state.chartClass = button.dataset.chartClass;
  saveState();
  render();
});

ui.refreshBtn.addEventListener('click', () => refresh({ manual: true }));
ui.endBtn.addEventListener('click', endSession);

ui.csvBtn.addEventListener('click', (event) => {
  event.preventDefault();
  downloadCsv();
});

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

  if (params.get('demo') === '1') {
    state = createDemoState();
    selectedProvider = state.provider;
    lastSyncAt = Date.now();
  } else if (state) {
    selectedProvider = state.provider;
    lastSyncAt = Date.now();
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
