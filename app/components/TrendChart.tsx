interface TrendChartProps {
	points: { date: string; value: number }[];
	width?: number;
	height?: number;
	stale?: boolean;
}

/**
 * Hand-rolled SVG sparkline (decision: no chart library).
 * Normalizes values to the viewport; renders a flat baseline when <2 points.
 * Coloured from theme tokens: brass line, warning when stale. Responsive via
 * viewBox; annotates the end value and the date range so charts read
 * without hover.
 */
export function TrendChart({ points, width = 320, height = 64, stale }: TrendChartProps) {
	if (points.length < 2) {
		return (
			<svg
				viewBox={`0 0 ${width} ${height}`}
				className={stale ? "w-full opacity-40" : "w-full"}
				role="img"
				aria-label="coverage volume trend"
			>
				<line x1={0} y1={height - 8} x2={width} y2={height - 8} stroke="var(--border)" strokeWidth={1.5} />
			</svg>
		);
	}

	const values = points.map((p) => p.value);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	const pad = 6;

	const coords = points.map((p, i) => {
		const x = (i / (points.length - 1)) * (width - pad * 2) + pad;
		const y = height - pad - ((p.value - min) / span) * (height - pad * 2);
		return { x: x.toFixed(1), y: y.toFixed(1), value: p.value };
	});

	const stroke = stale ? "var(--warning)" : "var(--primary)";
	const last = coords[coords.length - 1];
	const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(2));

	return (
		<div>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				className="w-full"
				role="img"
				aria-label="coverage volume trend"
			>
				<polygon
					points={`${pad},${height - pad} ${coords.map((c) => `${c.x},${c.y}`).join(" ")} ${width - pad},${height - pad}`}
					fill={stroke}
					fillOpacity={0.12}
				/>
				<polyline
					points={coords.map((c) => `${c.x},${c.y}`).join(" ")}
					fill="none"
					stroke={stroke}
					strokeWidth={1.75}
				/>
				<circle cx={last.x} cy={last.y} r={2.75} fill={stroke} />
				{max > min && (
					<text x={pad} y={pad + 2} fontSize={9} fill="var(--muted-foreground)">
						max {max.toFixed(2)}
					</text>
				)}
			</svg>
			<div className="flex justify-between px-1 font-mono text-[10px] text-muted-foreground/70">
				<span>{points[0].date}</span>
				<span aria-hidden>·</span>
				<span>
					now {fmt(last.value)} · {points[points.length - 1].date}
				</span>
			</div>
		</div>
	);
}
