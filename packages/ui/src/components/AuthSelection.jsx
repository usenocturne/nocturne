import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthSelection = ({ onSelect }) => {
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState("");

  const handleCustomSubmit = async (e) => {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("Please enter both Client ID and Client Secret");
      return;
    }

    try {
      const tempId = Math.random().toString(36).substring(7);

      const { error: insertError } = await supabase
        .from("spotify_credentials")
        .insert({
          temp_id: tempId,
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          created_at: new Date().toISOString(),
        });

      if (insertError) throw insertError;

      localStorage.setItem("spotifyAuthType", "custom");
      onSelect({ type: "custom", tempId });
    } catch (err) {
      console.error("Error storing credentials:", err);
      setError("Failed to store credentials. Please try again.");
    }
  };

  if (showCustomInput) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-900 to-neutral-800">
        <div className="w-full max-w-md mx-4 bg-neutral-800 rounded-lg shadow-xl p-6">
          <div className="mb-8">
            <h1 className="text-2xl text-white text-center font-bold">
              Enter Spotify API Credentials
            </h1>
          </div>

          <form onSubmit={handleCustomSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Enter your Spotify Client ID"
                className="w-full p-3 bg-neutral-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 mb-4"
              />
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Enter your Spotify Client Secret"
                className="w-full p-3 bg-neutral-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              {error && <p className="text-red-400 mt-2 text-sm">{error}</p>}
            </div>

            <div className="space-y-3">
              <button
                type="submit"
                className="w-full py-4 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200 text-lg"
              >
                Continue
              </button>

              <button
                type="button"
                onClick={() => setShowCustomInput(false)}
                className="w-full py-4 px-4 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors duration-200 text-lg"
              >
                Back
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-900 to-neutral-800">
      <div className="w-full max-w-md mx-4 bg-neutral-800 rounded-lg shadow-xl p-6">
        <div className="mb-8">
          <h1 className="text-2xl text-white text-center font-bold">
            Nocturne
          </h1>
        </div>

        <div className="space-y-4">
          <p className="text-neutral-400 text-center mb-6">
            Choose how you would like to authenticate with Spotify
          </p>

          <button
            onClick={() => onSelect("default")}
            className="w-full py-4 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-200 text-lg"
          >
            Use Default Credentials
          </button>

          <button
            onClick={() => setShowCustomInput(true)}
            className="w-full py-4 px-4 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors duration-200 text-lg"
          >
            Use Custom API Credentials
          </button>
        </div>

        <p className="text-sm text-neutral-500 text-center mt-6">
          You can change this setting later in the app
        </p>
      </div>
    </div>
  );
};

export default AuthSelection;
