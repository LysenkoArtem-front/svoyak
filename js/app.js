/* Точка входа: навигация по экранам, шапка с табло, кнопки отмены и новой игры. */

import {
  initStore, getState, update, subscribe,
  clearState, defaultState, undo,
} from './state.js';
import { esc, fmtScore } from './util.js';
import { loadPackFromObject, packSummary, exportPack, renderEditor } from './pack.js';
import { renderBoard, renderQuestion } from './board.js';
import { renderFinal } from './final.js';
import { createRoom, closeRoom, resumeRoom } from './room.js';

const SCREEN_IDS = {
  setup: 'screen-setup',
  editor: 'screen-editor',
  board: 'screen-board',
  question: 'screen-question',
  final: 'screen-final',
  results: 'screen-results',
};

/* ---------- Экран настройки ---------- */

function renderSetup(root, state) {
  root.innerHTML = `
    <div class="card center-card">
      <h1>Свояк</h1>
      <p class="subtitle">Помощник ведущего: раунды с категориями, модификаторы и финал со ставками.</p>
    </div>

    <div class="card setup-card">
      <h2>Игроки</h2>
      ${state.players.map((p, i) => `
        <div class="player-row" data-idx="${i}">
          <input type="text" placeholder="Имя игрока ${i + 1}" value="${esc(p.name)}">
          <button class="btn btn-ghost btn-danger player-del" type="button" title="Удалить игрока"
            ${state.players.length <= 2 ? 'disabled' : ''}>✕</button>
        </div>`).join('')}
      <div class="btn-row">
        <button id="btn-add-player" class="btn" type="button" ${state.players.length >= 8 ? 'disabled' : ''}>
          + Добавить игрока
        </button>
      </div>
    </div>

    <div class="card setup-card">
      <h2>Пак вопросов</h2>
      <p class="pack-status ${state.pack ? 'pack-loaded' : ''}">
        ${state.pack ? `✓ Загружен. ${esc(packSummary(state.pack))}` : 'Пак не выбран — загрузите пример, свой файл или создайте в редакторе.'}
      </p>
      <div class="btn-row">
        <button id="btn-load-example" class="btn" type="button">Загрузить пример</button>
        <button id="btn-import" class="btn" type="button">Импорт из файла</button>
        <button id="btn-editor" class="btn" type="button">Редактор пака</button>
        <button id="btn-export" class="btn" type="button" ${state.pack ? '' : 'disabled'}>Экспорт</button>
        ${state.pack ? '<button id="btn-clear-pack" class="btn btn-ghost btn-danger" type="button">Убрать пак</button>' : ''}
      </div>
      ${state.packStatus ? `<p class="msg ${state.packStatus.type === 'error' ? 'msg-error' : 'msg-ok'}">${esc(state.packStatus.text)}</p>` : ''}
      <input id="file-import" type="file" accept=".json,application/json" hidden>
    </div>

    <div class="card setup-card">
      <h2>Онлайн-комната для игроков</h2>
      ${state.room ? `
        <p class="pack-status pack-loaded">
          Код комнаты: <b class="room-code">${esc(state.room.code)}</b>
          · ${roomStatusText(state.room.status)}
          · подключились: ${state.room.online.length ? esc(state.room.online.join(', ')) : 'пока никто'}
        </p>
        <p class="pack-status">
          Страница игрока: <a class="room-link" href="${esc(playerUrl())}" target="_blank" rel="noopener">${esc(playerUrl())}</a>
          <button id="btn-copy-link" class="btn btn-ghost" type="button">Скопировать ссылку</button>
        </p>
        <div class="btn-row">
          <button id="btn-close-room" class="btn btn-ghost btn-danger" type="button">Закрыть комнату</button>
        </div>`
      : `
        <p class="pack-status">Игроки откроют страницу игрока, введут код — и получат кнопку «Отвечаю!» и свой счёт на телефоне.</p>
        <div class="btn-row">
          <button id="btn-create-room" class="btn" type="button">Создать комнату</button>
        </div>`}
    </div>

    <div class="card setup-card start-card">
      <button id="btn-start" class="btn btn-primary btn-big" type="button">Начать игру</button>
      ${state.setupMsg ? `<p class="msg ${state.setupMsg.type === 'error' ? 'msg-error' : 'msg-ok'}">${esc(state.setupMsg.text)}</p>` : ''}
    </div>`;

  /* Игроки: имя пишем в состояние без перерисовки, чтобы не терять фокус при вводе. */
  root.querySelectorAll('.player-row').forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.querySelector('input').oninput = (e) => {
      update((s) => { s.players[idx].name = e.target.value; }, { rerender: false });
    };
    row.querySelector('.player-del').onclick = () => {
      update((s) => { s.players.splice(idx, 1); });
    };
  });

  root.querySelector('#btn-add-player').onclick = () => {
    update((s) => {
      if (s.players.length < 8) s.players.push({ id: crypto.randomUUID(), name: '', score: 0 });
    });
    const inputs = root.querySelectorAll('.player-row input');
    inputs[inputs.length - 1]?.focus();
  };

  /* Пак вопросов */
  const applyPack = (raw, sourceLabel) => {
    const result = loadPackFromObject(raw);
    update((s) => {
      if (result.ok) {
        s.pack = result.pack;
        s.packStatus = { type: 'ok', text: `${sourceLabel}.` };
      } else {
        s.packStatus = { type: 'error', text: `${sourceLabel} не подходит — ${result.errors.join('; ')}.` };
      }
    });
  };

  root.querySelector('#btn-load-example').onclick = async () => {
    try {
      const res = await fetch('data/example-pack.json');
      if (!res.ok) throw new Error(`файл недоступен (код ${res.status})`);
      applyPack(await res.json(), 'Загружен пример');
    } catch (e) {
      update((s) => { s.packStatus = { type: 'error', text: `Не удалось загрузить пример: ${e.message}.` }; });
    }
  };

  const fileInput = root.querySelector('#file-import');
  root.querySelector('#btn-import').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      applyPack(JSON.parse(await file.text()), `Файл «${file.name}»`);
    } catch {
      update((s) => { s.packStatus = { type: 'error', text: `Файл «${file.name}» — это не корректный JSON.` }; });
    }
  };

  root.querySelector('#btn-editor').onclick = () => {
    update((s) => {
      s.setupMsg = null;
      s.screen = 'editor';
    });
  };

  root.querySelector('#btn-export').onclick = () => exportPack(getState().pack);

  const clearBtn = root.querySelector('#btn-clear-pack');
  if (clearBtn) {
    clearBtn.onclick = () => update((s) => {
      s.pack = null;
      s.packStatus = null;
    });
  }

  /* Онлайн-комната */
  const createBtn = root.querySelector('#btn-create-room');
  if (createBtn) {
    createBtn.onclick = () => createRoom();
  }
  const closeRoomBtn = root.querySelector('#btn-close-room');
  if (closeRoomBtn) {
    closeRoomBtn.onclick = () => closeRoom();
  }
  const copyLinkBtn = root.querySelector('#btn-copy-link');
  if (copyLinkBtn) {
    copyLinkBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(playerUrl());
        copyLinkBtn.textContent = 'Скопировано ✓';
        setTimeout(() => { copyLinkBtn.textContent = 'Скопировать ссылку'; }, 1500);
      } catch {
        window.prompt('Скопируйте ссылку вручную:', playerUrl());
      }
    };
  }

  /* Старт */
  root.querySelector('#btn-start').onclick = () => {
    const errors = [];
    const named = getState().players.filter((p) => p.name.trim());
    if (named.length < 2) errors.push('Нужно минимум 2 игрока с именами.');
    const lowerNames = named.map((p) => p.name.trim().toLowerCase());
    if (new Set(lowerNames).size !== lowerNames.length) errors.push('Имена игроков не должны повторяться.');
    if (!getState().pack) errors.push('Сначала загрузите или создайте пак вопросов.');
    if (errors.length) {
      update((s) => { s.setupMsg = { type: 'error', text: errors.join(' ') }; });
      return;
    }
    update((s) => {
      s.players = named.map((p) => ({ id: p.id, name: p.name.trim(), score: 0 }));
      s.screen = 'board';
      s.currentRound = 0;
      s.played = [];
      s.approx = {};
      s.question = null;
      s.final = null;
      s.undoStack = [];
      s.setupMsg = null;
    });
  };
}

