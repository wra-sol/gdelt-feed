import { Link, Outlet, useLocation } from "react-router";

const NAV_ITEMS = [
	{ to: "/", label: "Home" },
	{ to: "/search", label: "Search" },
	{ to: "/lenses", label: "Lenses" },
	{ to: "/feed", label: "Feed" },
	{ to: "/articles", label: "Articles" },
	{ to: "/visualizations", label: "Visualizations" },
];

function NavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
	return (
		<Link
			to={to}
			aria-current={active ? "page" : undefined}
			className={`rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground ${
				active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
			}`}
		>
			{label}
		</Link>
	);
}

export default function Layout() {
	const { pathname } = useLocation();

	return (
		<div className="min-h-screen bg-background">
			<header className="border-b bg-card text-card-foreground">
				<div className="container flex h-16 items-center px-4">
					<nav className="flex items-center space-x-1" aria-label="Main">
						{NAV_ITEMS.map((item) => (
							<NavLink
								key={item.to}
								to={item.to}
								label={item.label}
								active={pathname === item.to}
							/>
						))}
					</nav>
				</div>
			</header>

			<main className="py-4">
				<Outlet />
			</main>

			<footer className="border-t py-4 md:py-0">
				<div className="flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
					<p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
						<a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer">Powered by GDELT Project API</a>
					</p>
				</div>
			</footer>
		</div>
	);
}
