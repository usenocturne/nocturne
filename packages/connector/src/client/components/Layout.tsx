import { useState } from "react";
import { Outlet, NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Bluetooth, Music, Settings, Menu, X } from "lucide-react";
import { clsx } from "clsx";
import { Logo } from "./Logo";
import { Footer } from "./Footer";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/bluetooth", label: "Bluetooth", icon: Bluetooth },
  { to: "/spotify", label: "Spotify", icon: Music },
  { to: "/settings", label: "Settings", icon: Settings },
];

function DesktopNav() {
  const location = useLocation();

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {navItems.map(({ to, label, icon: Icon }) => {
        const isActive =
          to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
        return (
          <NavLink
            key={to}
            to={to}
            className={clsx(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200",
              isActive
                ? "bg-hover text-fg"
                : "text-secondary hover:text-fg hover:bg-hover"
            )}
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function Layout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between">
          <NavLink to="/" className="shrink-0">
            <Logo className="h-8" />
          </NavLink>
          <DesktopNav />
          <button
            className="flex size-10 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-hover hover:text-fg md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {mobileOpen && (
          <div className="border-t border-line px-6 py-3 md:hidden">
            <nav className="flex flex-col gap-1">
              {navItems.map(({ to, label, icon: Icon }) => {
                const isActive =
                  to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
                return (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setMobileOpen(false)}
                    className={clsx(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                      isActive
                        ? "bg-hover text-fg"
                        : "text-secondary hover:text-fg hover:bg-hover"
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </NavLink>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1 px-6 py-8 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>

      <Footer />
    </div>
  );
}
