/**
 * Reader-proxy URL policy for /preview — pure and node-testable. The route
 * fetches third-party articles server-side, so this module decides which
 * URLs may leave the building before any request is made: scheme, length,
 * credential, and private-network (SSRF) guards. The route must re-run this
 * guard on the FINAL post-redirect URL too — redirects can bounce inward.
 */

const MAX_URL_LENGTH = 2048;

/** Exact-match hostnames that must never be fetched. */
const BLOCKED_HOSTS = new Set([
	"localhost",
	"localhost.localdomain",
	"ip6-localhost",
	"metadata.google.internal",
]);

/** Suffix match for loopback-ish and internal-only names. */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal"];

type V4Block = { base: number; bits: number };

/** 0/8 · 10/8 · 100.64/10 (CGNAT) · 127/8 · 169.254/16 (cloud metadata) · 172.16/12 · 192.168/16 */
const V4_BLOCKS: V4Block[] = [
	{ base: 0x00000000, bits: 8 },
	{ base: 0x0a000000, bits: 8 },
	{ base: 0x64400000, bits: 10 },
	{ base: 0x7f000000, bits: 8 },
	{ base: 0xa9fe0000, bits: 16 },
	{ base: 0xac100000, bits: 12 },
	{ base: 0xc0a80000, bits: 16 },
];

function inBlock(ip: number, block: V4Block): boolean {
	return (ip >>> (32 - block.bits)) === (block.base >>> (32 - block.bits));
}

/**
 * Dotted-quad → int; null when the host isn't a dotted quad at all;
 * -1 when it looks numeric but is malformed (refuse on principle).
 */
function parseDottedQuad(host: string): number | null {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!m) return null;
	const parts = m.slice(1).map(Number);
	if (parts.some((p) => p > 255)) return -1;
	return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIpv4(host: string): boolean {
	const ip = parseDottedQuad(host);
	if (ip === null) return false;
	if (ip === -1) return true;
	return V4_BLOCKS.some((b) => inBlock(ip, b));
}

function isPrivateIpv6(host: string): boolean {
	const h = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
	if (h === "::" || h === "::1") return true;
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
	if (mapped) return isPrivateIpv4(mapped[1]);
	// fc00::/7 unique-local, fe80::/10 link-local (compressed forms lead with these).
	return /^(fc|fd)/.test(h) || /^fe[89ab]/.test(h);
}

export function isPrivateHost(host: string): boolean {
	const h = host.toLowerCase();
	if (BLOCKED_HOSTS.has(h)) return true;
	if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
	if (/^\d+$/.test(h)) return true; // integer-form IPv4 that escaped canonicalization
	return isPrivateIpv4(h) || isPrivateIpv6(h);
}

/**
 * The one gate for preview targets. Returns a parsed absolute URL or null —
 * callers treat null as "show the can't-preview state", never as a fetchable.
 */
export function parsePreviewUrl(raw: string | null | undefined): URL | null {
	if (!raw || raw.length > MAX_URL_LENGTH) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username || url.password) return null;
	if (isPrivateHost(url.hostname)) return null;
	return url;
}
