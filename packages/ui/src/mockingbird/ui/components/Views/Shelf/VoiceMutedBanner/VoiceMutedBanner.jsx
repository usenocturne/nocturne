import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../../../contexts/CarThingStore";
import { Banner, BannerButton } from "../../../CarthingUIComponents";
import { IconMicOff32 } from "../../../Icons/CarthingUIComponents";

const VoiceMutedBanner = () => {
  const { shelfStore } = useCarThingStore();
  const uiState = shelfStore.shelfController.voiceMuteBannerUiState;

  return (
    <Banner
      show={uiState.shouldShowAlert}
      icon={<IconMicOff32 />}
      infoText="Turn on your mic to make voice requests."
    >
      <BannerButton
        text="Turn on mic"
        withDivider
        onClick={() => uiState.handleClickUnmute()}
      />
    </Banner>
  );
};

export default observer(VoiceMutedBanner);
