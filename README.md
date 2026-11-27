# nexa-server

Selbst gehosteter Server für Nexa: Er verbindet die eigenen Geräte (Instanzen), damit eins
das andere fernsteuern kann, später auch vom Handy aus. Er leitet nur weiter und sieht keine Inhalte;
die Geräte verschlüsseln selbst.

Stand: Phase 1, also Namespaces, Einladungen, Instanzen und das Relay über WebSocket. Dazu kommt die
[Web-App fürs Handy](#web-app) (Phase 3, im Aufbau). Das Konzept steht in `nexa-app/docs/NEXA-SERVER.md`,
das Protokoll in [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

## Begriffe

- **Namespace**: ein Nutzer mit seinen Geräten. Ein Server kann mehrere halten (Familie, kleines Team);
  sie sehen nichts voneinander.
- **Instanz**: ein gekoppeltes Gerät, mit Name („Desktop“), Rolle (*Host* oder *Steuerung*) und eigenen
  Schlüsseln.
- **Einladung**: ein einmaliger Code, mit dem sich ein Gerät in einen Namespace koppelt.

## Betrieb

nexa-server läuft nur als Docker-Container. Das Image baut GitHub Actions bei jedem Push auf `main` und legt
es in der GitHub Container Registry ab: `ghcr.io/qzconnor/nexa-server` (amd64 und arm64). Compose lädt es
selbst; aus dem Repo braucht der Server nur `docker-compose.yml`, `.env` und für Caddy das `Caddyfile`.

Davor gehört ein Reverse Proxy mit HTTPS, der WebSockets durchreicht; ohne HTTPS gingen die
Einladungscodes im Klartext übers Netz. Zwei Wege sind vorbereitet.

### Mit Caddy

Der Standard: Caddy läuft als zweiter Container und holt das Zertifikat bei Let's Encrypt selbst.
Voraussetzung sind eine Domain, die auf die Maschine zeigt, und freie, erreichbare Ports 80 und 443.

```sh
git clone https://github.com/qzconnor/nexa-server.git && cd nexa-server
cp .env.example .env              # NEXA_DOMAIN eintragen
docker compose up -d
```

### Mit nginx auf dem Host

1. Repo klonen, `cp .env.example .env` und dort `COMPOSE_PROFILES` und `NEXA_DOMAIN` auskommentieren. Dann
   startet nur der Server, erreichbar unter `127.0.0.1:8080` und nicht von außen.
2. `docker compose up -d`
3. [`deploy/nginx.conf`](deploy/nginx.conf) nach `/etc/nginx/conf.d/nexa-server.conf` kopieren, die Domain
   eintragen, das Zertifikat holen (z. B. `certbot certonly --nginx -d nexa.example.com`) und
   `nginx -t && systemctl reload nginx`.

Andere Proxys (Traefik, HAProxy, ein vorhandener nginx) gehen genauso. Sie brauchen HTTPS, das
WebSocket-Upgrade auf `/v1/ws` und einen Lese-Timeout über 30 Sekunden, denn so oft schickt der Server ein
Ping. Läuft der Proxy selbst in einem Container, erreicht er den Server über ein gemeinsames Docker-Netz
unter `server:8080`.

### Erstes Gerät

```sh
docker compose exec server nexa-server namespace create connor
```

Der Befehl gibt einen Einladungscode aus. In Nexa trägt man ihn zusammen mit der Adresse des Servers ein
(`https://nexa.example.com`); das ist das erste Gerät. Jedes weitere Gerät koppelt man von einem schon
gekoppelten aus mit „Gerät hinzufügen“, dafür braucht es den Admin nicht mehr.

### Daten, Sicherung, Aktualisierung

Die Daten liegen im Volume `data`, eine SQLite-Datei mit ihren `-wal`- und `-shm`-Dateien. Sichern:

```sh
docker compose stop server
docker compose cp server:/data ./backup
docker compose start server
```

Aktualisieren: `git pull && docker compose pull && docker compose up -d`. `git pull` holt nur Änderungen an
`docker-compose.yml` und `Caddyfile`, `docker compose pull` das neue Image.

Welches Image läuft, bestimmt `NEXA_VERSION`:

| Tag | Inhalt |
|---|---|
| `latest` | Stand von `main` (Standard) |
| `0.1.0`, `0.1` | eine Version; entsteht, wenn ein Tag `v0.1.0` gepusht wird |
| `sha-1dc5d48` | ein bestimmter Commit, zum Festhalten oder Zurückgehen |

## Einstellungen

In `.env` neben `docker-compose.yml`; Compose reicht sie an die Container weiter.

| Variable | Standard | Bedeutung |
|---|---|---|
| `COMPOSE_PROFILES` | `caddy` | `caddy` startet Caddy mit; leer lassen für nginx oder einen anderen Proxy |
| `NEXA_DOMAIN` | | Domain für Caddy |
| `NEXA_VERSION` | `latest` | Tag des Images, siehe oben |
| `NEXA_LOCAL_PORT` | `8080` | Port auf `127.0.0.1`, auf den ein Proxy auf dem Host zeigt |
| `TZ` | `Europe/Berlin` | Zeitzone, z. B. für die Zeiten in der CLI |
| `NEXA_MAX_MESSAGE_KB` | `1024` | Größte Nachricht über WebSocket; eine größere trennt die Verbindung (1009) |
| `NEXA_MAX_INSTANCES` | `20` | Instanzen je Namespace |
| `NEXA_RATE_LIMIT` | `100` | Nachrichten je Sekunde und Verbindung, kurzzeitig doppelt so viele |
| `NEXA_LOG_LEVEL` | `info` | `debug`, `info`, `warn` oder `error` |
| `NEXA_PWA` | `false` | `true` liefert die Web-App unter `/app/` aus und bietet Push an, siehe [Web-App](#web-app) |
| `NEXA_VAPID_SUBJECT` | Adresse dieses Projekts | Kontakt für die Push-Dienste: `mailto:name@domain` oder eine `https:`-Adresse |

Adresse, Port und Datenordner im Container (`NEXA_HOST=0.0.0.0`, `NEXA_PORT=8080`, `NEXA_DATA_DIR=/data`)
legt das Image fest.

## Web-App

Mit `NEXA_PWA=true` liefert der Server unter `https://<domain>/app/` eine Web-App fürs Handy aus. Sie
zeigt in einer Inbox, was auf einen wartet (Rückfragen, Freigaben, Pläne, Fehler, fertige Antworten), und
die Chats der eigenen Computer, mit Eingabe für neue Prompts. Man kann sie zum Home-Bildschirm hinzufügen.
Sie koppelt sich wie jedes Gerät mit einem Kopplungscode, als Instanz mit der Rolle *Steuerung*. Aussehen
und Themes sind die der Desktop-App.

Gekoppelt wird mit dem Kopplungscode aus „Gerät hinzufügen“, eingefügt oder als Link
`https://<domain>/app/#nexa1:…`, den die Desktop-App dort als QR-Code zeigt, sobald der Server die Web-App
ausliefert. Den Teil hinter `#` schickt der Browser nie an den
Server, und die Web-App nimmt ihn sofort aus der Adresszeile. Ihre privaten Schlüssel erzeugt sie im Browser
als nicht exportierbar und legt sie in IndexedDB ab; benutzen kann sie sie, auslesen nicht, auch nicht ihr
eigener Code.

Stand:
- Koppeln und Abmelden. Die Computer des Namespace stehen mit dem, was sie dem Handy erlauben.
- Die Chats eines Computers: Liste mit Suche, darin was gerade läuft, wartet oder ungelesen ist.
- Einen Chat lesen, live: Antworten, Werkzeuge, Agents, Rückfragen, ältere Nachrichten beim Hochscrollen.
  Was von selbst aufgeklappt ist, stellt jedes Gerät unter Einstellungen › Chatverlauf ein: Gedanken,
  Änderungen an Dateien und Fehler stehen zunächst offen, Befehle eingeklappt (Änderungen auch, wenn der
  Computer es unter Einstellungen › Chat so will); Lesen, Suchen und andere Werkzeuge auf Tipp. Änderungen
  wie in der Desktop-App: mit Zeilennummern und dem Code in den Farben seiner Sprache. Eigene Nachrichten in
  Markdown, lange eingeklappt mit „Mehr anzeigen“.
- Ab der Stufe „Prompts senden“ eigene Prompts schicken und abbrechen.
- Unter der Eingabe die offenen Pull Requests des Repositorys, in dem der Chat arbeitet, wie in der
  Desktop-App: der des Branches mit Nummer und Stand, ein Tipp zeigt alle und öffnet einen auf GitHub. Der
  Computer liest sie mit seiner GitHub CLI (`gh`); ohne sie oder ohne Anmeldung zeigt sich nichts.
- Die Inbox über alle Computer: was wartet, was abgebrochen oder am Limit ist, was fertig und ungelesen ist,
  was gerade läuft. Die Zahl am Tab zählt, was wartet oder abgebrochen ist.
- Mit der Stufe „Alles, wie am Gerät selbst“ Rückfragen, Freigaben, Pläne und Formulare beantworten, in
  der Inbox und im Chat. Darunter zeigt die Web-App sie nur an.
- Benachrichtigungen, auch wenn die Web-App zu ist: Einstellungen › Benachrichtigungen. Was kommt, stellt
  jeder Computer in Nexa unter Einstellungen › Benachrichtigungen › „Aufs Handy schicken“ ein; ein Tipp
  darauf öffnet den Chat. Auf iPhone und iPad gehen sie nur in der Web-App vom Home-Bildschirm (ab iOS 16.4).
  Ist eine Rückfrage beantwortet, egal wo, verschwindet ihre Benachrichtigung; ebenso, was die offene
  Web-App nicht mehr betrifft (gelesen, Limit vorbei). Auf iPhone und iPad erst, wenn die Web-App offen ist:
  Safari erlaubt keine Pushes, die nichts anzeigen.

Bilder folgen. Die Stufe stellt man am Computer unter Einstellungen › Geräte ein; ohne eigenen Eintrag darf
die Web-App nur mitlesen.

**Warum sie aus ist**: Für die Web-App ist der Server nicht blind. Sie hält wie jedes Gerät den Schlüssel
des Namespace, ihren Code lädt der Browser aber bei jedem Start vom Server. Wer den Server übernimmt (oder
sein Admin), kann ihr also Code unterschieben, der den Schlüssel ausliest, alle Chats mitliest und die
Computer steuert. Bei der Desktop-App geht das nicht, ihr Code kommt nicht vom Server. Wer die Web-App
einschaltet, vertraut dem Server deshalb wie den eigenen Geräten. Auf dem eigenen Server ist das meist in
Ordnung, auf einem geteilten nur, wenn man dem Admin traut.

Was der Server tun kann, tut er: Die Seiten der App dürfen nur Skripte und Styles von ihm laden und nur
mit ihm sprechen (Content Security Policy), laufen in keinem Frame und geben keinen Referrer weiter. Das
schützt vor fremden Seiten und eingeschleusten Skripten, nicht vor dem Server selbst.

Das Image enthält die Web-App immer; `NEXA_PWA` schaltet nur die Auslieferung. `GET /v1/info` meldet sie
als `"pwa": true`.

**Push**: Mit der Web-App bietet der Server auch Web Push an. So erreichen Nachrichten der Computer das
Handy, wenn die Web-App nicht offen ist. Beim ersten Start erzeugt er dafür ein VAPID-Schlüsselpaar und legt
es in der Datenbank ab. Er schickt nur an die Push-Dienste der Browser (Google, Mozilla, Apple, Microsoft),
und was er schickt, ist der Chiffretext der Geräte, für den Push-Dienst noch einmal verschlüsselt. Erst der
Service Worker der Web-App (`/app/sw.js`) öffnet ihn, mit den Schlüsseln aus IndexedDB, und zeigt ihn an;
er speichert sonst nichts und beantwortet keine Anfragen, die Seiten kommen immer frisch vom Server. Mit
`NEXA_VAPID_SUBJECT` trägt man eine Adresse ein, unter der die Push-Dienste den Betreiber erreichen
(`mailto:` oder `https:`); ohne sie steht dort die Adresse dieses Projekts.

## Admin-CLI

Vor jedem Befehl steht `docker compose exec server`, also z. B.
`docker compose exec server nexa-server namespace list`.

| Befehl | Was er tut |
|---|---|
| `nexa-server namespace create <name>` | Legt einen Namespace an und gibt den ersten Einladungscode aus, 7 Tage gültig |
| `nexa-server namespace list` | Namespaces mit der Zahl ihrer Instanzen und offenen Einladungen |
| `nexa-server namespace delete <name> --yes` | Löscht einen Namespace mit allen Instanzen und Einladungen |
| `nexa-server invite <namespace>` | Neuer Einladungscode, 7 Tage gültig, z. B. wenn alle Geräte weg sind |
| `nexa-server instances <namespace>` | Instanzen mit Rolle und „zuletzt gesehen“ |
| `nexa-server instance remove <id> --yes` | Entfernt eine Instanz; das Gerät muss neu gekoppelt werden |
| `nexa-server serve` | Startet den Server; das tut der Container von selbst |

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
unter „Hinweise für Clients“. Die Ausnahme ist die [Web-App](#web-app): Ihr kann ein übernommener Server
eigenen Code geben, deshalb ist sie aus, bis man sie einschaltet.

## Entwicklung

Lokal mit Node.js ab 24, nur zum Entwickeln. Der Server hat keinen Build-Schritt: Node führt die
TypeScript-Quellen direkt aus, auch im Image. Nur die Web-App (`pwa/`, Vue und Vite) wird gebaut, im Image
von einer eigenen Stufe des `Dockerfile`.

```sh
npm install
npm run dev                       # Server auf 127.0.0.1:8080 mit Neustart bei Änderungen, Daten in ./data
npm run dev:pwa                   # Web-App mit Vite unter http://localhost:5173/app/, API vom Server oben
npm run build:pwa                 # Web-App mit Service Worker nach dist/app, für NEXA_PWA=true npm run dev
npm run sync:app                  # geteilten Code aus ../nexa-app nach pwa/src/shared kopieren
npm run cli -- namespace create test
npm run typecheck                 # Server und Web-App
npm test
docker compose up -d --build      # das Image lokal bauen statt aus der Registry laden
```

Die Web-App übernimmt Code der Desktop-App als Kopie, Byte für Byte:
- in `pwa/src/shared` Themes, Chat-Modell, Remote Control, Umschlag, Mitglieder, Kopplungscode und die
  Benachrichtigung, die ein Computer pusht;
- in `pwa/src/client` die Verbindung und die Mitgliedschaft;
- in `pwa/src/lib/tools.ts` die Gruppierung der Chat-Einträge.

Dort nichts von Hand ändern, sondern in der App und danach `npm run sync:app`.
`node scripts/sync-from-app.ts --check` zeigt Abweichungen.

`.github/workflows/docker.yml` führt bei jedem Push und Pull Request Typecheck und Tests aus. Bei Pushes
auf `main` und bei Tags `v*` baut er danach das Image und legt es in der Registry ab.

Aufbau und Regeln stehen in [`CLAUDE.md`](CLAUDE.md).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE) oder neuer (`AGPL-3.0-or-later`). Wer einen
veränderten nexa-server anderen als Dienst anbietet, muss ihnen den geänderten Quellcode zugänglich machen.
