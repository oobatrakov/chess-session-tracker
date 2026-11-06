// График рейтинга: чистый SVG без библиотек. Поддерживает несколько линий (по контролям).

import { OUTCOME_LABELS } from './session.js';

export const CLASS_COLORS = {
  bullet: '#ffb454',
  blitz: '#6ea8ff',
  rapid: '#3ddc84',
  classical: '#c084fc',
  daily: '#f2c14e',
  unknown: '#93a4bd',
};

const PAD = { top: 16, right: 14, bottom: 26, left: 46 };

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[char]);

const formatDate = (unixSeconds) =>
  new Date(unixSeconds * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

const formatTime = (unixSeconds) =>
  new Date(unixSeconds * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const formatTooltipDate = (unixSeconds) =>
  new Date(unixSeconds * 1000).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const sameDay = (first, second) =>
  new Date(first * 1000).toDateString() === new Date(second * 1000).toDateString();

/**
 * @param {Array} input либо массив точек [{value,endTime,outcome}], либо массив серий
 *   [{label, color, points:[{value,endTime,outcome}]}]
 * @param {{width?:number,height?:number,showOutcomes?:boolean}} options
 */
export function buildRatingChart(input, options = {}) {
  const { width = 820, height = 250, showOutcomes = true } = options;

  let series = Array.isArray(input) ? input : [];
  if (series.length && series[0]?.value !== undefined) {
    series = [{ label: 'Рейтинг', color: CLASS_COLORS.blitz, points: series }];
  }
  series = series.filter((item) => Array.isArray(item?.points) && item.points.length);
  if (!series.length) return '';

  const points = series.flatMap((item) => item.points);
  const times = points.map((point) => point.endTime ?? 0);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const values = points.map((point) => point.value);

  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 20;
  const yMin = min - span * 0.15;
  const yMax = max + span * 0.15;

  const xAt = (time) => {
    if (points.length === 1 || maxTime === minTime) return PAD.left + innerWidth / 2;
    return PAD.left + ((time - minTime) / (maxTime - minTime)) * innerWidth;
  };
  const yAt = (value) => PAD.top + (1 - (value - yMin) / (yMax - yMin)) * innerHeight;

  const gridRows = 4;
  const grid = Array.from({ length: gridRows + 1 }, (_, index) => {
    const value = Math.round(yMin + ((yMax - yMin) * index) / gridRows);
    const y = yAt(value).toFixed(1);
    return (
      `<line class="chart-gridline" x1="${PAD.left}" x2="${width - PAD.right}" y1="${y}" y2="${y}"/>` +
      `<text class="chart-label" x="${PAD.left - 10}" y="${y}" text-anchor="end" dominant-baseline="middle">${value}</text>`
    );
  }).join('');

  const multi = series.length > 1;
  const radius = points.length > 140 ? 2.2 : points.length > 60 ? 3.2 : 4.2;

  const paths = series
    .map((item) => {
      const line = item.points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(point.endTime ?? 0).toFixed(1)},${yAt(point.value).toFixed(1)}`)
        .join(' ');
      const color = item.color ?? CLASS_COLORS[item.timeClass] ?? CLASS_COLORS.unknown;
      return `<path class="chart-line" d="${line}" stroke="${color}"/>`;
    })
    .join('');

  const dots = showOutcomes && !multi
    ? series[0].points
        .map((point) => {
          const diff =
            point.ratingDiff == null ? '' : ` · ${point.ratingDiff > 0 ? '+' : ''}${point.ratingDiff}`;
          const tip = `${formatTooltipDate(point.endTime)} · ${OUTCOME_LABELS[point.outcome] ?? point.outcome} · ${point.opponent ?? ''}${diff} · рейтинг ${point.value}`;
          return `<circle class="chart-point ${point.outcome}" cx="${xAt(point.endTime).toFixed(1)}" cy="${yAt(point.value).toFixed(1)}" r="${radius}"><title>${escapeXml(tip)}</title></circle>`;
        })
        .join('')
    : series
        .filter((item) => item.points.length === 1)
        .map((item) => {
          const point = item.points[0];
          const color = item.color ?? CLASS_COLORS.unknown;
          return `<circle cx="${xAt(point.endTime).toFixed(1)}" cy="${yAt(point.value).toFixed(1)}" r="5" fill="${color}"/>`;
        })
        .join('');

  const axisFormat = sameDay(minTime, maxTime) ? formatTime : formatDate;
  const last = series[0].points[series[0].points.length - 1];
  const summary = multi
    ? `${series.length} контролей, ${points.length} точек`
    : `${points.length} партий, с ${series[0].points[0].value} до ${last.value}`;

  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="График рейтинга: ${escapeXml(summary)}">
    <g class="chart-grid">${grid}</g>
    ${paths}
    ${dots}
    <text class="chart-axis" x="${PAD.left}" y="${height - 8}" text-anchor="start">${axisFormat(minTime)}</text>
    <text class="chart-axis" x="${width - PAD.right}" y="${height - 8}" text-anchor="end">${axisFormat(maxTime)}</text>
  </svg>`;
}
