import Type from "../../CarthingUIComponents/Type/Type";
import { IconExclamationCircle } from "../../Icons/EncoreWeb/IconExclamationCircle";

const SavingPresetFailed = () => {
  return (
    <div style={{ textAlign: "center", padding: "32px" }}>
      <IconExclamationCircle size={64} color="white" />
      <div style={{ marginTop: "16px" }}>
        <Type name="celloBook" textColor="white">
          Could not save preset at this time. <br />
          Try again later.
        </Type>
      </div>
    </div>
  );
};

export default SavingPresetFailed;
