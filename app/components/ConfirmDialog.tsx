import React from "react";

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	description?: string;
	confirmLabel: string;
	cancelLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * Dependency-free accessible confirm (role="alertdialog").
 * Escape / overlay click cancels; focus moves in on open, returns on close.
 */
export function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel,
	cancelLabel = "Keep it",
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const panelRef = React.useRef<HTMLDivElement>(null);
	const restoreRef = React.useRef<HTMLElement | null>(null);

	React.useEffect(() => {
		if (!open) return;
		restoreRef.current = document.activeElement as HTMLElement | null;
		panelRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			restoreRef.current?.focus();
		};
	}, [open, onCancel]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			onClick={onCancel}
		>
			<div
				ref={panelRef}
				tabIndex={-1}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="confirm-title"
				aria-describedby={description ? "confirm-desc" : undefined}
				className="w-full max-w-sm rounded border border-gray-600 bg-gray-900 p-5 outline-none"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 id="confirm-title" className="text-lg font-semibold text-gray-100">
					{title}
				</h2>
				{description && (
					<p id="confirm-desc" className="mt-2 text-sm text-gray-400">
						{description}
					</p>
				)}
				<div className="mt-5 flex justify-end gap-3">
					<button
						type="button"
						onClick={onCancel}
						className="min-h-[44px] rounded px-4 text-sm text-gray-300 hover:text-white"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="min-h-[44px] rounded bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-500"
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