/* ---------- Экран итогов ---------- */

function renderResults(root, state) {
  const players = [...state.players].sort((a, b) => b.score - a.score);
  const top = players[0]?.score ?? 0;
  const winners = players.filter((p) => p.score === top);
  const medals = ['🥇', '🥈', '🥉'];

  let place = 0;
  let prevScore = null;
  const rows = players.map((p, i) => {
    if (p.score !== prevScore) {
      place = i + 1;
      prevScore = p.score;
    }
    const placeLabel = place <= 3 ? medals[place - 1] : `${place}-е место`;
    return `
      <div class="result-row ${p.score === top ? 'winner' : ''}">
        <span class="result-place">${placeLabel}</span>
        <span class="result-name">${esc(p.name)}</span>
        <span class="result-score">${fmtScore(p.score)}</span>
      </div>`;
  }).join('');

  const title = winners.length > 1
    ? `Победители: ${winners.map((w) => esc(w.name)).join(' и ')} — по ${fmtScore(top)}`
    : `Победитель: ${esc(winners[0]?.name ?? '—')} — ${fmtScore(top)}`;

  root.innerHTML = `
    <div class="card center-card results-card">
      <h2>Итоги игры</h2>
      <p class="subtitle">${title}</p>
      <div class="results-table">${rows}</div>
      <div class="btn-row results-actions">
        <button id="btn-rematch" class="btn btn-primary" type="button">Сыграть ещё раз</button>
        <button id="btn-finish" class="btn" type="button">Новая игра</button>
      </div>
    </div>`;

  root.querySelector('#btn-rematch').onclick = () => {
    if (!confirm('Сыграть ещё раз с теми же игроками и тем же паком? Счёт обнулится.')) return;
    update((s) => {
      s.players.forEach((p) => { p.score = 0; });
      s.played = [];
      s.approx = {};
      s.currentRound = 0;
      s.question = null;
      s.final = null;
      s.undoStack = [];
      s.screen = 'board';
    });
  };

  root.querySelector('#btn-finish').onclick = () => {
    clearState();
    update((s) => {
      Object.assign(s, defaultState());
      s.players = [
        { id: crypto.randomUUID(), name: '', score: 0 },
        { id: crypto.randomUUID(), name: '', score: 0 },
      ];
    });
  };
}

