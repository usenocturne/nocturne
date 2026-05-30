import "./Type.scss";
import classNames from "classnames";
import React from "react";

const Type = React.forwardRef(
  (
    { children, name, textColor, className, dataTestId, onClick, style },
    ref,
  ) => {
    return (
      <div
        data-testid={dataTestId}
        className={classNames(name, className)}
        style={{ color: textColor, ...style }}
        onClick={onClick}
        ref={ref}
      >
        {children}
      </div>
    );
  },
);

export default Type;
