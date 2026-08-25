import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { formatSeenUtc } from "~/lib/date";
import {
	browserReadStorage,
	loadReadUrls,
	markReadUrls,
} from "~/lib/triage";
import {
	applyView,
	buildContacts,
	clampSelection,
	tierFor,
	CHANNEL_HUES,
	FILTERS,
	type Contact,
	type FilterView,
} from "~/lib/consoleModel";
import { Scope, type ScopeBlip } from "~/components/scope";
import type { FreshView } from "~/services/watchView";

/**
 * The coverage console shell — effects, keyboard, and rendering only. Every
 * decidable rule lives in lib/consoleModel; freshness ("new") is the
 * device-local read flag from lib/triage.
 */

export type ConsoleWatch = {
	id: string;
	label: string;
	displayGroups: FreshView["displayGroups"];
	total: number;
	stale: boolean;
	ngramUrls: string[];
	newCount: number;
	freshPromise: Promise<FreshView> | null;
};

/** Rotary gain control — limits how many rows the log renders. */
function GainDial({
	value,
	min,
	max,
	onChange,
}: {
	value: number;
	min: number;
	max: number;
	onChange: (v: number) => void;
}) {
	const angleMin = -135;
	const angleMax = 135;
	const angle = angleMin + ((value - min) / (max - min)) * (angleMax - angleMin);
	return (
		<svg
			width={56}
			height={56}
			viewBox="0 0 56 56"
			role="slider"
			tabIndex={0}
			aria-label={`Gain: shows first ${value} rows`}
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={value}
			className="cursor-pointer touch-none focus-visible:outline-2 focus-visible:outline-offset-2"
			style={{ outlineColor: "var(--scope-phos)" }}
			onKeyDown={(e) => {
				if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(Math.min(max, value + 5));
				if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(Math.max(min, value - 5));
			}}
			onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
			onPointerMove={(e) => {
				if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
				const rect = e.currentTarget.getBoundingClientRect();
				const dx = e.clientX - (rect.left + rect.width / 2);
				const dy = e.clientY - (rect.top + rect.height / 2);
				let a = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
				if (a > 180) a -= 360;
				const clamped = Math.max(angleMin, Math.min(angleMax, a));
				onChange(Math.round(min + ((clamped - angleMin) / (angleMax - angleMin)) * (max - min)));
			}}
		>
			<circle cx="28" cy="28" r="24" fill="var(--scope-bg)" stroke="var(--scope-line)" />
			{Array.from({ length: 11 }, (_, i) => {
				const a = ((angleMin + (i / 10) * (angleMax - angleMin)) * Math.PI) / 180;
				return (
					<line
						key={i}
						x1={28 + 20 * Math.sin(a)}
						y1={28 - 20 * Math.cos(a)}
						x2={28 + 24 * Math.sin(a)}
						y2={28 - 24 * Math.cos(a)}
						stroke="var(--scope-dim)"
						strokeWidth="1"
					/>
				);
			})}
			<line
				x1="28"
				y1="28"
				x2={28 + 17 * Math.sin((angle * Math.PI) / 180)}
				y2={28 - 17 * Math.cos((angle * Math.PI) / 180)}
				stroke="var(--scope-phos)"
				strokeWidth="2.5"
				strokeLinecap="round"
			/>
			<circle cx="28" cy="28" r="3" fill="var(--scope-phos)" />
		</svg>
	);
}

export function SensorStrip({ stale }: { stale: boolean }) {
	return (
		<span
			className="flex items-center gap-2 rounded px-2 py-1 font-mono text-xs font-semibold tracking-wide"
			style={
				stale
					? { color: "var(--scope-warn)", background: "rgba(255,180,84,.12)" }
					: { color: "var(--scope-phos)", background: "rgba(70,230,155,.1)" }
			}
		>
			<span className="size-1.5 rounded-full" style={{ background: "currentColor" }} aria-hidden />
			{stale ? "SENSOR DEGRADED — CACHED COVERAGE" : "ALL SENSORS NOMINAL"}
			<span className="sr-only">{stale ? "Coverage may be incomplete." : "Coverage is current."}</span>
		</span>
	);
}

function isTypingTarget(t: EventTarget | null): boolean {
	const el = t as HTMLElement | null;
	if (!el?.tagName) return false;
	return (
		el.tagName === "INPUT" ||
		el.tagName === "TEXTAREA" ||
		el.tagName === "SELECT" ||
		el.isContentEditable ||
		el.closest("button, a, [role='slider']") !== null
	);
}

