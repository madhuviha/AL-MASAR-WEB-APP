import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {boundedInteger,consumeLoginAttempt,createLoginLimiter,LOGIN_ATTEMPT_LIMIT_MESSAGE,loginIdentityHash,parseAllowedOrigins,redactSensitiveData,sessionDays} from '../security-controls.mjs';

function loginWindowDb(){
  const windows=new Map();
  return {windows,async query(sql,[identityHash,timestamp]){
    assert.match(sql,/ON CONFLICT\(account_hash\) DO UPDATE/);
    const now=new Date(timestamp).getTime(),old=windows.get(identityHash);
    const row=!old||old.startedAt+60000<=now?{startedAt:now,count:1}:{startedAt:old.startedAt,count:old.count+1};
    windows.set(identityHash,row);
    return {rows:[{window_started_at:new Date(row.startedAt),attempt_count:row.count}]};
  }};
}

test('database login limit allows attempts one through five, blocks six, and resets at 60 seconds',async()=>{
  const db=loginWindowDb(),start=Date.parse('2026-11-16T12:00:00Z');
  assert.equal(loginIdentityHash(' User@Example.com '),loginIdentityHash('user@example.com'));
  for(let i=1;i<=5;i++){
    const result=await consumeLoginAttempt(db,i%2?'User@example.com':'user@example.com',start);
    assert.deepEqual(result,{allowed:true,attempts:i,retryAfterSeconds:60});
  }
  const blocked=await consumeLoginAttempt(db,'USER@example.com',start);
  assert.deepEqual(blocked,{allowed:false,attempts:6,retryAfterSeconds:60});
  assert.equal(LOGIN_ATTEMPT_LIMIT_MESSAGE,'Too many login attempts. Please try again after 1 minute.');
  const reset=await consumeLoginAttempt(db,'user@example.com',start+60000);
  assert.deepEqual(reset,{allowed:true,attempts:1,retryAfterSeconds:60});
});

test('fleet and School Bus APIs both use the shared account counter and response message',()=>{
  const fleet=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const school=fs.readFileSync(new URL('../school-server.js',import.meta.url),'utf8');
  for(const source of [fleet,school]){
    assert.match(source,/consumeLoginAttempt\(pool,email\)/);
    assert.match(source,/LOGIN_ATTEMPT_LIMIT_MESSAGE/);
    assert.match(source,/status\(429\)/);
  }
  assert.doesNotMatch(school,/schoolLoginLimiter|loginBlocked\(req,email\)/);
});

test('CORS configuration keeps exact HTTP(S) origins and drops wildcards or paths',()=>{
  const origins=parseAllowedOrigins('https://track.almasar.qa,https://example.com/path,*,javascript:alert(1),http://localhost:5173/');
  assert.deepEqual([...origins].sort(),['http://localhost:5173','https://track.almasar.qa']);
});

test('login limiter blocks repeated email and IP attempts and expires its window',()=>{
  let time=1000;
  const limiter=createLoginLimiter({windowMs:1000,maxPerAccountAndIp:2,maxPerIp:3,maxEntries:100,now:()=>time});
  const request={ip:'192.0.2.4'};
  limiter.recordFailure(request,'User@example.com');
  limiter.recordFailure(request,'user@example.com');
  assert.equal(limiter.blocked(request,'USER@example.com'),true);
  assert.equal(limiter.blocked(request,'other@example.com'),false);
  time+=1001;
  assert.equal(limiter.blocked(request,'user@example.com'),false);
});

test('successful login clears the account counter but keeps the IP abuse counter',()=>{
  const limiter=createLoginLimiter({maxPerAccountAndIp:2,maxPerIp:2,maxEntries:100});
  const request={ip:'192.0.2.5'};
  limiter.recordFailure(request,'user@example.com');
  limiter.clearFailures(request,'user@example.com');
  assert.equal(limiter.blocked(request,'user@example.com'),false);
  limiter.recordFailure(request,'other@example.com');
  assert.equal(limiter.blocked(request,'another@example.com'),true);
});

test('session lifetime values are finite and capped',()=>{
  assert.equal(sessionDays('14'),14);
  assert.equal(sessionDays('invalid'),7);
  assert.equal(sessionDays('1000'),30);
  assert.equal(sessionDays('-5'),1);
  assert.equal(boundedInteger('not-a-port',3001,1,65535),3001);
  assert.equal(boundedInteger('999999',3001,1,65535),65535);
});

test('API response redaction removes nested credential fields without changing ordinary vehicle data',()=>{
  const result=redactSensitiveData({id:17,name:'Bus 17',metadata:{cameras:[{ftpUser:'camera',ftpPassword:'hidden',url:'https://camera.local/live'}],apiKey:'hidden'},attributes:{ignition:true}});
  assert.deepEqual(result,{id:17,name:'Bus 17',metadata:{cameras:[{url:'https://camera.local/live'}]},attributes:{ignition:true}});
});
