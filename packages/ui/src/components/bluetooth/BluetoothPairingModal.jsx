export default function BluetoothPairingModal({
  pairingRequest,
  isConnecting,
  onAccept,
  onDeny
}) {
  if (!pairingRequest) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[#1A1A1A] rounded-2xl p-8 w-[400px] shadow-lg">
        <h2 className="text-3xl font-semibold text-white mb-4">Bluetooth Pairing</h2>

        <p className="text-xl text-white/80 mb-6">
          Enter this code on your device:
        </p>

        <div className="text-5xl font-mono text-white tracking-wider text-center mb-8">
          {pairingRequest.pairingKey}
        </div>

        <div className="flex justify-end gap-4">
          <button
            onClick={onDeny}
            disabled={isConnecting}
            className="px-6 py-2 text-lg font-medium text-white/70 hover:text-white transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={onAccept}
            disabled={isConnecting}
            className="px-6 py-2 text-lg font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isConnecting ? 'Connecting...' : 'Pair'}
          </button>
        </div>
      </div>
    </div>
  )
} 