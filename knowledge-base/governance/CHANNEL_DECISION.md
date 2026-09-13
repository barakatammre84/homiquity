# Configured business channel

Implementation reference, inspected 2026-09-13: `shared/businessChannel.ts` sets BUSINESS_CHANNEL
to broker. This does not prove licensing, lender approval or the applicability of a regulation.

`scripts/delivery-stack-freeze-guard.cjs` preserves an existing internal limit on expanding direct
seller delivery code. Its behavior is unchanged by the documentation cleanup. A future scoped
channel or delivery change should review that control with the actual business requirements.
