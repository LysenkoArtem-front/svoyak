/* Состояние игры: единое хранилище, сохранение в localStorage, отмена действий. */

const STORAGE_KEY = 'svoyak_state_v1';
const UNDO_LIMIT = 50;

export function defaultState() {
  return {
    screen: 'setup',      // setup | board | question | final | results
    players: [],          // [{ id, name, score }]
    pack: null,           // выбранный пак вопросов
    packStatus: null,     // { type: 'ok' | 'error', text } — сообщение о загрузке пака
    draftPack: null,      // черновик редактора пака
    currentRound: 0,
    played: [],           // ключи сыгранных вопросов "раунд:категория:вопрос"
    approx: {},           // { [индексРаунда]: true } — «можно отвечать приблизительно»
    question: null,       // открытый вопрос { r, c, q, secretPlayerId, answerShown }
    final: null,          // состояние финала
    room: null,           // онлайн-комната { code, online: [], status }
    buzzes: [],           // нажатия кнопки игроками [{ name, at }]
    setupMsg: null,       // { type: 'ok' | 'error', text } — сообщение экрана настройки
    undoStack: [],
  };
}

/* ---------- Хранилище ---------- */

let current = null;
const listeners = new Set();

export function initStore() {
  current = loadState() ?? defaultState();
}

export function getState() {
  return current;
}

/** Единственный способ менять состояние: update(state => { ... }) — сам сохраняет и перерисовывает.
 *  opts.rerender = false — сохранить без перерисовки (для ввода текста, чтобы не терять фокус). */
export function update(fn, opts = {}) {
  fn(current);
  saveState(current);
  if (opts.rerender !== false) {
    for (const listener of listeners) listener();
  }
}

export function subscribe(fn) {
  listeners.add(fn);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage может быть недоступен — игра всё равно работает до перезагрузки */
  }
}

export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* ---------- Отмена действий ---------- */

const UNDO_FIELDS = ['players', 'played', 'approx', 'currentRound', 'question', 'final'];

/** Вызывать ПЕРЕД мутацией, которую можно отменить. */
export function pushUndo(state) {
  const snap = {};
  for (const field of UNDO_FIELDS) snap[field] = structuredClone(state[field]);
  state.undoStack.push(snap);
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
}

export function undo(state) {
  const snap = state.undoStack.pop();
  if (!snap) return false;
  for (const field of UNDO_FIELDS) state[field] = snap[field];
  return true;
}
