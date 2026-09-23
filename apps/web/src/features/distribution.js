// 本机能力（附文件、后台执行等需要在用户自己电脑上运行的能力）的界面开关。
// 只决定显示与否，不是授权：API 独立判断自己是否运行在用户电脑上，托管服务器一律拒绝。
export const isLocalWorkClient = () => import.meta.env.VITE_APP_DISTRIBUTION === 'local'
