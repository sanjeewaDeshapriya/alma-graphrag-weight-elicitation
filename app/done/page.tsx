export default function Done() {
  return (
    <div className="shell">
      <div className="brand">
        <span className="dot" /> ALMA · Hotel Choice Study
      </div>

      <div className="panel" style={{ textAlign: "center" }}>
        <div className="done-mark">✓</div>
        <h1>Thank you!</h1>
        <p className="lead">
          Your choices have been recorded. They&apos;ll help us learn how real
          travellers weigh price, location, quiet and facilities — and calibrate
          the recommendation model accordingly.
        </p>
        <p className="muted">You can now close this tab.</p>
      </div>
    </div>
  );
}
