import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import ErrorAlert from "./ErrorAlert";

const AuthMethodSelector = ({ onSelect }) => {
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [alert, setAlert] = useState(null);
  const [buttonsVisible, setButtonsVisible] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  useEffect(() => {
    if (showCustomForm) {
      setButtonsVisible(false);
      setTimeout(() => setFormVisible(true), 250);
    } else {
      setFormVisible(false);
      setTimeout(() => setButtonsVisible(true), 250);
    }
  }, [showCustomForm]);

  const validateSpotifyCredentials = async (clientId, clientSecret) => {
    try {
      const response = await fetch("/api/validate-credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          clientSecret,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to validate credentials");
      }

      return true;
    } catch (error) {
      console.error("Validation error:", error);
      setAlert({
        message:
          error.message ||
          "Invalid credentials. Please check your Client ID and Client Secret.",
      });
      return false;
    }
  };

  const handleCustomSubmit = async (e) => {
    e.preventDefault();
    if (!clientId.trim() || !clientSecret.trim()) {
      setAlert({
        message: "Please enter both Client ID and Client Secret",
      });
      return;
    }

    try {
      setIsValidating(true);

      const isValid = await validateSpotifyCredentials(
        clientId.trim(),
        clientSecret.trim()
      );

      if (!isValid) {
        return;
      }

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
      localStorage.setItem("spotifyTempId", tempId);
      onSelect({ type: "custom", tempId });
    } catch (err) {
      setAlert({
        message: "Failed to store credentials. Please try again.",
      });
      localStorage.removeItem("spotifyAuthType");
      localStorage.removeItem("spotifyTempId");
    } finally {
      setIsValidating(false);
    }
  };

  const handleDefaultSubmit = (e) => {
    e.preventDefault();
    localStorage.setItem("spotifyAuthType", "default");
    onSelect({ type: "default" });
  };

  const handleBackClick = () => {
    setShowCustomForm(false);
    setClientId("");
    setClientSecret("");
    setAlert(null);
  };

  const NocturneIcon = ({ className }) => (
    <svg
      width="457"
      height="452"
      viewBox="0 0 457 452"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        opacity="0.8"
        d="M337.506 24.9087C368.254 85.1957 385.594 153.463 385.594 225.78C385.594 298.098 368.254 366.366 337.506 426.654C408.686 387.945 457 312.505 457 225.781C457 139.057 408.686 63.6173 337.506 24.9087Z"
        fill="#CBCBCB"
      />
      <path
        d="M234.757 20.1171C224.421 5.47596 206.815 -2.40914 189.157 0.65516C81.708 19.3019 0 112.999 0 225.781C0 338.562 81.7075 432.259 189.156 450.906C206.814 453.97 224.42 446.085 234.756 431.444C275.797 373.304 299.906 302.358 299.906 225.78C299.906 149.203 275.797 78.2567 234.757 20.1171Z"
        fill="white"
      />
    </svg>
  );

  return (
    <div className="bg-black min-h-screen flex items-center justify-center">
      <div className="w-full flex flex-col items-center px-6 py-12 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-xl">
          <NocturneIcon className="mx-auto h-14 w-auto" />
          <div
            className={`transition-all duration-250 ${
              buttonsVisible ? "h-[70px] opacity-100" : "h-0 opacity-0"
            }`}
          >
            <h2 className="mt-4 text-center text-[46px] font-[580] text-white tracking-tight">
              Welcome to Nocturne
            </h2>
          </div>
        </div>

        <div className="mt-4 sm:mx-auto sm:w-full sm:max-w-xl">
          <div
            className={`relative transition-all duration-250 ${
              formVisible ? "h-[300px]" : "h-[200px]"
            }`}
          >
            <div
              className={`space-y-6 mt-2 absolute top-0 left-0 w-full transition-opacity duration-250 ${
                buttonsVisible ? "opacity-100" : "opacity-0"
              }`}
              style={{ pointerEvents: buttonsVisible ? "auto" : "none" }}
            >
              <button
                onClick={handleDefaultSubmit}
                className="flex w-full justify-center rounded-full bg-white/10 px-6 py-4 text-[32px] font-[560] text-white tracking-tight shadow-sm"
              >
                Use Default Credentials
              </button>
              <button
                onClick={() => setShowCustomForm(true)}
                className="flex w-full justify-center rounded-full ring-white/10 ring-2 ring-inset px-6 py-4 text-[32px] font-[560] text-white tracking-tight shadow-sm hover:bg-white/10 transition-colors"
              >
                Use Custom Credentials
              </button>
            </div>

            <form
              onSubmit={handleCustomSubmit}
              className={`space-y-6 absolute top-0 left-0 w-full transition-opacity duration-250 ${
                formVisible ? "opacity-100" : "opacity-0"
              }`}
              style={{ pointerEvents: formVisible ? "auto" : "none" }}
            >
              <div>
                <div className="mt-2">
                  <input
                    id="clientId"
                    name="clientId"
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    required
                    placeholder="Client ID"
                    disabled={isValidating}
                    className="block w-full rounded-2xl border-0 bg-black/10 py-4 px-6 text-white shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-white/20 ring-white/10 text-[32px] sm:leading-6"
                  />
                </div>
              </div>

              <div>
                <div className="mt-2">
                  <input
                    id="clientSecret"
                    name="clientSecret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    required
                    placeholder="Client Secret"
                    disabled={isValidating}
                    className="block w-full rounded-2xl border-0 bg-black/10 py-4 px-6 text-white shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-white/20 ring-white/10 text-[32px] sm:leading-6"
                  />
                </div>
                <ErrorAlert error={alert} onClose={() => setAlert(null)} />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleBackClick}
                  disabled={isValidating}
                  className="flex w-full justify-center rounded-full ring-white/10 ring-2 ring-inset px-6 py-4 text-[32px] font-[580] text-white tracking-tight shadow-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isValidating}
                  className="flex w-full justify-center rounded-full bg-white/10 px-6 py-4 text-[32px] font-[580] text-white tracking-tight shadow-sm disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthMethodSelector;
