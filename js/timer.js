'use strict';

// ?speed=10 acelera el reloj (solo para pruebas).
const SPEED = (() => {
  try {
    const v = Number(new URLSearchParams(location.search).get('speed'));
    return v > 0 ? v : 1;
  } catch {
    return 1;
  }
})();

const clock = () => performance.now() * SPEED;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Motor de la sesión: prep → apnea → descanso → apnea … → fin.
// Los tiempos se calculan con marcas de tiempo, así el reloj no se desfasa
// aunque el navegador ralentice los temporizadores con la pantalla bloqueada.
class Trainer {
  constructor(plan, opts, hooks) {
    this.plan = plan;   // { type, week, label, rounds:[{apnea|null, rest}], prep, prepLabel, endless, max }
    this.opts = opts;   // { auto, autoStopApnea, marks:[{ sec, label }] }
    this.hooks = hooks; // { onTick, onPhase, onRecord, onFinish, onMark, cue }
    this.phase = 'idle';
    this.idx = 0;
    this.paused = false;
    this.waiting = false;
    this.repeatNext = false;
    this.records = [];
    this.session = {
      id: newId(),
      fecha: new Date().toISOString(),
      tipo: plan.type,
      semana: plan.week ?? null,
      etiqueta: plan.label,
      maxUsado: plan.max,
      rondasPlan: plan.endless || plan.type === 'TEST' ? null : plan.rounds.length,
      rondas: this.records,
      nota: '',
      terminada: false,
    };
  }

  get round() {
    const r = this.plan.rounds;
    return r[Math.min(this.idx, r.length - 1)];
  }

  get running() {
    return this.phase !== 'idle' && this.phase !== 'done';
  }

  now() {
    return this.paused ? this.pausedAt : clock();
  }

  elapsed() {
    return this.now() - this.phaseStart;
  }

  remaining() {
    return this.duration - this.elapsed();
  }

  nextApnea() {
    if (this.repeatNext || this.plan.endless) return this.round.apnea;
    const next = this.plan.rounds[this.idx + 1];
    return next ? next.apnea : null;
  }

  start() {
    this.session.fecha = new Date().toISOString();
    const t = clock();
    if (this.plan.prep > 0) this.enter('prep', t, this.plan.prep * 1000);
    else this.enter('apnea', t);
    Feedback.keepAlive(true);
    this.loop = setInterval(() => this.tick(), 100);
    this.tick();
  }

  enter(phase, at, duration = null) {
    this.phase = phase;
    this.phaseStart = at;
    this.duration = duration;
    this.fired = new Set();
    this.waiting = false;
    this.hooks.cue(phase);
    this.hooks.onPhase();
  }

  tick() {
    if (!this.running || this.paused) {
      this.hooks.onTick();
      return;
    }
    // Bucle por si hay que "ponerse al día" tras volver de segundo plano.
    for (let guard = 0; guard < 100; guard++) {
      if (this.phase === 'prep' || this.phase === 'rest') {
        const rem = this.remaining();
        this.countdownCues(rem);
        if (rem <= 0) {
          const endAt = this.phaseStart + this.duration;
          if (this.opts.auto) {
            if (this.phase === 'prep') this.enter('apnea', endAt);
            else this.finishRest(endAt);
            continue;
          }
          if (!this.waiting) {
            this.waiting = true;
            this.hooks.cue('ready');
          }
        }
      } else if (this.phase === 'apnea') {
        this.markCues();
        if (!this.round.apnea) break;
        const rem = this.round.apnea * 1000 - this.elapsed();
        this.countdownCues(rem);
        if (rem <= 0) {
          if (this.opts.auto && this.opts.autoStopApnea) {
            this.endApnea(this.phaseStart + this.round.apnea * 1000);
            continue;
          }
          if (!this.fired.has('target')) {
            this.fired.add('target');
            this.hooks.cue('target');
          }
        }
      }
      break;
    }
    this.hooks.onTick();
  }

  countdownCues(remMs) {
    const s = Math.ceil(remMs / 1000);
    if (s >= 1 && s <= 3 && !this.fired.has(s)) {
      this.fired.add(s);
      this.hooks.cue('tick');
    }
    if (this.phase === 'rest' && s === 10 && this.duration > 15000 && !this.fired.has('ten')) {
      this.fired.add('ten');
      this.hooks.cue('ten');
    }
  }

