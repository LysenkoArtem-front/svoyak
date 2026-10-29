/* Раунды 1–3: сетка категорий и вопросов, экран вопроса. */

import { getState, update, pushUndo } from './state.js';
import { esc, fmtScore, fmtDelta } from './util.js';
import { initFinal } from './final.js';

export function questionKey(r, c, q) {
  return `${r}:${c}:${q}`;
}

/** Изменение счёта за ответ: верно → +номинал, неверно → −номинал (с учётом «+ на −»). */
export function questionDelta(q, correct) {
  const sign = correct ? 1 : -1;
  return q.modifier === 'invert' ? -sign * q.value : sign * q.value;
}

export function renderBoard(root, state) {
  const r = state.currentRound;
  const round = state.pack.rounds[r];
  if (!round) {
    root.innerHTML = '<div class="card"><p class="msg msg-error">В паке нет такого раунда.</p></div>';
    return;
  }

  const roundsTotal = state.pack.rounds.length;
  const isLastRound = r >= roundsTotal - 1;

  const cellKey = (ci, qi) => questionKey(r, ci, qi);
  const total = round.categories.reduce((n, c) => n + c.questions.length, 0);
  const playedInRound = round.categories.reduce(
    (n, c, ci) => n + c.questions.filter((_, qi) => state.played.includes(cellKey(ci, qi))).length,
    0,
  );

  const badges = (q) => [
    q.modifier === 'invert' ? '<span class="badge" title="Модификатор: + на −">±</span>' : '',
    q.modifier === 'approx' ? '<span class="badge" title="Можно отвечать приблизительно">≈</span>' : '',
    q.modifier === 'ask' ? '<span class="badge" title="Попросить баллы у ведущего">🙋</span>' : '',
    q.secret ? '<span class="badge badge-secret" title="Секретный вопрос">🔒</span>' : '',
  ].join('');

  const columnHtml = (cat, ci) => {
    const sorted = cat.questions.map((q, qi) => ({ q, qi })).sort((a, b) => a.q.value - b.q.value);
    return `
      <div class="board-col">
        <div class="board-cat">${esc(cat.name)}</div>
        ${sorted.map(({ q, qi }) => {
          const played = state.played.includes(cellKey(ci, qi));
          return `
            <button class="board-cell ${played ? 'played' : ''}" type="button"
              data-cell="${ci}:${qi}" ${played ? 'disabled' : ''}>
              <span class="cell-value">${q.value}</span>
              <span class="cell-badges">${badges(q)}</span>
            </button>`;
        }).join('')}
      </div>`;
  };

  root.innerHTML = `
    <div class="card">
      <div class="board-head">
        <h2>Раунд ${r + 1} из ${roundsTotal}</h2>
        <div class="board-tools">
          ${state.approx[r] ? '<span class="badge-round" title="Модификатор раунда">≈ в этом раунде можно отвечать приблизительно</span>' : ''}
          <span class="muted">Сыграно: ${playedInRound} из ${total}</span>
          <button id="btn-next-round" class="btn btn-primary" type="button">
            ${isLastRound ? 'Перейти в финал →' : 'Следующий раунд →'}
          </button>
        </div>
      </div>
      <div class="board-grid" style="--cols: ${round.categories.length}">
        ${round.categories.map(columnHtml).join('')}
      </div>
    </div>`;

  root.querySelectorAll('.board-cell:not(.played)').forEach((btn) => {
    btn.onclick = () => {
      const [ci, qi] = btn.dataset.cell.split(':').map(Number);
      update((s) => {
        const q = s.pack.rounds[s.currentRound].categories[ci].questions[qi];
        s.question = { r: s.currentRound, c: ci, q: qi, secretPlayerId: null, answerShown: false };
        // Модификатор «приблизительно» действует до конца раунда с момента раскрытия вопроса.
        if (q.modifier === 'approx') s.approx[s.currentRound] = true;
        s.buzzes = []; // новая гонка — новая очередь нажатий
        s.screen = 'question';
      });
    };
  });

  root.querySelector('#btn-next-round').onclick = () => {
    const remaining = total - playedInRound;
    if (remaining > 0 && !confirm(`В раунде остались несыгранные вопросы: ${remaining}. Продолжить?`)) return;
    update((s) => {
      if (isLastRound) {
        initFinal(s);
      } else {
        s.currentRound += 1;
      }
    });
  };
}

