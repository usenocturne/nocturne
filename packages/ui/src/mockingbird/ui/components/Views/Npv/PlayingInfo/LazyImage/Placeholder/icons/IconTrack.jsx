import React from 'react';

const findClosestSize = (iconList, requestedSize = 24) => {
  return iconList.find(icon => icon.size >= requestedSize) || iconList[iconList.length - 1];
};

const Icon = ({ viewBox, dangerouslySetInnerHTML, iconSize, autoMirror, title, titleId, desc, descId, ...props }) => {
  return (
    <svg
      viewBox={viewBox}
      {...props}
      dangerouslySetInnerHTML={dangerouslySetInnerHTML}
      style={{ width: '24px', height: '24px', fill: 'currentColor' }}
    />
  );
};

export function IconTrack(props) {
  var _props$autoMirror;

  /* prettier-ignore */
  var iconList = [{
    'size': 16,
    'svgContent': '<path d=\'M10 2v9.5a2.75 2.75 0 11-2.75-2.75H8.5V2H10zm-1.5 8.25H7.25A1.25 1.25 0 108.5 11.5v-1.25z\'/>'
  }, {
    'size': 24,
    'svgContent': '<path d=\'M15 4v12.167a3.5 3.5 0 11-3.5-3.5H13V4h2zm-2 10.667h-1.5a1.5 1.5 0 101.5 1.5v-1.5z\'/>'
  }];
  var closestSize = findClosestSize(iconList, props.iconSize || 24);

  var titleTag = function titleTag(title, titleId) {
    return title ? "<title ".concat(titleId ? "id=\"".concat(titleId, "\"") : "", ">").concat(title, "</title>") : "";
  };

  var descTag = function descTag(desc, descId) {
    return desc ? "<desc ".concat(descId ? "id=\"".concat(descId, "\"") : "", ">").concat(desc, "</desc>") : "";
  };

  var autoMirror = (_props$autoMirror = props.autoMirror) !== null && _props$autoMirror !== void 0 ? _props$autoMirror : false;
  return /*#__PURE__*/React.createElement(Icon, Object.assign({}, props, {
    autoMirror: autoMirror,
    viewBox: "0 0 ".concat(closestSize.size, " ").concat(closestSize.size),
    dangerouslySetInnerHTML: {
      __html: "".concat(titleTag(props.title, props.titleId)).concat(descTag(props.desc, props.descId)).concat(closestSize.svgContent)
    }
  }));
}