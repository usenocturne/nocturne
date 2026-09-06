import type { ReactNode } from "react";
import styles from "./SubmenuHeader.module.scss";

const SubmenuHeader = ({ icon, name }: { icon?: ReactNode; name: string }) => {
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
