# nexa-server

Selbst gehosteter Relay-Server für Nexa (`../nexa-app`): Namespaces, Einladungen, Instanzen und ein
WebSocket-Relay, über das sich die eigenen Geräte fernsteuern. Der Server ist blind: Inhalte sind
Chiffretext, den die Geräte erzeugen. Konzept: `../nexa-app/docs/NEXA-SERVER.md`.

## Regeln

- **Betrieb nur als Docker-Container** (`Dockerfile`, `docker-compose.yml` mit Caddy als Profil,
  `deploy/nginx.conf` für nginx auf dem Host). Kein npm-Paket, kein `bin`, kein Betrieb mit lokalem Node;
  Node lokal nur zum Entwickeln. Neue Einstellungen gehören auch in `docker-compose.yml`, `.env.example`
  und die Tabelle im README.
- **Image**: `.github/workflows/docker.yml` testet und schiebt bei Pushes auf `main` (`latest`, `sha-…`)
  und Tags `v*` (`1.2.3`, `1.2`) nach `ghcr.io/qzconnor/nexa-server`, für amd64 und arm64. Eine Version:
  `version` in `package.json` anheben, Tag `v<version>` pushen.
- **Sprache**: Doku, CLI-Ausgaben und Log-Zeilen Deutsch (mit echten Umlauten und „Anführungszeichen“).
  Code-Kommentare Englisch; sie erklären das Warum, nicht das Was. Fehlertexte im Protokoll (`message`)
  sind Englisch und für Entwickler, Clients übersetzen anhand von `code`.
- **Nie Inhalte loggen**: kein `body`, keine ganze Nachricht, auch nicht auf `debug`. IDs, Namespace,
  Typ (`t`) und Fehler sind in Ordnung.
- **Protokoll**: Jede Änderung an Nachrichten, Feldern, Fehler- oder Close-Codes gehört in
  `docs/PROTOCOL.md`. Was nicht abwärtskompatibel ist, braucht eine neue Version (`/v2/…`).
- **`src/protocol.ts` und `src/auth.ts` bleiben ohne Node-APIs** (nur WebCrypto, `TextEncoder`,
  `btoa`/`atob`), weil die App und die PWA sie übernehmen.
- **`pwa/src/shared/`, die Kopien in `pwa/src/client/` und `pwa/src/lib/{tools,code-colors,shells,usage,format,effort,pull-requests}.ts` nie von Hand
  ändern**: Code der App, Byte für Byte (Liste: `EXTRA` in `scripts/sync-from-app.ts`), abgeglichen mit
  `npm run sync:app`. Änderungen gehören in die App (bzw. nach `src/protocol.ts`, `src/auth.ts`).
- **Markdown nur über `pwa/src/lib/markdown.ts`** (markdown-it mit `html: false`): Nur so ist `v-html` sicher,
  Antworten der Agents können beliebiges HTML enthalten.
- **Web-App (`NEXA_PWA`) bleibt standardmäßig aus**: Für sie ist der Server nicht blind (er liefert ihren
  Code, sie hält den Schlüssel). Die CSP in `src/pwa.ts` nicht lockern, kein Inline-Skript, kein
  `'unsafe-inline'`, kein Code von fremden Hosts.
- Dateien mit dem Edit/Write-Werkzeug ändern, nicht mit PowerShell `Set-Content` (Kodierung).
- Commits nur auf Anfrage.

## Befehle

```sh
npm run dev          # Server mit --watch, Daten in ./data
npm run dev:pwa      # Web-App mit Vite (Proxy für /v1 auf den Server)
npm run build:pwa    # Web-App nach dist/app (NEXA_PWA=true liefert sie aus)
npm run sync:app     # geteilten Code aus ../nexa-app nach pwa/src/shared kopieren (--check: nur prüfen)
npm run cli -- …     # Admin-CLI, z. B. npm run cli -- namespace create test
npm run typecheck    # tsc --noEmit für den Server, vue-tsc für pwa/, tsc für den Service Worker
npm test             # Vitest, Tests liegen als *.test.ts neben dem Modul
docker build -t nexa-server .   # Image wie im Betrieb
```

Vor dem Abschluss einer Änderung: `npm run typecheck` und `npm test`.

## Technik

- Node ≥ 24 führt die `.ts`-Dateien in `src/` direkt aus (Type-Stripping), kein Build. Deshalb: Imports mit Endung
  `.ts`, `import type` für Typen, keine `enum`s, keine Parameter-Properties, keine `namespace`s
  (`erasableSyntaxOnly`). Konstanten-Sammlungen als `{ … } as const`.
