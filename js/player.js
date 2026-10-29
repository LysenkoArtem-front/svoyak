/* Страница игрока: вход по коду комнаты, кнопка «Отвечаю!», живой счёт.
 * Слушает состояние игры (svoyak-app/<код>/state) и шлёт нажатия (…/events). */

import { connect } from './net.js';
import { esc, fmtScore } from './util.js';

const LS_KEY = 'svoyak-player-v1';

let conn = null;
let me = null;            // { code, name }
let lastState = null;     // последнее состояние от ведущего
let lastStateAt = 0;      // когда получено последнее состояние (для обнаружения пропажи игры)
let pressed = false;      // кнопка уже нажата на текущем вопросе
let prevOpen = false;

const $ = (id) => document.getElementById(id);

/* ---------- Вход ---------- */

function showJoin(msg) {
  $('game-view').classList.add('hidden');
  $('join-view').classList.remove('hidden');
  if (msg) {
    const el = $('join-msg');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('msg-error');
  }
}

function enterGame() {
  $('join-view').classList.add('hidden');
  $('game-view').classList.remove('hidden');
  $('pl-code').textContent = me.code;
  render();
}

function join() {
  const code = $('inp-code').value.trim().toUpperCase();
  const name = $('inp-name').value.trim().slice(0, 20);
  if (!/^[A-Z2-9]{4}$/.test(code)) {
    return showJoinMsg('Код — 4 символа без похожих (0, 1, O, I).');
  }
  if (!name) {
    return showJoinMsg('Введите имя — ведущий должен вас узнать.');
  }
  hideJoinMsg();
  me = { code, name };
  localStorage.setItem(LS_KEY, JSON.stringify(me));
  enterGame();
  start();
}

function showJoinMsg(text) {
  const el = $('join-msg');
  el.textContent = text;
  el.classList.remove('hidden', 'msg-ok');
  el.classList.add('msg-error');
}

function hideJoinMsg() {
  $('join-msg').classList.add('hidden');
}

/* ---------- Связь ---------- */

function start() {
  conn = connect({
    onStatus,
    onMessage: (_topic, msg) => {
      if (msg.t === 'closed') {
        // Ведущий закрыл комнату — возвращаемся на форму входа.
        localStorage.removeItem(LS_KEY);
        conn?.end();
        conn = null;
        me = null;
        lastState = null;
        pressed = false;
        prevOpen = false;
        $('btn-join').disabled = true;
        $('inp-code').value = '';
        $('inp-name').value = '';
        showJoin('Комната закрыта ведущим.');
        return;
      }
      if (msg.t === 'state') {
        onState(msg);
      }
    },
  });
  conn.subscribe(`${me.code}/state`);
  publish({ t: 'join', name: me.name });
}

// После переподключения к брокеру надо представиться заново.
function onStatus(status) {
  if (status === 'online') publish({ t: 'join', name: me.name });
  renderStatus(status);
}

function publish(obj) {
  conn?.publish(`${me.code}/events`, obj);
}

function onState(msg) {
  lastState = msg;
  lastStateAt = Date.now();
  // Кнопка разжимается, когда вопрос закрывается.
  if (prevOpen && !msg.open) pressed = false;
  prevOpen = msg.open;
  render();
}

// Пульс от ведущего пропал дольше чем на 90 секунд — игра, похоже, закрылась.
setInterval(() => {
  if (conn && lastStateAt && Date.now() - lastStateAt > 90000) {
    renderStatus('lost');
  }
}, 5000);

/* ---------- Отрисовка ---------- */

function myEntry() {
  return lastState?.scores.find((p) => p.n.toLowerCase() === me.name.toLowerCase()) ?? null;
}

function render() {
  if (!me || !$('game-view') || $('game-view').classList.contains('hidden')) return;
  const entry = myEntry();

  $('pl-name').textContent = me.name;
  $('pl-score').textContent = fmtScore(entry?.v ?? 0);

  const buzz = $('btn-buzz');
  const open = Boolean(lastState?.open);
  buzz.classList.toggle('pressed', pressed);
  if (!open) {
    buzz.disabled = true;
    buzz.textContent = 'Ждём вопрос…';
  } else if (pressed) {
    buzz.disabled = true;
    buzz.textContent = 'Нажато! Ведущий видит ✓';
  } else {
    buzz.disabled = false;
    buzz.textContent = 'Отвечаю!';
  }

  $('pl-hint').textContent = !lastState
    ? 'Ждём игру…'
    : !entry
      ? (lastState.phase === 'setup'
        ? 'Ведущий ещё собирает игроков — как представитесь, так и появится счёт.'
        : 'Вас нет в списке игры — проверьте имя на экране ведущего.')
      : '';

  const scores = lastState?.scores ?? [];
  $('mini-scores').innerHTML = scores.length
    ? scores.map((p) => `
        <div class="mini-score ${p.n.toLowerCase() === me.name.toLowerCase() ? 'me' : ''}">
          <span>${esc(p.n)}</span><span class="v">${fmtScore(p.v)}</span>
        </div>`).join('')
    : '';
}

function renderStatus(status) {
  const el = $('pl-status');
  const labels = {
    online: ['room-dot-online', 'на связи'],
    connecting: ['room-dot-connecting', 'подключение…'],
    error: ['room-dot-error', 'нет связи'],
    lost: ['room-dot-error', 'игра не отвечает — возможно, ведущий закрыл её'],
  }[status] ?? ['room-dot-connecting', 'подключение…'];
  el.innerHTML = `<span class="room-dot ${labels[0]}"></span> ${labels[1]}`;
}

/* ---------- Запуск ---------- */

// confirm-заглушки и перехватчики не нужны: страница только шлёт события.
$('btn-join').onclick = join;
$('inp-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
});
const syncJoinEnabled = () => {
  $('btn-join').disabled = $('inp-code').value.trim().length !== 4 || $('inp-name').value.trim() === '';
};
$('inp-code').addEventListener('input', syncJoinEnabled);
$('inp-name').addEventListener('input', syncJoinEnabled);
$('inp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('inp-name').focus(); });
$('inp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('btn-join').disabled) join(); });

$('btn-buzz').onclick = () => {
  if (pressed || !lastState?.open) return;
  pressed = true;
  publish({ t: 'buzz', name: me.name });
  render();
};

$('btn-leave').onclick = () => {
  localStorage.removeItem(LS_KEY);
  conn?.end();
  conn = null;
  me = null;
  lastState = null;
  pressed = false;
  prevOpen = false;
  $('btn-join').disabled = true;
  $('inp-code').value = '';
  $('inp-name').value = '';
  showJoin();
};

// Автопереподключение, если страница уже была в игре
try {
  const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
  if (saved?.code && saved?.name) {
    me = saved;
    enterGame();
    start();
  }
} catch {
  localStorage.removeItem(LS_KEY);
}
