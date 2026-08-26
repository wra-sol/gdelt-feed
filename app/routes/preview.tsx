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
	append(content: string, options?: { html: boolean }): RewriterElement;
};

const RESPONSE_HEADERS: Record<string, string> = {
	"content-security-policy":
		"default-src 'none'; img-src https: data:; style-src https: 'unsafe-inline'; font-src https: data:; media-src https: data:; form-action 'none'; frame-ancestors 'self'",
	"referrer-policy": "no-referrer",
	"x-content-type-options": "nosniff",
	"cache-control": "public, max-age=300",
	"x-robots-tag": "noindex",
};

/**
 * Reader-mode dark theme, injected into every proxied document — modelled on
 * Safari Reading mode: one measured serif column, restrained headline scale,
 * near-text links, and site chrome pruned away (structural junk is REMOVED
 * in the rewriter below; lower-confidence junk is hidden here by class
 * heuristics). Palette mirrors the console's scope vars.
 */
const READER_CSS = `
:root { color-scheme: dark; }
html { background: #070b09 !important; }
body {
	background: #070b09 !important;
	color: #d3e9dc !important;
	max-width: 44rem;
	margin: 0 auto;
	padding: 2.25rem 1.5rem 5rem;
	font-family: Georgia, "Times New Roman", serif;
	font-size: 19px;
	line-height: 1.6;
}
/* --- prune lower-confidence chrome (structure already removed upstream) --- */
nav,
body > header,
body > footer,
aside,
[role="navigation"],
[role="banner"],
[role="contentinfo"],
[role="complementary"],
[role="search"],
[role="dialog"],
[aria-hidden="true"],
[style*="position:fixed"],
[style*="position: fixed"],
[class*="sidebar" i], [id*="sidebar" i],
[class*="related" i], [class*="recommended" i], [class*="trending" i],
[class*="most-read" i], [class*="popular" i],
[class*="newsletter" i], [class*="subscribe" i], [class*="signup" i],
[class*="paywall" i], [class*="cookie" i], [class*="consent" i],
[class*="breadcrumb" i], [class*="advert" i], [class*="sponsor" i], [class*="promo" i],
[class*="comments" i], [id*="comments" i] {
	display: none !important;
}
/* --- book typography --- */
h1 {
	color: #f2fbf6 !important;
	font-size: 1.85em;
	font-weight: 700;
	line-height: 1.18;
	letter-spacing: -0.01em;
	margin: 0.2em 0 0.45em;
}
h2, h3, h4, h5, h6 {
	color: #f2fbf6 !important;
	font-weight: 700;
	line-height: 1.32;
	margin: 1.7em 0 0.5em;
}
h2 { font-size: 1.32em; }
h3 { font-size: 1.14em; }
h4, h5, h6 { font-size: 1em; }
p { margin: 0 0 1.35em; }
a {
	color: #e8f6ee !important;
	text-decoration: underline;
	text-decoration-color: rgba(211, 233, 220, .35);
	text-underline-offset: 3px;
}
strong, b { color: #f2fbf6 !important; }
time, [rel="author"], [class*="byline" i] {
	color: #82a894 !important;
	font-family: ui-sans-serif, system-ui, sans-serif;
	font-size: .84em;
	letter-spacing: .02em;
}
img, video {
	display: block;
	max-width: 100%;
	height: auto;
	margin: 1.75rem auto;
	border-radius: 4px;
	background: #0c130f;
}
figcaption {
	color: #82a894 !important;
	font-size: .8em;
	line-height: 1.45;
	text-align: center;
	max-width: 36rem;
	margin: .55rem auto 0;
}
ul, ol { margin: 0 0 1.35em 1.3em; }
li { margin: .35em 0; }
blockquote {
	border-left: 2px solid rgba(70, 230, 155, .45);
	font-style: italic;
	color: #a8c4b3 !important;
	margin: 1.5em 0;
	padding: .1em 0 .1em 1.25em;
}
blockquote p:last-child { margin-bottom: 0; }
hr {
	border: 0;
	border-top: 1px solid rgba(84, 230, 160, .14);
	width: 55%;
	margin: 2.5em auto;
}
pre, code, kbd, samp {
	background: #111a15 !important;
	color: #93ffc9 !important;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: .85em;
	border-radius: 4px;
}
code, kbd, samp { padding: .1em .35em; }
pre {
	padding: .9rem 1.1rem;
	overflow-x: auto;
	line-height: 1.5;
	margin: 0 0 1.35em;
}
pre code { background: transparent !important; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; font-size: .9em; }
td, th { border: 1px solid rgba(84, 230, 160, .16) !important; padding: .4rem .65rem; text-align: left; }
th { color: #93ffc9 !important; }
figure { margin: 1.75rem 0; }
::selection { background: #46e69b; color: #070b09; }
`;

const READER_HEAD = `<meta name="color-scheme" content="dark"><style>${READER_CSS}</style>`;

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
			// Strip inert/dangerous elements AND high-confidence site chrome —
			// Safari-Reader-style pruning: nav, asides, landmark roles never
			// render at all (lower-confidence junk is hidden via READER_CSS).
			"script, iframe, frame, frameset, object, embed, applet, noscript, form, input, button, select, textarea, meta[http-equiv='refresh' i], link[rel=preload], link[rel=preconnect], nav, aside, [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=search], dialog",
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
				const head = raw as unknown as RewriterElement;
				head.prepend(baseTag, { html: true });
				head.append(READER_HEAD, { html: true });
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