const SCREEN_RENDERERS = {
  setup: renderSetup,
  editor: renderEditor,
  board: renderBoard,
  question: renderQuestion,
  final: renderFinal,
  results: renderResults,
};

/* ---------- Отрисовка ---------- */

function render() {
  const state = getState();

  for (const [name, id] of Object.entries(SCREEN_IDS)) {
    document.getElementById(id).classList.toggle('hidden', name !== state.screen);
  }

  const topbar = document.getElementById('topbar');
  topbar.classList.toggle('hidden', state.screen === 'setup' || state.screen === 'editor');

  renderScorebar(state);

  document.getElementById('btn-undo').disabled = state.undoStack.length === 0;

  const root = document.getElementById(SCREEN_IDS[state.screen]);
  SCREEN_RENDERERS[state.screen](root, state);
}

function renderScorebar(state) {
  const bar = document.getElementById('scorebar');
  bar.innerHTML = state.players
    .map((p) => `
      <span class="score-chip">
        <b>${esc(p.name)}</b>
        <span class="score">${fmtScore(p.score)}</span>
      </span>`)
    .join('');

  const chip = document.getElementById('room-chip');
  if (!state.room) {
    chip.classList.add('hidden');
    return;
  }
  chip.classList.remove('hidden');
  chip.innerHTML = `
    <span class="room-dot room-dot-${esc(state.room.status)}"></span>
    Комната <b>${esc(state.room.code)}</b>`;
}

function roomStatusText(status) {
  return {
    connecting: 'подключение к брокеру…',
    online: 'комната на связи',
    error: 'нет связи с брокером',
  }[status] ?? status;
}

/** Адрес страницы игрока рядом с приложением ведущего. */
function playerUrl() {
  return new URL('player.html', location.href).href;
}

/* ---------- Запуск ---------- */

initStore();
subscribe(render);
resumeRoom(); // восстановить комнату, если игра перезагрузилась

// Первый запуск: сразу два поля для игроков.
function seedPlayers() {
  if (!getState().players.length) {
    update((s) => {
      s.players = [
        { id: crypto.randomUUID(), name: '', score: 0 },
        { id: crypto.randomUUID(), name: '', score: 0 },
      ];
    }, { rerender: false });
  }
}

document.getElementById('btn-undo').onclick = () => update((s) => {
  if (!undo(s)) return;
  // Возврат туда, где действие было совершено: открытый вопрос или финал.
  if (s.question) s.screen = 'question';
  else if (s.final) s.screen = 'final';
  else s.screen = 'board';
});

document.getElementById('btn-new-game').onclick = () => {
  const inProgress = getState().screen !== 'setup' && getState().screen !== 'editor';
  if (inProgress && !confirm('Начать новую игру? Текущий прогресс будет удалён.')) return;
  closeRoom(); // новая игра — новая комната
  clearState();
  update((s) => {
    Object.assign(s, defaultState());
    s.players = [
      { id: crypto.randomUUID(), name: '', score: 0 },
      { id: crypto.randomUUID(), name: '', score: 0 },
    ];
  });
};

seedPlayers();
render();
