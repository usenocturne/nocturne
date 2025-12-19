import React, { createContext, useState, useContext, useEffect } from "react";

const OTAContext = createContext();

export function OTAProvider({ children }) {
  const [updateDownloadStarted, setUpdateDownloadStarted] = useState(false);
  const [updateReadyForReboot, setUpdateReadyForReboot] = useState(false);

  useEffect(() => {
    const handleOtaStatus = (event) => {
      if (event.detail?.topic === "device.ota.status") {
        const data = event.detail.data;
        if (data?.current === "finished" && data?.ota === "complete") {
          setUpdateReadyForReboot(true);
        } else if (data?.current === "finished" && data?.ota === "failed") {
          setUpdateDownloadStarted(false);
          setUpdateReadyForReboot(false);
        }
      }
    };

    window.addEventListener("nocturne-ws-message", handleOtaStatus);
    return () =>
      window.removeEventListener("nocturne-ws-message", handleOtaStatus);
  }, []);

  const markDownloadStarted = () => {
    setUpdateDownloadStarted(true);
  };

  const resetOTAState = () => {
    setUpdateDownloadStarted(false);
    setUpdateReadyForReboot(false);
  };

  return (
    <OTAContext.Provider
      value={{
        updateDownloadStarted,
        updateReadyForReboot,
        markDownloadStarted,
        resetOTAState,
      }}
    >
      {children}
    </OTAContext.Provider>
  );
}

export function useOTA() {
  return useContext(OTAContext);
}
