import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { Settings as SettingsIcon } from "lucide-react";

export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Admin OS configuration and staff access." />
      <EmptyState
        icon={SettingsIcon}
        title="No settings yet"
        description="Manage internal staff (platform_admins) and Admin OS preferences here."
      />
    </>
  );
}
