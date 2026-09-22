# Apnea Pelizzari

PWA de entrenamiento de apnea en seco con las tablas CO₂ / O₂ del programa de 4 semanas del método Umberto Pelizzari (1:30 → 3:00). Interfaz y textos en español.

## Stack

- HTML + CSS + JavaScript plano, **sin build, sin dependencias ni npm**. Los scripts se cargan como `<script>` clásicos (no módulos) en `index.html` y comparten el ámbito global, así que el orden importa: `tables.js` → `store.js` → `chart.js` → `timer.js` → `app.js`.
- Datos solo en `localStorage` del dispositivo (prefijo `pelizzari.v1.`). No hay backend.
- Despliegue: Vercel (proyecto `apnea-pelizzari`) conectado a GitHub; cada push a `main` despliega. `vercel.json` fuerza `no-cache` en JS/CSS/HTML y `sw.js`.

## Archivos

- `js/tables.js` — tablas del PDF (calculadas para MAX 1:30 = `BASE_MAX`), escalado proporcional al MAX del usuario (redondeo a 5 s) y `getTable()`, que aplica las ediciones manuales (`overrides`) por encima.
- `js/store.js` — `Store`: ajustes (`DEFAULT_SETTINGS`), sesiones, tablas editadas, exportar/importar JSON y CSV.
- `js/timer.js` — `Trainer`: motor de la sesión (prep → apnea → descanso → … → fin) basado en marcas de tiempo para no desfasarse en segundo plano; `Feedback`: sonidos WebAudio, vibración, voz y wake lock. Los avisos se piden con `hooks.cue(kind)`.
- `js/chart.js` — gráficas SVG propias (línea / barras).
- `js/app.js` — vistas (Hoy, Tablas, Historial, Progreso, Ajustes), modales, pantalla del cronómetro y el mapa `ACTIONS` (clics delegados vía `data-act`; los ajustes simples se guardan solos con `data-setting`).
- `sw.js` — service worker "red primero, caché como respaldo". Si se añade un archivo, incluirlo en `FILES`.
- `serve.js` — servidor estático para pruebas locales (`node serve.js [puerto]`); no se despliega.

## Convenciones

- Tiempos siempre en **segundos** internamente; `fmt()` los muestra como `m:ss`.
- Al añadir un ajuste, darle valor por defecto en `DEFAULT_SETTINGS` (los ajustes guardados se fusionan con los defaults, así que los usuarios existentes lo reciben).
- Estilo: `'use strict'`, 2 espacios, comillas simples, comentarios breves en español.
- Colores y tokens en variables CSS de `styles.css` (tema oscuro único). Pensado primero para móvil (iPhone con zonas seguras).

## Probar

- `?speed=10` en la URL acelera el reloj del cronómetro (solo para pruebas).
- Configuración de preview en `.claude/launch.json` (`autoPort`), servida con `serve.js`.
- No hay tests automáticos: verificar en el navegador (flujo de cronómetro, Ajustes, exportar/importar).

## Seguridad del usuario

Mantener visibles las normas: nunca apnea en agua estando solo, entrenar en seco y no hiperventilar.
