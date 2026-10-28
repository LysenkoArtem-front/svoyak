/* Финал (раунд 4): выбывание тем → закрытые ставки → вопрос → ответы → раскрытие. */

import { getState, update, pushUndo } from './state.js';
import { esc, fmtScore, fmtDelta } from './util.js';

let finalMsg = null; // подсказки/ошибки внутри финала

/** Показывает сообщение в шапке финала, не пересобирая экран (ввод не теряется). */
function showMsg(root, text) {
  finalMsg = text;
  const head = root.querySelector('.board-head');
  let el = root.querySelector('.board-head .msg');
  if (!el) {
    el = document.createElement('span');
    el.className = 'msg msg-error';
    el.style.margin = '0';
    head.appendChild(el);
  }
  el.textContent = text;
}

function clearMsg() {
  finalMsg = null;
}

export function initFinal(s) {
  s.final = {
    phase: 'elimination',           // elimination | bets | question | answers | reveal
    topics: s.pack.final.topics.map((t) => ({ ...t, eliminated: false })),
    order: s.players.map((p) => p.id),
    started: false,                 // выбран ли игрок, начинающий выбывание
    turn: 0,                        // чей ход выбывания (индекс в order)
    betIndex: 0,                    // чья ставка вводится
    answerIndex: 0,                 // чей ответ вводится
    answerShown: false,
    bets: {},                       // { playerId: { value, allIn } }
    answers: {},                    // { playerId: { text, correct: true|false|null } }
    applied: false,
  };
  s.screen = 'final';
}

export function renderFinal(root, state) {
  if (!state.final) {
    update((s) => initFinal(s));
    return;
  }

  const view = {
    elimination: renderElimination,
    bets: renderBets,
    question: renderFinalQuestion,
    answers: renderAnswers,
    reveal: renderReveal,
  }[state.final.phase] ?? renderElimination;

  view(root, state);
}

/* ---------- Общий каркас экрана финала ---------- */

function frame(inner) {
  return `<div class="card">
    <div class="board-head">
      <h2>Финал</h2>
      ${finalMsg ? `<span class="msg msg-error" style="margin:0">${esc(finalMsg)}</span>` : ''}
    </div>
    ${inner}
  </div>`;
}

function playerName(state, id) {
  return state.players.find((p) => p.id === id)?.name ?? '?';
}

function remainingTopics(state) {
  return state.final.topics.filter((t) => !t.eliminated);
}

/* ---------- Шаг 1: выбывание тем по кругу ---------- */

function renderElimination(root, state) {
  const f = state.final;

  if (!f.started) {
    root.innerHTML = frame(`
      <p class="subtitle">Осталась одна тема — по ней будет вопрос финала. Темы убираются по кругу.</p>
      <h3>Кто начинает выбывание?</h3>
      <div class="pick-grid">
        ${state.players.map((p) => `
          <button class="btn pick-player" type="button" data-starter="${p.id}">
            ${esc(p.name)} <span class="award-score">${fmtScore(p.score)}</span>
          </button>`).join('')}
      </div>`);
    root.querySelectorAll('[data-starter]').forEach((btn) => {
      btn.onclick = () => update((s) => {
        pushUndo(s);
        const i = s.final.order.indexOf(btn.dataset.starter);
        s.final.order = [...s.final.order.slice(i), ...s.final.order.slice(0, i)];
        s.final.started = true;
        s.final.turn = 0;
      });
    });
    return;
  }

  const rest = remainingTopics(state);
  const whose = playerName(state, f.order[f.turn]);

  root.innerHTML = frame(`
    <p class="subtitle">Игроки по кругу убирают темы, в которые не хотят играть. Ход: <b>${esc(whose)}</b>.</p>
    <div class="topic-chips">
      ${f.topics.map((t, ti) => `
        <button class="btn topic-chip ${t.eliminated ? 'eliminated' : ''}" type="button"
          data-topic="${ti}" ${t.eliminated || rest.length === 1 ? 'disabled' : ''}>
          ${esc(t.name)}
        </button>`).join('')}
    </div>
    ${rest.length === 1 ? `
      <p class="notice">Осталась тема «${esc(rest[0].name)}» — по ней будет вопрос финала.</p>
      <button id="btn-to-bets" class="btn btn-primary" type="button">К ставкам →</button>` : ''}`);

  root.querySelectorAll('.topic-chip:not(.eliminated):not([disabled])').forEach((btn) => {
    btn.onclick = () => update((s) => {
      pushUndo(s);
      s.final.topics[Number(btn.dataset.topic)].eliminated = true;
      s.final.turn = (s.final.turn + 1) % s.final.order.length;
    });
  });

  const toBets = root.querySelector('#btn-to-bets');
  if (toBets) {
    toBets.onclick = () => update((s) => {
      s.final.phase = 'bets';
      s.final.betIndex = 0;
    });
  }
}

