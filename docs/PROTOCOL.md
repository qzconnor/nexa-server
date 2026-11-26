# Protokoll von nexa-server, Version 1

Was Clients (Nexa auf dem Desktop, später die PWA) mit dem Server sprechen. Typen und Prüfung stehen in
`src/protocol.ts`, Schlüssel und Signaturen in `src/auth.ts`. Beide Dateien kommen ohne Node aus (nur
WebCrypto, `TextEncoder`, `btoa`/`atob`), damit die Clients sie übernehmen können.

Allgemein:

- Zeiten sind Millisekunden seit 1970 (`Date.now()`).
- Binärdaten sind base64url ohne Padding.
- Öffentliche Schlüssel: P-256, Format `raw` als unkomprimierter Punkt (65 Byte, beginnt mit `0x04`). So
  liefert ihn `crypto.subtle.exportKey('raw', publicKey)`.
- IDs von Instanzen sind vom Server vergeben: 16 Byte Zufall, base64url (22 Zeichen).
- Unbekannte Felder ignoriert der Server; Clients sollten es genauso halten.

## HTTP

### `GET /` und `GET /v1/info`

```json
{ "name": "nexa-server", "version": "0.1.0", "protocol": 1 }
```

Damit prüft ein Client, ob unter der Adresse ein nexa-server läuft und ob er dessen Protokoll spricht.

### `GET /health`

`200 { "status": "ok", "connections": 3 }`, oder `503`, wenn die Datenbank nicht antwortet.

### `POST /v1/join`

Koppelt ein Gerät mit einer Einladung. `Content-Type: application/json`, höchstens 16 KB.

```json
{
  "invite": "8MXK-GQDC-2QSY-7QM6-NJ9A-T274-Y96X-PGBC",
  "name": "Desktop",
  "role": "host",
  "signKey": "BMRT1x2K…",
  "dhKey": "BO7n-An1…"
}
```

- `invite`: Groß- und Kleinschreibung, Bindestriche und Leerzeichen sind egal, `O` gilt als `0`, `I` und
  `L` als `1`.
- `name`: 1 bis 64 Zeichen. Der Server kürzt Leerraum und lehnt Steuerzeichen und Bidi-Overrides ab.
- `role`: `host` (auf dem Gerät laufen die CLIs, es kann auch steuern) oder `controller` (steuert nur, z. B.
  die PWA).
- `signKey`: öffentlicher ECDSA-Schlüssel für die Anmeldung.
- `dhKey`: öffentlicher ECDH-Schlüssel. Über ihn bekommt die Instanz einen neuen Schlüssel des Namespace,
  den nur sie lesen kann.

Antwort `201`:

```json
{ "namespace": "connor", "instance": "hIkscegBGIQ_aBh56MTtOw" }
```

Fehler kommen immer als `{ "error": "<code>", "message": "<englisch, für Entwickler>" }`:

| Status | `error` | Bedeutung |
|---|---|---|
| 400 | `bad-request` | Feld fehlt oder ist falsch, kein gültiger P-256-Schlüssel, kein JSON |
| 403 | `invite-invalid` | Einladung unbekannt, schon benutzt oder abgelaufen (nicht unterscheidbar) |
| 409 | `namespace-full` | Der Namespace hat schon so viele Instanzen, wie der Server erlaubt |
| 413 | `too-large` | Body über 16 KB |
| 415 | `unsupported-media-type` | Kein `application/json` |

Eine fehlgeschlagene Kopplung verbraucht die Einladung nicht. Jede Instanz bekommt ein eigenes
Schlüsselpaar; ein Paar nicht für mehrere Server oder Kopplungen verwenden.

Alle Routen erlauben CORS von jeder Origin. Der Server nutzt keine Cookies, also gibt es dabei nichts zu
stehlen.

## WebSocket `/v1/ws`

Eine Verbindung je Instanz. Jede Nachricht ist ein Text-Frame mit einem JSON-Objekt; das Feld `t` nennt
den Typ. Binär-Frames lehnt der Server ab.

### Anmeldung

```
Server → { "t": "hello", "v": 1, "nonce": "<32 Byte, base64url>" }
Client → { "t": "auth", "instance": "<ID>", "sig": "<Signatur>" }
Server → { "t": "ready", "instance": "<ID>", "namespace": "connor", "instances": [InstanceInfo, …] }
```

