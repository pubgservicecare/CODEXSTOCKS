// Image modules (resolved by Vite or Next.js; see art.ts for how both shapes are handled).
declare module "*.webp" {
  const value: unknown;
  export default value;
}
