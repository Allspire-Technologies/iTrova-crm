import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { Building2 } from "lucide-react";

export default function Customers() {
  return (
    <>
      <PageHeader title="Customers" subtitle="Every business using iTrova." />
      <EmptyState
        icon={Building2}
        title="No customers loaded"
        description="The businesses list (plan, MRR, last login, status) will live here, with a detail view per business."
      />
    </>
  );
}
