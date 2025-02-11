import { type RouteConfig } from "@react-router/dev/routes";

export default [
  {
    file: "routes/layout.tsx",
    children: [
      {
        index: true,
        file: "routes/home.tsx"
      },
      {
        path: "search",
        file: "routes/search.tsx",
      },
      {
        path: "articles",
        file: "routes/articles-layout.tsx",
        children: [
          {
            index: true,
            file: "routes/articles/index.tsx"
          },
          {
            path: ":id",
            file: "routes/articles/article.tsx"
          }
        ]
      },
      {
        path: "visualizations",
        file: "routes/visualizations-layout.tsx",
        children: [
          {
            index: true,
            file: "routes/visualizations/index.tsx"
          },
          {
            path: ":type",
            file: "routes/visualizations/visualization.tsx"
          }
        ]
      },
      {
        path: "feed",
        file: "routes/feed.tsx",
      }
    ]
  }
] satisfies RouteConfig;