import React, { useEffect, useState, useCallback } from "react";
import { get } from "../api";
import { useAutoRefresh } from "../hooks/useWebSocket";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Monitor, ChevronRight, RefreshCw, Bluetooth } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ALL_EVENTS = [
  "device.connected",
  "device.disconnected",
  "device.info",
  "spotify.auth.status",
  "bluetooth.deviceConnected",
  "bluetooth.deviceDisconnected",
];

export function Dashboard() {
  const [deviceStatus, setDeviceStatus] = useState<any>(null);
  const [selectedDevice, setSelectedDevice] = useState<any>(null);

  const refresh = useCallback(async () => {
    try { setDeviceStatus(await get("/api/device/status")); } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useAutoRefresh(ALL_EVENTS, refresh);

  const connectedDevices = deviceStatus?.devices ?? [];
  const hasDevices = connectedDevices.length > 0;

  return (
    <div>
      <div className="mb-10">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-fg">
              Dashboard
            </h2>
            <p className="mt-2 text-secondary">
              Monitor and manage your connected Car Thing devices.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} className="mt-1">
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {hasDevices ? (
        <div className="space-y-3">
          {connectedDevices.map((dev: any) => {
            const info = dev.deviceInfo;
            return (
              <Card
                key={dev.id}
                className="cursor-pointer transition-all duration-200 hover:border-line-hover hover:bg-hover"
                onClick={() => setSelectedDevice(dev)}
              >
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-success/10">
                        <Monitor className="size-5 text-success" />
                      </div>
                      <div>
                        <p className="font-medium text-fg">{info?.device ?? "Nocturne Car Thing"}</p>
                        <p className="mt-0.5 text-sm text-secondary">
                          {info?.version ? `Firmware ${info.version}` : "Connected via Bluetooth"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="success">Connected</Badge>
                      <ChevronRight className="size-4 text-muted" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent>
            <div className="flex flex-col items-center py-8 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-hover">
                <Bluetooth className="size-7 text-muted" />
              </div>
              <h3 className="text-lg font-medium text-fg">No Car Thing connected</h3>
              <p className="mt-1.5 max-w-sm text-sm text-secondary">
                Connect your Car Thing via Bluetooth to start managing playback and settings.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedDevice} onOpenChange={(open) => !open && setSelectedDevice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDevice?.deviceInfo?.device ?? "Nocturne Car Thing"}
            </DialogTitle>
          </DialogHeader>
          {selectedDevice?.deviceInfo ? (
            <div className="space-y-3">
              {[
                ["Firmware", selectedDevice.deviceInfo.version],
                ["Full Version", selectedDevice.deviceInfo.fullVersion],
                ["Build Date", selectedDevice.deviceInfo.buildDate],
                ["Git Hash", selectedDevice.deviceInfo.gitHash],
                ["Serial Number", selectedDevice.deviceInfo.serialNumber],
              ]
                .filter(([, val]) => val)
                .map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between rounded-lg bg-bg px-3 py-2.5">
                    <dt className="text-sm text-secondary">{label}</dt>
                    <dd className={`text-sm text-fg ${label === "Git Hash" || label === "Serial Number" ? "font-mono text-xs" : ""}`}>
                      {val}
                    </dd>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-secondary">No device info available</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
