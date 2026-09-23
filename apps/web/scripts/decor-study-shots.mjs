/* global document */
// 论文偏好小实验的截图（见 docs/04-开发/装饰偏好小实验.md，路线图 C18）：
//
//   pnpm --filter cyber-sister-client exec node scripts/build-local.mjs        先构建一份 dist
//   pnpm --filter cyber-sister-client exec node scripts/decor-study-shots.mjs
//
// 3 个画面（封面、倾诉中的一页、收到来信的一页）× 3 档装饰（没有 / 少量 / 较多）× 日间、夜间 = 18 张，手机尺寸。
// 「较多」只在截图时往页面里多塞装饰，产品里没有这一档。时间固定在北京时间深夜 01:40，对话内容固定，接口全用桩。
// 输出到 study-results/decor-study/（不进仓库；不放 test-results/，那里每次跑 e2e 都会被 Playwright 清空）：
// named/ 按条件命名给作者看；blind/ 用随机编号给被试看；
// key.json 是编号与条件的对照表，并给出每位被试看同一画面三档时的拉丁方顺序。
import { createServer } from 'node:http'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(WEB, 'dist')
const OUT = path.join(WEB, 'study-results', 'decor-study')
const PORT = 4181
const ORIGIN = `http://127.0.0.1:${PORT}`
const NIGHT = new Date('2026-09-23T01:40:00+08:00')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.jpg': 'image/jpeg' }

const at = (minutesBefore) => new Date(NIGHT.getTime() - minutesBefore * 60_000).toISOString()
const VENTING = [
  { id: 'm1', role: 'user', content: '睡不着，明早九点要跟全组汇报，一闭眼就在脑子里过PPT', createdAt: at(12) },
  { id: 'm2', role: 'assistant', content: '这么晚了脑子还在转，一定挺累的。明天的事明天的你会接住，现在不用再过一遍。要不要跟我说说，最怕的是哪一页？', createdAt: at(11) },
  { id: 'm3', role: 'user', content: '最怕被问到数据是怎么来的，我自己都没底', createdAt: at(6) },
  { id: 'm4', role: 'assistant', content: '心里没底的时候，最难受的是那种「会被拆穿」的感觉。你愿意的话，我们就挑那一个问题，想一句你明天真的说得出口的话。说不出也没关系，今晚能躺下就已经很好了。', createdAt: at(5) },
]
const LETTER = {
  id: 'letter:l1', kind: 'letter', letterId: 'l1', reason: '她每周写给你的信',
  content: '见信好。\n这一周你把自己照顾得比你以为的要好：有两个晚上睡前跟我说了话，还记得给自己留了一顿好好吃的晚饭。',
}
const SCENES = {
  cover: { label: '封面', thread: [], nudges: [] },
  venting: { label: '倾诉中的一页', thread: VENTING, nudges: [] },
  letter: { label: '收到来信的一页', thread: VENTING.slice(0, 2), nudges: [LETTER] },
}
const LEVELS = { none: '没有', some: '少量', more: '较多' }
const THEMES = { light: '日间', dark: '夜间' }

function serveDist() {
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, ORIGIN)
    if (pathname.startsWith('/api/')) {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end('{"error":"unmocked"}')
      return
    }
    let file = path.join(DIST, decodeURIComponent(pathname))
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
    } catch {
      file = path.join(DIST, 'index.html')
    }
    try {
      const body = await readFile(file)
      response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)))
}

// 「较多」：只在截图里往页面上多贴——每页角上多两枚植物、信纸上也放那只小猫（邮票）、多一段胶带。
// 都贴在空白处（天头、页边、便签下面的空行），不压字：比的是「多」本身，不是「挡住字」
function addMore(scene) {
  const sheet = document.querySelector('.letter-sheet')
  sheet.style.position = 'relative'
  const add = (name, size, style) => {
    const image = document.createElement('img')
    image.src = `/design-assets/decor/${name}.webp`
    image.alt = ''
    image.className = 'decor decor-sticker'
    image.style.cssText = `position:absolute;z-index:3;height:${size}px;width:auto;${style}`
    sheet.appendChild(image)
  }
  const tape = (style) => {
    const strip = document.createElement('span')
    strip.className = 'decor decor-tape'
    strip.style.cssText = `position:absolute;z-index:3;${style}`
    sheet.appendChild(strip)
  }
  if (scene === 'cover') {
    add('lavender', 54, 'top:18px;right:22px;transform:rotate(12deg)')
    add('clover', 40, 'bottom:120px;left:24px;transform:rotate(-10deg)')
    add('stamp', 52, 'top:120px;left:20px;transform:rotate(-6deg)')
    return
  }
  add('sage', 44, 'top:8px;right:10px;transform:rotate(14deg)')
  add('forget-me-not', 42, 'top:46%;left:6px;transform:rotate(-12deg)')
  tape('top:-2px;left:44%;transform:rotate(3deg)')
  if (scene === 'venting') {
    // 倾诉页写满了字：邮票贴在顶上两行的天头里
    add('stamp', 50, 'top:10px;left:58px;transform:rotate(-4deg)')
    return
  }
  // 来信页：便签左上角压一段胶带，邮票贴在便签下面的空行里
  tape('top:22px;left:48px;transform:rotate(-8deg)')
  add('stamp', 56, 'bottom:130px;left:64px;transform:rotate(-5deg)')
}

