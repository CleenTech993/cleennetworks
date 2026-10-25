import { PageHeader, EmptyState } from "@/components/dashboard-shell";

export function StubPage({
  title,
  description,
  hint,
}: {
  title: string;
  description: string;
  hint?: string;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <EmptyState
        title="Coming online"
        description={
          hint ??
          "This module is scaffolded. Wire up its data source from the API/router integration."
        }
      />
    </div>
  );
}
