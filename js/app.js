'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Índices de getDay(): 0 = domingo.
const DOW = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DAY_NAME = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DOW_PICK = [1, 2, 3, 4, 5, 6, 0]; // orden de lunes a domingo para los selectores
const RING_C = 2 * Math.PI * 90;

const ui = {
  tab: 'hoy',
  tablesSeg: 'CO2',
  chartType: 'line',
  metric: 'longest',
  filter: 'all',
  trainer: null,
};

// ---------- Fechas y calendario ----------

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISODate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = d => `${d.getDate()}/${d.getMonth() + 1}`;
// Sin hora en las sesiones añadidas a mano o importadas sin ella.
const fmtDateTime = (iso, noTime = false) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  return noTime ? day : `${day} · ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
};

// Sesiones de cada semana del programa, en orden.
const WEEK_SESSIONS = ['CO2', 'O2', 'CO2', 'O2', 'CO2'];

// Calendario desde el día de inicio: cada bloque de 7 días es una semana del programa
// y sus 5 sesiones se reparten, en orden, en los días que no son de descanso.
// El Test MAX va el día siguiente a la última sesión (puede caer el día 29).
function buildSchedule() {
  const start = parseISODate(Store.settings.startDate);
  const rest = Store.settings.restDays || [];
  const sw = startWeek();
  const days = [];
  for (let w = sw; w <= 4; w++) {
    let k = 0;
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, (w - sw) * 7 + d);
      const free = rest.includes(date.getDay()) || k >= WEEK_SESSIONS.length;
      days.push({ date, iso: isoDate(date), week: w, plan: free ? null : { type: WEEK_SESSIONS[k++], week: w } });
    }
  }
  let last = days.length - 1;
  while (!days[last].plan) last--;
  const test = { type: 'TEST', week: null };
  if (last + 1 < days.length) days[last + 1].plan = test;
  else {
    const date = addDays(start, days.length);
    days.push({ date, iso: isoDate(date), week: 4, plan: test });
  }
  return days;
}

const startWeek = () => Math.min(4, Math.max(1, Number(Store.settings.startWeek) || 1));

const weekOptions = sel => [1, 2, 3, 4].map(w => `<option value="${w}" ${w === sel ? 'selected' : ''}>Semana ${w}</option>`).join('');

function programInfo(date) {
  const days = buildSchedule();
  const start = days[0].date;
  const iso = isoDate(date);
  if (iso < days[0].iso) return { before: true, start };
  const i = days.findIndex(x => x.iso === iso);
  if (i < 0) return { start, finished: true };
  return { start, days, i, ...days[i] };
}

const sessionsOn = iso => Store.doneSessions().filter(s => isoDate(new Date(s.fecha)) === iso);
const matchesPlan = (s, p) => s.tipo === p.type && (p.week == null || s.semana === p.week);

function planName(p) {
  if (p.type === 'TEST') return 'Test MAX';
  return `Tabla ${TYPE_NAME[p.type]} · Semana ${p.week}`;
}

// ---------- Planes de sesión ----------

function buildPlan(type, week) {
  const s = Store.settings;
  if (type === 'TEST') {
    return { type, week: null, label: 'Test MAX', rounds: [{ apnea: null, rest: 0 }], prep: 120, prepLabel: 'Respira tranquilo', endless: false, max: s.max };
  }
  if (type === 'LIBRE') {
    return { type, week: null, label: 'Apnea libre', rounds: [{ apnea: null, rest: 120 }], prep: s.prep, endless: true, max: s.max };
  }
  const t = getTable(type, week, s.max, Store.overrides);
  return { type, week: type === 'CUSTOM' ? null : week, label: t.label, rounds: t.rounds, prep: s.prep, endless: false, max: s.max };
}

function summarize(rounds) {
  const ap = rounds.map(r => r.apnea);
  const re = rounds.map(r => r.rest);
  const same = a => a.every(v => v === a[0]);
  const a = same(ap) ? `apnea fija <b>${fmt(ap[0])}</b>` : `apnea <b>${fmt(ap[0])} → ${fmt(ap[ap.length - 1])}</b>`;
  const r = same(re) ? `descanso fijo <b>${fmt(re[0])}</b>` : `descanso <b>${fmt(re[0])} → ${fmt(re[re.length - 1])}</b>`;
  return `${rounds.length} rondas · ${a} · ${r}`;
}

function sessionStats(s) {
  const r = s.rondas || [];
  const apneas = r.map(x => x.apneaReal || 0);
  const completed = r.filter(x => x.completada).length;
  return {
    longest: apneas.length ? Math.max(...apneas) : 0,
    total: apneas.reduce((a, b) => a + b, 0),
    completed,
    pct: s.rondasPlan ? Math.min(100, (completed / s.rondasPlan) * 100) : (r.length ? 100 : 0),
  };
}

function sessionTitle(s) {
  if (s.tipo === 'CO2' || s.tipo === 'O2') return `${TYPE_NAME[s.tipo]} · S${s.semana}`;
  return TYPE_NAME[s.tipo] || s.tipo;
}

// ---------- Utilidades de UI ----------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function openModal(html, mount) {
  const dlg = $('#modal');
  const body = document.createElement('div');
  body.id = 'modalBody';
  body.innerHTML = html;
  $('#modalBody').replaceWith(body);
  const close = () => dlg.close();
  if (!dlg.open) dlg.showModal();
  if (mount) mount(body, close);
}

function timeField(label, id, sec) {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `<label class="field"><span>${label}</span>
    <span class="time-input">
      <input type="number" id="${id}-m" min="0" max="59" inputmode="numeric" value="${m}" aria-label="${label} minutos">
      <b>:</b>
      <input type="number" id="${id}-s" min="0" max="59" step="5" inputmode="numeric" value="${s}" aria-label="${label} segundos">
    </span></label>`;
}

function readTime(root, id, min = 0) {
  const m = parseInt($(`#${id}-m`, root).value, 10) || 0;
  const s = parseInt($(`#${id}-s`, root).value, 10) || 0;
  return Math.max(min, m * 60 + s);
}

const ICONS = {
  hoy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>',
  tablas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  historial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  progreso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M4 16l5-6 4 3 7-8"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
};

// ---------- Vistas ----------

function viewHoy() {
  const s = Store.settings;
  let h = '';

  if (!s.startDate) {
    h += `<section class="card hero">
      <div class="eyebrow">Programa de 4 semanas</div>
      <div class="hero-times"><span class="dim">1:30</span><span class="arrow">→</span><span>3:00</span></div>
      <p class="muted">5 sesiones por semana alternando CO₂ y O₂ (CO₂ · O₂ · CO₂ · O₂ · CO₂) y 2 días de descanso. Test final al acabar la semana 4.</p>
      <div class="selects">
        <label class="field"><span>Fecha de inicio</span><input type="date" id="startDate" value="${isoDate(new Date())}"></label>
        <label class="field"><span>Empiezo en la</span><select id="startWeekSel">${weekOptions(1)}</select></label>
      </div>
      <button class="btn primary block" data-act="start-program">Empezar programa</button>
      <p class="hint">¿Ya llevas semanas hechas por tu cuenta? Elige la semana por la que vas e <button class="linkbtn" data-act="open-import">importa tus tiempos</button>.</p>
      <p class="hint">El calendario empieza el día que elijas. Descanso: ${restDaysText()} (cámbialo en Ajustes).</p>
    </section>`;
  } else {
    h += todayCard(programInfo(new Date()));
    h += calendarCard();
  }

  const hasTest = Store.doneSessions().some(x => x.tipo === 'TEST');
  h += `<section class="card">
    <h3>Otras sesiones</h3>
    ${hasTest ? '' : '<p class="hint">Consejo: haz primero un <b>Test MAX</b> para calibrar las tablas con tu tiempo real.</p>'}
    <div class="quick">
      <button class="btn" data-act="open-plan" data-type="TEST">Test MAX</button>
      <button class="btn" data-act="open-plan" data-type="LIBRE">Apnea libre</button>
      <button class="btn" data-act="open-plan" data-type="CUSTOM">Personalizada</button>
    </div>
  </section>
  <section class="card safety">
    <div class="eyebrow warn">Antes de empezar</div>
    <ol class="rules">
      <li>Nunca hagas apnea en agua estando solo.</li>
      <li>Empieza siempre en seco (tumbado o sentado, sin agua).</li>
      <li>No hiperventiles antes de aguantar la respiración.</li>
    </ol>
  </section>`;
  return h;
}

