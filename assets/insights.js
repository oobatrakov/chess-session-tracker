// Дополнительные метрики: точность, цвет, серии, причины поражений, время суток, советы.
// Чистые функции — покрыты тестами.

import { t } from './i18n.js';

export const TIME_BUCKETS = [
  { id: 'night', label: 'Ночь', hint: '0–6', from: 0, to: 6 },
  { id: 'morning', label: 'Утро', hint: '6–12', from: 6, to: 12 },
  { id: 'day', label: 'День', hint: '12–18', from: 12, to: 18 },
  { id: 'evening', label: 'Вечер', hint: '18–24', from: 18, to: 24 },
];

export const LOSS_CAUSE_LABELS = {
  resign: 'Сдача',
  time: 'Время',
  mate: 'Мат',
  abandon: 'Выход',
  other: 'Другое',
};

const scoreOf = (wins, draws, games) => (games ? (wins + draws * 0.5) / games : 0);

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Средняя точность и точность в победах/поражениях (данные есть не везде). */
export function computeAccuracy(games) {
  const measured = (games ?? []).filter((game) => Number.isFinite(game.accuracy) && game.accuracy > 0);
  if (!measured.length) return { games: 0, avg: null, winAvg: null, lossAvg: null };

  const wins = measured.filter((game) => game.outcome === 'win').map((game) => game.accuracy);
  const losses = measured.filter((game) => game.outcome === 'loss').map((game) => game.accuracy);

  return {
    games: measured.length,
    avg: Math.round(average(measured.map((game) => game.accuracy))),
    winAvg: wins.length ? Math.round(average(wins)) : null,
    lossAvg: losses.length ? Math.round(average(losses)) : null,
  };
}

/** Результаты за белых и за чёрных. */
export function computeColorStats(games) {
  return ['white', 'black'].map((color) => {
    const list = (games ?? []).filter((game) => game.color === color);
    const wins = list.filter((game) => game.outcome === 'win').length;
    const losses = list.filter((game) => game.outcome === 'loss').length;
    const draws = list.length - wins - losses;
    return {
      color,
      games: list.length,
      wins,
      losses,
      draws,
      score: scoreOf(wins, draws, list.length),
    };
  });
}

/** Текущая серия, лучшая серия побед и самая длинная серия без поражений. */
export function computeStreaks(games) {
  const list = [...(games ?? [])].sort((a, b) => a.endTime - b.endTime);
  let bestWin = 0;
  let winRun = 0;
  let bestUnbeaten = 0;
  let unbeatenRun = 0;

  for (const game of list) {
    if (game.outcome === 'win') {
      winRun += 1;
      bestWin = Math.max(bestWin, winRun);
    } else {
      winRun = 0;
    }

    if (game.outcome !== 'loss') {
      unbeatenRun += 1;
      bestUnbeaten = Math.max(bestUnbeaten, unbeatenRun);
    } else {
      unbeatenRun = 0;
    }
  }

  let current = { outcome: null, count: 0 };
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const outcome = list[index].outcome;
    if (!current.outcome) current = { outcome, count: 1 };
    else if (current.outcome === outcome) current.count += 1;
    else break;
  }

  return { current, bestWin, bestUnbeaten, games: list.length };
}

/** Причины поражений: сдача, флаг, мат, выход. */
export function computeLossCauses(games) {
  const losses = (games ?? []).filter((game) => game.outcome === 'loss');
  const counts = new Map();

  for (const game of losses) {
    const cause = LOSS_CAUSE_LABELS[game.termination] ? game.termination : 'other';
    counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }

  const items = [...counts.entries()]
    .map(([cause, count]) => ({
      cause,
      label: LOSS_CAUSE_LABELS[cause] ?? 'Другое',
      games: count,
      share: losses.length ? count / losses.length : 0,
    }))
    .sort((a, b) => b.games - a.games);

  return { total: losses.length, items };
}

/** Результат по времени суток (локальное время браузера). */
export function computeTimeOfDay(games) {
  return TIME_BUCKETS.map((bucket) => {
    const list = (games ?? []).filter((game) => {
      const hour = new Date(game.endTime * 1000).getHours();
      return hour >= bucket.from && hour < bucket.to;
    });
    const wins = list.filter((game) => game.outcome === 'win').length;
    const losses = list.filter((game) => game.outcome === 'loss').length;
    const draws = list.length - wins - losses;
    return {
      ...bucket,
      games: list.length,
      wins,
      losses,
      draws,
      score: scoreOf(wins, draws, list.length),
    };
  });
}

