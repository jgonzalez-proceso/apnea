'use strict';

// Tablas del PDF "Apnea en seco 1:30 → 3:00" (método Umberto Pelizzari).
// Están calculadas para MAX = 1:30 (90 s). Todos los tiempos en segundos.
const BASE_MAX = 90;

const PDF_TABLES = {
  // CO₂: apnea fija, el descanso baja cada ronda (descanso = después de esa ronda).
  CO2: {
    1: { apnea: 45, rests: [120, 105, 90, 75, 60, 45, 30, 15] },
    2: { apnea: 60, rests: [105, 90, 75, 60, 45, 30, 20, 15] },
    3: { apnea: 75, rests: [90, 75, 60, 50, 40, 30, 20, 15] },
    4: { apnea: 75, rests: [75, 60, 45, 30, 20, 15] },
  },
  // O₂: descanso fijo 2:00, la apnea sube cada ronda.
  O2: {
    1: { rest: 120, apneas: [45, 55, 65, 75, 85, 95, 105, 115] },
    2: { rest: 120, apneas: [60, 75, 90, 105, 120, 130, 135, 140] },
    3: { rest: 120, apneas: [90, 105, 120, 135, 150, 160, 165, 170] },
    4: { rest: 120, apneas: [105, 120, 135, 150, 160, 170] },
  },
};

const DEFAULT_CUSTOM = Array.from({ length: 6 }, () => ({ apnea: 60, rest: 90 }));

const TYPE_NAME = { CO2: 'CO₂', O2: 'O₂', TEST: 'Test MAX', CUSTOM: 'Personalizada', LIBRE: 'Apnea libre' };

function pdfRounds(type, week) {
  const t = PDF_TABLES[type][week];
  return type === 'CO2'
    ? t.rests.map(rest => ({ apnea: t.apnea, rest }))
    : t.apneas.map(apnea => ({ apnea, rest: t.rest }));
}

const roundTo5 = s => Math.round(s / 5) * 5;

// Escala proporcional según el MAX del usuario, redondeando a 5 s.
function scaleRounds(rounds, max) {
  const f = max / BASE_MAX;
  if (Math.abs(f - 1) < 1e-9) return rounds.map(r => ({ ...r }));
  return rounds.map(r => ({
    apnea: Math.max(5, roundTo5(r.apnea * f)),
    rest: Math.max(10, roundTo5(r.rest * f)),
  }));
}

function tableKey(type, week) {
  return type === 'CUSTOM' ? 'CUSTOM' : `${type}-${week}`;
}

function tableLabel(type, week) {
  if (type === 'CUSTOM') return 'Tabla personalizada';
  return `Tabla ${TYPE_NAME[type]} · Semana ${week}`;
}

// Devuelve la tabla efectiva: la edición manual (si existe) manda sobre la escalada.
function getTable(type, week, max, overrides) {
  const key = tableKey(type, week);
  const ov = overrides[key];
  let rounds;
  let edited = false;
  if (type === 'CUSTOM') {
    rounds = (ov || DEFAULT_CUSTOM).map(r => ({ ...r }));
  } else if (ov) {
    rounds = ov.map(r => ({ ...r }));
    edited = true;
  } else {
    rounds = scaleRounds(pdfRounds(type, week), max);
  }
  return { key, type, week, rounds, edited, label: tableLabel(type, week) };
}

function fmt(sec) {
  if (sec == null || Number.isNaN(sec)) return '–';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
