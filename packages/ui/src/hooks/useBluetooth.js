import { useState, useEffect, useCallback, useRef } from 'react'

let isInitializingDiscovery = false;
let isStoppingDiscovery = false;
let isDevicesFetching = false;
let globalWsRef = null;
let globalWsListeners = [];
let wsInitialized = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_TIMEOUT = 5000;

const setupGlobalWebSocket = () => {
  if (globalWsRef) return;

  const socket = new WebSocket('ws://localhost:5000/ws');
  globalWsRef = socket;

  socket.onopen = () => {
    console.log('Bluetooth WebSocket connected');
    globalWsListeners.forEach(listener => listener.onOpen && listener.onOpen(socket));
  };

  socket.onclose = () => {
    console.log('Bluetooth WebSocket disconnected');
    globalWsListeners.forEach(listener => listener.onClose && listener.onClose());
    globalWsRef = null;
    wsInitialized = false;
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Bluetooth WebSocket message:', data);
      globalWsListeners.forEach(listener => listener.onMessage && listener.onMessage(data));
    } catch (err) {
      console.error('Bluetooth WebSocket message error:', err);
    }
  };

  socket.onerror = (err) => {
    console.error('Bluetooth WebSocket error:', err);
    globalWsRef = null;
    wsInitialized = false;
  };
};