  // Marcas de tiempo durante la apnea (superar el MAX, 3:00…): doble pitido corto.
  // Si al volver de segundo plano se han pasado varias, suena solo una vez.
  markCues() {
    const el = this.elapsed() / 1000;
    let hit = null;
    for (const m of this.opts.marks || []) {
      const key = `mark:${m.sec}`;
      if (el < m.sec || this.fired.has(key)) continue;
      this.fired.add(key);
      // Coincide con el objetivo de la ronda: ya suena el aviso de objetivo.
      if (m.sec !== this.round.apnea) hit = m;
    }
    if (hit) {
      this.hooks.cue('mark');
      if (this.hooks.onMark) this.hooks.onMark(hit);
    }
  }

  pushRecord(actualSec) {
    const r = this.round;
    const rec = {
      n: this.idx + 1,
      objetivoApnea: r.apnea ?? null,
      apneaReal: Math.round(actualSec * 10) / 10,
      descansoPlan: r.rest || null,
      descansoReal: null,
      completada: r.apnea ? actualSec >= r.apnea - 0.5 : true,
    };
    this.records.push(rec);
    this.persist();
    this.hooks.onRecord();
    return rec;
  }

  endApnea(at) {
    this.pushRecord((at - this.phaseStart) / 1000);
    const last = !this.plan.endless && this.idx >= this.plan.rounds.length - 1;
    if (last) return this.finish();
    this.enter('rest', at, this.round.rest * 1000);
  }

  finishRest(at) {
    const rec = this.records[this.records.length - 1];
    if (rec) {
      rec.descansoReal = Math.round((at - this.phaseStart) / 1000);
      this.persist();
    }
    if (this.repeatNext) this.repeatNext = false;
    else this.idx++;
    this.enter('apnea', at);
  }

  // --- Acciones manuales (disponibles también en modo automático) ---

  primary() {
    if (this.paused) this.resume();
    const at = clock();
    if (this.phase === 'prep') this.enter('apnea', at);
    else if (this.phase === 'rest') this.finishRest(at);
    else if (this.phase === 'apnea') this.endApnea(at);
  }

  adjust(deltaSec) {
    if (this.phase !== 'prep' && this.phase !== 'rest') return;
    const minDur = this.elapsed();
    this.duration = Math.max(minDur, this.duration + deltaSec * 1000);
    if (this.remaining() > 0) {
      this.waiting = false;
      this.fired = new Set([...this.fired].filter(k => k === 'ten'));
    }
    this.tick();
  }

  pause() {
    if (!this.running || this.paused) return;
    this.pausedAt = clock();
    this.paused = true;
    this.hooks.onTick();
  }

  resume() {
    if (!this.paused) return;
    this.phaseStart += clock() - this.pausedAt;
    this.paused = false;
    this.hooks.onTick();
  }

  // En apnea: vuelve a empezar la apnea. En descanso: la próxima apnea repite esta ronda.
  repeat() {
    if (this.phase === 'apnea') {
      if (this.paused) this.resume();
      this.enter('apnea', clock());
    } else if (this.phase === 'rest') {
      this.repeatNext = !this.repeatNext;
      this.hooks.onTick();
    }
  }

  setAuto(auto) {
    this.opts.auto = auto;
    this.tick();
  }

  stop() {
    if (!this.running) return;
    if (this.paused) this.resume();
    const at = clock();
    if (this.phase === 'apnea') {
      const actual = (at - this.phaseStart) / 1000;
      if (actual >= 1) this.pushRecord(actual);
    } else if (this.phase === 'rest') {
      const rec = this.records[this.records.length - 1];
      if (rec) rec.descansoReal = Math.round((at - this.phaseStart) / 1000);
    }
    this.finish();
  }

  finish() {
    clearInterval(this.loop);
    Feedback.keepAlive(false);
    this.phase = 'done';
    this.paused = false;
    this.session.terminada = true;
    this.persist();
    this.hooks.cue('done');
    this.hooks.onFinish();
  }

  persist() {
    if (this.records.length) Store.upsertSession(this.session);
  }
}

