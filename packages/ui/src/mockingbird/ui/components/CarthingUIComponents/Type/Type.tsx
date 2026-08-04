import "./Type.scss";
import classNames from "classnames";
import React from "react";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

interface TypeProps {
  children?: ReactNode;
  name?: string;
  textColor?: string;
  className?: string;
  dataTestId?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  style?: CSSProperties;
}

const Type = React.forwardRef<HTMLDivElement, TypeProps>(
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