function CoverageRow({
	contact,
	index,
	selected,
	onOpened,
}: {
	contact: Contact;
	index: number;
	selected: boolean;
	onOpened: (url: string) => void;
}) {
	const hue = CHANNEL_HUES[contact.channel % CHANNEL_HUES.length];
	return (
		<li
			data-coverage-row={index}
			className={cn(
				"border-b px-3 py-2 transition-colors",
				selected && "bg-[rgba(70,230,155,.07)] shadow-[inset_2px_0_0_var(--scope-phos)]",
			)}
			style={{ borderColor: "var(--scope-grid)" }}
		>
			<a
				href={contact.url}
				target="_blank"
				rel="noopener noreferrer"
				onClick={() => onOpened(contact.url)}
				className="group flex items-start gap-2.5 text-sm leading-snug focus-visible:outline-2 focus-visible:-outline-offset-2"
				style={{ outlineColor: "var(--scope-phos)" }}
			>
				<span
					aria-hidden
					className="mt-[3px] shrink-0 font-mono text-xs"
					style={{ color: contact.read ? "var(--scope-dim)" : "var(--scope-hot)" }}
				>
					{contact.read ? "○" : "●"}
				</span>
				<span className="min-w-0 flex-1">
					<span
						className={cn("font-medium underline-offset-4 group-hover:underline", !contact.read && "text-[color:var(--scope-fg)]")}
						style={contact.read ? { color: "var(--scope-dim)" } : undefined}
					>
						{contact.title}
					</span>
					<span
						className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[11px]"
						style={{ color: "var(--scope-dim)" }}
					>
						<span className="flex items-center gap-1">
							<span className="inline-block size-1.5 rounded-full" style={{ background: hue }} aria-hidden />
							{contact.channelLabel}
						</span>
						<span>{contact.domain ?? "—"}</span>
						<span>{formatSeenUtc(new Date(contact.seenTs ?? 0).toISOString()) ?? ""}</span>
						{typeof contact.tone === "number" && (
							<span style={{ color: contact.tone >= 0 ? "var(--scope-phos)" : "var(--scope-warn)" }}>
								{contact.tone > 0 ? "+" : ""}
								{contact.tone.toFixed(1)}
							</span>
						)}
						{contact.ngram && (
							<Badge
								variant="secondary"
								className="h-auto px-1 py-0 font-mono text-[9px] uppercase tracking-widest"
								style={{ background: "var(--scope-panel-2)", color: "var(--scope-dim)" }}
							>
								ngram
							</Badge>
						)}
						{contact.moreInGroup > 0 && <span>+{contact.moreInGroup} more</span>}
					</span>
				</span>
			</a>
		</li>
	);
}

