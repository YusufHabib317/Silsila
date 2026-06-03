import { WASocket } from 'baileys'

// Maps accountId → its live Baileys socket. The media processor uses this to get
// `updateMediaMessage` (reupload) when a media CDN URL has expired. Lives in-process
// because the processor and the sockets share the worker process.
const sockets = new Map<string, WASocket>()

export const socketRegistry = {
  register(accountId: string, sock: WASocket): void {
    sockets.set(accountId, sock)
  },
  // Only clear if the current socket matches — avoids a stale close wiping a fresh
  // reconnect's socket.
  unregister(accountId: string, sock?: WASocket): void {
    if (!sock || sockets.get(accountId) === sock) sockets.delete(accountId)
  },
  get(accountId: string): WASocket | undefined {
    return sockets.get(accountId)
  },
}
