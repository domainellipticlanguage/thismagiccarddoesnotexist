import { Link, Outlet } from "react-router-dom";
import { Navbar } from "./Navbar";

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-neutral-950">
      <Navbar />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <Outlet />
      </main>
      <footer className="py-4 border-t border-neutral-800 flex flex-col items-center gap-2 text-sm text-neutral-600">
        <div>This Magic Card Does Not Exist &mdash; AI-generated MTG cards</div>
        <Link
          to="/about"
          className="inline-flex items-center gap-1.5 text-neutral-500 hover:text-gold-400 transition-colors"
        >
          <span>Powered by</span>
          <img
            src="https://raw.githubusercontent.com/domainellipticlanguage/mtg-crucible/main/logo/logo-256.png"
            alt=""
            className="h-4 w-4"
          />
          <span className="font-medium">mtg-crucible</span>
        </Link>
      </footer>
    </div>
  );
}