/* ---------- Шаг 2: закрытые ставки ---------- */

function renderBets(root, state) {
  const f = state.final;
  const pid = f.order[f.betIndex];
  const player = state.players.find((p) => p.id === pid);
  const cap = Math.max(player.score, 0);

  root.innerHTML = frame(`
    <p class="subtitle">Ставки в закрытую: от 1 до all-in. Вводите так, чтобы игроки не видели экран.
      Ставка ${f.betIndex + 1} из ${f.order.length}.</p>
    <div class="award-row">
      <span class="award-name">${esc(player.name)} <span class="award-score">${fmtScore(player.score)}</span></span>
      <span class="award-btns">
        <input id="bet-input" type="password" inputmode="numeric" class="masked-input"
          placeholder="Ставка ${player.score >= 1 ? `(1…${player.score})` : '(цена хода)'}" autocomplete="off">
        <button id="btn-all-in" class="btn" type="button" ${player.score >= 1 ? '' : 'disabled'}
          title="Поставить весь счёт">All in</button>
        <button id="btn-bet-confirm" class="btn btn-primary" type="button" disabled>Подтвердить</button>
      </span>
    </div>
    ${player.score < 1 ? `<p class="muted">Счёт игрока ${player.score >= 0 ? 'нулевой' : 'отрицательный'} — all-in недоступен, минимальная ставка 1.</p>` : ''}`);

  const input = root.querySelector('#bet-input');
  const confirmBtn = root.querySelector('#btn-bet-confirm');
  const allInBtn = root.querySelector('#btn-all-in');

  const sync = () => {
    confirmBtn.disabled = input.value.trim() === '' || !Number.isFinite(Number(input.value));
  };
  input.oninput = sync;
  input.focus();

  allInBtn.onclick = () => {
    input.value = String(player.score);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  confirmBtn.onclick = () => {
    const value = Math.round(Number(input.value));
    if (!Number.isFinite(value) || value < 1) {
      showMsg(root, 'Ставка должна быть целым числом не меньше 1.');
      return;
    }
    if (player.score >= 1 && value > player.score) {
      showMsg(root, `Максимум ${player.score} — это all in.`);
      return;
    }
    clearMsg();
    update((s) => {
      pushUndo(s);
      s.final.bets[pid] = { value, allIn: player.score >= 1 && value === player.score };
      s.final.betIndex += 1;
      if (s.final.betIndex >= s.final.order.length) s.final.phase = 'question';
    });
  };
}

/* ---------- Шаг 3: вопрос финала ---------- */

function renderFinalQuestion(root, state) {
  const f = state.final;
  const topic = remainingTopics(state)[0];
  const q = topic.question;

  root.innerHTML = frame(`
    <p class="notice">Тема финала: <b>${esc(topic.name)}</b></p>
    <div class="q-text">${q.text ? esc(q.text) : '<span class="muted">Текст вопроса не задан — озвучьте свой.</span>'}</div>
    <div class="answer-zone">
      <button id="btn-toggle-answer" class="btn" type="button">${f.answerShown ? 'Скрыть ответ' : 'Показать ответ'}</button>
      ${f.answerShown ? `<div class="answer-text">${q.answer ? esc(q.answer) : '<span class="muted">Ответ в паке не задан.</span>'}</div>` : ''}
    </div>
    <button id="btn-to-answers" class="btn btn-primary" type="button">Игроки ответили — к вводу ответов →</button>`);

  root.querySelector('#btn-toggle-answer').onclick = () => {
    update((s) => { s.final.answerShown = !s.final.answerShown; });
  };
  root.querySelector('#btn-to-answers').onclick = () => update((s) => {
    s.final.phase = 'answers';
    s.final.answerIndex = 0;
  });
}

/* ---------- Шаг 4: закрытые ответы ---------- */

function renderAnswers(root, state) {
  const f = state.final;
  const pid = f.order[f.answerIndex];
  const player = state.players.find((p) => p.id === pid);

  root.innerHTML = frame(`
    <p class="subtitle">Ответы в закрытую — вводите, что написали игроки. Экран им не показывайте.
      Ответ ${f.answerIndex + 1} из ${f.order.length}.</p>
    <div class="award-row">
      <span class="award-name">${esc(player.name)}</span>
      <span class="award-btns">
        <input id="answer-input" type="password" class="masked-input" placeholder="Ответ игрока (скрыт)" autocomplete="off">
        <button id="btn-answer-confirm" class="btn btn-primary" type="button">Подтвердить</button>
      </span>
    </div>`);

  const input = root.querySelector('#answer-input');
  input.focus();
  const confirm = () => {
    update((s) => {
      pushUndo(s);
      s.final.answers[pid] = { text: input.value, correct: null };
      s.final.answerIndex += 1;
      if (s.final.answerIndex >= s.final.order.length) s.final.phase = 'reveal';
    });
  };
  root.querySelector('#btn-answer-confirm').onclick = confirm;
  input.onkeydown = (e) => { if (e.key === 'Enter') confirm(); };
}

/* ---------- Шаг 5: раскрытие и подсчёт ---------- */

function renderReveal(root, state) {
  const f = state.final;
  const topic = remainingTopics(state)[0];
  const allMarked = f.order.every((pid) => f.answers[pid]?.correct !== null && f.answers[pid]?.correct !== undefined);

  root.innerHTML = frame(`
    <p class="notice">Тема финала: <b>${esc(topic.name)}</b></p>
    <div class="q-text">${topic.question.text ? esc(topic.question.text) : ''}</div>
    ${topic.question.answer ? `<div class="answer-text">${esc(topic.question.answer)}</div>` : ''}

    <h3>Ставки и ответы</h3>
    ${f.order.map((pid) => {
      const player = state.players.find((p) => p.id === pid);
      const bet = f.bets[pid];
      const answer = f.answers[pid];
      return `
        <div class="award-row">
          <span class="award-name">
            ${esc(player.name)}
            <span class="award-score">ставка ${bet ? bet.value : '—'}${bet?.allIn ? ' (all in)' : ''}</span>
          </span>
          <span class="reveal-answer">${answer?.text ? esc(answer.text) : '<span class="muted">—</span>'}</span>
          <span class="award-btns">
            <button class="btn btn-good ${answer?.correct === true ? 'chosen' : ''}" type="button" data-mark="true:${pid}">Верно ${bet ? fmtDelta(bet.value) : ''}</button>
            <button class="btn btn-danger ${answer?.correct === false ? 'chosen' : ''}" type="button" data-mark="false:${pid}">Неверно ${bet ? fmtDelta(-bet.value) : ''}</button>
          </span>
        </div>`;
    }).join('')}

    <button id="btn-apply" class="btn btn-primary btn-big" type="button" ${allMarked ? '' : 'disabled'}>
      Подвести итоги →
    </button>`);

  root.querySelectorAll('[data-mark]').forEach((btn) => {
    btn.onclick = () => {
      const [mark, pid] = btn.dataset.mark.split(':');
      update((s) => {
        pushUndo(s);
        s.final.answers[pid].correct = mark === 'true';
      });
    };
  });

  root.querySelector('#btn-apply').onclick = () => {
    update((s) => {
      pushUndo(s);
      for (const pid of s.final.order) {
        const bet = s.final.bets[pid];
        const answer = s.final.answers[pid];
        s.players.find((p) => p.id === pid).score += answer.correct ? bet.value : -bet.value;
      }
      s.final.applied = true;
      s.screen = 'results';
    });
  };
}