async function shoot(browser, { scene, level, theme }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai', colorScheme: theme, reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(NIGHT)
  await page.addInitScript(({ theme: preference, decor }) => {
    localStorage.setItem('cyber-sister-auth', JSON.stringify({ state: { token: 'decor-study', user: { id: 'decor-study', nickname: '小满', persona: 'gentle' }, isLoggedIn: true }, version: 0 }))
    localStorage.setItem('cyber-sister-disclaimer-shown', 'true')
    localStorage.setItem('amie-theme', preference)
    localStorage.setItem('amie-decor', decor)
  }, { theme, decor: level === 'none' ? 'off' : 'on' })
  const json = (body) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/chat/thread**', json({ id: 'decor-study', messages: SCENES[scene].thread }))
  await page.route('**/api/chat/nudges', json({ nudges: SCENES[scene].nudges }))
  await page.route('**/api/user/external-llm-consent', json({ accepted: true, version: 'cloud-primary-v4', updatedAt: null }))
  await page.route('**/api/asr/status', json({ available: false, configured: false, reason: 'ASR_NOT_CONFIGURED' }))
  await page.route('**/api/work/status', json({ capabilities: { backgroundTasks: false } }))
  await page.route('**/api/work/tasks', json({ tasks: [] }))
  await page.goto(`${ORIGIN}/chat`)
  await page.getByRole('textbox', { name: '聊天消息' }).waitFor({ timeout: 20_000 })
  // 只在信纸这一层里找：翻页时的拓印也有同样的字（拓印去掉了 role，这样找不到它）
  if (SCENES[scene].nudges.length) await page.getByRole('region', { name: '信纸' }).getByText('见信好。', { exact: false }).waitFor()
  // 倾诉那一页要看得到日期行、她说的和你说的：翻回第一页（减少动态效果下翻页是淡入淡出）
  for (let tries = 0; scene === 'venting' && tries < 5; tries += 1) {
    if ((await page.getByRole('navigation', { name: '翻页' }).innerText()).trim().startsWith('1 /')) break
    await page.getByRole('button', { name: '上一页' }).click()
    await page.waitForTimeout(400)
  }
  // 鼠标移开：按钮的悬停底色不能出现在截图里，三档之间只差装饰
  await page.mouse.move(0, 0)
  if (level === 'more') await page.evaluate(addMore, scene)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => [...document.images].every((image) => image.complete))
  const file = path.join(OUT, 'named', `${scene}-${level}-${theme}.png`)
  await page.screenshot({ path: file })
  await context.close()
  return file
}

// 固定种子的洗牌：同一份代码每次给出同样的编号，方便复核
function shuffled(items, seed = 20260923) {
  let state = seed
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1))
    ;[copy[index], copy[pick]] = [copy[pick], copy[index]]
  }
  return copy
}

async function main() {
  try {
    await stat(path.join(DIST, 'index.html'))
  } catch {
    console.error('没有 dist：先运行 pnpm --filter cyber-sister-client exec node scripts/build-local.mjs')
    process.exit(1)
  }
  await rm(OUT, { recursive: true, force: true })
  await mkdir(path.join(OUT, 'named'), { recursive: true })
  await mkdir(path.join(OUT, 'blind'), { recursive: true })
  const conditions = Object.keys(THEMES).flatMap((theme) => Object.keys(SCENES).flatMap((scene) => Object.keys(LEVELS).map((level) => ({ scene, level, theme }))))

  const server = await serveDist()
  const browser = await chromium.launch()
  const shots = []
  try {
    // 一张一张截：同一时刻只开一个页面，时钟与字体都稳定
    for (const condition of conditions) {
      shots.push({ ...condition, file: await shoot(browser, condition) })
    }
  } finally {
    await browser.close()
    server.close()
  }

  const codes = shuffled(shots.map((_, index) => `P${String(index + 1).padStart(2, '0')}`))
  const key = shots.map((shot, index) => ({
    code: codes[index], scene: shot.scene, sceneLabel: SCENES[shot.scene].label,
    level: shot.level, levelLabel: LEVELS[shot.level], theme: shot.theme, themeLabel: THEMES[shot.theme],
  }))
  await Promise.all(shots.map((shot, index) => copyFile(shot.file, path.join(OUT, 'blind', `${codes[index]}.png`))))
  // 同一画面的三档，按 3×3 拉丁方轮换出场顺序：第 n 位被试用第 n % 3 行
  const latin = [['none', 'some', 'more'], ['some', 'more', 'none'], ['more', 'none', 'some']]
  const orders = latin.map((row, index) => ({ participants: `第 ${index + 1}、${index + 4}、${index + 7} 位`, levelOrder: row.map((level) => LEVELS[level]) }))
  await writeFile(path.join(OUT, 'key.json'), `${JSON.stringify({ time: NIGHT.toISOString(), viewport: '390×844 @2x', key, orders }, null, 2)}\n`, 'utf8')
  console.log(`截了 ${shots.length} 张：${path.join(OUT, 'named')}；盲评用 ${path.join(OUT, 'blind')}，对照表 key.json`)
}

await main()
