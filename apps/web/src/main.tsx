import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import { AdminHome } from "./pages/AdminHome";
import { CommandCentre } from "./pages/CommandCentre";
import { GuestView } from "./pages/GuestView";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  // Admin & Approver screens — web only (PRD §1.1)
  { path: "/admin", element: <AdminHome /> },
  // Command centre — desktop/laptop on an HDMI screen
  { path: "/command/:eventId", element: <CommandCentre /> },
  // Guest view — personal link opened on a phone browser (QR044–QR046)
  { path: "/g/:token", element: <GuestView /> },
  { path: "*", element: <NotFound /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
