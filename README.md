# Tiny Band Live-Player – End Of Beginning

Passwortgeschützte Version des Live-Players für GitHub Pages. Die Schülerinnen und Schüler öffnen die Seite am iPad über einen QR-Code, in dem das Passwort schon steckt.

**Seite:** https://greenboy87.github.io/tiny-band-player/

## Wie der Schutz funktioniert

Repo und Seite sind öffentlich. Video und Ton liegen deshalb nur **verschlüsselt** im Repo (`data/*.bin`, AES-256-GCM, Schlüssel per PBKDF2-SHA-256 mit 300 000 Iterationen aus dem Passwort abgeleitet). Die Seite entschlüsselt erst im Browser, im Arbeitsspeicher.

- Das Passwort kommt über den QR-Code (`…/#pw=…`). Die Seite entfernt es sofort aus der Adresszeile. Ohne QR-Code erscheint ein Codefeld.
- Nach dem ersten Laden bleiben die **verschlüsselten** Dateien im Cache des iPads, das zweite Öffnen geht ohne Download. Passwort und entschlüsselte Daten werden nie gespeichert.
- Suchmaschinen sind ausgesperrt (`robots.txt`, `noindex`).

> **Wichtig:** Der Schutz ist nur so gut wie die Weitergabe des QR-Codes. Wer den QR-Code (oder ein Foto davon) hat, kommt an Video und Ton. Zeig ihn also nur im Unterricht und häng ihn nicht öffentlich aus. Wenn er in Umlauf geraten ist, wechselst du das Passwort (siehe unten).

## Ablauf

Voraussetzung: Node.js (ab Version 20). Auf diesem Mac liegt es unter `~/.local/node/bin`. Entweder `export PATH=~/.local/node/bin:$PATH` ausführen oder `node` durch `~/.local/node/bin/node` ersetzen.

1. **Dateien nach `quelle/` legen** (der Ordner wird nie committet):
   - `quelle/Tiny Band Live-Player c+.html` (nur als Referenz)
   - `quelle/mosaik.mp4`
   - `quelle/audio.js`
2. **Verschlüsseln.** Das Script fragt das Passwort zweimal verdeckt ab, mindestens 8 Zeichen:
   ```bash
   node tools/verschluesseln.mjs
   ```
   Das erzeugt `data/mosaik.bin`, `data/audio.bin` und `data/meta.json`. Das Script prüft vorher, dass keine Datei über 100 MB groß ist.
3. **Committen und pushen:**
   ```bash
   git add data && git commit -m "Daten neu verschlüsselt" && git push
   ```
   GitHub Pages braucht danach etwa eine Minute.
4. **QR-Code erzeugen.** Das Script fragt das Passwort verdeckt ab und prüft es gegen `data/meta.json`:
   ```bash
   node tools/qr.mjs
   ```
   Ergebnis: `qr/tiny-band-qr.png` (1200 px) und `qr/tiny-band-qr.svg`. Der Ordner `qr/` wird nie committet.
5. **QR-Code in die Präsentation** einfügen, fertig.

## Passwort wechseln (z. B. pro Schuljahr)

Schritte 2 bis 5 mit dem neuen Passwort wiederholen. Das Script ersetzt alle drei Dateien in `data/`. Die iPads merken an der neuen `meta.json`, dass es neue Daten gibt, laden einmal neu und verwerfen den alten Cache. Alte QR-Codes funktionieren danach nicht mehr.

Hinweis: Jede Neuverschlüsselung legt gut 40 MB zusätzlich in die Git-Historie. Für ein paar Wechsel ist das unproblematisch. Die alten Stände sind mit dem alten Passwort verschlüsselt, ein altes Passwort öffnet also weiterhin alte Versionen aus der Historie.

## Gut zu wissen

- **Erstes Öffnen** lädt rund 42 MB, also am besten im Schul-WLAN.
- **iPad/Safari** kann den Cache von Websites löschen, wenn die Seite einige Wochen nicht geöffnet wurde. Dann wird einfach neu geladen.
- **Lokal testen** (Server mit Range-Requests):
  ```bash
  npx http-server -p 8317 -c-1 .
  ```
  Dann `http://localhost:8317/#pw=…` öffnen. Ein QR-Code für den lokalen Test entsteht mit `node tools/qr.mjs http://localhost:8317/`.
- Bedienung wie im Original: 1–5 Stimme, G 4er-Ansicht, Leertaste oder Tippen ins Video für Play/Pause, ←/→ Takt, T Tempo, F Vollbild.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Player plus Code-Eingabe, Laden und Entschlüsseln (statisch, kein Build) |
| `data/` | verschlüsselte Daten und `meta.json` (Salt, IVs, Iterationen, Größen) |
| `tools/verschluesseln.mjs` | verschlüsselt `quelle/` → `data/` |
| `tools/qr.mjs` | QR-Code mit Passwort → `qr/` |
| `tools/passwort.mjs` | verdeckte Passwortabfrage für beide Scripts |