export function CoverageConsole({
	watches,
	sinceLastVisit,
	now,
}: {
	watches: ConsoleWatch[];
	sinceLastVisit: number;
	now: number;
}) {
	// Deferred freshness resolves inside this boundary and swaps in silently.
	const resolved = watches.map((w) => {
		const fresh = w.freshPromise ? React.use(w.freshPromise) : null;
		return {
			label: w.label,
			displayGroups: fresh?.displayGroups ?? w.displayGroups,
			total: fresh?.total ?? w.total,
			stale: fresh?.stale ?? w.stale,
			ngramUrls: fresh?.ngramUrls ?? w.ngramUrls,
		};
	});

	const [readSet, setReadSet] = useState<Set<string>>(() => new Set());
	useEffect(() => setReadSet(loadReadUrls(browserReadStorage())), []);
	const commitRead = useCallback((urls: string[]) => {
		setReadSet(markReadUrls(browserReadStorage(), urls));
	}, []);

	const [gain, setGain] = useState(25);
	const [view, setView] = useState<FilterView>("ALL");
	const [selected, setSelected] = useState(0);

	const contacts = useMemo(() => buildContacts(resolved, readSet), [resolved, readSet]);
	const shown = useMemo(() => applyView(contacts, view).slice(0, gain), [contacts, view, gain]);

	// The selection always names a row of `shown`.
	useEffect(() => {
		setSelected((s) => clampSelection(s, shown.length));
	}, [shown.length]);

	const openContact = useCallback(
		(i: number) => {
			const target = shown[i];
			if (!target) return;
			commitRead([target.url]);
			window.open(target.url, "_blank", "noopener");
		},
		[shown, commitRead],
	);

	// j/k walk the log; o/Enter open-and-mark-read; 1–4 switch views.
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (isTypingTarget(e.target)) return;
			if (e.key === "j") setSelected(clampSelection(selected + 1, shown.length));
			else if (e.key === "k") setSelected(clampSelection(selected - 1, shown.length));
			else if (e.key === "o" || e.key === "Enter") openContact(selected);
			else if (/^[1-4]$/.test(e.key)) setView(FILTERS[Number(e.key) - 1]);
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [shown.length, selected, openContact]);

	useEffect(() => {
		document.querySelector(`[data-coverage-row="${selected}"]`)?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	const unreadCount = useMemo(() => contacts.filter((c) => !c.read).length, [contacts]);
	const stale = resolved.some((w) => w.stale);
	const blips: ScopeBlip[] = shown.map((c) => ({
		url: c.url,
		seenTs: c.seenTs,
		tier: tierFor(c.seenTs, now),
		read: c.read,
	}));

	return (
		<div className="scope-console grid gap-3 lg:h-[calc(100vh-16rem)] lg:grid-cols-[400px_1fr]" style={{ borderRadius: "var(--radius-xl)" }}>
			<div
				className="relative flex flex-col items-center gap-3 border p-4"
				style={{ borderColor: "var(--scope-line)", background: "var(--scope-panel)", borderRadius: "var(--radius-lg)" }}
			>
				<div className="flex w-full items-center justify-between">
					<span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--scope-dim)" }}>
						primary scan
					</span>
					<span className="flex items-center gap-3 font-mono text-xs tabular-nums">
						<span style={{ color: unreadCount > 0 ? "var(--scope-hot)" : "var(--scope-dim)" }}>
							{unreadCount} new
						</span>
						<span style={{ color: "var(--scope-dim)" }}>+{sinceLastVisit} since visit</span>
					</span>
				</div>
				<SensorStrip stale={stale} />
				<Scope
					blips={blips.map((b, i) => ({ ...b, selected: i === selected }))}
					size={320}
					now={now}
					label={`Coverage scope, ${blips.length} articles, ${unreadCount} new`}
				/>
				<div className="mt-auto flex w-full items-end justify-between pt-3">
					<div className="flex items-center gap-2">
						<GainDial value={gain} min={10} max={60} onChange={setGain} />
						<span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--scope-dim)" }}>
							gain
							<br />
							<span className="text-sm normal-case tracking-normal" style={{ color: "var(--scope-fg)" }}>{gain}</span>
						</span>
					</div>
					<Button
						variant="outline"
						size="sm"
						isDisabled={unreadCount === 0}
						onPress={() => commitRead(contacts.map((c) => c.url))}
						className="border-[color:var(--scope-line)] bg-transparent font-mono text-xs text-[color:var(--scope-fg)] hover:bg-[rgba(70,230,155,.08)] hover:text-[color:var(--scope-hot)]"
					>
						Clear {unreadCount > 0 ? unreadCount : ""} new
					</Button>
				</div>
			</div>
			<div
				className="flex min-h-0 flex-col overflow-hidden border"
				style={{ borderColor: "var(--scope-line)", background: "var(--scope-panel)", borderRadius: "var(--radius-lg)" }}
			>
				<div
					className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
					style={{ borderColor: "var(--scope-line)", background: "var(--scope-panel-2)" }}
				>
					<div className="flex items-center gap-1.5">
						{FILTERS.map((f, i) => (
							<Button
								key={f}
								variant="outline"
								size="sm"
								onPress={() => setView(f)}
								title={`${f} view — key ${i + 1}`}
								className={cn(
									"h-8 gap-1.5 border-[color:var(--scope-line)] bg-[color:var(--scope-bg)] px-2.5 font-mono text-xs",
									view === f
										? "border-[color:var(--scope-phos)] text-[color:var(--scope-hot)]"
										: "text-[color:var(--scope-fg)] hover:text-[color:var(--scope-hot)]",
								)}
							>
								<span
									className="size-1.5 rounded-full"
									style={{
										background: view === f ? "var(--scope-hot)" : "var(--scope-line)",
										boxShadow: view === f ? "0 0 6px var(--scope-phos)" : undefined,
									}}
									aria-hidden
								/>
								{i + 1}&thinsp;{f}
							</Button>
						))}
					</div>
					<span className="font-mono text-xs tabular-nums" style={{ color: "var(--scope-dim)" }}>
						rows <span style={{ color: "var(--scope-fg)" }}>{shown.length}</span>/{contacts.length}
					</span>
				</div>
				<ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Coverage log">
					{shown.length === 0 ? (
						<li className="px-4 py-10 text-center font-mono text-xs" style={{ color: "var(--scope-dim)" }}>
							{contacts.length === 0
								? "NO COVERAGE IN THIS WINDOW — SPARSE RESULTS USUALLY MEAN THIN INDEX COVERAGE"
								: "NO COVERAGE MATCHES THIS VIEW"}
						</li>
					) : (
						shown.map((c, i) => (
							<CoverageRow
								key={c.url}
								contact={c}
								index={i}
								selected={i === selected}
								onOpened={(url) => commitRead([url])}
							/>
						))
					)}
				</ul>
				<div
					className="border-t px-3 py-1.5 font-mono text-[11px]"
					style={{ borderColor: "var(--scope-line)", color: "var(--scope-dim)", background: "var(--scope-panel-2)" }}
				>
					j/k move · o open · 1–4 views · gain sets depth · read state lives on this device
				</div>
			</div>
		</div>
	);
}

export function CoverageConsoleFallback() {
	return (
		<div
			className="scope-console flex items-center justify-center gap-2 border p-16 font-mono text-xs"
			style={{ borderColor: "var(--scope-line)", background: "var(--scope-panel)", borderRadius: "var(--radius-lg)", color: "var(--scope-dim)" }}
			role="status"
			aria-label="Fetching latest coverage"
		>
			<Spinner className="size-3" />
			Fetching latest coverage…
		</div>
	);
}
