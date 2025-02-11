import { Link, Outlet } from "react-router";

export default function Layout() {
  return (
    <div className="min-h-screen bg-slate-700 px-2">
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