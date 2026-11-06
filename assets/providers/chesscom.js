// Провайдер Chess.com: публичный API, CORS открыт.

import { fetchJson } from '../http.js';
import { TIME_CLASSES, monthsSince, normName, outcomeOf, toRating } from '../session.js';

export const id = 'chesscom';
export const label = 'Chess.com';
export const classes = ['bullet', 'blitz', 'rapid'];

const API = 'https://api.chess.com/pub';
const segment = (value) => encodeURIComponent(String(value).trim());

// Причина окончания партии по результату игрока.
const TERMINATION_BY_RESULT = {
  resigned: 'resign',
  timeout: 'time',
  checkmated: 'mate',
  abandoned: 'abandon',
  agreed: 'draw',
  repetition: 'draw',
  stalemate: 'draw',
  insufficient: 'draw',
  '50move': 'draw',
  timevsinsufficient: 'draw',
  win: 'win',
};

export function terminationOf(result) {
  return TERMINATION_BY_RESULT[result] ?? 'other';
}

function toAccuracy(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100 ? Math.round(number * 10) / 10 : null;
}

/**
 * Название дебюта из ссылки Chess.com:
 * .../openings/Reti-Opening-Kings-Indian-Attack-2...d6-3.Bg2 -> "Reti Opening Kings Indian Attack"
 */
export function openingNameFromUrl(url) {
  if (!url) return null;
  try {
    const slug = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    if (!slug) return null;
    const parts = slug.split('-').filter(Boolean);
    const cut = parts.findIndex((part) => /^\d/.test(part));
    const words = cut === -1 ? parts : parts.slice(0, cut);
    return words.join(' ') || null;
  } catch {
    return null;
  }
}

/** ECO-код и название дебюта из PGN (Chess.com кладёт их в заголовки). */
export function openingFromPgn(pgn) {
  if (!pgn) return null;
  const eco = /\[ECO "([^"]+)"\]/.exec(pgn)?.[1] ?? null;
  const url = /\[ECOUrl "([^"]+)"\]/.exec(pgn)?.[1] ?? null;
  const name = openingNameFromUrl(url);
  if (!name) return null;
  return { eco, name };
}

export function normalizeGame(raw, username) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.rules !== 'chess') return null;

  const me = normName(username);
  const side =
    normName(raw.white?.username) === me ? 'white' : normName(raw.black?.username) === me ? 'black' : null;
  if (!side) return null;

  const endTime = Number(raw.end_time);
  if (!Number.isFinite(endTime) || endTime <= 0) return null;

  const mine = raw[side] ?? {};
  const theirs = raw[side === 'white' ? 'black' : 'white'] ?? {};
  const outcome = outcomeOf(mine.result);
  if (!outcome) return null;

  const timeClass = typeof raw.time_class === 'string' ? raw.time_class : 'unknown';
  if (!TIME_CLASSES.includes(timeClass)) return null;

  return {
    id: `cc:${raw.uuid ?? raw.url ?? endTime}`,
    url: typeof raw.url === 'string' ? raw.url : '',
    endTime,
    timeClass,
    rated: raw.rated !== false,
    color: side,
    outcome,
    myRating: toRating(mine.rating),
    ratingDiff: null,
    opponent: String(theirs.username ?? '—'),
    opponentRating: toRating(theirs.rating),
    opponentResult: String(theirs.result ?? ''),
    opening: openingFromPgn(raw.pgn),
    accuracy: toAccuracy(raw.accuracies?.[side]),
    termination: terminationOf(mine.result),
    source: id,
  };
}

export async function getProfile(username, options = {}) {
  const player = await fetchJson(`${API}/player/${segment(username)}`, options);
  return {
    username: player.username ?? String(username).trim(),
    displayName: player.name || player.username || String(username).trim(),
    avatar: typeof player.avatar === 'string' ? player.avatar : '',
    profileUrl: player.url || `https://www.chess.com/member/${segment(username)}`,
  };
}

export async function getRatings(username, options = {}) {
  const stats = await fetchJson(`${API}/player/${segment(username)}/stats`, options);
  const ratings = {};
  for (const timeClass of classes) {
    ratings[timeClass] = toRating(stats?.[`chess_${timeClass}`]?.last?.rating);
  }
  return ratings;
}

/** Партии за диапазон: Chess.com отдаёт их по месяцам. */
export async function getGames(username, { fromSec, toSec, signal } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const months = monthsSince(fromSec ?? nowSec - 7 * 86400, toSec ?? nowSec, 13);
  const games = [];

  for (const [year, month] of months) {
    const url = `${API}/player/${segment(username)}/games/${year}/${String(month).padStart(2, '0')}`;
    let data;
    try {
      data = await fetchJson(url, { signal });
    } catch (error) {
      if (error?.status === 404) continue; // пустой месяц
      throw error;
    }
    for (const raw of data?.games ?? []) {
      const game = normalizeGame(raw, username);
      if (game) games.push(game);
    }
  }

  return games;
}

/** Партия, в которой пользователь должен сделать ход (Chess.com отдаёт только daily). */
export async function getCurrentGame(username, options = {}) {
  try {
    const data = await fetchJson(`${API}/player/${segment(username)}/games/to-move`, options);
    const game = data?.games?.[0];
    if (!game) return null;
    // В ответе to-move нет имён игроков — только ссылка и дедлайн хода.
    return {
      url: typeof game.url === 'string' ? game.url : '',
      opponent: '',
      timeClass: 'daily',
      color: null,
    };
  } catch {
    return null;
  }
}
