import { invoke } from '@tauri-apps/api/core';

export interface EvmAccountSquadBinding {
  evmAccountId: string;
  parentId: string;
}

interface EvmAccountSquadBindingWire {
  evm_account_id: string;
  parent_id: string;
}

export async function listEvmAccountSquadBindings(): Promise<EvmAccountSquadBinding[]> {
  const rows = await invoke<EvmAccountSquadBindingWire[]>('list_evm_account_squad_bindings');
  return rows.map((row) => ({
    evmAccountId: row.evm_account_id,
    parentId: row.parent_id,
  }));
}

/** Group squad bindings by EVM account id. */
export function bindingsByAccountId(
  bindings: EvmAccountSquadBinding[],
): Map<string, EvmAccountSquadBinding[]> {
  const map = new Map<string, EvmAccountSquadBinding[]>();
  for (const binding of bindings) {
    const list = map.get(binding.evmAccountId) ?? [];
    list.push(binding);
    map.set(binding.evmAccountId, list);
  }
  return map;
}
