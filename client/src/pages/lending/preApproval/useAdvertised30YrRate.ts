import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MortgageRateWithProgram } from "@/types/rates";

/**
 * The one 30-year-fixed advertised rate the /apply funnel prices with.
 *
 * AdvisoryPanel's rule — "a payment figure shown to a borrower must be
 * reproducible from current pricing, never a hardcoded constant" — applies to
 * every payment the funnel shows, not just the side panel's. The panel owned
 * this lookup privately while the pre-signup affordability teaser priced off
 * AFFORDABILITY_ESTIMATE_DEFAULTS.interestRate (6.5), so the same funnel
 * quoted two rates: a borrower at $450,000 / $90,000 down saw "$2,715/mo …
 * today's advertised 6.375% rate" on every question step and then
 * "Est. $3,708/mo" on the teaser. One hook, one rate.
 *
 * Returns null when no active 30-year fixed row is available; callers label
 * that case as illustrative rather than passing a silent constant off as
 * today's pricing.
 */
export function useAdvertised30YrRate(): number | null {
  const { data: advertisedRates } = useQuery<MortgageRateWithProgram[]>({
    queryKey: ["/api/mortgage-rates"],
  });

  return useMemo(() => {
    const row = advertisedRates?.find(
      (r) => r.program?.termYears === 30 && !r.program?.isAdjustable && r.isActive !== false,
    );
    const parsed = row ? parseFloat(row.rate) : NaN;
    return !isNaN(parsed) && parsed > 0 ? parsed : null;
  }, [advertisedRates]);
}
