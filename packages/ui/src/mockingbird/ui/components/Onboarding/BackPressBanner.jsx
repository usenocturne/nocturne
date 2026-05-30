import styles from "./BackPressBanner.module.scss";

const BackPressBanner = () => {
  return (
    <div className={styles.banner} data-testid="back-press-banner">
      <span>Press back</span>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M1 8h14M9 2l6 6-6 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

export default BackPressBanner;
