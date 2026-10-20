import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootPortal } from "./portal";

bootPortal();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
