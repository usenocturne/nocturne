import React from "react";
import { findClosestGlyphAvailable, Icon } from "../";
export function IconMore(props) {
  var _props$autoMirror;

  var iconList = [
    {
      size: 16,
      svgContent:
        "<path d='M3 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm6.5 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z'/>",
    },
    {
      size: 24,
      svgContent:
        "<path d='M4.5 13.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm15 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm-7.5 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z'/>",
    },
  ];
  var closestSize = findClosestGlyphAvailable(iconList, props.iconSize || 24);

  var titleTag = function titleTag(title, titleId) {
    return title
      ? "<title "
          .concat(titleId ? 'id="'.concat(titleId, '"') : "", ">")
          .concat(title, "</title>")
      : "";
  };

  var descTag = function descTag(desc, descId) {
    return desc
      ? "<desc "
          .concat(descId ? 'id="'.concat(descId, '"') : "", ">")
          .concat(desc, "</desc>")
      : "";
  };

  var autoMirror =
    (_props$autoMirror = props.autoMirror) !== null &&
    _props$autoMirror !== void 0
      ? _props$autoMirror
      : false;
  return React.createElement(
    Icon,
    Object.assign({}, props, {
      autoMirror: autoMirror,
      viewBox: "0 0 ".concat(closestSize.size, " ").concat(closestSize.size),
      dangerouslySetInnerHTML: {
        __html: ""
          .concat(titleTag(props.title, props.titleId))
          .concat(descTag(props.desc, props.descId))
          .concat(closestSize.svgContent),
      },
    }),
  );
}

export function Experimental__IconMore(props) {
  return React.createElement(IconMore, props);
}
