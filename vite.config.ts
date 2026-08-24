import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
	plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), reactRouter(), tailwindcss()],
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "./app"),
		},
	},
});
