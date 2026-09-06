const pointerListenersMaker = (setPressed: (pressed: boolean) => void) => {
  return {
    onMouseDown: () => setPressed(true),
    onMouseUp: () => setPressed(false),
    onMouseLeave: () => setPressed(false),
    onTouchStart: () => setPressed(true),
    onTouchEnd: () => setPressed(false),
  };
};

export default pointerListenersMaker;
