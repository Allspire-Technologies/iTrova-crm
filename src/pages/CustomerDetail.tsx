import { useParams, Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { Button } from "@/components/ui/button";
import { Building2, ArrowLeft } from "lucide-react";

export default function CustomerDetail() {
  const { id } = useParams();
  return (
    <>
      <PageHeader
        title="Customer detail"
        subtitle={`Business ${id ?? ""}`}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to="/customers"><ArrowLeft className="size-4" /> Back to customers</Link>
          </Button>
        }
      />
      <EmptyState
        icon={Building2}
        title="Customer detail coming soon"
        description="Users, sales/orders, stock health, subscription and renewal for this business will render here."
      />
    </>
  );
}
