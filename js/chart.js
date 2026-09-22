'use strict';

// Gráficas SVG mínimas (línea y barras agrupadas), sin dependencias.

function niceTimeStep(range) {
  const steps = [5, 10, 15, 30, 60, 90, 120, 180, 300, 600, 900];
  return steps.find(s => range / s <= 5) || 1200;
}

function renderChart(el, opts) {
  const {
    type = 'line', labels = [], series = [], yFormat = 'time',
    goal = null, goalLabel = '', height = 220, onSelect = null,
  } = opts;

  const hasData = series.some(s => s.values.some(v => v != null));
  if (!labels.length || !hasData) {
    el.innerHTML = '<div class="chart-empty">Aún no hay datos para esta gráfica.</div>';
    return;
  }

  const W = Math.max(280, Math.round(el.clientWidth || 340));
  const H = height;
  const P = { l: 40, r: 10, t: 14, b: 26 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;

  const vals = series.flatMap(s => s.values).filter(v => v != null);
  if (goal != null) vals.push(goal);
  const maxV = Math.max(1, ...vals);
  const step = yFormat === 'pct' ? 25 : niceTimeStep(maxV);
  const top = yFormat === 'pct' ? 100 : Math.max(step, Math.ceil(maxV / step) * step);

  const n = labels.length;
  const band = iw / n;
  const y = v => P.t + ih - (v / top) * ih;
  const x = i => type === 'bar'
    ? P.l + band * i + band / 2
    : (n === 1 ? P.l + iw / 2 : P.l + (iw * i) / (n - 1));
  const fmtY = v => (yFormat === 'pct' ? `${Math.round(v)}%` : fmt(v));

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Gráfica">`;

  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="c-grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="c-axis" x="${P.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${fmtY(v)}</text>`;
  }

  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 44))));
  labels.forEach((l, i) => {
    const lastFits = i === n - 1 && i % every >= every / 2;
    if (i % every !== 0 && !lastFits) return;
    svg += `<text class="c-axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${l}</text>`;
  });

  if (goal != null && goal <= top) {
    svg += `<line class="c-goal" x1="${P.l}" x2="${W - P.r}" y1="${y(goal)}" y2="${y(goal)}"/>`;
    svg += `<text class="c-goal-label" x="${W - P.r}" y="${y(goal) - 5}" text-anchor="end">${goalLabel}</text>`;
  }

  if (type === 'bar') {
    const k = series.length;
    const bw = Math.min(26, (band * 0.72) / k);
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (v == null) return;
        const bx = x(i) - (bw * k) / 2 + si * bw;
        const h = Math.max(1, y(0) - y(v));
        svg += `<rect x="${bx + 1}" y="${y(0) - h}" width="${Math.max(2, bw - 2)}" height="${h}" rx="3" style="fill:${s.color}"><title>${labels[i]} · ${s.name}: ${fmtY(v)}</title></rect>`;
      });
    });
  } else {
    series.forEach(s => {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (pts.length > 1) {
        svg += `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" style="stroke:${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"${s.dashed ? ' stroke-dasharray="5 4"' : ''}/>`;
      }
      s.values.forEach((v, i) => {
        if (v == null) return;
        svg += `<circle cx="${x(i)}" cy="${y(v)}" r="4" style="fill:${s.color}" class="c-dot"><title>${labels[i]} · ${s.name}: ${fmtY(v)}</title></circle>`;
      });
    });
  }

  // Zonas de toque para seleccionar un punto/barra.
  const slice = type === 'bar' ? band : (n > 1 ? iw / (n - 1) : iw);
  labels.forEach((_, i) => {
    svg += `<rect class="c-hit" data-i="${i}" x="${x(i) - slice / 2}" y="${P.t}" width="${slice}" height="${ih}" fill="transparent"/>`;
  });

  svg += '</svg>';

  const legend = series.length > 1
    ? `<div class="c-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`
    : '';
  el.innerHTML = legend + svg;

  if (onSelect) {
    el.querySelector('svg').addEventListener('click', e => {
      const hit = e.target.closest('[data-i]');
      if (hit) onSelect(Number(hit.dataset.i));
    });
    onSelect(n - 1);
  }
}
