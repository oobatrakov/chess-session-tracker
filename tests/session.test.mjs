import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLASS_LABELS,
  aggregateOpenings,
  aggregateOpponents,
  chartSeries,
  mergeGames,
  monthsSince,
  outcomeOf,
  selectGames,
  summarize,
  toCsv,
  withRatingHistory,
} from '../assets/session.js';
import {
  normalizeGame as normalizeChesscom,
  openingFromPgn,
  openingNameFromUrl,
} from '../assets/providers/chesscom.js';
import { normalizeGame as normalizeLichess } from '../assets/providers/lichess.js';
import { buildRatingChart } from '../assets/chart.js';

const USER = 'PlayerOne';
const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);

function game(overrides = {}) {
  return {
    id: 'g1',
    url: '',
    endTime: 1000,
    timeClass: 'blitz',
    rated: true,
    color: 'white',
    outcome: 'win',
    myRating: 1518,
    ratingDiff: null,
    opponent: 'Rival',
    opponentRating: 1490,
    opponentResult: 'resigned',
    opening: null,
    source: 'chesscom',
    ...overrides,
  };
}

function stateWith(games, { anchors = {}, sinceEndTime = 0 } = {}) {
  return { games: withRatingHistory(games), anchors, sinceEndTime };
}

/* ---------- результаты и рейтинг ---------- */

test('outcomeOf распознаёт победу, ничью и поражение', () => {
  assert.equal(outcomeOf('win'), 'win');
  assert.equal(outcomeOf('agreed'), 'draw');
  assert.equal(outcomeOf('repetition'), 'draw');
  assert.equal(outcomeOf('stalemate'), 'draw');
  assert.equal(outcomeOf('insufficient'), 'draw');
  assert.equal(outcomeOf('50move'), 'draw');
  assert.equal(outcomeOf('timevsinsufficient'), 'draw');
  assert.equal(outcomeOf('resigned'), 'loss');
  assert.equal(outcomeOf('checkmated'), 'loss');
  assert.equal(outcomeOf('timeout'), 'loss');
  assert.equal(outcomeOf('abandoned'), 'loss');
  assert.equal(outcomeOf(''), null);
  assert.equal(outcomeOf(undefined), null);
});

test('withRatingHistory строит цепочку рейтинга по контролям', () => {
  const games = withRatingHistory([
    game({ id: 'a', endTime: 10, myRating: 1518 }),
    game({ id: 'b', endTime: 20, myRating: 1510 }),
    game({ id: 'c', endTime: 30, myRating: 1520, timeClass: 'rapid' }),
    game({ id: 'd', endTime: 40, myRating: 1513 }),
  ]);

  assert.deepEqual(games.map((g) => g.ratingBefore), [null, 1518, null, 1510]);
  assert.deepEqual(games.map((g) => g.ratingDiff), [null, -8, null, 3]);
});

test('withRatingHistory доверяет точному ratingDiff площадки', () => {
  const games = withRatingHistory([
    game({ id: 'a', endTime: 10, myRating: 1520, ratingDiff: 12 }),
    game({ id: 'b', endTime: 20, myRating: 1515, ratingDiff: -5 }),
  ]);
  assert.equal(games[0].ratingBefore, 1508);
  assert.equal(games[0].ratingDiff, 12);
  assert.equal(games[1].ratingBefore, 1520);
  assert.equal(games[1].ratingDiff, -5);
});

test('mergeGames убирает дубли и сохраняет порядок', () => {
  const first = mergeGames([], [game({ id: 'a', endTime: 10 }), game({ id: 'b', endTime: 20 })]);
  assert.equal(first.length, 2);

  const second = mergeGames(first, [game({ id: 'b', endTime: 20 }), game({ id: 'c', endTime: 30 })]);
  assert.deepEqual(second.map((g) => g.id), ['a', 'b', 'c']);
});

/* ---------- периоды ---------- */

test('selectGames фильтрует по сессии, 7 и 90 дням', () => {
  const now = nowSec();
  const games = withRatingHistory([
    game({ id: 'old', endTime: now - 120 * DAY }),
    game({ id: 'month', endTime: now - 40 * DAY }),
    game({ id: 'week', endTime: now - 3 * DAY }),
    game({ id: 'session', endTime: now - 60 }),
  ]);

  const session = selectGames(games, { period: 'session', sinceEndTime: now - 300, nowSec: now });
  assert.deepEqual(session.map((g) => g.id), ['session']);

  const week = selectGames(games, { period: '7d', nowSec: now });
  assert.deepEqual(week.map((g) => g.id), ['week', 'session']);

  const quarter = selectGames(games, { period: '90d', nowSec: now });
  assert.deepEqual(quarter.map((g) => g.id), ['month', 'week', 'session']);
});

