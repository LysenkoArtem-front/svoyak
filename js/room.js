/* Онлайн-комната ведущего: код комнаты, публикация состояния, приём событий игроков.
 * Сообщения идут через публичный брокер: состояние — на <код>/state, события игроков — на <код>/events. */

import { getState, update, subscribe } from './state.js';
import { connect } from './net.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

let conn = null; // активное соединение (одно на страницу)
let heartbeat = null;

/* ---------- Жизненный цикл комнаты ---------- */

export function createRoom() {
  if (conn && getState().room) return; // комната уже работает
  if (conn) { conn.end(); conn = null; } // рассинхрон после сброса состояния
  const code = genCode();
  update((s) => {
    s.room = { code, online: [], status: 'connecting' };
    s.buzzes = [];
  });
  open(code);
}

/** Восстановить комнату после перезагрузки (код уже сохранён в состоянии). */
export function resumeRoom() {
  const room = getState().room;
  if (room && !conn) open(room.code);
}

export function closeRoom() {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  if (conn) {
    const room = getState().room;
    if (room) {
      // Прощаемся с игроками: колбэк публикации гарантирует отправку до закрытия.
      conn.publish(`${room.code}/state`, { t: 'closed' }, { retain: true }).then(() => {
        conn?.end(true);
      });
      setTimeout(() => {
        conn?.end(true);
        conn = null;
      }, 3000);
    } else {
      conn.end(true);
      conn = null;
    }
  }
  update((s) => { s.room = null; });
}

function open(code) {
  conn = connect({
    onStatus: (status) => {
      update((s) => {
        if (s.room) s.room.status = status;
      });
      if (status === 'online') publishState();
    },
    onMessage: (_topic, msg) => handleEvent(msg),
  });
  conn.subscribe(`${code}/events`);

  // Любое изменение состояния игры тут же уходит игрокам.
  subscribe(() => publishState());
  // Пульс: игроки видят, что игра жива, даже если ничего не происходит.
  heartbeat = setInterval(publishState, 30000);
}

function genCode() {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/* ---------- Публикация состояния ---------- */

function publishState() {
  const s = getState();
  if (!s.room || !conn?.connected) return;
  // retain: брокер хранит последнее состояние и сразу отдаёт его новым игрокам.
  conn.publish(`${s.room.code}/state`, {
    t: 'state',
    scores: s.players.filter((p) => p.name.trim()).map((p) => ({ n: p.name, v: p.score })),
    round: s.currentRound + 1,
    phase: s.screen,
    open: s.screen === 'question',
  }, { retain: true });
}

/* ---------- События игроков ---------- */

function handleEvent(msg) {
  if (msg.t === 'join') {
    const name = cleanName(msg.name);
    if (!name) return;
    update((s) => {
      if (!s.room) return;
      const known = matchPlayer(s.players, name);
      if (known) {
        s.room.online = uniq([...s.room.online, known.name]);
      } else if (s.screen === 'setup') {
        // Настройка ещё идёт — незнакомое имя само становится игроком.
        s.players.push({ id: crypto.randomUUID(), name, score: 0 });
        s.room.online = uniq([...s.room.online, name]);
      }
    });
    return;
  }

  if (msg.t === 'buzz') {
    const name = cleanName(msg.name);
    const player = matchPlayer(getState().players, name);
    if (!player) return;
    update((s) => {
      s.buzzes = [...s.buzzes, { name: player.name, at: Date.now() }].slice(-20);
    });
  }
}

function cleanName(value) {
  return String(value ?? '').trim().slice(0, 20);
}

function matchPlayer(players, name) {
  const norm = name.toLowerCase();
  return players.find((p) => p.name.trim().toLowerCase() === norm) ?? null;
}

function uniq(list) {
  return [...new Set(list)];
}
