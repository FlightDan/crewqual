"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isRemoteServiceMode } from "@/lib/service-mode";
import { clearMockStorage } from "@/services/temp-storage";
import { applicationServices, type ApplicationServices } from "@/services/application-services";

const ApplicationServicesContext = React.createContext<ApplicationServices>(applicationServices);

export function ApplicationServicesProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const remoteMode = isRemoteServiceMode();
  const [queryClient] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  React.useEffect(() => {
    if (remoteMode) {
      setReady(true);
      return;
    }

    let disposed = false;
    const checkMockInstance = async (initial: boolean) => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            data?: { mode?: string; instanceId?: string };
          };
          const nextInstanceId =
            body.data?.mode === "mock" ? body.data.instanceId?.trim() : undefined;
          if (nextInstanceId) {
            const currentInstanceId = document.body.dataset.mockInstanceId;
            if (currentInstanceId && currentInstanceId !== nextInstanceId) {
              clearMockStorage();
              document.body.dataset.mockInstanceId = nextInstanceId;
              window.location.reload();
              return;
            }
            document.body.dataset.mockInstanceId = nextInstanceId;
          }
        }
      } catch {
        // A temporary health-check failure must not destroy local Mock state.
      } finally {
        if (initial && !disposed) setReady(true);
      }
    };

    const initialCheckTimer = window.setTimeout(() => void checkMockInstance(true), 1_000);
    const timer = window.setInterval(() => void checkMockInstance(false), 30_000);
    return () => {
      disposed = true;
      window.clearTimeout(initialCheckTimer);
      window.clearInterval(timer);
    };
  }, [remoteMode]);
  return (
    <QueryClientProvider client={queryClient}>
      <ApplicationServicesContext.Provider value={applicationServices}>
        <div data-app-ready={ready ? "true" : "false"}>{children}</div>
      </ApplicationServicesContext.Provider>
    </QueryClientProvider>
  );
}

export function useApplicationServices(): ApplicationServices {
  return React.useContext(ApplicationServicesContext);
}
