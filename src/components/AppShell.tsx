import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Building2, Workflow, ListChecks, Settings, LogOut, ShieldCheck } from "lucide-react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/customers", label: "Customers", icon: Building2 },
  { to: "/pipeline", label: "Pipeline", icon: Workflow },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: Settings },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `group flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            }`
          }
        >
          <item.icon className="size-5 shrink-0" />
          <span className="flex-1">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const handleSignOut = async () => { await signOut(); navigate("/login", { replace: true }); };

  const Brand = (
    <div className="flex items-center gap-2 font-display text-xl font-bold">
      <div className="size-9 rounded-xl bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center shrink-0">
        <ShieldCheck className="size-4" />
      </div>
      <div className="leading-tight">
        iTrova
        <div className="text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">Admin OS</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-gradient-soft">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-sidebar text-sidebar-foreground sticky top-0 h-screen">
        <div className="px-6 py-4 border-b border-sidebar-border shrink-0">{Brand}</div>
        <div className="pt-3 flex-1 flex flex-col min-h-0">
          <NavList />
        </div>
        <div className="p-3 border-t border-sidebar-border shrink-0">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 transition-colors"
          >
            <LogOut className="size-4 shrink-0" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 lg:px-8 h-16">
            <div className="lg:hidden">{Brand}</div>
            <div className="min-w-0 flex-1" />
            <div className="text-sm text-muted-foreground truncate max-w-[200px]">{user?.email}</div>
            <Button variant="outline" size="sm" className="lg:hidden" onClick={handleSignOut}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8 animate-fade-in">
          <div className="w-full max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
