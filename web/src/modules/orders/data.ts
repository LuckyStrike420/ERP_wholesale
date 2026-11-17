import { useRows } from "@/app/store";
import { findOrder } from "@/app/paths";

/** the order behind /orders/:ref (a PI# or draft-xxxxxxxx) */
export function useOrder(ref: string) {
  const draft = ref.startsWith("draft-");
  const { rows, loading } = useRows("v_orders", draft ? { eq: { status: "draft" } } : { eq: { pi_number: ref } });
  return { o: findOrder(rows, ref), loading };
}
