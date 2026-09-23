import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/collectionService', () => ({
  collectionService: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
vi.mock('../../features/collection/preparePhoto', () => ({
  PhotoError: class extends Error {},
  preparePhoto: vi.fn(),
}))
// 照片要带登录身份取；这里直接把路径当成图片地址
vi.mock('../../hooks/useAuthedImageUrl', () => ({ useAuthedImageUrl: (path) => path }))

import CollectionShelf from './CollectionShelf'
import { collectionService } from '../../services/collectionService'
import { preparePhoto } from '../../features/collection/preparePhoto'

const item = (overrides = {}) => ({
  id: 'i1', shelf: 'wardrobe', category: '上衣', name: '白衬衫', note: null, status: 'have', link: null,
  photoUrl: '/api/collection/i1/photo?v=1', thumbUrl: '/api/collection/i1/thumb?v=1', ...overrides,
})
const photos = { photo: new Blob(['p']), thumb: new Blob(['t']), previewUrl: 'blob:preview' }
const TAOBAO = '【淘宝】https://m.tb.cn/h.Abc123?tk=XyZ9 CZ0001 「法式复古碎花连衣裙女夏」点击链接直接打开'

const grid = () => screen.getByRole('list', { name: '衣柜' })

beforeEach(() => {
  vi.clearAllMocks()
  collectionService.list.mockResolvedValue([])
  preparePhoto.mockResolvedValue(photos)
})
afterEach(() => vi.unstubAllGlobals())

describe('收藏：翻看', () => {
  it('空的时候说一句怎么放进来，不摆筛选', async () => {
    render(<CollectionShelf shelf="wardrobe" />)
    expect(await screen.findByText(/衣柜还空着/)).toBeInTheDocument()
    expect(collectionService.list).toHaveBeenCalledWith('wardrobe')
    expect(screen.queryByRole('group', { name: '想要还是已有' })).not.toBeInTheDocument()
  })

  it('照片网格加载缩略图；想要的有小标记；按想要/已有和用过的分类筛选', async () => {
    const user = userEvent.setup()
    collectionService.list.mockResolvedValue([
      item(),
      item({ id: 'i2', name: '米色风衣', category: '外套', status: 'want', thumbUrl: null, photoUrl: null, link: 'https://m.tb.cn/h.x' }),
    ])
    render(<CollectionShelf shelf="wardrobe" />)

    await screen.findByRole('button', { name: '白衬衫' })
    expect(within(grid()).getByRole('button', { name: '米色风衣，想要' })).toHaveTextContent('淘宝')
    expect(grid().querySelector('img')).toHaveAttribute('src', '/api/collection/i1/thumb?v=1')
    const categories = screen.getByRole('group', { name: '分类' })
    expect(within(categories).getAllByRole('button').map((button) => button.textContent)).toEqual(['上衣', '外套'])

    await user.click(within(screen.getByRole('group', { name: '想要还是已有' })).getByRole('button', { name: '想要' }))
    expect(within(grid()).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['米色风衣，想要'])
    await user.click(within(screen.getByRole('group', { name: '想要还是已有' })).getByRole('button', { name: '全部' }))
    await user.click(within(categories).getByRole('button', { name: '上衣' }))
    expect(within(grid()).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['白衬衫'])
  })
})

