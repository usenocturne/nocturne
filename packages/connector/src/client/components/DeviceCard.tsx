import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function DeviceCard({ device }: { device: any }) {
  if (!device?.deviceInfo) return null;
  const info = device.deviceInfo;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{info.device ?? "Nocturne"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-secondary">
        <p>Version: {info.version ?? "Unknown"}</p>
        {info.buildDate && <p>Build: {info.buildDate}</p>}
        {info.serialNumber && <p>Serial: {info.serialNumber}</p>}
      </CardContent>
    </Card>
  );
}
