import React, { useState } from "react";
import { useWiFiNetworks } from "../../../hooks/useWiFiNetworks";

export default function NetworkPasswordModal({
  network,
  onClose,
  onConnect
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { connectToNetwork, hasPasswordSecurity, isConnecting } = useWiFiNetworks();

  const handleConnect = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const success = await connectToNetwork(network, password);
      if (success) {
        setPassword("");
        onConnect();
      } else {
        setError("Failed to connect to network. Please try again.");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  if (!network) return null;

  const needsPassword = hasPasswordSecurity && hasPasswordSecurity(network.flags);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
      <div className="w-full max-w-[800px] mx-auto p-8">
        <div className="bg-[#1A1A1A] rounded-2xl p-8 shadow-lg border border-white/10">
          <h3 className="text-[32px] font-[580] text-white tracking-tight mb-6">
            Connect to {network.ssid}
          </h3>

          <form onSubmit={handleConnect}>
            {needsPassword && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full bg-white/10 rounded-xl px-6 py-4 text-[28px] text-white placeholder-white/40 border border-white/10 mb-6"
                autoFocus
              />
            )}

            {error && (
              <div className="text-red-500 text-[24px] mb-6">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-4">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-3 text-[28px] font-[560] text-white/60 hover:text-white transition-colors"
                style={{ background: 'none' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isConnecting || (needsPassword && !password)}
                className="bg-white/10 hover:bg-white/20 transition-colors rounded-xl px-6 py-3 text-[28px] font-[560] text-white disabled:opacity-50"
              >
                {isConnecting ? "Connecting..." : "Connect"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
} 