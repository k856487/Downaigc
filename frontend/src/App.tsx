import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AuthLayout from "./layouts/AuthLayout";
import ConsoleLayout from "./layouts/ConsoleLayout";
import AdminLayout from "./layouts/AdminLayout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import PolishConsolePage from "./pages/PolishConsolePage";
import PolishWorkbenchPage from "./pages/PolishWorkbenchPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import FeedbackPage from "./pages/FeedbackPage";
import JourneyInsightsPage from "./pages/JourneyInsightsPage";
import AdminLoginPage from "./pages/admin/AdminLoginPage";
import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import AdminFeedbackPage from "./pages/admin/AdminFeedbackPage";
import AdminRouteGuard from "./routes/AdminRouteGuard";
import ScanLoginPage from "./pages/ScanLoginPage";

const App: React.FC = () => {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/scan-login" element={<ScanLoginPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
      </Route>

      <Route path="/console" element={<ConsoleLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="polish" element={<PolishConsolePage />} />
        <Route path="polish/:taskId" element={<PolishWorkbenchPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="journey" element={<JourneyInsightsPage />} />
        <Route path="feedback" element={<FeedbackPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route element={<AdminRouteGuard />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboardPage />} />
          <Route path="feedback" element={<AdminFeedbackPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
};

export default App;