/* ---------- Очередь нажатий из онлайн-комнаты ---------- */

function agoLabel(at) {
  const ms = Date.now() - at;
  if (ms < 60000) return ms < 1000 ? `${(ms / 1000).toFixed(1)} с` : `${Math.round(ms / 1000)} с`;
  return '>1 мин';
}

function renderBuzzList(buzzes) {
  if (!buzzes?.length) return '';
  const items = buzzes
    .map((b, i) => `
      <span class="buzz-item ${i === 0 ? 'buzz-first' : ''}">
        <span class="buzz-num">${i + 1}</span> ${esc(b.name)}
        <span class="buzz-ago" data-at="${b.at}">${agoLabel(b.at)}</span>
      </span>`)
    .join('');
  return `
    <div class="buzz-list">
      <span class="buzz-title">Нажали кнопку:</span>
      ${items}
    </div>`;
}

// Тикер обновляет «сколько секунд назад» без полной перерисовки экрана.
setInterval(() => {
  const state = getState();
  if (state.screen !== 'question' || !state.buzzes?.length) return;
  document.querySelectorAll('.buzz-ago').forEach((el) => {
    el.textContent = agoLabel(Number(el.dataset.at));
  });
}, 500);

/* ---------- Экран вопроса ---------- */

export function renderQuestion(root, state) {
  const info = state.question;
  const q = state.pack.rounds[info.r].categories[info.c].questions[info.q];
  const category = state.pack.rounds[info.r].categories[info.c];

  const correctDelta = questionDelta(q, true);
  const wrongDelta = questionDelta(q, false);
  const isAsk = q.modifier === 'ask';
  const isSecret = q.secret;
  const picked = isSecret ? state.players.find((p) => p.id === info.secretPlayerId) ?? null : null;
  const needPick = isSecret && !picked;

  /* Плашки с активными модификаторами */
  const notices = [];
  if (q.modifier === 'invert') notices.push('Модификатор «+ на −»: верный ответ снимает баллы, неверный — приносит.');
  if (q.modifier === 'approx') notices.push('До конца раунда можно отвечать приблизительно.');
  if (isAsk) notices.push('Можно попросить у ведущего любое количество баллов — назначьте сумму сами.');
  if (isSecret) notices.push(picked ? `Секретный вопрос — отвечает только ${picked.name}.` : 'Секретный вопрос — выберите, кому он достаётся.');

  const who = isSecret && picked ? [picked] : state.players;
  const buzzHtml = renderBuzzList(state.buzzes);

  const standardRows = who.map((p) => `
    <div class="award-row">
      <span class="award-name">${esc(p.name)} <span class="award-score">${fmtScore(p.score)}</span></span>
      <span class="award-btns">
        <button class="btn btn-good" type="button" data-award="correct:${p.id}">Верно ${fmtDelta(correctDelta)}</button>
        <button class="btn btn-danger" type="button" data-award="wrong:${p.id}">Неверно ${fmtDelta(wrongDelta)}</button>
      </span>
    </div>`).join('');

  const askRows = who.map((p) => `
    <div class="award-row ask-row" data-ask="${p.id}">
      <span class="award-name">${esc(p.name)} <span class="award-score">${fmtScore(p.score)}</span></span>
      <span class="award-btns">
        <input class="ask-amount" type="number" step="1" placeholder="Например: 500 или −200" aria-label="Сумма для ${esc(p.name)}">
        <button class="btn btn-primary ask-apply" type="button" disabled>Начислить</button>
      </span>
    </div>`).join('');

  root.innerHTML = `
    <div class="card">
      <div class="board-head">
        <h2>«${esc(category.name)}» · ${q.value} ${q.value === 1 ? 'балл' : 'баллов'}</h2>
        <button id="btn-close-question" class="btn btn-ghost" type="button">Закрыть без начисления</button>
      </div>

      ${notices.map((text) => `<p class="notice">${esc(text)}</p>`).join('')}

      <div class="q-text">${q.text ? esc(q.text) : '<span class="muted">Текст вопроса не задан — озвучьте свой.</span>'}</div>

      ${buzzHtml}

      <div class="answer-zone">
        <button id="btn-toggle-answer" class="btn" type="button">${info.answerShown ? 'Скрыть ответ' : 'Показать ответ'}</button>
        ${info.answerShown ? `<div class="answer-text">${q.answer ? esc(q.answer) : '<span class="muted">Ответ в паке не задан.</span>'}</div>` : ''}
      </div>

      ${needPick ? `
        <h3>Кому отдаётся вопрос?</h3>
        <div class="pick-grid">
          ${state.players.map((p) => `
            <button class="btn pick-player" type="button" data-pick="${p.id}">
              ${esc(p.name)} <span class="award-score">${fmtScore(p.score)}</span>
            </button>`).join('')}
        </div>`
      : `
        <h3>${isAsk ? 'Сколько начислить?' : 'Кто отвечал?'}</h3>
        <div class="award-rows">${isAsk ? askRows : standardRows}</div>
        ${isSecret && picked ? '<button id="btn-repick" class="btn btn-ghost" type="button">Сменить игрока</button>' : ''}`}
    </div>`;

  root.querySelector('#btn-toggle-answer').onclick = () => {
    update((s) => { s.question.answerShown = !s.question.answerShown; });
  };

  root.querySelector('#btn-close-question').onclick = () => {
    update((s) => {
      pushUndo(s);
      s.played.push(questionKey(s.question.r, s.question.c, s.question.q));
      s.question = null;
      s.screen = 'board';
    });
  };

  /* Секретный вопрос: выбор игрока */
  root.querySelectorAll('[data-pick]').forEach((btn) => {
    btn.onclick = () => update((s) => { s.question.secretPlayerId = btn.dataset.pick; });
  });

  const repick = root.querySelector('#btn-repick');
  if (repick) repick.onclick = () => update((s) => { s.question.secretPlayerId = null; });

  /* Обычные вопросы: верно / неверно */
  root.querySelectorAll('[data-award]').forEach((btn) => {
    btn.onclick = () => {
      const [result, playerId] = btn.dataset.award.split(':');
      update((s) => {
        pushUndo(s);
        const question = s.pack.rounds[s.question.r].categories[s.question.c].questions[s.question.q];
        const player = s.players.find((p) => p.id === playerId);
        player.score += questionDelta(question, result === 'correct');
        s.played.push(questionKey(s.question.r, s.question.c, s.question.q));
        s.question = null;
        s.screen = 'board';
      });
    };
  });

  /* «Попросить баллы»: произвольная сумма выбранному игроку */
  root.querySelectorAll('.ask-row').forEach((row) => {
    const input = row.querySelector('.ask-amount');
    const applyBtn = row.querySelector('.ask-apply');
    const sync = () => {
      applyBtn.disabled = input.value.trim() === '' || !Number.isFinite(Number(input.value));
    };
    input.oninput = sync;
    applyBtn.onclick = () => {
      const amount = Math.round(Number(input.value));
      if (!Number.isFinite(amount)) return;
      update((s) => {
        pushUndo(s);
        s.players.find((p) => p.id === row.dataset.ask).score += amount;
        s.played.push(questionKey(s.question.r, s.question.c, s.question.q));
        s.question = null;
        s.screen = 'board';
      });
    };
  });
}
