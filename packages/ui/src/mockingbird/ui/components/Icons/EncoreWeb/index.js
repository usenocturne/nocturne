import React from 'react';

export function findClosestGlyphAvailable(iconList, targetSize) {
  let best = iconList[0];
  for (const icon of iconList) {
    if (icon.size <= targetSize && icon.size > best.size) {
      best = icon;
    }
  }
  return best;
}

export function Icon(props) {
  var iconSize = props.iconSize || 24;
  var viewBox = props.viewBox;
  var dangerouslySetInnerHTML = props.dangerouslySetInnerHTML;
  var className = props.className;
  var style = props.style;

  return /*#__PURE__*/React.createElement("svg", Object.assign({}, props, {
    width: iconSize,
    height: iconSize,
    viewBox: viewBox,
    fill: "currentColor",
    className: className,
    style: style,
    dangerouslySetInnerHTML: dangerouslySetInnerHTML
  }));
}