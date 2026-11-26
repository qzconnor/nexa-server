# nexa-server

Selbst gehosteter Server für Nexa: Er verbindet die eigenen Geräte (Instanzen), damit eins
das andere fernsteuern kann, später auch vom Handy aus. Er leitet nur weiter und sieht keine Inhalte;
die Geräte verschlüsseln selbst.

Stand: Phase 1, also Namespaces, Einladungen, Instanzen und das Relay über WebSocket. Das Konzept steht in
`nexa-app/docs/NEXA-SERVER.md`, das Protokoll in [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

## Begriffe

- **Namespace**: ein Nutzer mit seinen Geräten. Ein Server kann mehrere halten (Familie, kleines Team);
  sie sehen nichts voneinander.
- **Instanz**: ein gekoppeltes Gerät, mit Name („Desktop“), Rolle (*Host* oder *Steuerung*) und eigenen
  Schlüsseln.
- **Einladung**: ein einmaliger Code, mit dem sich ein Gerät in einen Namespace koppelt.

## Betrieb mit Docker Compose

Voraussetzung: eine Domain, die auf die Maschine zeigt, und offene Ports 80 und 443. Caddy holt das
Zertifikat selbst.

```sh
cp .env.example .env              # NEXA_DOMAIN eintragen
docker compose up -d --build
docker compose exec server nexa-server namespace create connor
```

Der letzte Befehl gibt einen Einladungscode aus. In Nexa trägt man ihn zusammen mit der Adresse des
Servers ein (`https://nexa.example.com`); das ist das erste Gerät. Jedes weitere Gerät koppelt man von
einem schon gekoppelten aus mit „Gerät hinzufügen“, dafür braucht es den Server nicht mehr.

Die Daten liegen im Volume `data` (eine SQLite-Datei, `/data/nexa-server.db`). Zum Sichern genügt diese
Datei samt `-wal` und `-shm`, am besten bei gestopptem Server.

Aktualisieren: `git pull && docker compose up -d --build`.

## Betrieb ohne Docker

Node.js ab 24, kein Build-Schritt: Node führt die TypeScript-Quellen direkt aus.

```sh
npm ci --omit=dev
NEXA_DATA_DIR=/var/lib/nexa-server npm start
```

Ohne `NEXA_HOST` hört der Server nur auf `127.0.0.1`. Davor gehört ein Reverse Proxy mit HTTPS (Caddy,
nginx, Traefik), der auch WebSockets durchreicht. Ohne HTTPS gingen die Einladungscodes im Klartext
übers Netz.

## Einstellungen

| Variable | Standard | Bedeutung |
|---|---|---|
| `NEXA_HOST` | `127.0.0.1` (Docker: `0.0.0.0`) | Adresse, auf der der Server hört |
| `NEXA_PORT` | `8080` | Port |
| `NEXA_DATA_DIR` | `./data` (Docker: `/data`) | Ordner für die Datenbank |
| `NEXA_MAX_MESSAGE_KB` | `1024` | Größte Nachricht über WebSocket; eine größere trennt die Verbindung (1009) |
| `NEXA_MAX_INSTANCES` | `20` | Instanzen je Namespace |
| `NEXA_RATE_LIMIT` | `100` | Nachrichten je Sekunde und Verbindung, kurzzeitig doppelt so viele |
| `NEXA_LOG_LEVEL` | `info` | `debug`, `info`, `warn` oder `error` |

## Admin-CLI

Mit Docker steht vor jedem Befehl `docker compose exec server`. Ohne Docker ersetzt `npm run cli --` das
`nexa-server`, also z. B. `npm run cli -- namespace list`.

| Befehl | Was er tut |
|---|---|
| `nexa-server serve` | Startet den Server (im Container der Standard) |
| `nexa-server namespace create <name>` | Legt einen Namespace an und gibt den ersten Einladungscode aus, 7 Tage gültig |
| `nexa-server namespace list` | Namespaces mit der Zahl ihrer Instanzen und offenen Einladungen |
| `nexa-server namespace delete <name> --yes` | Löscht einen Namespace mit allen Instanzen und Einladungen |
| `nexa-server invite <namespace>` | Neuer Einladungscode, 7 Tage gültig, z. B. wenn alle Geräte weg sind |
| `nexa-server instances <namespace>` | Instanzen mit Rolle und „zuletzt gesehen“ |
| `nexa-server instance remove <id> --yes` | Entfernt eine Instanz; das Gerät muss neu gekoppelt werden |

Namen von Namespaces: 1 bis 32 Zeichen aus `a–z`, `0–9` und `-`, am Anfang kein `-`.

Die CLI arbeitet direkt auf der Datenbank, auch während der Server läuft. Entfernt sie eine Instanz oder
löscht sie einen Namespace, trennt der Server die betroffenen Verbindungen bei ihrer nächsten Nachricht,
spätestens nach 30 Sekunden.

## Sicherheitsmodell

**Der Server ist blind.** Remote Control heißt Code auf einem Rechner ausführen (die Agents haben eine
Shell). Wer den Server übernimmt, darf deshalb nicht an die Geräte kommen, und auch der Admin eines
geteilten Servers soll keine fremden Chats lesen.

- **Inhalte**: Die Geräte verschlüsseln jede Nachricht mit dem Schlüssel des Namespace. Diesen Schlüssel
  bekommt der Server nie zu sehen; er steht nur im Kopplungscode, den ein schon gekoppeltes Gerät zeigt.
  Der Server reicht den Inhalt (`body`) unverändert weiter, speichert ihn nicht und schreibt ihn in kein
  Log.
- **Anmeldung ohne Passwort**: Jede Instanz hat ein eigenes Schlüsselpaar (P-256). Bei jeder Verbindung
  signiert sie eine Zufallszahl des Servers. Der private Schlüssel verlässt das Gerät nicht, der Server
  kennt nur den öffentlichen.
- **Einladungen**: 160 Bit Zufall, nur einmal gültig. Die Datenbank speichert nur ihren SHA-256-Hash; wer
  die Datei stiehlt, hat keine gültigen Codes. Einladungen des Admins gelten 7 Tage, die eines Geräts
  15 Minuten. Wird ein Gerät entfernt, verfallen auch die Einladungen, die es erstellt hat.
- **Namespaces**: Eine Instanz erreicht nur Instanzen ihres Namespace. Eine fremde Instanz sieht für sie
  genauso aus wie eine, die es nicht gibt.
- **Entfernen**: Jede Instanz eines Namespace kann jede andere entfernen (die Liste der Geräte in den
  Einstellungen von Nexa). Der Server trennt sie sofort (4403) und meldet das den übrigen. Die wechseln
  danach den Schlüssel des Namespace, denn das entfernte Gerät kennt den alten noch.
- **Grenzen**: Größe einer Nachricht, Nachrichten je Sekunde, Instanzen je Namespace, 10 Sekunden für
  die Anmeldung. Liest ein Gerät nicht schnell genug, bekommt der Absender `busy`, statt dass der
  Server unbegrenzt puffert.

**Was der Server trotzdem sieht**: welche Instanz wann mit welcher spricht, wie groß die Nachrichten sind
und welche Art (`kind`) sie haben, dazu Namen, Rollen und öffentliche Schlüssel der Instanzen und, über
den Proxy, IP-Adressen. Das ist der Preis eines Relays.

**Was ein übernommener Server kann**: Nachrichten verwerfen, verzögern oder umleiten, den Dienst
verweigern und eine eigene Instanz in die Liste eines Namespace schmuggeln. Lesen kann er nichts, solange
die Geräte der Liste nicht blind glauben: Den Schlüssel des Namespace bekommt nur, wer sich mit dem
alten Schlüssel ausgewiesen hat. Wie die Geräte das tun, steht in [`docs/PROTOCOL.md`](docs/PROTOCOL.md)
unter „Hinweise für Clients“.

## Entwicklung

```sh
npm install
npm run dev          # Server mit Neustart bei Änderungen, Daten in ./data
npm run cli -- namespace create test
npm run typecheck
npm test
```

Aufbau und Regeln stehen in [`CLAUDE.md`](CLAUDE.md).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE) oder neuer (`AGPL-3.0-or-later`). Wer einen
veränderten nexa-server anderen als Dienst anbietet, muss ihnen den geänderten Quellcode zugänglich machen.
