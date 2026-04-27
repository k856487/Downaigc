import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { hasAdminAccess } from "../state/adminAuth";

const AdminRouteGuard: React.FC = () => {
  const location = useLocation();
  if (!hasAdminAccess()) {
    return (
      <Navigate
        to="/admin/login"
        replace
        state={{ from: location.pathname }}
      />
    );
  }
  return <Outlet />;
};

export default AdminRouteGuard;

