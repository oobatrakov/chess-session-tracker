// Диагностика на живых данных: node scripts/smoke.mjs <username> [chesscom|lichess]
// Показывает, что видит приложение, и проверяет расчёты.

import { getProvider } from '../assets/providers/index.js';
import {
  CLASS_LABELS,
  aggregateOpenings,
  aggregateOpponents,
  chartSeries,
  latestEndTime,
  mergeGames,
  selectGames,
  summarize,
} from '../assets/session.js';

const username = process.argv[2] ?? 'erik';
const providerId = process.argv[3] ?? 'chesscom';
const provider = getProvider(providerId);
const DAY = 86_400;

console.log(`Площадка: ${provider.label}, игрок: ${username}`);

const profile = await provider.getProfile(username);
const ratings = await provider.getRatings(profile.username).catch(() => ({}));
console.log(`  найден: ${profile.displayName}, профиль ${profile.profileUrl}`);
console.log(`  рейтинги: ${JSON.stringify(ratings)}`);

const nowSec = Math.floor(Date.now() / 1000);
const games = mergeGames(
  [],
  await provider.getGames(profile.username, { fromSec: nowSec - 135 * DAY, toSec: nowSec }),
);

const byClass = {};
for (const game of games) byClass[game.timeClass] = (byClass[game.timeClass] ?? 0) + 1;
console.log(`  загружено партий: ${games.length} ${JSON.stringify(byClass)}`);
console.log(`  последняя: ${new Date(latestEndTime(games) * 1000).toISOString()}`);

const state = {
  games,
  anchors: ratings,
  sinceEndTime: latestEndTime(games),
};

const session = summarize(state, { period: 'session', timeClass: 'all' });
console.log(`  сессия сразу после старта: ${session.total} партий (ожидается 0)`);
if (session.total !== 0) {
  console.error('ОШИБКА: базовая линия не отсекает старые партии');
  process.exitCode = 1;
}

const week = selectGames(games, {
  period: '7d',
  timeClass: 'all',
  sinceEndTime: state.sinceEndTime,
  nowSec,
});
console.log(`  партий за 7 дней: ${week.length}`);
if (week.length) {
  const summary = summarize(state, { period: '7d', timeClass: 'all' });
  console.log(`    W${summary.wins} L${summary.losses} D${summary.draws}`);
  for (const bucket of summary.byClass) {
    console.log(
      `    ${CLASS_LABELS[bucket.class] ?? bucket.class}: ${bucket.anchor} → ${bucket.current} (${bucket.delta})`,
    );
  }

  const chart = chartSeries(selectGames(games, { period: '7d', timeClass: 'blitz', nowSec }));
  console.log(`    точек графика (blitz): ${chart.length}`);

  const opponents = aggregateOpponents(selectGames(games, { period: '7d', timeClass: 'all', nowSec }));
  console.log(
    `    соперники: ${opponents.map((o) => `${o.name} ${o.games}`).join(', ') || '—'}`,
  );

  const openings = aggregateOpenings(selectGames(games, { period: '7d', timeClass: 'all', nowSec }));
  console.log(
    `    дебюты: ${openings.map((o) => `${o.name ?? 'без дебюта'} (${o.games})`).join(', ') || '—'}`,
  );
}
