import React from "react";
import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";
import { Input, inputVariants } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import {
	compileWatchQuery,
	MAX_QUERY_LENGTH,
} from "~/services/watchEngine";

/**
 * The watch editor — structured by design (decision #11). The person picks
 * terms and geography; the system owns quoting, compilation, and the ≤1000-char
 * invariant, showing both the compiled query and what was understood.
 */

function parseTermList(raw: string): string[] {
	return raw
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
}

const PRESETS: { name: string; terms: string[] }[] = [
	{ name: "Politics & government", terms: ["government", "parliament", "election", "policy"] },
	{ name: "Economy & prices", terms: ["economy", "inflation", "prices", "trade"] },
	{ name: "Conflict & security", terms: ["security", "conflict", "military", "police"] },
];

const TIMESPANS = [
	{ value: "7d", label: "7 days" },
	{ value: "14d", label: "14 days" },
	{ value: "1m", label: "1 month" },
	{ value: "3m", label: "3 months" },
];

export function WatchEditor({
	lensId,
	onDone,
}: {
	lensId: string;
	onDone: () => void;
}) {
	const navigation = useNavigation();
	const [label, setLabel] = React.useState("");
	const [terms, setTerms] = React.useState("");
	const [geoOpen, setGeoOpen] = React.useState(false);
	const [geoTerms, setGeoTerms] = React.useState("");
	const [timespan, setTimespan] = React.useState("7d");

	const parsedTerms = parseTermList(terms);
	const parsedGeo = parseTermList(geoTerms);

	let preview: { query: string | null; problem: string | null };
	try {
		preview = {
			query: compileWatchQuery({
				id: "draft",
				lensId,
				label,
				terms: parsedTerms.length ? parsedTerms : ["…"],
				geoTerms: parsedGeo.length ? parsedGeo : undefined,
			}),
			problem: null,
		};
	} catch (error) {
		preview = { query: null, problem: error instanceof Error ? error.message : "invalid watch" };
	}
	if (!preview.problem && parsedTerms.length === 0) {
		preview = { query: null, problem: null };
	}

	const tooShort =
		preview.query !== null && parsedTerms.length > 0 && preview.query.replace(/["()]/g, "").length < 3;
	const overBudget = preview.query !== null && preview.query.length > MAX_QUERY_LENGTH;
	const canSubmit = parsedTerms.length > 0 && !overBudget && navigation.state === "idle";

	return (
		<Form method="post" className="mb-6 rounded-xl border border-border bg-card p-4">
			<input type="hidden" name="intent" value="add-watch" />
			<input type="hidden" name="lensId" value={lensId} />
			<input type="hidden" name="timespan" value={timespan} />
			<input type="hidden" name="terms" value={terms} />
			{geoOpen && <input type="hidden" name="geoTerms" value={geoTerms} />}

			<div className="flex items-center justify-between gap-3">
				<h2 className="font-heading text-sm font-semibold text-foreground">New watch</h2>
				<Button variant="ghost" size="sm" onPress={onDone} className="text-muted-foreground">
					Cancel
				</Button>
			</div>

			<div className="mt-3 flex flex-wrap gap-1.5">
				<span className="mr-1 self-center text-xs text-muted-foreground">Start from:</span>
				{PRESETS.map((preset) => (
					<Button
						key={preset.name}
						type="button"
						variant="outline"
						size="sm"
						onPress={() => {
							setTerms(preset.terms.join(", "));
							setLabel((l) => l || preset.name);
						}}
					>
						{preset.name}
					</Button>
				))}
			</div>

			<div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
				<label className="flex flex-col gap-1 text-sm font-medium text-foreground">
					Label
					<Input
						name="label"
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder="e.g., Carbon policy"
					/>
				</label>
				<label className="flex flex-col gap-1 text-sm font-medium text-foreground">
					Timespan
					<select
						value={timespan}
						onChange={(e) => setTimespan(e.target.value)}
						className={cn(inputVariants(), "appearance-none bg-card")}
					>
						{TIMESPANS.map((t) => (
							<option key={t.value} value={t.value}>
								{t.label}
							</option>
						))}
					</select>
				</label>
				<label className="flex flex-col gap-1 text-sm font-medium text-foreground md:col-span-2">
					Terms (comma-separated — matched across 65+ languages)
					<Input
						name="terms-display"
						value={terms}
						onChange={(e) => setTerms(e.target.value)}
						placeholder={'"carbon tax", emissions, Ottawa'}
						inputMode="text"
						autoFocus
					/>
				</label>
				{geoOpen ? (
					<label className="flex flex-col gap-1 text-sm font-medium text-foreground md:col-span-2">
						Geography (toponyms appended to every match)
						<Input
							name="geoTerms-display"
							value={geoTerms}
							onChange={(e) => setGeoTerms(e.target.value)}
							placeholder="Ottawa, Ontario"
							inputMode="text"
						/>
					</label>
				) : (
					<div className="md:col-span-2">
						<Button type="button" variant="ghost" size="sm" onPress={() => setGeoOpen(true)} className="text-muted-foreground">
							+ Add geography
						</Button>
					</div>
				)}
			</div>

			{/* The compiled query — what this watch will actually ask GDELT for. */}
			<div
				className={cn(
					"mt-4 rounded-lg border p-3 font-mono text-xs",
					overBudget || tooShort
						? "border-destructive/40 bg-destructive/5 text-destructive"
						: "border-border bg-muted/50 text-muted-foreground",
				)}
				aria-live="polite"
			>
				{parsedTerms.length === 0 ? (
					<p>Enter terms to see the compiled query.</p>
				) : overBudget || preview.problem ? (
					<p>
						{preview.problem ??
							`Compiled query is ${preview.query!.length} chars (max ${MAX_QUERY_LENGTH}) — trim terms or geography.`}
					</p>
				) : tooShort ? (
					<p>Compiled query is under 3 characters — DOC needs at least a short word.</p>
				) : (
					<>
						<p className="break-all">{preview.query}</p>
						<p className="mt-1 tabular-nums opacity-70">
							{preview.query!.length}/{MAX_QUERY_LENGTH} chars · timespan {timespan}
						</p>
					</>
				)}
			</div>

			<div className="mt-4 flex items-center justify-end gap-2">
				<Button
					type="submit"
					pending={navigation.state === "submitting"}
					pendingLabel="Creating…"
					isDisabled={!canSubmit}
				>
					Create watch
				</Button>
			</div>
		</Form>
	);
}
