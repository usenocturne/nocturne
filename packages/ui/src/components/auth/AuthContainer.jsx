import React from "react";
import AuthScreen from "./AuthScreen";

const AuthContainer = ({ onAuthSuccess }) => {
  return <AuthScreen onAuthSuccess={onAuthSuccess} />;
};

export default AuthContainer;
