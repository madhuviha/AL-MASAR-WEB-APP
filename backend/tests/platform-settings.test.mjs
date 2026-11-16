import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PlatformSettingsValidationError,
  mergePlatformSettings,
  preparePlatformSettingsPatch,
  redactPlatformSettings
} from '../platform-settings.mjs';

test('category patch changes only supplied keys and preserves other settings and top-level data',()=>{
  const current={
    plans:[{id:'fleet'}],
    headerBanners:[{id:'notice'}],
    settings:{portalTitle:'Old title',supportEmail:'support@example.com',offlineMinutes:300}
  };
  const patch=preparePlatformSettingsPatch('branding',{portalTitle:'New title'});
  const next={...current,settings:mergePlatformSettings(current.settings,patch)};
  assert.deepEqual(next.plans,current.plans);
  assert.deepEqual(next.headerBanners,current.headerBanners);
  assert.equal(next.settings.portalTitle,'New title');
  assert.equal(next.settings.supportEmail,'support@example.com');
  assert.equal(next.settings.offlineMinutes,300);
});

test('blank secret fields are omitted so stored credentials survive the merge',()=>{
  const current={mapTilerKey:'stored-map-key',defaultBaseMap:'osm-road'};
  const patch=preparePlatformSettingsPatch('maps',{mapTilerKey:'  ',defaultBaseMap:'maptiler-basic'});
  assert.deepEqual(patch,{defaultBaseMap:'maptiler-basic'});
  assert.deepEqual(mergePlatformSettings(current,patch),{
    mapTilerKey:'stored-map-key',
    defaultBaseMap:'maptiler-basic'
  });
});

test('platform settings responses replace secret values with blank fields and configured flags',()=>{
  const safe=redactPlatformSettings({mapboxToken:'must-not-return',captchaSecretKey:'also-hidden',portalTitle:'MASAR'});
  assert.equal(safe.mapboxToken,'');
  assert.equal(safe.captchaSecretKey,'');
  assert.equal(safe.portalTitle,'MASAR');
  assert.equal(safe.secretConfigured.mapboxToken,true);
  assert.equal(safe.secretConfigured.captchaSecretKey,true);
  assert.equal(safe.secretConfigured.googleMapsKey,false);
});

test('null explicitly clears a stored secret while blank text keeps it',()=>{
  const current={mapTilerKey:'stored-map-key'};
  const clearPatch=preparePlatformSettingsPatch('maps',{mapTilerKey:null});
  assert.deepEqual(clearPatch,{mapTilerKey:null});
  assert.deepEqual(mergePlatformSettings(current,clearPatch),{mapTilerKey:null});
  assert.throws(
    ()=>preparePlatformSettingsPatch('maps',{mapTilerKey:'  '}),
    error=>error instanceof PlatformSettingsValidationError&&error.code==='empty_settings_patch'
  );
});

test('setting values enforce server-side types, ranges and image formats',()=>{
  assert.throws(
    ()=>preparePlatformSettingsPatch('tracking',{untrackedMinutes:30,offlineMinutes:10}),
    error=>error instanceof PlatformSettingsValidationError&&error.code==='invalid_settings_value'
  );
  assert.throws(
    ()=>preparePlatformSettingsPatch('maps',{enabledMaps:['openStreetMap']}),
    error=>error instanceof PlatformSettingsValidationError&&error.code==='invalid_settings_value'
  );
  assert.throws(
    ()=>preparePlatformSettingsPatch('branding',{welcomeText:{unsafe:true}}),
    error=>error instanceof PlatformSettingsValidationError&&error.code==='invalid_settings_value'
  );
  assert.throws(
    ()=>preparePlatformSettingsPatch('branding',{brandLogoData:'data:text/html;base64,PGgxPk5vPC9oMT4='}),
    error=>error instanceof PlatformSettingsValidationError&&error.code==='invalid_settings_value'
  );
  assert.throws(
    ()=>preparePlatformSettingsPatch('branding',{loginBackgroundData:'data:image/svg+xml;base64,PHN2Zy8+'}),
    error=>error instanceof PlatformSettingsValidationError&&error.code==='invalid_settings_value'
  );
  assert.equal(preparePlatformSettingsPatch('branding',{loginBackgroundData:'data:image/png;base64,aGVsbG8='}).loginBackgroundData,'data:image/png;base64,aGVsbG8=');
});

test('category validation rejects unknown keys and malformed bodies',()=>{
  assert.throws(
    ()=>preparePlatformSettingsPatch('branding',{offlineMinutes:5}),
    error=>error instanceof PlatformSettingsValidationError&&error.code==='invalid_settings_key'
  );
  assert.throws(
    ()=>preparePlatformSettingsPatch('unknown',{portalTitle:'Title'}),
    error=>error instanceof PlatformSettingsValidationError&&error.code==='invalid_settings_category'
  );
  for(const value of [null,[],true,'settings']){
    assert.throws(
      ()=>preparePlatformSettingsPatch('general',value),
      error=>error instanceof PlatformSettingsValidationError&&error.code==='invalid_settings_body'
    );
  }
  assert.throws(
    ()=>preparePlatformSettingsPatch('general',{}),
    error=>error instanceof PlatformSettingsValidationError&&error.code==='empty_settings_patch'
  );
});
