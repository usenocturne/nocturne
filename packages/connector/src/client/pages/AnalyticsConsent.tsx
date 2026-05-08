import React from "react";
import { Card, CardContent } from "@/components/ui/card";

export function AnalyticsConsent() {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="text-center">
        <h2 className="mb-4 text-pretty text-2xl font-medium tracking-tighter text-fg sm:text-3xl">
          Analytics Notice
        </h2>
        <p className="mb-3 text-secondary">
          Nocturne collects anonymous usage data to help improve Nocturne Connector.
        </p>
        <p className="text-secondary">
          You can disable analytics at any time in Settings.
        </p>
      </CardContent>
    </Card>
  );
}