test('selectGames учитывает контроль времени', () => {
  const now = nowSec();
  const games = withRatingHistory([
    game({ id: 'b', endTime: now - 10, timeClass: 'blitz' }),
    game({ id: 'r', endTime: now - 20, timeClass: 'rapid' }),
  ]);
  const blitz = selectGames(games, { period: '7d', timeClass: 'blitz', nowSec: now });
  assert.deepEqual(blitz.map((g) => g.id), ['b']);
});

/* ---------- сводка ---------- */

test('summarize считает W/L/D и дельту от стартового рейтинга сессии', () => {
  const games = [
    game({ id: '1', endTime: 100, outcome: 'win', myRating: 1518 }),
    game({ id: '2', endTime: 200, outcome: 'loss', myRating: 1510 }),
    game({ id: '3', endTime: 300, outcome: 'draw', myRating: 1510 }),
    game({ id: '4', endTime: 400, outcome: 'win', timeClass: 'rapid', myRating: 1660 }),
  ];
  const summary = summarize(stateWith(games, { anchors: { blitz: 1510, rapid: 1650 } }), {
    period: 'session',
    timeClass: 'all',
  });

  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 1);
  assert.equal(summary.draws, 1);
  assert.equal(summary.total, 4);

  const blitz = summary.byClass.find((bucket) => bucket.class === 'blitz');
  assert.equal(blitz.games, 3);
  assert.equal(blitz.delta, 0);

  const rapid = summary.byClass.find((bucket) => bucket.class === 'rapid');
  assert.equal(rapid.delta, 10);

  assert.deepEqual(summary.rows.map((g) => g.id), ['4', '3', '2', '1']);
  assert.equal(summary.last10.length, 4);
});

test('summarize для периода 7д берёт якорь из истории рейтинга', () => {
  const now = nowSec();
  const games = [
    game({ id: 'before', endTime: now - 20 * DAY, myRating: 1600 }),
    game({ id: 'a', endTime: now - 2 * DAY, myRating: 1610 }),
    game({ id: 'b', endTime: now - 1 * DAY, myRating: 1604 }),
  ];

  const summary = summarize(stateWith(games, { anchors: { blitz: 1500 } }), {
    period: '7d',
    timeClass: 'blitz',
  });

  assert.equal(summary.total, 2);
  assert.equal(summary.byClass[0].anchor, 1600);
  assert.equal(summary.byClass[0].delta, 4);
});

test('summarize без якорей не выдумывает дельту', () => {
  const games = [game({ id: '1', endTime: 100, myRating: 1200 })];
  const summary = summarize(stateWith(games), { period: 'session' });
  assert.equal(summary.byClass[0].delta, null);
});

test('summarize оставляет только 10 последних партий, свежие первыми', () => {
  const games = Array.from({ length: 14 }, (_, index) =>
    game({ id: `g${index}`, endTime: 1000 + index, myRating: 1500 + index }),
  );
  const summary = summarize(stateWith(games, { anchors: { blitz: 1500 } }));
  assert.equal(summary.last10.length, 10);
  assert.equal(summary.last10[0].id, 'g13');
  assert.equal(summary.last10.at(-1).id, 'g4');
});

/* ---------- агрегаты ---------- */

test('aggregateOpponents считает игры, очки и средний рейтинг', () => {
  const games = [
    game({ id: '1', opponent: 'Rival', outcome: 'win', opponentRating: 1500 }),
    game({ id: '2', opponent: 'rival', outcome: 'loss', opponentRating: 1600 }),
    game({ id: '3', opponent: 'Rival', outcome: 'draw', opponentRating: 1400 }),
    game({ id: '4', opponent: 'Other', outcome: 'win', opponentRating: 1500 }),
  ];

  const rows = aggregateOpponents(games);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Rival');
  assert.equal(rows[0].games, 3);
  assert.equal(rows[0].score, (1 + 0.5) / 3);
  assert.equal(rows[0].avgRating, 1500);
  assert.equal(rows[1].name, 'Other');
});

