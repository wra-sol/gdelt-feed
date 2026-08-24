import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getLenses } from "~/services/lensDb";
import { lensFlag } from "~/data/countries";
import { getCloudflare } from "~/lib/cloudflare-context";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
import { GlobeIcon } from "lucide-react";

interface LensCard {
	id: string;
	slug: string;
	name: string;
	description?: string;
	flag: string;
}

export async function loader({ context }: LoaderFunctionArgs) {
	const db = getCloudflare(context).env.DB;
	const lenses = await getLenses(db);

	const cards: LensCard[] = lenses.map((lens) => ({
		...lens,
		flag: lensFlag(lens.countryFips),
	}));

	return { lenses: cards };
}

export default function Lenses() {
	const { lenses } = useLoaderData<typeof loader>();

	return (
		<div className="mx-auto max-w-5xl p-6">
			<h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">Lenses</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				A lens is a place — see what the world's press is saying about it.
			</p>

			{lenses.length === 0 ? (
				<Empty className="mt-8 border border-dashed">
					<EmptyHeader>
						<EmptyMedia>
							<GlobeIcon aria-hidden />
						</EmptyMedia>
						<EmptyTitle>No lenses yet</EmptyTitle>
						<EmptyDescription>
							Lenses are curated places with watches on them. Seed flagships ship with the
							app — check back after the next deploy.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{lenses.map((lens) => (
						<Link
							key={lens.id}
							prefetch="intent"
							to={`/lens/${lens.slug}`}
							viewTransition
							className="block rounded-xl border border-border bg-card text-card-foreground transition-[border-color,transform] duration-200 hover:border-primary/50 hover:-translate-y-0.5"
						>
							<Card className="border-0 bg-transparent shadow-none">
								<CardHeader>
									<CardTitle className="flex items-center gap-2 font-heading">
										{lens.flag && <span className="text-xl">{lens.flag}</span>}
										<span>{lens.name}</span>
									</CardTitle>
								</CardHeader>
								<CardContent>
									{lens.description && (
										<p className="line-clamp-2 text-sm text-muted-foreground">{lens.description}</p>
									)}
								</CardContent>
							</Card>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
