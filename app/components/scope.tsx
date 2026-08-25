import { useId } from "react";
import { freshnessFraction } from "~/lib/consoleModel";

/**
 * The lens scope — a place rendered as a primary scan instrument. Contacts
 * plot by time-of-day bearing and recency radius (newest at the rim, aging
 * inward). Pure presentation: geometry math in, SVG out.
 */
export type ScopeBlip = {
	url: string;
	seenTs: number | null;
	/** Display-only phosphor decay; "new" semantics are the read flag. */
	tier: "hot" | "warm" | "old";
	read: boolean;
	selected?: boolean;
};

const R = 100;

function polar(freshness: number, minOfDay: number) {
	const angle = (minOfDay / 1440) * Math.PI * 2 - Math.PI / 2;
	const radius = 26 + 64 * Math.max(0, Math.min(1, freshness));
	return { x: R + radius * Math.cos(angle), y: R + radius * Math.sin(angle) };
}

export function Scope({
	blips,
	size,
	sweep = true,
	label,
	windowHours = 72,
	now,
}: {
	blips: ScopeBlip[];
	size: number;
	sweep?: boolean;
	label: string;
	windowHours?: number;
	/** Current instant; null before hydration (blips render mid-radius). */
	now: number | null;
}) {
	const gradId = useId();
	return (
		<svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={label} className="block">
			<defs>
				<radialGradient id={gradId}>
					<stop offset="0%" stopColor="var(--scope-phos)" stopOpacity="0" />
					<stop offset="100%" stopColor="var(--scope-phos)" stopOpacity="0.35" />
				</radialGradient>
			</defs>
			<circle cx={R} cy={R} r="92" fill="var(--scope-bg)" stroke="var(--scope-line)" />
			{[30, 60].map((r) => (
				<circle key={r} cx={R} cy={R} r={r} fill="none" stroke="var(--scope-grid)" strokeWidth="1" />
			))}
			<line x1={R} y1={R - 92} x2={R} y2={R + 92} stroke="var(--scope-grid)" />
			<line x1={R - 92} y1={R} x2={R + 92} y2={R} stroke="var(--scope-grid)" />
			{Array.from({ length: 12 }, (_, i) => {
				const a = (i / 12) * Math.PI * 2;
				return (
					<line
						key={i}
						x1={R + 86 * Math.cos(a)}
						y1={R + 86 * Math.sin(a)}
						x2={R + 92 * Math.cos(a)}
						y2={R + 92 * Math.sin(a)}
						stroke="var(--scope-line)"
						strokeWidth="1"
					/>
				);
			})}
			{sweep && (
				<g className="scope-sweep">
					<path
						d={`M ${R} ${R} L ${R} ${R - 92} A 92 92 0 0 1 ${R + 65.8} ${R - 65.8} Z`}
						fill={`url(#${gradId})`}
						opacity="0.5"
					/>
					<line x1={R} y1={R} x2={R} y2={R - 92} stroke="var(--scope-phos)" strokeWidth="1" opacity="0.9" />
				</g>
			)}
			{blips.map((b) => {
				if (!b.seenTs) return null;
				const freshness = now === null ? 1 / 3 : freshnessFraction(b.seenTs, now, windowHours);
				const d = new Date(b.seenTs);
				const { x, y } = polar(freshness, d.getUTCHours() * 60 + d.getUTCMinutes());
				const fill = b.tier === "hot" ? "var(--scope-hot)" : b.tier === "warm" ? "var(--scope-phos)" : "var(--scope-dim)";
				return (
					<g key={b.url} opacity={b.read ? 0.4 : 1}>
						{!b.read && b.tier === "hot" && now !== null && (
							<circle className="scope-halo" cx={x} cy={y} r="5" fill="none" stroke={fill} strokeWidth="1.5" />
						)}
						<circle
							cx={x}
							cy={y}
							r={b.selected ? 4.5 : 3}
							fill={fill}
							stroke={b.selected ? "var(--scope-fg)" : "none"}
							strokeWidth="1"
							style={b.tier === "hot" && !b.read ? { filter: "drop-shadow(0 0 3px var(--scope-phos))" } : undefined}
						/>
					</g>
				);
			})}
			<circle cx={R} cy={R} r="3" fill="none" stroke="var(--scope-line)" />
		</svg>
	);
}
