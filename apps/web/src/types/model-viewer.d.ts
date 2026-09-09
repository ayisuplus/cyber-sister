// <model-viewer> 自定义元素的 JSX 类型声明（@google/model-viewer 以副作用 import 注册）。
// 仅声明本页用到的属性；完整属性表见 https://modelviewer.dev/docs/index.html
declare namespace JSX {
  interface IntrinsicElements {
    'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string
      'camera-controls'?: boolean | string
      'auto-rotate'?: boolean | string
    }
  }
}
