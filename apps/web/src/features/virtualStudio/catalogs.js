// 虚拟化妆间 / 虚拟试衣间的静态选项目录。
// id 会作为 itemId 发送给生图接口，须满足契约：string 且 ≤64 字符。

export const MAKEUP_LOOKS = [
  {
    id: 'clear-daily',
    name: '清透日常妆',
    description: '轻薄底妆配奶茶色唇，提气色不抢戏。',
    tags: ['通勤', '素颜感'],
  },
  {
    id: 'peach-date',
    name: '蜜桃约会妆',
    description: '蜜桃色眼影叠水光唇，甜而不腻。',
    tags: ['约会', '甜系'],
  },
  {
    id: 'maple-autumn',
    name: '枫叶红棕妆',
    description: '红棕调眼影配同色系唇，秋冬氛围感。',
    tags: ['秋冬', '复古'],
  },
  {
    id: 'cool-olive',
    name: '冷萃橄榄妆',
    description: '低饱和绿棕眼影，消肿又显气质。',
    tags: ['通勤', '冷皮友好'],
  },
  {
    id: 'dewy-glow',
    name: '水光清透妆',
    description: '高光轻点，湿漉漉的光泽肌。',
    tags: ['拍照', '水光肌'],
  },
  {
    id: 'smoky-night',
    name: '微醺烟熏妆',
    description: '灰棕小烟熏配哑光唇，夜晚更有神。',
    tags: ['聚会', '浓颜'],
  },
]

export const FITTING_ITEMS = [
  {
    id: 'oat-cardigan',
    name: '燕麦色针织开衫',
    category: '上衣',
    description: '软糯垂坠，叠穿不挑人。',
  },
  {
    id: 'white-straight-jeans',
    name: '白色直筒牛仔裤',
    category: '下装',
    description: '高腰直筒版型，悄悄拉长比例。',
  },
  {
    id: 'black-slip-dress',
    name: '黑色吊带长裙',
    category: '连衣裙',
    description: '缎面垂感，单穿内搭都成立。',
  },
  {
    id: 'haze-blue-shirt',
    name: '雾霾蓝廓形衬衫',
    category: '上衣',
    description: '微宽松廓形，通勤休闲两相宜。',
  },
  {
    id: 'khaki-trench',
    name: '卡其色风衣',
    category: '外套',
    description: '经典双排扣，春秋的主力外套。',
  },
  {
    id: 'cream-beret',
    name: '奶白贝雷帽',
    category: '配饰',
    description: '软顶不压发型，点亮基础穿搭。',
  },
]
