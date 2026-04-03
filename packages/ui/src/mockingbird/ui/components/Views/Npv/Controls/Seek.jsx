import {
  IconSeek15Back48,
  IconSeek15Forward48,
} from '../../../Icons/CarthingUIComponents';
import ControlButton from './ControlButton';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import { observer } from 'mobx-react-lite';
import { SkipDirection } from './Controls';

const Seek = ({ direction }) => {
  const { npvStore } = useCarThingStore();
  const uiState = npvStore.controlButtonsUiState;

  const isBack = direction === SkipDirection.BACK;
  const icon = isBack ? <IconSeek15Back48 /> : <IconSeek15Forward48 />;
  const onClick = isBack ? uiState.handleSeekBackClick : uiState.handleSeekForwardClick;
  const id = isBack ? 'SEEK_BACK_15' : 'SEEK_FORWARD_15';

  return (
    <ControlButton id={id} onClick={onClick}>
      {icon}
    </ControlButton>
  );
};

export default observer(Seek);