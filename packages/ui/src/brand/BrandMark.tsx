import type { SVGProps } from 'react'

/** 品牌朱砂。旧工作台的强调色还是紫色，所以这里先写死；等工作台换主题后改回 `var(--color-accent)`。 */
const VERMILION = '#DF500C'

const MARK_D =
  'M624.81 233.49L889.41 320.74A63 63 0 0 1 932.7 380.5L932.7 941.4A175 175 0 0 1 757.7 1116.4L443.1 1116.4A175 175 0 0 1 268.1 941.4L268.1 689.9A175 175 0 0 1 443.1 514.9L766.5 514.9L766.5 438.26L495.45 360.84ZM412.47 163.47L561.44 212.59L429.87 342.11L358.63 321.77A58.5 58.5 0 0 1 320.73 242.93L340.19 196.44A58.5 58.5 0 0 1 412.47 163.47ZM504.77 647L742.44 779.88A36 36 0 0 1 742.77 842.54L505.1 978.76A36 36 0 0 1 451.2 947.53L451.2 678.42A36 36 0 0 1 504.77 647Z'

/**
 * dramai 图形标：场记板形状的字母 d，字腔是播放三角。
 * 矢量版忠实于用户设计的位图原稿。宽高比 0.696，请只设置高度，宽度自动。
 */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="268.1 161.5 664.6 954.9"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="dramai"
      {...props}
    >
      <path fill={VERMILION} fillRule="evenodd" d={MARK_D} />
    </svg>
  )
}
