import { Link, Outlet } from "react-router-dom";

export default function Layout() {
  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white p-4">
        <nav className="max-w-7xl mx-auto flex gap-4">
          <Link to="/" className="hover:text-slate-300">Home</Link>
          <Link to="/search" className="hover:text-slate-300">Search</Link>
          <Link to="/articles" className="hover:text-slate-300">Articles</Link>
          <Link to="/visualizations" className="hover:text-slate-300">Visualizations</Link>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        <Outlet />
      </main>

      <footer className="bg-slate-100 mt-8 py-4">
        <div className="max-w-7xl mx-auto text-center text-sm text-slate-600">
          Powered by GDELT Project API
        </div>
      </footer>
    </div>
  );
} 