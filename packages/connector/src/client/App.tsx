import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthContext, useAuthProvider, useAuth } from "./hooks/useAuth";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { BluetoothPairing } from "./pages/BluetoothPairing";
import { SpotifyAuth } from "./pages/SpotifyAuth";
import { Settings } from "./pages/Settings";
import { SetupWizard } from "./pages/SetupWizard";
import { PairConnector } from "./pages/PairConnector";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        <p className="text-sm text-secondary">Loading...</p>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { authenticated, loading, isInitializing, setupComplete } = useAuth();

  if (loading || isInitializing) return <LoadingScreen />;

  if (!setupComplete) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (authenticated) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/bluetooth" element={<BluetoothPairing />} />
          <Route path="/spotify" element={<SpotifyAuth />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/pair" element={<PairConnector />} />
      <Route path="*" element={<Navigate to="/pair" replace />} />
    </Routes>
  );
}

export function App() {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
