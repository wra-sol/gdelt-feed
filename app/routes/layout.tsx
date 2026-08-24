import { Link, NavLink, Outlet, useLocation } from "react-router";
import { cn } from "~/lib/utils";

const NAV_ITEMS = [
	{ to: "/", label: "Home" },
	{ to: "/search", label: "Search" },
	{ to: "/lenses", label: "Lenses" },
];

function MeridianMark({ size = 28 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="text-primary">
			<circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="2.5" />
			<ellipse cx="24" cy="24" rx="9" ry="21" fill="none" stroke="currentColor" strokeWidth="1.5" />
			<line x1="24" y1="3" x2="24" y2="45" stroke="currentColor" strokeWidth="1.5" />
			<line x1="4" y1="24" x2="44" y2="24" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
		</svg>
	);
}

export default function Layout() {
	const { pathname } = useLocation();

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
				<div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
					<Link
						to="/"
						viewTransition
						aria-label="Meridian home"
						className="flex min-h-11 items-center gap-2.5 rounded-md pr-2 text-foreground transition-opacity hover:opacity-80"
					>
						<MeridianMark />
						<span className="font-heading text-lg font-semibold tracking-tight">
							Meridian
						</span>
					</Link>
					<nav className="flex items-center gap-1" aria-label="Main">
						{NAV_ITEMS.map((item) => (
							<NavLink
								key={item.to}
								to={item.to}
								aria-current={pathname === item.to ? "page" : undefined}
								className={cn(
									"flex min-h-11 items-center rounded-full px-4 py-2 text-sm font-medium transition-colors",
									pathname === item.to
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							>
								{item.label}
							</NavLink>
						))}
					</nav>
				</div>
			</header>

			<main className="py-4">
				<Outlet />
			</main>

			<footer className="border-t py-4 md:py-0">
				<div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 md:h-24 md:flex-row">
					<p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
						<a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:text-foreground hover:underline">Powered by GDELT Project API</a>
					</p>
				</div>
			</footer>
		</div>
	);
}
