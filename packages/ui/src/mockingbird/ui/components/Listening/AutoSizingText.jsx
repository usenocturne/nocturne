import { useEffect, useRef, useState } from "react";
import Type from "../CarthingUIComponents/Type/Type";

const AutoSizingText = ({
  className,
  textContent,
  maxHeight,
  textSizesDescending,
  dataTestId,
}) => {
  const [showText, setShowText] = useState(true);
  const [textSizeIndex, setTextSizeIndex] = useState(0);
  const [refText, setRefText] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const preRenderDiv = ref.current;
    if (textContent !== refText) {
      setRefText(textContent);
      setShowText(false);
      setTextSizeIndex(0);
    }
    if (
      preRenderDiv &&
      preRenderDiv.offsetHeight > maxHeight &&
      textSizeIndex + 1 < textSizesDescending.length
    ) {
      setTextSizeIndex(textSizeIndex + 1);
    } else {
      setShowText(true);
    }
  }, [
    ref,
    refText,
    textContent,
    textSizeIndex,
    showText,
    maxHeight,
    textSizesDescending,
  ]);

  return showText ? (
    <Type
      name={textSizesDescending[textSizeIndex]}
      className={className}
      dataTestId={dataTestId}
      ref={ref}
    >
      {textContent}
    </Type>
  ) : null;
};

export default AutoSizingText;
