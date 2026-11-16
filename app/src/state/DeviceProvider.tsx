import { createContext, useCallback, useContext, useRef, useState, type PropsWithChildren } from 'react';
import WatchNative from '../../modules/watch-haptics';
import { displayMessage } from '../ui/displayMessage';

type WatchState = { connected: boolean; connecting: boolean; status: string; ensureWatch: () => Promise<boolean>; reportWatchError: (error: unknown) => void };
const DeviceContext = createContext<WatchState | null>(null);
export function DeviceProvider({ children }: PropsWithChildren) {
  const [connected, setConnected] = useState(false), [connecting, setConnecting] = useState(false), [status, setStatus] = useState('Open the watch app to connect.');
  const connectedRef = useRef(false), pending = useRef<Promise<boolean> | null>(null);
  const reportWatchError = useCallback((error: unknown) => { connectedRef.current = false; setConnected(false); setStatus(displayMessage(error)); }, []);
  const ensureWatch = useCallback((): Promise<boolean> => {
    if (!WatchNative) return Promise.resolve(false);
    if (connectedRef.current) return Promise.resolve(true);
    if (pending.current) return pending.current;
    setConnecting(true); setStatus('Connecting to watch…');
    const request = WatchNative.connect().then(watch => { connectedRef.current = true; setConnected(true); setStatus(`${watch.name} connected`); return true; }).catch(error => { reportWatchError(error); return false; }).finally(() => { pending.current = null; setConnecting(false); });
    pending.current = request; return request;
  }, [reportWatchError]);
  return <DeviceContext.Provider value={{ connected, connecting, status, ensureWatch, reportWatchError }}>{children}</DeviceContext.Provider>;
}
export function useDevice() { const context = useContext(DeviceContext); if (!context) throw new Error('DeviceProvider required'); return context; }
