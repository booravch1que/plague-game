import { SERVER_EVENTS, type ClientEventName, type ServerMessage } from '@plague/protocol';
import { io } from 'socket.io-client';
import { AppController } from '../controller';
import { safeStorage } from './storage';

interface ViteEnv {
  env?: Record<string, string | undefined>;
}

/** Creates the controller and wires it to a Socket.IO connection. */
export function startApp(options: { onUrlChange?: (code: string | null) => void } = {}): AppController {
  const serverUrl = (import.meta as unknown as ViteEnv).env?.['VITE_SERVER_URL'];
  const socket = serverUrl ? io(serverUrl) : io();

  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const app = new AppController({
    send: (event: ClientEventName, data?: unknown) => void socket.emit(event, data),
    storage: safeStorage(),
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    browserLanguage: globalThis.navigator?.language,
    initialInvite: params.get('join') ?? '',
    onUrlChange: options.onUrlChange,
  });

  socket.on('connect', () => app.handleStatus('online'));
  socket.on('disconnect', () => app.handleStatus('offline'));
  socket.on('connect_error', () => app.handleStatus('offline'));
  for (const event of SERVER_EVENTS) {
    socket.on(event, (data: unknown) => app.handleMessage({ event, data } as ServerMessage));
  }
  return app;
}
