import React from "react";
import { Outlet } from "react-router-dom";
import AppHeader from "../components/AppHeader";

const AuthLayout: React.FC = () => {
  return (
    <>
      <AppHeader />
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-auth-page, var(--bg-page))"
        }}
      >
        <Outlet />
      </div>
    </>
  );
};

export default AuthLayout;