test('aggregateOpponents ограничивает топ и сортирует по числу игр', () => {
  const games = Array.from({ length: 8 }, (_, index) =>
    game({ id: `g${index}`, opponent: `Opp${index % 3}`, outcome: 'win' }),
  );
  const rows = aggregateOpponents(games, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].games, 3);
});

test('aggregateOpenings группирует по дебюту и ставит неизвестные в конец', () => {
  const sicilian = { eco: 'B90', name: 'Sicilian Defense' };
  const games = [
    game({ id: '1', opening: sicilian, outcome: 'win' }),
    game({ id: '2', opening: sicilian, outcome: 'loss' }),
    game({ id: '3', opening: { eco: 'C50', name: 'Italian Game' }, outcome: 'win' }),
    game({ id: '4', opening: null, outcome: 'win' }),
  ];

  const rows = aggregateOpenings(games);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Sicilian Defense');
  assert.equal(rows[0].games, 2);
  assert.equal(rows[0].score, 0.5);
  assert.equal(rows.at(-1).name, null);
});

/* ---------- график ---------- */

test('chartSeries отбрасывает партии без рейтинга', () => {
  const points = chartSeries([game({ id: '1', myRating: 1510 }), game({ id: '2', myRating: null })]);
  assert.equal(points.length, 1);
  assert.equal(points[0].value, 1510);
});

