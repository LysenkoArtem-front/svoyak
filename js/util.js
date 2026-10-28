/* Мелкие общие помощники. */

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/** Числовой счёт с минусом, для табло: −120 вместо -120. */
export function fmtScore(n) {
  return n < 0 ? '−' + Math.abs(n) : String(n);
}

/** Изменение со знаком для кнопок: +300 / −300. */
export function fmtDelta(n) {
  return n < 0 ? '−' + Math.abs(n) : '+' + n;
}
