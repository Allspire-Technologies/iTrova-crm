import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Workflow,
  ListChecks,
  Settings,
  LogOut,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/customers", label: "Customers", icon: Building2 },
  { to: "/pipeline", label: "Pipeline", icon: Workflow },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: Settings },
];

const STORAGE_KEY = "adminos.sidebar.collapsed";

function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-2">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            cn(
              "group flex items-center rounded-lg py-3 text-sm font-medium transition-colors",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
            )
          }
        >
          <item.icon className="size-5 shrink-0" />
          {!collapsed && <span className="flex-1">{item.label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  const Brand = (
    <div className="flex items-center gap-2 font-display text-xl font-bold">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
        <ShieldCheck className="size-4" />
      </div>
      <div className="leading-tight">
        iTrova
        <div className="text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">Admin OS</div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-gradient-soft">
      {/* Sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out lg:flex",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-sidebar-border",
            collapsed ? "justify-center px-2" : "justify-between px-4",
          )}
        >
          {!collapsed && Brand}
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          <NavList collapsed={collapsed} />
        </div>
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <button
            onClick={handleSignOut}
            title={collapsed ? "Sign out" : undefined}
            className={cn(
              "flex w-full items-center rounded-lg py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
            )}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 lg:px-8">
            <div className="lg:hidden">{Brand}</div>
            <div className="min-w-0 flex-1" />
            <div className="max-w-[200px] truncate text-sm text-muted-foreground">{user?.email}</div>
            <Button variant="outline" size="sm" className="lg:hidden" onClick={handleSignOut}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1 animate-fade-in p-4 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
