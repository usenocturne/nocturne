import { observer } from 'mobx-react-lite';
import styles from './NowPlaying.module.scss';
import classNames from 'classnames';
import Type from '../Type/Type';

const NowPlaying = ({ playing = true, textName = 'mestroBook' }) => {
  return (
    <div className={styles.nowPlayingWrapper}>
      <div className={styles.bars} data-testid="equaliser">
        <div
          className={classNames(styles.bar, styles.bar1, {
            [styles.play]: playing,
          })}
        />
        <div
          className={classNames(styles.bar, styles.bar2, {
            [styles.play]: playing,
          })}
        />
        <div
          className={classNames(styles.bar, styles.bar3, {
            [styles.play]: playing,
          })}
        />
      </div>
      <Type name={textName} className={styles.nowPlayingText}>
        Now Playing
      </Type>
    </div>
  );
};

export default observer(NowPlaying);
