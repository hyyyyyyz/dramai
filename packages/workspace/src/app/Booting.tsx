/** 第一次进来时，匹配到的那个页面还在下载：先给一个空白占位，不要闪出别的东西。 */
export function Booting() {
  return <div aria-busy className="min-h-dvh bg-background" />
}
