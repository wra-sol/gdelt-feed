import { GdeltApi } from "~/services/gdeltApi";

export interface TimelinePoint {
	date: string;
	value: number;
}

interface RawTimelineResponse {
	timeline?: {
		data?: {
			series?: string;
			values?: [string, string][];
		}[];
	}[];
}

/**
 * Volume-intensity timeline from DOC timelinevol mode.
 * Shape (leniently parsed): {timeline:[{data:[{series:"Volume Intensity",values:[[ts,v],…]}]}]}
 */
export async function fetchVolumeTimeline(
	query: string,
	timespan = "3m",
): Promise<TimelinePoint[]> {
	const raw = (await GdeltApi.volumeTimeline(query, timespan)) as Partial<RawTimelineResponse>;
	const series = raw?.timeline?.[0]?.data?.[0]?.values;

	if (!Array.isArray(series)) return [];

	return series
		.map(([date, value]) => ({ date, value: Number(value) }))
		.filter((p) => Number.isFinite(p.value));
}

/** Average article tone across a set of articles (-100..+100 scale, typically ±15). */
export function averageTone(articles: { tone?: number }[]): number | null {
	const tones = articles.map((a) => a.tone).filter((t): t is number => typeof t === "number");
	if (tones.length === 0) return null;
	return tones.reduce((a, b) => a + b, 0) / tones.length;
}
