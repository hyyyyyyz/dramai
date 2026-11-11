// 在样式渲染前恢复用户选的主题，避免刷新时闪一下。外部文件：服务端的 CSP 不允许内联脚本。
// 工作台默认深色；存储不可用时也是深色。
var theme = 'dark'
try {
  var saved = localStorage.getItem('dramai.theme')
  if (saved === 'light' || saved === 'dark') theme = saved
} catch (e) {
  /* 存储不可用 */
}
document.documentElement.dataset.theme = theme
