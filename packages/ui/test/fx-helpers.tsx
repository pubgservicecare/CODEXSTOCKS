import type { ReactNode } from "react";
import type { FxQuote } from "@codex/shared";
import { FxProvider } from "../src/fx-ui";
import type { DataService } from "../src/service";

/**
 * Static-render helper: FxProvider loads its quote in an effect, which never runs during
 * renderToStaticMarkup, so tests render through a provider whose initial value is fixed.
 */
export function FxProviderForTest({ quote, children }: { quote: FxQuote | null; children: ReactNode }) {
  return (
    <FxProvider svc={{ fx: async () => quote } as unknown as DataService} initial={quote}>
      {children}
    </FxProvider>
  );
}
