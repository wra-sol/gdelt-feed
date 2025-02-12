import * as React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import routes from "./routes";

// Create router instance
const router = createBrowserRouter(routes);

// Create root and render
const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
); 