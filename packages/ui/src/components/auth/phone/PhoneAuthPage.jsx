import React, { useState, useEffect } from "react";
import { NocturneIcon, EyeIcon, EyeOffIcon } from "../../icons";

const PhoneAuthPage = () => {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sessionId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("session")
      : null;

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const state = urlParams.get("state");
    if (code && state) {
      return;
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const validationResponse = await fetch(
        "/api/v1/auth/validate-credentials",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
            isPhoneAuth: true,
          }),
        }
      );

      if (!validationResponse.ok) {
        throw new Error("Invalid credentials");
      }

      const storeResponse = await fetch("/api/v1/auth/qr/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          sessionId,
        }),
      });

      if (!storeResponse.ok) {
        throw new Error("Failed to store credentials");
      }

      const { clientId: storedClientId, tempId } = await storeResponse.json();

      const scopes =
        "user-read-recently-played user-read-private user-top-read user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private";
      const redirectUri = encodeURIComponent(
        process.env.NEXT_PUBLIC_REDIRECT_URI
      );
      const state = encodeURIComponent(
        JSON.stringify({
          phoneAuth: true,
          sessionId,
          tempId,
        })
      );

      window.location.href = `https://accounts.spotify.com/authorize?client_id=${storedClientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scopes}&state=${state}`;
    } catch (error) {
      setError(error.message);
      setIsSubmitting(false);
    }
  };

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="text-white text-center">
          Invalid or missing session ID
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black p-6 flex flex-col sm:items-center pt-24">
      <div className="w-full max-w-md">
        <NocturneIcon className="h-14 mb-8 w-auto sm:mx-auto" />
        <h1 className="text-4xl font-bold text-white mb-8 mt-4 sm:text-center">
          Enter Spotify Credentials
        </h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
            className="w-full px-4 py-3 bg-black/10 ring-1 ring-inset focus:ring-2 focus:ring-white/20 ring-white/10 rounded-lg text-white placeholder-white/40"
            required
          />
          <div className="relative">
            <input
              type={showClientSecret ? "text" : "password"}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client Secret"
              className="w-full pr-12 px-4 py-3 bg-black/10 ring-1 ring-inset focus:ring-2 focus:ring-white/20 ring-white/10 rounded-lg text-white placeholder-white/40"
              required
            />
            <button
              type="button"
              onClick={() => setShowClientSecret(!showClientSecret)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
              tabIndex={-1}
            >
              {showClientSecret ? (
                <EyeOffIcon size={24} />
              ) : (
                <EyeIcon size={24} />
              )}
            </button>
          </div>
          {error && (
            <div className="text-red-400 text-sm text-center bg-red-400/10 p-3 rounded-lg">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-white/10 px-6 py-4 text-lg font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? "Submitting..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PhoneAuthPage;
