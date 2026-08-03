import StudyClient from "./StudyClient";
import { getDisplayTasks } from "@/lib/material";

// Tasks are resolved server-side and stripped of the hidden component vectors
// before being handed to the client.
export default function StudyPage() {
  const tasks = getDisplayTasks();
  return <StudyClient tasks={tasks} />;
}
