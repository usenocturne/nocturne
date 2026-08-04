import { useEffect } from "react";
import { observer } from "mobx-react-lite";
import { useCarThingStore } from "../../../../contexts/CarThingStore";
import { Banner, BannerButton } from "../../../CarthingUIComponents/Banner";
import { IconWind32 } from "../../../Icons/CarthingUIComponents";

const WindAlertBanner = () => {
  const uiState =
    useCarThingStore().airVentInterferenceController.windAlertBannerUiState;

  useEffect(() => {
    if (uiState.shouldShowAlert) uiState.logImpression();
  }, [uiState, uiState.shouldShowAlert]);

  return (
    <Banner
      show={uiState.shouldShowAlert}
      icon={<IconWind32 />}
      infoText="Your air vent noise level is high."
    >
      <BannerButton
        text="How to fix"
        withDivider
        onClick={() => uiState.handleClickHowToFix()}
      />
      <BannerButton
        text="Hide"
        withDivider
        onClick={() => uiState.handleClickHide()}
      />
    </Banner>
  );
};

export default observer(WindAlertBanner);
