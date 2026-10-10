export const IpcChannel = {
  DeviceGetInfo: 'device:getInfo',
  DeviceGetMetrics: 'device:getMetrics',
  DeviceGetProcesses: 'device:getProcesses',
  DeviceGetInstalledApps: 'device:getInstalledApps',
  AuthSaveRefreshToken: 'auth:saveRefreshToken',
  AuthGetRefreshToken: 'auth:getRefreshToken',
  AuthClearRefreshToken: 'auth:clearRefreshToken',
  WindowMinimize: 'window:minimize',
  WindowMaximizeToggle: 'window:maximizeToggle',
  WindowClose: 'window:close',
  SystemOpenSetting: 'system:openSetting',
  AppGetVersion: 'app:getVersion',
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];
