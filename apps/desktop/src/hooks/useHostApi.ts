import { useEffect, useState } from "react";

import { createHostApi, type HostApi } from "@/host-api";

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function useHostApi() {
  const [api, setApi] = useState<HostApi | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    createHostApi()
      .then((nextApi) => {
        if (cancelled) {
          return;
        }

        setApi(nextApi);
        setReady(true);
        setError("");
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }

        setApi(null);
        setReady(false);
        setError(describeError(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    api,
    ready,
    error,
    kind: api?.kind ?? null,
  };
}
