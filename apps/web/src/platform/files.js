import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

const readText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('导出文件读取失败'))
  reader.readAsText(blob)
})

export async function shareExport(blob, _filename) {
  // 不信任服务端文件名作为本机路径；仅写沙盒缓存，分享结束后删除。
  const path = `amie-export-${crypto.randomUUID()}.json`
  const data = await readText(blob)
  const { uri } = await Filesystem.writeFile({ path, data, directory: Directory.Cache, encoding: Encoding.UTF8 })
  try {
    await Share.share({ title: '保存 Amie 数据', files: [uri], dialogTitle: '保存或分享数据' })
  } finally {
    await Filesystem.deleteFile({ path, directory: Directory.Cache })
  }
}
