// Отряды. Поодиночке архетипы не работают: щитоносец — просто медленная цель.
// В связке «щит спереди, стрелки сзади, шаман в тылу» появляется задача с решением.

import { ENEMIES } from '../entities/enemies.js';
import { TAU, weighted } from '../core/util.js';

/** Шаблоны: набор ролей и вес в общей выборке. */
export const PACKS = [
  { id: 'patrol',    name: 'дозор',      weight: 22, roles: ['melee', 'melee', 'ranged'] },
  { id: 'bulwark',   name: 'застава',    weight: 15, roles: ['shield', 'ranged', 'ranged'] },
  { id: 'warband',   name: 'ватага',     weight: 11, roles: ['shield', 'melee', 'melee', 'healer'] },
  { id: 'hunt',      name: 'свора',      weight: 15, roles: ['charger', 'charger', 'charger'] },
  { id: 'coven',     name: 'ковен',      weight: 11, roles: ['caster', 'caster', 'melee'] },
  { id: 'minefield', name: 'мины',       weight: 9,  roles: ['bomber', 'bomber', 'melee'] },
  { id: 'brutes',    name: 'громилы',    weight: 9,  roles: ['brute', 'melee', 'melee'] },
  { id: 'lone',      name: 'одиночка',   weight: 13, roles: ['melee'] },
];

/** Место роли в построении: вперёд по направлению отряда и вбок. */
const FORM = {
  shield:  { fwd: 20, side: 12 },
  brute:   { fwd: 8,  side: 16 },
  melee:   { fwd: 6,  side: 17 },
  charger: { fwd: 12, side: 21 },
  bomber:  { fwd: 14, side: 18 },
  ranged:  { fwd: -22, side: 17 },
  caster:  { fwd: -26, side: 15 },
  healer:  { fwd: -34, side: 10 },
};

let packSeq = 1;

/** Кандидаты биома под конкретную роль; если таких нет — берём кого угодно. */
function candidates(table, role) {
  const fit = table.filter(([k]) => (ENEMIES[k] || {}).role === role);
  return fit.length ? fit : table;
}

/**
 * Раскладывает отряды по заданным якорям.
 * anchors: [{x, y}], table: таблица биома [[key, weight], …]
 */
export function buildPacks(anchors, table, level, rng, opts = {}) {
  const out = [];
  const templates = PACKS.filter((p) => !opts.exclude || !opts.exclude.includes(p.id));
  const pairs = templates.map((p) => [p, p.weight]);

  for (const anchor of anchors) {
    const tpl = weighted(pairs, rng);
    const packId = 'p' + packSeq++;
    const facing = rng() * TAU;
    const cos = Math.cos(facing), sin = Math.sin(facing);
    // считаем, сколько уже поставлено на каждую роль — чтобы разводить по бокам
    const seen = {};

    for (const role of tpl.roles) {
      const list = candidates(table, role);
      let n = rng() * list.reduce((s, e) => s + e[1], 0);
      let key = list[0][0];
      for (const e of list) { n -= e[1]; if (n <= 0) { key = e[0]; break; } }

      const f = FORM[role] || FORM.melee;
      const i = (seen[role] = (seen[role] || 0) + 1) - 1;
      const lateral = (i % 2 === 0 ? 1 : -1) * (Math.ceil((i + 1) / 2)) * f.side;
      const jitter = (rng() - 0.5) * 8;

      out.push({
        key,
        level: Math.max(1, level + rng.int(-1, 2)),
        x: anchor.x + cos * (f.fwd + jitter) - sin * lateral,
        y: anchor.y + sin * (f.fwd + jitter) * 0.75 + cos * lateral * 0.75,
        pack: packId,
      });
    }
  }
  return out;
}
