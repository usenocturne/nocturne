import { useState, useEffect, useCallback, useRef } from 'react'

export const useBluetooth = () => {
  const [ws, setWs] = useState(null)
  const [pairingRequest, setPairingRequest] = useState(null)
  const [connectedDevices, setConnectedDevices] = useState([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [showNetworkPrompt, setShowNetworkPrompt] = useState(false)
  const [lastConnectedDevice, setLastConnectedDevice] = useState(null)
  const networkPollRef = useRef(null)
  const wsRef = useRef(null)

  const setupWebSocket = useCallback(() => {
    if (wsRef.current) return

    const socket = new WebSocket('ws://localhost:5000/ws')
    wsRef.current = socket

    socket.onopen = () => setWs(socket)
    socket.onclose = () => {
      setWs(null)
      wsRef.current = null
    }

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data)

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
    }
  }, [lastConnectedDevice])

  useEffect(() => {
    setupWebSocket()
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      stopNetworkPolling()
    }
  }, [setupWebSocket])

  const stopNetworkPolling = () => {
    if (networkPollRef.current) {
      clearInterval(networkPollRef.current)
      networkPollRef.current = null
    }
  }

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
  }, [lastConnectedDevice])

  const setDiscoverable = useCallback(async (enabled) => {
    try {
      const response = await fetch(`http://localhost:5000/bluetooth/discover/${enabled ? 'on' : 'off'}`, {
        method: 'POST'
      })
      if (!response.ok) throw new Error('Failed to set discoverable mode')
    } catch (error) {
      console.error('Error setting discoverable:', error)
    }
  }, [])

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

  const disconnectDevice = useCallback(async (address) => {
    try {
      const response = await fetch(`http://localhost:5000/bluetooth/disconnect/${address}`, {
        method: 'POST'
      })
      if (!response.ok) throw new Error('Failed to disconnect device')
    } catch (error) {
      console.error('Error disconnecting:', error)
    }
  }, [])

  const enableNetworking = useCallback(async () => {
    if (!lastConnectedDevice) return
    startNetworkPolling()
  }, [lastConnectedDevice, startNetworkPolling])

  return {
    pairingRequest,
    connectedDevices,
    isConnecting,
    showNetworkPrompt,
    lastConnectedDevice,
    acceptPairing,
    denyPairing,
    setDiscoverable,
    disconnectDevice,
    enableNetworking
  }
} 