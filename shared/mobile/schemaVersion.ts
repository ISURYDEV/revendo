/**
 * Schema versions for Revendo Mobile snapshot + actions.
 * Used by both desktop (generator + importer) and the mobile PWA.
 */

export const MOBILE_SNAPSHOT_SCHEMA_VERSION = 'revendo-mobile-v3' as const;

/** Versions that the mobile PWA can read. Older snapshots stay supported. */
export const COMPATIBLE_SNAPSHOT_VERSIONS = [
  'revendo-mobile-v2',
  'revendo-mobile-v3'
] as const;

export const MOBILE_ACTIONS_SCHEMA_VERSION = 'revendo-mobile-actions-v1' as const;

export const COMPATIBLE_ACTION_VERSIONS = ['revendo-mobile-actions-v1'] as const;

export type MobileSnapshotSchemaVersion = (typeof COMPATIBLE_SNAPSHOT_VERSIONS)[number];
export type MobileActionsSchemaVersion = (typeof COMPATIBLE_ACTION_VERSIONS)[number];
