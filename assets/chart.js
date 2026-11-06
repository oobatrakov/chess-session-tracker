// График рейтинга: чистый SVG без библиотек.

import { OUTCOME_LABELS } from './session.js';

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
 * @param {{value:number,outcome:string,endTime:number,opponent:string,ratingDiff:number|null}[]} points
 * @returns {string} SVG-разметка (пустая строка, если данных нет)
 */
export function buildRatingChart(points, { width = 820, height = 250 } = {}) {
  if (!Array.isArray(points) || points.length === 0) return '';

  const innerWidth = width - PAD.left - PAD.right;
  const innerHeight = height - PAD.top - PAD.bottom;

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 20;
  const yMin = min - span * 0.15;
  const yMax = max + span * 0.15;

  const xAt = (index) =>
    PAD.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const yAt = (value) => PAD.top + (1 - (value - yMin) / (yMax - yMin)) * innerHeight;

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)},${yAt(point.value).toFixed(1)}`)
    .join(' ');
  const area = `${line} L${xAt(points.length - 1).toFixed(1)},${(PAD.top + innerHeight).toFixed(1)} L${xAt(0).toFixed(1)},${(PAD.top + innerHeight).toFixed(1)} Z`;

  const gridRows = 4;
  const grid = Array.from({ length: gridRows + 1 }, (_, index) => {
    const value = Math.round(yMin + ((yMax - yMin) * index) / gridRows);
    const y = yAt(value).toFixed(1);
    return (
      `<line class="chart-gridline" x1="${PAD.left}" x2="${width - PAD.right}" y1="${y}" y2="${y}"/>` +
      `<text class="chart-label" x="${PAD.left - 10}" y="${y}" text-anchor="end" dominant-baseline="middle">${value}</text>`
    );
  }).join('');

  const radius = points.length > 140 ? 2.2 : points.length > 60 ? 3.2 : 4.2;

  const dots = points
    .map((point, index) => {
      const diff =
        point.ratingDiff == null
          ? ''
          : ` · ${point.ratingDiff > 0 ? '+' : ''}${point.ratingDiff}`;
      const tip = `${formatTooltipDate(point.endTime)} · ${OUTCOME_LABELS[point.outcome] ?? point.outcome} · ${point.opponent}${diff} · рейтинг ${point.value}`;
      return `<circle class="chart-point ${point.outcome}" cx="${xAt(index).toFixed(1)}" cy="${yAt(point.value).toFixed(1)}" r="${radius}"><title>${escapeXml(tip)}</title></circle>`;
    })
    .join('');

  const first = points[0];
  const last = points[points.length - 1];
  const axisFormat = sameDay(first.endTime, last.endTime) ? formatTime : formatDate;

  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="График рейтинга: ${points.length} партий, с ${first.value} до ${last.value}">
    <g class="chart-grid">${grid}</g>
    <path class="chart-area" d="${area}"/>
    <path class="chart-line" d="${line}"/>
    ${dots}
    <text class="chart-axis" x="${xAt(0)}" y="${height - 8}" text-anchor="start">${axisFormat(first.endTime)}</text>
    <text class="chart-axis" x="${xAt(points.length - 1)}" y="${height - 8}" text-anchor="end">${axisFormat(last.endTime)}</text>
  </svg>`;
}
