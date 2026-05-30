import React, { useEffect, useState, useCallback, useRef } from "react";
import { get, post } from "../api";
import { useAutoRefresh, useEvent } from "../hooks/useWebSocket";
import { BluetoothDeviceList } from "../components/BluetoothDeviceList";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Bluetooth as BluetoothIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

const BT_EVENTS = [
  "bluetooth.deviceConnected",
  "bluetooth.deviceDisconnected",
  "bluetooth.devicePaired",
  "bluetooth.deviceFound",
  "bluetooth.deviceUpdated",
];

interface PairingPinEvent {
  address: string;
  name: string;
  pin: string;
  type: "bluetooth_pin";
}

export function BluetoothPairing() {
  const [status, setStatus] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [pinEvent, setPinEvent] = useState<PairingPinEvent | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    try { setStatus(await get("/api/bluetooth/status")); } catch {}
    try { setDevices((await get("/api/bluetooth/devices")).devices ?? []); } catch {}
    try { setConnections((await get("/api/bluetooth/connections")).connections ?? []); } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useAutoRefresh(BT_EVENTS, refresh);

  useEvent<PairingPinEvent>("bluetooth.agent", useCallback((data) => {
    if (data.type === "bluetooth_pin") {
      setPinEvent(data);
    }
  }, []));

  useEvent("bluetooth.pairingCancelled", useCallback(() => {
    setPinEvent(null);
  }, []));

  const handleConfirm = async () => {
    setPinEvent(null);
    try { await post("/api/bluetooth/pairing-confirm"); } catch {}
    refresh();
  };

  const handleReject = async () => {
    setPinEvent(null);
    try { await post("/api/bluetooth/pairing-reject"); } catch {}
    refresh();
  };

  const startScan = async () => {
    setScanning(true);
    try {
      await post("/api/bluetooth/scan");
      for (let i = 0; i < 30; i++) {
        if (!mountedRef.current) break;
        await new Promise((r) => setTimeout(r, 2000));
        if (!mountedRef.current) break;
        try {
          setDevices((await get("/api/bluetooth/devices")).devices ?? []);
        } catch {}
      }
      await post("/api/bluetooth/stop-scan");
      if (mountedRef.current) await refresh();
    } catch {}
    if (mountedRef.current) setScanning(false);
  };

  return (
    <div>
      <div className="mb-10">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-fg">
              Bluetooth
            </h2>
            <p className="mt-2 text-secondary">
              Pair and manage your Car Thing connection.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={startScan}
            disabled={scanning || !status?.powered}
            className="mt-1"
          >
            <Search className="size-3.5" />
            {scanning ? "Scanning..." : "Scan for Devices"}
          </Button>
        </div>
      </div>

      {connections.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted">
            Active Connections
          </h3>
          <div className="space-y-2">
            {connections.map((conn: any) => (
              <Card key={conn.devicePath} className="border-success/20 bg-success/5">
                <CardContent>
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-success/10">
                      <BluetoothIcon className="size-4 text-success" />
                    </div>
                    <span className="font-medium text-fg">{conn.name || "Device"}</span>
                    <Badge variant="success" className="ml-auto">Connected</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted">
          Available Devices
        </h3>
        <BluetoothDeviceList
          devices={devices}
          onPair={async (addr) => { await post(`/api/bluetooth/pair/${addr}`); await post(`/api/bluetooth/trust/${addr}`).catch(() => {}); refresh(); }}
          onUnpair={async (addr) => { await post(`/api/bluetooth/unpair/${addr}`); refresh(); }}
          onConnect={async (addr) => { await post(`/api/bluetooth/connect/${addr}`); refresh(); }}
        />
      </div>

      <AlertDialog open={!!pinEvent}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bluetooth Pairing Request</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm that this PIN matches the one shown on{" "}
              <span className="font-medium text-fg">
                {pinEvent?.name || pinEvent?.address}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-center py-4">
            <span className="font-mono text-3xl font-bold tracking-[0.3em] text-fg sm:text-4xl">
              {pinEvent?.pin ?? ""}
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleReject}>Reject</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
