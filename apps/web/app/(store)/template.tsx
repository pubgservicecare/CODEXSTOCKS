import { PageTransition } from "./PageTransition";

/** Re-mounts on every navigation, so each page enters with the storefront's page transition. */
export default function StoreTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
