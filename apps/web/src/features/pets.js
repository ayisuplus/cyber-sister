// 内置的四只宠物（路线图 C17）。画在 public/design-assets/pets/<species>/，来源见同目录的 pets-assets.json。
// 每只都有 sleep / awake / happy / eat 四帧；小猫多一帧 stretch（本子角上摸久了伸懒腰）。
// 以后开了图片编辑，再让用户自定义宠物。

export const PET_SPECIES = [
  { id: 'cat', title: '小猫', defaultName: '团子', snack: '小鱼干' },
  { id: 'dog', title: '小狗', defaultName: '豆豆', snack: '小骨头' },
  { id: 'rabbit', title: '小兔', defaultName: '棉花', snack: '胡萝卜' },
  { id: 'hamster', title: '仓鼠', defaultName: '栗子', snack: '瓜子' },
]

export const speciesOf = (id) => PET_SPECIES.find((item) => item.id === id) ?? PET_SPECIES[0]

const EXTRA_FRAMES = { cat: ['stretch'] }

/** 某一帧的图。small=本子角上用的小图（264px），否则是宠物页的大图（640px）。没有的帧退回 happy。 */
export function petImage(species, frame, { small = false } = {}) {
  const base = ['sleep', 'awake', 'happy', 'eat']
  const name = base.includes(frame) || EXTRA_FRAMES[species]?.includes(frame) ? frame : 'happy'
  return `/design-assets/pets/${species}/${name}${small ? '-sm' : ''}.webp`
}

// 深夜 22 点到清晨 5 点，它在睡觉（照样可以轻轻摸）
export const isNight = (hour) => hour >= 22 || hour < 5

// 五颗心各自的门槛：和服务端 HEART_STEPS 一致，只用来画心，数值以服务端为准
export const HEART_STEPS = [10, 40, 90, 160, 250]
