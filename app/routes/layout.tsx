import { Link, Outlet } from "react-router";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="transition-colors hover:text-foreground/80 text-foreground hover:bg-gray-100/10 px-4 py-2 rounded-md">
      {children}
    </Link>
  );
}

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-700 px-2">
      <header className="border-b bg-slate-800 text-gray-300">
        <div className="container flex h-16 items-center px-4">
          <nav className="flex items-center space-x-6 text-sm font-medium">
            <NavLink to="/">Home</NavLink>
            <NavLink to="/search">Search</NavLink>
            <NavLink to="/feed">Feed</NavLink>
            <NavLink to="/articles">Articles</NavLink>
            <NavLink to="/visualizations">Visualizations</NavLink>
          </nav>
        </div>
      </header>

      <main className="py-4">
        <Outlet />
      </main>

      <footer className="border-t py-4 md:py-0">
        <div className="flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
          <p className="text-center text-sm leading-loose text-gray-400 md:text-left">
            <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer">Powered by GDELT Project API</a>
          </p>
        </div>
      </footer>
    </div>
  );
} 