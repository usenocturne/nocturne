import React, { useEffect, useState } from "react";
import { get } from "../api";
import { OTAUpdate } from "../components/OTAUpdate";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function DeviceInfo() {
  const [device, setDevice] = useState<any>(null);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    get("/api/device/info").then(setDevice).catch(() => {});
  }, []);

  const checkOTA = async () => {
    setChecking(true);
    try {
      setUpdateInfo({ updateAvailable: false });
    } catch {}
    setChecking(false);
  };

  return (
    <div>
      <h2 className="mb-8 text-2xl font-medium text-fg">
        Device Info
      </h2>

      {device ? (
        <Card className="mb-6 max-w-lg">
          <CardHeader>
            <CardTitle>{device.device ?? "Nocturne Car Thing"}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="w-full space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-secondary">Version</dt>
                <dd className="text-fg">{device.version}</dd>
              </div>
              {device.buildDate && (
                <div className="flex justify-between">
                  <dt className="text-secondary">Build Date</dt>
                  <dd className="text-fg">{device.buildDate}</dd>
                </div>
              )}
              {device.gitHash && (
                <div className="flex justify-between">
                  <dt className="text-secondary">Git Hash</dt>
                  <dd className="font-mono text-xs text-fg">{device.gitHash}</dd>
                </div>
              )}
              {device.serialNumber && (
                <div className="flex justify-between">
                  <dt className="text-secondary">Serial Number</dt>
                  <dd className="font-mono text-fg">{device.serialNumber}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      ) : (
        <p className="mb-6 text-secondary">No device connected</p>
      )}

      <OTAUpdate updateInfo={updateInfo} onCheck={checkOTA} checking={checking} />
    </div>
  );
}
