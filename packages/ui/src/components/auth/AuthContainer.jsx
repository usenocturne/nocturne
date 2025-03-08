import React, { useEffect } from "react";
import AuthScreen from "./AuthScreen";
import { useAuth } from "../../hooks/useAuth";

const AuthContainer = ({ onAuthSuccess }) => {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      onAuthSuccess();
    }
  }, [isAuthenticated, onAuthSuccess]);

  return <AuthScreen onAuthSuccess={onAuthSuccess} />;
};

export default AuthContainer;
