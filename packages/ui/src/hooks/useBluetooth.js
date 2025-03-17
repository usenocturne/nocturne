import { useState, useEffect, useCallback, useRef } from 'react'

let isInitializingDiscovery = false;
let isStoppingDiscovery = false;
let isDevicesFetching = false;
let globalWsRef = null;
let globalWsListeners = [];
let wsInitialized = false;

const setupGlobalWebSocket = () => {
  if (globalWsRef) return;

  const socket = new WebSocket('ws://localhost:5000/ws');
  globalWsRef = socket;

  socket.onopen = () => {
    globalWsListeners.forEach(listener => listener.onOpen && listener.onOpen(socket));
  };

  socket.onclose = () => {
    globalWsListeners.forEach(listener => listener.onClose && listener.onClose());
    globalWsRef = null;
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    globalWsListeners.forEach(listener => listener.onMessage && listener.onMessage(data));
  };
};

export const useBluetooth = () => {
  const [ws, setWs] = useState(null)
  const [pairingRequest, setPairingRequest] = useState(null)
  const [connectedDevices, setConnectedDevices] = useState([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [showNetworkPrompt, setShowNetworkPrompt] = useState(false)
  const [lastConnectedDevice, setLastConnectedDevice] = useState(null)
  const networkPollRef = useRef(null)
  const listenerIdRef = useRef(null)
  const discoveryActive = useRef(false)
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const stopNetworkPolling = useCallback(() => {
    if (networkPollRef.current) {
      clearInterval(networkPollRef.current)
      networkPollRef.current = null
    }
  }, []);

  const fetchDevices = useCallback(async (force = false) => {
    if (isDevicesFetching && !force) {
      return [];
    }
    
    try {
      isDevicesFetching = true;
      setLoading(true)
      const response = await fetch('http://localhost:5000/bluetooth/devices')
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

  const connectDevice = useCallback(async (deviceAddress) => {
    try {
      setLoading(true);
      const response = await fetch(`http://localhost:5000/bluetooth/connect/${deviceAddress}`, {
        method: 'POST'
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to connect device')
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

  const disconnectDevice = useCallback(async (address) => {
    try {
      const response = await fetch(`http://localhost:5000/bluetooth/disconnect/${address}`, {
        method: 'POST'
      })
      if (!response.ok) throw new Error('Failed to disconnect device')
      
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
        setShowNetworkPrompt(false)
        stopNetworkPolling()
        break

      default:
        break
    }
  }, [lastConnectedDevice, stopNetworkPolling])

  const startNetworkPolling = useCallback(async () => {
    if (networkPollRef.current) return

    const pollNetwork = async () => {
      try {
        const response = await fetch('http://localhost:5000/bluetooth/network')
        const data = await response.json()

        if (data.status === 'up') {
          setShowNetworkPrompt(false)
          stopNetworkPolling()
          return
        }

        if (lastConnectedDevice) {
          await fetch(`http://localhost:5000/bluetooth/network/${lastConnectedDevice.address}`, {
            method: 'POST'
          })
        }
      } catch (error) {
        console.error('Network polling error:', error)
      }
    }

    await pollNetwork()
    networkPollRef.current = setInterval(pollNetwork, 2000)
  }, [lastConnectedDevice, stopNetworkPolling])

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
    startNetworkPolling()
  }, [lastConnectedDevice, startNetworkPolling])

  useEffect(() => {
    if (!wsInitialized) {
      setupGlobalWebSocket();
      wsInitialized = true;
    }

    const listenerId = Date.now().toString() + Math.random().toString();
    listenerIdRef.current = listenerId;

    globalWsListeners.push({
      id: listenerId,
      onOpen: (socket) => setWs(socket),
      onClose: () => setWs(null),
      onMessage: handleWsMessage
    });

    if (globalWsRef && globalWsRef.readyState === WebSocket.OPEN) {
      setWs(globalWsRef);
    }

    return () => {
      globalWsListeners = globalWsListeners.filter(listener => listener.id !== listenerId);
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
