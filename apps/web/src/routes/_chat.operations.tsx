import { createFileRoute } from "@tanstack/react-router";

import { OperationsDashboard } from "../components/operations/OperationsDashboard";

export const Route = createFileRoute("/_chat/operations")({
  component: OperationsDashboard,
});
