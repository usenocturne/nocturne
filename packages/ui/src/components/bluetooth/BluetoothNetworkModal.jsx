export default function BluetoothNetworkModal({
  show,
  deviceName,
  onCancel,
  isConnecting
}) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[#1A1A1A] rounded-2xl p-8 w-[400px] shadow-lg">
        <h2 className="text-3xl font-semibold text-white mb-4">Enable Tethering</h2>

        <p className="text-xl text-white/80 mb-6">
          Please enable hotspot and Bluetooth tethering on {deviceName || 'your device'} to continue.
        </p>

        <div className="flex justify-end gap-4">
          <button
            onClick={onCancel}
            disabled={isConnecting}
            className="px-6 py-2 text-lg font-medium text-white/70 hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
} 