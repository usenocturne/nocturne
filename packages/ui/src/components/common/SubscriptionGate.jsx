import { useSubscription } from "../../hooks/useSubscription";

export function SubscriptionGate({ children, fallback = null }) {
  const { isSubscribed } = useSubscription();
  return isSubscribed ? children : fallback;
}
