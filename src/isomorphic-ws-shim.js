import ws from 'ws';

const WebSocketImpl = typeof window !== 'undefined' ? window.WebSocket : ws;

export { WebSocketImpl as WebSocket };
export default WebSocketImpl;
