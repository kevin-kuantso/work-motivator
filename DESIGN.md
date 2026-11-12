---
name: 上班鼓励器
description: 温和、清晰的工作进度与日历工具
colors:
  brand-50: "#F0FDF4"
  brand-100: "#DCFCE7"
  brand-600: "#15803D"
  brand-700: "#166534"
  surface: "#FFFFFF"
  background: "#F8FAFB"
  border-subtle: "#E5E7EB"
  border-control: "#6B7280"
  text-900: "#1F2937"
  text-600: "#4B5563"
  text-500: "#6B7280"
  working-bg: "#DCFCE7"
  working-fg: "#166534"
  lunch-bg: "#E4F3DB"
  lunch-fg: "#25613B"
  lunch-fill: "#28734B"
  warning-bg: "#DFE3DA"
  warning-fg: "#2F3A29"
  before-bg: "#E4EDE3"
  before-fg: "#3C5340"
  after-bg: "#CCFBF1"
  after-fg: "#115E59"
  rest-bg: "#F3F4F6"
  rest-fg: "#4B5563"
  paid-bg: "#DDECE7"
  paid-fg: "#275C50"
  unpaid-bg: "#FFE4E6"
  unpaid-fg: "#9F1239"
  unpaid-stripe: "#FFF1F2"
  makeup-bg: "#EBEEDD"
  makeup-fg: "#515C2E"
  calendar-holiday-bg: "#A7F3D0"
  calendar-holiday-number: "#065F46"
typography:
  display:
    fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, PingFang SC, Noto Sans SC, system-ui, sans-serif'
    fontSize: 'clamp(32px, 12.5cqi, 56px)'
    fontWeight: 700
    lineHeight: 1.1
  title:
    fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, PingFang SC, Noto Sans SC, system-ui, sans-serif'
    fontSize: '16px'
  body:
    fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, PingFang SC, Noto Sans SC, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, PingFang SC, Noto Sans SC, system-ui, sans-serif'
    fontSize: '12px'
  numbers:
    fontFamily: 'Segoe UI, system-ui, Microsoft YaHei UI, PingFang SC, sans-serif'
rounded:
  sm: '6px'
  md: '8px'
  lg: '12px'
  full: '999px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '5': '24px'
  '6': '32px'
  '7': '48px'
components:
  button-primary:
    backgroundColor: '{colors.brand-600}'
    textColor: '{colors.surface}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '36px'
  button-primary-hover:
    backgroundColor: '{colors.brand-700}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.md}'
    padding: '0 16px'
    height: '36px'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text-900}'
    rounded: '{rounded.sm}'
    padding: '0 10px'
    height: '32px'
  status-card:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.lg}'
    padding: '24px'
---

# Design System: 上班鼓励器

## Overview

**Creative North Star: "温和的工作伙伴"**

界面温暖、轻松、鼓励，同时维持紧凑而易扫描的工作工具结构。突出实时数字和日历，状态色用于帮助辨认当前情境。

浅色卡片在主题色背景上轻微托起；按钮、表单和卡片友好而克制，不追求冷硬的企业感。

**Key Characteristics:**
- 自然绿、海洋蓝和暖橙主题，各自搭配协调的状态色。
- 数字突出，辅助信息紧凑清晰。
- 浅色卡片、柔和圆角和轻微阴影。
- 状态同时通过文字、形状和颜色表达。

## Colors

默认自然绿用于主要操作；可切换海洋蓝或暖橙。页面、面板、状态卡、日历和状态色共同随主题变化；状态始终辅以文字、图标或纹理区分。

### Primary
- **主题色**：主按钮、选中标签、焦点描边、开启的开关和今天的日期标记。每个主题提供浅色悬停底色及较深的强调色。
- **预设色板**（依次为 50 / 100 / 600 / 700）：自然绿 `#F0FDF4` / `#DCFCE7` / `#15803D` / `#166534`；海洋蓝 `#EFF6FF` / `#DBEAFE` / `#1D4ED8` / `#1E40AF`；暖橙 `#FFF7ED` / `#FFEDD5` / `#9A3412` / `#7C2D12`。
- **主题表面**（页面 / 面板 / 状态卡 / 普通日期格 / 设置标题）：自然绿 `#F8FAFB` / `#FFFFFF` / `#FFFFFF` / `#FFFFFF` / `#F8FAFB`；海洋蓝 `#E8F1FC` / `#F6FAFF` / `#EAF3FF` / `#EDF5FF` / `#E7F1FE`；暖橙 `#FBEEE2` / `#FFFAF5` / `#FFF0E2` / `#FFF3E8` / `#FCEBDB`。
- **工作状态**：状态胶囊、卡片顶线和进度填色随主题协调；绿、蓝、橙分别使用 `#DCFCE7` / `#166534`、`#D9EAFE` / `#1E40AF`、`#FFE1C7` / `#9A3412`（背景 / 前景）。

