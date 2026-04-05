import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme } from "antd";

import App from "./App.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#14b8a6",
          colorInfo: "#14b8a6",
          colorSuccess: "#22c55e",
          colorWarning: "#f59e0b",
          colorError: "#ef4444",
          colorBgBase: "#f6fbff",
          colorTextBase: "#1f2937",
          colorBorderSecondary: "#d9e7ef",
          borderRadius: 18,
          borderRadiusLG: 24,
          boxShadowSecondary: "0 18px 48px rgba(29, 78, 216, 0.08)",
          fontFamily: '"IBM Plex Sans", "Noto Sans SC", sans-serif',
        },
        components: {
          Layout: {
            bodyBg: "#f2fbff",
            siderBg: "#ffffff",
            headerBg: "rgba(255,255,255,0.88)",
          },
          Card: {
            colorBgContainer: "#ffffff",
          },
          Table: {
            headerBg: "#f5fafc",
            headerColor: "#64748b",
            rowHoverBg: "rgba(20, 184, 166, 0.04)",
            borderColor: "#d9e7ef",
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
