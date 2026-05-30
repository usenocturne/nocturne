import styles from "./Tracklist.module.scss";

const getTextBasedOnUri = (uri) => {
  if (!uri) return "";

  if (uri.includes("playlist:")) {
    return "No songs have been added to this playlist";
  } else if (uri.includes("collection:")) {
    if (uri.includes("your-episodes")) {
      return "Episodes you've collected live here.";
    } else if (uri.includes("new-episodes")) {
      return "Once you follow a show, episode reminders will appear here.";
    }
    return "Songs you like will appear here.";
  }
  return "";
};

const EmptyTracklistState = ({ contextUri }) => {
  return (
    <div className={styles.emptyBody} data-testid="empty-body">
      <p>{getTextBasedOnUri(contextUri)}</p>
    </div>
  );
};

export default EmptyTracklistState;