test('buildRatingChart рисует точки и подсказки', () => {
  const svg = buildRatingChart([
    { value: 1500, outcome: 'win', endTime: 1_700_000_000, opponent: 'A', ratingDiff: 8 },
    { value: 1492, outcome: 'loss', endTime: 1_700_000_600, opponent: 'B', ratingDiff: -8 },
    { value: 1500, outcome: 'draw', endTime: 1_700_001_200, opponent: 'C', ratingDiff: 0 },
  ]);

  assert.match(svg, /^<svg/);
  assert.equal((svg.match(/class="chart-point/g) ?? []).length, 3);
  assert.match(svg, /победа/);
  assert.match(svg, /график рейтинга/i);
  assert.equal(buildRatingChart([]), '');
});

/* ---------- месяцы и CSV ---------- */

test('monthsSince не теряет текущий месяц при ограничении глубины', () => {
  const to = Math.floor(Date.UTC(2026, 10, 6) / 1000);
  const months = monthsSince(to - 210 * DAY, to, 7);
  assert.equal(months.length, 7);
  assert.deepEqual(months.at(-1), [2026, 11]);
});

test('monthsSince переходит через границу года', () => {
  const from = Math.floor(Date.UTC(2023, 11, 15) / 1000);
  const to = Math.floor(Date.UTC(2024, 1, 10) / 1000);
  assert.deepEqual(monthsSince(from, to), [
    [2023, 12],
    [2024, 1],
    [2024, 2],
  ]);
});

test('toCsv отдаёт шапку и строку на партию с дебютом', () => {
  const csv = toCsv([
    game({
      id: '1',
      opening: { eco: 'B90', name: 'Sicilian Defense' },
      ratingDiff: 8,
      opponent: 'Smith; Jones',
    }),
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Дебют/);
  assert.match(lines[1], /"Smith; Jones"/);
  assert.match(lines[1], /Sicilian Defense/);
  assert.equal(CLASS_LABELS.blitz, 'Blitz');
});

/* ---------- провайдер Chess.com ---------- */

function chesscomRaw(overrides = {}) {
  return {
    url: 'https://www.chess.com/game/live/1',
    uuid: 'cc-1',
    rules: 'chess',
    rated: true,
    time_class: 'blitz',
    end_time: 1_700_000_000,
    pgn: '[ECO "B90"]\n[ECOUrl "https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation-6.Be3"]\n',
    white: { username: 'playerone', result: 'win', rating: 1518 },
    black: { username: 'Rival', result: 'resigned', rating: 1490 },
    ...overrides,
  };
}

test('Chess.com: нормализация партии', () => {
  const parsed = normalizeChesscom(chesscomRaw(), USER);
  assert.equal(parsed.color, 'white');
  assert.equal(parsed.outcome, 'win');
  assert.equal(parsed.opponent, 'Rival');
  assert.equal(parsed.myRating, 1518);
  assert.equal(parsed.timeClass, 'blitz');
  assert.equal(parsed.id, 'cc:cc-1');
  assert.deepEqual(parsed.opening, {
    eco: 'B90',
    name: 'Sicilian Defense Najdorf Variation',
  });
});

test('Chess.com: отбрасывает чужие партии, варианты и партии без времени', () => {
  assert.equal(normalizeChesscom(chesscomRaw({ white: { username: 'other', result: 'win' } }), USER), null);
  assert.equal(normalizeChesscom(chesscomRaw({ rules: 'chess960' }), USER), null);
  assert.equal(normalizeChesscom(chesscomRaw({ end_time: undefined }), USER), null);
  assert.equal(normalizeChesscom(null, USER), null);
});

test('Chess.com: разбор ECO из PGN и ссылки', () => {
  assert.equal(
    openingNameFromUrl('https://www.chess.com/openings/Reti-Opening-Kings-Indian-Attack-2...d6-3.Bg2'),
    'Reti Opening Kings Indian Attack',
  );
  assert.equal(openingNameFromUrl('https://www.chess.com/openings/Italian-Game'), 'Italian Game');
  assert.equal(openingFromPgn('[ECO "C50"]'), null);
  assert.deepEqual(openingFromPgn('[ECO "C50"]\n[ECOUrl "https://www.chess.com/openings/Italian-Game"]'), {
    eco: 'C50',
    name: 'Italian Game',
  });
});

/* ---------- провайдер Lichess ---------- */

function lichessRaw(overrides = {}) {
  return {
    id: 'abcd1234',
    variant: 'standard',
    speed: 'blitz',
    perf: 'blitz',
    status: 'resign',
    winner: 'white',
    rated: true,
    createdAt: 1_700_000_000_000,
    lastMoveAt: 1_700_000_600_000,
    players: {
      white: { user: { id: 'playerone', name: 'PlayerOne' }, rating: 1518, ratingDiff: 8 },
      black: { user: { id: 'rival', name: 'Rival' }, rating: 1490, ratingDiff: -8 },
    },
    opening: { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation', ply: 5 },
    ...overrides,
  };
}

test('Lichess: нормализация, точный ratingDiff и дебют', () => {
  const parsed = normalizeLichess(lichessRaw(), USER);
  assert.equal(parsed.color, 'white');
  assert.equal(parsed.outcome, 'win');
  assert.equal(parsed.myRating, 1518);
  assert.equal(parsed.ratingDiff, 8);
  assert.equal(parsed.timeClass, 'blitz');
  assert.equal(parsed.opponent, 'Rival');
  assert.equal(parsed.endTime, 1_700_000_600);
  assert.equal(parsed.id, 'li:abcd1234');
  assert.deepEqual(parsed.opening, { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' });
});

test('Lichess: ничья и поражение', () => {
  const draw = normalizeLichess(lichessRaw({ winner: null, status: 'draw' }), USER);
  assert.equal(draw.outcome, 'draw');

  const loss = normalizeLichess(lichessRaw({ winner: 'black' }), USER);
  assert.equal(loss.outcome, 'loss');
  assert.equal(loss.opponentResult, 'win');
});

test('Lichess: варианты, прерванные партии и неизвестные скорости отбрасываются', () => {
  assert.equal(normalizeLichess(lichessRaw({ variant: 'chess960' }), USER), null);
  assert.equal(normalizeLichess(lichessRaw({ status: 'aborted' }), USER), null);
  assert.equal(normalizeLichess(lichessRaw({ speed: 'horde' }), USER), null);
  assert.equal(normalizeLichess(null, USER), null);
});

test('Lichess: correspondence считается daily, ultraBullet — bullet', () => {
  assert.equal(normalizeLichess(lichessRaw({ speed: 'correspondence' }), USER).timeClass, 'daily');
  assert.equal(normalizeLichess(lichessRaw({ speed: 'ultraBullet' }), USER).timeClass, 'bullet');
});

test('Lichess: игра против компьютера', () => {
  const parsed = normalizeLichess(
    lichessRaw({
      players: {
        white: { user: { id: 'playerone', name: 'PlayerOne' }, rating: 1518 },
        black: { aiLevel: 3 },
      },
    }),
    USER,
  );
  assert.equal(parsed.opponent, 'Stockfish 3');
});
