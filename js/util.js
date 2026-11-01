/* Мелкие общие помощники. */

const NUMBER_FORMAT = new Intl.NumberFormat('ru-RU');

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/** Числовой счёт с разделением тысяч: 10 000 000 100; минус — типографский. */
export function fmtScore(n) {
  return n < 0 ? '−' + NUMBER_FORMAT.format(Math.abs(n)) : NUMBER_FORMAT.format(n);
}

/** Изменение со знаком для кнопок: +300 / −300. */
export function fmtDelta(n) {
  return n < 0 ? '−' + NUMBER_FORMAT.format(Math.abs(n)) : '+' + NUMBER_FORMAT.format(n);
}
