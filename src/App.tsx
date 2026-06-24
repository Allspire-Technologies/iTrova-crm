import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { StaffGate } from "@/components/StaffGate";
import AppShell from "@/components/AppShell";
import Login from "@/pages/Login";
import NoAccess from "@/pages/NoAccess";
import Home from "@/pages/Home";
import Customers from "@/pages/Customers";
import CustomerDetail from "@/pages/CustomerDetail";
import Pipeline from "@/pages/Pipeline";
import Tasks from "@/pages/Tasks";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public / pre-gate */}
          <Route path="/login" element={<Login />} />
          <Route path="/no-access" element={<NoAccess />} />

          {/* Staff-only Admin OS */}
          <Route
            element={
              <StaffGate>
                <AppShell />
              </StaffGate>
            }
          >
            <Route path="/" element={<Home />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
