import { createLazyComponent } from '../ui/lazy-svelte-component';

/** Authenticated shell chunk; load only after unlock (or prefetch during PIN success). */
export const loadAuthenticatedApp = createLazyComponent(
  () => import('../../components/app/AuthenticatedApp.svelte'),
);

export function prefetchAuthenticatedApp(): void {
  void loadAuthenticatedApp();
}
