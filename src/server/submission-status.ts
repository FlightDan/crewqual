import type { SubmissionStatus } from "@/types/services";

export function toSubmissionStatus(status: string): SubmissionStatus {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "RETURNED":
      return "returned";
    case "PENDING":
      return "processing";
    default:
      return "received";
  }
}
