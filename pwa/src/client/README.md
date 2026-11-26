# Client

Die Verbindung der Web-App zum Server und zu den Computern. Ein Teil ist der Code der Desktop-App, Byte für
Byte, damit beide sich gleich verhalten, vor allem bei den Regeln der Mitgliedschaft:

| Datei | Herkunft |
|---|---|
| `server-link/connection.ts` | Kopie von `nexa-app/src/main/server-link/connection.ts` |
| `server-link/device-channel.ts` | Kopie von `nexa-app/src/main/server-link/device-channel.ts` |
| `server-link/membership.ts` | Kopie von `nexa-app/src/main/server-link/membership.ts` |
| `remote/remote-client.ts` | Kopie von `nexa-app/src/main/remote/remote-client.ts` |
| `server-link/link-store.ts` | eigene: `Identity` mit nicht exportierbaren Schlüsseln, Speicher in IndexedDB |
| `lib/typed-emitter.ts` | eigene: `TypedEmitter` der App ohne `node:events` |
| `link-service.ts` | eigene: Koppeln per Kopplungscode als Steuerung, Verbindung, Speichern |
| `index.ts` | eigene: ein Dienst und ein Remote-Client je Seite |

Die Kopien nicht von Hand ändern, sondern in der App, danach `npm run sync:app`. Sie importieren `@shared/…`
(Alias auf `../shared`) und relativ `../lib/typed-emitter`, `./link-store` und `../server-link/device-channel`;
diese Stellen stellt die Web-App selbst bereit. Kommt in der App ein Import dazu, schlägt `npm run typecheck`
an.
