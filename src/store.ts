/**
 * Namespaces, instances and invites in SQLite. The admin CLI opens the same file from a second process
 * while the server runs, hence WAL and a busy timeout; the server re-reads instances from here instead of
 * trusting its memory, so a removal through the CLI takes effect.
 */

import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { generateInviteCode, hashInviteCode, isNamespaceName, randomId } from './codes.ts'
import type { Role } from './protocol.ts'

export interface NamespaceRecord {
  name: string
  createdAt: number
  instances: number
}

export interface InstanceRecord {
  id: string
  namespace: string
  name: string
  role: Role
  signKey: string
  dhKey: string
  createdAt: number
  lastSeen: number | null
}

export interface NewInstance {
  name: string
  role: Role
  signKey: string
  dhKey: string
}

export interface Invite {
  code: string
  expiresAt: number
}

export type StoreErrorCode =
  | 'namespace-invalid'
  | 'namespace-exists'
  | 'namespace-unknown'
  | 'invite-invalid'
  | 'namespace-full'

/** Expected failures; the message is German because the CLI prints it as it is. */
export class StoreError extends Error {
  readonly code: StoreErrorCode
  constructor(code: StoreErrorCode, message: string) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

export interface StoreOptions {
  maxInstances: number
  now?: () => number
}

const SCHEMA_VERSION = 1

const SCHEMA_V1 = `
  CREATE TABLE namespaces (
    name TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE instances (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL REFERENCES namespaces(name) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('host', 'controller')),
    sign_key TEXT NOT NULL,
    dh_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER
  ) STRICT;
  CREATE INDEX instances_by_namespace ON instances(namespace);

  -- An invite made by an instance dies with it: a removed (maybe stolen) device must not keep a way in.
  CREATE TABLE invites (
    hash TEXT PRIMARY KEY,
    namespace TEXT NOT NULL REFERENCES namespaces(name) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_by TEXT REFERENCES instances(id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX invites_by_namespace ON invites(namespace);
  CREATE INDEX invites_by_creator ON invites(created_by);
`

interface InstanceRow {
  id: string
  namespace: string
  name: string
  role: Role
  sign_key: string
  dh_key: string
  created_at: number
  last_seen: number | null
}

export class Store {
  readonly #db: DatabaseSync
  readonly #maxInstances: number
  readonly #now: () => number
  readonly #statements = new Map<string, StatementSync>()

