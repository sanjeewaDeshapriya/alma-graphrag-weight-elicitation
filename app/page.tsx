import ConsentForm from "./components/ConsentForm";
import { loadMaterial } from "@/lib/material";

export default function Home() {
  const material = loadMaterial();
  const nTasks = material.tasks.length;

  return (
    <div className="shell">
      <div className="brand">
        <span className="dot" /> ALMA · Hotel Choice Study
      </div>

      <div className="panel">
        <h1>How do people really choose a hotel?</h1>
        <p className="lead">
          You&apos;ll see a few short travel situations. For each one ({nTasks}{" "}
          screens in total), pick the single hotel you would book. There are no
          right or wrong answers — we&apos;re studying how travellers weigh things
          like price, location, quiet, and facilities.
        </p>

        <ul className="facts">
          <li>Takes about 3–5 minutes.</li>
          <li>Completely anonymous — no name, email or login required.</li>
          <li>Voluntary — you can close the tab at any point.</li>
          <li>
            Your choices help calibrate a hotel-recommendation research model.
          </li>
        </ul>

        <ConsentForm />
      </div>

      <p className="center-note">
        A research study · ALMA-GraphRAG · University project
      </p>
    </div>
  );
}
