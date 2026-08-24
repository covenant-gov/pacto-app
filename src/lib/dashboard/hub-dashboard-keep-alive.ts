export type HubDashboardKeepAlive = {
  key: string;
  parentId: string;
  warGameStack: boolean;
};

export function hubDashboardKeepAliveKey(parentId: string, warGameStack: boolean): string {
  return `${parentId.trim()}:${warGameStack ? 'wargame' : 'dashboard'}`;
}

/** Keep visited hub dashboards for the current squad; drop other squads. */
export function rememberHubDashboard(
  existing: HubDashboardKeepAlive[],
  parentId: string,
  warGameStack: boolean,
): HubDashboardKeepAlive[] {
  const id = parentId.trim();
  if (!id) return [];
  const key = hubDashboardKeepAliveKey(id, warGameStack);
  const sameSquad = existing.filter((h) => h.parentId === id);
  if (sameSquad.some((h) => h.key === key)) {
    return sameSquad.length === existing.length ? existing : sameSquad;
  }
  return [...sameSquad, { key, parentId: id, warGameStack }];
}

export function retainHubDashboardsForParent(
  existing: HubDashboardKeepAlive[],
  parentId: string | null | undefined,
): HubDashboardKeepAlive[] {
  const id = parentId?.trim() ?? '';
  if (!id) return [];
  const sameSquad = existing.filter((h) => h.parentId === id);
  return sameSquad.length === existing.length ? existing : sameSquad;
}
