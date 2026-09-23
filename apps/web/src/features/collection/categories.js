// 与服务端 collectionService.CATEGORIES 同一份清单；分类可以不选。
export const SHELVES = {
  wardrobe: {
    label: '衣柜',
    categories: ['上衣', '下装', '连衣裙', '外套', '鞋', '包', '配饰'],
    empty: '衣柜还空着。拍一张喜欢的衣服，或者把想买的链接贴进来。',
  },
  makeup: {
    label: '化妆间',
    categories: ['底妆', '眼妆', '唇妆', '护肤', '香水', '工具'],
    empty: '化妆间还空着。拍一下常用的那支口红，或者把想买的链接贴进来。',
  },
}

export const STATUS_LABELS = { want: '想要', have: '已有' }
