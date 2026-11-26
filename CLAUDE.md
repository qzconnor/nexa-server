# nexa-server

Selbst gehosteter Relay-Server für Nexa (`../nexa-app`): Namespaces, Einladungen, Instanzen und ein
WebSocket-Relay, über das sich die eigenen Geräte fernsteuern. Der Server ist blind: Inhalte sind
Chiffretext, den die Geräte erzeugen. Konzept: `../nexa-app/docs/NEXA-SERVER.md`.

## Regeln

- **Sprache**: Doku, CLI-Ausgaben und Log-Zeilen Deutsch (mit echten Umlauten und „Anführungszeichen“).
  Code-Kommentare Englisch; sie erklären das Warum, nicht das Was. Fehlertexte im Protokoll (`message`)
  sind Englisch und für Entwickler, Clients übersetzen anhand von `code`.
- **Nie Inhalte loggen**: kein `body`, keine ganze Nachricht, auch nicht auf `debug`. IDs, Namespace,
  Typ (`t`) und Fehler sind in Ordnung.
- **Protokoll**: Jede Änderung an Nachrichten, Feldern, Fehler- oder Close-Codes gehört in
  `docs/PROTOCOL.md`. Was nicht abwärtskompatibel ist, braucht eine neue Version (`/v2/…`).
- **`src/protocol.ts` und `src/auth.ts` bleiben ohne Node-APIs** (nur WebCrypto, `TextEncoder`,
  `btoa`/`atob`), weil die App und die PWA sie übernehmen.
- Dateien mit dem Edit/Write-Werkzeug ändern, nicht mit PowerShell `Set-Content` (Kodierung).
- Commits nur auf Anfrage.

## Befehle

```sh
npm run dev          # Server mit --watch, Daten in ./data
npm run cli -- …     # Admin-CLI, z. B. npm run cli -- namespace create test
npm run typecheck    # tsc --noEmit
npm test             # Vitest, Tests liegen als *.test.ts neben dem Modul
```

Vor dem Abschluss einer Änderung: `npm run typecheck` und `npm test`.

## Technik

- Node ≥ 24 führt die `.ts`-Dateien direkt aus (Type-Stripping), kein Build. Deshalb: Imports mit Endung
  `.ts`, `import type` für Typen, keine `enum`s, keine Parameter-Properties, keine `namespace`s
  (`erasableSyntaxOnly`). Konstanten-Sammlungen als `{ … } as const`.
- Speicher ist `node:sqlite` (`DatabaseSync`), WebSocket ist `ws`. Weitere Abhängigkeiten nur mit gutem
  Grund.
- Stil: keine Semikolons, einfache Anführungszeichen, zwei Leerzeichen, wie in `nexa-app`.

## Aufbau

- `src/main.ts`: Einstieg, ruft `runCli`.
- `src/cli.ts`: Admin-CLI und `serve`.
- `src/config.ts`: Umgebungsvariablen (`NEXA_*`), Liste in `README.md`.
- `src/server.ts`: HTTP-Routen (`/`, `/v1/info`, `/health`, `/v1/join`) und das Upgrade auf `/v1/ws`.
- `src/relay.ts`: Verbindungen je Namespace, Anmeldung, Weiterleitung, Ereignisse, Heartbeat.
- `src/store.ts`: SQLite-Schema und Zugriffe. Schemaänderungen über `PRAGMA user_version` (`SCHEMA_V2` …
  in `#migrate` ergänzen, nie bestehende Schritte ändern).
- `src/codes.ts`: IDs, Einladungscodes (Crockford-Base32, nur der SHA-256-Hash wird gespeichert),
  Namespace-Namen.
- `src/protocol.ts`: Typen und Prüfung der Nachrichten, Close- und Fehler-Codes.
- `src/auth.ts`: Import öffentlicher Schlüssel, Signatur der Anmeldung, base64url.

## Konventionen

- Die Datenbank ist die Wahrheit, nicht der Speicher des Relays: Die CLI ändert sie aus einem zweiten
  Prozess. Darum prüft das Relay vor jeder Nachricht, ob Absender und Empfänger noch existieren, und der
  Heartbeat (`touchInstance`) fängt ruhende Verbindungen ab.
- Eine Instanz eines fremden Namespace muss sich genauso verhalten wie eine, die es nicht gibt.
- Erwartete Fehler des Stores sind `StoreError` mit deutschem Text (die CLI gibt ihn aus) und `code`
  (HTTP und Relay übersetzen ihn).
- Integrationstests (`server.test.ts`) starten einen echten Server auf Port 0 mit `:memory:`-Datenbank
  und sprechen über den globalen `WebSocket` mit WebCrypto-Schlüsseln, wie es die Clients tun.
