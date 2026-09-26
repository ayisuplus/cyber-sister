import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/gardenService', () => ({
  gardenService: { list: vi.fn(), identify: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
vi.mock('../../features/collection/preparePhoto', () => ({
  PhotoError: class extends Error {},
  preparePhoto: vi.fn(),
}))
// 照片要带登录身份取；这里直接把路径当成图片地址
vi.mock('../../hooks/useAuthedImageUrl', () => ({ useAuthedImageUrl: (path) => path }))

import GardenBook from './GardenBook'
import { gardenService } from '../../services/gardenService'
import { preparePhoto } from '../../features/collection/preparePhoto'

const entry = (overrides = {}) => ({
  id: 'p1', name: '栀子花', scientificName: 'Gardenia jasminoides', family: '茜草科', status: 'met', note: null,
  candidates: [], explanation: null, caution: null, identified: false,
  photoUrl: '/api/garden/p1/photo?v=1', thumbUrl: '/api/garden/p1/thumb?v=1', createdAt: '2026-09-26T04:00:00.000Z', ...overrides,
})
const photos = { photo: new Blob(['p']), thumb: new Blob(['t']), previewUrl: 'blob:preview' }
const RESULT = {
  isPlant: true,
  candidates: [
    { name: '栀子花', scientificName: 'Gardenia jasminoides', family: '茜草科', likelihood: '很像' },
    { name: '白兰', scientificName: null, family: '木兰科', likelihood: '拿不准' },
  ],
  explanation: { what: '夏天开的白花，香得很浓。', howToTell: '花瓣厚、像蜡。', season: null, lore: '民间说它代表一生的守候。', care: null },
  caution: '叶子和果实别让猫啃。',
  promptVersion: 'plant-id-v1',
  identifiedBy: 'qwen-vl-max',
}
const rejectWith = (code, error = '出错了') => Object.assign(new Error(error), { response: { data: { error, code } } })

const renderBook = () => render(
  <MemoryRouter initialEntries={['/tools/garden']}>
    <Routes>
      <Route path="/tools/garden" element={<GardenBook />} />
      <Route path="/settings" element={<p>设置页</p>} />
    </Routes>
  </MemoryRouter>,
)

// 认的时候那张卡写「她在认…」，认完换成结果那一张：等到结果再拿
const resultSheet = async () => {
  await screen.findByText(/^她说，/)
  return screen.getByRole('article', { name: '认一认' })
}

const pickFromAlbum = async (user) => {
  await user.click(screen.getByRole('button', { name: '认一认' }))
  fireEvent.change(screen.getByLabelText('从相册选一张'), { target: { files: [new File(['x'], 'flower.jpg', { type: 'image/jpeg' })] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  gardenService.list.mockResolvedValue([])
  preparePhoto.mockResolvedValue(photos)
})

describe('花草图鉴：翻看', () => {
  it('空的时候说一句怎么开始，不摆筛选', async () => {
    renderBook()
    expect(await screen.findByText(/路上看到一朵叫不出名字的花/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '路上遇见还是我养的' })).not.toBeInTheDocument()
  })

  it('标本签网格：同名的算一种；按路上遇见/我养的筛选', async () => {
    const user = userEvent.setup()
    gardenService.list.mockResolvedValue([
      entry(),
      entry({ id: 'p2', status: 'grow', thumbUrl: null, photoUrl: null, name: '绿萝', family: null }),
      entry({ id: 'p3' }),
    ])
    renderBook()

    expect(await screen.findByText('遇见过 2 种')).toBeInTheDocument()
    const grid = screen.getByRole('list', { name: '花草图鉴' })
    expect(grid.querySelector('img')).toHaveAttribute('src', '/api/garden/p1/thumb?v=1')
    await user.click(within(screen.getByRole('group', { name: '路上遇见还是我养的' })).getByRole('button', { name: '我养的' }))
    expect(within(grid).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['绿萝，我养的'])
  })
})

describe('花草图鉴：认一认', () => {
  it('从相册选 → 压缩 → 她认、讲；选第一个收进图鉴，识别结果与选的是哪个一起带回去', async () => {
    const user = userEvent.setup()
    gardenService.identify.mockResolvedValue(RESULT)
    gardenService.create.mockResolvedValue(entry({ id: 'new' }))
    renderBook()
    await screen.findByText(/路上看到一朵/)

    await pickFromAlbum(user)
    const sheet = await resultSheet()
    expect(gardenService.identify).toHaveBeenCalledWith(photos.photo)
    expect(within(sheet).getByText('她说，很像是「栀子花」')).toBeInTheDocument()
    expect(within(sheet).getByText('夏天开的白花，香得很浓。')).toBeInTheDocument()
    expect(within(sheet).getByText('民间说它代表一生的守候。')).toBeInTheDocument()
    expect(within(sheet).getByText('叶子和果实别让猫啃。')).toBeInTheDocument()
    expect(within(sheet).getByText(/她认得不一定准/)).toBeInTheDocument()
    expect(within(sheet).getByRole('radio', { name: /栀子花/ })).toBeChecked()

    await user.type(within(sheet).getByLabelText(/写一句/), '楼下花坛')
    await user.click(within(sheet).getByRole('button', { name: '收进图鉴' }))

    expect(gardenService.create).toHaveBeenCalledWith({
      name: '栀子花', scientificName: 'Gardenia jasminoides', family: '茜草科', status: 'met', note: '楼下花坛',
      identification: JSON.stringify(RESULT), pick: '0',
    }, photos)
    expect(await screen.findByRole('list', { name: '花草图鉴' })).toBeInTheDocument()
  })

  it('换成第二个候选：讲解先不放，说清楚是照谁写的；也可以都不是、自己写', async () => {
    const user = userEvent.setup()
    gardenService.identify.mockResolvedValue(RESULT)
    gardenService.create.mockResolvedValue(entry({ id: 'new', name: '我家那盆' }))
    renderBook()
    await screen.findByText(/路上看到一朵/)
    await pickFromAlbum(user)
    const sheet = await resultSheet()

    await user.click(within(sheet).getByRole('radio', { name: /白兰/ }))
    expect(within(sheet).queryByText('夏天开的白花，香得很浓。')).not.toBeInTheDocument()
    expect(within(sheet).getByText('她的讲解是照「栀子花」写的，换了一种就先不放讲解。')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('radio', { name: '都不是，我自己写' }))
    await user.click(within(sheet).getByRole('button', { name: '收进图鉴' }))
    expect(within(sheet).getByRole('alert')).toHaveTextContent('给它写个名字吧')
    await user.type(within(sheet).getByLabelText('它叫什么'), '我家那盆')
    await user.click(within(sheet).getByRole('button', { name: '收进图鉴' }))
    expect(gardenService.create.mock.calls[0][0]).toEqual({ name: '我家那盆', status: 'met', note: '', identification: JSON.stringify(RESULT) })
  })

  it('不是花草就照实说；不收了回到图鉴，什么也不存', async () => {
    const user = userEvent.setup()
    gardenService.identify.mockResolvedValue({ isPlant: false, candidates: [] })
    renderBook()
    await screen.findByText(/路上看到一朵/)
    await pickFromAlbum(user)

    expect(await screen.findByText('这张好像不是花草。')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '不收了' }))
    expect(await screen.findByText(/路上看到一朵/)).toBeInTheDocument()
    expect(gardenService.create).not.toHaveBeenCalled()
  })

  it('没同意云端：说清楚照片会发去哪，给一条去设置的路；也能不认、自己写名字带着照片收进来', async () => {
    const user = userEvent.setup()
    gardenService.identify.mockRejectedValue(rejectWith('CLOUD_NOT_CONSENTED'))
    gardenService.create.mockResolvedValue(entry({ id: 'new', name: '小白花' }))
    renderBook()
    await screen.findByText(/路上看到一朵/)
    await pickFromAlbum(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('照片会发给已配置的模型供应商')
    await user.click(screen.getByRole('button', { name: '自己写名字' }))
    const form = await screen.findByRole('form', { name: '自己写一株' })
    expect(within(form).getByRole('img', { name: '这株的照片' })).toHaveAttribute('src', 'blob:preview')
    await user.type(within(form).getByLabelText('名字'), '小白花')
    await user.click(within(form).getByRole('button', { name: '存下来' }))
    expect(gardenService.create).toHaveBeenCalledWith({ name: '小白花', scientificName: '', family: '', status: 'met', note: '' }, photos)
  })

  it('没同意云端时「去设置」真的去设置页', async () => {
    const user = userEvent.setup()
    gardenService.identify.mockRejectedValue(rejectWith('CLOUD_NOT_CONSENTED'))
    renderBook()
    await screen.findByText(/路上看到一朵/)
    await pickFromAlbum(user)
    await user.click(await screen.findByRole('button', { name: '去设置' }))
    expect(screen.getByText('设置页')).toBeInTheDocument()
  })

  it('模型这会儿不可用：照实说，可以再认一次', async () => {
    const user = userEvent.setup()
    gardenService.identify.mockRejectedValueOnce(rejectWith('LLM_UNAVAILABLE')).mockResolvedValueOnce(RESULT)
    renderBook()
    await screen.findByText(/路上看到一朵/)
    await pickFromAlbum(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('这会儿没认出来')
    await user.click(screen.getByRole('button', { name: '再认一次' }))
    expect(await screen.findByText('她说，很像是「栀子花」')).toBeInTheDocument()
    expect(gardenService.identify).toHaveBeenCalledTimes(2)
  })
})

describe('花草图鉴：看一株', () => {
  it('手写的名字、学名、要小心的、她的讲解；换成我养的；拿掉先确认', async () => {
    const user = userEvent.setup()
    gardenService.list.mockResolvedValue([entry({ identified: true, explanation: RESULT.explanation, caution: RESULT.caution, note: '楼下花坛' })])
    gardenService.update.mockImplementation((_id, fields) => Promise.resolve(entry({ ...fields, identified: true })))
    gardenService.remove.mockResolvedValue({ success: true })
    renderBook()

    await user.click(await screen.findByRole('button', { name: '栀子花，路上遇见' }))
    const detail = screen.getByRole('article', { name: '栀子花' })
    expect(within(detail).getByText('Gardenia jasminoides')).toBeInTheDocument()
    expect(within(detail).getByText('叶子和果实别让猫啃。')).toBeInTheDocument()
    expect(within(detail).getByText('花瓣厚、像蜡。')).toBeInTheDocument()
    expect(within(detail).getByText('楼下花坛')).toBeInTheDocument()

    await user.click(within(detail).getByRole('button', { name: '我养的' }))
    expect(gardenService.update).toHaveBeenCalledWith('p1', { status: 'grow' })

    await user.click(within(detail).getByRole('button', { name: '从图鉴拿掉' }))
    await user.click(screen.getByRole('button', { name: '拿掉' }))
    expect(gardenService.remove).toHaveBeenCalledWith('p1')
    expect(await screen.findByText(/路上看到一朵/)).toBeInTheDocument()
  })
})
