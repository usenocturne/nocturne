import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import classNames from 'classnames';
import { action } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useCarThingStore } from '../../../../contexts/CarThingStore';
import styles from './ShelfHeaderItem.module.scss';

const ShelfHeaderItem = forwardRef(({
  id,
  icon,
  iconMargin,
  marginRight,
  title,
  visible,
  active,
  onlyIcon,
  translateLeft,
}, ref) => {
  const { shelfStore } = useCarThingStore();
  const uiState = shelfStore.shelfController.headerUiState;

  const containerRef = useRef(null);
  const titleTextRef = useRef(null);

  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    setTimeout(() => {
      setShouldAnimate(true);
    }, 0);
  }, [setShouldAnimate]);

  useImperativeHandle(
    ref,
    () => ({
      get titleContainerRef() {
        return containerRef.current;
      },
      get titleTextRef() {
        return titleTextRef.current;
      },
    }),
    [],
  );

  return (
    <div
      className={classNames(styles.titleContainer, {
        [styles.active]: active,
        [styles.hidden]: !visible,
        [styles.withTransition]: shouldAnimate,
      })}
      style={{
        marginRight,
        transform: uiState.isInYourLibrary ? `translateX(-${translateLeft}px)` : '',
      }}
      onPointerDown={action(() => uiState.headerItemClicked(id))}
      ref={containerRef}
    >
      {icon && (
        <div className={styles.titleIcon} style={{ marginRight: iconMargin }}>
          {active ? icon.active : icon.inactive}
        </div>
      )}
      <div
        className={classNames(styles.titleText, { [styles.hidden]: onlyIcon })}
        ref={titleTextRef}
      >
        {title}
      </div>
    </div>
  );
});

ShelfHeaderItem.displayName = 'ShelfHeaderItem';

export default observer(ShelfHeaderItem);
