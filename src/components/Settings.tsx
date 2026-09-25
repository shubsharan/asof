import { SchedulesTable } from "./Research";

/** How the app runs on its own. Today that is research schedules; manual runs live in the Research panel. */
export function Settings() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mb-8 text-muted-foreground">Research that runs on its own, on a schedule.</p>
      <SchedulesTable />
    </>
  );
}
