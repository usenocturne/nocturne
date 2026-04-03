import React from "react";
import { findClosestGlyphAvailable, Icon } from "../";
export function IconPlay(props) {
  var _props$autoMirror;

  var iconList = [
    {
      size: 16,
      svgContent:
        "<path d='M3 1.713a.7.7 0 011.05-.607l10.89 6.288a.7.7 0 010 1.212L4.05 14.894A.7.7 0 013 14.288V1.713z'/>",
    },
    {
      size: 24,
      svgContent:
        "<path d='M7.05 3.606l13.49 7.788a.7.7 0 010 1.212L7.05 20.394A.7.7 0 016 19.788V4.212a.7.7 0 011.05-.606z'/>",
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

export function Experimental__IconPlay(props) {
  return React.createElement(IconPlay, props);
}
