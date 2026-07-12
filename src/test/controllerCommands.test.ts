import test from 'node:test';
import assert from 'node:assert/strict';
import { MoveRequest } from '../commandBatcher';
import {
  canonicalKind,
  collectGroupCandidates,
  managedGroupName,
  MotorMetadata,
  NativeGroup,
  planControllerActions,
} from '../controllerCommands';

const metadata = new Map<string, MotorMetadata>([
  ['1', { motorId: '1', locationId: 10, room: 'Kitchen', kind: 'roman' }],
  ['2', { motorId: '2', locationId: 11, room: 'Kitchen', kind: 'roman' }],
  ['3', { motorId: '3', locationId: 12, room: 'Kitchen', kind: 'privacy' }],
]);

const groups: NativeGroup[] = [
  { id: 1, name: 'Kitchen Romans', locationIds: [10, 11] },
  { id: 2, name: 'Kitchen All', locationIds: [10, 11, 12] },
];

function moves(ids: string[], targetPosition = 0): MoveRequest[] {
  return ids.map(motorId => ({ motorId, targetPosition, requiresMove: true }));
}

test('prefers the largest exact native group contained in a burst', () => {
  const plan = planControllerActions(moves(['1', '2', '3']), groups, metadata);

  assert.deepEqual(plan.actions, [{ action: 'moveto', gid: 2, position: '0' }]);
  assert.deepEqual(plan.groupIds, [2]);
  assert.deepEqual(plan.motorIds, []);
});

test('never uses a native group containing an unrequested covering', () => {
  const plan = planControllerActions(moves(['1', '2']), groups, metadata);

  assert.deepEqual(plan.actions, [{ action: 'moveto', gid: 1, position: '0' }]);
  assert.deepEqual(plan.groupIds, [1]);
});

test('falls back to individual actions inside one controller command array', () => {
  const plan = planControllerActions(moves(['1', '3'], 75), groups, metadata);

  assert.deepEqual(plan.actions, [
    { action: 'moveto', mid: 1, position: '750' },
    { action: 'moveto', mid: 3, position: '750' },
  ]);
});

test('requires repeated exact observations before learning persistent groups', () => {
  const candidates = collectGroupCandidates(moves(['1', '2', '3']), metadata);
  const romanCandidate = candidates.find(candidate => candidate.locationIds.join(',') === '10,11');
  const sceneCandidate = candidates.find(candidate => candidate.locationIds.join(',') === '10,11,12');

  assert.equal(romanCandidate?.threshold, 2);
  assert.equal(sceneCandidate?.threshold, 2);
  assert.ok(sceneCandidate);
  assert.ok(managedGroupName(sceneCandidate).length <= 15);
});

test('normalizes Roman, Privacy, Roller, and Blackout location suffixes', () => {
  assert.equal(canonicalKind('Roman 3'), 'roman');
  assert.equal(canonicalKind('Privacy 2'), 'privacy');
  assert.equal(canonicalKind('Roller 1'), 'roller');
  assert.equal(canonicalKind('Blackout Left'), 'blackout');
});
