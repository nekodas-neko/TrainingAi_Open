"use client";

import { useSearchParams } from "next/navigation";
import { TabLoading } from "@/components/shell/tab-loading";

// /workout is both the Workout tab and, with ?session=…, the navless full-screen workout, so this
// boundary has to read the query to know whether to draw the bottom nav (#2441).
export default function Loading() {
  return <TabLoading search={useSearchParams().toString()} />;
}
