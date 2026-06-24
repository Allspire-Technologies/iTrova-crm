import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { Workflow } from "lucide-react";

export default function Pipeline() {
  return (
    <>
      <PageHeader title="Pipeline" subtitle="Onboarding, upgrades and renewals in flight." />
      <EmptyState
        icon={Workflow}
        title="No pipeline stages yet"
        description="A board of leads/accounts moving through stages will appear here."
      />
    </>
  );
}
