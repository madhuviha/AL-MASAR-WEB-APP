import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDedupeKey,deriveEventType,hasSchoolModuleAccess,normalizeIdentifier,schoolPushContent,SCHOOL_MODULE_PERMISSION} from '../parent-bus.mjs';

test('school module permission is explicit and tenant-scoped by role',()=>{
  assert.equal(hasSchoolModuleAccess({role:'super_admin'}),true);
  assert.equal(hasSchoolModuleAccess({role:'company_admin',metadata:{permissions:{[SCHOOL_MODULE_PERMISSION]:true}}}),true);
  assert.equal(hasSchoolModuleAccess({role:'company_admin',metadata:{permissions:{[SCHOOL_MODULE_PERMISSION]:false}}}),false);
  assert.equal(hasSchoolModuleAccess({role:'company_user',metadata:{permissions:{[SCHOOL_MODULE_PERMISSION]:true}}}),false);
  assert.equal(hasSchoolModuleAccess({role:'parent'}),false);
});

test('parent bus identifiers are normalized consistently',()=>{
  assert.equal(normalizeIdentifier('  ab 12-xy '),'AB12-XY');
});

test('boarding alternates to alighting and then boards again',()=>{
  assert.equal(deriveEventType(undefined),'boarded');
  assert.equal(deriveEventType('boarded'),'alighted');
  assert.equal(deriveEventType('alighted'),'boarded');
});

test('explicit scan IDs and time-window keys deduplicate retries',()=>{
  assert.equal(buildDedupeKey({childId:4,vehicleId:9,eventType:'boarded',scanId:'reader-77'}),'scan:reader-77');
  const a=buildDedupeKey({childId:4,vehicleId:9,eventType:'boarded',scannedAt:'2026-11-07T08:00:01Z'});
  const b=buildDedupeKey({childId:4,vehicleId:9,eventType:'alighted',scannedAt:'2026-11-07T08:00:59Z'});
  assert.equal(a,b);
});

test('parent notification content identifies the child and bus event',()=>{
  const content=schoolPushContent({childName:'Sara Ahmed',eventType:'boarded',vehicleName:'Bus 10',scannedAt:'2026-11-07T08:15:00Z'});
  assert.equal(content.title,'Sara Ahmed boarded');
  assert.match(content.body,/Bus 10/);
  assert.equal(content.eventType,'school_boarded');
  assert.equal(content.channelId,'masar_school_v1');
});
