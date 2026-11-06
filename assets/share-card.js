// PNG-карточка результата сессии: рисуем на canvas без библиотек.

const COLORS = {
  win: '#3ddc84',
  loss: '#ff5d6c',
  draw: '#f6c445',
  accent: '#6ea8ff',
  text: '#e9f0fb',
  muted: '#93a4bd',
  dim: '#6b7c96',
};

const WIDTH = 1200;
const HEIGHT = 675;

const FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawOutcomeIcon(ctx, x, y, radius, outcome) {
  const color = COLORS[outcome] ?? COLORS.muted;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();

  const barWidth = radius * 1.05;
  const barHeight = 3;
  const offset = radius * 0.32;
  ctx.fillStyle = color;

  const bar = (cx, cy) => {
    roundedRect(ctx, cx - barWidth / 2, cy - barHeight / 2, barWidth, barHeight, 2);
    ctx.fill();
  };

  if (outcome === 'win') {
    bar(x, y);
    roundedRect(ctx, x - barHeight / 2, y - barWidth / 2, barHeight, barWidth, 2);
    ctx.fill();
  } else if (outcome === 'loss') {
    bar(x, y);
  } else {
    bar(x, y - offset);
    bar(x, y + offset);
  }
}

function drawLabel(ctx, text, x, y, { size = 20, color = COLORS.muted, weight = 600, align = 'center' } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function drawValue(ctx, text, x, y, { size = 96, color = COLORS.text, weight = 700, align = 'center' } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

export function renderSessionCard(data) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#0b1119');
  background.addColorStop(0.55, '#111a27');
  background.addColorStop(1, '#0c1219');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(210, 40, 0, 210, 40, 620);
  glow.addColorStop(0, 'rgba(110,168,255,0.18)');
  glow.addColorStop(1, 'rgba(110,168,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Рамка карточки
  ctx.strokeStyle = 'rgba(35,49,70,0.9)';
  ctx.lineWidth = 2;
  roundedRect(ctx, 32, 32, WIDTH - 64, HEIGHT - 64, 28);
  ctx.stroke();

  // Шапка
  drawLabel(ctx, '♞ Chess Session Tracker', 72, 96, {
    size: 24,
    color: COLORS.accent,
    weight: 700,
    align: 'left',
  });
  drawLabel(ctx, data.dateLabel ?? '', WIDTH - 72, 96, { size: 20, align: 'right' });

  // Игрок
  drawValue(ctx, data.displayName ?? '', 72, 168, { size: 52, weight: 700, align: 'left' });
  drawLabel(ctx, data.providerLabel ?? '', 72, 204, { size: 20, align: 'left' });

  // W / L / D
  const columns = [
    { x: 300, value: data.wins ?? 0, label: 'ПОБЕДЫ', color: COLORS.win },
    { x: 600, value: data.losses ?? 0, label: 'ПОРАЖЕНИЯ', color: COLORS.loss },
    { x: 900, value: data.draws ?? 0, label: 'НИЧЬИ', color: COLORS.draw },
  ];

  for (const column of columns) {
    drawValue(ctx, String(column.value), column.x, 320, { size: 104, color: column.color });
    drawLabel(ctx, column.label, column.x, 352, { size: 18 });
  }

  // Рейтинг
  const delta = data.delta;
  const deltaText = delta == null ? '—' : delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';
  const deltaColor = delta == null ? COLORS.muted : delta > 0 ? COLORS.win : delta < 0 ? COLORS.loss : COLORS.muted;

  drawLabel(ctx, 'РЕЙТИНГ ЗА СЕССИЮ', 600, 424, { size: 18 });
  drawValue(ctx, deltaText, 600, 512, { size: 92, color: deltaColor });
  if (data.ratingFrom != null && data.ratingTo != null) {
    drawLabel(ctx, `${data.ratingFrom} → ${data.ratingTo}`, 600, 546, { size: 22, color: COLORS.muted });
  }

  // Последние партии
  const outcomes = Array.isArray(data.last10) ? data.last10.slice(0, 10) : [];
  if (outcomes.length) {
    const radius = 21;
    const gap = 58;
    const totalWidth = (outcomes.length - 1) * gap;
    const startX = 600 - totalWidth / 2;

    outcomes.forEach((outcome, index) => {
      drawOutcomeIcon(ctx, startX + index * gap, 592, radius, outcome);
    });
  }

  // Подвал
  drawLabel(ctx, 'oobatrakov.github.io/chess-session-tracker', 72, 632, {
    size: 17,
    color: COLORS.dim,
    align: 'left',
  });

  return canvas;
}

export function downloadCanvas(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(false);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(true);
    }, 'image/png');
  });
}
