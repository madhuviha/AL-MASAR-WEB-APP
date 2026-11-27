import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeParentBus} from '../parent-bus.mjs';

test('creating a school parent explicitly grants and audits the parent app role',async()=>{
  const routes=[],calls=[];
  const app={post:(path,...handlers)=>routes.push({path,handlers}),get(){},put(){},delete(){}};
  const client={
    async query(sql,args=[]){
      calls.push({sql,args});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[],rowCount:0};
      if(sql.startsWith('SELECT id FROM school_children'))return {rows:[{id:12}],rowCount:1};
      if(sql.startsWith('INSERT INTO auth_users'))return {rows:[{id:44,companyId:7,name:'Parent',email:'parent@example.invalid',role:'parent',status:'active'}],rowCount:1};
      return {rows:[],rowCount:1};
    },
    release(){}
  };
  const pool={connect:async()=>client};
  await initializeParentBus(app,{pool,requireAuth:(_req,_res,next)=>next(),readLiveSnapshots:async()=>({rows:[]})});
  const route=routes.find(item=>item.path==='/api/school/parents');
  assert.ok(route);
  const req={user:{id:91,company_id:7,role:'school_admin',metadata:{schoolAdmin:true}},body:{name:'Parent',email:'parent@example.invalid',password:'ValidParentPassword123',childIds:[12]},headers:{}};
  const res={statusCode:200,body:null,status(code){this.statusCode=code;return this},json(value){this.body=value;return this}};
  let allowed=false;
  route.handlers[0](req,res,()=>{});
  route.handlers[1](req,res,()=>{allowed=true});
  assert.equal(allowed,true);
  await route.handlers[2](req,res);
  assert.equal(res.statusCode,201);
  const grant=calls.find(call=>call.sql.startsWith('INSERT INTO auth_user_app_roles'));
  assert.ok(grant);
  assert.equal(grant.args[0],44);
  assert.equal(grant.args[1],91);
  const audit=calls.find(call=>call.sql.startsWith('INSERT INTO audit_events'));
  assert.ok(audit);
  const detail=JSON.parse(audit.args[3]);
  assert.deepEqual(detail.grantedAppRoles,['parent']);
  assert.equal(detail.accountRole,'parent');
});
