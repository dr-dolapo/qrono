import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Outlet, RouterProvider, createBrowserRouter } from "react-router";
import { AuthProvider } from "./auth/AuthContext";
import { GuestOnly, RequireAuth } from "./auth/guards";
import { AdminHome } from "./pages/AdminHome";
import { CheckEmail } from "./pages/auth/CheckEmail";
import { ForgotPassword } from "./pages/auth/ForgotPassword";
import { LogIn } from "./pages/auth/LogIn";
import { ResetPassword } from "./pages/auth/ResetPassword";
import { SignUp } from "./pages/auth/SignUp";
import { VerifyEmail } from "./pages/auth/VerifyEmail";
import { CommandCentre } from "./pages/CommandCentre";
import { GuestView } from "./pages/GuestView";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { CreateTeam } from "./pages/onboarding/CreateTeam";
import { InvitePage } from "./pages/team/InvitePage";
import { TeamPage } from "./pages/team/TeamPage";
import { WaitingPage } from "./pages/team/WaitingPage";
import "./styles.css";

function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <Home /> },

      // Accounts (web only — PRD §1.1)
      { path: "/signup", element: <GuestOnly><SignUp /></GuestOnly> },
      { path: "/login", element: <GuestOnly><LogIn /></GuestOnly> },
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/reset-password", element: <ResetPassword /> },
      { path: "/check-email", element: <CheckEmail /> },
      { path: "/verify-email", element: <VerifyEmail /> },
      { path: "/onboarding/team", element: <RequireAuth needsTeam={false}><CreateTeam /></RequireAuth> },

      // Admin & Approver area
      { path: "/admin", element: <RequireAuth><AdminHome /></RequireAuth> },
      { path: "/admin/team", element: <RequireAuth><TeamPage /></RequireAuth> },

      // Team invitations (QR001, QR007)
      { path: "/invite/:token", element: <InvitePage /> },
      { path: "/waiting", element: <WaitingPage /> },

      // Command centre — desktop/laptop on an HDMI screen (auth comes with live events)
      { path: "/command/:eventId", element: <CommandCentre /> },
      // Guest view — personal link opened on a phone browser (QR044–QR046)
      { path: "/g/:token", element: <GuestView /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
