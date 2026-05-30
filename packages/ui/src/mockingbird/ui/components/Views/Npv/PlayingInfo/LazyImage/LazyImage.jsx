import classNames from "classnames";
import Placeholder from "./Placeholder/Placeholder";
import { observer } from "mobx-react-lite";
import { useState, useEffect, useRef } from "react";
import styles from "./LazyImage.module.scss";
import {
  resolveImageUrl,
  getCachedImageUrl,
} from "../../../../../utils/imageProxy";

export const getImageBorderRadius = (uri, size) => {
  const podcastSize = size >= 240 ? "16px" : "8px";

  if (uri.includes("artist")) {
    return "50%";
  }
  if (uri.includes("show") || uri.includes("episode")) {
    return podcastSize;
  }
  return "";
};

const getOuterBorderRadius = (uri, size) => {
  const podcastSize = size === 240 ? "24px" : "16px";

  if (uri.includes("artist")) {
    return "50%";
  }
  if (uri.includes("show") || uri.includes("episode")) {
    return podcastSize;
  }
  return "12px";
};

const LazyImage = ({
  imageId,
  size,
  scale = 5,
  uri,
  shouldLoad = true,
  onClick,
  dataTestId,
  longPressing,
  innerBorder,
  isActive: outerBorder,
}) => {
  const [resolvedSrc, setResolvedSrc] = useState(() =>
    getCachedImageUrl(imageId),
  );
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!imageId || !shouldLoad) {
      setResolvedSrc(null);
      return;
    }

    const cached = getCachedImageUrl(imageId);
    if (cached) {
      setResolvedSrc(cached);
      return;
    }

    setResolvedSrc(null);
    resolveImageUrl(imageId).then((src) => {
      if (!cancelledRef.current) {
        setResolvedSrc(src);
      }
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [imageId, shouldLoad]);

  const getClassName = () => {
    if (uri.includes("track")) {
      return styles.track;
    }
    if (uri.includes("show")) {
      return styles.show;
    }
    if (uri.includes("episode")) {
      return styles.episode;
    }
    if (uri.includes("artist")) {
      return styles.artist;
    }
    return "";
  };

  const getImageTag = (image, imgSize) => {
    const imageBorderRadius = getImageBorderRadius(uri, size);
    return (
      <img
        style={{
          width: `${imgSize}px`,
          height: `${imgSize}px`,
          borderRadius: imageBorderRadius,
        }}
        data-testid={dataTestId}
        className={classNames(getClassName(), {
          [styles.image]: true,
          [styles.shaded]: longPressing,
        })}
        src={image || imageId}
        alt=""
      />
    );
  };

  const getImageTemplate = (image) => {
    const showInnerBorder =
      innerBorder && (uri.includes("track") || uri.includes("episode"));
    const innerBorderColor = showInnerBorder ? "black" : undefined;

    return (
      <div
        className={classNames(getClassName(), {
          [styles.innerBorder]: innerBorderColor,
        })}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderColor: innerBorderColor,
          backgroundColor: innerBorderColor,
        }}
        onClick={(e) => {
          if (onClick) {
            onClick(e);
          }
        }}
      >
        {getImageTag(image, size)}
      </div>
    );
  };

  const wrapComponent = (component) => {
    const outerBorderRadius = getOuterBorderRadius(uri, size);
    return (
      <div className={styles.imageCenter} style={{ height: `${size}px` }}>
        <div
          className={classNames(styles.outerBorder, getClassName(), {
            [styles.outerBorderActive]: outerBorder,
          })}
          style={{
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: outerBorderRadius,
          }}
        >
          {component}
        </div>
      </div>
    );
  };

  if (resolvedSrc && shouldLoad) {
    return wrapComponent(getImageTemplate(resolvedSrc));
  }

  return wrapComponent(
    <Placeholder
      uri={uri}
      size={size}
      onClick={onClick}
      scale={scale}
      isActive={outerBorder}
    />,
  );
};

export default observer(LazyImage);
