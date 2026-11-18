/** /customers/health: every customer's health score and reorder rhythm */
import { PageHeader } from "@/app/ui";
import { CustomersHealth } from "./Insights";

export function CustomersHealthPage() {
  return <><PageHeader back={{ to: "/customers", label: "Customers" }} title="Customer health and reorders" sub="Who pays late, who orders less, and who is due to order again." /><CustomersHealth /></>;
}
