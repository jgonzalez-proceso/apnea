'use strict';

// Persistencia local (solo en este dispositivo). Si localStorage no está
// disponible, la app sigue funcionando en memoria.
const STORE_PREFIX = 'pelizzari.v1.';

const DEFAULT_SETTINGS = {
  max: 90,              // MAX en segundos (el PDF está calculado para 1:30)
  startDate: null,      // 'yyyy-mm-dd'; el calendario empieza ese mismo día
  startWeek: 1,         // semana del programa con la que empieza (para continuar uno hecho por tu cuenta)
  restDays: [],         // días fijos de descanso (getDay: 0 = domingo), hasta 2; vacío = los 2 últimos de cada semana
  auto: true,           // transición automática apnea → descanso → apnea
  autoStopApnea: true,  // en automático, la apnea se corta al llegar al objetivo
  prep: 10,             // cuenta atrás antes de la primera apnea (s)
  sound: true,
  vibrate: true,
  voice: false,
  markMax: true,        // doble pitido corto al superar el MAX durante la apnea
  marks: [],            // marcas personalizadas (s) con el mismo doble pitido
  safetyAck: false,
};

function readKey(name, def) {
  try {
    const v = localStorage.getItem(STORE_PREFIX + name);
    return v == null ? def : JSON.parse(v);
  } catch {
    return def;
  }
}

function writeKey(name, val) {
  try {
    localStorage.setItem(STORE_PREFIX + name, JSON.stringify(val));
    return true;
  } catch {
    return false;
  }
}

const Store = {
  settings: { ...DEFAULT_SETTINGS, ...readKey('settings', {}) },
  sessions: readKey('sessions', []),
  overrides: readKey('overrides', {}),

  saveSettings() {
    writeKey('settings', this.settings);
  },

  upsertSession(s) {
    const i = this.sessions.findIndex(x => x.id === s.id);
    if (i >= 0) this.sessions[i] = s;
    else this.sessions.push(s);
    writeKey('sessions', this.sessions);
  },

  deleteSession(id) {
    this.sessions = this.sessions.filter(s => s.id !== id);
    writeKey('sessions', this.sessions);
  },

  // Sesiones con al menos una ronda, ordenadas por fecha ascendente.
  doneSessions() {
    return this.sessions
      .filter(s => s.rondas && s.rondas.length)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  },

  setOverride(key, rounds) {
    if (rounds) this.overrides[key] = rounds;
    else delete this.overrides[key];
    writeKey('overrides', this.overrides);
  },

  exportJSON() {
    return JSON.stringify({
      app: 'pelizzari',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.settings,
      sessions: this.sessions,
      overrides: this.overrides,
    }, null, 2);
  },

  exportCSV() {
    const head = ['fecha', 'tipo', 'semana', 'sesion_id', 'ronda', 'objetivo_apnea_s',
      'apnea_real_s', 'descanso_plan_s', 'descanso_real_s', 'completada'];
    const rows = [head.join(';')];
    for (const s of this.doneSessions()) {
      for (const r of s.rondas) {
        rows.push([
          s.fecha, s.tipo, s.semana ?? '', s.id, r.n, r.objetivoApnea ?? '',
          r.apneaReal, r.descansoPlan ?? '', r.descansoReal ?? '', r.completada ? 'si' : 'no',
        ].join(';'));
      }
    }
    return '﻿' + rows.join('\r\n');
  },

  // Añade o reemplaza sesiones por id. Devuelve cuántas son nuevas.
  mergeSessions(list) {
    let added = 0;
    for (const s of list) {
      if (!s || !s.id) continue;
      const i = this.sessions.findIndex(x => x.id === s.id);
      if (i >= 0) this.sessions[i] = s;
      else { this.sessions.push(s); added++; }
    }
    writeKey('sessions', this.sessions);
    return added;
  },

  // Copia completa: fusiona sesiones por id; ajustes y tablas editadas se toman del archivo.
  importJSON(obj) {
    if (!obj || !Array.isArray(obj.sessions)) throw new Error('El archivo no parece una copia de esta app.');
    const added = this.mergeSessions(obj.sessions);
    if (obj.settings) this.settings = { ...DEFAULT_SETTINGS, ...obj.settings, safetyAck: true };
    if (obj.overrides) this.overrides = { ...obj.overrides };
    writeKey('settings', this.settings);
    writeKey('overrides', this.overrides);
    return added;
  },

  clearAll() {
    this.sessions = [];
    this.overrides = {};
    this.settings = { ...DEFAULT_SETTINGS, safetyAck: true };
    writeKey('sessions', this.sessions);
    writeKey('overrides', this.overrides);
    writeKey('settings', this.settings);
  },
};

function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
