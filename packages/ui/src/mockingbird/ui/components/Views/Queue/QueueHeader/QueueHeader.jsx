import { observer } from 'mobx-react-lite';
import styles from './QueueHeader.module.scss';
import classNames from 'classnames';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import Type from '../../../CarthingUIComponents/Type/Type';

const QueueHeader = () => {
  const { queueStore } = useCarThingStore();
  const uiState = queueStore.queueUiState;
  
  return (
    <div
      className={styles.headerWrapper}
      style={{
        background: uiState.headerBackground,
      }}
      data-testid="queue-header"
    >
      <div
        className={classNames(styles.header, {
          [styles.smallHeader]: uiState.shouldShowSmallHeader,
        })}
      >
        <Type
          className={classNames(styles.queueTitle, {
            [styles.smallHeader]: uiState.shouldShowSmallHeader,
          })}
          name="altoBold"
        >
          {uiState.headerText}
        </Type>
      </div>
    </div>
  );
};

export default observer(QueueHeader);
