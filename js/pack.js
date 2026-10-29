/* Пак вопросов: формат, нормализация, валидация, экспорт, встроенный редактор. */

import { getState, update } from './state.js';
import { esc } from './util.js';

export const MODIFIER_LABELS = {
  none: '',
  invert: '+ на −',
  approx: 'можно отвечать приблизительно',
  ask: 'попросите у ведущего баллы',
};

const MODIFIERS = Object.keys(MODIFIER_LABELS);

export function emptyQuestion(value = 100) {
  return { value, text: '', answer: '', image: '', modifier: 'none', secret: false };
}

export function emptyCategory() {
  return { name: '', questions: [emptyQuestion()] };
}

export function emptyRound() {
  return { categories: [emptyCategory()] };
}

export function emptyPack() {
  return {
    rounds: [emptyRound(), emptyRound(), emptyRound()],
    final: {
      topics: [
        { name: '', question: { text: '', answer: '' } },
        { name: '', question: { text: '', answer: '' } },
      ],
    },
  };
}

/* ---------- Нормализация: приводит любой сырой JSON к строгой форме ---------- */

function normQuestion(q) {
  const value = Math.round(Number(q?.value));
  return {
    value: Number.isFinite(value) && value > 0 ? value : 100,
    text: String(q?.text ?? ''),
    answer: String(q?.answer ?? ''),
    image: String(q?.image ?? '').trim(),
    modifier: MODIFIERS.includes(q?.modifier) ? q.modifier : 'none',
    secret: Boolean(q?.secret),
  };
}

function normCategory(c) {
  return {
    name: String(c?.name ?? '').trim(),
    questions: (Array.isArray(c?.questions) ? c.questions : []).map(normQuestion),
  };
}

function normRound(r) {
  return { categories: (Array.isArray(r?.categories) ? r.categories : []).map(normCategory) };
}

// Тему финала можно задать и просто строкой — тогда вопрос впишут позже.
function normTopic(t) {
  if (typeof t === 'string') {
    return { name: t.trim(), question: { text: '', answer: '', image: '' } };
  }
  return {
    name: String(t?.name ?? '').trim(),
    question: {
      text: String(t?.question?.text ?? ''),
      answer: String(t?.question?.answer ?? ''),
      image: String(t?.question?.image ?? '').trim(),
    },
  };
}

export function normalizePack(raw) {
  return {
    rounds: (Array.isArray(raw?.rounds) ? raw.rounds : []).map(normRound),
    final: {
      topics: (Array.isArray(raw?.final?.topics) ? raw.final.topics : []).map(normTopic),
    },
  };
}

/* ---------- Валидация: список ошибок (пустой = пак годен) ---------- */

export function validatePack(pack) {
  const errors = [];

  if (!pack.rounds.length) errors.push('в паке нет ни одного раунда');

  pack.rounds.forEach((round, ri) => {
    const r = `раунд ${ri + 1}`;
    if (!round.categories.length) {
      errors.push(`${r}: нет категорий`);
      return;
    }
    round.categories.forEach((cat, ci) => {
      if (!cat.name) errors.push(`${r}, категория ${ci + 1}: пустое название`);
      if (!cat.questions.length) {
        errors.push(`${r}, «${cat.name || `категория ${ci + 1}`}»: нет вопросов`);
        return;
      }
      cat.questions.forEach((q, qi) => {
        if (!(q.value > 0)) errors.push(`${r}, «${cat.name}», вопрос ${qi + 1}: некорректный номинал`);
      });
    });
  });

  if (pack.final.topics.length < 2) errors.push('в финале должно быть минимум 2 темы');
  pack.final.topics.forEach((t, ti) => {
    if (!t.name) errors.push(`финал, тема ${ti + 1}: пустое название`);
  });

  return errors;
}

/** Проверяет сырой JSON и возвращает { ok, pack } или { ok: false, errors }. */
export function loadPackFromObject(raw) {
  const pack = normalizePack(raw);
  const errors = validatePack(pack);
  return errors.length ? { ok: false, errors } : { ok: true, pack };
}

/** Краткая сводка для интерфейса: «Раундов: 3 · Категорий: 12 · Вопросов: 36 · Темы финала: 4». */
export function packSummary(pack) {
  const categories = pack.rounds.reduce((n, r) => n + r.categories.length, 0);
  const questions = pack.rounds.reduce(
    (n, r) => n + r.categories.reduce((m, c) => m + c.questions.length, 0),
    0,
  );
  return `Раундов: ${pack.rounds.length} · Категорий: ${categories} · Вопросов: ${questions} · Темы финала: ${pack.final.topics.length}`;
}

/** Скачивает пак как JSON-файл. */
export function exportPack(pack, filename = 'svoyak-pack.json') {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Файл → уменьшенный data-URL (JPEG до 640px) — чтобы пак не раздувался. */
export function fileToDataUrl(file, maxSize = 640, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('файл не является картинкой'));
    };
    img.src = url;
  });
}

