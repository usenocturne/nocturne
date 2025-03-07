import { useNavigate } from "react-router-dom";

const Redirect = ({ href, children, accessToken }) => {
  const navigate = useNavigate();

  if (!href) {
    return <div>{children}</div>;
  }

  const handleClick = (e) => {
    e.preventDefault();
    navigate(
      `${href}${href.includes("?") ? "&" : "?"}accessToken=${accessToken}`
    );
  };

  return (
    <a href={href} onClick={handleClick}>
      {children}
    </a>
  );
};

export default Redirect;
