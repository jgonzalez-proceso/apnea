'use strict';

// Importación de sesiones hechas fuera de la app: CSV (el que exporta la app o la
// plantilla simple) y JSON. Es tolerante con el formato porque los datos suelen venir
// de una hoja de cálculo o de una conversación con una IA.

// Columnas reconocidas → campo interno. Incluye las del CSV que exporta la app.
const CSV_COLUMNS = {
  fecha: 'fecha', date: 'fecha', dia: 'fecha',
  tipo: 'tipo', type: 'tipo', tabla: 'tipo',
  semana: 'semana', week: 'semana',
  sesion_id: 'id', id: 'id',
  ronda: 'ronda', round: 'ronda', serie: 'ronda',
  objetivo: 'objetivo', objetivo_apnea: 'objetivo', objetivo_apnea_s: 'objetivo',
  apnea: 'apnea', apnea_real: 'apnea', apnea_real_s: 'apnea', tiempo: 'apnea',
  descanso: 'descanso', descanso_real: 'descanso', descanso_real_s: 'descanso',
  descanso_plan_s: 'descansoPlan',
  completada: 'completada',
  max: 'max',
};

const AI_PROMPT = `Con los datos de mis entrenamientos de apnea de esta conversación, genera un CSV con estas columnas separadas por punto y coma. Devuelve solo el CSV, en un bloque de código:

fecha;tipo;semana;ronda;objetivo;apnea;descanso

- fecha: AAAA-MM-DD
- tipo: CO2, O2, TEST (test de apnea máxima) o LIBRE
- semana: semana del programa, de 1 a 4 (vacío en TEST y LIBRE)
- ronda: número de ronda empezando en 1 (en TEST, 1)
- objetivo: tiempo de apnea que tocaba en esa ronda, en m:ss (vacío si no había)
- apnea: tiempo que aguanté de verdad, en m:ss
- descanso: descanso después de esa ronda, en m:ss (vacío si no se sabe)

Una fila por ronda. Si un dato no aparece en la conversación, déjalo vacío; no te lo inventes.

Ejemplo:
fecha;tipo;semana;ronda;objetivo;apnea;descanso
2026-09-01;CO2;1;1;0:45;0:45;2:00
2026-09-01;CO2;1;2;0:45;0:45;1:45
2026-09-06;TEST;;1;;1:52;`;

const CSV_TEMPLATE = '\uFEFF' + AI_PROMPT.split('Ejemplo:\n')[1].replace(/\n/g, '\r\n') + '\r\n';

const normKey = s => String(s).trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[₂]/g, '2').replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');

// "1:30", "90", "90 s", "1'30", "1m30s", "1:30.5" → segundos (null si vacío o no válido).
function parseTime(v) {
  const s = String(v ?? '').trim().toLowerCase().replace(',', '.');
  if (!s || s === '-' || s === '–') return null;
  let m = s.match(/^(\d+)\s*(?::|'|m|min)\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|s|seg)?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:s|seg|segundos)?$/);
  if (m) return Number(m[1]);
  return NaN;
}

// "2026-09-24", "24/09/2026", "24-9-26", con hora opcional → ISO. Sin hora, las 12:00 locales.
function parseDate(v) {
  const s = String(v ?? '').trim();
  // Fecha y hora ISO completas (el CSV que exporta la app): tal cual.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  let y, mo, d, rest;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
  if (m) [, y, mo, d, rest] = m;
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(.*)$/))) [, d, mo, y, rest] = m;
  else return null;
  y = Number(y);
  if (y < 100) y += 2000;
  const t = (rest || '').match(/(\d{1,2}):(\d{2})/);
  const date = new Date(y, Number(mo) - 1, Number(d), t ? Number(t[1]) : 12, t ? Number(t[2]) : 0);
  if (Number.isNaN(date.getTime()) || date.getDate() !== Number(d)) return null;
  return date.toISOString();
}

function parseType(v) {
  const s = normKey(v);
  if (!s) return null;
  if (s === 'co2' || s.startsWith('co2_') || s.includes('tabla_co2')) return 'CO2';
  if (s === 'o2' || s.startsWith('o2_') || s.includes('tabla_o2')) return 'O2';
  if (s.includes('test') || s.includes('max')) return 'TEST';
  if (s.includes('libre') || s === 'free') return 'LIBRE';
  if (s.includes('personal') || s.includes('custom')) return 'CUSTOM';
  return null;
}

const parseBool = v => /^(si|sí|s|yes|y|true|1|ok|✓|x)$/i.test(String(v ?? '').trim());

function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === sep && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