- Speicher ist `node:sqlite` (`DatabaseSync`), WebSocket ist `ws`. Weitere Abhängigkeiten nur mit gutem
  Grund.
- Die Web-App in `pwa/` ist wie der Renderer der App gebaut: Vue 3, Vite, Tailwind 4, vue-router,
  `@lucide/vue`, dieselben Theme-Tokens (`pwa/src/theme.ts` entspricht `themes/apply.ts` der App). Ihr
  `tsconfig` folgt dem der App, Imports ohne Endung sind dort in Ordnung.
- Stil: keine Semikolons, einfache Anführungszeichen, zwei Leerzeichen, wie in `nexa-app`.

## Aufbau

- `src/main.ts`: Einstieg, ruft `runCli`.
- `src/cli.ts`: Admin-CLI und `serve`.
- `src/config.ts`: Umgebungsvariablen (`NEXA_*`), Liste in `README.md`.
- `src/server.ts`: HTTP-Routen (`/`, `/v1/info`, `/health`, `/v1/join`, `/app/`) und das Upgrade auf `/v1/ws`.
- `src/pwa.ts`: liefert den Build der Web-App aus dem Speicher aus, mit CSP, Caching und SPA-Fallback.
- `src/relay.ts`: Verbindungen je Namespace, Anmeldung, Weiterleitung, Ereignisse, Heartbeat, Push.
- `src/web-push.ts`: Web Push mit VAPID und Verschlüsselung nach RFC 8291 über `node:crypto`, nur an bekannte
  Push-Dienste. Endpoints sind Zugangsschlüssel: nie loggen, nur ihren Host.
- `src/store.ts`: SQLite-Schema und Zugriffe. Schemaänderungen über `PRAGMA user_version` (`SCHEMA_V2` …
  in `#migrate` ergänzen, nie bestehende Schritte ändern).
- `src/codes.ts`: IDs, Einladungscodes (Crockford-Base32, nur der SHA-256-Hash wird gespeichert),
  Namespace-Namen.
- `src/protocol.ts`: Typen und Prüfung der Nachrichten, Close- und Fehler-Codes.
- `src/auth.ts`: Import öffentlicher Schlüssel, Signatur der Anmeldung, base64url.
- `pwa/`: die Web-App (`index.html`, `vite.config.ts`, `src/` mit Ansichten, Router, Theme, `shared/`).
  `pwa/src/client/`: Verbindung zu Server und Computern, teils Kopien aus der App, teils eigen (IndexedDB,
  Koppeln als `controller`). `pwa/src/host-store.ts`: der gezeigte Computer (Chats, Laufzustände, offene
  Chats, Ereignisse), wie `stores/sessions.ts` der App; `pwa/src/components/chat/`: die Zeitleiste eines Chats.
  `pwa/src/inbox-store.ts`: die Inbox über alle Computer (`sessions:inbox`, neu geholt nach Ereignissen).
  `pwa/src/watches.ts`: Host-Store und Inbox beobachten Computer gemeinsam über einen `setWatch`.
  Antworten auf Rückfragen gibt die Seite über `RESPONDER` (`components/chat/respond.ts`) an die Karten.
  `pwa/src/sw.ts`: der Service Worker (nur Push und Klick, kein Cache, kein `fetch`), vom Plugin in
  `vite.config.ts` als klassisches Skript nach `dist/app/sw.js` gebaut, mit eigenem `tsconfig.sw.json`
  (WebWorker statt DOM). `pwa/src/push/`: Push öffnen und prüfen (`open.ts`, auch im Service Worker),
  Anmeldung im Browser und beim Server (`subscription.ts`).
- `scripts/sync-from-app.ts`: kopiert den geteilten Code aus der App nach `pwa/src/shared`.

## Konventionen

- Die Datenbank ist die Wahrheit, nicht der Speicher des Relays: Die CLI ändert sie aus einem zweiten
  Prozess. Darum prüft das Relay vor jeder Nachricht, ob Absender und Empfänger noch existieren, und der
  Heartbeat (`touchInstance`) fängt ruhende Verbindungen ab.
- Eine Instanz eines fremden Namespace muss sich genauso verhalten wie eine, die es nicht gibt.
- Erwartete Fehler des Stores sind `StoreError` mit deutschem Text (die CLI gibt ihn aus) und `code`
  (HTTP und Relay übersetzen ihn).
- Integrationstests (`server.test.ts`) starten einen echten Server auf Port 0 mit `:memory:`-Datenbank
  und sprechen über den globalen `WebSocket` mit WebCrypto-Schlüsseln, wie es die Clients tun.
