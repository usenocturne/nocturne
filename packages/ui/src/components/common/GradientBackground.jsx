import { useEffect } from 'react';
import { useGradientTransition } from '../../hooks/useGradientTransition';
import classNames from 'classnames';

const GradientBackground = ({
  gradientState = {
    imageURL: null,
    section: null,
  },
  className = ""
}) => {
  const {
    currentColor1,
    currentColor2,
    currentColor3,
    currentColor4,
    generateMeshGradient,
    updateGradientColors,
  } = useGradientTransition(gradientState.section);

  useEffect(() => {
    updateGradientColors(gradientState.imageURL, gradientState.section);
  }, [updateGradientColors, gradientState]);

  return (
    <div
      style={{
        backgroundImage: generateMeshGradient([
          currentColor1,
          currentColor2,
          currentColor3,
          currentColor4,
        ]),
        transitionProperty: 'background-image',
        transitionDuration: '0.5s',
        transitionTimingFunction: 'linear',
      }}
      className={classNames("absolute", "inset-0", className)}
    />
  );
};

export default GradientBackground;
