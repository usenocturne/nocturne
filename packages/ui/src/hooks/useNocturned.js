import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = 'http://localhost:5000';

let globalWsRef = null;
let globalWsListeners = [];
let wsInitialized = false;
let isReconnecting = false;

let isInitializingDiscovery = false;
let isStoppingDiscovery = false;
let isDevicesFetching = false;

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_TIMEOUT = 5000;

const setupGlobalWebSocket = () => {
  if (globalWsRef || isReconnecting) return;

  try {
    isReconnecting = true;
    console.log('Connecting to WebSocket...');

    const socket = new WebSocket(`ws://${API_BASE.replace('http://', '')}/ws`);
    globalWsRef = socket;

    socket.onopen = () => {
      console.log('Connected to WebSocket');
      isReconnecting = false;
      globalWsListeners.forEach(listener => listener.onOpen && listener.onOpen(socket));
    };

    socket.onclose = () => {
      console.log('Disconnected from WebSocket');
      globalWsListeners.forEach(listener => listener.onClose && listener.onClose());
      globalWsRef = null;
      isReconnecting = false;

      setTimeout(() => {
        setupGlobalWebSocket();
      }, 2000);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        globalWsListeners.forEach(listener => listener.onMessage && listener.onMessage(data));
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    };

    socket.onerror = (err) => {
      console.error('WebSocket error:', err);
      globalWsListeners.forEach(listener => listener.onError && listener.onError(err));
      isReconnecting = false;
      socket.close();
    };
  } catch (error) {
    console.error('Error setting up WebSocket:', error);
    isReconnecting = false;

    setTimeout(() => {
      setupGlobalWebSocket();
    }, 2000);
  }
};

