type Listener = (...args: unknown[]) => void

/**
 * The desktop app's TypedEmitter (src/main/lib/typed-emitter.ts) for the browser, without node:events:
 * the client files copied from the app (connection, membership, remote client) import it from here.
 */
export class TypedEmitter<Events extends Record<string, unknown[]>> {
  private readonly listeners = new Map<string, Set<Listener>>()

  on<K extends keyof Events & string>(event: K, listener: (...args: Events[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    const entry = listener as Listener
    set.add(entry)
    return () => set.delete(entry)
  }

  protected emit<K extends keyof Events & string>(event: K, ...args: Events[K]): void {
    // A copy: a listener may take itself off, or add another, while this runs.
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      // Like node:events, one listener's error doesn't keep the others from hearing it; unlike it, it
      // doesn't throw at the emitter either, which in a browser would only end up in the console anyway.
      try {
        listener(...args)
      } catch (error) {
        console.error(error)
      }
    }
  }
}
