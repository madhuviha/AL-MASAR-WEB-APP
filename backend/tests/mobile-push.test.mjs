import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueueUserPushes} from '../mobile-push.mjs';

test('school scan pushes are queued only for parent-mode registrations',async()=>{
  const calls=[];
  const pool={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT token_hash'))return {rows:[{token_hash:'parent-token-hash'}]};
    return {rowCount:1,rows:[]};
  }};
  const result=await enqueueUserPushes(pool,{userIds:[42],companyId:7,alertId:'school:scan-1',semanticKey:'school:child-10:scan-1',payload:{childId:'10'}});
  assert.match(calls[0].sql,/app_role='parent'/);
  assert.deepEqual(calls[0].params,[7,[42]]);
  assert.equal(result.queued,1);
});
