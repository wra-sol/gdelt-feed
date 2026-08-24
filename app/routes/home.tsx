import type { MetaFunction } from "react-router";
import { Link } from "react-router";

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

function MeridianMark({ size = 44 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
			<circle cx="24" cy="24" r="21" fill="none" stroke="#3b82f6" strokeWidth="2" />
			<ellipse cx="24" cy="24" rx="9" ry="21" fill="none" stroke="#3b82f6" strokeWidth="1.5" />
			<line x1="24" y1="3" x2="24" y2="45" stroke="#60a5fa" strokeWidth="1.5" />
			<line x1="4" y1="24" x2="44" y2="24" stroke="#1e3a5f" strokeWidth="1.5" />
		</svg>
	);
}

export default function Home() {
	return (
		<div className="mx-auto max-w-5xl px-6 py-12">
			<div className="flex items-center gap-4">
				<MeridianMark />
				<h1 className="text-4xl font-bold tracking-tight text-gray-100">Meridian</h1>
			</div>

			<p className="mt-6 max-w-2xl text-xl leading-relaxed text-gray-300">
				A lens over the world's press. Pick a place, see what the world is saying about it —
				what's rising, how tone is moving, what changed since you last looked.
			</p>
			<p className="mt-3 max-w-2xl text-sm text-gray-500">
				A radar, not a reader: we surface the signal, you click out to read. Built on the free,
				keyless{" "}
				<a
					href="https://www.gdeltproject.org/"
					target="_blank"
					rel="noopener noreferrer"
					className="text-blue-400 hover:underline"
				>
					GDELT Project
				</a>{" "}
				data covering 65+ languages, refreshed every 15 minutes.
			</p>

			<div className="mt-8 flex gap-3">
				<Link
					to="/lenses"
					className="rounded bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-500"
				>
					Open the lenses →
				</Link>
				<a
					href="/rss/lens/canada"
					className="rounded border border-gray-600 px-5 py-2.5 font-medium text-gray-300 hover:border-gray-400"
				>
					Canada RSS feed
				</a>
			</div>

			<div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2">
				{capabilities.map((c) => (
					<div key={c.title} className="rounded border border-gray-800 bg-gray-900/60 p-5">
						<h2 className="font-semibold text-blue-300">{c.title}</h2>
						<p className="mt-2 text-sm leading-relaxed text-gray-400">{c.body}</p>
					</div>
				))}
			</div>

			<p className="mt-14 text-xs text-gray-600">
				Mentions-based monitoring with curated watches · results depend on GDELT index coverage ·
				Powered by GDELT Project API · not affiliated with the GDELT Project.
			</p>
		</div>
	);
}
