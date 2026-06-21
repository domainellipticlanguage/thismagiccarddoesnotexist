import { Link, useLocation } from "react-router-dom";

const NAV_LINKS = [
  { to: "/", label: "Gallery" },
  { to: "/create", label: "Create" },
  { to: "/about", label: "About" },
];

export function Navbar() {
  const location = useLocation();
  return (
    <nav className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="group font-display text-lg text-gold-400 hover:text-gold-500 transition-colors flex items-center gap-2">
          <span aria-hidden className="font-mono text-gold-500/70 group-hover:text-gold-400 transition-colors">{"{"}</span>
          <span aria-hidden className="text-xl leading-none -mx-1">🃏</span>
          <span aria-hidden className="font-mono text-gold-500/70 group-hover:text-gold-400 transition-colors">{"}"}</span>
          <span className="ml-1">This Magic Card Does Not Exist</span>
        </Link>
        <div className="flex gap-6">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`text-sm font-medium transition-colors ${
                location.pathname === link.to ? "text-gold-400" : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
