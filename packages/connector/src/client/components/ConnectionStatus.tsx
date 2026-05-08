import React from "react";
import { Badge } from "@/components/ui/badge";

export function ConnectionStatus({ connected, label }: { connected: boolean; label: string }) {
  return (
    <Badge variant={connected ? "success" : "secondary"}>
      {label ? `${label}: ` : ""}
      {connected ? "Connected" : "Disconnected"}
    </Badge>
  );
}
