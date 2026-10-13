#!/usr/bin/env node
// Verschlüsselt Video und Ton für die öffentliche Pages-Seite.
//   quelle/mosaik.mp4 → data/mosaik.bin
//   quelle/audio.js   → data/audio.bin   (nur das JSON, ohne „window.TB_AUDIO =“)
//   Salt, IVs, Iterationen, Größen → data/meta.json
// Schlüssel: PBKDF2-SHA-256 (zufälliges Salt, 300 000 Iterationen) → AES-256-GCM.
// Erneutes Ausführen mit neuem Passwort ersetzt alle drei Dateien.
// Aufruf: node tools/verschluesseln.mjs

import { readFile, writeFile, rename, stat, mkdir } from 'node:fs/promises';
import { webcrypto as crypto, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { frageVerdeckt } from './passwort.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Q = p => path.join(ROOT, 'quelle', p), D = p => path.join(ROOT, 'data', p);
const ITERATIONEN = 300_000, MAX = 100 * 1024 * 1024, MIN_LAENGE = 8;
const STIMMEN = ['synth', 'bass', 'drums', 'ukulele', 'alle'];
const b64 = u8 => Buffer.from(u8).toString('base64');
const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';

function stopp(msg) { console.error('\n✗ ' + msg); process.exit(1); }

async function groesse(p) {
  try { return (await stat(p)).size; } catch { stopp(`Datei fehlt: ${path.relative(ROOT, p)}`); }
}

async function main() {
  // 1. Quellen prüfen (Existenz und 100-MB-Grenze von GitHub)
  const gVideo = await groesse(Q('mosaik.mp4')), gAudio = await groesse(Q('audio.js'));
  for (const [n, g] of [['mosaik.mp4', gVideo], ['audio.js', gAudio]]) {
    if (g + 16 >= MAX) stopp(`quelle/${n} ist ${mb(g)} groß – GitHub erlaubt höchstens 100 MB pro Datei.`);
  }
  console.error(`Quellen: mosaik.mp4 ${mb(gVideo)}, audio.js ${mb(gAudio)} – alles unter 100 MB.`);

  // 2. audio.js → JSON (Präfix weg, Struktur prüfen)
  const js = (await readFile(Q('audio.js'), 'utf8')).trim();
  const m = js.match(/^window\.TB_AUDIO\s*=\s*([\s\S]*?);?\s*$/);
  if (!m) stopp('quelle/audio.js beginnt nicht mit „window.TB_AUDIO =“.');
  const json = m[1];
  let daten;
  try { daten = JSON.parse(json); } catch (e) { stopp('quelle/audio.js enthält kein gültiges JSON: ' + e.message); }
  for (const mode of ['normal', 'slow']) for (const k of STIMMEN) {
    if (typeof daten?.[mode]?.[k] !== 'string') stopp(`quelle/audio.js: TB_AUDIO.${mode}.${k} fehlt.`);
  }
  daten = null;

  // 3. Passwort (verdeckt, zweimal)
  const pw = await frageVerdeckt('Neues Passwort (Eingabe bleibt unsichtbar): ');
  if ([...pw].length < MIN_LAENGE) stopp(`Das Passwort muss mindestens ${MIN_LAENGE} Zeichen haben.`);
  if (await frageVerdeckt('Passwort wiederholen: ') !== pw) stopp('Die beiden Eingaben stimmen nicht überein. Nichts wurde verändert.');

  // 4. Schlüssel ableiten
  console.error(`Leite Schlüssel ab (PBKDF2-SHA-256, ${ITERATIONEN.toLocaleString('de-DE')} Iterationen) …`);
  const salt = randomBytes(16);
  const basis = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONEN },
    basis, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const enc = async plain => {
    const iv = randomBytes(12);
    return { iv, data: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)) };
  };

  // 5. Verschlüsseln
  await mkdir(D(''), { recursive: true });
  console.error('Verschlüssele Video …');
  const video = await enc(await readFile(Q('mosaik.mp4')));
  console.error('Verschlüssele Ton …');
  const audioPlain = new TextEncoder().encode(json);
  const audio = await enc(audioPlain);
  // Kleiner Prüfblock: Die Seite erkennt ein falsches Passwort damit sofort, ohne 40 MB zu laden.
  const pruef = await enc(new TextEncoder().encode('tiny-band-ok'));

  for (const [n, d] of [['mosaik.bin', video.data], ['audio.bin', audio.data]]) {
    if (d.length >= MAX) stopp(`data/${n} wäre ${mb(d.length)} groß – über der 100-MB-Grenze.`);
  }

  const meta = {
    format: 1,
    version: randomBytes(8).toString('hex'),   // ändert sich bei jedem Lauf → Seite erneuert ihren Cache
    erstellt: new Date().toISOString().slice(0, 10),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONEN, salt: b64(salt) },
    cipher: 'AES-256-GCM',
    pruef: { iv: b64(pruef.iv), data: b64(pruef.data) },
    files: {
      mosaik: { path: 'data/mosaik.bin', iv: b64(video.iv), size: gVideo, bytes: video.data.length, type: 'video/mp4' },
      audio: { path: 'data/audio.bin', iv: b64(audio.iv), size: audioPlain.length, bytes: audio.data.length, type: 'application/json' },
    },
  };

  // 6. Schreiben: erst in Temp-Dateien, dann umbenennen (meta.json zuletzt)
  const schreib = async (n, inhalt) => { await writeFile(D(n + '.tmp'), inhalt); await rename(D(n + '.tmp'), D(n)); };
  await schreib('mosaik.bin', video.data);
  await schreib('audio.bin', audio.data);
  await schreib('meta.json', JSON.stringify(meta, null, 2) + '\n');

  console.error(`\n✓ Fertig:\n  data/mosaik.bin  ${mb(video.data.length)}\n  data/audio.bin   ${mb(audio.data.length)}\n  data/meta.json   (Version ${meta.version})`);
  console.error('\nNächste Schritte: git add data && git commit && git push, danach node tools/qr.mjs');
}

main().catch(e => stopp(e.message));
