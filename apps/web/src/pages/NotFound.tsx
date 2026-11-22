import { Link } from "react-router";

export function NotFound() {
  return (
    <main className="page">
      <h1>Page not found</h1>
      <Link to="/">Go to Qrono home</Link>
    </main>
  );
}
