import React from "react";
import { Badge } from "@/components/ui/badge";

export function SpotifyStatus({ authState }: { authState: any }) {
  if (!authState) return <Badge variant="secondary">Unknown</Badge>;

  switch (authState.status) {
    case "linked":
      return (
        <Badge variant="success">
          Linked{authState.displayName ? ` (${authState.displayName})` : ""}
        </Badge>
      );
    case "polling":
      return <Badge variant="default">Awaiting authorization...</Badge>;
    case "loading":
      return <Badge variant="default">Loading...</Badge>;
    default:
      return <Badge variant="secondary">Not linked</Badge>;
  }
}