function todayCard(info) {
  if (info.before) {
    return `<section class="card today"><div class="eyebrow">Hoy</div><h2>El programa empieza el ${DAY_NAME[info.start.getDay()].toLowerCase()} ${fmtDate(info.start)}</h2>
      <p class="muted">Mientras tanto puedes hacer un Test MAX o una apnea libre.</p></section>`;
  }
  if (info.finished) {
    return `<section class="card today"><div class="eyebrow">Programa completado</div>
      <h2>¡Has terminado las 4 semanas!</h2>
      <p class="muted">Si aún no lo has hecho, haz el Test MAX final. Después puedes empezar otro ciclo con tu nuevo MAX (${fmt(Store.settings.max)}).</p>
      <div class="row"><button class="btn primary" data-act="open-plan" data-type="TEST">Test MAX</button>
      <button class="btn" data-act="restart-program" data-week="1">Nuevo ciclo desde hoy</button></div></section>`;
  }
  const dayName = DAY_NAME[info.date.getDay()];
  if (!info.plan) {
    return `<section class="card today"><div class="eyebrow">${dayName} · Semana ${info.week}</div>
      <h2>Día de descanso</h2><p class="muted">Recuperar también es entrenar. Mañana toca: ${nextTraining(info)}.</p></section>`;
  }
  const p = info.plan;
  const done = sessionsOn(isoDate(new Date())).some(x => matchesPlan(x, p));
  let detail;
  if (p.type === 'TEST') {
    detail = 'Respira tranquilo 2 minutos, inspira al 90 % y aguanta todo lo que puedas. Ese tiempo es tu nuevo <b>MAX</b>.';
  } else {
    const t = getTable(p.type, p.week, Store.settings.max, Store.overrides);
    detail = summarize(t.rounds);
  }
  return `<section class="card today t-${p.type}">
    <div class="eyebrow">${dayName} · Semana ${info.week}${info.week === 4 && p.type !== 'TEST' ? ' · descarga' : ''}</div>
    <h2>Hoy toca: ${planName(p)}</h2>
    <p class="muted">${detail}</p>
    ${done ? '<p class="done-note">✓ Sesión de hoy completada</p>' : ''}
    <button class="btn primary block" data-act="open-plan" data-type="${p.type}" data-week="${p.week ?? ''}">${done ? 'Repetir' : 'Empezar'}</button>
  </section>`;
}

function nextTraining(info) {
  for (let i = info.i + 1; i < info.days.length; i++) {
    const p = info.days[i].plan;
    const n = i - info.i;
    if (p) return n === 1 ? planName(p) : `${planName(p)} (en ${n} días)`;
  }
  return 'fin del programa';
}

function restDaysText() {
  const r = DOW_PICK.filter(d => (Store.settings.restDays || []).includes(d));
  if (!r.length) return 'los 2 últimos días de cada semana';
  return r.map(d => DAY_NAME[d].toLowerCase()).join(' y ');
}

function calendarCard() {
  const days = buildSchedule();
  const start = days[0].date;
  const today = isoDate(new Date());
  const short = { CO2: 'CO₂', O2: 'O₂', TEST: 'TEST' };
  let rows = '';
  const weeks = 5 - startWeek();
  for (let w = 0; w * 7 < days.length; w++) {
    let cells = '';
    for (let d = 0; d < 7; d++) {
      const day = days[w * 7 + d];
      if (!day) { cells += '<div></div>'; continue; }
      const { date, iso, plan: p } = day;
      const done = p && sessionsOn(iso).some(x => matchesPlan(x, p));
      const cls = ['cal-cell', p ? `t-${p.type}` : 'off', done ? 'done' : '', iso === today ? 'today' : '', !done && p && iso < today ? 'missed' : ''].join(' ');
      cells += p
        ? `<button class="${cls}" data-act="open-plan" data-type="${p.type}" data-week="${p.week ?? ''}" aria-label="${fmtDate(date)} ${planName(p)}"><span class="cal-d">${date.getDate()}</span><span class="cal-t">${done ? '✓' : short[p.type]}</span></button>`
        : `<div class="${cls}"><span class="cal-d">${date.getDate()}</span><span class="cal-t">·</span></div>`;
    }
    rows += `<div class="cal-row"><div class="cal-w">${w < weeks ? `S${days[w * 7].week}` : ''}</div>${cells}</div>`;
  }
  const head = days.slice(0, 7).map(x => `<div class="cal-dow">${DOW[x.date.getDay()]}</div>`).join('');
  return `<section class="card">
    <div class="card-head"><h3>Calendario</h3><span class="muted small">${fmtDate(start)} – ${fmtDate(days[days.length - 1].date)}</span></div>
    <div class="cal-row cal-headrow"><div class="cal-w"></div>${head}</div>
    ${rows}
    <div class="legend"><span><i class="lg-CO2"></i>CO₂</span><span><i class="lg-O2"></i>O₂</span><span><i class="lg-TEST"></i>Test</span><span>✓ hecha</span></div>
  </section>`;
}

function viewTablas() {
  const seg = ui.tablesSeg;
  const s = Store.settings;
  let h = `<div class="seg" role="tablist">
    <button class="${seg === 'CO2' ? 'on' : ''}" data-act="tables-seg" data-v="CO2">CO₂</button>
    <button class="${seg === 'O2' ? 'on' : ''}" data-act="tables-seg" data-v="O2">O₂</button>
    <button class="${seg === 'OTRAS' ? 'on' : ''}" data-act="tables-seg" data-v="OTRAS">Otras</button>
  </div>`;

  if (seg === 'CO2' || seg === 'O2') {
    h += seg === 'CO2'
      ? '<p class="intro">Apnea <b>fija</b> en todas las rondas; el descanso <b>baja</b> cada ronda y acumula CO₂. 8 rondas, 3 sesiones por semana (1.ª, 3.ª y 5.ª). Cada celda es el descanso que tomas <b>después</b> de esa ronda.</p>'
      : '<p class="intro">Descanso <b>fijo</b> de 2:00; el tiempo de apnea <b>sube</b> cada ronda y adapta el cuerpo a funcionar con menos oxígeno. 8 rondas, 2 sesiones por semana (2.ª y 4.ª).</p>';
    h += `<p class="hint">${s.max === BASE_MAX ? 'Tablas originales (MAX 1:30).' : `Escaladas a tu MAX ${fmt(s.max)} (×${(s.max / BASE_MAX).toFixed(2)}).`} Toca una celda para editarla.</p>`;
    for (let w = 1; w <= 4; w++) h += tableCard(seg, w);
  } else {
    h += tableCard('CUSTOM', null);
    h += `<section class="card t-TEST">
      <div class="card-head"><h3>Test MAX</h3></div>
      <p class="muted">2:00 de respiración tranquila, inspira al 90 % y aguanta todo lo que puedas. Al terminar podrás guardarlo como tu nuevo MAX (ahora ${fmt(s.max)}).</p>
      <div class="row"><button class="btn primary" data-act="open-plan" data-type="TEST">Hacer test</button>
      <button class="btn" data-act="add-session" data-type="TEST">Registrar un test a mano</button></div>
    </section>
    <section class="card t-LIBRE">
      <div class="card-head"><h3>Apnea libre</h3></div>
      <p class="muted">Cronómetro de apnea sin objetivo con descanso de 2:00 entre series (ajustable con ±15 s). Termina cuando quieras.</p>
      <button class="btn primary" data-act="open-plan" data-type="LIBRE">Empezar</button>
    </section>`;
  }
  return h;
}