/** Дебюты с результатом — для поиска проблемного дебюта. */
export function openingBreakdown(games) {
  const map = new Map();
  for (const game of games ?? []) {
    if (!game.opening?.name) continue;
    const entry = map.get(game.opening.name) ?? {
      name: game.opening.name,
      eco: game.opening.eco ?? null,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    };
    entry.games += 1;
    if (game.outcome === 'win') entry.wins += 1;
    else if (game.outcome === 'draw') entry.draws += 1;
    else entry.losses += 1;
    map.set(game.opening.name, entry);
  }

  return [...map.values()]
    .map((entry) => ({ ...entry, score: scoreOf(entry.wins, entry.draws, entry.games) }))
    .sort((a, b) => b.games - a.games);
}

/** Последний рейтинг в каждом месяце по каждому контролю. */
export function monthlyRatingSeries(games) {
  const byClass = new Map();

  for (const game of games ?? []) {
    if (game.myRating == null) continue;
    const date = new Date(game.endTime * 1000);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!byClass.has(game.timeClass)) byClass.set(game.timeClass, new Map());
    byClass.get(game.timeClass).set(key, {
      endTime: Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), 1) / 1000),
      value: game.myRating,
    });
  }

  const result = {};
  for (const [timeClass, points] of byClass) {
    result[timeClass] = [...points.values()].sort((a, b) => a.endTime - b.endTime);
  }
  return result;
}

/**
 * Короткие советы по данным сессии/периода. Возвращает 1–2 фразы или пустой массив,
 * если данных мало.
 */
export function computeTips({
  games = [],
  accuracy = null,
  colorStats = [],
  lossCauses = null,
  timeOfDay = [],
} = {}) {
  if (games.length < 5) return [];

  const tips = [];
  const streaks = computeStreaks(games);
  const percent = (value) => Math.round(value * 100);

  if (streaks.current.outcome === 'loss' && streaks.current.count >= 3) {
    tips.push(t('tip.lossStreak', { count: streaks.current.count }));
  }

  const timeLoss = lossCauses?.items?.find((item) => item.cause === 'time');
  if (timeLoss && timeLoss.games >= 3 && timeLoss.share >= 0.3) {
    tips.push(t('tip.timeLoss', { share: percent(timeLoss.share) }));
  }

  const openings = openingBreakdown(games).filter((entry) => entry.games >= 3);
  const worst = openings.filter((entry) => entry.score <= 0.35).sort((a, b) => a.score - b.score)[0];
  if (worst) {
    tips.push(
      t('tip.opening', {
        name: worst.name,
        share: percent(worst.score),
        count: worst.games,
      }),
    );
  }

  const white = colorStats.find((item) => item.color === 'white');
  const black = colorStats.find((item) => item.color === 'black');
  if (white?.games >= 3 && black?.games >= 3 && Math.abs(white.score - black.score) >= 0.15) {
    const weaker = white.score < black.score ? t('color.whiteWeak') : t('color.blackWeak');
    tips.push(t('tip.color', { white: percent(white.score), black: percent(black.score), weaker }));
  }

  const night = timeOfDay.find((bucket) => bucket.id === 'night');
  const day = timeOfDay.find((bucket) => bucket.id === 'day');
  if (night?.games >= 3 && day?.games >= 3 && day.score - night.score >= 0.15) {
    tips.push(t('tip.timeOfDay', { day: percent(day.score), night: percent(night.score) }));
  }

  if (accuracy?.avg != null && accuracy.games >= 5 && accuracy.avg < 70) {
    tips.push(t('tip.accuracyLow', { value: accuracy.avg }));
  }

  // Если проблем не нашли — хотя бы отметим, что результат ровный.
  if (!tips.length && accuracy?.winAvg != null && accuracy?.lossAvg != null && accuracy.winAvg - accuracy.lossAvg >= 8) {
    tips.push(t('tip.accuracyGap', { win: accuracy.winAvg, loss: accuracy.lossAvg }));
  }

  if (!tips.length && games.length >= 10) {
    const wins = games.filter((game) => game.outcome === 'win').length;
    const draws = games.filter((game) => game.outcome === 'draw').length;
    tips.push(
      t('tip.even', {
        count: games.length,
        score: percent(scoreOf(wins, draws, games.length)),
      }),
    );
  }

  return tips.slice(0, 2);
}
