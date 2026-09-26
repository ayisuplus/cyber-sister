// 「她这几天」每一行前的小画：守手帐小装饰的规矩（docs/02-设计/手帐装饰.md）——铅笔灰细线、圆头、略带手抖，
// 每幅只有一小块低饱和填色（鼠尾草绿 / 杏色 / 灰玫瑰）；纯装饰（aria-hidden），「小装饰：没有」时不出现。
// 线条颜色与填色都在 globals.css「手帐小装饰」一节，夜间跟着铅笔灰变色。

const PATHS = {
  // 回想：一弯杏色月亮，旁边一颗小星
  reflect: (
    <>
      <path className="fill-apricot" d="M13.6 4.2 C9.4 4.6 6.6 8.2 7.2 12.2 C7.8 15.9 11.4 18.3 15.2 17.4 C12.2 16.3 10.4 13.4 10.8 10.2 C11.1 7.6 12.1 5.6 13.6 4.2 Z" />
      <path d="M16.6 6.4 L16.6 8.6 M15.5 7.5 L17.7 7.5" />
    </>
  ),
  // 写信：信封，封口一颗灰玫瑰色的小心
  letter: (
    <>
      <path d="M3.6 6.4 C8 6.1 12.4 6.2 16.6 6.5 L16.4 15.6 C12 15.9 7.8 15.8 3.8 15.5 Z" />
      <path d="M3.9 6.7 C6.2 8.8 8.1 10.2 10.1 11 C12.2 10.1 14.2 8.6 16.3 6.8" />
      <path className="fill-rose" d="M10.1 13.6 C9.2 12.9 8.9 12.2 9.4 11.8 C9.8 11.5 10.1 11.9 10.1 11.9 C10.1 11.9 10.5 11.5 10.9 11.8 C11.3 12.2 11 12.9 10.1 13.6 Z" />
    </>
  ),
  // 你定了：一片鼠尾草色的小叶子，叶脉是一个勾
  decide: (
    <>
      <path className="fill-sage" d="M4.4 15.8 C4.2 9.6 8.6 5 15.8 4.4 C16.2 11.2 11.6 15.8 4.4 15.8 Z" />
      <path d="M7.4 10.8 L9.4 12.8 L13.2 8.2" />
    </>
  ),
  // 收起来：一块斜放的灰玫瑰色橡皮，擦过的一道
  tidy: (
    <>
      <path className="fill-rose" d="M5.2 12.6 L11.6 5.8 L15.6 9.6 L9.4 16.2 Z" />
      <path d="M7.6 10.2 L11.6 14" />
      <path d="M3.6 17.4 C5.4 17 7.6 17.2 9.8 17" />
    </>
  ),
  // 问了一句：鼠尾草色的小对话框，里面两个点
  ask: (
    <>
      <path className="fill-sage" d="M4.2 5.6 C8.4 5.2 12.4 5.3 16 5.8 C16.4 8.6 16.3 10.8 15.8 12.8 C13 13.1 10.6 13.1 8.6 13 L5.6 15.6 L6 12.8 C5 12.6 4.4 12.4 4.2 12 C3.9 9.8 3.9 7.6 4.2 5.6 Z" />
      <path d="M8.2 9.2 L8.3 9.3 M12 9.2 L12.1 9.3" />
    </>
  ),
  // 记下了：一支杏色铅笔，笔尖下一道线
  remember: (
    <>
      <path className="fill-apricot" d="M5 14.2 L13.4 5.6 L15.6 7.8 L7.2 16.4 L4.6 16.8 Z" />
      <path d="M12.2 6.8 L14.4 9" />
      <path d="M9.8 17.2 C12 16.9 14.4 17 16.4 16.8" />
    </>
  ),
  // 翻了书：摊开的书，杏色书页
  book: (
    <>
      <path className="fill-apricot" d="M10 6.2 C8 5 5.8 4.8 3.6 5.2 L3.8 15 C6 14.6 8.2 14.9 10 16 C11.8 14.9 14 14.6 16.2 15 L16.4 5.2 C14.2 4.8 12 5 10 6.2 Z" />
      <path d="M10 6.2 L10 15.8" />
    </>
  ),
  // 认了一株花草：一朵灰玫瑰色的小郁金香，茎上一片空心叶子
  plant: (
    <>
      <path className="fill-rose" d="M7 8.6 C6.6 6.2 7.4 4.4 8.6 3.8 L10 5.6 L11.4 3.8 C12.6 4.4 13.4 6.2 13 8.6 C12.4 10.2 11.2 10.8 10 10.8 C8.8 10.8 7.6 10.2 7 8.6 Z" />
      <path d="M10 10.8 C9.8 13 10 15 10.2 17.2" />
      <path d="M10.1 14.4 C11.4 12.6 13.4 12 15 12.2 C14.4 14 12.4 14.8 10.1 14.4 Z" />
    </>
  ),
}

export default function JournalDoodle({ kind }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-doodle={kind}
      className="decor decor-doodle journal-doodle"
    >
      {PATHS[kind] ?? PATHS.remember}
    </svg>
  )
}
