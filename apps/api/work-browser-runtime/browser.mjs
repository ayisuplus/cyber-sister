import { chromium } from 'playwright-core'
import readline from 'node:readline'

// Protocol only on stdout. Page content and network requests are untrusted data.
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const requests = new Map()
let requestId = 0
let revision = 0
let refs = new Map()
let busy = false
let page
let browser
let rejectedRequests = 0
const withApprovals = process.argv.includes('--with-approvals')
let submitting = null
const submissions = new Set()
const guard = setTimeout(() => process.exit(1), withApprovals ? 600000 : 180000)
guard.unref()

function resource(route) {
  const request = route.request()
  const review = request.method() !== 'GET' || (submitting && request.isNavigationRequest() && request.frame() === page.mainFrame())
  const body = review ? request.postDataBuffer() || Buffer.alloc(0) : null
  if ((review && (!submitting || !withApprovals || body.length > 8192 || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()))) || ['media', 'websocket'].includes(request.resourceType())) {
    rejectedRequests += 1
    return route.abort()
  }
  const id = ++requestId
  if (id > 120) { rejectedRequests += 1; return route.abort() }
  const promise = new Promise(resolve => {
    const timer = setTimeout(() => {
      requests.delete(id)
      rejectedRequests += 1
      route.abort().catch(() => {}).finally(resolve)
    }, review ? 320000 : 25000)
    requests.set(id, { route, resolve, timer })
    send({ event: 'resource', id, url: request.url(), method: request.method(),
      ...(review ? { review: true, commandId: submitting, base64: body.toString('base64'), contentType: request.headers()['content-type'] || '' } : {}) })
  })
  if (review) { submissions.add(promise); void promise.finally(() => submissions.delete(promise)) }
  return promise
}

async function respond(message) {
  const pending = requests.get(message.id)
  if (!pending) return
  requests.delete(message.id)
  clearTimeout(pending.timer)
  try {
    if (message.error) { rejectedRequests += 1; await pending.route.abort() }
    else await pending.route.fulfill({ status: message.status, headers: message.headers, body: Buffer.from(message.base64, 'base64') })
  } catch { /* A navigation or cancellation can dispose the intercepted request. */ }
  finally { pending.resolve() }
}

function describe(node) {
  const type = (node.getAttribute('type') || '').toLowerCase()
  const tag = node.tagName.toLowerCase()
  return {
    role: node.getAttribute('role') || ({ a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', summary: 'button' }[tag] || (tag === 'input' ? 'textbox' : tag)),
    name: (node.getAttribute('aria-label') || [...(node.labels || [])].map(label => label.innerText).join(' ') || node.innerText || node.getAttribute('placeholder') || node.getAttribute('title') || '').trim().slice(0, 160),
    ...(tag === 'a' ? { href: node.href } : {}),
    type,
  }
}

async function clearRefs() {
  const previous = [...refs.values()]
  refs = new Map()
  await Promise.all(previous.map(({ handle }) => handle.dispose().catch(() => {})))
}

async function snapshot(screenshot = false) {
  await clearRefs()
  revision += 1
  const elements = await page.locator('a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="tab"],summary').elementHandles()
  const candidates = elements.slice(0, 200)
  await Promise.all(elements.slice(200).map(handle => handle.dispose()))
  const described = await Promise.all(candidates.map(async handle => {
    if (!await handle.isVisible()) { await handle.dispose(); return null }
    return { handle, detail: await handle.evaluate(describe) }
  }))
  const controls = []
  for (const item of described.filter(Boolean)) {
    if (['password', 'file'].includes(item.detail.type)) { await item.handle.dispose(); continue }
    const ref = `${revision}:${controls.length + 1}`
    refs.set(ref, item)
    controls.push({ ref, ...item.detail })
  }
  const text = await page.locator('body').innerText({ timeout: 5000 })
  return { url: page.url(), title: (await page.title()).slice(0, 200), content: text.slice(0, 18000), truncated: text.length > 18000,
    controls, rejectedRequests, ...(screenshot ? { screenshot: (await page.screenshot({ type: 'png', timeout: 5000 })).toString('base64') } : {}) }
}

async function perform(args) {
  if (args.action === 'scroll') {
    await page.mouse.wheel(0, args.direction === 'up' ? -650 : 650)
    return
  }
  const item = refs.get(args.ref)
  if (!item || !await item.handle.isVisible() || JSON.stringify(await item.handle.evaluate(describe)) !== JSON.stringify(item.detail)) {
    throw new Error('STALE_REFERENCE')
  }
  if (args.action === 'click') await item.handle.click({ timeout: 10000, noWaitAfter: true })
  else if (args.action === 'fill') await item.handle.fill(args.value, { timeout: 10000 })
  else if (args.action === 'select') await item.handle.selectOption(args.value, { timeout: 10000 })
  else if (args.action === 'press') await item.handle.press(args.key, { timeout: 10000, noWaitAfter: true })
  else throw new Error('INVALID_ACTION')
}

async function command(message) {
  if (busy) { send({ event: 'result', id: message.id, error: 'BUSY' }); return }
  busy = true
  submitting = withApprovals && message.operation === 'act' && message.args.submit === true ? message.id : null
  try {
    if (message.operation === 'open') {
      await clearRefs()
      const response = await page.goto(message.args.url, { waitUntil: 'domcontentloaded', timeout: 25000 })
      if (response && response.status() >= 400) throw new Error('HTTP_ERROR')
    } else if (message.operation === 'act') await perform(message.args)
    else if (message.operation !== 'snapshot') throw new Error('INVALID_ACTION')
    // Let synchronous handlers and immediately initiated fetches update the page.
    await page.waitForTimeout(200)
    while (submissions.size) {
      // Each actual request waits independently for its bound user decision.
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([...submissions])
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(200)
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 })
    send({ event: 'result', id: message.id, result: await snapshot(message.args.screenshot === true) })
  } catch (error) {
    send({ event: 'result', id: message.id, error: ['STALE_REFERENCE', 'HTTP_ERROR', 'INVALID_ACTION'].includes(error.message) ? error.message : 'BROWSER_ERROR' })
  } finally { busy = false; submitting = null }
}

try {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 20000,
    args: ['--disable-background-networking', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: false, serviceWorkers: 'block' })
  await context.route('**/*', resource)
  await context.routeWebSocket('**/*', socket => socket.close())
  page = await context.newPage()
  context.on('page', popup => { if (popup !== page) void popup.close() })
  page.on('dialog', dialog => { void dialog.dismiss() })
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  input.on('line', line => {
    if (line.length > 4 * 1024 * 1024) { process.exit(1); return }
    let message
    try { message = JSON.parse(line) } catch { process.exit(1); return }
    if (message.event === 'resource') void respond(message)
    else void command(message)
  })
  input.on('close', () => { void browser.close().finally(() => process.exit(0)) })
  send({ event: 'ready' })
} catch {
  send({ event: 'fatal', error: 'BROWSER_UNAVAILABLE' })
  await browser?.close()
  process.exit(1)
}
