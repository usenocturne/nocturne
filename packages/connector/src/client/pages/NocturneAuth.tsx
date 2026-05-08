import React from "react";
import { useAuth } from "../hooks/useAuth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PairConnectorForm } from "./PairConnector";

export function NocturneAuth() {
  const { authenticated, user, signOut } = useAuth();

  if (!authenticated) {
    return (
      <div>
        <h2 className="mb-8 text-2xl font-medium text-fg">
          Account
        </h2>
        <Card className="mx-auto max-w-lg">
          <CardContent>
            <PairConnectorForm
              title="Sign in to continue"
              subtitle={
                <>
                  Visit{" "}
                  <a
                    href="https://usenocturne.com/login"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent transition hover:text-accent-hover"
                  >
                    usenocturne.com/login
                  </a>{" "}
                  on your phone or computer, then enter the code below.
                </>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-8 text-2xl font-medium text-fg">
        Account
      </h2>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Signed in as</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-6 text-lg font-medium text-fg">{user?.email}</p>
          <Button variant="secondary" className="w-full" onClick={signOut}>
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
