"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { isRemoteServiceMode } from "@/lib/service-mode";
import type { AdminMockState } from "@/mocks/admin-fixtures";
import { adminStateStore } from "@/services/admin-state-store";
import { useApplicationServices } from "@/services/application-services-provider";
import { useAdminSession } from "@/services/admin-session-provider";

const AdminStateContext = React.createContext<AdminMockState | null>(null);

const emptyRemoteState = (): AdminMockState => ({
  pilots: [],
  reviews: [],
  upgradePlans: [],
  qualificationConfigs: [],
  notificationLogs: [],
});

export function AdminStateProvider({ children }: { children: React.ReactNode }) {
  const remoteMode = isRemoteServiceMode();
  return remoteMode ? (
    <RemoteAdminStateProvider>{children}</RemoteAdminStateProvider>
  ) : (
    <MockAdminStateProvider>{children}</MockAdminStateProvider>
  );
}

function MockAdminStateProvider({ children }: { children: React.ReactNode }) {
  const state = React.useSyncExternalStore(
    adminStateStore.subscribe,
    adminStateStore.getSnapshot,
    adminStateStore.getServerSnapshot,
  );
  return <AdminStateContext.Provider value={state}>{children}</AdminStateContext.Provider>;
}

export function RemoteAdminStateProvider({ children }: { children: React.ReactNode }) {
  const services = useApplicationServices();
  const adminSession = useAdminSession();
  const pathname = usePathname();
  const [state, setState] = React.useState<AdminMockState>(emptyRemoteState);
  React.useEffect(() => {
    if (
      adminSession.status !== "authenticated" ||
      (!adminSession.isSuperAdmin && !adminSession.session?.unit)
    )
      return;
    if (pathname === "/admin/qualification-config") return;
    let active = true;
    void Promise.allSettled([
      services.pilotDirectory.list({ page: 1, pageSize: 100 }),
      services.reviews.list({ page: 1, pageSize: 100 }),
      services.upgradePlans.list({ page: 1, pageSize: 100 }),
      services.qualificationConfigs.list(),
      services.notifications.list({ page: 1, pageSize: 100 }),
    ])
      .then(([pilotsResult, reviewsResult, plansResult, configsResult, notificationsResult]) => {
        if (!active) return;
        const pilots = pilotsResult.status === "fulfilled" ? pilotsResult.value.data.items : [];
        const reviews = reviewsResult.status === "fulfilled" ? reviewsResult.value.data.items : [];
        const plans = plansResult.status === "fulfilled" ? plansResult.value.data.items : [];
        const configs = configsResult.status === "fulfilled" ? configsResult.value.data : [];
        const notifications =
          notificationsResult.status === "fulfilled" ? notificationsResult.value.data.items : [];
        setState((current) => ({
          ...current,
          pilots: pilots.map((pilot) => ({
            ...pilot,
            rankLabel: pilot.rankCode,
            qualifications: [],
            activeUpgradePlanId: null,
            electronicFiles: [],
          })),
          reviews,
          upgradePlans: plans,
          qualificationConfigs: configs,
          notificationLogs: notifications,
        }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    adminSession.isSuperAdmin,
    adminSession.session?.unit,
    adminSession.status,
    pathname,
    services,
  ]);
  return <AdminStateContext.Provider value={state}>{children}</AdminStateContext.Provider>;
}

export function useAdminState(): AdminMockState {
  const state = React.useContext(AdminStateContext);
  if (!state) throw new Error("useAdminState must be used inside AdminStateProvider");
  return state;
}
