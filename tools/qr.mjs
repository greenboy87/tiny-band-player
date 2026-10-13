#!/usr/bin/env node
// Erzeugt den QR-Code für die Schülerinnen und Schüler: Pages-URL + #pw=<Passwort>.
//   qr/tiny-band-qr.png  (1200 × 1200 px, dunkel auf weiß, mit Rand)
//   qr/tiny-band-qr.svg
// Der Ordner qr/ steht in .gitignore, weil das Passwort im Code steckt.
// Aufruf: node tools/qr.mjs [Pages-URL]
// Das Passwort wird verdeckt abgefragt und gegen data/meta.json geprüft.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { frageVerdeckt } from './passwort.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDARD_URL = 'https://greenboy87.github.io/tiny-band-player/';
const BESCHRIFTUNG = 'Tiny Band Live-Player';

// ======================= QR-Encoder (Byte-Modus, ISO/IEC 18004) =======================
// Fehlerkorrektur Q (~25 %), damit der Code auch am Beamer/Whiteboard sicher erkannt wird.
const ECL = { name: 'Q', idx: 2, formatBits: 3 };
const ECC_PRO_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const ANZ_BLOECKE = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const bit = (x, i) => ((x >>> i) & 1) !== 0;

function rohModule(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
  return r;
}
const datenCodewoerter = ver => Math.floor(rohModule(ver) / 8) - ECC_PRO_BLOCK[ECL.idx][ver] * ANZ_BLOECKE[ECL.idx][ver];

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function rsDivisor(grad) {
  const r = new Array(grad).fill(0); r[grad - 1] = 1;
  let wurzel = 1;
  for (let i = 0; i < grad; i++) {
    for (let j = 0; j < grad; j++) { r[j] = gfMul(r[j], wurzel); if (j + 1 < grad) r[j] ^= r[j + 1]; }
    wurzel = gfMul(wurzel, 0x02);
  }
  return r;
}
function rsRest(daten, div) {
  const r = div.map(() => 0);
  for (const b of daten) {
    const f = b ^ r.shift(); r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

function erzeugeQr(text) {
  const bytes = [...Buffer.from(text, 'utf8')];
  let ver = 1;
  for (; ver <= 40; ver++) {
    const lenBits = ver <= 9 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= datenCodewoerter(ver) * 8) break;
  }
  if (ver > 40) throw new Error('Text zu lang für einen QR-Code');

  // Bitstrom: Modus 0100 (Byte), Länge, Daten, Terminator, Auffüllen
  const bits = [];
  const add = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  add(4, 4); add(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach(b => add(b, 8));
  const kap = datenCodewoerter(ver) * 8;
  add(0, Math.min(4, kap - bits.length));
  add(0, (8 - bits.length % 8) % 8);
  for (let p = 0xec; bits.length < kap; p ^= 0xec ^ 0x11) add(p, 8);
  const daten = [];
  for (let i = 0; i < bits.length; i += 8) daten.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // Fehlerkorrektur und Verschachtelung
  const nBl = ANZ_BLOECKE[ECL.idx][ver], eccLen = ECC_PRO_BLOCK[ECL.idx][ver];
  const roh = Math.floor(rohModule(ver) / 8), kurz = nBl - roh % nBl, kurzLen = Math.floor(roh / nBl);
  const div = rsDivisor(eccLen), bloecke = [];
  for (let i = 0, k = 0; i < nBl; i++) {
    const d = daten.slice(k, k + kurzLen - eccLen + (i < kurz ? 0 : 1)); k += d.length;
    const ecc = rsRest(d, div);
    if (i < kurz) d.push(0);
    bloecke.push(d.concat(ecc));
  }
  const codew = [];
  for (let i = 0; i < bloecke[0].length; i++) bloecke.forEach((b, j) => { if (i !== kurzLen - eccLen || j >= kurz) codew.push(b[i]); });

  // Matrix aufbauen
  const n = ver * 4 + 17;
  const mod = Array.from({ length: n }, () => new Array(n).fill(false));
  const fkt = Array.from({ length: n }, () => new Array(n).fill(false));
  const setF = (x, y, dunkel) => { mod[y][x] = dunkel; fkt[y][x] = true; };
  for (let i = 0; i < n; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < n && y >= 0 && y < n) setF(x, y, d !== 2 && d !== 4);
    }
  }
  const ausr = [];
  if (ver > 1) {
    const anz = Math.floor(ver / 7) + 2;
    const schritt = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (anz * 2 - 2)) * 2;
    ausr.push(6);
    for (let p = n - 7; ausr.length < anz; p -= schritt) ausr.splice(1, 0, p);
  }
  ausr.forEach((ay, i) => ausr.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === ausr.length - 1) || (i === ausr.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const zeichneFormat = maske => {
    const d = (ECL.formatBits << 3) | maske;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i));
    setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setF(n - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setF(8, n - 15 + i, bit(b, i));
    setF(8, n - 8, true);
  };
  zeichneFormat(0);   // reserviert die Formatbereiche
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) { const a = n - 11 + i % 3, c = Math.floor(i / 3); setF(a, c, bit(b, i)); setF(c, a, bit(b, i)); }
  }
  // Datenbits im Zickzack
  for (let rechts = n - 1, i = 0; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) {
      const x = rechts - j, hoch = ((rechts + 1) & 2) === 0, y = hoch ? n - 1 - v : v;
      if (!fkt[y][x] && i < codew.length * 8) { mod[y][x] = bit(codew[i >>> 3], 7 - (i & 7)); i++; }
    }
  }
  // Maske mit der geringsten Strafpunktzahl wählen
  const MASKEN = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
  ];
  const maskiere = m => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fkt[y][x] && MASKEN[m](x, y)) mod[y][x] = !mod[y][x]; };
  const strafe = () => {
    let p = 0;
    const linien = [];
    for (let i = 0; i < n; i++) { linien.push(mod[i]); linien.push(mod.map(r => r[i])); }
    const muster1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], muster2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (const l of linien) {
      for (let i = 0, lauf = 1; i < n; i++) {
        if (i > 0 && l[i] === l[i - 1]) lauf++; else lauf = 1;
        if (lauf === 5) p += 3; else if (lauf > 5) p++;
      }
      for (let i = 0; i + 11 <= n; i++) {
        if (muster1.every((v, k) => +l[i + k] === v) || muster2.every((v, k) => +l[i + k] === v)) p += 40;
      }
    }
    let dunkel = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (mod[y][x]) dunkel++;
      if (x < n - 1 && y < n - 1 && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3;
    }
    const gesamt = n * n, k = Math.ceil(Math.abs(dunkel * 20 - gesamt * 10) / gesamt) - 1;
    return p + k * 10;
  };
  let beste = 0, besteP = Infinity;
  for (let m = 0; m < 8; m++) {
    maskiere(m); zeichneFormat(m);
    const p = strafe();
    if (p < besteP) { besteP = p; beste = m; }
    maskiere(m);
  }
  maskiere(beste); zeichneFormat(beste);
  return { ver, n, mod };
}

