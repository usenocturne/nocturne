import { addGlobalWsListener } from '../hooks/useNocturned';
import { checkNetworkConnectivity } from './networkChecker';

const LOCAL_URLS = ['172.16.42.1', 'localhost'];
let currentNetworkCheckPromise = null;
let isConnected = true;
let listeners = new Set();
let lastNetworkRestoredTime = 0;
export const DNS_READY_DELAY = 5000;

function isLocalRequest(url) {
  if (!url) return false;
  return LOCAL_URLS.some(localUrl => url.includes(localUrl));
}

function setupNetworkMonitoring() {
  if (typeof window === 'undefined') return () => {};

  let lastStatusUpdate = 0;
  const MIN_STATUS_UPDATE_INTERVAL = 5000;

  const updateNetworkStatus = (data) => {
    if (data.type === 'network_status') {
      const now = Date.now();
      if (now - lastStatusUpdate < MIN_STATUS_UPDATE_INTERVAL) {
        return;
      }
      lastStatusUpdate = now;

      const isOnline = data.payload?.status === 'online';
      const wasOffline = !isConnected;
      isConnected = isOnline;
      
      if (isOnline && wasOffline) {
        lastNetworkRestoredTime = Date.now();
        window.dispatchEvent(new CustomEvent('networkRestored'));
      }

      window.dispatchEvent(new Event(isOnline ? 'online' : 'offline'));

      listeners.forEach(listener => {
        if (isOnline) {
          listener.resolve();
        }
      });
      listeners.clear();
    }
  };

  const listenerId = 'networkAwareRequest-' + Date.now();
  return addGlobalWsListener(listenerId, {
    onMessage: updateNetworkStatus,
    onClose: () => {
      isConnected = false;
    }
  });
}

let cleanupRef = setupNetworkMonitoring();

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export function waitForNetwork(checkIntervalMs = 1000) {
  return new Promise((resolve) => {
    if (navigator.onLine) {
      resolve();
      return;
    }

    const handleOnline = () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('browserOnlyModeOnline', handleOnline);
      resolve();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('browserOnlyModeOnline', handleOnline);
  });
}

export async function networkAwareRequest(requestFn, retryCount = 0) {
  try {
    const requestInfo = await requestFn();
    const isAuthRequest = requestInfo?.url?.includes('accounts.spotify.com');
    
    if (!navigator.onLine && !isAuthRequest) {
      throw new Error('No network connection');
    }

    const response = await requestInfo;
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }

    if (retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return networkAwareRequest(requestFn, retryCount + 1);
    }

    throw error;
  }
}

window.addEventListener('unload', () => {
  if (cleanupRef) {
    cleanupRef();
  }
});
