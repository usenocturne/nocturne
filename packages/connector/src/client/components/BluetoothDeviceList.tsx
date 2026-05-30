import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Device {
  address: string;
  name: string;
  paired: boolean;
  connected: boolean;
  trusted: boolean;
  rssi: number;
}

export function BluetoothDeviceList({
  devices,
  onPair,
  onUnpair,
  onConnect,
}: {
  devices: Device[];
  onPair: (address: string) => void;
  onUnpair: (address: string) => void;
  onConnect: (address: string) => void;
}) {
  return (
    <div className="space-y-2">
      {devices.map((dev) => (
        <Card key={dev.address}>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col justify-center">
                <p className="font-medium text-fg">{dev.name || "Unknown Device"}</p>
                <div className="mt-1.5 flex gap-2">
                  {dev.paired && <Badge variant="success">Paired</Badge>}
                  {dev.connected && <Badge variant="default">Connected</Badge>}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row justify-center gap-2">
                {dev.paired ? (
                  <>
                    {!dev.connected && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onConnect(dev.address)}
                      >
                        Connect
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onUnpair(dev.address)}
                    >
                      Unpair
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => onPair(dev.address)}>
                    Pair
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {devices.length === 0 && (
        <p className="py-4 text-center text-sm text-muted">No devices found</p>
      )}
    </div>
  );
}
