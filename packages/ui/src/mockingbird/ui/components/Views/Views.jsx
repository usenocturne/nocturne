import styles from "../../styles/Views.module.scss";
import classNames from "classnames";
import { View } from "../../stores/ViewStore";
import DelayedRender from "../DelayedRender";
import { observer } from "mobx-react-lite";
import { transitionDurationMs } from "../../styles/Variables";
import { useCarThingStore } from "../../contexts/CarThingStore";
import Npv from "./Npv/Npv";
import Shelf from "./Shelf/Shelf";
import Tracklist from "./Tracklist";
import Queue from "./Queue/Queue";

const Views = ({ playbackProgress, onSeek }) => {
  const { viewStore } = useCarThingStore();

  const tracklistOverNpv =
    viewStore.currentView === View.TRACKLIST &&
    viewStore.viewUnderCurrentView === View.NPV;

  const queueOverNpv =
    viewStore.currentView === View.QUEUE &&
    viewStore.viewUnderCurrentView === View.NPV;

  return (
    <div className={styles.viewArea}>
      {[
        { name: View.CONTENT_SHELF, component: <Shelf /> },
        { name: View.QUEUE, component: <Queue /> },
        { name: View.TRACKLIST, component: <Tracklist /> },
        {
          name: View.NPV,
          component: (
            <Npv playbackProgress={playbackProgress} onSeek={onSeek} />
          ),
        },
      ].map((view) => (
        <div
          key={view.name}
          className={classNames(styles.view, {
            [styles.current]: view.name === viewStore.currentView,
            [styles.underCurrent]: viewStore.viewUnderCurrentView === view.name,
            [styles.forceOnTop]:
              (tracklistOverNpv && view.name === View.TRACKLIST) ||
              (queueOverNpv && view.name === View.QUEUE),
          })}
        >
          <DelayedRender
            showing={view.name === viewStore.currentView}
            hideDelay={transitionDurationMs}
          >
            {view.component}
          </DelayedRender>
        </div>
      ))}
    </div>
  );
};

export default observer(Views);
