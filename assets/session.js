// Чистая логика: единый формат партии для Chess.com и Lichess, сводки, агрегаты.
// Без DOM и без сети — покрыта тестами.

export const MAX_GAMES = 1200;

export const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'classical', 'daily'];

export const CLASS_LABELS = {
  all: 'Все',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  daily: 'Daily',
  unknown: 'Другое',
};

export const OUTCOME_LABELS = {
  win: 'победа',
  loss: 'поражение',
  draw: 'ничья',
};

export const PERIODS = [
  { id: 'session', label: 'Сессия' },
  { id: '7d', label: '7 дней' },
  { id: '90d', label: '90 дней' },
];

export const PERIOD_DAYS = { '7d': 7, '90d': 90 };

const DRAW_RESULTS = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
  'drawn',
]);

const WIN_RESULT = 'win';

export function normName(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** 'win' | 'loss' | 'draw' | null из строки результата Chess.com. */
export function outcomeOf(result) {
  if (!result) return null;
  if (result === WIN_RESULT) return 'win';
  if (DRAW_RESULTS.has(result)) return 'draw';
  return 'loss';
}

export function toRating(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Достраивает историю рейтинга: для каждой партии считает ratingBefore и ratingDiff.
 * Если площадка дала точный ratingDiff (Lichess), он приоритетнее.
 * Партии должны идти по возрастанию времени; на выходе — тоже.
 */
export function withRatingHistory(games) {
  const sorted = [...(games ?? [])].sort((a, b) => a.endTime - b.endTime);
  const lastByClass = new Map();

  return sorted.map((game) => {
    const timeClass = game.timeClass;
    const provided = Number.isFinite(game.ratingDiff) ? game.ratingDiff : null;
    const previous = lastByClass.has(timeClass) ? lastByClass.get(timeClass) : null;

    let ratingBefore = null;
    if (game.myRating != null && provided != null) ratingBefore = game.myRating - provided;
    else if (game.myRating != null && previous != null) ratingBefore = previous;

    const diff =
      game.myRating != null && ratingBefore != null ? game.myRating - ratingBefore : provided;

    if (game.myRating != null) lastByClass.set(timeClass, game.myRating);

    return { ...game, ratingBefore, ratingDiff: diff };
  });
}

/** Объединяет партии без дублей, пересчитывает историю рейтинга и хранит последние MAX_GAMES. */
export function mergeGames(existing, incoming) {
  const byId = new Map();
  for (const game of existing ?? []) {
    if (game?.id) byId.set(game.id, game);
  }
  for (const game of incoming ?? []) {
    if (game?.id) byId.set(game.id, game);
  }
  return withRatingHistory([...byId.values()]).slice(-MAX_GAMES);
}

export function latestEndTime(games) {
  let latest = 0;
  for (const game of games ?? []) {
    if (game.endTime > latest) latest = game.endTime;
  }
  return latest;
}

function periodStart(period, nowSec, sinceEndTime) {
  if (period === '7d') return nowSec - 7 * 86400;
  if (period === '90d') return nowSec - 90 * 86400;
  return sinceEndTime;
}

/** Партии выбранного периода и контроля, по возрастанию времени. */
export function selectGames(games, options = {}) {
  const {
    period = 'session',
    timeClass = 'all',
    sinceEndTime = 0,
    nowSec = Math.floor(Date.now() / 1000),
  } = options;

  const from = periodStart(period, nowSec, sinceEndTime);

  return (games ?? [])
    .filter((game) => game.endTime > from)
    .filter((game) => timeClass === 'all' || game.timeClass === timeClass)
    .sort((a, b) => a.endTime - b.endTime);
}

/**
 * Сводка: W/L/D, разбивка по контролям и дельта рейтинга.
 * Для периода «сессия» якорь — рейтинг на старте сессии, для остальных — рейтинг перед первой партией окна.
 */
export function summarize(state, options = {}) {
  const { timeClass = 'all', period = 'session' } = options;
  const selected = selectGames(state.games ?? [], {
    period,
    timeClass,
    sinceEndTime: state.sinceEndTime ?? 0,
  });

  const buckets = new Map();
  let wins = 0;
  let losses = 0;
  let draws = 0;

  for (const game of selected) {
    if (game.outcome === 'win') wins += 1;
    else if (game.outcome === 'loss') losses += 1;
    else draws += 1;

    let bucket = buckets.get(game.timeClass);
    if (!bucket) {
      const anchorFromStats = state.anchors?.[game.timeClass] ?? null;
      bucket = {
        class: game.timeClass,
        games: 0,
        anchor: period === 'session' ? (anchorFromStats ?? game.ratingBefore ?? null) : (game.ratingBefore ?? null),
        current: null,
        delta: null,
      };
      buckets.set(game.timeClass, bucket);
    }

    bucket.games += 1;
    if (game.myRating != null) bucket.current = game.myRating;
  }

  const classes = [...buckets.values()].sort(
    (a, b) => TIME_CLASSES.indexOf(a.class) - TIME_CLASSES.indexOf(b.class),
  );
  for (const bucket of classes) {
    bucket.delta = bucket.current != null && bucket.anchor != null ? bucket.current - bucket.anchor : null;
  }

  return {
    period,
    timeClass,
    wins,
    losses,
    draws,
    total: selected.length,
    byClass: classes,
    rows: selected.slice().reverse(),
    last10: selected.slice(-10).reverse(),
  };
}

/** Топ соперников: игры, В/П/Н, процент очков, средний рейтинг. */
export function aggregateOpponents(games, options = {}) {
  const { limit = 5, sortBy = 'games' } = typeof options === 'number' ? { limit: options } : options;
  const map = new Map();

  for (const game of games ?? []) {
    const name = game.opponent || '—';
    const key = normName(name);
    let entry = map.get(key);
    if (!entry) {
      entry = { name, games: 0, wins: 0, losses: 0, draws: 0, ratingSum: 0, ratingCount: 0 };
      map.set(key, entry);
    }
    entry.games += 1;
    if (game.outcome === 'win') entry.wins += 1;
    else if (game.outcome === 'loss') entry.losses += 1;
    else entry.draws += 1;
    if (game.opponentRating != null) {
      entry.ratingSum += game.opponentRating;
      entry.ratingCount += 1;
    }
  }

  const comparators = {
    games: (a, b) => b.games - a.games || b.score - a.score,
    rating: (a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0) || b.games - a.games,
    score: (a, b) => b.score - a.score || b.games - a.games,
  };
  const compare = comparators[sortBy] ?? comparators.games;

  return [...map.values()]
    .map((entry) => ({
      name: entry.name,
      games: entry.games,
      wins: entry.wins,
      losses: entry.losses,
      draws: entry.draws,
      avgRating: entry.ratingCount ? Math.round(entry.ratingSum / entry.ratingCount) : null,
      score: entry.games ? (entry.wins + entry.draws * 0.5) / entry.games : 0,
    }))
    .sort((a, b) => compare(a, b) || a.name.localeCompare(b.name, 'ru'))
    .slice(0, limit);
}

/** Топ дебютов: код ECO, название, игры и результат. */
export function aggregateOpenings(games, limit = 5) {
  const map = new Map();

  for (const game of games ?? []) {
    const opening = game.opening;
    const key = opening?.name ? `${opening.eco ?? '—'}|${opening.name}` : 'none';
    let entry = map.get(key);
    if (!entry) {
      entry = {
        eco: opening?.eco ?? null,
        name: opening?.name ?? null,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      map.set(key, entry);
    }
    entry.games += 1;
    if (game.outcome === 'win') entry.wins += 1;
    else if (game.outcome === 'loss') entry.losses += 1;
    else entry.draws += 1;
  }

  return [...map.values()]
    .map((entry) => ({
      ...entry,
      score: entry.games ? (entry.wins + entry.draws * 0.5) / entry.games : 0,
    }))
    .sort((a, b) => {
      if (a.name == null && b.name != null) return 1;
      if (b.name == null && a.name != null) return -1;
      return b.games - a.games || b.score - a.score;
    })
    .slice(0, limit);
}

/** Точки для графика рейтинга (только партии с известным рейтингом). */
export function chartSeries(games) {
  return (games ?? [])
    .filter((game) => game.myRating != null)
    .map((game) => ({
      value: game.myRating,
      outcome: game.outcome,
      endTime: game.endTime,
      opponent: game.opponent,
      opponentRating: game.opponentRating,
      ratingDiff: game.ratingDiff,
      url: game.url,
    }));
}

/**
 * Список месяцев [год, месяц] от fromSec до toSec включительно (по возрастанию).
 * Идём назад от текущего месяца, поэтому текущий месяц попадает в список всегда,
 * а max ограничивает только глубину истории.
 */
export function monthsSince(fromSec, toSec = Math.floor(Date.now() / 1000), max = 6) {
  const safeTo = Number.isFinite(toSec) && toSec > 0 ? toSec : Math.floor(Date.now() / 1000);
  const safeFrom = Number.isFinite(fromSec) && fromSec > 0 ? Math.min(fromSec, safeTo) : safeTo - 7 * 86400;

  const start = new Date(safeFrom * 1000);
  const startIndex = start.getUTCFullYear() * 12 + start.getUTCMonth();

  const cursor = new Date(safeTo * 1000);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);

  const months = [];
  while (months.length < max) {
    months.unshift([cursor.getUTCFullYear(), cursor.getUTCMonth() + 1]);
    if (cursor.getUTCFullYear() * 12 + cursor.getUTCMonth() <= startIndex) break;
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return months;
}

export function toCsv(rows) {
  const escape = (value) => {
    const text = String(value ?? '');
    return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const header = [
    'Дата',
    'Время',
    'Контроль',
    'Цвет',
    'Соперник',
    'Рейтинг соперника',
    'Результат',
    'Мой рейтинг',
    'Δ рейтинга',
    'Дебют',
    'Ссылка',
  ];

  const lines = (rows ?? []).map((game) => {
    const date = new Date(game.endTime * 1000);
    return [
      date.toLocaleDateString('ru-RU'),
      date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      CLASS_LABELS[game.timeClass] ?? game.timeClass,
      game.color === 'white' ? 'белые' : 'чёрные',
      game.opponent,
      game.opponentRating ?? '',
      OUTCOME_LABELS[game.outcome] ?? game.outcome,
      game.myRating ?? '',
      game.ratingDiff == null ? '' : game.ratingDiff,
      game.opening?.name ?? '',
      game.url,
    ]
      .map(escape)
      .join(';');
  });

  return [header.join(';'), ...lines].join('\r\n');
}
