import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ListChecks } from "lucide-react";

export default function Tasks() {
  return (
    <>
      <PageHeader title="Tasks" subtitle="Follow-ups and to-dos for the team." />
      <EmptyState
        icon={ListChecks}
        title="No tasks yet"
        description="Assigned follow-ups and reminders tied to customers will live here."
      />
    </>
  );
}
