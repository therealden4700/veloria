// Проверка входа по подписи: настоящая пара ключей вместо кошелька.
//
//   node tools/auth-check.js
//
// Phantom здесь не нужен: он делает ровно то же, что делает ниже `sign` —
// подписывает байты текста закрытым ключом ed25519. Проверяем и удачный путь,
// и все способы, которыми подпись обязана НЕ пройти.

import { generateKeyPairSync, sign } from 'node:crypto';
import { base58Decode, issueNonce, buildMessage, verifySignature, newSession, readSession } from '../server/auth.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(buf) {
  let num = BigInt('0x' + Buffer.from(buf).toString('hex'));
  let out = '';
  while (num > 0n) { out = B58[Number(num % 58n)] + out; num /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}

const ok = [], bad = [];
const check = (name, cond) => (cond ? ok : bad).push(name);

// ── кошелёк
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
const address = base58Encode(raw);
const signMsg = (msg, key = privateKey) => sign(null, Buffer.from(msg, 'utf8'), key).toString('hex');

check('base58 туда-обратно', Buffer.compare(base58Decode(address), raw) === 0);
check('адрес длиной 32 байта', base58Decode(address).length === 32);

// ── удачный вход
const n1 = issueNonce(address);
const m1 = buildMessage(n1, 'localhost:8123', new Date().toISOString());
const r1 = verifySignature({ address, message: m1, signature: signMsg(m1) });
check('честная подпись проходит', r1.ok === true && r1.address === address);

// ── повтор той же подписи не должен пройти второй раз
const r2 = verifySignature({ address, message: m1, signature: signMsg(m1) });
check('повтор отклонён (код сгорел)', r2.ok === false);

// ── чужая подпись под своим адресом
const other = generateKeyPairSync('ed25519');
const n3 = issueNonce(address);
const m3 = buildMessage(n3, 'localhost:8123', new Date().toISOString());
const r3 = verifySignature({ address, message: m3, signature: signMsg(m3, other.privateKey) });
check('чужая подпись отклонена', r3.ok === false);

// ── подменённый текст
const n4 = issueNonce(address);
const m4 = buildMessage(n4, 'localhost:8123', new Date().toISOString());
const sig4 = signMsg(m4);
const r4 = verifySignature({ address, message: m4.replace('Veloria', 'Zloria'), signature: sig4 });
check('подменённый текст отклонён', r4.ok === false);

// ── код, выданный другому адресу
const n5 = issueNonce(base58Encode(Buffer.from(other.publicKey.export({ format: 'jwk' }).x, 'base64url')));
const m5 = buildMessage(n5, 'localhost:8123', new Date().toISOString());
const r5 = verifySignature({ address, message: m5, signature: signMsg(m5) });
check('чужой код отклонён', r5.ok === false);

// ── выдуманный код
const m6 = buildMessage('f'.repeat(32), 'localhost:8123', new Date().toISOString());
const r6 = verifySignature({ address, message: m6, signature: signMsg(m6) });
check('невыданный код отклонён', r6.ok === false);

// ── мусор вместо адреса и подписи
check('мусорный адрес отклонён', verifySignature({ address: 'не адрес', message: m1, signature: '00' }).ok === false);
check('короткая подпись отклонена', (() => {
  const n = issueNonce(address); const m = buildMessage(n, 'x', new Date().toISOString());
  return verifySignature({ address, message: m, signature: 'aabb' }).ok === false;
})());

// ── сессии
const tok = newSession(address);
check('сессия читается', readSession(tok)?.address === address);
check('мусорный токен не читается', readSession('короткий') === null);

console.log(`прошло: ${ok.length}`);
for (const t of ok) console.log('  ✓ ' + t);
if (bad.length) { console.log(`ПРОВАЛЕНО: ${bad.length}`); for (const t of bad) console.log('  ✗ ' + t); }
process.exit(bad.length ? 1 : 0);
