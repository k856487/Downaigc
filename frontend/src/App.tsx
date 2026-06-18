import React, { Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import RouteFallback from "./components/RouteFallback";

const AuthLayout = React.lazy(() => import("./layouts/AuthLayout"));
const ConsoleLayout = React.lazy(() => import("./layouts/ConsoleLayout"));
const AdminLayout = React.lazy(() => import("./layouts/AdminLayout"));
const AdminRouteGuard = React.lazy(() => import("./routes/AdminRouteGuard"));

const LoginPage = React.lazy(() => import("./pages/LoginPage"));
const RegisterPage = React.lazy(() => import("./pages/RegisterPage"));
const ScanLoginPage = React.lazy(() => import("./pages/ScanLoginPage"));
const DashboardPage = React.lazy(() => import("./pages/DashboardPage"));
const PolishConsolePage = React.lazy(() => import("./pages/PolishConsolePage"));
const PolishWorkbenchPage = React.lazy(() => import("./pages/PolishWorkbenchPage"));
const HistoryPage = React.lazy(() => import("./pages/HistoryPage"));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));
const FeedbackPage = React.lazy(() => import("./pages/FeedbackPage"));
const JourneyInsightsPage = React.lazy(() => import("./pages/JourneyInsightsPage"));
const WalletRechargePage = React.lazy(() => import("./pages/WalletRechargePage"));
const WalletBalancePage = React.lazy(() => import("./pages/WalletBalancePage"));
const WalletPointsPage = React.lazy(() => import("./pages/WalletPointsPage"));
const AdHubPromoPage = React.lazy(() => import("./pages/AdHubPromoPage"));
const AdminDashboardPage = React.lazy(() => import("./pages/admin/AdminDashboardPage"));
const AdminFeedbackPage = React.lazy(() => import("./pages/admin/AdminFeedbackPage"));
const AdminFeedbackDetailPage = React.lazy(
  () => import("./pages/admin/AdminFeedbackDetailPage")
);
const AdminUsersPage = React.lazy(() => import("./pages/admin/AdminUsersPage"));
const AdminRedeemCodesPage = React.lazy(
  () => import("./pages/admin/AdminRedeemCodesPage")
);

/** 旧书签 /admin/login → 统一走普通登录页 */
const LegacyAdminLoginRedirect: React.FC = () => {
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  return <Navigate to="/login" replace state={from ? { from } : undefined} />;
};

const App: React.FC = () => {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/scan-login" element={<ScanLoginPage />} />
          <Route path="/admin/login" element={<LegacyAdminLoginRedirect />} />
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
          <Route path="wallet/balance" element={<WalletBalancePage />} />
          <Route path="wallet/recharge" element={<WalletRechargePage />} />
          <Route path="wallet/points" element={<WalletPointsPage />} />
          <Route path="wallet/adhub" element={<AdHubPromoPage />} />
        </Route>

        <Route element={<AdminRouteGuard />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboardPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="redeem-codes" element={<AdminRedeemCodesPage />} />
            <Route path="feedback" element={<AdminFeedbackPage />} />
            <Route
              path="feedback/:feedbackId"
              element={<AdminFeedbackDetailPage />}
            />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
};

export default App;
