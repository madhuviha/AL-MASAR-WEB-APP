import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeParentBus} from '../parent-bus.mjs';

function harness(){
  const routes=[],queries=[];let liveReads=0;
  const app={};
  for(const method of ['get','post','put','delete'])app[method]=(path,...handlers)=>routes.push({method,path,handlers});
  const pool={query:async(sql,params=[])=>{
    queries.push({sql,params});
    if(sql.includes('FROM school_children c')&&sql.includes('traccar_device_id')){
      return {rows:params[2]===42?[{childId:10,childName:'Sara',vehicleId:20,vehicleName:'Bus 20',deviceId:501,plateNumber:'QA-20'}]:[]};
    }
    return {rows:params.includes(42)?[{childId:10,childName:'Sara'}]:[]};
  }};
  initializeParentBus(app,{pool,requireAuth:(_req,_res,next)=>next(),readLiveSnapshots:async()=>{liveReads++;return {source:'test',rows:[{id:501,latitude:25.3,longitude:51.5,valid:true,fixTime:'2026-11-09T12:00:00Z',lastupdate:'2026-11-09T12:00:02Z'}]}}});
  return {routes,queries,get liveReads(){return liveReads}};
}
function makeRes(){return {statusCode:200,headers:{},body:null,status(code){this.statusCode=code;return this},set(key,value){this.headers[key]=value;return this},json(value){this.body=value;return this}}}
async function callRoute(h,path,user,{params={},query={}}={}){
  const route=h.routes.find(item=>item.method==='get'&&item.path===path);
  assert.ok(route,`route exists: ${path}`);
  const req={user,params,query,body:{},headers:{}};const res=makeRes();
  route.handlers[0](req,res,()=>{});
  let allowed=false;route.handlers[1](req,res,()=>{allowed=true});
  if(allowed)await route.handlers[2](req,res);
  return res;
}
const parent=(id)=>({id,company_id:7,role:'parent',account_role:'company_admin',app_role:'parent',available_roles:['fleet','parent'],metadata:{}});

test('parent collection, dashboard, and scan reads are always scoped to linked children',async()=>{
  const h=harness();
  await callRoute(h,'/api/school/children',parent(42));
  await callRoute(h,'/api/school/parent/dashboard',parent(42));
  await callRoute(h,'/api/school/scans',parent(42),{query:{limit:'50'}});
  assert.equal(h.queries.length,3);
  assert.match(h.queries[0].sql,/cp\.parent_user_id=\$2/);
  assert.match(h.queries[1].sql,/cp\.parent_user_id=\$2/);
  assert.match(h.queries[2].sql,/cp\.parent_user_id=\$2/);
  assert.deepEqual(h.queries.map(x=>x.params.slice(0,2)),[[7,42],[7,42],[7,42]]);
});

test('a parent cannot request another family’s bus coordinates',async()=>{
  const h=harness(),res=await callRoute(h,'/api/school/children/:id/bus-location',parent(99),{params:{id:'10'}});
  assert.equal(res.statusCode,404);
  assert.match(h.queries[0].sql,/cp\.parent_user_id=\$3/);
  assert.deepEqual(h.queries[0].params,[10,7,99]);
  assert.equal(h.liveReads,0);
});

test('a linked parent receives only the assigned bus GPS and its update times',async()=>{
  const h=harness(),res=await callRoute(h,'/school/children/:id/bus-location',parent(42),{params:{id:'10'}});
  assert.equal(res.statusCode,200);
  assert.equal(res.body.childId,10);
  assert.deepEqual(res.body.vehicle,{id:20,name:'Bus 20',plateNumber:'QA-20'});
  assert.deepEqual([res.body.latitude,res.body.longitude],[25.3,51.5]);
  assert.equal(res.body.gpsUpdatedAt,'2026-11-09T12:00:00Z');
  assert.equal(res.body.packetReceivedAt,'2026-11-09T12:00:02Z');
  assert.equal(h.liveReads,1);
});

test('a fleet-only token cannot use parent endpoints',async()=>{
  const h=harness(),fleet={id:7,company_id:7,role:'company_admin',account_role:'company_admin',app_role:'fleet',available_roles:['fleet'],metadata:{}};
  const res=await callRoute(h,'/api/school/children',fleet);
  assert.equal(res.statusCode,403);
  assert.equal(h.queries.length,0);
});
