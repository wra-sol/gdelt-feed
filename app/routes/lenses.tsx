import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getLenses } from "~/services/lensDb";
import { countryByFips, flagEmoji } from "~/data/countries";
import { getCloudflare } from "~/lib/cloudflare-context";

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
		flag: flagEmoji(countryByFips(lens.countryFips ?? "")?.iso2),
	}));

	return { lenses: cards };
}

export default function Lenses() {
	const { lenses } = useLoaderData<typeof loader>();

	return (
		<div className="mx-auto max-w-5xl p-6">
			<h1 className="text-2xl font-bold text-blue-300">Lenses</h1>
			<p className="mt-1 text-sm text-gray-400">
				A lens is a place — see what the world's press is saying about it.
			</p>

			{lenses.length === 0 ? (
				<p className="mt-8 text-gray-400">No lenses yet.</p>
			) : (
				<div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{lenses.map((lens) => (
						<Link
							key={lens.id}
							to={`/lens/${lens.slug}`}
							className="block rounded border border-gray-700 bg-gray-900 p-4 transition-colors hover:border-blue-500"
						>
							<div className="flex items-center gap-2">
								{lens.flag && <span className="text-xl">{lens.flag}</span>}
								<h2 className="font-semibold text-blue-300">{lens.name}</h2>
							</div>
							{lens.description && (
								<p className="mt-2 line-clamp-2 text-sm text-gray-400">{lens.description}</p>
							)}
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
