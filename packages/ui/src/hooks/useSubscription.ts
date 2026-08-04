import { useEffect, useState } from "react";
import {
  getAppSubscribedState,
  subscribeAppSubscribedState,
} from "./useNocturned";

const NOCTURNE_PLUS_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "past_due",
  "trialing",
]);

type SubscriptionEntitlementState = {
  subscribed?: unknown;
  status?: unknown;
  hasLifetime?: unknown;
  isAdmin?: unknown;
  entitlementsVerified?: unknown;
};

export const hasStrictNocturnePlusAccess = ({
  subscribed,
  status,
  isAdmin,
  entitlementsVerified,
}: SubscriptionEntitlementState): boolean => {
  if (entitlementsVerified !== true) return false;
  if (isAdmin === true) return true;
  if (subscribed !== true || typeof status !== "string") return false;
  return NOCTURNE_PLUS_SUBSCRIPTION_STATUSES.has(status.trim().toLowerCase());
};

export function useSubscription() {
  const [state, setState] = useState(() => getAppSubscribedState());

  useEffect(() => {
    const unsubscribe = subscribeAppSubscribedState((newState) => {
      setState(newState);
    });
    return unsubscribe;
  }, []);

  const isSubscribed = state.subscribed;
  const hasLifetime = !!state.hasLifetime;
  const isAdmin = state.isAdmin === true;
  const entitlementsVerified = state.entitlementsVerified === true;
  const hasNocturnePlusAccess = hasStrictNocturnePlusAccess(state);

  return {
    isSubscribed,
    subscriptionStatus: state.status,
    hasLifetime,
    isAdmin,
    entitlementsVerified,
    hasPhoneAccess: isSubscribed || hasLifetime,
    hasNocturnePlusAccess,
  };
}
