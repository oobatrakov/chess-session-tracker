// Цитаты для стартового экрана. Показывается одна случайная при каждой загрузке.

export const QUOTES = {
  ru: [
    { text: 'Пешки — душа шахмат.', author: 'Франсуа Филидор' },
    { text: 'Когда видишь хороший ход, ищи лучший.', author: 'Эмануил Ласкер' },
    { text: 'Комбинация — душа шахмат.', author: 'Александр Алехин' },
    { text: 'Шахматы — это жизнь.', author: 'Борис Спасский' },
    { text: 'Выигрывает тот, кто делает предпоследнюю ошибку.', author: 'Савелий Тартаковер' },
    { text: 'Шахматы — это гимнастика ума.', author: 'приписывается Блезу Паскалю' },
    { text: 'В шахматах нет ничего труднее выбора хода.', author: 'Макс Эйве' },
    { text: 'Не бойтесь играть в шахматы с сильным соперником — это лучший способ расти.', author: 'Рихард Рети' },
    { text: 'Шахматы — это искусство анализа.', author: 'Михаил Ботвинник' },
    { text: 'Хороший шахматист — тот, кто знает свои слабые места.', author: 'Тигран Петросян' },
    { text: 'Главное — не сыграть красивую партию, а сыграть её хорошо.', author: 'Анатолий Карпов' },
    { text: 'Лучший ход — тот, о котором соперник не задумывался.', author: 'Михаил Таль' },
  ],
  en: [
    { text: 'Pawns are the soul of chess.', author: 'François Philidor' },
    { text: 'When you see a good move, look for a better one.', author: 'Emanuel Lasker' },
    { text: 'Combination is the soul of chess.', author: 'Alexander Alekhine' },
    { text: 'Chess is life.', author: 'Boris Spassky' },
    { text: 'The winner is the one who makes the next-to-last mistake.', author: 'Savielly Tartakower' },
    { text: 'Chess is the gymnasium of the mind.', author: 'attributed to Blaise Pascal' },
    { text: 'There is nothing harder in chess than choosing a move.', author: 'Max Euwe' },
    { text: 'Do not fear playing a stronger opponent — it is the best way to improve.', author: 'Richard Réti' },
    { text: 'Chess is the art of analysis.', author: 'Mikhail Botvinnik' },
    { text: 'A good chess player is one who knows their weaknesses.', author: 'Tigran Petrosian' },
    { text: 'The point is not to play a beautiful game, but to play it well.', author: 'Anatoly Karpov' },
    { text: 'The best move is the one your opponent has not considered.', author: 'Mikhail Tal' },
  ],
};

/** Случайная цитата для языка, отличная от предыдущей (если передана). */
export function pickQuote(lang = 'ru', previousText = '') {
  const pool = QUOTES[lang] ?? QUOTES.ru;
  const filtered = pool.filter((quote) => quote.text !== previousText);
  const list = filtered.length ? filtered : pool;
  return list[Math.floor(Math.random() * list.length)];
}
