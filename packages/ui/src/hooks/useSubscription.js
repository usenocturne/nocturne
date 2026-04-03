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

  return {
    isSubscribed: state.subscribed,
    subscriptionStatus: state.status,
  };
}
