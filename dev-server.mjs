/*
 * Локальный сервер разработки: раздаёт статику без кэширования,
 * чтобы изменения в файлах сразу попадали в браузер.
 * Запуск: node dev-server.mjs [порт]  (по умолчанию 8437)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const port = Number(process.argv[2]) || 8437;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root)) throw new Error('forbidden');
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
  }
}).listen(port, () => {
  console.log(`Свояк (dev): http://127.0.0.1:${port}`);
});
