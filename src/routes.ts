import {
  type RouteConfig,
  route,
  index,
  layout,
} from "@react-router/dev/routes";

export default [
  index("./routes/home.tsx"),
  route("search", "./routes/search.tsx"),
  
  layout("./routes/layout.tsx", [
    route("articles", "./routes/articles/index.tsx"),
    route("articles/:id", "./routes/articles/article.tsx"),
    route("visualizations", "./routes/visualizations/index.tsx"),
    route("visualizations/:type", "./routes/visualizations/visualization.tsx"),
  ]),
] satisfies RouteConfig; 