import styles from './Banner.module.scss';
import Type from '../Type/Type';
import { transitionDurationMs } from '../../../styles/Variables';
import CSSTransition from '../../CSSTransitionCompat';
import classNames from 'classnames';

const transitionStyles = {
  enter: styles.enter,
  enterActive: styles.enterActive,
  exit: styles.exit,
  exitActive: styles.exitActive,
};

const Banner = ({
  show,
  icon,
  infoText,
  colorStyle = 'information',
  children,
}) => {
  return (
    <CSSTransition
      in={show}
      timeout={transitionDurationMs}
      classNames={transitionStyles}
      mountOnEnter
      unmountOnExit
    >
      <div
        className={classNames(styles.bannerContainer, {
          [styles.confirmation]: colorStyle === 'confirmation',
          [styles.information]: colorStyle === 'information',
          [styles.unavailable]: colorStyle === 'unavailable',
        })}
      >
        <div className={styles.info}>
          <div className={styles.icon}>{icon}</div>
          <Type name="mestroBook" className={styles.informationalText}>
            {infoText}
          </Type>
        </div>
        {children && <div className={styles.actions}>{children}</div>}
      </div>
    </CSSTransition>
  );
};

export default Banner;
