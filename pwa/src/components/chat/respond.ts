import type { InjectionKey } from 'vue'
import type { InteractionResponse } from '../../shared/chat'

/** Answers the questions of a chat's agent at the computer (`sessions:respond`). */
export interface Responder {
  /** The computer lets this device answer (level `full`); else the card says what it takes. */
  allowed(): boolean
  respond(itemId: string, response: InteractionResponse): Promise<void>
}

/** Given by the chat page to the cards in its timeline, however deep (a subagent's questions too). */
export const RESPONDER: InjectionKey<Responder> = Symbol('responder')
