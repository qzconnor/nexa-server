# Geteilter Code

Alles hier ist eine Kopie aus `nexa-app/src/shared`, Byte für Byte: Themes, Chat-Modell, Remote Control,
Umschlag, Mitglieder, Kopplungscode und was diese importieren. Ausnahmen sind `nexa-server/protocol.ts` und
`nexa-server/auth.ts`, deren Originale in `src/` dieses Repos liegen (die App kopiert sie von hier).

Nicht von Hand ändern. Änderungen gehören in die App (oder nach `src/`), danach abgleichen:

```sh
node scripts/sync-from-app.ts           # kopieren (nexa-app neben diesem Repo oder NEXA_APP_DIR)
node scripts/sync-from-app.ts --check   # nur vergleichen
```
