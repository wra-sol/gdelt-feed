import type { LoaderFunctionArgs } from "react-router";
import { parsePreviewUrl } from "~/lib/preview";

/**
 * The reader proxy — fetches a third-party article server-side, strips it to
 * inert readable HTML (HTMLRewriter, streaming), and serves it for the
 * console's preview pane. Security posture is layered:
 *   1. lib/preview.ts URL guard on the request URL AND the final post-redirect
 *      URL (SSRF),
 *   2. element/attribute sanitization here,
 *   3. a script-free CSP on the response,
 *   4. sandbox="" on the embedding iframe (coverageConsole).
 * This supersedes the old "link out only" rule; CONTEXT.md records why.
 */

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 3_000_000;

const UPSTREAM_HEADERS: HeadersInit = {
	accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
	"accept-language": "en",
	"user-agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MeridianReader/1.0",
};

/**
 * Structural view of HTMLRewriter's Element. The app's TS setup merges
 * workers-types with the DOM lib, whose global `Element` shadows the
 * rewriter's — this keeps the handlers honest without fighting the merge.
 */
type RewriterElement = {
	tagName: string;
	attributes: IterableIterator<string[]>;
	setAttribute(name: string, value: string): RewriterElement;
	removeAttribute(name: string): RewriterElement;
	prepend(content: string, options?: { html: boolean }): RewriterElement;
};

const RESPONSE_HEADERS: Record<string, string> = {
	"content-security-policy":
		"default-src 'none'; img-src https: data:; style-src https: 'unsafe-inline'; font-src https: data:; media-src https: data:; form-action 'none'; frame-ancestors 'self'",
	"referrer-policy": "no-referrer",
	"x-content-type-options": "nosniff",
	"cache-control": "public, max-age=300",
	"x-robots-tag": "noindex",
};

function fallbackDoc(title: string, body: string, url?: string): Response {
	const openLink = url
		? `<a href="${url.replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer" style="color:#46e69b">open original ↗</a>`
		: "";
	return new Response(
		`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
			`<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#070b09;color:#82a894;font-family:ui-monospace,monospace;font-size:13px;text-align:center;padding:1rem">` +
			`<div><p style="color:#d3e9dc;margin:0 0 .5rem">${title}</p><p style="margin:0 0 1rem;line-height:1.6">${body}</p>${openLink}</div></body></html>`,
		{
			status: 200,
			headers: {
				...RESPONSE_HEADERS,
				// The fallback carries our own link out — allow navigating it.
				"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'self'",
				"content-type": "text/html; charset=utf-8",
			},
		},
	);
}

export async function loader({ request }: LoaderFunctionArgs) {
	const raw = new URL(request.url).searchParams.get("url");
	const target = parsePreviewUrl(raw);
	if (!target) {
		return fallbackDoc("Can't preview this link", "The address doesn't look like a public article.");
	}

	let upstream: Response;
	try {
		upstream = await fetch(target, {
			redirect: "follow",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: UPSTREAM_HEADERS,
		});
	} catch (error) {
		console.error(`[preview] fetch failed for ${target.hostname}:`, error);
		return fallbackDoc("Couldn't reach the source", "The site didn't answer in time or refused the request.", target.href);
	}

	// Redirects may have bounced somewhere private — re-run the full guard.
	const finalUrl = parsePreviewUrl(upstream.url);
	if (!finalUrl) {
		return fallbackDoc("Redirected somewhere unsafe", "This link hops through an address we won't fetch.", target.href);
	}
	if (!upstream.ok) {
		return fallbackDoc(`Source answered ${upstream.status}`, "Many sites block embedded previews of some pages.", finalUrl.href);
	}

	const contentType = upstream.headers.get("content-type") ?? "";
	const isHtml = contentType.startsWith("text/html") || contentType.startsWith("application/xhtml+xml");
	if (!isHtml || !upstream.body) {
		return fallbackDoc("Not an HTML document", "There's nothing readable to preview at this address.", finalUrl.href);
	}

	// Size cap: error the stream past the cap — the iframe shows what arrived.
	let bytes = 0;
	const capped = upstream.body.pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				bytes += chunk.byteLength;
				if (bytes > MAX_BYTES) {
					console.error(`[preview] size cap hit for ${finalUrl.hostname} after ${bytes} bytes`);
					controller.error(new Error("preview-too-large"));
					return;
				}
				controller.enqueue(chunk);
			},
		}),
	);

	const baseTag = `<base href="${finalUrl.origin}/" target="_blank">`;
	const sanitized = new HTMLRewriter()
		.on(
			"script, iframe, frame, frameset, object, embed, applet, noscript, form, input, button, select, textarea, meta[http-equiv='refresh' i], link[rel=preload], link[rel=preconnect]",
			{
				element(el) {
					el.remove();
				},
			},
		)
		.on("*", {
			element(raw) {
				const el = raw as unknown as RewriterElement;
				const doomed: string[] = [];
				for (const [name, value] of el.attributes) {
					if (/^on/i.test(name)) doomed.push(name);
					else if ((name === "href" || name === "src" || name === "srcset" || name === "action") && /^\s*javascript:/i.test(value)) {
						doomed.push(name);
					}
				}
				for (const name of doomed) el.removeAttribute(name);

				if (el.tagName === "a") {
					el.setAttribute("target", "_blank");
					el.setAttribute("rel", "noopener noreferrer nofollow");
				}
			},
		})
		.on("head", {
			// HTML5 parsing synthesises a head for headless documents, so this
			// fires exactly once — never inject from on("html"), which runs
			// BEFORE on("head") in token order (the double-base bug).
			element(raw) {
				(raw as unknown as RewriterElement).prepend(baseTag, { html: true });
			},
		})
		.transform(new Response(capped, { status: upstream.status }));

	return new Response(sanitized.body, {
		status: 200,
		headers: {
			...RESPONSE_HEADERS,
			// Preserve the upstream charset when declared — HTMLRewriter already
			// normalises the stream, but the declaration keeps legacy pages legible.
			"content-type": contentType.startsWith("text/html") ? contentType : "text/html; charset=utf-8",
		},
	});
}