export const useBluetooth = () => {
  const [ws, setWs] = useState(null)
  const [pairingRequest, setPairingRequest] = useState(null)
  const [connectedDevices, setConnectedDevices] = useState([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [showNetworkPrompt, setShowNetworkPrompt] = useState(false)
  const [lastConnectedDevice, setLastConnectedDevice] = useState(null)
  const [networkStartRef, setNetworkStartRef] = useState(null)
  const [networkPollRef, setNetworkPollRef] = useState(null)
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const isReconnecting = useRef(false)
  const listenerIdRef = useRef(null)
  const discoveryActive = useRef(false)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef(null)

  const stopNetworkPolling = useCallback(() => {
    if (networkPollRef) {
      clearInterval(networkPollRef)
      setNetworkPollRef(null)
    }
    if (networkStartRef) {
      clearInterval(networkStartRef)
      setNetworkStartRef(null)
    }
  }, []);

  const fetchDevices = useCallback(async (force = false) => {
    if (isDevicesFetching && !force) {
      return [];
    }
    
    try {
      isDevicesFetching = true;
      setLoading(true)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('http://localhost:5000/bluetooth/devices', {
        signal: controller.signal
      })

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Failed to fetch devices')
      }
      const data = await response.json()
      setDevices(data)
      return data
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setLoading(false)
      isDevicesFetching = false;
    }
  }, [])

  const startNetworkPolling = useCallback(async (deviceAddress) => {
    if (networkPollRef || networkStartRef) return

    const checkNetworkStatus = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const statusResponse = await fetch('http://localhost:5000/bluetooth/network', {
          method: 'GET',
          signal: controller.signal
        })
        const data = await statusResponse.json()
        
        clearTimeout(timeoutId);
        return data.status
      } catch (error) {
        console.error('Failed to check network status:', error)
        return 'down'
      }
    }

    const startNetwork = async () => {
      try {
        const status = await checkNetworkStatus()
        if (status === 'up') return

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        await fetch(`http://localhost:5000/bluetooth/network/${deviceAddress}`, {
          method: 'POST',
          signal: controller.signal
        })

        clearTimeout(timeoutId);
      } catch (error) {
        console.error('Failed to start networking:', error)
      }
    }

    const initialStatus = await checkNetworkStatus()
    
    if (initialStatus === 'up') {
      setShowNetworkPrompt(false)
      setNetworkPollRef(setInterval(async () => {
        const status = await checkNetworkStatus()
        if (status === 'down') {
          setShowNetworkPrompt(true)
          await startNetwork()
          setNetworkStartRef(setInterval(startNetwork, 5000))
        }
      }, 5000))
    } else {
      setShowNetworkPrompt(true)
      await startNetwork()
      setNetworkPollRef(setInterval(async () => {
        const status = await checkNetworkStatus()
        if (status === 'up') {
          setShowNetworkPrompt(false)
          if (networkStartRef) {
            clearInterval(networkStartRef)
            setNetworkStartRef(null)
          }
        }
      }, 5000))
      setNetworkStartRef(setInterval(startNetwork, 5000))
    }
  }, [])

  const connectDevice = useCallback(async (deviceAddress) => {
    try {
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`http://localhost:5000/bluetooth/connect/${deviceAddress}`, {
        method: 'POST',
        signal: controller.signal
      })

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to connect device')
      }
      
      localStorage.setItem('lastConnectedBluetoothDevice', deviceAddress)
      await fetchDevices(true)
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setLoading(false);
    }
  }, [fetchDevices])

  const disconnectDevice = useCallback(async (address) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`http://localhost:5000/bluetooth/disconnect/${address}`, {
        method: 'POST',
        signal: controller.signal
      })

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to disconnect device')
      
      localStorage.removeItem('lastConnectedBluetoothDevice')
      await fetchDevices(true)
      return true
    } catch (error) {
      console.error('Error disconnecting:', error)
      return false
    }
  }, [fetchDevices])

  const forgetDevice = useCallback(async (deviceAddress) => {
    try {
      setLoading(true);
      const response = await fetch(`http://localhost:5000/bluetooth/remove/${deviceAddress}`, {
        method: 'POST'
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to remove device')
      }
      
      await fetchDevices(true)
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setLoading(false);
    }
  }, [fetchDevices])

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

      const response = await fetch(`http://localhost:5000/bluetooth/connect/${savedDeviceAddress}`, {
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
        setPairingRequest(data.payload)
        break

      case 'bluetooth/paired':
        setPairingRequest(null)
        setConnectedDevices(prev => [...prev, data.payload.device])
        setLastConnectedDevice(data.payload.device)
        setShowNetworkPrompt(true)
        localStorage.setItem('lastConnectedBluetoothDevice', data.payload.device.address)
        startNetworkPolling(data.payload.device.address)
        break

      case 'bluetooth/connect':
        setShowNetworkPrompt(true)
        startNetworkPolling(data.payload.address)
        break

      case 'bluetooth/disconnect':
        setConnectedDevices(prev =>
          prev.filter(device => device.address !== data.payload.address)
        )
        if (lastConnectedDevice?.address === data.payload.address) {
          setShowNetworkPrompt(false)
          setLastConnectedDevice(null)
          stopNetworkPolling()
        }
        break

      case 'bluetooth/network/disconnect':
        setShowNetworkPrompt(true)
        break

      default:
        break
    }
  }, [lastConnectedDevice, stopNetworkPolling, startNetworkPolling])

  const startDiscovery = useCallback(async () => {
    if (discoveryActive.current || isInitializingDiscovery) {
      return true;
    }
    
    try {
      isInitializingDiscovery = true;
      const response = await fetch('http://localhost:5000/bluetooth/discover/on', {
        method: 'POST'
      })
      if (!response.ok) {
        throw new Error('Failed to start discovery')
      }
      discoveryActive.current = true;
      return true
    } catch (err) {
      console.error('Error starting discovery:', err)
      return false
    } finally {
      isInitializingDiscovery = false;
    }
  }, [])

  const stopDiscovery = useCallback(async () => {
    if (!discoveryActive.current || isStoppingDiscovery) {
      return;
    }
    
    try {
      isStoppingDiscovery = true;
      await fetch('http://localhost:5000/bluetooth/discover/off', {
        method: 'POST'
      })
      discoveryActive.current = false;
    } catch (err) {
      console.error('Failed to stop discovery:', err)
    } finally {
      isStoppingDiscovery = false;
    }
  }, [])

  const setDiscoverable = useCallback(async (enabled) => {
    return enabled ? startDiscovery() : stopDiscovery();
  }, [startDiscovery, stopDiscovery])

  const acceptPairing = useCallback(async () => {
    if (!pairingRequest) return

    try {
      setIsConnecting(true)
      const response = await fetch('http://localhost:5000/bluetooth/pairing/accept', {
        method: 'POST'
      })

      if (!response.ok) throw new Error('Failed to accept pairing')
    } catch (error) {
      console.error('Error accepting pair:', error)
    } finally {
      setIsConnecting(false)
    }
  }, [pairingRequest])

  const denyPairing = useCallback(async () => {
    if (!pairingRequest) return

    try {
      const response = await fetch('http://localhost:5000/bluetooth/pairing/deny', {
        method: 'POST'
      })

      if (!response.ok) throw new Error('Failed to deny pairing')
      setPairingRequest(null)
    } catch (error) {
      console.error('Error denying pair:', error)
    }
  }, [pairingRequest])

  const enableNetworking = useCallback(async () => {
    if (!lastConnectedDevice) return
    startNetworkPolling(lastConnectedDevice.address)
  }, [lastConnectedDevice, startNetworkPolling])

  useEffect(() => {
    if (!wsInitialized) {
      setupGlobalWebSocket();
      wsInitialized = true;
    }

    const listenerId = Date.now().toString() + Math.random().toString();
    listenerIdRef.current = listenerId;

    const listener = {
      id: listenerId,
      onOpen: (socket) => {
        console.log('Bluetooth hook WebSocket opened');
        setWs(socket);
      },
      onClose: () => {
        console.log('Bluetooth hook WebSocket closed');
        setWs(null);
      },
      onMessage: (data) => {
        console.log('Bluetooth hook received message:', data);
        handleWsMessage(data);
      }
    };

    globalWsListeners.push(listener);

    if (globalWsRef && globalWsRef.readyState === WebSocket.OPEN) {
      setWs(globalWsRef);
    }

    return () => {
      console.log('Cleaning up Bluetooth hook WebSocket listener');
      globalWsListeners = globalWsListeners.filter(l => l.id !== listenerId);
      stopNetworkPolling();
    }
  }, [handleWsMessage, stopNetworkPolling]);

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
    enableNetworking
  }
}

export default useBluetooth 
