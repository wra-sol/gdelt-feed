interface TrendChartProps {
	points: { date: string; value: number }[];
	width?: number;
	height?: number;
	stale?: boolean;
}

/**
 * Hand-rolled SVG sparkline (decision: no chart library).
 * Normalizes values to the viewport; renders a flat baseline when <2 points.
 */
export function TrendChart({ points, width = 320, height = 64, stale }: TrendChartProps) {
	if (points.length < 2) {
		return (
			<svg width={width} height={height} className={stale ? "opacity-40" : ""}>
				<line x1={0} y1={height - 8} x2={width} y2={height - 8} stroke="#374151" strokeWidth={1.5} />
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
		return `${x.toFixed(1)},${y.toFixed(1)}`;
	});

	const stroke = stale ? "#92400e" : "#3b82f6";
	const fill = stale ? "rgba(146,64,14,0.12)" : "rgba(59,130,246,0.12)";

	return (
		<svg width={width} height={height} role="img" aria-label="coverage volume trend">
			<polygon
				points={`${pad},${height - pad} ${coords.join(" ")} ${width - pad},${height - pad}`}
				fill={fill}
			/>
			<polyline points={coords.join(" ")} fill="none" stroke={stroke} strokeWidth={1.75} />
			{max > min && (
				<text x={pad} y={pad + 2} fontSize={9} fill="#9ca3af">
					max {max.toFixed(2)}
				</text>
			)}
		</svg>
	);
}