export const useNocturned = () => {
  const [wsConnected, setWsConnected] = useState(false);
  const listenerIdRef = useRef(null);

  useEffect(() => {
    if (!wsInitialized) {
      setupGlobalWebSocket();
      wsInitialized = true;
    }

    const listenerId = `nocturned-${Date.now()}`;
    listenerIdRef.current = listenerId;

    globalWsListeners.push({
      id: listenerId,
      onOpen: () => {
        setWsConnected(true);
      },
      onClose: () => {
        setWsConnected(false);
      },
      onError: () => {
        setWsConnected(false);
      }
    });

    if (globalWsRef && globalWsRef.readyState === WebSocket.OPEN) {
      setWsConnected(true);
    }

    return () => {
      globalWsListeners = globalWsListeners.filter(
        listener => listener.id !== listenerId
      );
    };
  }, []);

  const apiRequest = useCallback(async (endpoint, method = 'GET', body = null) => {
    const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    try {
      const options = {
        method,
        headers: {},
      };

      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API request failed: ${url}`, error);
      throw error;
    }
  }, []);

  const addMessageListener = useCallback((id, messageHandler) => {
    const listenerId = `${id}-${Date.now()}`;

    globalWsListeners.push({
      id: listenerId,
      onMessage: messageHandler
    });

    return listenerId;
  }, []);

  const removeMessageListener = useCallback((listenerId) => {
    globalWsListeners = globalWsListeners.filter(
      listener => listener.id !== listenerId
    );
  }, []);

  return {
    wsConnected,
    apiRequest,
    addMessageListener,
    removeMessageListener
  };
};

export const useSystemUpdate = () => {
  const { wsConnected, apiRequest, addMessageListener, removeMessageListener } = useNocturned();

  const [updateStatus, setUpdateStatus] = useState({
    inProgress: false,
    stage: '',
    error: ''
  });
  const [progress, setProgress] = useState({
    bytesComplete: 0,
    bytesTotal: 0,
    speed: 0,
    percent: 0
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const listenerIdRef = useRef(null);
  const lastSuccessfulStageRef = useRef(null);

  const checkUpdateStatus = useCallback(async () => {
    try {
      const status = await apiRequest('/update/status');
      setUpdateStatus(status);
      setIsUpdating(status.inProgress);

      if (status.stage) {
        lastSuccessfulStageRef.current = status.stage;
      }

      if (status.error) {
        setIsError(true);
        setErrorMessage(status.error);
      } else {
        setIsError(false);
        setErrorMessage('');
      }

      return status;
    } catch (error) {
      console.error('Error checking update status:', error);
      return null;
    }
  }, [apiRequest]);

  const startUpdate = useCallback(async (imageURL, sumURL) => {
    try {
      setIsUpdating(true);
      setIsError(false);
      setErrorMessage('');

      setProgress({
        bytesComplete: 0,
        bytesTotal: 0,
        speed: 0,
        percent: 0
      });

      const data = await apiRequest('/update', 'POST', {
        image_url: imageURL,
        sum_url: sumURL
      });

      return data;
    } catch (error) {
      console.error('Error starting update:', error);
      setIsUpdating(false);
      setIsError(true);
      setErrorMessage(`Failed to start update: ${error.message}`);
      return null;
    }
  }, [apiRequest]);

  const handleWsMessage = useCallback((data) => {
    if (data.type === 'progress') {
      setProgress({
        bytesComplete: data.bytes_complete,
        bytesTotal: data.bytes_total,
        speed: data.speed,
        percent: data.percent
      });

      if (data.stage) {
        lastSuccessfulStageRef.current = data.stage;
        setUpdateStatus(prev => ({
          ...prev,
          stage: data.stage,
          inProgress: true
        }));
      }
    } else if (data.type === 'completion') {
      if (data.success) {
        setUpdateStatus(prev => ({
          ...prev,
          inProgress: false,
          stage: 'complete'
        }));
        setIsUpdating(false);
      } else {
        setIsError(true);
        setErrorMessage(data.error || 'Update failed');
        setIsUpdating(false);
        setUpdateStatus(prev => ({
          ...prev,
          inProgress: false,
          error: data.error || 'Update failed'
        }));
      }

      checkUpdateStatus();
    }
  }, [checkUpdateStatus]);

  useEffect(() => {
    let statusIntervalId = null;

    if (isUpdating) {
      statusIntervalId = setInterval(() => {
        checkUpdateStatus();
      }, 5000);
    }

    return () => {
      if (statusIntervalId) {
        clearInterval(statusIntervalId);
      }
    };
  }, [isUpdating, checkUpdateStatus]);

  useEffect(() => {
    const listenerId = addMessageListener('system-update', handleWsMessage);
    listenerIdRef.current = listenerId;

    checkUpdateStatus();

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
    };
  }, [addMessageListener, removeMessageListener, handleWsMessage, checkUpdateStatus]);

  return {
    updateStatus,
    progress,
    isUpdating,
    isError,
    errorMessage,
    wsConnected,
    startUpdate,
    checkUpdateStatus
  };
};

export const useBluetooth = () => {
  const { wsConnected, apiRequest, addMessageListener, removeMessageListener } = useNocturned();

  const [pairingRequest, setPairingRequest] = useState(null);
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showNetworkPrompt, setShowNetworkPrompt] = useState(false);
  const [lastConnectedDevice, setLastConnectedDevice] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [networkStartRef, setNetworkStartRef] = useState(null);
  const [networkPollRef, setNetworkPollRef] = useState(null);

  const isReconnecting = useRef(false);
  const listenerIdRef = useRef(null);
  const discoveryActive = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);

  const stopNetworkPolling = useCallback(() => {
    if (networkPollRef) {
      clearInterval(networkPollRef);
      setNetworkPollRef(null);
    }
    if (networkStartRef) {
      clearInterval(networkStartRef);
      setNetworkStartRef(null);
    }
  }, []);

  const fetchDevices = useCallback(async (force = false) => {
    if (isDevicesFetching && !force) {
      return [];
    }

    try {
      isDevicesFetching = true;
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE}/bluetooth/devices`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Failed to fetch devices');
      }

      const data = await response.json();
      setDevices(data);
      return data;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
      isDevicesFetching = false;
    }
  }, []);

  const startNetworkPolling = useCallback(async (deviceAddress) => {
    if (networkPollRef || networkStartRef) return;

    const checkNetworkStatus = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const statusResponse = await fetch(`${API_BASE}/bluetooth/network`, {
          method: 'GET',
          signal: controller.signal
        });
        const data = await statusResponse.json();

        clearTimeout(timeoutId);
        return data.status;
      } catch (error) {
        console.error('Failed to check network status:', error);
        return 'down';
      }
    };

    const startNetwork = async () => {
      try {
        const status = await checkNetworkStatus();
        if (status === 'up') return;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        await fetch(`${API_BASE}/bluetooth/network/${deviceAddress}`, {
          method: 'POST',
          signal: controller.signal
        });

        clearTimeout(timeoutId);
      } catch (error) {
        console.error('Failed to start networking:', error);
      }
    };

    const initialStatus = await checkNetworkStatus();

    if (initialStatus === 'up') {
      setShowNetworkPrompt(false);
      setNetworkPollRef(setInterval(async () => {
        const status = await checkNetworkStatus();
        if (status === 'down') {
          setShowNetworkPrompt(true);
          await startNetwork();
          setNetworkStartRef(setInterval(startNetwork, 5000));
        }
      }, 5000));
    } else {
      setShowNetworkPrompt(true);
      await startNetwork();
      setNetworkPollRef(setInterval(async () => {
        const status = await checkNetworkStatus();
        if (status === 'up') {
          setShowNetworkPrompt(false);
          if (networkStartRef) {
            clearInterval(networkStartRef);
            setNetworkStartRef(null);
          }
        }
      }, 5000));
      setNetworkStartRef(setInterval(startNetwork, 5000));
    }
  }, []);

  const connectDevice = useCallback(async (deviceAddress) => {
    try {
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE}/bluetooth/connect/${deviceAddress}`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to connect device');
      }

      localStorage.setItem('lastConnectedBluetoothDevice', deviceAddress);
      await fetchDevices(true);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchDevices]);

  const disconnectDevice = useCallback(async (address) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE}/bluetooth/disconnect/${address}`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to disconnect device');

      localStorage.removeItem('lastConnectedBluetoothDevice');
      await fetchDevices(true);
      return true;
    } catch (error) {
      console.error('Error disconnecting:', error);
      return false;
    }
  }, [fetchDevices]);

  const forgetDevice = useCallback(async (deviceAddress) => {
    try {
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE}/bluetooth/remove/${deviceAddress}`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to remove device');
      }

      await fetchDevices(true);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchDevices]);

  const attemptReconnect = useCallback(async () => {
    if (isReconnecting.current || reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;

    const savedDeviceAddress = localStorage.getItem('lastConnectedBluetoothDevice');
    if (!savedDeviceAddress) return;

    isReconnecting.current = true;

    try {
      const devices = await fetchDevices(true);
      const deviceExists = devices.some(device => device.address === savedDeviceAddress);
      if (!deviceExists) {
        isReconnecting.current = false;
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE}/bluetooth/connect/${savedDeviceAddress}`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Reconnection failed');

      await fetchDevices(true);
      reconnectAttemptsRef.current = 0;
      isReconnecting.current = false;
    } catch (err) {
      reconnectAttemptsRef.current++;
      isReconnecting.current = false;

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(attemptReconnect, RECONNECT_TIMEOUT);
      }
    }
  }, [fetchDevices]);

  useEffect(() => {
    const savedDeviceAddress = localStorage.getItem('lastConnectedBluetoothDevice');
    if (savedDeviceAddress) {
      reconnectAttemptsRef.current = 0;
      attemptReconnect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [attemptReconnect]);

  const handleWsMessage = useCallback((data) => {
    switch (data.type) {
      case 'bluetooth/pairing':
        setPairingRequest(data.payload);
        break;

      case 'bluetooth/paired':
        setPairingRequest(null);
        setConnectedDevices(prev => [...prev, data.payload.device]);
        setLastConnectedDevice(data.payload.device);
        setShowNetworkPrompt(true);
        localStorage.setItem('lastConnectedBluetoothDevice', data.payload.device.address);
        startNetworkPolling(data.payload.device.address);
        break;

      case 'bluetooth/connect':
        setShowNetworkPrompt(true);
        startNetworkPolling(data.payload.address);
        break;

      case 'bluetooth/disconnect':
        setConnectedDevices(prev =>
          prev.filter(device => device.address !== data.payload.address)
        );
        if (lastConnectedDevice?.address === data.payload.address) {
          setShowNetworkPrompt(false);
          setLastConnectedDevice(null);
          stopNetworkPolling();
        }
        break;

      case 'bluetooth/network/disconnect':
        setShowNetworkPrompt(true);
        break;

      default:
        break;
    }
  }, [lastConnectedDevice, stopNetworkPolling, startNetworkPolling]);

  const startDiscovery = useCallback(async () => {
    if (discoveryActive.current || isInitializingDiscovery) {
      return true;
    }

    try {
      isInitializingDiscovery = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE}/bluetooth/discover/on`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Failed to start discovery');
      }
      discoveryActive.current = true;
      return true;
    } catch (err) {
      console.error('Error starting discovery:', err);
      return false;
    } finally {
      isInitializingDiscovery = false;
    }
  }, []);

  const stopDiscovery = useCallback(async () => {
    if (!discoveryActive.current || isStoppingDiscovery) {
      return;
    }

    try {
      isStoppingDiscovery = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      await fetch(`${API_BASE}/bluetooth/discover/off`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      discoveryActive.current = false;
    } catch (err) {
      console.error('Failed to stop discovery:', err);
    } finally {
      isStoppingDiscovery = false;
    }
  }, []);

  const setDiscoverable = useCallback(async (enabled) => {
    return enabled ? startDiscovery() : stopDiscovery();
  }, [startDiscovery, stopDiscovery]);

  const acceptPairing = useCallback(async () => {
    if (!pairingRequest) return;

    try {
      setIsConnecting(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE}/bluetooth/pairing/accept`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to accept pairing');
    } catch (error) {
      console.error('Error accepting pair:', error);
    } finally {
      setIsConnecting(false);
    }
  }, [pairingRequest]);

  const denyPairing = useCallback(async () => {
    if (!pairingRequest) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE}/bluetooth/pairing/deny`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to deny pairing');
      setPairingRequest(null);
    } catch (error) {
      console.error('Error denying pair:', error);
    }
  }, [pairingRequest]);

  const enableNetworking = useCallback(async () => {
    if (!lastConnectedDevice) return;
    startNetworkPolling(lastConnectedDevice.address);
  }, [lastConnectedDevice, startNetworkPolling]);

  useEffect(() => {
    const listenerId = addMessageListener('bluetooth', handleWsMessage);
    listenerIdRef.current = listenerId;

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
      stopNetworkPolling();
    };
  }, [addMessageListener, removeMessageListener, handleWsMessage, stopNetworkPolling]);

  return {
    devices,
    loading,
    error,
    fetchDevices,
    pairingRequest,
    connectedDevices,
    isConnecting,
    showNetworkPrompt,
    lastConnectedDevice,
    acceptPairing,
    denyPairing,
    startDiscovery,
    stopDiscovery,
    setDiscoverable,
    connectDevice,
    disconnectDevice,
    forgetDevice,
    enableNetworking,
    wsConnected
  };
}; 