- `sig` ist ECDSA mit P-256 und SHA-256 über die UTF-8-Bytes von `nexa-server/auth/v1:<nonce>`, im Format
  IEEE P1363 (r ‖ s, 64 Byte), wie es `crypto.subtle.sign` liefert. In `src/auth.ts` steht das als
  `signAuth(privateKey, nonce)`.
- Vor `ready` darf der Client nur dieses eine `auth` senden, auch nicht während der Server die Signatur
  prüft.
- `instances` enthält alle Instanzen des Namespace, die eigene eingeschlossen.

`InstanceInfo`:

```json
{
  "id": "hIkscegBGIQ_aBh56MTtOw",
  "name": "Desktop",
  "role": "host",
  "signKey": "BMRT1x2K…",
  "dhKey": "BO7n-An1…",
  "createdAt": 1795685175988,
  "lastSeen": 1795685180001,
  "online": true
}
```

### Anfragen nach `ready`

Jede Anfrage hat eine `id` (1 bis 128 druckbare ASCII-Zeichen, vom Client gewählt). Antworten und Fehler
tragen sie als `re`.

| Anfrage | Antwort |
|---|---|
| `{ t: "send", id, to, kind, body? }` | keine; nur ein Fehler, wenn es nicht geht |
| `{ t: "invite", id }` | `{ t: "invite", re, code, expiresAt }`, 15 Minuten gültig |
| `{ t: "instances", id }` | `{ t: "instances", re, instances: [InstanceInfo, …] }` |
| `{ t: "remove", id, instance }` | `{ t: "ok", re }`, dazu `removed` an alle |
| `{ t: "rename", id, instance?, name }` | `{ t: "ok", re }`, dazu `instance`/`renamed` an alle |

**`send`** leitet weiter:

- `to`: ID einer Instanz des Namespace, oder `*` für alle anderen Instanzen des Namespace.
- `kind`: Art der Nachricht, 1 bis 64 Zeichen aus `A–Z a–z 0–9 . _ : / -`, beginnt mit Buchstabe oder
  Ziffer, z. B. `rc.request`. Der Server sieht sie im Klartext; sie sollte nichts verraten, was nicht
  ohnehin aus Zeitpunkt und Größe folgt.
- `body`: beliebiges JSON, das der Server unverändert weiterreicht. Gedacht ist der Chiffretext als
  base64url-String (Format: siehe „Hinweise für Clients“).

Beim Empfänger kommt an:

```json
{ "t": "msg", "id": "m1", "from": "<Absender>", "to": "<Empfänger oder *>", "kind": "rc.request", "body": "…" }
```

Ist das Ziel nicht verbunden, antwortet der Server mit `unreachable`. Er speichert nichts für später;
Remote Control braucht beide Seiten online. Bei `*` gibt es keine Fehler für einzelne Empfänger.

**`remove`** geht für jede Instanz des Namespace, auch für die eigene (Gerät abmelden). Die entfernte
Instanz wird mit 4403 getrennt.

**`rename`** ohne `instance` benennt die eigene Instanz um.

### Ereignisse

| Ereignis | An wen | Wann |
|---|---|---|
| `{ t: "instance", event: "joined", instance }` | alle Verbundenen | ein Gerät hat sich mit `POST /v1/join` gekoppelt |
| `{ t: "instance", event: "online", instance }` | alle anderen | eine Instanz hat sich angemeldet |
| `{ t: "instance", event: "offline", instance }` | alle anderen | ihre Verbindung ist zu |
| `{ t: "instance", event: "renamed", instance }` | alle, auch der Auslöser | umbenannt |
| `{ t: "removed", instance: "<ID>" }` | alle übrigen | entfernt, auch durch den Admin |

Nach `removed` kommt für diese Instanz kein `offline` mehr. Ersetzt eine neue Verbindung derselben
Instanz die alte, gibt es weder `offline` noch `online`.

### Fehler

```json
{ "t": "error", "re": "m1", "code": "unreachable", "message": "the instance is not connected" }
```

`re` fehlt, wenn der Server die `id` nicht lesen konnte. `message` ist Englisch und für Entwickler; dem
Nutzer zeigt man etwas anhand von `code`.

| `code` | Bedeutung |
|---|---|
| `bad-request` | Nachricht oder Feld ungültig. Die Verbindung bleibt offen |
| `unknown-instance` | Keine Instanz dieses Namespace. Fremde Namespaces sehen genauso aus |
| `unreachable` | Die Instanz gibt es, sie ist aber nicht verbunden |
| `busy` | Die Instanz liest zu langsam; später noch einmal versuchen |
| `rate-limited` | Zu viele Nachrichten; diese wurde verworfen |
| `internal` | Fehler im Server |

