import { type RouteConfig } from "@react-router/dev/routes";

export default [
  {
    file: "./routes/layout.tsx",
    children: [
      {
        index: true,
        file: "./routes/home.tsx"
      },
      {
        path: "search",
        file: "./routes/search.tsx",
      },
      {
        path: "lenses",
        file: "./routes/lenses.tsx",
      },
      {
        path: "lens/:slug",
        file: "./routes/lens.$slug.tsx",
      },
      {
        path: "lens/:slug/trends",
        file: "./routes/lens.$slug.trends.tsx",
      },
      {
        path: "rss/lens/:slug",
        file: "./routes/rss.lens.$slug.tsx",
      },
      {
        path: "rss/lens/:slug/:watchId",
        file: "./routes/rss.lens.$slug.$watchId.tsx",
      }
    ]
  }
] satisfies RouteConfig;