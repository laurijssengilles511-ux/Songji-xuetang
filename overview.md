# 创建界面 UI 重设计

## 修改内容
- 将「智慧创建」与「手动添加卡片」从原本混在同一长列中的两个区块，改为**顶部 Tab 切换**的两种创建方式，显著缩短左侧表单长度。
- 默认展示「手动添加」Tab（保持原有使用习惯），「智慧创建」作为 AI 亮点 Tab，使用 ✨ 图标 + AI 徽章突出大模型自动解析 Markdown 的能力。
- 「智慧创建」面板重新包装为独立卡片：顶部展示「AI 解析学习资料」标题、说明文案和 Markdown → 问答卡标签，强化功能定位。
- 「手动添加」面板保留原有正反面输入、Cloze / 图片工具和底部操作按钮组，视觉层级更清晰。

## 涉及文件
- `create.html`：用 `.create-tabs` 包裹两种创建方式，调整智慧创建的 HTML 结构。
- `styles.css`：新增 `.create-tabs`、`.create-tab-header`、`.create-tab-label`、`.create-tab-panel`、`.smart-create-card` 等样式，并调整原有 `.smart-create-section` 相关选择器以匹配新结构。

## 约束
- 未改动任何 JavaScript 逻辑或原有按钮/输入框 ID，原有事件绑定与功能保持不变。
- Tab 切换采用纯 CSS radio 实现，不引入新的 JS 逻辑。