// ======================= Ausgabe =======================
// Kleine 5×7-Pixelschrift für die Beschriftung im PNG (nur die benötigten Zeichen).
const FONT = {
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  i: ['..#..', '.....', '.##..', '..#..', '..#..', '..#..', '.###.'],
  n: ['.....', '.....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  y: ['.....', '.....', '#...#', '#...#', '.####', '....#', '.###.'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  d: ['....#', '....#', '.##.#', '#..##', '#...#', '#...#', '.####'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  l: ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

const GROESSE = 1200, QR_BEREICH = 1060, RAND = 4;   // Rand = Ruhezone in Modulen

function layout(n) {
  const m = n + 2 * RAND, s = Math.floor(QR_BEREICH / m), px = m * s;
  return { s, x0: Math.floor((GROESSE - px) / 2) + RAND * s, y0: Math.floor((QR_BEREICH - px) / 2) + 20 + RAND * s };
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(typ, daten) {
  const len = Buffer.alloc(4); len.writeUInt32BE(daten.length);
  const td = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function alsPng({ n, mod }) {
  const W = GROESSE, H = GROESSE, px = Buffer.alloc(W * H, 255);   // Graustufen, weiß
  const { s, x0, y0 } = layout(n);
  const rect = (x, y, w, h, v) => { for (let yy = y; yy < y + h; yy++) px.fill(v, yy * W + x, yy * W + x + w); };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mod[y][x]) rect(x0 + x * s, y0 + y * s, s, s, 0x12);
  // Beschriftung
  const p = 5, glyphs = [...BESCHRIFTUNG].map(ch => FONT[ch]);
  const breite = glyphs.reduce((a, g) => a + (g[0].length + 1) * p, -p);
  let x = Math.floor((W - breite) / 2);
  const y = H - 100;
  for (const g of glyphs) {
    g.forEach((zeile, r) => [...zeile].forEach((c, k) => { if (c === '#') rect(x + k * p, y + r * p, p, p, 0x44); }));
    x += (g[0].length + 1) * p;
  }
  const roh = Buffer.alloc((W + 1) * H);
  for (let r = 0; r < H; r++) { roh[r * (W + 1)] = 0; px.copy(roh, r * (W + 1) + 1, r * W, (r + 1) * W); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(roh, { level: 9 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function alsSvg({ n, mod }) {
  const { s, x0, y0 } = layout(n);
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!mod[y][x] || (x > 0 && mod[y][x - 1])) continue;
    let w = 1; while (x + w < n && mod[y][x + w]) w++;
    d += `M${x0 + x * s} ${y0 + y * s}h${w * s}v${s}h${-w * s}z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GROESSE} ${GROESSE}" width="${GROESSE}" height="${GROESSE}">
<rect width="100%" height="100%" fill="#fff"/>
<path fill="#121212" shape-rendering="crispEdges" d="${d}"/>
<text x="${GROESSE / 2}" y="${GROESSE - 66}" text-anchor="middle" font-family="'Century Gothic', Futura, 'Avenir Next', Arial, sans-serif" font-size="40" fill="#444">${BESCHRIFTUNG}</text>
</svg>
`;
}

// ======================= Ablauf =======================
async function passwortPasst(pw) {
  const meta = JSON.parse(await readFile(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
  const u = s => Buffer.from(s, 'base64');
  const basis = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: meta.kdf.hash, salt: u(meta.kdf.salt), iterations: meta.kdf.iterations },
    basis, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u(meta.pruef.iv) }, key, u(meta.pruef.data)); return true; }
  catch { return false; }
}

async function main() {
  let url = process.argv[2] || STANDARD_URL;
  if (!/^https?:\/\//.test(url)) throw new Error('Die Pages-URL muss mit https:// beginnen.');
  url = url.replace(/#.*$/, '');
  if (!url.endsWith('/') && !/\.html?$/.test(url)) url += '/';

  const pw = await frageVerdeckt('Passwort (Eingabe bleibt unsichtbar): ');
  if (!pw) throw new Error('Kein Passwort eingegeben.');
  if (!await passwortPasst(pw)) throw new Error('Das Passwort passt nicht zu data/meta.json. Hast du mit einem anderen Passwort verschlüsselt?');

  const qr = erzeugeQr(`${url}#pw=${encodeURIComponent(pw)}`);
  await mkdir(path.join(ROOT, 'qr'), { recursive: true });
  await writeFile(path.join(ROOT, 'qr', 'tiny-band-qr.png'), alsPng(qr));
  await writeFile(path.join(ROOT, 'qr', 'tiny-band-qr.svg'), alsSvg(qr));
  console.error(`✓ QR-Code (Version ${qr.ver}, Fehlerkorrektur ${ECL.name}) für ${url} gespeichert:\n  qr/tiny-band-qr.png\n  qr/tiny-band-qr.svg\nDer Ordner qr/ wird nicht committet – den QR-Code nur in der Präsentation zeigen.`);
}

main().catch(e => { console.error('✗ ' + e.message); process.exit(1); });
