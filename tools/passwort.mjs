// Verdeckte Passwortabfrage ohne externe Pakete.
// Im Terminal wird nichts angezeigt (auch keine Sternchen). Kommt die Eingabe per Pipe,
// wird einfach die nächste Zeile gelesen. Das Passwort wird nirgends gespeichert oder ausgegeben.

let pipeLines = null;

async function nextPipedLine() {
  if (!pipeLines) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    pipeLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  }
  return pipeLines.length ? pipeLines.shift() : '';
}

export async function frageVerdeckt(frage) {
  process.stderr.write(frage);
  if (!process.stdin.isTTY) { const l = await nextPipedLine(); process.stderr.write('\n'); return l; }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let wert = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const fertig = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stderr.write('\n'); };
    const onData = s => {
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') { fertig(); resolve(wert); return; }
        if (ch === '\u0003') { fertig(); reject(new Error('Abgebrochen')); return; }   // Strg+C
        if (ch === '\u007f' || ch === '\b') { wert = [...wert].slice(0, -1).join(''); continue; }
        if (ch >= ' ') wert += ch;
      }
    };
    stdin.on('data', onData);
  });
}
