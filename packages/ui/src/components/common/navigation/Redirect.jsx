import Link from "next/link";

const Redirect = ({ href, children, accessToken }) => {
  if (!href) {
    return <div>{children}</div>;
  }

  return (
    <Link
      href={`${href}${
        href.includes("?") ? "&" : "?"
      }accessToken=${accessToken}`}
    >
      {children}
    </Link>
  );
};

export default Redirect;
