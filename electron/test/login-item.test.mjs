import { test } from 'node:test';
import assert from 'node:assert/strict';
import login from '../desktop/login-item.cjs';

test('isLoginLaunch uses the Windows-only login argument and macOS wasOpenedAtLogin', () => {
  assert.equal(login.isLoginLaunch({ platform: 'win32', argv: ['app.exe', '--work-motivator-login'], loginSettings: {} }), true);
  assert.equal(login.isLoginLaunch({ platform: 'win32', argv: ['app.exe'], loginSettings: { wasOpenedAtLogin: true } }), false);
  assert.equal(login.isLoginLaunch({ platform: 'darwin', argv: ['app'], loginSettings: { wasOpenedAtLogin: true } }), true);
  assert.equal(login.isLoginLaunch({ platform: 'darwin', argv: ['app', '--work-motivator-login'], loginSettings: { wasOpenedAtLogin: false } }), false);
});

test('setLoginEnabled returns the system read-back state when the setter fails', () => {
  const calls = [];
  const app = {
    setLoginItemSettings(value) { calls.push(value); throw new Error('system approval required'); },
    getLoginItemSettings(options) { assert.deepEqual(options, { args: ['--work-motivator-login'] }); return { openAtLogin: false }; },
  };
  assert.deepEqual(login.setLoginEnabled(app, true, { platform: 'win32' }), { enabled: false, error: 'system approval required' });
  assert.deepEqual(calls, [{ openAtLogin: true, args: ['--work-motivator-login'] }]);
});

test('setLoginEnabled reads back the effective state after a successful change', () => {
  let enabled = false;
  const app = {
    setLoginItemSettings({ openAtLogin }) { enabled = openAtLogin; },
    getLoginItemSettings() { return { openAtLogin: enabled }; },
  };
  assert.deepEqual(login.setLoginEnabled(app, true, { platform: 'darwin' }), { enabled: true });
  assert.deepEqual(login.setLoginEnabled(app, false, { platform: 'darwin' }), { enabled: false });
});

test('Windows reads back the same login-only argument used to register the item', () => {
  let readOptions;
  const app = {
    setLoginItemSettings() {},
    getLoginItemSettings(options) { readOptions = options; return { openAtLogin: true }; },
  };
  assert.deepEqual(login.setLoginEnabled(app, true, { platform: 'win32' }), { enabled: true });
  assert.deepEqual(readOptions, { args: ['--work-motivator-login'] });
});