### Secondary
- **午休与提示**：午休卡片标记、顶线和进度条，以及资料不完整和备份提示，使用各主题协调的绿、蓝、橙色；状态和提醒以文字及图标表达。
- **下班与法定假日**：绿、蓝主题分别使用青绿与青蓝，暖橙主题使用橄榄色；假日日历格使用更浓的对应色。
- **其他状态**：未上班、带薪假、无薪假与调休分别使用主题协调的不同色对；无薪假日历格保留斜纹。错误仍使用易辨识的红色系。

### Neutral
- **浅色主题表面与中性色**：卡片与页面背景随主题变化；普通休息日使用低饱和中性色。
- **深色与次要文字**：蓝、橙主题的文字分别带冷色与暖色倾向。

## Typography

正文使用系统中文无衬线字体栈；部分数字及日期使用 Segoe UI / 系统字体栈。金额和日期使用等宽数字；动态数字格固定宽度，减少跳动。

- **金额**：大卡片容器内自适应（32px–56px，700，行高 1.1）；小窗为 40px。
- **指标**：大卡 20px、小窗 16px，字重 600。
- **页面标题**：18px、700、28px 行高。
- **正文**：14px、400、1.5 行高；标签与说明常用 12px。

## Layout

页面最大宽度 1600px，常规外边距为 12px 顶部、16px 两侧和底部。宽度至少 1000px 时，左侧状态卡固定 360px，右侧面板占余宽，两栏间距 16px；页面占满视窗高度。窄于 1000px 时改为上下排列，状态卡列最大宽 480px。

设置面板默认双栏，在面板容器不超过 760px 时改为单栏；桌面布局中的内容可在面板内部滚动。月历为七列网格、4px 间距；桌面行最小 40px，窄屏行最小 48px，图例和工具栏按可用空间换行，避免裁切。短视窗（高度不超过 640px）压缩卡片与设置区垂直间距。

窄屏设置提供工资、假期、备份和高级设置的分区跳转；常用按钮及撤销操作至少 44px 高。设置保存成功后短暂显示回执，失败时显示储存警告。月历保留「撤销上次标记」入口，导入或其他分页更改标记后撤销记录失效。

## Elevation & Depth

主要白色面板和状态卡以浅背景与轻微环境阴影分层；设置分组则主要依靠细边框和淡色卡头。

- **卡片阴影**：`0 1px 2px rgb(16 24 40 / .06), 0 1px 3px rgb(16 24 40 / .08)`。
- 小窗状态卡不使用阴影和圆角，以适应窗口本身。

## Shapes

卡片圆角 12px，按钮与设置分组 8px，输入框与日历格 6px；状态胶囊和进度轨道使用全圆角。边框以浅灰分隔内容，交互控件使用较深的灰色边框。

## Components

### Buttons

友好而克制。标准按钮至少高 36px，左右内边距 16px；主按钮绿底白字，悬停变深绿。次按钮白底灰边，悬停淡绿；幽灵按钮为次要文字色。小按钮分别至少高 28px 和 24px。

### Inputs and switches

输入框和选择框高 32px，白底、灰边、6px 圆角；错误状态以 2px 玫瑰色边框和文字说明表达。开关为 40×24px 圆角轨道，开启时为绿色，配可见文字状态。系统强制颜色模式下恢复原生选择框。

### Navigation

标签栏以细分隔线区分内容区域；标签高 32px，选中时使用深绿文字与 2px 绿色底线。悬停时文字加深。

### Cards and status

状态卡使用 24px 内边距、12px 圆角、浅阴影和顶部 3px 状态色条；状态胶囊高 24px。金额、倒数、进度条和两列指标按状态变化。进度条高 8px，圆角轨道。小窗卡片以 16px 内边距和较小数字适应空间。

### Calendar

七列日期格使用细边框与 6px 圆角；周末、假日、带薪假、无薪假和调休分别有语义底色与标记。今天使用圆形日期标识；窄日期格可隐藏农历，较窄视窗缩小标签字号。

### Interaction and motion

焦点默认以 2px 主题色轮廓呈现，日历格使用深色轮廓；状态与控件颜色变化通常为 120ms 或 200ms，缓动为 `cubic-bezier(.2,0,0,1)`。遵循减少动态偏好。

## Do's and Don'ts

### Do:
- **Do** 使用明确的文字与状态色共同表达工作、休假和错误。
- **Do** 为动态金额与日期保留稳定的数字宽度。
- **Do** 在窄屏及短视窗中保留可读性和可操作性。

### Don't:
- **Don't** 将界面改成冷硬的企业风格。
- **Don't** 仅靠颜色区分假期或错误状态。