/* ---------- Встроенный редактор пака ---------- */

const EDITOR_MODIFIER_LABELS = {
  none: 'Без модификатора',
  invert: '+ на −',
  approx: 'Приблизительно',
  ask: 'Попросить баллы',
};

let editorRound = 0;   // активная вкладка раунда
let editorMsg = null;  // { type, text } — сообщение редактора

export function renderEditor(root) {
  if (!getState().draftPack) {
    update((s) => { s.draftPack = s.pack ? structuredClone(s.pack) : emptyPack(); }, { rerender: false });
  }
  const draft = getState().draftPack;
  editorRound = Math.min(editorRound, Math.max(draft.rounds.length - 1, 0));

  const modOptions = (selected) => Object.entries(EDITOR_MODIFIER_LABELS)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`)
    .join('');

  const questionHtml = (q, qi) => `
    <div class="q" data-q="${qi}">
      <div class="q-main">
        <input class="q-value" type="number" min="1" step="1" value="${esc(q.value)}" title="Номинал">
        <input class="q-text" placeholder="Вопрос" value="${esc(q.text)}">
        <input class="q-answer" placeholder="Ответ" value="${esc(q.answer)}">
        <select class="q-modifier" title="Модификатор">${modOptions(q.modifier)}</select>
        <label class="q-secret" title="Секретный вопрос — назначается конкретному игроку">
          <input type="checkbox" ${q.secret ? 'checked' : ''}> секрет
        </label>
        <button class="btn btn-ghost btn-danger q-del" type="button" title="Удалить вопрос">✕</button>
      </div>
      <div class="q-media">
        <input class="q-image" placeholder="Картинка к вопросу: URL, путь в проекте или через «📷 Файл»" value="${esc(q.image ?? '')}">
        <button class="btn btn-ghost q-upload" type="button" title="Загрузить картинку с устройства">📷 Файл</button>
      </div>
    </div>`;

  const categoryHtml = (cat, ci) => `
    <div class="cat" data-cat="${ci}">
      <div class="cat-head">
        <input class="cat-name" placeholder="Название категории ${ci + 1}" value="${esc(cat.name)}">
        <button class="btn btn-ghost btn-danger cat-del" type="button" title="Удалить категорию">✕</button>
      </div>
      ${cat.questions.map(questionHtml).join('')}
      <button class="btn btn-ghost q-add" type="button">+ Вопрос</button>
    </div>`;

  const round = draft.rounds[editorRound] ?? emptyRound();

  root.innerHTML = `
    <div class="card">
      <div class="editor-head">
        <h2>Редактор пака</h2>
        <div class="btn-row">
          <button id="ed-apply" class="btn btn-primary" type="button">Применить пак</button>
          <button id="ed-export" class="btn" type="button">Скачать JSON</button>
          <button id="ed-reset" class="btn" type="button">Очистить черновик</button>
          <button id="ed-exit" class="btn btn-ghost" type="button">← Вернуться</button>
        </div>
      </div>
      ${editorMsg ? `<p class="msg ${editorMsg.type === 'error' ? 'msg-error' : 'msg-ok'}">${esc(editorMsg.text)}</p>` : ''}
      <p class="muted">Раунды 1–3: категории и вопросы. У темы финала — свой вопрос: играет та, что останется.</p>

      <div class="tabs">
        ${draft.rounds.map((_, i) => `
          <button class="btn tab ${i === editorRound ? 'tab-active' : ''}" type="button" data-round-tab="${i}">
            Раунд ${i + 1}
          </button>`).join('')}
      </div>

      <div class="editor-round" data-round="${editorRound}">
        ${round.categories.map(categoryHtml).join('')}
        <button class="btn btn-ghost cat-add" type="button">+ Категория</button>
      </div>

      <h3>Финал</h3>
      ${draft.final.topics.map((t, ti) => `
        <div class="topic" data-topic="${ti}">
          <input class="t-name" placeholder="Тема ${ti + 1}" value="${esc(t.name)}">
          <input class="t-text" placeholder="Вопрос финала" value="${esc(t.question.text)}">
          <input class="t-answer" placeholder="Ответ" value="${esc(t.question.answer)}">
          <button class="btn btn-ghost btn-danger t-del" type="button" title="Удалить тему">✕</button>
          <input class="t-image" placeholder="Картинка к вопросу финала (необязательно)" value="${esc(t.question.image ?? '')}">
        </div>`).join('')}
      <button class="btn btn-ghost t-add" type="button">+ Тема</button>
    </div>`;

  bindEditor(root);
}

/** Собирает текущий черновик из полей на экране (активный раунд + финал). */
function readEditorDom(root) {
  const draft = structuredClone(getState().draftPack);
  const roundEl = root.querySelector('.editor-round');
  const ri = Number(roundEl.dataset.round);

  draft.rounds[ri] = {
    categories: [...roundEl.querySelectorAll('.cat')].map((catEl) => ({
      name: catEl.querySelector('.cat-name').value,
      questions: [...catEl.querySelectorAll('.q')].map((qEl) => ({
        value: Math.round(Number(qEl.querySelector('.q-value').value)) || 0,
        text: qEl.querySelector('.q-text').value,
        answer: qEl.querySelector('.q-answer').value,
        image: qEl.querySelector('.q-image').value.trim(),
        modifier: qEl.querySelector('.q-modifier').value,
        secret: qEl.querySelector('.q-secret input').checked,
      })),
    })),
  };

  draft.final.topics = [...root.querySelectorAll('.topic')].map((tEl) => ({
    name: tEl.querySelector('.t-name').value,
    question: {
      text: tEl.querySelector('.t-text').value,
      answer: tEl.querySelector('.t-answer').value,
      image: tEl.querySelector('.t-image').value.trim(),
    },
  }));

  return draft;
}

/** Перечитать поля → изменить черновик → перерисовать редактор. */
function rebuildEditor(root, mutate) {
  const draft = readEditorDom(root);
  mutate(draft);
  update((s) => { s.draftPack = draft; }, { rerender: false });
  renderEditor(root);
}

function bindEditor(root) {
  root.querySelectorAll('[data-round-tab]').forEach((btn) => {
    btn.onclick = () => {
      const draft = readEditorDom(root);
      update((s) => { s.draftPack = draft; }, { rerender: false });
      editorRound = Number(btn.dataset.roundTab);
      renderEditor(root);
    };
  });

  root.querySelector('.cat-add').onclick = () => rebuildEditor(root, (d) => {
    d.rounds[editorRound].categories.push(emptyCategory());
  });

  root.querySelectorAll('.cat-del').forEach((btn) => {
    btn.onclick = () => {
      const ci = Number(btn.closest('.cat').dataset.cat);
      rebuildEditor(root, (d) => { d.rounds[editorRound].categories.splice(ci, 1); });
    };
  });

  root.querySelectorAll('.q-add').forEach((btn) => {
    btn.onclick = () => {
      const ci = Number(btn.closest('.cat').dataset.cat);
      rebuildEditor(root, (d) => { d.rounds[editorRound].categories[ci].questions.push(emptyQuestion()); });
    };
  });

  root.querySelectorAll('.q-del').forEach((btn) => {
    btn.onclick = () => {
      const ci = Number(btn.closest('.cat').dataset.cat);
      const qi = Number(btn.closest('.q').dataset.q);
      rebuildEditor(root, (d) => { d.rounds[editorRound].categories[ci].questions.splice(qi, 1); });
    };
  });

  // Кнопка «📷 Файл»: картинка с устройства → уменьшенный data-URL в поле ссылки.
  root.querySelectorAll('.q-upload').forEach((btn) => {
    btn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        btn.textContent = 'обработка…';
        try {
          const dataUrl = await fileToDataUrl(file);
          btn.closest('.q').querySelector('.q-image').value = dataUrl;
        } catch (e) {
          alert(`Не удалось загрузить картинку: ${e.message}`);
        }
        btn.textContent = '📷 Файл';
      };
      input.click();
    };
  });

  root.querySelector('.t-add').onclick = () => rebuildEditor(root, (d) => {
    d.final.topics.push({ name: '', question: { text: '', answer: '' } });
  });

  root.querySelectorAll('.t-del').forEach((btn) => {
    btn.onclick = () => {
      const ti = Number(btn.closest('.topic').dataset.topic);
      rebuildEditor(root, (d) => { d.final.topics.splice(ti, 1); });
    };
  });

  root.querySelector('#ed-apply').onclick = () => {
    const draft = readEditorDom(root);
    const normalized = normalizePack(draft);
    const errors = validatePack(normalized);
    if (errors.length) {
      editorMsg = { type: 'error', text: `Пак не применён — ${errors.join('; ')}.` };
      update((s) => { s.draftPack = draft; }, { rerender: false });
      renderEditor(root);
      return;
    }
    editorMsg = null;
    update((s) => {
      s.pack = normalized;
      s.packStatus = { type: 'ok', text: 'Пак применён из редактора.' };
      s.draftPack = null;
      s.screen = 'setup';
    });
  };

  root.querySelector('#ed-export').onclick = () => exportPack(readEditorDom(root));

  root.querySelector('#ed-reset').onclick = () => {
    editorMsg = null;
    editorRound = 0;
    update((s) => { s.draftPack = emptyPack(); }, { rerender: false });
    renderEditor(root);
  };

  root.querySelector('#ed-exit').onclick = () => {
    const draft = readEditorDom(root);
    editorMsg = null;
    update((s) => {
      s.draftPack = draft;
      s.screen = 'setup';
    });
  };
}