  /** `path` may be `:memory:` (tests). */
  constructor(path: string, options: StoreOptions) {
    this.#db = new DatabaseSync(path)
    this.#maxInstances = options.maxInstances
    this.#now = options.now ?? Date.now
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `)
    this.#migrate()
  }

  close(): void {
    this.#db.close()
  }

  /** For `/health`: throws if the database does not answer. */
  ping(): void {
    this.#get('SELECT 1')
  }

  // --- Namespaces ---------------------------------------------------------------------------------

  createNamespace(name: string): void {
    if (!isNamespaceName(name)) {
      throw new StoreError(
        'namespace-invalid',
        `„${name}“ geht nicht als Name: 1 bis 32 Zeichen aus a–z, 0–9 und „-“, am Anfang kein „-“.`,
      )
    }
    this.#transaction(() => {
      if (this.hasNamespace(name)) throw new StoreError('namespace-exists', `Den Namespace „${name}“ gibt es schon.`)
      this.#run('INSERT INTO namespaces (name, created_at) VALUES (?, ?)', name, this.#now())
    })
  }

  hasNamespace(name: string): boolean {
    return this.#get('SELECT 1 FROM namespaces WHERE name = ?', name) !== undefined
  }

  getNamespace(name: string): NamespaceRecord | undefined {
    return this.listNamespaces().find((namespace) => namespace.name === name)
  }

  listNamespaces(): NamespaceRecord[] {
    const rows = this.#all(`
      SELECT n.name, n.created_at, COUNT(i.id) AS instances
      FROM namespaces n LEFT JOIN instances i ON i.namespace = n.name
      GROUP BY n.name ORDER BY n.name
    `) as { name: string; created_at: number; instances: number }[]
    return rows.map((row) => ({ name: row.name, createdAt: row.created_at, instances: row.instances }))
  }

  /** Deletes the namespace with its instances and invites. */
  deleteNamespace(name: string): boolean {
    return this.#run('DELETE FROM namespaces WHERE name = ?', name).changes > 0
  }

  // --- Invites ------------------------------------------------------------------------------------

  /** `createdBy`: the instance that asked for it, or null for the admin. */
  createInvite(namespace: string, ttlMs: number, createdBy: string | null = null): Invite {
    if (!this.hasNamespace(namespace)) {
      throw new StoreError('namespace-unknown', `Den Namespace „${namespace}“ gibt es nicht.`)
    }
    this.pruneInvites()
    const code = generateInviteCode()
    const expiresAt = this.#now() + ttlMs
    this.#run(
      'INSERT INTO invites (hash, namespace, expires_at, created_by) VALUES (?, ?, ?, ?)',
      hashInviteCode(code)!,
      namespace,
      expiresAt,
      createdBy,
    )
    return { code, expiresAt }
  }

  /**
   * Turns an invite into a new instance, all or nothing: the invite is gone exactly when the instance
   * exists. Unknown, used and expired invites fail alike, so a failure tells nothing about a code.
   */
  redeemInvite(code: string, instance: NewInstance): InstanceRecord {
    const invalid = (): StoreError => new StoreError('invite-invalid', 'Die Einladung gilt nicht (mehr).')
    const hash = hashInviteCode(code)
    if (hash === null) throw invalid()
    return this.#transaction(() => {
      const invite = this.#get('SELECT namespace, expires_at FROM invites WHERE hash = ?', hash) as
        | { namespace: string; expires_at: number }
        | undefined
      if (!invite || invite.expires_at <= this.#now()) throw invalid()
      const { count } = this.#get('SELECT COUNT(*) AS count FROM instances WHERE namespace = ?', invite.namespace) as {
        count: number
      }
      if (count >= this.#maxInstances) {
        throw new StoreError(
          'namespace-full',
          `Der Namespace „${invite.namespace}“ hat schon ${count} Instanzen, mehr erlaubt dieser Server nicht.`,
        )
      }
      this.#run('DELETE FROM invites WHERE hash = ?', hash)
      const record: InstanceRecord = {
        id: randomId(),
        namespace: invite.namespace,
        ...instance,
        createdAt: this.#now(),
        lastSeen: null,
      }
      this.#run(
        `INSERT INTO instances (id, namespace, name, role, sign_key, dh_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        record.id,
        record.namespace,
        record.name,
        record.role,
        record.signKey,
        record.dhKey,
        record.createdAt,
      )
      return record
    })
  }

  /** Open invites of a namespace, for the CLI. */
  countInvites(namespace: string): number {
    const row = this.#get('SELECT COUNT(*) AS count FROM invites WHERE namespace = ? AND expires_at > ?', namespace, this.#now())
    return (row as { count: number }).count
  }

  pruneInvites(): number {
    return Number(this.#run('DELETE FROM invites WHERE expires_at <= ?', this.#now()).changes)
  }

  // --- Instances ----------------------------------------------------------------------------------

  getInstance(id: string): InstanceRecord | undefined {
    const row = this.#get('SELECT * FROM instances WHERE id = ?', id) as InstanceRow | undefined
    return row && toInstance(row)
  }

  hasInstance(id: string): boolean {
    return this.#get('SELECT 1 FROM instances WHERE id = ?', id) !== undefined
  }

  listInstances(namespace: string): InstanceRecord[] {
    const rows = this.#all('SELECT * FROM instances WHERE namespace = ? ORDER BY created_at, id', namespace)
    return (rows as InstanceRow[]).map(toInstance)
  }

  removeInstance(id: string): boolean {
    return this.#run('DELETE FROM instances WHERE id = ?', id).changes > 0
  }

  renameInstance(id: string, name: string): boolean {
    return this.#run('UPDATE instances SET name = ? WHERE id = ?', name, id).changes > 0
  }

  /** Sets „last seen“ to now; false if the instance no longer exists, which doubles as the check for it. */
  touchInstance(id: string): boolean {
    return this.#run('UPDATE instances SET last_seen = ? WHERE id = ?', this.#now(), id).changes > 0
  }

  // --- Internals ----------------------------------------------------------------------------------

  #migrate(): void {
    const { user_version: version } = this.#get('PRAGMA user_version') as { user_version: number }
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `Die Datenbank hat Schema ${version}, dieser nexa-server kennt nur bis ${SCHEMA_VERSION}. Bitte nexa-server aktualisieren.`,
      )
    }
    if (version === SCHEMA_VERSION) return
    this.#transaction(() => {
      if (version < 1) this.#db.exec(SCHEMA_V1)
      this.#db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    })
  }

  // IMMEDIATE takes the write lock up front, so the CLI and the server cannot both read, then write.
  #transaction<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.#db.exec('COMMIT')
      return result
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  #statement(sql: string): StatementSync {
    let statement = this.#statements.get(sql)
    if (!statement) {
      statement = this.#db.prepare(sql)
      this.#statements.set(sql, statement)
    }
    return statement
  }

  #get(sql: string, ...params: SQLInputValue[]): unknown {
    return this.#statement(sql).get(...params)
  }

  #all(sql: string, ...params: SQLInputValue[]): unknown[] {
    return this.#statement(sql).all(...params)
  }

  #run(sql: string, ...params: SQLInputValue[]): { changes: number | bigint } {
    return this.#statement(sql).run(...params)
  }
}

function toInstance(row: InstanceRow): InstanceRecord {
  return {
    id: row.id,
    namespace: row.namespace,
    name: row.name,
    role: row.role,
    signKey: row.sign_key,
    dhKey: row.dh_key,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
  }
}
