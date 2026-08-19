// Где стоит комната.
//
// Замер до этой работы: клиент ходил только к тому хосту, который отдал
// страницу, — `fetch('/auth/nonce')` относительным путём и
// `new WebSocket(location.host)`. Живая ссылка живёт на GitHub Pages, а это
// статика: вебсокетов она не отдаёт и не будет. То есть общий мир для
// настоящего игрока не существовал по устройству — не потому, что сервера нет,
// а потому, что до него нечем было дотянуться.
//
// Здесь один источник правды об адресе, и три способа его назвать, по
// убыванию силы:
//
//   1. `?server=https://room.example` в ссылке — для проверок и для того, чтобы
//      посмотреть чужую комнату, не пересобирая страницу;
//   2. `<meta name="veloria-server" content="https://room.example">` в
//      index.html — так адрес задаётся при публикации;
//   3. свой же хост — привычное поведение, когда игру отдаёт сам сервер игры.
//
// Довод из ссылки проверяется как чужой ввод: `javascript:` и прочее в адрес не
// пускаем, иначе ссылкой можно увести игрока в подставную комнату.

/** Только настоящий сетевой адрес. Всё остальное — не адрес. */
function годныйАдрес(v) {
  if (!v || typeof v !== 'string') return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // Отбрасываем путь, запрос и хвост: комната — это origin, а не страница.
  return u.origin;
}

/**
 * Адрес комнаты.
 *
 * @param {{origin: string, search: string, meta: (string|null)}} [где] — откуда
 *   читать. Довод нужен стендам: они запускаются без браузера, а правило
 *   выбора адреса — такое же правило, как всё остальное, и проверять его надо
 *   без оговорок «в браузере будет иначе».
 */
export function serverBase(где) {
  const и = где || (typeof location !== 'undefined' ? {
    origin: location.origin,
    search: location.search,
    meta: (typeof document !== 'undefined' && document.querySelector('meta[name="veloria-server"]'))
      ? document.querySelector('meta[name="veloria-server"]').getAttribute('content') : null,
  } : { origin: '', search: '', meta: null });

  let изСсылки = null;
  try { изСсылки = new URLSearchParams(и.search || '').get('server'); } catch { /* мусор в строке */ }
  return годныйАдрес(изСсылки) || годныйАдрес(и.meta) || и.origin || '';
}

/** Адрес сокета комнаты: та же схема, что у страницы, но ws вместо http. */
export function serverWsUrl(база) {
  const b = база || serverBase();
  return b.replace(/^http/, 'ws').replace(/\/+$/, '') + '/';
}

/** Полный адрес запроса к комнате. */
export function apiUrl(path, база) {
  const b = (база || serverBase()).replace(/\/+$/, '');
  return b + (path.startsWith('/') ? path : '/' + path);
}

/**
 * Своя ли это комната.
 *
 * Нужно затем, что кое-что клиент делает только у себя дома: например,
 * сохраняет одиночную игру на сервер. Чужой комнате наш слепок не нужен.
 */
export function своя(база) {
  if (typeof location === 'undefined') return true;
  return (база || serverBase()) === location.origin;
}
