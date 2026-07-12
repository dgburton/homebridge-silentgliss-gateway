import { MoveRequest } from './commandBatcher';

export interface MotorMetadata {
  motorId: string;
  locationId: number;
  room: string;
  kind: string;
}

export interface NativeGroup {
  id: number;
  name: string;
  locationIds: number[];
}

export interface NativeGroupConfiguration {
  id: number;
  name: string;
  lid: number[];
  synchro: 0;
  master: number;
  syncposition: number[];
}

export interface ControllerAction {
  action: 'moveto';
  position: string;
  mid?: number;
  gid?: number;
}

export interface CommandPlan {
  actions: ControllerAction[];
  groupIds: number[];
  motorIds: string[];
}

export interface GroupCandidate {
  signature: string;
  locationIds: number[];
  label: string;
  threshold: number;
}

function sortedUnique(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

export function groupSignature(locationIds: number[]): string {
  return sortedUnique(locationIds).join(',');
}

export function canonicalKind(locationName: string): string {
  return locationName
    .replace(/\s+(left|right|\d+)$/i, '')
    .trim()
    .toLowerCase();
}

export function managedGroupName(candidate: GroupCandidate): string {
  const slug = candidate.label.replace(/[^a-z0-9]/gi, '').slice(0, 7) || 'Group';
  let hash = 2166136261;
  for (const character of candidate.signature) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `HB_${slug}_${(hash >>> 0).toString(16).slice(-4)}`.slice(0, 15);
}

export function nativeGroupConfiguration(
  id: number,
  name: string,
  locationIds: number[],
): NativeGroupConfiguration {
  const lid = sortedUnique(locationIds);
  if (lid.length === 0) {
    throw new Error('A Silent Gliss group must contain at least one location');
  }

  return {
    id,
    name,
    lid,
    synchro: 0,
    master: lid[0],
    syncposition: lid.map(() => 0),
  };
}

export function planControllerActions(
  requests: MoveRequest[],
  nativeGroups: NativeGroup[],
  metadata: ReadonlyMap<string, MotorMetadata>,
): CommandPlan {
  const actions: ControllerAction[] = [];
  const usedGroupIds: number[] = [];
  const usedMotorIds: string[] = [];
  const requestsByTarget = new Map<number, MoveRequest[]>();

  for (const request of requests) {
    const targetRequests = requestsByTarget.get(request.targetPosition) ?? [];
    targetRequests.push(request);
    requestsByTarget.set(request.targetPosition, targetRequests);
  }

  for (const [targetPosition, targetRequests] of requestsByTarget) {
    const requestedMotorIds = new Set(targetRequests.map(request => request.motorId));
    const remainingMotorIds = new Set(
      targetRequests.filter(request => request.requiresMove).map(request => request.motorId),
    );

    const eligibleGroups = nativeGroups
      .map(group => {
        const motorIds = group.locationIds
          .map(locationId => Array.from(metadata.values()).find(item => item.locationId === locationId)?.motorId)
          .filter((motorId): motorId is string => motorId !== undefined);
        return { group, motorIds };
      })
      .filter(({ group, motorIds }) => motorIds.length === group.locationIds.length)
      .filter(({ motorIds }) => motorIds.every(motorId => requestedMotorIds.has(motorId)))
      .sort((a, b) => b.motorIds.length - a.motorIds.length);

    for (const { group, motorIds } of eligibleGroups) {
      const activeMembers = motorIds.filter(motorId => remainingMotorIds.has(motorId));
      if (activeMembers.length < 2) {
        continue;
      }

      actions.push({
        action: 'moveto',
        gid: group.id,
        position: String(targetPosition * 10),
      });
      usedGroupIds.push(group.id);
      for (const motorId of activeMembers) {
        remainingMotorIds.delete(motorId);
      }
    }

    for (const motorId of remainingMotorIds) {
      actions.push({
        action: 'moveto',
        mid: Number(motorId),
        position: String(targetPosition * 10),
      });
      usedMotorIds.push(motorId);
    }
  }

  return { actions, groupIds: usedGroupIds, motorIds: usedMotorIds };
}

export function collectGroupCandidates(
  requests: MoveRequest[],
  metadata: ReadonlyMap<string, MotorMetadata>,
): GroupCandidate[] {
  const candidates = new Map<string, GroupCandidate>();
  const requestsByTarget = new Map<number, MoveRequest[]>();

  for (const request of requests) {
    const targetRequests = requestsByTarget.get(request.targetPosition) ?? [];
    targetRequests.push(request);
    requestsByTarget.set(request.targetPosition, targetRequests);
  }

  for (const targetRequests of requestsByTarget.values()) {
    const allMetadata = targetRequests
      .map(request => metadata.get(request.motorId))
      .filter((item): item is MotorMetadata => item !== undefined);

    if (allMetadata.length >= 2) {
      addCandidate(candidates, allMetadata, 'Scene', 2);
    }

    const roomKindBuckets = new Map<string, MotorMetadata[]>();
    for (const item of allMetadata) {
      const key = `${item.room}\u0000${item.kind}`;
      const bucket = roomKindBuckets.get(key) ?? [];
      bucket.push(item);
      roomKindBuckets.set(key, bucket);
    }

    for (const bucket of roomKindBuckets.values()) {
      if (bucket.length >= 2) {
        addCandidate(candidates, bucket, `${bucket[0].room} ${bucket[0].kind}`, 2);
      }
    }
  }

  return Array.from(candidates.values());
}

function addCandidate(
  candidates: Map<string, GroupCandidate>,
  items: MotorMetadata[],
  label: string,
  threshold: number,
): void {
  const locationIds = sortedUnique(items.map(item => item.locationId));
  const signature = groupSignature(locationIds);
  const existing = candidates.get(signature);

  if (!existing || threshold <= existing.threshold) {
    candidates.set(signature, { signature, locationIds, label, threshold });
  }
}
