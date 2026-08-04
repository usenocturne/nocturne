import { useNavigate } from "react-router-dom";
import type { MouseEvent, ReactNode } from "react";

interface RedirectProps {
  href?: string | null;
  children: ReactNode;
  accessToken?: string | null;
}

const Redirect = ({ href, children, accessToken }: RedirectProps) => {
  const navigate = useNavigate();

  if (!href) {
    return <div>{children}</div>;
  }

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    navigate(
      `${href}${href.includes("?") ? "&" : "?"}accessToken=${accessToken}`,
    );
  };

  return (
    <a href={href} onClick={handleClick}>
      {children}
    </a>
  );
};

export default Redirect;
