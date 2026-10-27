import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { Layout } from "./components/Layout.jsx";
import { Loading } from "./components/ui.jsx";
import Landing from "./pages/Landing.jsx";
import OwnerDashboard from "./pages/OwnerDashboard.jsx";
import WillWizard from "./pages/WillWizard.jsx";
import ExecutorDashboard from "./pages/ExecutorDashboard.jsx";
import BeneficiaryDashboard from "./pages/BeneficiaryDashboard.jsx";
import Vault from "./pages/Vault.jsx";
import Explorer, { PublicExplorer } from "./pages/Explorer.jsx";
import Notifications from "./pages/Notifications.jsx";
import Settings from "./pages/Settings.jsx";
import SecurityLab from "./pages/SecurityLab.jsx";
import Admin from "./pages/Admin.jsx";

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading label="Restoring your session…" />;
  if (!user) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  return children;
}

/** Pages that need a wallet are off-limits to the read-only admin, and vice versa. */
function Only({ admin = false, children }) {
  const { isAdmin } = useAuth();
  if (admin !== isAdmin) return <Navigate to={isAdmin ? "/app/admin" : "/app"} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/explorer" element={<PublicExplorer />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Only><OwnerDashboard /></Only>} />
        <Route path="will/new" element={<Only><WillWizard /></Only>} />
        <Route path="executor" element={<Only><ExecutorDashboard /></Only>} />
        <Route path="beneficiary" element={<Only><BeneficiaryDashboard /></Only>} />
        <Route path="vault" element={<Only><Vault /></Only>} />
        <Route path="security" element={<Only><SecurityLab /></Only>} />
        <Route path="admin" element={<Only admin><Admin /></Only>} />
        <Route path="explorer" element={<Explorer />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
