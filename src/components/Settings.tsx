import { SchedulesTable } from "./Research";

/** How the app runs on its own. Today that is research schedules; manual runs live in the Research panel. */
export function Settings() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mb-8 text-muted-foreground">Research that runs on its own, on a schedule.</p>
      <div className="mb-8 rounded border p-4 text-sm">
        <p className="font-medium">Monitoring runtime</p>
        <p className="mt-1 text-muted-foreground">Exa monitors continue refreshing remotely when AsOf is closed. AsOf must be running to collect those changes into the local research feed on its hourly schedule.</p>
      </div>
      <SchedulesTable />
    </>
  );
}
