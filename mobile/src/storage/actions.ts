import {
  MOBILE_ACTIONS_SCHEMA_VERSION,
  newLocalActionId,
  type MobileAction,
  type MobileActionPayload,
  type MobileActionsBundle
} from '@shared/mobile';
import { dbAll, dbDelete, dbPut, dbClear, STORES } from './db';

const DEVICE_KEY = 'revendo.mobile.device';

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `mobile_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export async function listActions(): Promise<MobileAction[]> {
  const rows = await dbAll<MobileAction>(STORES.ACTIONS);
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function listPending(): Promise<MobileAction[]> {
  const rows = await listActions();
  return rows.filter((r) => r.status === 'pending');
}

export async function queueAction(payload: MobileActionPayload): Promise<MobileAction> {
  const action = {
    id: newLocalActionId(),
    schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
    source: 'mobile' as const,
    status: 'pending' as const,
    created_at: new Date().toISOString(),
    device: getDeviceId(),
    ...payload
  } as MobileAction;
  await dbPut(STORES.ACTIONS, action);
  return action;
}

export async function deleteAction(id: string): Promise<void> {
  await dbDelete(STORES.ACTIONS, id);
}

export async function clearActions(): Promise<void> {
  await dbClear(STORES.ACTIONS);
}

export async function markActionsExported(): Promise<void> {
  const rows = await listActions();
  for (const r of rows) {
    if (r.status === 'pending') {
      await dbPut(STORES.ACTIONS, { ...r, status: 'exported' });
    }
  }
}

export function buildBundle(actions: MobileAction[]): MobileActionsBundle {
  return {
    schema_version: MOBILE_ACTIONS_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    app_version: '0.1.0',
    device: getDeviceId(),
    actions
  };
}