function tableCard(type, week) {
  const t = getTable(type, week, Store.settings.max, Store.overrides);
  const ap = t.rounds.map(r => r.apnea);
  const re = t.rounds.map(r => r.rest);
  const same = a => a.every(v => v === a[0]);
  const fixedAp = same(ap) && t.rounds.length > 1;
  const fixedRe = same(re) && t.rounds.length > 1;
  let pill = '';
  if (fixedAp && !fixedRe) pill = `<span class="pill apnea">Apnea fija <b>${fmt(ap[0])}</b></span>`;
  else if (fixedRe && !fixedAp) pill = `<span class="pill">Descanso fijo <b>${fmt(re[0])}</b></span>`;

  const cells = t.rounds.map((r, i) => {
    let main;
    let sub;
    if (fixedAp && !fixedRe) { main = fmt(r.rest); sub = ''; }
    else if (fixedRe && !fixedAp) { main = fmt(r.apnea); sub = ''; }
    else { main = fmt(r.apnea); sub = `desc. ${fmt(r.rest)}`; }
    const mainCls = fixedAp && !fixedRe ? '' : 'apnea';
    return `<button class="cell" data-act="edit-round" data-type="${type}" data-week="${week ?? ''}" data-i="${i}">
      <span class="cell-r">R${i + 1}</span><span class="cell-v ${mainCls}">${main}</span>${sub ? `<span class="cell-s">${sub}</span>` : ''}</button>`;
  }).join('');

  const cellsLabel = fixedAp && !fixedRe ? 'Descanso por ronda' : fixedRe && !fixedAp ? 'Apnea por ronda' : 'Apnea y descanso por ronda';
  const tag = week === 4 ? `Descarga · ${t.rounds.length} rondas` : `${t.rounds.length} rondas`;
  const note = t.edited ? '<p class="hint warn-text">Editada a mano · no se reescala con el MAX.</p>' : '';
  const canRestore = t.edited || (type === 'CUSTOM' && Store.overrides.CUSTOM);

  return `<section class="card table-card t-${type}">
    <div class="card-head"><h3>${type === 'CUSTOM' ? 'Personalizada' : `Semana ${week}`}</h3><span class="tag">${tag}</span></div>
    ${pill}
    <div class="cells-label">${cellsLabel}</div>
    <div class="cells">${cells}</div>
    ${note}
    <div class="row">
      <button class="btn primary" data-act="open-plan" data-type="${type}" data-week="${week ?? ''}">Entrenar</button>
      <button class="btn" data-act="add-round" data-type="${type}" data-week="${week ?? ''}">+ Ronda</button>
      ${canRestore ? `<button class="btn ghost" data-act="restore-table" data-type="${type}" data-week="${week ?? ''}">${type === 'CUSTOM' ? 'Restablecer' : 'Restaurar PDF'}</button>` : ''}
    </div>
  </section>`;
}

function viewHistorial() {
  const list = Store.doneSessions().slice().reverse();
  const add = `<div class="row hist-add">
    <button class="btn" data-act="add-session">+ Añadir sesión</button>
    <button class="btn" data-act="open-import">Importar datos</button>
  </div>`;
  if (!list.length) {
    return `${add}<section class="card empty"><h3>Sin sesiones todavía</h3><p class="muted">Cuando termines una serie aparecerá aquí con todos los tiempos. Si ya entrenabas por tu cuenta, añade o importa tus sesiones anteriores.</p></section>`;
  }
  return `${add}<div class="hist">${list.map(s => {
    const st = sessionStats(s);
    const rounds = s.rondasPlan ? `${st.completed}/${s.rondasPlan} rondas` : `${s.rondas.length} apnea${s.rondas.length > 1 ? 's' : ''}`;
    return `<button class="hist-item t-${s.tipo}" data-act="open-session" data-id="${s.id}">
      <div class="hist-top"><span class="badge">${sessionTitle(s)}</span><span class="muted small">${fmtDateTime(s.fecha, s.sinHora)}</span></div>
      <div class="hist-stats"><span>${rounds}</span><span>Mejor <b>${fmt(st.longest)}</b></span><span>Total <b>${fmt(st.total)}</b></span></div>
      ${s.nota ? `<div class="hist-note">${esc(s.nota)}</div>` : ''}
    </button>`;
  }).join('')}</div>`;
}

