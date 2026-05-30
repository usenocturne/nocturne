import StartSetup from "./StartSetup";
import ConnectionLost from "./ConnectionLost";
import LoginRequired from "../Modals/LoginRequired";
import SubscriptionRequired from "../Modals/SubscriptionRequired";

const Setup = ({ systemScreen }) => {
  if (systemScreen === "auth") {
    return <LoginRequired />;
  }

  if (systemScreen === "subscription") {
    return <SubscriptionRequired />;
  }

  if (systemScreen === "connectionLost") {
    return <ConnectionLost />;
  }

  return <LoginRequired />;
};

export default Setup;
