import test from 'node:test';
import assert from 'node:assert/strict';
import {authRolePayload,defaultAppRole,normalizeAppRoles,scopeUserToSession} from '../auth-roles.mjs';

test('a dual-role account defaults to fleet and can receive a parent-scoped session',()=>{
  const base={id:42,company_id:7,name:'Masar',email:'masar@example.qa',account_role:'company_admin',
    role:'company_admin',status:'active',available_roles:['fleet','parent']};
  assert.equal(defaultAppRole(base.account_role,base.available_roles),'fleet');
  const parent=scopeUserToSession({...base,active_app_role:'parent'});
  assert.equal(parent.role,'parent');
  assert.equal(parent.account_role,'company_admin');
  assert.deepEqual(parent.available_roles,['fleet','parent']);
  assert.deepEqual(authRolePayload(parent).availableRoles,['fleet','parent']);
  assert.equal(authRolePayload(parent).user.activeRole,'parent');
});

test('a session cannot switch into a role absent from its grants',()=>{
  const parentOnly={id:9,role:'parent',account_role:'parent',available_roles:['parent']};
  assert.equal(scopeUserToSession({...parentOnly,active_app_role:'fleet'}),null);
  assert.equal(scopeUserToSession({...parentOnly,active_app_role:'admin'}),null);
});

test('role names are constrained to fleet and parent',()=>{
  assert.deepEqual(normalizeAppRoles('company_admin',['fleet','parent','super_admin','parent']),['fleet','parent']);
});
