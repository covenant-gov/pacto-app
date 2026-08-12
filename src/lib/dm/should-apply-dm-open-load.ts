/** Whether an in-flight open-conversation load should still apply to stores. */
export function shouldApplyDmOpenLoad(
  npub: string,
  activeDmId: string | null,
  dmChatsByNpub: Record<string, unknown>,
  deletingDmNpubs: Set<string>
): boolean {
  return (
    activeDmId === npub && npub in dmChatsByNpub && !deletingDmNpubs.has(npub)
  );
}
