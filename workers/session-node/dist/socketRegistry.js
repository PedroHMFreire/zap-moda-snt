const sockets = new Map();
export function setSocket(sessionId, sock) {
    sockets.set(sessionId, sock);
}
export function getSocket(sessionId) {
    return sockets.get(sessionId);
}
export function removeSocket(sessionId) {
    sockets.delete(sessionId);
}
