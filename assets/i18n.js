// Двуязычность: статические тексты (data-i18n) и строки приложения через t().
// Модуль не трогает DOM при импорте, поэтому безопасен для node:test.

export const LANGS = ['ru', 'en'];
export const LANG_STORAGE_KEY = 'chess-session-tracker:lang';

const DICT = {
  ru: {    'class.all': 'Все',
    'class.bullet': 'Bullet',
    'class.blitz': 'Blitz',
    'class.rapid': 'Rapid',
    'class.classical': 'Classical',
    'class.daily': 'Daily',
    'class.unknown': 'Другое',
    'outcome.win': 'победа',
    'outcome.loss': 'поражение',
    'outcome.draw': 'ничья',
    'period.session': 'Сессия',
    'period.7d': '7 дней',
    'period.90d': '90 дней',
    'meta.title': 'Статистика шахматных сессий — Chess.com и Lichess',
    'meta.description':
      'Считает победы, поражения, ничьи и изменение рейтинга за игровую сессию на Chess.com и Lichess, строит график рейтинга и статистику по соперникам и дебютам.',

    'nav.demo': 'демо',
    'nav.language': 'Язык',

    'setup.title': 'Статистика сессии',
    'setup.titleAccent': 'на Chess.com и Lichess',
    'setup.lead':
      'Укажите площадку и имя игрока, начните сессию. Приложение подтянет партии, завершённые после старта, посчитает победы, поражения, ничьи и изменение рейтинга, а в аналитике покажет график и статистику по соперникам и дебютам.',
    'setup.username': 'Имя пользователя',
    'setup.usernamePlaceholder': 'например, hikaru',
    'setup.timeClass': 'Контроль времени',
    'setup.all': 'Все',
    'setup.start': 'Начать сессию',
    'setup.connecting': 'Подключаюсь…',
    'setup.hint':
      'Партии, завершённые до нажатия кнопки, в сессию не попадают. Если ник не найден на выбранной площадке, приложение попробует вторую. Данные — из публичных API.',
    'setup.enterUsername': 'Введите имя пользователя.',
    'setup.sitePicker': 'Площадка',

    'player.demoBadge': 'демо',
    'player.refresh': 'Обновить',
    'player.reset': 'Сбросить',
    'player.end': 'Завершить',
    'player.avatar': 'Аватар {name}',
    'player.liveFallback': 'Партия',
    'player.liveVs': '{label} · против {opponent}',
    'player.liveYourTurn': '{label} · ваш ход',

    'session.playtime': 'Время за игрой',
    'session.playtimeTitle': 'Сумма длительности завершённых партий сессии',
    'session.wins': 'Победы',
    'session.losses': 'Поражения',
    'session.draws': 'Ничьи',
    'session.winrate': 'Винрейт',
    'session.accuracy': 'Средняя точность',
    'session.streak': 'Серия',
    'session.color': 'Цвет · очки',
    'session.colorAria': 'Результат за белых и чёрных',
    'session.rating': 'Рейтинг за сессию',
    'session.noGames': 'партий пока нет',
    'session.noRatingData': 'нет данных о рейтинге',
    'session.ratingByClass': 'изменение по каждому контролю',
    'session.lastGamesEmpty': 'Пока нет завершённых партий в этой сессии',

    'streak.win': 'побед подряд',
    'streak.loss': 'поражений подряд',
    'streak.draw': 'ничьих подряд',
    'streak.none': 'нет партий',

    'color.white': 'Белые',
    'color.black': 'Чёрные',
    'color.whiteWeak': 'белых',
    'color.blackWeak': 'чёрных',
    'color.title': '{name}: {wins}–{draws}–{losses} ({score}% очков)',
    'color.titleEmpty': '{name}: нет партий',

    'analytics.title': 'Аналитика',
    'analytics.selectedPeriod': 'За выбранный период',
    'analytics.period': 'Период',
    'analytics.opponentsSort': 'Сортировка соперников',
    'analytics.empty': 'пока пусто',
    'analytics.chartTitle': 'Рейтинг по партиям',
    'analytics.chartEmpty': 'Нет данных о рейтинге за выбранный период',
    'analytics.chartMultiShown': '{count} {games} · на графике последние {shown}',
    'analytics.chartMulti': '{count} {games} · контролей: {series}',
    'analytics.chartSingle': '{from} → {to} ({delta}) · {count} {games} · {class}',
    'analytics.opponents': 'Соперники',
    'analytics.top': 'топ-5',
    'analytics.openings': 'Дебюты',
    'table.opponent': 'Соперник',
    'table.games': 'Игры',
    'table.wld': 'В–П–Н',
    'table.points': 'Очки',
    'table.opening': 'Дебют',
    'analytics.periodEmpty': 'Пока нет партий за этот период',
    'opening.none': 'Без дебюта',

    'sort.rating': 'По рейтингу',
    'sort.score': 'По очкам',

    'insights.title': 'Дополнительная статистика',
    'insights.rhythmAria': 'Ритм сессии и сравнение с базой',
    'rhythm.title': 'Ритм сессии',
    'rhythm.breaks': 'Перерывы',
    'rhythm.breakLong': '5+ мин',
    'rhythm.breakQuick': 'быстро',
    'rhythm.fatigue': 'Усталость',
    'rhythm.firstHalf': 'первая',
    'rhythm.secondHalf': 'вторая',
    'rhythm.afterLoss': 'После поражения',
    'rhythm.tempo': 'Темп',
    'rhythm.avgPause': 'пауза {value}',
    'rhythm.avgGame': 'партия {value}',
    'rhythm.perHour': '{value}/час',
    'rhythm.of': 'из',
    'rhythm.notEnough': 'мало данных',
    'baseline.title': 'Сессия против базы',
    'baseline.session': 'сессия',
    'baseline.base': 'база',
    'baseline.delta': 'Δ',
    'baseline.winrate': 'Винрейт',
    'baseline.score': 'Очки',
    'baseline.accuracy': 'Точность',
    'baseline.ratingPace': 'Рейтинг/партия',
    'baseline.footer': 'База: {count} {games}',
    'baseline.notEnough': 'Мало истории для сравнения',
    'unit.pp': 'п.п.',
    'insights.accuracy': 'Точность',
    'insights.accuracyEmpty': 'Нет данных о точности за период',
    'insights.accuracySample': 'партий в выборке: {count}',
    'insights.accuracyWin': '{value}% в победах',
    'insights.accuracyLoss': '{value}% в поражениях',
    'insights.color': 'Цвет',
    'insights.streaks': 'Серии',
    'insights.streakCurrent': 'Сейчас',
    'insights.streakBestWin': 'Лучшая серия побед',
    'insights.streakUnbeaten': 'Без поражений',
    'insights.tod': 'Когда играешь лучше',
    'insights.todEmpty': 'Пока нет партий за период',
    'insights.longterm': 'Рейтинг за год',
    'insights.longtermBtn': 'За 12 месяцев',
    'insights.longtermLoading': 'Загружаю…',
    'insights.longtermCaption': '{parts} · закешировано {ago}',
    'insights.longtermEmpty': 'Нажмите «За 12 месяцев», чтобы подгрузить историю рейтинга.',

    'log.title': 'Журнал партий сессии',
    'log.empty': 'Партий пока нет. Сыграйте — и они появятся здесь.',
    'log.time': 'Время',
    'log.color': 'Цвет',
    'log.opponent': 'Соперник',
    'log.result': 'Результат',
    'log.rating': 'Рейтинг',

    'footer.text': 'Неофициальный проект · обновление раз в 30 секунд · данные из публичных API Chess.com и Lichess',

    'status.demo': 'демо-режим',
    'status.syncing': 'обновляю…',
    'status.error': 'нет связи, повторяю',
    'status.updated': 'обновлено {ago}',

    'time.justNow': 'только что',
    'time.secAgo': '{count} с назад',
    'time.minAgo': '{count} мин назад',
    'time.hourAgo': '{count} ч назад',
    'duration.sec': '{count} с',
    'duration.min': '{count} мин',
    'duration.hour': '{count} ч',
    'duration.minSec': '{min} мин {sec} с',
    'duration.hourMin': '{hours} ч {min} мин',

    'dialog.end': 'Завершить сессию? Статистика ({count} {games}) будет очищена.',
    'dialog.reset':
      'Сбросить сессию? Отсчёт начнётся заново, а {count} {games} останется в истории для графиков.',
    'note.switched': 'Ник найден на {provider} — переключил площадку автоматически.',
    'note.reset': 'Сессия сброшена: отсчёт начат заново, история осталась в аналитике.',

    'error.usernameNotFound': 'Ник «{name}» не найден ни на Chess.com, ни на Lichess.',
    'error.userNotFound': 'Пользователь не найден.',
    'error.network': 'Нет связи с сервисом. Проверьте интернет — обновление продолжится автоматически.',
    'error.ratelimit': 'Сервис ограничил частоту запросов. Подождите минуту.',
    'error.timeout': 'Сервис не ответил вовремя. Попробуйте ещё раз.',
    'error.generic': 'Что-то пошло не так. Попробуйте ещё раз.',
    'error.http': 'Сервис ответил ошибкой {status}',
    'error.parse': 'Сервис вернул некорректный ответ',
    'error.aborted': 'Запрос отменён',
    'provider.anonymous': 'Аноним',

    'chart.series': 'Рейтинг',
    'chart.rating': 'рейтинг {value}',
    'chart.summaryMulti': '{series} контролей, {points} точек',
    'chart.summarySingle': 'партий: {points}, с {first} до {last}',
    'chart.aria': 'График рейтинга: {summary}',
    'tooltip.vs': 'против {name}',

    'tip.lossStreak': 'Серия поражений: {count}. Сделайте паузу и вернитесь свежим.',
    'tip.timeLoss':
      'Доля поражений на времени: {share}%. Попробуйте контроль длиннее или оставляйте запас 20–30 секунд.',
    'tip.opening': 'Дебют «{name}»: {share}% очков, партий: {count}. Стоит разобрать его или сменить.',
    'tip.color':
      'За белых {white}% очков, за чёрных {black}% — хуже результат за {weaker}.',
    'tip.timeOfDay': 'Днём {day}% очков, ночью {night}% — похоже, поздние сессии даются хуже.',
    'tip.accuracyLow':
      'Средняя точность {value}% — есть запас для роста: больше времени на расчёт простых тактик.',
    'tip.accuracyGap':
      'В победах точность {win}%, в поражениях {loss}% — разрыв говорит о нестабильности расчёта.',
    'tip.even': 'Партий: {count}, очков: {score}% — ровный результат, явных провалов не видно.',

    'time.night': 'Ночь',
    'time.morning': 'Утро',
    'time.day': 'День',
    'time.evening': 'Вечер',
  },

  en: {
    'class.all': 'All',
    'class.bullet': 'Bullet',
    'class.blitz': 'Blitz',
    'class.rapid': 'Rapid',
    'class.classical': 'Classical',
    'class.daily': 'Daily',
    'class.unknown': 'Other',
    'outcome.win': 'win',
    'outcome.loss': 'loss',
    'outcome.draw': 'draw',
    'period.session': 'Session',
    'period.7d': '7 days',
    'period.90d': '90 days',
    'meta.title': 'Chess session stats — Chess.com and Lichess',
    'meta.description':
      'Tracks wins, losses, draws and rating change for a chess session on Chess.com and Lichess, with a rating chart, opponents and openings.',

    'nav.demo': 'demo',
    'nav.language': 'Language',

    'setup.title': 'Session statistics',
    'setup.titleAccent': 'for Chess.com and Lichess',
    'setup.lead':
      'Pick a platform and enter a username, then start a session. The app downloads games finished after you start, counts wins, losses, draws and rating change, and shows a rating chart with opponents and openings.',
    'setup.username': 'Username',
    'setup.usernamePlaceholder': 'e.g. hikaru',
    'setup.timeClass': 'Time control',
    'setup.all': 'All',
    'setup.start': 'Start session',
    'setup.connecting': 'Connecting…',
    'setup.hint':
      'Games finished before you press the button are not included. If the username is not found on the selected platform, the app tries the other one. Data comes from public APIs.',
    'setup.enterUsername': 'Enter a username.',
    'setup.sitePicker': 'Platform',

    'player.demoBadge': 'demo',
    'player.refresh': 'Refresh',
    'player.reset': 'Reset',
    'player.end': 'End',
    'player.avatar': '{name} avatar',
    'player.liveFallback': 'Game',
    'player.liveVs': '{label} · vs {opponent}',
    'player.liveYourTurn': '{label} · your turn',

    'session.playtime': 'Time played',
    'session.playtimeTitle': 'Total duration of completed games in this session',
    'session.wins': 'Wins',
    'session.losses': 'Losses',
    'session.draws': 'Draws',
    'session.winrate': 'Win rate',
    'session.accuracy': 'Average accuracy',
    'session.streak': 'Streak',
    'session.color': 'Color · score',
    'session.colorAria': 'Result as White and Black',
    'session.rating': 'Session rating',
    'session.noGames': 'no games yet',
    'session.noRatingData': 'no rating data',
    'session.ratingByClass': 'change by time control',
    'session.lastGamesEmpty': 'No completed games in this session yet',

    'streak.win': 'wins in a row',
    'streak.loss': 'losses in a row',
    'streak.draw': 'draws in a row',
    'streak.none': 'no games',

    'color.white': 'White',
    'color.black': 'Black',
    'color.whiteWeak': 'White',
    'color.blackWeak': 'Black',
    'color.title': '{name}: {wins}–{draws}–{losses} ({score}% score)',
    'color.titleEmpty': '{name}: no games',

    'analytics.title': 'Analytics',
    'analytics.selectedPeriod': 'For the selected period',
    'analytics.period': 'Period',
    'analytics.opponentsSort': 'Sort opponents',
    'analytics.empty': 'empty',
    'analytics.chartTitle': 'Rating by game',
    'analytics.chartEmpty': 'No rating data for the selected period',
    'analytics.chartMultiShown': '{count} {games} · showing last {shown}',
    'analytics.chartMulti': '{count} {games} · controls: {series}',
    'analytics.chartSingle': '{from} → {to} ({delta}) · {count} {games} · {class}',
    'analytics.opponents': 'Opponents',
    'analytics.top': 'top 5',
    'analytics.openings': 'Openings',
    'table.opponent': 'Opponent',
    'table.games': 'Games',
    'table.wld': 'W–L–D',
    'table.points': 'Score',
    'table.opening': 'Opening',
    'analytics.periodEmpty': 'No games for this period yet',
    'opening.none': 'No opening',

    'sort.rating': 'By rating',
    'sort.score': 'By score',

    'insights.title': 'More statistics',
    'insights.rhythmAria': 'Session rhythm and baseline comparison',
    'rhythm.title': 'Session rhythm',
    'rhythm.breaks': 'Breaks',
    'rhythm.breakLong': '5+ min',
    'rhythm.breakQuick': 'quick',
    'rhythm.fatigue': 'Fatigue',
    'rhythm.firstHalf': 'first',
    'rhythm.secondHalf': 'second',
    'rhythm.afterLoss': 'After a loss',
    'rhythm.tempo': 'Tempo',
    'rhythm.avgPause': 'pause {value}',
    'rhythm.avgGame': 'game {value}',
    'rhythm.perHour': '{value}/hour',
    'rhythm.of': 'of',
    'rhythm.notEnough': 'not enough data',
    'baseline.title': 'Session vs baseline',
    'baseline.session': 'session',
    'baseline.base': 'baseline',
    'baseline.delta': 'Δ',
    'baseline.winrate': 'Win rate',
    'baseline.score': 'Score',
    'baseline.accuracy': 'Accuracy',
    'baseline.ratingPace': 'Rating/game',
    'baseline.footer': 'Baseline: {count} {games}',
    'baseline.notEnough': 'Not enough history to compare',
    'unit.pp': 'pp',
    'insights.accuracy': 'Accuracy',
    'insights.accuracyEmpty': 'No accuracy data for this period',
    'insights.accuracySample': 'Games in sample: {count}',
    'insights.accuracyWin': '{value}% in wins',
    'insights.accuracyLoss': '{value}% in losses',
    'insights.color': 'Color',
    'insights.streaks': 'Streaks',
    'insights.streakCurrent': 'Current',
    'insights.streakBestWin': 'Best win streak',
    'insights.streakUnbeaten': 'Unbeaten streak',
    'insights.tod': 'When you play better',
    'insights.todEmpty': 'No games for this period yet',
    'insights.longterm': 'Rating over the year',
    'insights.longtermBtn': 'Last 12 months',
    'insights.longtermLoading': 'Loading…',
    'insights.longtermCaption': '{parts} · cached {ago}',
    'insights.longtermEmpty': 'Click “Last 12 months” to load rating history.',

    'log.title': 'Session game log',
    'log.empty': 'No games yet. Play one and it will appear here.',
    'log.time': 'Time',
    'log.color': 'Color',
    'log.opponent': 'Opponent',
    'log.result': 'Result',
    'log.rating': 'Rating',

    'footer.text': 'Unofficial project · updates every 30 seconds · data from public Chess.com and Lichess APIs',

    'status.demo': 'demo mode',
    'status.syncing': 'updating…',
    'status.error': 'offline, retrying',
    'status.updated': 'updated {ago}',

    'time.justNow': 'just now',
    'time.secAgo': '{count}s ago',
    'time.minAgo': '{count}m ago',
    'time.hourAgo': '{count}h ago',
    'duration.sec': '{count}s',
    'duration.min': '{count}m',
    'duration.hour': '{count}h',
    'duration.minSec': '{min}m {sec}s',
    'duration.hourMin': '{hours}h {min}m',

    'dialog.end': 'End session? Statistics ({count} {games}) will be cleared.',
    'dialog.reset': 'Reset session? The count starts over; {count} {games} will stay in history for charts.',
    'note.switched': 'Username found on {provider} — switched platform automatically.',
    'note.reset': 'Session reset: the count started over; history remains in analytics.',

    'error.usernameNotFound': 'Username “{name}” was not found on Chess.com or Lichess.',
    'error.userNotFound': 'User not found.',
    'error.network': 'No connection to the service. Check your internet — updates will resume automatically.',
    'error.ratelimit': 'The service is rate limiting requests. Wait a minute.',
    'error.timeout': 'The service did not respond in time. Try again.',
    'error.generic': 'Something went wrong. Try again.',
    'error.http': 'The service returned error {status}',
    'error.parse': 'The service returned an invalid response',
    'error.aborted': 'Request cancelled',
    'provider.anonymous': 'Anonymous',

    'chart.series': 'Rating',
    'chart.rating': 'rating {value}',
    'chart.summaryMulti': 'controls: {series}, points: {points}',
    'chart.summarySingle': 'games: {points}, from {first} to {last}',
    'chart.aria': 'Rating chart: {summary}',
    'tooltip.vs': 'vs {name}',

    'tip.lossStreak': 'Loss streak: {count}. Take a break and come back fresh.',
    'tip.timeLoss': 'Share of losses on time: {share}%. Try a longer control or keep 20–30 seconds in reserve.',
    'tip.opening': 'Opening “{name}”: {share}% score, games: {count}. Worth reviewing or changing.',
    'tip.color': 'You score {white}% as White and {black}% as Black — weaker as {weaker}.',
    'tip.timeOfDay': 'You score {day}% during the day but {night}% at night — late sessions may be harder.',
    'tip.accuracyLow': 'Average accuracy {value}% — room to grow: spend more time on simple tactics.',
    'tip.accuracyGap': 'Accuracy {win}% in wins, {loss}% in losses — the gap suggests inconsistent calculation.',
    'tip.even': 'Games: {count}, score: {score}% — steady results, no obvious collapses.',

    'time.night': 'Night',
    'time.morning': 'Morning',
    'time.day': 'Day',
    'time.evening': 'Evening',
  },
};

