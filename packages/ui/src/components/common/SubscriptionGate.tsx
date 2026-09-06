import { useSubscription } from "../../hooks/useSubscription";

export function SubscriptionGate({
  children,
  fallback = null,
}: {
  children: import("react").ReactNode;
  fallback?: import("react").ReactNode;
}) {
  const { isSubscribed } = useSubscription();
  return isSubscribed ? children : fallback;
}
