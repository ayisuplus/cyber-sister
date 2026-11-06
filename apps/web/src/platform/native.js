import { Capacitor, registerPlugin } from '@capacitor/core'

export const isIOSApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
export const isMobileBuild = () => isIOSApp() || import.meta.env.VITE_CLIENT_TARGET === 'ios'

/** @type {{ read: () => Promise<{value?: string}>, write: (options: {value: string}) => Promise<void>, clear: () => Promise<void> }} */
export const SessionVault = registerPlugin('SessionVault')
