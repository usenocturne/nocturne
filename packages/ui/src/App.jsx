import { useState, useEffect } from "react";
import AuthContainer from "./components/auth/AuthContainer";
import { useAuth } from "./hooks/useAuth";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { isAuthenticated: authState } = useAuth();

  useEffect(() => {
    setIsAuthenticated(authState);
  }, [authState]);

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
    </main>
  );
}

export default App;
