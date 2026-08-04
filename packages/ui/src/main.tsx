import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Nocturne UI root element is missing");
}

ReactDOM.createRoot(root).render(<App />);
