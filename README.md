# loop-collab-dashboard

MultiCA Loop Engineering「国庆七天乐」四任务 Agent 实时状态看板（像素办公室风）。

**在线地址**：https://mig-everything.github.io/loop-collab-dashboard/

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
