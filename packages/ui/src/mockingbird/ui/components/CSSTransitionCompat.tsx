import { useRef, type ReactNode } from "react";
import { CSSTransition as OriginalCSSTransition } from "react-transition-group";
import type { CSSTransitionProps } from "react-transition-group/CSSTransition";

type Props = CSSTransitionProps<HTMLDivElement> & { children?: ReactNode };

const CSSTransition = ({ children, ...props }: Props) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  return (
    <OriginalCSSTransition {...props} nodeRef={nodeRef}>
      <div ref={nodeRef}>{children}</div>
    </OriginalCSSTransition>
  );
};

export { CSSTransition };
export default CSSTransition;
