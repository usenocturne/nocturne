import React, { useRef } from 'react';
import { CSSTransition as OriginalCSSTransition } from 'react-transition-group';

/**
 * React 19 compatible CSSTransition wrapper.
 * Automatically provides a nodeRef to avoid findDOMNode (removed in React 19).
 * Wraps children in a <div> that receives the ref.
 */
const CSSTransition = ({ children, ...props }) => {
  const nodeRef = useRef(null);

  return (
    <OriginalCSSTransition {...props} nodeRef={nodeRef}>
      <div ref={nodeRef}>
        {children}
      </div>
    </OriginalCSSTransition>
  );
};

export { CSSTransition };
export default CSSTransition;
