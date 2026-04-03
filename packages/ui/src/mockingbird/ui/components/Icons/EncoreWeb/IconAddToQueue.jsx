import React from 'react';

const IconAddToQueue = ({ className, iconSize = 24 }) => {
  const svgContent = iconSize === 16
    ? '<path d="M16 15H2v-1.5h14V15zm0-4.5H2V9h14v1.5zm-8.034-6A5.484 5.484 0 017.187 6H13.5a2.5 2.5 0 000-5H7.966c.159.474.255.978.278 1.5H13.5a1 1 0 110 2H7.966zM2 2V0h1.5v2h2v1.5h-2v2H2v-2H0V2h2z"/>'
    : '<path d="M10.93 5a7.062 7.062 0 000-2h7.62a3.5 3.5 0 110 7H7.608a7.037 7.037 0 002.137-2h8.805a1.5 1.5 0 000-3h-7.62zM3 16h18v-2H3v2zm0 6h18v-2H3v2zM5 3h3v2H5v3H3V5H0V3h3V0h2v3z"/>';

  return (
    <svg
      width={iconSize}
      height={iconSize}
      viewBox={`0 0 ${iconSize} ${iconSize}`}
      fill="currentColor"
      className={className}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
};

export default IconAddToQueue;