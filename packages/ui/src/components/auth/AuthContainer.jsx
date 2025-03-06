import React from "react";
import { useNetwork } from "../../hooks/useNetwork";
import NetworkScreen from "./NetworkScreen";
import AuthScreen from "./AuthScreen";

const AuthContainer = ({ onAuthSuccess }) => {
  const { isConnected, isChecking, showNoNetwork } = useNetwork();

  if (!isConnected && showNoNetwork) {
    return <NetworkScreen isCheckingNetwork={isChecking} />;
  }

  return <AuthScreen onAuthSuccess={onAuthSuccess} />;
};

export default AuthContainer;
