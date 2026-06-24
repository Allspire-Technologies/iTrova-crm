import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { BarChart3 } from "lucide-react";

export default function Home() {
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of all iTrova businesses." />
      <EmptyState
        icon={BarChart3}
        title="No metrics yet"
        description="Total businesses, sales, MRR and activity will appear here once the data layer is wired up."
      />
    </>
  );
}
