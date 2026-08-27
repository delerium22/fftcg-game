import { describeFailure, respond, type WorkerInit, type WorkerRequestMessage, type WorkerResponseMessage } from './protocol.js'

/**
 * The worker shell (spec D2 layer 2). Vitest cannot drive a real `Worker`, so there is deliberately nothing
 * here worth testing: every decision lives in `respond` (pure) or `SearchCoordinator` (injectable transport).
 *
 * `self` is typed by hand rather than via `/// <reference lib="webworker" />`, because this file compiles in
 * the same program as the DOM app and the two libs redeclare each other.
 */
const ctx = self as unknown as {
  postMessage(message: WorkerResponseMessage): void
  onmessage: ((event: MessageEvent<WorkerRequestMessage>) => void) | null
}

let init: WorkerInit | null = null

const send = (message: WorkerResponseMessage): void => {
  try {
    ctx.postMessage(message)
  } catch (e) {
    // The only way this fires is a result that will not clone. Report it, so the coordinator falls back
    // instead of waiting out its watchdog on a search that actually succeeded.
    ctx.postMessage({ type: 'error', requestId: message.type === 'result' ? message.requestId : null, message: describeFailure(e) })
  }
}

ctx.onmessage = (event: MessageEvent<WorkerRequestMessage>): void => {
  const message = event.data
  try {
    if (message.type === 'init') {
      init = message
      return
    }
    if (!init) {
      send({ type: 'error', requestId: message.requestId, message: 'search worker received a request before init' })
      return
    }
    send(respond(init, message))
  } catch (e) {
    send({ type: 'error', requestId: message.type === 'search' ? message.requestId : null, message: describeFailure(e) })
  }
}
