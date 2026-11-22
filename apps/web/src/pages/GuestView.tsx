/**
 * Guest view: opened from a personal emailed link on a phone browser, no app
 * needed. Will show the guest's program and tasks and let them acknowledge or
 * decline (QR044–QR046). Links expire when the event ends. No broadcasts.
 */
export function GuestView() {
  return (
    <main className="page guest">
      <h1 className="brand">Qrono</h1>
      <section className="placeholder">
        <p>Your event program will appear here.</p>
        <p className="muted small">You'll be able to accept or decline your role from this page.</p>
      </section>
    </main>
  );
}
