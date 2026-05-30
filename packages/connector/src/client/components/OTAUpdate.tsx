import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function OTAUpdate({
  updateInfo,
  onCheck,
  checking,
}: {
  updateInfo: any;
  onCheck: () => void;
  checking: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>OTA Updates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" onClick={onCheck} disabled={checking}>
          {checking ? "Checking..." : "Check for Updates"}
        </Button>
        {updateInfo && (
          <div className="text-sm">
            {updateInfo.updateAvailable ? (
              <p className="text-success">
                Update available: v{updateInfo.version}
              </p>
            ) : (
              <p className="text-secondary">System is up to date</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
