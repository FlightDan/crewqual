import { runQualificationAudit } from "./audit-qualification-state";

// Reconciliation is the strict compatibility-removal gate. The standalone audit
// defaults to reporting data quality without blocking the corrective release.
void runQualificationAudit("compatibility").catch(() => {
  console.error(
    "member_reconciliation_failed: unable to complete read-only audit; connection and record details suppressed",
  );
  process.exitCode = 1;
});
