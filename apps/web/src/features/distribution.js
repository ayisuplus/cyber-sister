// UI selection is not authorization; the website API independently refuses tools.
export const isLocalWorkClient = () => import.meta.env.VITE_APP_DISTRIBUTION === 'local'
