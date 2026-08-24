import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { cn } from "~/lib/utils";

export const meta: MetaFunction = () => [
	{ title: "Meridian — a lens over the world's press" },
	{
		name: "description",
		content:
			"Pick a place. See what the world's press is saying about it — volume, tone, and what changed, across 65+ languages.",
	},
	{ property: "og:title", content: "Meridian — a lens over the world's press" },
	{
		property: "og:description",
		content:
			"A radar over global news: regional lenses, coverage trends, change alerts. Powered by the GDELT Project API.",
	},
	{ property: "og:type", content: "website" },
];

const capabilities = [
	{
		title: "Regional lenses",
		body:
			"Places are the primary object. Open a country or province and see its story as the world tells it — not one outlet's version.",
	},
	{
		title: "Trends in context",
		body:
			"Coverage-volume timelines and tone averages over GDELT's rolling 3-month window, per topic and per place.",
	},
	{
		title: "Change alerts",
		body:
			"Every lens shows what's new since your last visit, and emits RSS so your reader does the watching with you.",
	},
	{
		title: "65 languages, one query",
		body:
			"GDELT machine-translates local press into English. Your watch terms match Hindi, Ukrainian, Spanish coverage automatically.",
	},
];

function MeridianMark({ size = 56 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="text-primary">
			<circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="2.5" />
			<ellipse cx="24" cy="24" rx="9" ry="21" fill="none" stroke="currentColor" strokeWidth="1.5" />
			<line x1="24" y1="3" x2="24" y2="45" stroke="currentColor" strokeWidth="1.5" />
			<line x1="4" y1="24" x2="44" y2="24" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
		</svg>
	);
}

export default function Home() {
	return (
		<div className="mx-auto max-w-5xl px-6 py-14">
			<div className="flex items-center gap-4">
				<MeridianMark />
				<div>
					<p
						className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground"
					>
						Global press intelligence
					</p>
					<h1 className="font-heading text-5xl font-bold tracking-tight text-foreground">
						Meridian
					</h1>
				</div>
			</div>

			<p className="mt-8 max-w-2xl font-heading text-2xl leading-snug text-foreground">
				A lens over the world's press. Pick a place, see what the world is saying about it —
				what's rising, how tone is moving, what changed since you last looked.
			</p>
			<p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
				A radar, not a reader: we surface the signal, you click out to read. Built on the free,
				keyless{" "}
				<a
					href="https://www.gdeltproject.org/"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline"
				>
					GDELT Project
				</a>{" "}
				data covering 65+ languages, refreshed every 15 minutes.
			</p>

			<div className="mt-8 flex flex-wrap gap-3">
				<Link to="/lenses" className={cn(buttonVariants({ size: "touch" }))}>
					Open the lenses →
				</Link>
				<a
					href="/rss/lens/canada"
					className={cn(buttonVariants({ variant: "outline", size: "touch" }))}
				>
					Canada RSS feed
				</a>
			</div>

			<div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-2">
				{capabilities.map((c) => (
					<Card key={c.title} className="transition-colors hover:border-primary/40">
						<CardHeader>
							<CardTitle className="font-heading text-primary">{c.title}</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm leading-relaxed text-muted-foreground">{c.body}</p>
						</CardContent>
					</Card>
				))}
			</div>

			<p className="mt-16 text-xs leading-relaxed text-muted-foreground/70">
				Mentions-based monitoring with curated watches · results depend on GDELT index coverage ·
				Powered by GDELT Project API · not affiliated with the GDELT Project.
			</p>
		</div>
	);
}
