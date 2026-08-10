// Задания общего мира: их ведёт комната.
//
// Замер до этой работы: клиент честно засчитывал ход и выдавал награду —
// 60 золота превращались в 120, опыт с нуля в семьдесят, — а через три кадра
// сверка с миром возвращала 40 и ноль. Задание помечено сданным, а не получено
// ничего. Иначе и быть не могло: считает-то теперь комната.
//
// Второго журнала здесь нет. Это тот же класс `Quests`, которым играет
// одиночная игра, — он ничего не знает про экран и обходится заглушкой вместо
// `game`. Комната добавляет то же, что и везде: **проверку**. Клиент говорит
// «беру» и «сдаю», а можно ли — решает сервер.

import { Quests } from '../src/systems/quests.js';

/**
 * «Игра» для журнала — это сама комната.
 *
 * Соблазн написать здесь заглушку с нужными методами велик и уже однажды
 * подвёл: моя первая версия дала `toast` и `spawnLoot`, а награда за задание
 * даёт опыт — и `gainXp` позвал `onLevelUp`, которого в заглушке не было.
 * Ровно тот класс дыр, за которым следит `room-surface-check`.
 *
 * Поэтому копии нет: берём настоящую комнату и подменяем в ней только двоих —
 * `player` (журнал работает с тем, кто сдаёт) и `toast` (смотреть на сервере
 * некому, копим строки для ответа). Всё остальное — `onLevelUp`, `proc`,
 * `spawnLoot` — берётся у комнаты, значит не разойдётся с ней никогда.
 */
function какИгра(world, ent, вести) {
  const g = Object.create(world);
  g.player = ent;
  g.toast = (текст) => вести.push(String(текст));
  return g;
}

export class QuestBook {
  /** @param {object} world — комната: журнал разговаривает с ней, а не с копией */
  constructor(world) {
    this.world = world;
    this.books = new Map();     // pid → { q: Quests, dirty: boolean }
  }

  /** Журнал игрока: восстановленный из сохранения или новый. */
  для(p, слепок) {
    let b = this.books.get(p.pid);
    if (!b) {
      const q = new Quests();
      if (слепок) { try { q.fromJSON(слепок); } catch { /* битый журнал — начнём заново */ } }
      q.refresh(p);
      b = { q, dirty: true };
      this.books.set(p.pid, b);
    }
    return b;
  }

  забыть(pid) { this.books.delete(pid); }

  /**
   * Отметить событие в журнале игрока.
   *
   * Зовут это оттуда же, откуда одиночная игра зовёт свои крючки: из убийства,
   * ковки, реакции и перехода. Разница одна — здесь событие настоящее, потому
   * что его насчитала комната.
   */
  событие(p, как, ...args) {
    const b = this.books.get(p.pid);
    if (!b || typeof b.q[как] !== 'function') return [];
    const вести = [];
    const было = JSON.stringify(b.q.toJSON());
    b.q[как](...args, какИгра(this.world, p, вести));
    if (JSON.stringify(b.q.toJSON()) !== было) b.dirty = true;
    return вести;
  }

  /** Сбор считается по рюкзаку, а рюкзак теперь мира. */
  сверитьСбор(p) {
    const b = this.books.get(p.pid);
    if (!b) return;
    const было = JSON.stringify(b.q.toJSON());
    b.q.syncCollect(p);
    if (JSON.stringify(b.q.toJSON()) !== было) b.dirty = true;
  }

  /** Открыть то, что стало доступно по уровню, и добрать заказы. */
  обновить(p) {
    const b = this.books.get(p.pid);
    if (!b) return;
    const было = JSON.stringify(b.q.toJSON());
    b.q.refresh(p);
    if (JSON.stringify(b.q.toJSON()) !== было) b.dirty = true;
  }

  взять(p, id) {
    const b = this.books.get(p.pid);
    if (!b) return { ok: false, why: 'журнала нет' };
    const q = b.q.all.find((x) => x.id === id);
    if (!q) return { ok: false, why: 'нет такого задания' };
    if (q.state !== 'available') return { ok: false, why: 'это задание сейчас не взять' };
    const вести = [];
    b.q.accept(q, какИгра(this.world, p, вести));
    b.dirty = true;
    return { ok: true, what: 'принято', name: q.title };
  }

  сдать(p, id) {
    const b = this.books.get(p.pid);
    if (!b) return { ok: false, why: 'журнала нет' };
    const q = b.q.all.find((x) => x.id === id);
    if (!q) return { ok: false, why: 'нет такого задания' };
    if (!b.q.canComplete(q, p)) return { ok: false, why: 'задание ещё не выполнено' };
    const вести = [];
    const ok = b.q.complete(q, какИгра(this.world, p, вести));
    if (!ok) return { ok: false, why: 'сдать не вышло' };
    b.dirty = true;
    // Говорим объявленную награду, а не разницу «до и после»: если сдача дала
    // уровень, опыт обнулился, и разница вышла отрицательной — «−94 опыта» за
    // выполненное задание.
    return { ok: true, what: 'сдано', name: q.title, gold: q.gold || 0, xp: q.xp || 0, вести };
  }

  /** Что показать игроку. Возвращает null, если с прошлого раза не менялось. */
  свежий(p) {
    const b = this.books.get(p.pid);
    if (!b || !b.dirty) return null;
    b.dirty = false;
    return b.q.toJSON();
  }

  слепок(p) {
    const b = this.books.get(p.pid);
    return b ? b.q.toJSON() : null;
  }
}
