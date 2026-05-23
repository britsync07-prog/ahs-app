import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket(url: string | null, publicKey: string | null) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<unknown>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (!url || !publicKey || socketRef.current) return;

    // Convert http(s) to ws(s) if necessary
    const wsUrl = url.replace(/^http/, 'ws') + '/api/ws/connect';
    const socket = new WebSocket(`${wsUrl}?public_key=${encodeURIComponent(publicKey)}`);

    socket.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      
      // Register mobile device
      socket.send(JSON.stringify({
        type: 'mobile_register',
        public_key: publicKey
      }));
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('WebSocket message received:', message);
        
        if (message.type === 'push_relay') {
          setLastMessage(message.encrypted_blob);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message', err);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      socketRef.current = null;
      // Reconnect after 3 seconds
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectRef.current();
      }, 3000);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      socket.close();
    };

    socketRef.current = socket;
  }, [url, publicKey]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (url && publicKey) {
      connect();
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [url, publicKey, connect]);

  const sendMessage = useCallback((type: string, data: Record<string, unknown>) => {
    if (socketRef.current && isConnected) {
      socketRef.current.send(JSON.stringify({ type, ...data }));
    }
  }, [isConnected]);

  return { isConnected, lastMessage, sendMessage };
}