// Sonidos (WebAudio), vibración, voz y pantalla encendida.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const Feedback = {
  ctx: null,
  hum: null,
  wakeLock: null,
  wantWake: false,

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state !== 'running') {
        this.ctx.resume();
        // iOS: reproducir un búfer mudo dentro del gesto desbloquea la salida de audio.
        const src = this.ctx.createBufferSource();
        src.buffer = this.ctx.createBuffer(1, 1, 22050);
        src.connect(this.ctx.destination);
        src.start(0);
      }
    } catch { /* sin audio */ }
  },

  // Durante la sesión mantiene un tono inaudible sonando. Tras varios segundos de
  // silencio el móvil (y más aún los auriculares Bluetooth) apaga la salida de audio
  // y se come los pitidos cortos de la cuenta atrás; así la salida sigue despierta.
  keepAlive(on) {
    try {
      if (on && !this.hum && this.ctx) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.value = 440;
        gain.gain.value = 0.0004;
        osc.connect(gain).connect(this.ctx.destination);
        osc.start();
        this.hum = osc;
      } else if (!on && this.hum) {
        this.hum.stop();
        this.hum = null;
      }
    } catch { /* sin audio */ }
  },

  tone(freq, dur = 0.15, delay = 0, vol = 0.3, type = 'sine', retry = true) {
    if (!Store.settings.sound || !this.ctx) return;
    // Si el contexto aún está arrancando (primer toque) o iOS lo ha interrumpido,
    // se programa al reanudarse; si no, los tonos cortos se pierden en silencio.
    if (this.ctx.state !== 'running') {
      if (retry) this.ctx.resume().then(() => this.tone(freq, dur, delay, vol, type, false)).catch(() => {});
      return;
    }
    const t0 = this.ctx.currentTime + 0.03 + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },

  vibrate(pattern) {
    if (!Store.settings.vibrate) return;
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch { /* no soportado */ }
      return;
    }
    if (!IOS) return;
    // iOS no tiene API de vibración: cada tramo "encendido" del patrón se convierte
    // en toques hápticos (uno cada 120 ms en los tramos largos).
    const p = Array.isArray(pattern) ? pattern : [pattern];
    let t = 0;
    p.forEach((ms, i) => {
      if (i % 2 === 0) {
        for (let k = 0; k === 0 || k * 120 < ms; k++) setTimeout(() => this.haptic(), t + k * 120);
      }
      t += ms;
    });
  },

  // Truco de iOS 18+: activar un <input type="checkbox" switch> da un toque háptico.
  haptic() {
    try {
      const label = document.createElement('label');
      label.ariaHidden = 'true';
      label.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.appendChild(input);
      document.head.appendChild(label);
      label.click();
      label.remove();
    } catch { /* no soportado */ }
  },

  say(text) {
    if (!Store.settings.voice || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-ES';
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* sin voz */ }
  },

  cue(kind, prepLabel) {
    switch (kind) {
      case 'tick':
        // Triangular a 1 kHz: se oye bien por el altavoz del móvil (la senoidal grave no).
        this.tone(1000, 0.12, 0, 0.45, 'triangle');
        this.vibrate(40);
        break;
      case 'prep':
        this.say(prepLabel || 'Prepárate');
        break;
      case 'apnea':
        this.tone(880, 0.14, 0, 0.4, 'triangle');
        this.tone(880, 0.14, 0.2, 0.4, 'triangle');
        this.vibrate([200, 100, 200]);
        this.say('Apnea');
        break;
      case 'rest':
        this.tone(520, 0.55, 0, 0.4, 'triangle');
        this.vibrate(500);
        this.say('Respira');
        break;
      case 'target':
        this.tone(990, 0.15);
        this.tone(990, 0.15, 0.22);
        this.tone(990, 0.15, 0.44);
        this.vibrate([80, 60, 80, 60, 80]);
        this.say('Objetivo');
        break;
      case 'mark':
        // Pi-pi seco y agudo: distinto de todos los demás avisos.
        this.tone(1600, 0.08, 0, 0.3, 'square');
        this.tone(1600, 0.08, 0.14, 0.3, 'square');
        this.vibrate([30, 60, 30]);
        break;
      case 'ready':
        this.tone(700, 0.3);
        this.vibrate(200);
        break;
      case 'ten':
        this.say('Diez segundos');
        break;
      case 'done':
        this.tone(523, 0.18);
        this.tone(659, 0.18, 0.2);
        this.tone(784, 0.4, 0.4);
        this.vibrate([100, 60, 100, 60, 300]);
        this.say('Sesión terminada');
        break;
    }
  },

  async keepAwake(on) {
    this.wantWake = on;
    try {
      if (on && !this.wakeLock && 'wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      } else if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch { /* no soportado o denegado */ }
  },
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Feedback.wantWake) Feedback.keepAwake(true);
  // Al volver de bloquear la pantalla, iOS deja el audio interrumpido.
  if (Feedback.ctx && Feedback.ctx.state !== 'running') Feedback.ctx.resume().catch(() => {});
});
