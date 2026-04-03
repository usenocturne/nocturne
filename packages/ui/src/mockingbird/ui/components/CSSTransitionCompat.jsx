import React, { useRef } from "react";
import { CSSTransition as OriginalCSSTransition } from "react-transition-group";

const CSSTransition = ({ children, ...props }) => {
  const nodeRef = useRef(null);

  return (
    <OriginalCSSTransition {...props} nodeRef={nodeRef}>
      <div ref={nodeRef}>{children}</div>
    </OriginalCSSTransition>
  );
};

export { CSSTransition };
export default CSSTransition;
