import { useEffect, useCallback, memo, useRef } from 'react';
import classNames from 'classnames';
import { BrightnessHighIcon, BrightnessMidIcon, BrightnessLowIcon } from '../icons';

const updateBrightnessOnServer = async (brightness) => {
  try {
    const response = await fetch(`http://localhost:5000/device/brightness/${brightness}`, {
      method: 'POST',
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to update brightness on server:', error);
    return false;
  }
};

const BrightnessOverlay = memo(({ isVisible, brightness, onBrightnessChange, onDismiss }) => {
  const isActiveRef = useRef(isVisible);
  
  useEffect(() => {
    isActiveRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    if (isVisible) {
      let isMounted = true;
      
      const initialFetch = async () => {
        try {
          const response = await fetch('http://localhost:5000/device/brightness');
          if (response.ok && isMounted) {
            const data = await response.json();
            if (data && typeof data.brightness === 'number') {
              onBrightnessChange(data.brightness);
            }
          }
        } catch (error) {
          console.error('Failed to fetch brightness:', error);
        }
      };
      
      initialFetch();
      return () => { isMounted = false; };
    }
  }, [isVisible, onBrightnessChange]);
  
  const handleWheel = useCallback((event) => {
    if (isActiveRef.current) {
      event.preventDefault();
      event.stopPropagation();
      
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      
      onBrightnessChange(prevBrightness => {
        const newBrightness = Math.max(5, Math.min(250, prevBrightness + (delta > 0 ? -5 : 5)));
        updateBrightnessOnServer(newBrightness).catch(console.error);
        return newBrightness;
      });
      
      return false;
    }
  }, [onBrightnessChange]);

  const handleKeyDown = useCallback((event) => {
    if (!isActiveRef.current) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    if (event.key === 'Escape' || event.key === 'Enter' || event.key.toLowerCase() === 'm') {
      onDismiss();
    }
    
    return false;
  }, [onBrightnessChange]);
  
  const handlePointerEvent = useCallback((event) => {
    if (!isActiveRef.current) return;
    
    if (!event.target.closest('[data-brightness-control="true"]')) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  }, []);
  
  useEffect(() => {
    if (isVisible) {
      const events = [
        'click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 
        'touchmove', 'mousemove', 'contextmenu', 'dblclick',
        'focus', 'focusin', 'focusout', 'select'
      ];

      events.forEach(eventType => {
        document.addEventListener(eventType, handlePointerEvent, { 
          capture: true, 
          passive: false 
        });
      });

      document.addEventListener('wheel', handleWheel, { 
        capture: true, 
        passive: false 
      });
      
      document.addEventListener('keydown', handleKeyDown, { 
        capture: true 
      });

      document.addEventListener('keyup', e => {
        if (isActiveRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }, { capture: true });
      
      document.addEventListener('keypress', e => {
        if (isActiveRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }, { capture: true });

      document.body.focus();

      return () => {
        events.forEach(eventType => {
          document.removeEventListener(eventType, handlePointerEvent, { capture: true });
        });
        
        document.removeEventListener('wheel', handleWheel, { capture: true });
        document.removeEventListener('keydown', handleKeyDown, { capture: true });
        document.removeEventListener('keyup', e => {}, { capture: true });
        document.removeEventListener('keypress', e => {}, { capture: true });
      };
    }
  }, [isVisible, handleWheel, handleKeyDown, handlePointerEvent]);

  if (!isVisible && !brightness) return null;

  const brightnessPercent = 100 - (((brightness - 5) / (250 - 5)) * 100);
  const BrightnessIcon = brightness >= 170 
    ? BrightnessLowIcon
    : brightness >= 80 
      ? BrightnessMidIcon 
      : BrightnessHighIcon;

  return (
    <>
      {isVisible && (
        <div 
          className="fixed inset-0 z-[998]"
          style={{ 
            pointerEvents: 'all',
            touchAction: 'none',
            userSelect: 'none'
          }}
          aria-modal="true"
          role="dialog"
          onClick={(e) => e.preventDefault()}
        />
      )}
      
      <div
        data-brightness-control="true"
        className={classNames(
          "fixed right-0 top-[70px] transform transition-opacity duration-300 z-[999]",
          {
            "opacity-0 volumeOutScale": !isVisible,
            "opacity-100 volumeInScale": isVisible,
          }
        )}
      >
        <div 
          className="w-14 h-44 bg-slate-700/60 rounded-[17px] flex flex-col-reverse drop-shadow-xl overflow-hidden"
          data-brightness-control="true"
        >
          <div
            data-brightness-control="true"
            className={classNames(
              "bg-white w-full transition-all duration-200 ease-out",
              {
                "rounded-b-[13px]": brightness < 250,
                "rounded-[13px]": brightness === 250,
              }
            )}
            style={{ height: `${brightnessPercent}%` }}
          >
            <div 
              data-brightness-control="true"
              className="absolute bottom-0 left-0 right-0 flex justify-center items-center h-6 pb-7"
            >
              <BrightnessIcon className="w-7 h-7" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
});

BrightnessOverlay.displayName = 'BrightnessOverlay';

export default BrightnessOverlay;
