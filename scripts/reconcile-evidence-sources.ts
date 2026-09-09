import { getPrisma } from "../src/server/prisma";
import { reconcileEvidenceSources } from "../src/server/evidence-reconciliation";

const db = getPrisma();
void reconcileEvidenceSources(db)
  .then((report) => {
    console.log(JSON.stringify({ event: "evidence_source_reconciliation", ...report }));
    if (report.conflicts || report.failures.length) process.exitCode = 1;
  })
  .catch(() => {
    console.error("evidence_source_reconciliation_failed: details suppressed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
