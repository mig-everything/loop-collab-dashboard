# loop-collab-dashboard

MultiCA Loop Engineering「国庆七天乐」四任务 Agent 实时状态看板（像素办公室风）。

**在线地址**：https://mig-everything.github.io/loop-collab-dashboard/

## 两个版本

- **像素办公室版**（`index.html`，默认）：一整层办公楼——研究室（任务1）、评测实验室（任务2）、迁移工坊（任务3）、产品工作室（任务4），中间是前台大厅、茶水间和休息区。右侧团队栏合并了成员状态、进度、issue 计数与最新动态，场景下方是四队最新动态。
  - 人物：工作中坐在自己工位打字（屏幕亮起，名牌旁显示当前 issue 编号）；会议中去会议桌、主持人站在白板旁；巡检时在队友身后转；休息时喝咖啡、坐沙发、打乒乓、看公告，夜里在座位打盹；机器离线时房间压暗、成员不在场。
  - 阶段：任务3 的传送带读执行单标题「[DW迁移任务单] <App> 迁移 · <阶段> · …」，箱子停在当前工序；任务4 的角色接力条按正在跑 run 的角色亮起；任务1/2 没有显式阶段，只展示看板计数与各人手上的 issue。
  - 气泡文字全部来自 `data/status.json`（当前 issue、执行单进度、run 已跑时长、团队进度、下一场例会等）。
  - 操作：滚轮/双指缩放、拖动平移、双击房间聚焦、点人物或团队卡看详情；窄屏默认列表视图。
  - 代码：`js/office-map.js`（平面图）、`js/office-sprites.js`（素材与道具绘制）、`js/office.js`（场景引擎）、`js/app.js`（数据与界面）。素材来源与许可见 `assets/pixel/CREDITS.md`。
  - 调试参数（只影响本地浏览）：`?sim=秒数` 预跑动画、`?cam=x,y,缩放` 定镜头、`?debug=1` 导出人物状态、`?data=data/xxx.json` 读同站其他数据文件。
- **经典版**（`classic.html`）：原来的 2×2 四象限看板，两个版本顶栏里都能互相切换。以后改经典版请改 `classic.html`。

## 这是什么

一个 2×2 四象限的实时看板，每个象限对应一个 Loop 任务的「像素办公室」：

| 象限 | 任务 | 执行机 |
|---|---|---|
| 左上 | 任务1 · 应用迁移综述 | 张涛 MacBook |
| 右上 | 任务2 · 评测集与双端用例 | 张涛 Mac Studio |
| 左下 | 任务3 · DW 代码迁移 | 奕棣 MacBook |
| 右下 | 任务4 · IPD Eazo 平台 | 贾博 Mac Mini |

每个房间里的 Agent 以像素角色呈现，根据实时状态播放不同动画：

- **working** — 坐在工位打字，屏幕闪光，头顶气泡显示当前 Issue
- **meeting** — 会议进行中（每日 04:00 / 12:00 / 20:00），全员围坐会议桌，💬 气泡浮动
- **idle** — 休息中，沙发上 Zzz
- **offline** — 机器离线，房间压暗 + 灰度

另有：任务进度条（红→黄→绿渐变）、Issue 统计（待办/进行/评审/完成）、最近 5 条 Issue 动态、机器在线状态灯、数据更新时间（北京时间）与 60 秒自动刷新倒计时。

**点击跳转 MultiCA**：任务标题 → `multica.ai/<workspace>/issues`（Issue 列表）；Agent 角色 → `multica.ai/<workspace>/agents/<uuid>`（Agent 详情）；Issue 动态与 working 气泡 → `multica.ai/<workspace>/issues/<编号>`（Issue 详情，如 SUR-36）。均新标签页打开（需已登录 MultiCA）。

## 架构

```
MultiCA CLI ──poll──> scripts/poll_status.sh ──生成──> data/status.json ──push──> GitHub
                                                                                      │
浏览器 <──每60s fetch data/status.json── GitHub Pages (index.html 纯静态, 无构建) <──┘
```

- **采集端**：`scripts/poll_status.sh` 在张涛 MacBook 上由 launchd 每 3 分钟执行一次（`com.migeverything.dashboardpoller`），通过 `multica` CLI 拉取四个 workspace 的 Agent 状态、活跃 Run、会议 Issue、Issue 统计，并从 [loop-collab](https://github.com/mig-everything/loop-collab) 日报解析「总进度 %」；有变化才 commit push。
- **展示端**：`index.html` 单文件（CSS/JS 全内联，零外部依赖），GitHub Pages 托管。

## 运维

```bash
# 手动采集一次
bash scripts/poll_status.sh

# 查看轮询日志
tail /tmp/dashboard-poller.log

# 启停定时任务
launchctl unload ~/Library/LaunchAgents/com.migeverything.dashboardpoller.plist
launchctl load   ~/Library/LaunchAgents/com.migeverything.dashboardpoller.plist
```

灵感来源：[OpenClaw-bot-review](https://github.com/xmanrui/OpenClaw-bot-review) 的 Pixel Office。