export const TRANSLATIONS = DICT;

let current = 'ru';

export function setLanguage(lang) {
  current = LANGS.includes(lang) ? lang : 'ru';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  return current;
}

export function getLanguage() {
  return current;
}

export function getLocale() {
  return current === 'ru' ? 'ru-RU' : 'en-US';
}

export function t(key, params = {}) {
  const template = DICT[current][key] ?? DICT.ru[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] == null ? '' : String(params[name])));
}

export function classLabel(id) {
  return t(`class.${id}`);
}

export function outcomeLabel(id) {
  return t(`outcome.${id}`);
}

export function periodLabel(id) {
  return t(`period.${id}`);
}

export function sortLabel(id) {
  return t(`sort.${id}`);
}

export function timeBucketLabel(id) {
  return t(`time.${id}`);
}

export function gamesWord(count) {
  if (current === 'ru') {
    const tens = Math.abs(count) % 100;
    const ones = tens % 10;
    if (tens > 10 && tens < 20) return 'партий';
    if (ones === 1) return 'партия';
    if (ones >= 2 && ones <= 4) return 'партии';
    return 'партий';
  }
  return count === 1 ? 'game' : 'games';
}

export function applyStaticTranslations(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.setAttribute('title', t(node.dataset.i18nTitle));
  });
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('meta.description'));
    document.title = t('meta.title');
  }
}
