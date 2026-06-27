import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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
  Menu,
  X,
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
  const [mobileOpen, setMobileOpen] = useState(false);

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

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

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

  const SignOutButton = ({ collapsed: c }: { collapsed?: boolean }) => (
    <button
      onClick={handleSignOut}
      title={c ? "Sign out" : undefined}
      className={cn(
        "flex w-full items-center rounded-lg py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/50",
        c ? "justify-center px-0" : "gap-3 px-3",
      )}
    >
      <LogOut className="size-4 shrink-0" />
      {!c && <span>Sign out</span>}
    </button>
  );

  return (
    <div className="flex min-h-screen bg-gradient-soft">
      {/* Desktop sidebar */}
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
          <SignOutButton collapsed={collapsed} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
              {Brand}
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="grid size-9 shrink-0 place-items-center rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col pt-3">
              <NavList onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="shrink-0 border-t border-sidebar-border p-3">
              <SignOutButton />
            </div>
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
          <div className="flex h-16 items-center gap-2 px-4 lg:px-8">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="grid size-10 shrink-0 place-items-center rounded-lg text-foreground/70 transition-colors hover:bg-secondary lg:hidden"
            >
              <Menu className="size-5" />
            </button>
            <div className="lg:hidden">{Brand}</div>
            <div className="min-w-0 flex-1" />
            <div className="max-w-[160px] truncate text-sm text-muted-foreground sm:max-w-[200px]">{user?.email}</div>
          </div>
        </header>
        <main className="flex-1 animate-fade-in p-4 lg:p-8">
          {/* Fill the available width (just the page padding) so collapsing the sidebar uses the
              freed space, instead of capping at a max width and leaving empty margins — matches iTrova. */}
          <div className="w-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