// Devuelve { sessions, errors, rows }. Las sesiones sin id reciben uno estable
// (fecha + tipo + semana), así importar dos veces el mismo texto no duplica nada.
function parseCSVSessions(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const errors = [];
  // La cabecera puede venir precedida de texto o de ``` si se copia de una IA.
  const hi = lines.findIndex(l => /fecha|date/i.test(l) && /apnea|tiempo/i.test(l));
  if (hi < 0) return { sessions: [], errors: ['No encuentro la cabecera: la primera fila debe tener al menos «fecha» y «apnea».'], rows: 0 };
  const head = lines[hi];
  const sep = [';', '\t', ','].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  // Coincidencia exacta o por la primera palabra ("Apnea (m:ss)" → apnea).
  const cols = splitLine(head, sep).map(h => CSV_COLUMNS[normKey(h)] || CSV_COLUMNS[normKey(h).split('_')[0]] || null);
  if (!cols.includes('tipo')) errors.push('Falta la columna «tipo»: se tomará cada fila como Apnea libre.');

  const groups = new Map();
  let rows = 0;
  for (let i = hi + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('```')) continue;
    const cells = splitLine(line, sep);
    const r = {};
    cols.forEach((c, j) => { if (c) r[c] = cells[j] ?? ''; });
    const n = i + 1;
    rows++;
    const fecha = parseDate(r.fecha);
    if (!fecha) { errors.push(`Línea ${n}: fecha no válida («${r.fecha ?? ''}»).`); continue; }
    const tipo = cols.includes('tipo') ? parseType(r.tipo) : 'LIBRE';
    if (!tipo) { errors.push(`Línea ${n}: tipo desconocido («${r.tipo}»). Usa CO2, O2, TEST o LIBRE.`); continue; }
    let semana = r.semana ? parseInt(r.semana, 10) : null;
    if (tipo === 'CO2' || tipo === 'O2') {
      if (!(semana >= 1 && semana <= 4)) { errors.push(`Línea ${n}: en ${TYPE_NAME[tipo]} la semana debe ser de 1 a 4.`); continue; }
    } else semana = null;
    const apnea = parseTime(r.apnea);
    if (apnea == null || Number.isNaN(apnea)) { errors.push(`Línea ${n}: tiempo de apnea no válido («${r.apnea ?? ''}»).`); continue; }
    const objetivo = parseTime(r.objetivo);
    const descanso = parseTime(r.descanso);
    const descansoPlan = parseTime(r.descansoPlan);
    const max = parseTime(r.max);

    const key = r.id || `${fecha.slice(0, 10)}|${tipo}|${semana ?? ''}`;
    if (!groups.has(key)) {
      const id = r.id || `imp-${fecha.slice(0, 10)}-${tipo}${semana ? `-${semana}` : ''}`;
      groups.set(key, {
        id, fecha, tipo, semana,
        etiqueta: tipo === 'CO2' || tipo === 'O2' ? tableLabel(tipo, semana) : TYPE_NAME[tipo],
        maxUsado: Number.isFinite(max) ? max : null,
        rondasPlan: null, rondas: [], nota: '', terminada: true, importada: true,
      });
      if (!/\d:\d\d/.test(String(r.fecha).slice(8))) groups.get(key).sinHora = true;
    }
    const s = groups.get(key);
    const obj = Number.isFinite(objetivo) ? objetivo : null;
    s.rondas.push({
      n: parseInt(r.ronda, 10) || s.rondas.length + 1,
      objetivoApnea: obj,
      apneaReal: Math.round(apnea * 10) / 10,
      descansoPlan: Number.isFinite(descansoPlan) ? descansoPlan : null,
      descansoReal: Number.isFinite(descanso) ? descanso : null,
      completada: r.completada ? parseBool(r.completada) : (obj ? apnea >= obj - 0.5 : true),
    });
  }
  const sessions = [...groups.values()];
  for (const s of sessions) {
    s.rondas.sort((a, b) => a.n - b.n);
    // Si faltan rondas, cuenta sobre las de la tabla (una sesión a medias no sale al 100 %).
    if (s.tipo === 'CO2' || s.tipo === 'O2') s.rondasPlan = Math.max(s.rondas.length, getTable(s.tipo, s.semana, Store.settings.max, Store.overrides).rounds.length);
    if (s.tipo === 'CUSTOM') s.rondasPlan = s.rondas.length;
  }
  return { sessions, errors, rows };
}

// Acepta la copia JSON de la app, una lista de sesiones o el CSV. Nunca guarda nada:
// devuelve lo que se importaría para mostrarlo antes.
function parseImport(text) {
  const t = String(text).trim().replace(/^```\w*\s*/, '').replace(/```\s*$/, '').trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    let obj;
    try { obj = JSON.parse(t); } catch { return { sessions: [], errors: ['El JSON no es válido.'], rows: 0 }; }
    if (Array.isArray(obj)) obj = { sessions: obj };
    if (!obj || !Array.isArray(obj.sessions)) return { sessions: [], errors: ['El JSON no parece una copia de esta app.'], rows: 0 };
    const sessions = obj.sessions.filter(s => s && s.id && Array.isArray(s.rondas) && s.fecha);
    return { sessions, errors: [], rows: sessions.length, backup: obj.settings ? obj : null };
  }
  return parseCSVSessions(t);
}