### Schließen der Verbindung

| Code | Bedeutung | Was der Client tun sollte |
|---|---|---|
| 1001 | Server fährt herunter | Später neu verbinden |
| 1009 | Nachricht zu groß (`NEXA_MAX_MESSAGE_KB`) | Neu verbinden, kleinere Nachrichten senden |
| 4401 | Anmeldung fehlgeschlagen: falsche Signatur, 10 s ohne `auth`, oder vorher etwas anderes gesendet | Fehler zeigen, nicht in Schleife neu verbinden |
| 4403 | Die Instanz gibt es nicht mehr (entfernt) | Kopplung vergessen, Schlüssel löschen |
| 4409 | Eine neuere Verbindung derselben Instanz hat übernommen | Nicht automatisch neu verbinden, sonst verdrängen sich beide ständig |

Der Server schickt alle 30 Sekunden ein Ping; wer bis zum nächsten nicht mit Pong antwortet, wird
getrennt. Browser und Node antworten von selbst. Wer neu verbindet, sollte zwischen den Versuchen
zunehmend länger warten.

## Kopplungscode

Den Kopplungscode erzeugt und liest nur der Client; der Server kennt ihn nicht. Ein schon gekoppeltes
Gerät holt mit `invite` eine Einladung und zeigt den Code als QR-Code (Handy) oder als Text zum Kopieren
(Desktop):

```
nexa1:<base64url(UTF-8-JSON)>
```

```json
{ "u": "https://nexa.example.com", "c": "8MXK-GQDC-2QSY-7QM6-NJ9A-T274-Y96X-PGBC", "k": "<32 Byte, base64url>" }
```

| Feld | Inhalt |
|---|---|
| `u` | Adresse des Servers, HTTPS. Der WebSocket liegt unter derselben Adresse: `wss://…/v1/ws` |
| `c` | Einladungscode für `POST /v1/join` |
| `k` | Schlüssel des Namespace (AES-256), roh |

Das neue Gerät koppelt sich mit `c`, verbindet sich und stellt sich mit `k` vor (siehe unten). Der Code ist
so geheim wie der Schlüssel des Namespace: nur zeigen, nie über den Server schicken. Unbekannte Felder
ignorieren, damit spätere Versionen Felder ergänzen können; das Präfix `nexa1:` ändert sich nur, wenn sich
die Bedeutung der bestehenden Felder ändert.

Für das erste Gerät gibt es keinen Kopplungscode. Man trägt die Adresse und den Einladungscode des Admins
ein, und das Gerät erzeugt den Schlüssel des Namespace selbst.

## Hinweise für Clients

Der Server ist für Inhalte nicht vertrauenswürdig. Was er über Instanzen sagt, ist eine Behauptung:

1. **Mitglieder nur über den Schlüssel des Namespace anerkennen.** Der Server könnte eine eigene Instanz in
   die Liste setzen. Bekäme die beim nächsten Schlüsselwechsel den neuen Schlüssel, wäre die
   Verschlüsselung dahin. Deshalb stellt sich ein neues Gerät nach der Kopplung mit einer Nachricht vor,
   die mit `k` verschlüsselt ist und seine ID, `signKey` und `dhKey` enthält. Die anderen Geräte führen
   eine eigene Liste anerkannter Instanzen und schicken neue Schlüssel nur an diese.
2. **Kopfdaten mitverschlüsseln.** AES-GCM mit `from`, `to`, `kind` und `id` als Associated Data, damit
   der Server Chiffretext nicht umleiten oder als andere Art ausgeben kann. Eine `id` nur einmal annehmen,
   damit er nichts wiederholen kann.
3. **Absender prüfen, wo es zählt.** Den Schlüssel des Namespace kennen alle Geräte; `from` setzt der
   Server. Wo es auf den Absender ankommt (Remote Control mit Stufen je Gerät), muss der Host ihn selbst
   prüfen, z. B. mit einer Signatur der Instanz über die Nachricht (eigener Kontext-String, nicht der der
   Anmeldung) oder mit einem paarweisen Schlüssel aus ECDH.
4. **Nach `removed` den Schlüssel wechseln.** Ein Gerät erzeugt einen neuen Schlüssel und schickt ihn per
   ECDH an jede verbliebene anerkannte Instanz.
