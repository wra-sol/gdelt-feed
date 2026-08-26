import { describe, expect, it } from "vitest";
import { isPrivateHost, parsePreviewUrl } from "~/lib/preview";

describe("parsePreviewUrl", () => {
	it("accepts ordinary public article URLs", () => {
		const url = parsePreviewUrl("https://www.cbc.ca/news/politics/story?id=123#top");
		expect(url?.hostname).toBe("www.cbc.ca");
		expect(parsePreviewUrl("http://example.com/plain-http")).not.toBeNull();
	});

	it("refuses non-http schemes", () => {
		for (const raw of [
			"ftp://example.com/file",
			"javascript:alert(1)",
			"data:text/html,<b>x</b>",
			"file:///etc/passwd",
		]) {
			expect(parsePreviewUrl(raw)).toBeNull();
		}
	});

	it("refuses embedded credentials, garbage, and oversize input", () => {
		expect(parsePreviewUrl("https://user:pass@example.com/x")).toBeNull();
		expect(parsePreviewUrl("not a url")).toBeNull();
		expect(parsePreviewUrl(null)).toBeNull();
		expect(parsePreviewUrl(undefined)).toBeNull();
		expect(parsePreviewUrl(`https://example.com/${"a".repeat(2048)}`)).toBeNull();
	});
});

describe("isPrivateHost / SSRF guard", () => {
	it("blocks loopback and RFC1918 space in every notation", () => {
		for (const host of [
			"localhost",
			"api.localhost",
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.9",
			"172.31.255.255",
			"192.168.1.1",
			"0.0.0.0",
			"169.254.169.254",
			"100.64.1.1",
		]) {
			expect(isPrivateHost(host), host).toBe(true);
		}
	});

	it("blocks IPv6 loopback and unique/link-local forms", () => {
		for (const host of ["[::1]", "::1", "[::]", "::", "fd12:3456::1", "fe80::a", "[::ffff:10.0.0.1]"]) {
			expect(isPrivateHost(host), host).toBe(true);
		}
	});

	it("blocks internal name suffixes and integer-form hosts", () => {
		for (const host of ["myserver.internal", "box.local", "2130706433", "3232235777"]) {
			expect(isPrivateHost(host), host).toBe(true);
		}
	});

	it("allows public hosts including 172.32+ (just outside RFC1918)", () => {
		for (const host of ["www.cbc.ca", "172.32.0.1", "8.8.8.8", "[2606:4700::1111]", "100.128.0.1"]) {
			expect(isPrivateHost(host), host).toBe(false);
		}
	});

	it("parsePreviewUrl delegates the host policy end-to-end", () => {
		expect(parsePreviewUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
		expect(parsePreviewUrl("http://[fd00::1]/x")).toBeNull();
		expect(parsePreviewUrl("https://www.gdeltproject.org/")).not.toBeNull();
	});
});
