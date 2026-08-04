import styles from "./SubmenuHeader.module.scss";

const SubmenuHeader = ({ icon, name }: UiComponentProps) => {
  return (
    <div className={styles.header}>
      <div className={styles.headerDetails}>
        {icon}
        <span className={styles.title}>{name}</span>
      </div>
    </div>
  );
};

export default SubmenuHeader;
