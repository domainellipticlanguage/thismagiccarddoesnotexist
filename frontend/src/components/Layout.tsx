import { Outlet } from "react-router-dom";
import { Navbar } from "./Navbar";

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-neutral-950">
      <Navbar />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-8">
        <Outlet />
      </main>
      <footer className="text-center text-neutral-600 text-sm py-4 border-t border-neutral-800">
        This Magic Card Does Not Exist &mdash; AI-generated MTG cards
      </footer>
    </div>
  );
}
