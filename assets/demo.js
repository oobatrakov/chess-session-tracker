// Демо-состояние: интерфейс можно посмотреть без реальной игры (?demo=1).

const KNIGHT_AVATAR = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
     <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0" stop-color="#2a3a52"/><stop offset="1" stop-color="#141c28"/>
     </linearGradient></defs>
     <rect width="100" height="100" rx="20" fill="url(#g)"/>
     <text x="50" y="72" font-size="58" text-anchor="middle" fill="#8fb4ff">&#9822;</text>
   </svg>`,
)}`;

const OPPONENTS = [
  ['Morphy_Fan', 1498],
  ['quiet_rook', 1523],
  ['PawnStorm77', 1465],
  ['EndgameEddie', 1540],
  ['BlitzBoris', 1512],
  ['slow_mate', 1531],
];

const OPENINGS = [
  { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' },
  { eco: 'C50', name: 'Italian Game' },
  { eco: 'D35', name: "Queen's Gambit Declined" },
  { eco: 'B12', name: 'Caro-Kann Defense' },
  { eco: 'A45', name: 'Indian Game' },
  { eco: 'C00', name: 'French Defense' },
];

// Хронология: [контроль, результат, рейтинг после партии]
const BLITZ = [
  ['win', 1518],
  ['loss', 1510],
  ['loss', 1503],
  ['win', 1511],
  ['draw', 1511],
  ['win', 1519],
  ['loss', 1511],
  ['win', 1519],
  ['loss', 1511],
  ['loss', 1504],
  ['win', 1512],
  ['draw', 1512],
  ['loss', 1504],
  ['win', 1512],
];

const RAPID = [
  ['win', 1588],
  ['loss', 1580],
  ['win', 1589],
  ['win', 1597],
];

const MY_RESULT = { win: 'win', loss: 'resigned', draw: 'agreed' };
const THEIR_RESULT = { win: 'resigned', loss: 'win', draw: 'agreed' };

export function createDemoState() {
  const nowSec = Math.floor(Date.now() / 1000);
  const games = [];
  let clock = nowSec - (BLITZ.length + RAPID.length) * 420;

  const push = (timeClass, outcome, myRating, index) => {
    const [opponent, opponentRating] = OPPONENTS[index % OPPONENTS.length];
    const opening = index % 7 === 6 ? null : OPENINGS[index % OPENINGS.length];
    clock += 420;
    games.push({
      id: `demo:${timeClass}:${index}`,
      url: '',
      endTime: clock,
      timeClass,
      rated: true,
      color: index % 2 === 0 ? 'white' : 'black',
      outcome,
      myRating,
      ratingDiff: null,
      opponent,
      opponentRating,
      opponentResult: THEIR_RESULT[outcome],
      opening,
      source: 'chesscom',
    });
  };

  RAPID.forEach(([outcome, rating], index) => push('rapid', outcome, rating, index + 10));
  BLITZ.forEach(([outcome, rating], index) => push('blitz', outcome, rating, index));

  return {
    v: 2,
    provider: 'chesscom',
    username: 'demo',
    displayName: 'Demo Player',
    avatar: KNIGHT_AVATAR,
    profileUrl: 'https://www.chess.com/member/demo',
    startedAt: (nowSec - (BLITZ.length + RAPID.length) * 420 - 600) * 1000,
    sinceEndTime: nowSec - (BLITZ.length + RAPID.length) * 420 - 300,
    anchors: { bullet: null, blitz: 1510, rapid: 1580, classical: null, daily: null },
    games,
    timeClass: 'blitz',
    period: 'session',
    chartClass: 'blitz',
    lastSyncAt: Date.now(),
    demo: true,
  };
}
