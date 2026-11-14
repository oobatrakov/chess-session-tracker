// Провайдер Lichess: открытый API, без ключа, CORS открыт.
// Бонус: каждая партия содержит точный ratingDiff и готовый дебют (ECO + название).

import { fetchJson, fetchNdjson, fetchText } from '../http.js';
import { TIME_CLASSES, normName, toRating } from '../session.js';
import { t } from '../i18n.js';

export const id = 'lichess';
export const label = 'Lichess';
export const classes = ['bullet', 'blitz', 'rapid'];

const API = 'https://lichess.org/api';
const segment = (value) => encodeURIComponent(String(value).trim());

// Быстрые контроли Lichess -> наши. ultraBullet считаем bullet.
// Classical и correspondence на сайте не учитываются.
const SPEED_MAP = {
  ultraBullet: 'bullet',
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid',
};

const SKIP_STATUS = new Set(['aborted', 'noStart', 'created', 'started']);

const TERMINATION_BY_STATUS = {
  resign: 'resign',
  outoftime: 'time',
  timeout: 'time',
  mate: 'mate',
  draw: 'draw',
  stalemate: 'draw',
  cheat: 'other',
  unknown: 'other',
};

export function terminationOf(status) {
  return TERMINATION_BY_STATUS[status] ?? 'other';
}

function toAccuracy(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100 ? Math.round(number * 10) / 10 : null;
}

export function normalizeGame(raw, username) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.variant && raw.variant !== 'standard') return null;
  if (SKIP_STATUS.has(raw.status)) return null;

  const timeClass = SPEED_MAP[raw.speed ?? raw.perf];
  if (!timeClass) return null;

  const me = normName(username);
  const playerName = (player) =>
    normName(player?.user?.id) === me || normName(player?.user?.name) === me;

  const side = playerName(raw.players?.white)
    ? 'white'
    : playerName(raw.players?.black)
      ? 'black'
      : null;
  if (!side) return null;

  const mine = raw.players?.[side] ?? {};
  const theirs = raw.players?.[side === 'white' ? 'black' : 'white'] ?? {};
  const winner = raw.winner ?? null;
  const outcome = winner ? (winner === side ? 'win' : 'loss') : 'draw';

  const ratingBefore = toRating(mine.rating);
  const ratingDiff = Number.isFinite(mine.ratingDiff) ? mine.ratingDiff : null;
  // Lichess отдаёт rating до партии; в приложении myRating — рейтинг после.
  const myRating = ratingBefore != null && ratingDiff != null ? ratingBefore + ratingDiff : ratingBefore;

  const endTime = Math.floor(Number(raw.lastMoveAt ?? raw.createdAt ?? 0) / 1000);
  if (!Number.isFinite(endTime) || endTime <= 0) return null;

  const startTime = Math.floor(Number(raw.createdAt ?? 0) / 1000);
  const playedSeconds = endTime - startTime;
  const duration = startTime > 0 && playedSeconds > 0 && playedSeconds < 6 * 3600 ? playedSeconds : null;

  const opponentName =
    theirs.user?.name ??
    (theirs.aiLevel ? `Stockfish ${theirs.aiLevel}` : t('provider.anonymous'));

  return {
    id: `li:${raw.id}`,
    url: `https://lichess.org/${raw.id}`,
    endTime,
    startTime: startTime > 0 ? startTime : null,
    duration,
    timeClass,
    rated: raw.rated === true,
    color: side,
    outcome,
    myRating,
    ratingDiff,
    opponent: String(opponentName),
    opponentRating: toRating(theirs.rating),
    opponentResult: winner ? (winner === side ? 'loss' : 'win') : 'draw',
    opening: raw.opening ? { eco: raw.opening.eco ?? null, name: raw.opening.name ?? null } : null,
    accuracy: toAccuracy(mine.analysis?.accuracy ?? raw.analysis?.[side]?.accuracy ?? raw.accuracy),
    termination: terminationOf(raw.status),
    source: id,
  };
}

export async function getProfile(username, options = {}) {
  const user = await fetchJson(`${API}/user/${segment(username)}`, options);
  return {
    username: user.username ?? String(username).trim(),
    displayName: user.username ?? String(username).trim(),
    avatar: '',
    profileUrl: `https://lichess.org/@/${segment(user.username ?? username)}`,
    title: user.title ?? null,
  };
}

export async function getRatings(username, options = {}) {
  const user = await fetchJson(`${API}/user/${segment(username)}`, options);
  const perfs = user.perfs ?? {};
  return {
    bullet: toRating(perfs.bullet?.rating),
    blitz: toRating(perfs.blitz?.rating),
    rapid: toRating(perfs.rapid?.rating),
    classical: toRating(perfs.classical?.rating),
    daily: toRating(perfs.correspondence?.rating),
  };
}

/** Партии за диапазон одним запросом (NDJSON). */
export async function getGames(username, { fromSec, toSec, signal } = {}) {
  const nowMs = Date.now();
  const from = Math.floor((fromSec ?? Math.floor(nowMs / 1000) - 7 * 86400) * 1000);
  const until = Math.floor((toSec ?? Math.floor(nowMs / 1000)) * 1000);

  const params = new URLSearchParams({
    since: String(from),
    until: String(until),
    max: '1000',
    opening: 'true',
    accuracy: 'true',
    clocks: 'false',
    evals: 'false',
    ongoing: 'false',
    finished: 'true',
    // desc: при лимите 1000 нужны самые свежие партии, а не самые старые.
    sort: 'desc',
  });

  const items = await fetchNdjson(`${API}/games/user/${segment(username)}?${params}`, { signal });
  const games = [];
  for (const raw of items) {
    const game = normalizeGame(raw, username);
    if (game) games.push(game);
  }
  return games;
}

/** Партия, которая идёт прямо сейчас (если есть). */
export async function getCurrentGame(username, options = {}) {
  try {
    const text = await fetchText(`${API}/user/${segment(username)}/current-game`, {
      ...options,
      headers: { Accept: 'application/x-ndjson', ...(options.headers ?? {}) },
    });
    const line = text.split('\n').find((item) => item.trim());
    if (!line) return null;

    const raw = JSON.parse(line);
    const me = normName(username);
    const side =
      normName(raw.players?.white?.user?.id) === me || normName(raw.players?.white?.user?.name) === me
        ? 'white'
        : 'black';
    const theirs = raw.players?.[side === 'white' ? 'black' : 'white'];

    return {
      url: `https://lichess.org/${raw.id}`,
      opponent: String(theirs?.user?.name ?? '—'),
      timeClass: SPEED_MAP[raw.speed] ?? 'unknown',
      color: side,
    };
  } catch {
    return null;
  }
}
