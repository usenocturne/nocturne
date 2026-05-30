import { useEffect, useState } from "react";
import {
  getAppSubscribedState,
  subscribeAppSubscribedState,
} from "./useNocturned";

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

  return {
    isSubscribed,
    subscriptionStatus: state.status,
    hasLifetime,
    hasPhoneAccess: isSubscribed || hasLifetime,
  };
}
