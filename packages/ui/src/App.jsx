import { useState, useEffect } from "react";
import AuthContainer from "./components/auth/AuthContainer";
import NetworkScreen from "./components/auth/NetworkScreen";
import { useAuth } from "./hooks/useAuth";
import { useNetwork } from "./hooks/useNetwork";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { isAuthenticated: authState } = useAuth();
  const { isConnected, isChecking, showNoNetwork, checkNetwork } = useNetwork();

  useEffect(() => {
    setIsAuthenticated(authState);
  }, [authState]);

  useEffect(() => {
    checkNetwork();
  }, [checkNetwork]);

  const handleAuthSuccess = () => {
    setIsAuthenticated(true);
  };

  return (
    <main className="overflow-hidden relative min-h-screen rounded-2xl">
      {!isAuthenticated ? (
        <AuthContainer onAuthSuccess={handleAuthSuccess} />
      ) : (
        <div className="h-screen flex items-center justify-center text-white">
          <div className="text-center">
            <h1 className="text-4xl font-bold mb-4">Success</h1>
          </div>
        </div>
      )}

      {!isConnected && showNoNetwork && (
        <NetworkScreen isCheckingNetwork={isChecking} />
      )}
    </main>
  );
}

export default App;