describe('收藏：放进来', () => {
  it('从相册选：先在这台设备上压缩，再带着原图和缩略图存进衣柜，默认「已有」', async () => {
    const user = userEvent.setup()
    collectionService.create.mockResolvedValue(item({ id: 'new', name: '牛仔外套', category: '外套' }))
    render(<CollectionShelf shelf="wardrobe" />)
    await screen.findByText(/衣柜还空着/)

    await user.click(screen.getByRole('button', { name: '放进来' }))
    const file = new File(['x'], 'jacket.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('从相册选一张'), { target: { files: [file] } })

    const form = await screen.findByRole('form', { name: '放进衣柜' })
    expect(preparePhoto).toHaveBeenCalledWith(file)
    expect(within(form).getByRole('img', { name: '这件的照片' })).toHaveAttribute('src', 'blob:preview')
    expect(within(form).getByRole('button', { name: '已有' })).toHaveAttribute('aria-pressed', 'true')
    await user.type(within(form).getByLabelText('名字'), '牛仔外套')
    await user.click(within(form).getByRole('button', { name: '外套' }))
    await user.click(within(form).getByRole('button', { name: '存下来' }))

    expect(collectionService.create).toHaveBeenCalledWith({ shelf: 'wardrobe', link: undefined, name: '牛仔外套', category: '外套', status: 'have', note: '' }, photos)
    expect(await screen.findByRole('button', { name: '牛仔外套' })).toBeInTheDocument()
  })

  it('粘贴淘宝分享：名字自动填好、标成「想要」，存下链接', async () => {
    const user = userEvent.setup()
    collectionService.create.mockResolvedValue(item({ id: 'l1', name: '法式复古碎花连衣裙女夏', status: 'want', link: 'https://m.tb.cn/h.Abc123?tk=XyZ9', thumbUrl: null, photoUrl: null }))
    render(<CollectionShelf shelf="wardrobe" />)
    await screen.findByText(/衣柜还空着/)

    await user.click(screen.getByRole('button', { name: '放进来' }))
    await user.click(screen.getByRole('button', { name: '粘贴链接' }))
    fireEvent.change(screen.getByLabelText('把分享的文字或链接粘贴到这里'), { target: { value: TAOBAO } })
    await user.click(screen.getByRole('button', { name: '下一步' }))

    const form = screen.getByRole('form', { name: '放进衣柜' })
    expect(within(form).getByLabelText('名字')).toHaveValue('法式复古碎花连衣裙女夏')
    expect(within(form).getByText('来自淘宝的链接')).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: '想要' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(form).getByRole('button', { name: '存下来' }))

    expect(collectionService.create).toHaveBeenCalledWith(
      { shelf: 'wardrobe', link: 'https://m.tb.cn/h.Abc123?tk=XyZ9', name: '法式复古碎花连衣裙女夏', category: '', status: 'want', note: '' },
      null,
    )
  })

  it('粘贴的文字里没有链接就如实说', async () => {
    const user = userEvent.setup()
    render(<CollectionShelf shelf="makeup" />)
    await screen.findByText(/化妆间还空着/)
    await user.click(screen.getByRole('button', { name: '放进来' }))
    await user.click(screen.getByRole('button', { name: '粘贴链接' }))
    fireEvent.change(screen.getByLabelText('把分享的文字或链接粘贴到这里'), { target: { value: '想买那支口红' } })
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('alert')).toHaveTextContent('没找到链接')
  })

  it('图读不了就如实说，不上传', async () => {
    const user = userEvent.setup()
    preparePhoto.mockRejectedValue(new Error('这张图读不了，换一张试试'))
    render(<CollectionShelf shelf="wardrobe" />)
    await screen.findByText(/衣柜还空着/)
    await user.click(screen.getByRole('button', { name: '放进来' }))
    fireEvent.change(screen.getByLabelText('从相册选一张'), { target: { files: [new File(['x'], 'a.heic', { type: 'image/heic' })] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('这张图读不了')
    expect(collectionService.create).not.toHaveBeenCalled()
  })

  it('手机上「拍一张」直接交给系统相机；电脑上在页面里开相机，打不开就给出从相册选', async () => {
    const user = userEvent.setup()
    render(<CollectionShelf shelf="wardrobe" />)
    await screen.findByText(/衣柜还空着/)
    expect(screen.getByLabelText('拍一张（打开相机）')).toHaveAttribute('capture', 'environment')

    vi.stubGlobal('matchMedia', (query) => ({ matches: query === '(pointer: coarse)' }))
    const click = vi.spyOn(screen.getByLabelText('拍一张（打开相机）'), 'click')
    await user.click(screen.getByRole('button', { name: '放进来' }))
    await user.click(screen.getByRole('button', { name: '拍一张' }))
    expect(click).toHaveBeenCalled()

    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    await user.click(screen.getByRole('button', { name: '拍一张' }))
    const camera = screen.getByRole('region', { name: '拍一张' })
    expect(within(camera).getByRole('alert')).toHaveTextContent('这台设备打不开相机')
    expect(within(camera).getByRole('button', { name: '从相册选' })).toBeInTheDocument()
  })
})

describe('收藏：电脑上的相机', () => {
  it('没给权限时如实说，并给出从相册选', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const getUserMedia = vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    try {
      render(<CollectionShelf shelf="makeup" />)
      await screen.findByText(/化妆间还空着/)
      await user.click(screen.getByRole('button', { name: '放进来' }))
      await user.click(screen.getByRole('button', { name: '拍一张' }))

      const camera = screen.getByRole('region', { name: '拍一张' })
      expect(await within(camera).findByRole('alert')).toHaveTextContent('还没允许使用相机')
      expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { facingMode: 'environment', width: { ideal: 1600 } } })
      await user.click(within(camera).getByRole('button', { name: '从相册选' }))
      expect(screen.getByRole('button', { name: '放进来' })).toBeInTheDocument()
    } finally {
      delete navigator.mediaDevices
    }
  })
})

describe('收藏：看一件', () => {
  it('打开原链接只放行 http(s)；想要/已有点一下就换；删除先确认', async () => {
    const user = userEvent.setup()
    collectionService.list.mockResolvedValue([item({ status: 'want', note: 'S 码', link: 'https://m.tb.cn/h.x' })])
    collectionService.update.mockResolvedValue(item({ status: 'have', note: 'S 码', link: 'https://m.tb.cn/h.x' }))
    collectionService.remove.mockResolvedValue({ success: true })
    render(<CollectionShelf shelf="wardrobe" />)

    await user.click(await screen.findByRole('button', { name: '白衬衫，想要' }))
    const detail = screen.getByRole('article', { name: '白衬衫' })
    expect(within(detail).getByRole('img', { name: '白衬衫' })).toHaveAttribute('src', '/api/collection/i1/photo?v=1')
    expect(within(detail).getByText('S 码')).toBeInTheDocument()
    const link = within(detail).getByRole('link', { name: /打开淘宝链接/ })
    expect(link).toHaveAttribute('href', 'https://m.tb.cn/h.x')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    await user.click(within(detail).getByRole('button', { name: '已有' }))
    expect(collectionService.update).toHaveBeenCalledWith('i1', { status: 'have' })
    expect(await within(detail).findByRole('button', { name: '已有' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(detail).getByRole('button', { name: '删除' }))
    expect(collectionService.remove).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删掉' }))
    expect(collectionService.remove).toHaveBeenCalledWith('i1')
    expect(await screen.findByText(/衣柜还空着/)).toBeInTheDocument()
  })

  it('不是 http(s) 的链接不给打开', async () => {
    const user = userEvent.setup()
    collectionService.list.mockResolvedValue([item({ link: 'javascript:alert(1)' })])
    render(<CollectionShelf shelf="wardrobe" />)
    await user.click(await screen.findByRole('button', { name: '白衬衫' }))
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
