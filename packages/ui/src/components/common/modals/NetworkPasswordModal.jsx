import React, { useState, useRef, useEffect } from "react";
import Keyboard from "react-simple-keyboard";
import "react-simple-keyboard/build/css/index.css";
import { renderToStaticMarkup } from "react-dom/server";
import { useWiFiNetworks } from "../../../hooks/useWiFiNetworks";
import { BackspaceIcon, ShiftIcon, CapsLockIcon, KeyboardHideIcon } from "../icons";

export default function NetworkPasswordModal({
  network,
  onClose,
  onConnect
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [layoutName, setLayoutName] = useState("default");
  const [capsLock, setCapsLock] = useState(false);
  const keyboard = useRef();
  const { connectToNetwork, hasPasswordSecurity, isConnecting } = useWiFiNetworks();

  const handleConnect = async function(e) {
    e.preventDefault();
    setError("");

    try {
      const success = await connectToNetwork(network, password);
      if (success) {
        setPassword("");
        onConnect();
      } else {
        setError("Failed to connect to network. Please try again.");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCancel = function() {
    setPassword("");
    onClose();
  };

  const onChangeInput = function(event) {
    const inputValue = event.target.value;
    setPassword(inputValue);
    if (keyboard.current) {
      keyboard.current.setInput(inputValue);
    }
  };

  const onKeyPress = function(button) {
    console.log("Button pressed", button);

    if (button === "{bksp}") {
      setPassword(password.slice(0, -1));
    } else if (button === "{enter}") {
      handleConnect({ preventDefault: function() {} });
    } else if (button === "{space}") {
      setPassword(password + " ");
    } else if (button === "{shift}") {
      const newLayoutName = layoutName === "default" ? "shift" : "default";
      setLayoutName(newLayoutName);
    } else if (button === "{lock}") {
      const newCapsLock = !capsLock;
      setCapsLock(newCapsLock);
      setLayoutName(newCapsLock ? "shift" : "default");
    } else if (button === "{numbers}") {
      setLayoutName("numbers");
    } else if (button === "{symbols}") {
      setLayoutName("symbols");
    } else if (button === "{default}") {
      setLayoutName("default");
    } else if (button === "{hide}") {
      setShowKeyboard(false);
    } else {
      setPassword(password + button);
      if (layoutName === "shift" && !capsLock) {
        setLayoutName("default");
      }
    }
  };



  const onInputFocus = function() {
    setShowKeyboard(true);
  };

  useEffect(function() {
    if (network && hasPasswordSecurity && hasPasswordSecurity(network.flags)) {
      setShowKeyboard(true);
    }
  }, [network, hasPasswordSecurity]);

  if (!network) return null;

  const needsPassword = hasPasswordSecurity && hasPasswordSecurity(network.flags);

  const layout = {
    default: [
      "q w e r t y u i o p {bksp}",
      "a s d f g h j k l ; {enter}",
      "{shift} z x c v b n m , . {lock}",
      "{numbers} {space} {numbers} {hide}"
    ],
    shift: [
      "Q W E R T Y U I O P {bksp}",
      "A S D F G H J K L : {enter}",
      "{shift} Z X C V B N M < > {lock}",
      "{numbers} {space} {numbers} {hide}"
    ],
    numbers: [
      "1 2 3 4 5 6 7 8 9 0 {bksp}",
      "- / : ; ( ) $ & @ \" {enter}",
      "{symbols} . , ? ! ' + - = ' {lock}",
      "{default} {space} {default} {hide}"
    ],
    symbols: [
      "[ ] { } # % ^ * + = {bksp}",
      "_ \\ | ~ < > € £ ¥ • {enter}",
      "{numbers} ` ¿ ¡ § ° † ‡ … ≠ {lock}",
      "{default} {space} {default} {hide}"
    ]
  };

  const display = {
    "{bksp}": renderToStaticMarkup(<BackspaceIcon size={20} />),
    "{enter}": "return",
    "{shift}": renderToStaticMarkup(<ShiftIcon size={20} />),
    "{lock}": renderToStaticMarkup(<CapsLockIcon size={20} />),
    "{space}": "space",
    "{numbers}": "?123",
    "{symbols}": "#+= ",
    "{default}": "ABC",
    "{hide}": renderToStaticMarkup(<KeyboardHideIcon size={20} />)
  };

  const buttonTheme = [
    {
      class: "hg-red",
      buttons: "{bksp}"
    },
    {
      class: "hg-green", 
      buttons: "{enter}"
    }
  ];

  if (layoutName === "shift" && !capsLock) {
    buttonTheme.push({
      class: "hg-highlight",
      buttons: "{shift}"
    });
  }

  if (capsLock) {
    buttonTheme.push({
      class: "hg-highlight",
      buttons: "{lock}"
    });
  }

  if (layoutName === "numbers") {
    buttonTheme.push({
      class: "hg-highlight",
      buttons: "{numbers}"
    });
  }

  if (layoutName === "symbols") {
    buttonTheme.push({
      class: "hg-highlight",
      buttons: "{symbols}"
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/90 pt-8">
        <div className="w-full max-w-[600px] mx-auto p-6">
          <div className="bg-[#1A1A1A] rounded-2xl p-6 shadow-lg border border-white/10">
            <h3 className="text-[28px] font-[580] text-white tracking-tight mb-6">
              Connect to {network.ssid}
            </h3>

            <form onSubmit={handleConnect}>
              {needsPassword && (
                <input
                  type="text"
                  value={password}
                  onChange={onChangeInput}
                  onFocus={onInputFocus}
                  placeholder="Password"
                  className="w-full bg-white/10 rounded-xl px-6 py-4 text-[24px] text-white placeholder-white/40 border border-white/10 mb-6 focus:outline-none"
                  autoFocus
                />
              )}

              {error && (
                <div className="text-red-500 text-[20px] mb-6">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-4">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-6 py-3 text-[24px] font-[560] text-white/60 hover:text-white transition-colors"
                  style={{ background: 'none' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isConnecting || (needsPassword && !password)}
                  className="bg-white/10 hover:bg-white/20 transition-colors rounded-xl px-6 py-3 text-[24px] font-[560] text-white disabled:opacity-50"
                >
                  {isConnecting ? "Connecting..." : "Connect"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {showKeyboard && (
        <div className="fixed bottom-0 left-0 right-0 z-[110] p-4">
          <div className="max-w-[800px] mx-auto">
            <Keyboard
              keyboardRef={function(r) { keyboard.current = r; }}
              layoutName={layoutName}
              layout={layout}
              display={display}
              onKeyPress={onKeyPress}
              physicalKeyboardHighlight={false}
              theme="hg-theme-default hg-layout-default"
              buttonTheme={buttonTheme}
            />
          </div>
        </div>
      )}
    </>
  );
} 