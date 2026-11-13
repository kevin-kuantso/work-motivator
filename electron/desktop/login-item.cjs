'use strict';

const WINDOWS_LOGIN_ARG = '--work-motivator-login';

function isLoginLaunch({ platform = process.platform, argv = [], loginSettings = {} } = {}) {
  if (platform === 'win32') return argv.includes(WINDOWS_LOGIN_ARG);
  if (platform === 'darwin') return loginSettings?.wasOpenedAtLogin === true;
  return false;
}

function readLoginEnabled(app, { platform = process.platform } = {}) {
  try {
    // Windows compares the registry entry against its command-line arguments.
    // We register the login-only argument, so querying without it reports false
    // even when Windows has just accepted the startup item.
    const options = platform === 'win32' ? { args: [WINDOWS_LOGIN_ARG] } : undefined;
    return Boolean(app.getLoginItemSettings?.(options).openAtLogin);
  } catch {
    return false;
  }
}

function setLoginEnabled(app, enabled, { platform = process.platform } = {}) {
  try {
    const options = { openAtLogin: Boolean(enabled) };
    if (platform === 'win32' && enabled) options.args = [WINDOWS_LOGIN_ARG];
    app.setLoginItemSettings(options);
    return { enabled: readLoginEnabled(app, { platform }) };
  } catch (error) {
    return { enabled: readLoginEnabled(app, { platform }), error: error?.message || 'login-item-change-failed' };
  }
}

module.exports = { WINDOWS_LOGIN_ARG, isLoginLaunch, readLoginEnabled, setLoginEnabled };