function viewProgreso() {
  const all = Store.doneSessions();
  const best = all.reduce((m, s) => Math.max(m, sessionStats(s).longest), 0);
  const metricOpts = [
    ['longest', 'Apnea más larga por sesión'],
    ['total', 'Tiempo total en apnea'],
    ['pct', '% de rondas completadas'],
    ['max', 'Evolución del MAX (tests)'],
  ];
  const filterOpts = [['all', 'Todas'], ['CO2', 'CO₂'], ['O2', 'O₂'], ['TEST', 'Test MAX'], ['CUSTOM', 'Personalizada'], ['LIBRE', 'Apnea libre']];
  return `<div class="tiles">
      <div class="tile"><div class="tile-l">MAX actual</div><div class="tile-v">${fmt(Store.settings.max)}</div></div>
      <div class="tile"><div class="tile-l">Sesiones</div><div class="tile-v">${all.length}</div></div>
      <div class="tile"><div class="tile-l">Mejor apnea</div><div class="tile-v">${fmt(best)}</div></div>
    </div>
    <section class="card">
      <div class="seg small">
        <button class="${ui.chartType === 'line' ? 'on' : ''}" data-act="chart-type" data-v="line">Línea</button>
        <button class="${ui.chartType === 'bar' ? 'on' : ''}" data-act="chart-type" data-v="bar">Barras</button>
      </div>
      <div class="selects">
        <label class="field"><span>Métrica</span><select id="metric">${metricOpts.map(([v, l]) => `<option value="${v}" ${ui.metric === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Tipo</span><select id="filter" ${ui.metric === 'max' ? 'disabled' : ''}>${filterOpts.map(([v, l]) => `<option value="${v}" ${ui.filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div id="chart" class="chart"></div>
      <div id="readout" class="readout"></div>
    </section>`;
}

function drawProgress() {
  let ss = Store.doneSessions();
  if (ui.metric === 'max') ss = ss.filter(s => s.tipo === 'TEST');
  else if (ui.filter !== 'all') ss = ss.filter(s => s.tipo === ui.filter);
  const key = ui.metric === 'max' ? 'longest' : ui.metric;
  const values = ss.map(s => sessionStats(s)[key]);
  const labels = ss.map(s => fmtDate(new Date(s.fecha)));
  const names = { longest: 'Apnea más larga', total: 'Total en apnea', pct: 'Completadas', max: 'MAX' };
  const fmtV = v => (ui.metric === 'pct' ? `${Math.round(v)} %` : fmt(v));
  renderChart($('#chart'), {
    type: ui.chartType,
    labels,
    series: [{ name: names[ui.metric], color: 'var(--apnea)', values }],
    yFormat: ui.metric === 'pct' ? 'pct' : 'time',
    goal: ui.metric === 'max' || ui.metric === 'longest' ? 180 : null,
    goalLabel: 'Meta 3:00',
    onSelect: i => {
      const s = ss[i];
      $('#readout').innerHTML = s ? `<b>${fmtV(values[i])}</b> · ${sessionTitle(s)} · ${fmtDateTime(s.fecha, s.sinHora)}` : '';
    },
  });
  if (!ss.length) $('#readout').innerHTML = '';
}

function viewAjustes() {
  const s = Store.settings;
  const sw = (key, label, hint = '') => `<label class="switch-row"><span><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</span>
    <input type="checkbox" class="switch" data-setting="${key}" ${s[key] ? 'checked' : ''}></label>`;
  return `<section class="card">
      <h3>Tu MAX</h3>
      <p class="hint">Las tablas se escalan proporcionalmente a partir de 1:30.</p>
      <div class="max-row">${timeField('MAX', 'max', s.max)}<button class="btn primary" data-act="save-max">Guardar</button></div>
    </section>
    <section class="card">
      <h3>Programa</h3>
      <div class="selects">
        <label class="field"><span>Fecha de inicio</span><input type="date" data-setting="startDate" value="${s.startDate || ''}"></label>
        <label class="field"><span>Empieza en la</span><select data-setting="startWeek">${weekOptions(startWeek())}</select></label>
      </div>
      <div class="row"><button class="btn" data-act="restart-program">Empezar hoy</button>${s.startDate ? '<button class="btn ghost" data-act="clear-program">Quitar programa</button>' : ''}</div>
      <div class="field"><span>Días de descanso (hasta 2)</span>
        <div class="dow-pick">${DOW_PICK.map(d => {
          const on = (s.restDays || []).includes(d);
          return `<button class="${on ? 'on' : ''}" data-act="toggle-rest" data-v="${d}" aria-label="${DAY_NAME[d]}" aria-pressed="${on}">${DOW[d]}</button>`;
        }).join('')}</div></div>
      <p class="hint">Sin elegir ninguno, descansas los 2 últimos días de cada semana del programa, como en el método (5 días de tablas y 2 libres). Si eliges días fijos (p. ej. sábado y domingo, o miércoles y domingo), las sesiones se reparten en orden en los demás días.</p>
    </section>
    <section class="card">
      <h3>Cronómetro</h3>
      <div class="seg">
        <button class="${s.auto ? 'on' : ''}" data-act="set-auto" data-v="1">Automático</button>
        <button class="${!s.auto ? 'on' : ''}" data-act="set-auto" data-v="0">Manual</button>
      </div>
      <p class="hint">${s.auto ? 'Al acabar la apnea empieza solo el descanso, y al acabar el descanso la siguiente apnea. Puedes intervenir en cualquier momento.' : 'Tú decides cuándo pasar de fase; los relojes siguen avisando.'}</p>
      ${sw('autoStopApnea', 'Cortar la apnea al llegar al objetivo', 'Desactívalo para que el reloj siga hasta que pulses «Respirar».')}
      <label class="field inline"><span>Cuenta atrás inicial (s)</span><input type="number" min="0" max="300" step="5" data-setting="prep" value="${s.prep}"></label>
    </section>
    <section class="card">
      <h3>Avisos</h3>
      ${sw('sound', 'Sonido', 'Pitidos en los 3 últimos segundos y al cambiar de fase. Solo suenan si el móvil no está en silencio.')}
      ${'vibrate' in navigator
        ? sw('vibrate', 'Vibración', 'Al empezar y terminar cada apnea y en la cuenta atrás.')
        : '<p class="hint">Vibración: este navegador no permite vibrar desde una web (en iPhone, Safari no lo deja). Para no mirar la pantalla, usa el sonido o la voz, mejor con auriculares.</p>'}
      ${sw('voice', 'Voz', '«Apnea», «Respira», «Diez segundos».')}
      <button class="btn ghost" data-act="test-sound">Probar sonido</button>
    </section>
    <section class="card">
      <h3>Marcas durante la apnea</h3>
      <p class="hint">Un doble pitido corto y seco (pi-pi) cuando el reloj de apnea pasa por estos tiempos. Suena en cualquier sesión, también en Test MAX y Apnea libre. Solo se oye si el móvil no está en silencio.</p>
      ${sw('markMax', 'Al superar tu MAX', `Ahora ${fmt(s.max)}. Se actualiza solo si cambias tu MAX.`)}
      <div class="marks">${(s.marks || []).length
        ? s.marks.map(m => `<span class="mark-chip">${fmt(m)}<button data-act="del-mark" data-v="${m}" aria-label="Quitar marca ${fmt(m)}">✕</button></span>`).join('')
        : '<span class="hint">Sin marcas personalizadas.</span>'}</div>
      <div class="max-row">${timeField('Nueva marca', 'mark', 180)}<button class="btn primary" data-act="add-mark">Añadir</button></div>
      <div class="row"><button class="btn ghost" data-act="test-mark">Probar pitido</button></div>
    </section>
    <section class="card">
      <h3>Datos</h3>
      <p class="hint">Todo se guarda solo en este dispositivo. Haz copias de seguridad de vez en cuando.</p>
      <div class="row">
        <button class="btn" data-act="export-json">Exportar JSON</button>
        <button class="btn" data-act="export-csv">Exportar CSV</button>
        <button class="btn" data-act="open-import">Importar (CSV, JSON o pegar)</button>
      </div>
      <button class="btn danger block" data-act="clear-all">Borrar todos los datos</button>
    </section>
    <section class="card">
      <button class="btn ghost block" data-act="show-safety">Ver normas de seguridad</button>
      <p class="hint center">Basado en el programa de 4 semanas del método Umberto Pelizzari.</p>
    </section>`;
}

const VIEWS = { hoy: viewHoy, tablas: viewTablas, historial: viewHistorial, progreso: viewProgreso, ajustes: viewAjustes };

function render() {
  $('#view').innerHTML = VIEWS[ui.tab]();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  $('#headMax').textContent = `MAX ${fmt(Store.settings.max)}`;
  if (ui.tab === 'progreso') drawProgress();
}

function go(tab) {
  ui.tab = tab;
  render();
  window.scrollTo(0, 0);
}

// ---------- Detalle de sesión ----------

function roundsChart(el, s) {
  const labels = s.rondas.map(r => `R${r.n}`);
  const series = [];
  if (s.rondas.some(r => r.objetivoApnea)) {
    series.push({ name: 'Objetivo', color: 'var(--faint)', values: s.rondas.map(r => r.objetivoApnea) });
  }
  series.push({ name: 'Real', color: 'var(--apnea)', values: s.rondas.map(r => r.apneaReal) });
  renderChart(el, { type: 'bar', labels, series, height: 170 });
}

function roundsTable(rondas) {
  return `<table class="log"><thead><tr><th>#</th><th>Objetivo</th><th>Real</th><th>Descanso</th><th></th></tr></thead><tbody>
    ${rondas.map(r => `<tr><td>${r.n}</td><td>${r.objetivoApnea ? fmt(r.objetivoApnea) : 'libre'}</td><td><b>${fmt(r.apneaReal)}</b></td>
    <td>${r.descansoReal != null ? fmt(r.descansoReal) : (r.descansoPlan ? `<span class="muted">${fmt(r.descansoPlan)}</span>` : '–')}</td>
    <td class="${r.completada ? 'ok' : 'ko'}">${r.completada ? '✓' : '✗'}</td></tr>`).join('')}
  </tbody></table>`;
}

function useAsMax(sec) {
  Store.settings.max = Math.max(10, Math.round(sec));
  Store.saveSettings();
  toast(`Nuevo MAX: ${fmt(Store.settings.max)} · tablas reescaladas`);
  render();
}

function openSession(id) {
  const s = Store.sessions.find(x => x.id === id);
  if (!s) return;
  const st = sessionStats(s);
  const isTest = s.tipo === 'TEST';
  openModal(`<div class="modal-head"><h3>${sessionTitle(s)}</h3><button class="icon-btn" data-m="close" aria-label="Cerrar">✕</button></div>
    <p class="muted small">${fmtDateTime(s.fecha, s.sinHora)} · MAX usado ${fmt(s.maxUsado)}${s.manual ? ' · añadida a mano' : s.importada ? ' · importada' : ''}</p>
    <div class="tiles small">
      <div class="tile"><div class="tile-l">Mejor</div><div class="tile-v">${fmt(st.longest)}</div></div>
      <div class="tile"><div class="tile-l">Total</div><div class="tile-v">${fmt(st.total)}</div></div>
      <div class="tile"><div class="tile-l">Completadas</div><div class="tile-v">${s.rondasPlan ? `${st.completed}/${s.rondasPlan}` : s.rondas.length}</div></div>
    </div>
    <div class="chart" id="sessChart"></div>
    ${roundsTable(s.rondas)}
    <label class="field"><span>Nota</span><textarea id="sessNote" rows="2" placeholder="Sensaciones, contracciones, etc.">${esc(s.nota)}</textarea></label>
    <div class="modal-actions">
      <button class="btn danger" data-m="delete">Borrar</button>
      ${isTest ? `<button class="btn" data-m="max">Usar ${fmt(st.longest)} como MAX</button>` : ''}
      <button class="btn primary" data-m="close">Cerrar</button>
    </div>`, (body, close) => {
    roundsChart($('#sessChart', body), s);
    $('#sessNote', body).addEventListener('change', e => {
      s.nota = e.target.value;
      Store.upsertSession(s);
      render();
    });
    body.addEventListener('click', e => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (m === 'close') close();
      if (m === 'max') { useAsMax(st.longest); close(); }
      if (m === 'delete' && confirm('¿Borrar esta sesión? No se puede deshacer.')) {
        Store.deleteSession(s.id);
        close();
        render();
      }
    });
  });
}

// ---------- Edición de tablas ----------

// ---------- Sesiones añadidas a mano e importación ----------

const noonISO = iso => { const d = parseISODate(iso); d.setHours(12); return d.toISOString(); };

// Añadir una sesión hecha fuera de la app. En CO₂/O₂ las rondas salen de la tabla
// calculada con el MAX que indiques; solo cambias lo que no hiciste igual.
function addSession(type) {
  const st = { tipo: type, semana: 1, max: Store.settings.max };
  openModal(`<div class="modal-head"><h3>Añadir sesión</h3><button class="icon-btn" data-m="close" aria-label="Cerrar">✕</button></div>
    <div class="seg" id="asType">${['CO2', 'O2', 'TEST', 'LIBRE'].map(t => `<button data-t="${t}">${TYPE_NAME[t]}</button>`).join('')}</div>
    <label class="field"><span>Fecha</span><input type="date" id="asDate" value="${isoDate(new Date())}" max="${isoDate(new Date())}"></label>
    <div id="asBody"></div>
    <label class="field"><span>Nota</span><textarea id="asNote" rows="2" placeholder="Opcional"></textarea></label>
    <div class="modal-actions"><button class="btn" data-m="close">Cancelar</button><button class="btn primary" data-m="save">Guardar</button></div>`, (body, close) => {
    const draw = () => {
      body.querySelectorAll('#asType button').forEach(b => b.classList.toggle('on', b.dataset.t === st.tipo));
      let h;
      if (st.tipo === 'CO2' || st.tipo === 'O2') {
        const t = getTable(st.tipo, st.semana, st.max, Store.overrides);
        h = `<div class="selects">
            <label class="field"><span>Semana</span><select id="asWeek">${weekOptions(st.semana)}</select></label>
            <label class="field"><span>MAX de la tabla</span><input id="asMax" inputmode="decimal" value="${fmt(st.max)}"></label>
          </div>
          <p class="hint">${t.edited ? 'Esta tabla está editada a mano, así que no cambia con el MAX. ' : ''}Los tiempos vienen de la tabla. Cambia los que no hiciste igual y borra los de las rondas que no llegaste a hacer.</p>
          <div class="as-rounds">${t.rounds.map((r, i) => `<label class="as-round"><span>R${i + 1}</span><span class="muted small">objetivo ${fmt(r.apnea)}</span>
            <input inputmode="decimal" data-i="${i}" value="${fmt(r.apnea)}" aria-label="Apnea real ronda ${i + 1}"></label>`).join('')}</div>`;
      } else if (st.tipo === 'TEST') {
        h = `<label class="field"><span>Tiempo del test (m:ss)</span><input id="asTest" inputmode="decimal" placeholder="1:45"></label>
          <label class="switch-row"><span><span>Usarlo como mi MAX</span><small>Ahora ${fmt(Store.settings.max)}. Las tablas se recalculan con él.</small></span>
          <input type="checkbox" class="switch" id="asUseMax" checked></label>`;
      } else {
        h = `<label class="field"><span>Apneas, separadas por espacios (m:ss)</span><input id="asFree" inputmode="decimal" placeholder="1:10 1:20 1:30"></label>`;
      }
      $('#asBody', body).innerHTML = h;
    };
    draw();
    body.addEventListener('change', e => {
      if (e.target.id === 'asWeek') { st.semana = Number(e.target.value); draw(); }
      if (e.target.id === 'asMax') {
        const v = parseTime(e.target.value);
        if (v >= 10) st.max = Math.round(v);
        draw();
      }
    });
    body.addEventListener('click', e => {
      const tb = e.target.closest('#asType button');
      if (tb) { st.tipo = tb.dataset.t; draw(); return; }
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (m === 'close') return close();
      if (m !== 'save') return;
      const date = $('#asDate', body).value;
      if (!date) return toast('Pon la fecha');
      const s = {
        id: newId(), fecha: noonISO(date), tipo: st.tipo, semana: null, etiqueta: TYPE_NAME[st.tipo],
        maxUsado: st.max, rondasPlan: null, rondas: [], nota: $('#asNote', body).value, terminada: true, manual: true, sinHora: true,
      };
      if (st.tipo === 'CO2' || st.tipo === 'O2') {
        const t = getTable(st.tipo, st.semana, st.max, Store.overrides);
        s.semana = st.semana;
        s.etiqueta = t.label;
        s.rondasPlan = t.rounds.length;
        for (const inp of body.querySelectorAll('.as-rounds input')) {
          const i = Number(inp.dataset.i);
          const v = parseTime(inp.value);
          if (v == null) continue;
          if (Number.isNaN(v)) return toast(`Tiempo no válido en R${i + 1}`);
          const r = t.rounds[i];
          s.rondas.push({ n: i + 1, objetivoApnea: r.apnea, apneaReal: v, descansoPlan: i < t.rounds.length - 1 ? r.rest : null, descansoReal: null, completada: v >= r.apnea - 0.5 });
        }
      } else if (st.tipo === 'TEST') {
        const v = parseTime($('#asTest', body).value);
        if (!(v > 0)) return toast('Escribe el tiempo del test, por ejemplo 1:45');
        s.rondas.push({ n: 1, objetivoApnea: null, apneaReal: v, descansoPlan: null, descansoReal: null, completada: true });
      } else {
        const vals = $('#asFree', body).value.trim().split(/\s+/).filter(Boolean).map(parseTime);
        if (!vals.length || vals.some(v => !(v > 0))) return toast('Escribe los tiempos separados por espacios, por ejemplo 1:10 1:20');
        vals.forEach((v, i) => s.rondas.push({ n: i + 1, objetivoApnea: null, apneaReal: v, descansoPlan: null, descansoReal: null, completada: true }));
      }
      if (!s.rondas.length) return toast('No hay ninguna ronda con tiempo');
      Store.upsertSession(s);
      close();
      if (st.tipo === 'TEST' && $('#asUseMax', body)?.checked) useAsMax(s.rondas[0].apneaReal);
      else { toast('Sesión añadida'); render(); }
    });
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Semana por la que seguir tras importar: la última importada, o la siguiente si ya está completa.
function suggestedWeek(sessions) {
  const tab = sessions.filter(s => (s.tipo === 'CO2' || s.tipo === 'O2') && s.semana);
  if (!tab.length) return null;
  const w = Math.max(...tab.map(s => s.semana));
  const done = new Set(tab.filter(s => s.semana === w).map(s => s.fecha.slice(0, 10))).size;
  return done >= WEEK_SESSIONS.length ? w + 1 : w;
}

function openImport() {
  openModal(`<div class="modal-head"><h3>Importar entrenamientos</h3><button class="icon-btn" data-m="close" aria-label="Cerrar">✕</button></div>
    <p class="hint">¿Tienes tus tiempos en una conversación con una IA (ChatGPT, Claude…)?</p>
    <ol class="steps">
      <li>Copia las instrucciones y pégalas en esa conversación.</li>
      <li>Copia la tabla (CSV) que te devuelva.</li>
      <li>Pégala aquí abajo y pulsa <b>Revisar</b>.</li>
    </ol>
    <div class="row"><button class="btn" data-m="prompt">Copiar instrucciones para la IA</button><button class="btn ghost" data-m="template">Plantilla CSV</button></div>
    <details class="prompt"><summary>Ver las instrucciones</summary><pre>${esc(AI_PROMPT)}</pre></details>
    <label class="field"><span>CSV o copia JSON de la app</span><textarea id="impText" rows="6" placeholder="fecha;tipo;semana;ronda;objetivo;apnea;descanso"></textarea></label>
    <input type="file" id="impFile" accept=".csv,.json,.txt,text/csv,application/json,text/plain" hidden>
    <div class="row"><button class="btn" data-m="file">Elegir archivo…</button><button class="btn primary" data-m="parse">Revisar</button></div>
    <div id="impPreview"></div>`, (body, close) => {
    let res = null;
    const preview = () => {
      res = parseImport($('#impText', body).value);
      const box = $('#impPreview', body);
      const errs = res.errors.length
        ? `<div class="imp-errors"><b>${res.errors.length} aviso${res.errors.length > 1 ? 's' : ''}</b><ul>${res.errors.slice(0, 8).map(x => `<li>${esc(x)}</li>`).join('')}${res.errors.length > 8 ? `<li>… y ${res.errors.length - 8} más</li>` : ''}</ul></div>`
        : '';
      if (!res.sessions.length) {
        box.innerHTML = errs || '<p class="hint">No hay nada que importar.</p>';
        return;
      }
      const ss = res.sessions.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
      const existing = ss.filter(s => Store.sessions.some(x => x.id === s.id)).length;
      const tests = ss.filter(s => s.tipo === 'TEST');
      const lastTest = tests[tests.length - 1];
      const bestOf = s => Math.max(...s.rondas.map(r => r.apneaReal || 0));
      const sw = suggestedWeek(ss);
      const programSel = sw && sw <= 4
        ? `<label class="field"><span>Programa</span><select id="impWeek">
            <option value="">No cambiar el programa</option>
            ${[1, 2, 3, 4].map(w => `<option value="${w}" ${w === sw && !Store.settings.startDate ? 'selected' : ''}>Seguir hoy desde la semana ${w}${w === sw ? ' (sugerido)' : ''}</option>`).join('')}
          </select></label>`
        : '';
      box.innerHTML = `<div class="imp-sum">
        <p><b>${ss.length} sesion${ss.length > 1 ? 'es' : ''}</b>${existing ? ` · ${existing} ya existía${existing > 1 ? 'n' : ''} y se reemplazará${existing > 1 ? 'n' : ''}` : ''}</p>
        <ul class="imp-list">${ss.slice(0, 12).map(s => `<li><span>${fmtDate(new Date(s.fecha))}</span><span>${sessionTitle(s)}</span><span class="muted">${s.rondas.length} r · mejor ${fmt(bestOf(s))}</span></li>`).join('')}
        ${ss.length > 12 ? `<li class="muted">… y ${ss.length - 12} más</li>` : ''}</ul>
        ${res.backup ? '<p class="hint">Es una copia completa de la app: también se restaurarán tus ajustes y tablas editadas.</p>' : ''}
        ${lastTest && !res.backup ? `<label class="switch-row"><span><span>Usar el último test (${fmt(bestOf(lastTest))}, ${fmtDate(new Date(lastTest.fecha))}) como mi MAX</span><small>Ahora ${fmt(Store.settings.max)}.</small></span><input type="checkbox" class="switch" id="impMax" checked></label>` : ''}
        ${res.backup ? '' : programSel}
        ${errs}
        <button class="btn primary block" data-m="import">Importar ${ss.length} sesion${ss.length > 1 ? 'es' : ''}</button>
      </div>`;
    };
    $('#impFile', body).addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then(txt => {
        $('#impText', body).value = txt;
        preview();
      });
    });
    body.addEventListener('click', async e => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (m === 'close') close();
      if (m === 'prompt') {
        if (await copyText(AI_PROMPT)) toast('Instrucciones copiadas: pégalas en la conversación con la IA');
        else { $('details.prompt', body).open = true; toast('No se pudo copiar: cópialas a mano'); }
      }
      if (m === 'template') downloadFile('plantilla-apnea.csv', CSV_TEMPLATE, 'text/csv;charset=utf-8');
      if (m === 'file') $('#impFile', body).click();
      if (m === 'parse') preview();
      if (m === 'import' && res) {
        const useMax = $('#impMax', body)?.checked;
        const week = Number($('#impWeek', body)?.value) || 0;
        const added = res.backup ? Store.importJSON(res.backup) : Store.mergeSessions(res.sessions);
        if (useMax) {
          const tests = res.sessions.filter(s => s.tipo === 'TEST').sort((a, b) => a.fecha.localeCompare(b.fecha));
          const t = tests[tests.length - 1];
          Store.settings.max = Math.max(10, Math.round(Math.max(...t.rondas.map(r => r.apneaReal || 0))));
        }
        if (week) {
          Store.settings.startDate = isoDate(new Date());
          Store.settings.startWeek = week;
        }
        Store.saveSettings();
        close();
        toast(`Importado: ${added} nueva${added === 1 ? '' : 's'}${useMax ? ` · MAX ${fmt(Store.settings.max)}` : ''}${week ? ` · sigues en la semana ${week}` : ''}`);
        render();
      }
    });
  });
}

function editRound(type, week, i) {
  const t = getTable(type, week, Store.settings.max, Store.overrides);
  const r = t.rounds[i];
  openModal(`<div class="modal-head"><h3>${t.label} · R${i + 1}</h3><button class="icon-btn" data-m="cancel" aria-label="Cerrar">✕</button></div>
    ${timeField('Apnea', 'ap', r.apnea)}
    ${timeField('Descanso después', 're', r.rest)}
    ${type !== 'CUSTOM' && !t.edited ? '<p class="hint">Al editar, esta tabla deja de reescalarse con el MAX (puedes restaurarla luego).</p>' : ''}
    <div class="modal-actions">
      <button class="btn danger" data-m="del" ${t.rounds.length <= 1 ? 'disabled' : ''}>Eliminar ronda</button>
      <button class="btn primary" data-m="save">Guardar</button>
    </div>`, (body, close) => {
    body.addEventListener('click', e => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (!m) return;
      if (m === 'cancel') return close();
      const rounds = t.rounds.map(x => ({ ...x }));
      if (m === 'del') rounds.splice(i, 1);
      if (m === 'save') rounds[i] = { apnea: readTime(body, 'ap', 5), rest: readTime(body, 're', 0) };
      Store.setOverride(t.key, rounds);
      close();
      render();
    });
  });
}

// ---------- Cronómetro ----------

function apneaMarks(max) {
  const s = Store.settings;
  const marks = (s.marks || []).map(sec => ({ sec, label: `Marca ${fmt(sec)}` }));
  if (s.markMax) {
    const same = marks.find(m => m.sec === max);
    if (same) same.label = `MAX superado · ${fmt(max)}`;
    else marks.push({ sec: max, label: `MAX superado · ${fmt(max)}` });
  }
  return marks.sort((a, b) => a.sec - b.sec);
}

function openTrainer(plan) {
  if (ui.trainer && ui.trainer.running) return;
  const s = Store.settings;
  const t = new Trainer(plan, { auto: s.auto, autoStopApnea: s.autoStopApnea, marks: apneaMarks(plan.max) }, {
    onTick: updateRun,
    onPhase: () => { ui.phaseChangedAt = performance.now(); updateRun(); },
    onRecord: renderLog,
    onFinish: renderDone,
    onMark: m => toast(m.label),
    cue: k => Feedback.cue(k, plan.prepLabel),
  });
  ui.trainer = t;
  const el = $('#trainer');
  el.hidden = false;
  el.className = 'trainer ph-idle';
  document.body.classList.add('training');
  renderIdle();
}

function closeTrainer() {
  const t = ui.trainer;
  if (t && t.running) t.stop();
  ui.trainer = null;
  Feedback.keepAwake(false);
  $('#trainer').hidden = true;
  $('#trainer').innerHTML = '';
  document.body.classList.remove('training');
  render();
}

function trainerHead(t) {
  return `<header class="tr-head">
    <button class="icon-btn" data-act="tr-close" aria-label="Cerrar">✕</button>
    <div class="tr-titles"><div class="tr-title">${t.plan.label}</div><div class="tr-round" id="trRound"></div></div>
    <button class="chip" data-act="tr-mode" id="trMode">${t.opts.auto ? 'Auto' : 'Manual'}</button>
  </header>`;
}

function renderIdle() {
  const t = ui.trainer;
  const p = t.plan;
  let body;
  if (p.type === 'TEST') {
    body = `<p class="lead">Túmbate. Respira tranquilo <b>2:00</b> (la cuenta atrás te guía), inspira profundo al <b>90 %</b> y aguanta todo lo que puedas. Pulsa <b>Respirar</b> al terminar.</p>`;
  } else if (p.type === 'LIBRE') {
    body = '<p class="lead">Apnea sin objetivo. Pulsa <b>Respirar</b> al terminar cada apnea; después vendrá un descanso de <b>2:00</b> (ajustable). Termina cuando quieras.</p>';
  } else {
    body = `<p class="lead">${summarize(p.rounds)}</p>
      <ol class="plan-list">${p.rounds.map((r, i) => `<li><span>R${i + 1}</span><span class="apnea">Apnea ${fmt(r.apnea)}</span><span class="rest">${i < p.rounds.length - 1 ? `Descanso ${fmt(r.rest)}` : 'Fin'}</span></li>`).join('')}</ol>`;
  }
  $('#trainer').innerHTML = `${trainerHead(t)}
    <div class="tr-idle">
      ${body}
      <div class="seg">
        <button class="${t.opts.auto ? 'on' : ''}" data-act="tr-set-auto" data-v="1">Automático</button>
        <button class="${!t.opts.auto ? 'on' : ''}" data-act="tr-set-auto" data-v="0">Manual</button>
      </div>
      <p class="hint center">En seco · nunca en agua solo · sin hiperventilar</p>
      <button class="btn primary xl block" data-act="tr-start">Empezar</button>
    </div>`;
  $('#trRound').textContent = p.endless ? 'Series libres' : `${p.rounds.length} ronda${p.rounds.length > 1 ? 's' : ''}`;
}

function renderRunShell() {
  const t = ui.trainer;
  $('#trainer').innerHTML = `${trainerHead(t)}
    <div class="tr-run">
      <div class="tr-phase" id="trPhase"></div>
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 200 200" aria-hidden="true">
          <circle class="ring-bg" cx="100" cy="100" r="90"/>
          <circle class="ring-fg" id="ringFg" cx="100" cy="100" r="90" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
        </svg>
        <div class="ring-center"><div class="tr-time" id="trTime">0:00</div><div class="tr-sub" id="trSub"></div></div>
      </div>
      <div class="tr-next" id="trNext"></div>
      <div class="tr-controls">
        <button class="btn primary xl block" data-act="tr-primary" id="trPrimary"></button>
        <div class="tr-grid">
          <button class="btn" data-act="tr-adjust" data-v="-15" id="trMinus">−15 s</button>
          <button class="btn" data-act="tr-pause" id="trPause">Pausa</button>
          <button class="btn" data-act="tr-adjust" data-v="15" id="trPlus">+15 s</button>
          <button class="btn" data-act="tr-repeat" id="trRepeat">Repetir ronda</button>
          <button class="btn danger span2" data-act="tr-stop">Terminar sesión</button>
        </div>
      </div>
      <div class="tr-log"><h4>Registro</h4><div id="trLog"><p class="hint">Las rondas aparecerán aquí a medida que las completes.</p></div></div>
    </div>`;
}

function updateRun() {
  const t = ui.trainer;
  if (!t || !t.running || !$('#trTime')) return;
  const el = t.elapsed() / 1000;
  const max = t.plan.max;
  let phaseLabel;
  let time;
  let sub = '';
  let progress = 0;
  let primary;

  if (t.phase === 'prep') {
    const rem = Math.max(0, t.remaining() / 1000);
    phaseLabel = t.waiting ? '¡Listo!' : (t.plan.prepLabel || 'Prepárate');
    time = fmt(Math.ceil(rem - 1e-6));
    progress = 1 - rem / (t.duration / 1000);
    sub = t.round.apnea ? `1.ª apnea ${fmt(t.round.apnea)}` : 'luego apnea libre';
    primary = 'Empezar apnea';
  } else if (t.phase === 'apnea') {
    const tgt = t.round.apnea;
    time = fmt(Math.floor(el));
    phaseLabel = 'Apnea';
    if (tgt) {
      progress = el / tgt;
      sub = `objetivo ${fmt(tgt)}`;
      if (el >= tgt) phaseLabel = '¡Objetivo!';
    } else {
      progress = el / max;
      sub = `MAX ${fmt(max)}`;
    }
    primary = 'Respirar';
  } else {
    const rem = Math.max(0, t.remaining() / 1000);
    phaseLabel = t.waiting ? '¡Listo!' : 'Respira';
    time = fmt(Math.ceil(rem - 1e-6));
    progress = 1 - rem / (t.duration / 1000);
    const next = t.nextApnea();
    sub = next ? `siguiente ${fmt(next)}` : 'siguiente libre';
    primary = 'Empezar apnea';
  }
  if (t.paused) phaseLabel = 'En pausa';

  const root = $('#trainer');
  root.className = `trainer ph-${t.phase}${t.paused ? ' paused' : ''}${t.phase === 'apnea' && progress >= 1 && t.round.apnea ? ' over' : ''}`;
  $('#trPhase').textContent = phaseLabel;
  $('#trTime').textContent = time;
  $('#trSub').textContent = sub;
  $('#ringFg').style.strokeDashoffset = String(RING_C * (1 - Math.min(1, Math.max(0, progress))));
  $('#trRound').textContent = t.plan.endless ? `Apnea ${t.idx + 1}` : `Ronda ${t.idx + 1} de ${t.plan.rounds.length}`;
  $('#trPrimary').textContent = primary;
  $('#trPause').textContent = t.paused ? 'Reanudar' : 'Pausa';
  const countdown = t.phase === 'prep' || t.phase === 'rest';
  $('#trMinus').disabled = !countdown;
  $('#trPlus').disabled = !countdown;
  $('#trRepeat').disabled = t.phase === 'prep';
  $('#trRepeat').textContent = t.phase === 'rest' && t.repeatNext ? 'Repetirá ronda ✓' : 'Repetir ronda';
  $('#trMode').textContent = t.opts.auto ? 'Auto' : 'Manual';

  let next = '';
  if (t.phase === 'rest' && !t.plan.endless) {
    const remaining = t.plan.rounds.length - t.idx - (t.repeatNext ? 0 : 1);
    next = `Quedan ${remaining} ronda${remaining === 1 ? '' : 's'}`;
  } else if (t.phase === 'apnea' && t.round.rest && (t.plan.endless || t.idx < t.plan.rounds.length - 1)) {
    next = `Después: descanso ${fmt(t.round.rest)}`;
  } else if (t.phase === 'apnea') {
    next = 'Última apnea';
  }
  $('#trNext').textContent = next;
}

function renderLog() {
  const t = ui.trainer;
  const box = $('#trLog');
  if (!t || !box || !t.records.length) return;
  box.innerHTML = roundsTable(t.records.slice().reverse());
}

function renderDone() {
  const t = ui.trainer;
  Feedback.keepAwake(false);
  const s = t.session;
  const el = $('#trainer');
  el.className = 'trainer ph-done';
  if (!s.rondas.length) {
    el.innerHTML = `${trainerHead(t)}<div class="tr-done"><h2>Sesión terminada</h2><p class="muted">No se registró ninguna ronda, así que no se ha guardado nada.</p>
      <button class="btn primary block" data-act="tr-close">Cerrar</button></div>`;
    return;
  }
  const st = sessionStats(s);
  const isTest = s.tipo === 'TEST';
  el.innerHTML = `${trainerHead(t)}
    <div class="tr-done">
      <div class="eyebrow">Sesión guardada</div>
      <h2>${isTest ? `Tu apnea: ${fmt(st.longest)}` : '¡Buen trabajo!'}</h2>
      <div class="tiles small">
        <div class="tile"><div class="tile-l">Mejor</div><div class="tile-v">${fmt(st.longest)}</div></div>
        <div class="tile"><div class="tile-l">Total</div><div class="tile-v">${fmt(st.total)}</div></div>
        <div class="tile"><div class="tile-l">Completadas</div><div class="tile-v">${s.rondasPlan ? `${st.completed}/${s.rondasPlan}` : s.rondas.length}</div></div>
      </div>
      ${isTest ? `<button class="btn primary block" data-act="tr-use-max">Usar ${fmt(st.longest)} como nuevo MAX</button>` : ''}
      <div class="chart" id="doneChart"></div>
      ${roundsTable(s.rondas)}
      <label class="field"><span>Nota (opcional)</span><textarea id="doneNote" rows="2" placeholder="Sensaciones, contracciones, etc."></textarea></label>
      <div class="row">
        <button class="btn" data-act="tr-history">Ver historial</button>
        <button class="btn primary" data-act="tr-close">Cerrar</button>
      </div>
    </div>`;
  $('#trRound').textContent = fmtDateTime(s.fecha);
  $('#trMode').hidden = true;
  roundsChart($('#doneChart'), s);
  $('#doneNote').addEventListener('change', e => {
    s.nota = e.target.value;
    Store.upsertSession(s);
  });
}

// ---------- Acciones ----------

const ACTIONS = {
  'start-program'() {
    const v = $('#startDate')?.value || isoDate(new Date());
    Store.settings.startDate = v;
    Store.settings.startWeek = Number($('#startWeekSel')?.value) || 1;
    Store.saveSettings();
    render();
  },
  'restart-program'(b) {
    Store.settings.startDate = isoDate(new Date());
    if (b.dataset.week) Store.settings.startWeek = Number(b.dataset.week);
    Store.saveSettings();
    toast('Programa iniciado hoy');
    render();
  },
  'clear-program'() {
    if (!confirm('¿Quitar la fecha del programa? El historial se conserva.')) return;
    Store.settings.startDate = null;
    Store.saveSettings();
    render();
  },
  'toggle-rest'(b) {
    const d = Number(b.dataset.v);
    const r = Store.settings.restDays || [];
    if (r.includes(d)) Store.settings.restDays = r.filter(x => x !== d);
    else if (r.length >= 2) return toast('Máximo 2 días de descanso: quita uno antes');
    else Store.settings.restDays = [...r, d];
    Store.saveSettings();
    render();
  },
  'open-plan'(b) {
    const week = b.dataset.week ? Number(b.dataset.week) : null;
    openTrainer(buildPlan(b.dataset.type, week));
  },
  'tables-seg'(b) { ui.tablesSeg = b.dataset.v; render(); },
  'edit-round'(b) { editRound(b.dataset.type, b.dataset.week ? Number(b.dataset.week) : null, Number(b.dataset.i)); },
  'add-round'(b) {
    const type = b.dataset.type;
    const week = b.dataset.week ? Number(b.dataset.week) : null;
    const t = getTable(type, week, Store.settings.max, Store.overrides);
    t.rounds.push({ ...t.rounds[t.rounds.length - 1] });
    Store.setOverride(t.key, t.rounds);
    render();
  },
  'restore-table'(b) {
    const type = b.dataset.type;
    const week = b.dataset.week ? Number(b.dataset.week) : null;
    if (!confirm(type === 'CUSTOM' ? '¿Restablecer la tabla personalizada?' : '¿Restaurar los valores del PDF para esta tabla?')) return;
    Store.setOverride(tableKey(type, week), null);
    render();
  },
  'open-session'(b) { openSession(b.dataset.id); },
  'chart-type'(b) { ui.chartType = b.dataset.v; render(); },
  'save-max'() {
    const v = readTime(document, 'max', 10);
    Store.settings.max = v;
    Store.saveSettings();
    toast(`MAX guardado: ${fmt(v)}`);
    render();
  },
  'set-auto'(b) {
    Store.settings.auto = b.dataset.v === '1';
    Store.saveSettings();
    render();
  },
  'test-sound'() {
    Feedback.unlock();
    Feedback.cue('apnea');
    setTimeout(() => Feedback.cue('rest'), 700);
  },
  'add-mark'() {
    const v = readTime(document, 'mark', 5);
    const marks = Store.settings.marks || [];
    if (marks.includes(v)) return toast(`La marca ${fmt(v)} ya existe`);
    Store.settings.marks = [...marks, v].sort((a, b) => a - b);
    Store.saveSettings();
    toast(`Marca añadida: ${fmt(v)}`);
    render();
  },
  'del-mark'(b) {
    Store.settings.marks = (Store.settings.marks || []).filter(m => m !== Number(b.dataset.v));
    Store.saveSettings();
    render();
  },
  'test-mark'() {
    Feedback.unlock();
    Feedback.cue('mark');
  },
  'export-json'() { downloadFile(`apnea-pelizzari-${isoDate(new Date())}.json`, Store.exportJSON(), 'application/json'); },
  'export-csv'() { downloadFile(`apnea-pelizzari-${isoDate(new Date())}.csv`, Store.exportCSV(), 'text/csv;charset=utf-8'); },
  'open-import'() { openImport(); },
  'add-session'(b) { addSession(b.dataset.type || 'CO2'); },
  'clear-all'() {
    if (!confirm('¿Borrar TODO el historial, tablas editadas y ajustes?')) return;
    if (!confirm('Esta acción no se puede deshacer. ¿Seguro?')) return;
    Store.clearAll();
    toast('Datos borrados');
    render();
  },
  'show-safety'() { showSafety(); },

  // Cronómetro
  'tr-start'() {
    Feedback.unlock();
    Feedback.keepAwake(true);
    renderRunShell();
    ui.trainer.start();
  },
  'tr-set-auto'(b) {
    const auto = b.dataset.v === '1';
    ui.trainer.opts.auto = auto;
    Store.settings.auto = auto;
    Store.saveSettings();
    renderIdle();
  },
  'tr-mode'() {
    const t = ui.trainer;
    const auto = !t.opts.auto;
    Store.settings.auto = auto;
    Store.saveSettings();
    if (t.running) {
      t.setAuto(auto);
      toast(auto ? 'Modo automático' : 'Modo manual');
    } else {
      t.opts.auto = auto;
      renderIdle();
    }
  },
  'tr-primary'() {
    // El botón principal cambia de "Empezar apnea" a "Respirar" en el mismo sitio:
    // se ignora un doble toque accidental justo después de un cambio de fase.
    if (performance.now() - (ui.phaseChangedAt || 0) < 700) return;
    ui.trainer.primary();
  },
  'tr-adjust'(b) { ui.trainer.adjust(Number(b.dataset.v)); },
  'tr-pause'() { const t = ui.trainer; if (t.paused) t.resume(); else t.pause(); },
  'tr-repeat'() { ui.trainer.repeat(); },
  'tr-stop'() {
    if (confirm('¿Terminar la sesión? Se guardará lo que llevas hecho.')) ui.trainer.stop();
  },
  'tr-close'() {
    const t = ui.trainer;
    if (t && t.running && !confirm('¿Terminar la sesión? Se guardará lo que llevas hecho.')) return;
    closeTrainer();
  },
  'tr-use-max'(b) {
    useAsMax(sessionStats(ui.trainer.session).longest);
    b.disabled = true;
    b.textContent = `MAX actualizado a ${fmt(Store.settings.max)}`;
  },
  'tr-history'() { closeTrainer(); go('historial'); },
};

function showSafety() {
  openModal(`<div class="eyebrow warn">Antes de empezar</div>
    <h3>Normas de seguridad</h3>
    <ol class="rules">
      <li><b>Nunca</b> hagas apnea en agua estando solo.</li>
      <li>Entrena siempre <b>en seco</b>: tumbado o sentado, sin agua.</li>
      <li><b>No hiperventiles</b> antes de aguantar la respiración.</li>
    </ol>
    <p class="hint">Si notas mareo, hormigueo o malestar, para y respira con normalidad. Consulta con un profesional si tienes alguna condición médica.</p>
    <div class="modal-actions"><button class="btn primary block" data-m="ok">Entendido</button></div>`, (body, close) => {
    $('[data-m="ok"]', body).addEventListener('click', () => {
      Store.settings.safetyAck = true;
      Store.saveSettings();
      close();
    });
  });
}

function init() {
  $('#tabs').innerHTML = Object.keys(VIEWS).map(k => `<button data-tab="${k}">${ICONS[k]}<span>${k[0].toUpperCase() + k.slice(1)}</span></button>`).join('');
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const fn = ACTIONS[b.dataset.act];
    if (fn) fn(b);
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'metric') { ui.metric = el.value; render(); return; }
    if (el.id === 'filter') { ui.filter = el.value; render(); return; }
    const key = el.dataset && el.dataset.setting;
    if (!key) return;
    if (el.type === 'checkbox') Store.settings[key] = el.checked;
    else if (el.type === 'number' || key === 'startWeek') Store.settings[key] = Math.max(0, parseInt(el.value, 10) || 0);
    else Store.settings[key] = el.value || null;
    Store.saveSettings();
    if (key === 'startDate' || key === 'startWeek') render();
  });

  const dlg = $('#modal');
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  window.addEventListener('beforeunload', e => {
    if (ui.trainer && ui.trainer.running) e.preventDefault();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (ui.tab === 'progreso') drawProgress(); }, 200);
  });

  render();
  if (!Store.settings.safetyAck) showSafety();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
