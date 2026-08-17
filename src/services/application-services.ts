import type {
  AdminDashboardService,
  CalendarService,
  DocumentIntelligenceService,
  NotificationService,
  PilotDirectoryService,
  PilotIdentityService,
  QualificationService,
  QualificationConfigService,
  ReviewService,
  SubmissionService,
  UpgradePlanService,
  EvidenceImageService,
} from "@/types/services";
import {
  mockDocumentIntelligenceService,
  mockPilotIdentityService,
  mockQualificationService,
  mockSubmissionService,
} from "@/services/mock-services";
import { mockAdminServices } from "@/services/mock-admin-services";
import { mockAdminOperationsServices } from "@/services/mock-admin-operations-services";
import {
  remoteAdminDashboardService,
  remoteCalendarService,
  remoteDocumentIntelligenceService,
  remoteEvidenceImageService,
  remoteNotificationService,
  remotePilotDirectoryService,
  remotePilotIdentityService,
  remoteQualificationConfigService,
  remoteQualificationService,
  remoteReviewService,
  remoteSubmissionService,
  remoteUpgradePlanService,
} from "@/services/remote-services";
import { isRemoteServiceMode } from "@/lib/service-mode";

export type ApplicationServices = {
  pilotIdentity: PilotIdentityService;
  qualifications: QualificationService;
  documentIntelligence: DocumentIntelligenceService;
  evidenceImages: EvidenceImageService;
  submissions: SubmissionService;
  adminDashboard: AdminDashboardService;
  pilotDirectory: PilotDirectoryService;
  reviews: ReviewService;
  calendar: CalendarService;
  upgradePlans: UpgradePlanService;
  qualificationConfigs: QualificationConfigService;
  notifications: NotificationService;
};

// This is the sole adapter-composition boundary. Business components consume the
// neutral service collection and never import a concrete Mock or vendor adapter.
const remoteMode = isRemoteServiceMode();

export const applicationServices: ApplicationServices = remoteMode
  ? {
      pilotIdentity: remotePilotIdentityService,
      qualifications: remoteQualificationService,
      documentIntelligence: remoteDocumentIntelligenceService,
      evidenceImages: remoteEvidenceImageService,
      submissions: remoteSubmissionService,
      adminDashboard: remoteAdminDashboardService,
      pilotDirectory: remotePilotDirectoryService,
      reviews: remoteReviewService,
      calendar: remoteCalendarService,
      upgradePlans: remoteUpgradePlanService,
      qualificationConfigs: remoteQualificationConfigService,
      notifications: remoteNotificationService,
    }
  : {
      pilotIdentity: mockPilotIdentityService,
      qualifications: mockQualificationService,
      documentIntelligence: mockDocumentIntelligenceService,
      evidenceImages: {
        async uploadProcessedJpeg() {
          return {
            data: {
              id: "mock-evidence",
              mimeType: "image/jpeg",
              width: 0,
              height: 0,
              byteSize: 0,
              sha256: "",
              status: "linked",
            },
            source: "mock" as const,
          };
        },
        async getSignedUrl() {
          return {
            data: { url: "", expiresAt: new Date().toISOString() },
            source: "mock" as const,
          };
        },
      },
      submissions: mockSubmissionService,
      adminDashboard: mockAdminServices.dashboard,
      pilotDirectory: mockAdminServices.pilots,
      reviews: mockAdminServices.reviews,
      calendar: mockAdminOperationsServices.calendar,
      upgradePlans: mockAdminOperationsServices.upgradePlans,
      qualificationConfigs: mockAdminOperationsServices.qualificationConfigs,
      notifications: mockAdminOperationsServices.notifications,
    };

export function getApplicationServices(): ApplicationServices {
  return applicationServices;
}
