#!/bin/bash
# poll_status.sh — 采集 MultiCA 四个 workspace 的 Agent/Issue/Run 实时状态，
# 生成 data/status.json，有变化则 commit + push（供 GitHub Pages 看板消费）。
# 依赖：multica CLI（已登录）、jq、git。
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."
LOOP_COLLAB="${LOOP_COLLAB:-/Users/jordanzt/Work/HuaweiWork/A2H/Suvey/loop-collab}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NOW_EPOCH=$(date -u +%s)

# workspace|task_id|任务名|机器hostname|机器显示名|daily目录
WS_LIST="ws-survey-loop|task1-survey|任务1 · 应用迁移综述|(Mac)|张涛 MacBook|task1-survey
ws-benchmark-loop|task2-benchmark|任务2 · 评测集与双端用例|oneplusndeMac-Studio.local|张涛 Mac Studio|task2-benchmark
ws-dw-migration-loop|task3-dw-migration|任务3 · DW 代码迁移|Snowball-in-Ca.local|奕棣 MacBook|task3-dw-migration
ws-ipd-eazo-loop|task4-ipd-eazo|任务4 · IPD Eazo 平台|admins-Mac-mini.local|贾博 Mac Mini|task4-ipd-eazo"

# 机器在线状态（runtime 表）
RUNTIMES=$(multica runtime list 2>/dev/null)
machine_online() { # $1=hostname 关键字
  echo "$RUNTIMES" | grep -F "$1" | grep -q online && echo true || echo false
}

TASKS_JSON="[]"
echo "$WS_LIST" | while IFS='|' read ws tid tname hostkey machine daily; do
  multica workspace switch "$ws" >/dev/null 2>&1
  AGENTS=$(multica agent list --output json 2>/dev/null || echo '[]')
  ISSUES=$(multica issue list --limit 30 --output json 2>/dev/null || echo '{"issues":[]}')
  ISSUES=$(echo "$ISSUES" | jq '{issues:(.issues // .)}')

  ONLINE=$(machine_online "$hostkey")

  # 会议检测：标题含 会/纪要 且 status=in_progress
  MEETING=$(echo "$ISSUES" | jq '[.issues[] | select(.status=="in_progress") | select(.title | test("早会|午会|晚会|会议|纪要"))] | length > 0')
  MEETING_TITLE=$(echo "$ISSUES" | jq -r '[.issues[] | select(.status=="in_progress") | select(.title | test("早会|午会|晚会|会议|纪要"))][0].title // ""')

  # 活跃 run 检测：近 24h 内 in_progress 的非会议 issue，查 runs 里 completed_at==null
  ACTIVE_FILE=$(mktemp)
  echo '{}' > "$ACTIVE_FILE"
  for key in $(echo "$ISSUES" | jq -r '.issues[] | select(.status=="in_progress") | .identifier' | head -8); do
    RUNS=$(multica issue runs "$key" --output json 2>/dev/null || echo '[]')
    ACT=$(echo "$RUNS" | jq -r --arg k "$key" '[.[] | select(.completed_at==null)] | .[0] | if . then "\(.agent_id)|\($k)" else empty end')
    [ -n "$ACT" ] && echo "$ACT" >> "$ACTIVE_FILE.run"
  done

  # 组装 agents 状态
  AGENTS_OUT=$(echo "$AGENTS" | jq -c --argjson meeting "$MEETING" --argjson online "$ONLINE" '
    [.[] | {
      name: .name,
      emoji: (.avatar_url | sub("^emoji:";"")),
      role: (.description | split("：")[0] | .[0:30]),
      model: .model,
      agent_id: .id,
      platform_status: .status,
      state: (if $online|not then "offline"
              elif $meeting then "meeting"
              elif .status != "idle" then "working"
              else "idle" end),
      issue: "",
      issue_title: ""
    }]')
  # 用活跃 run 覆盖为 working 并附 issue（优先于 meeting）
  if [ -f "$ACTIVE_FILE.run" ]; then
    while IFS='|' read aid ikey; do
      TITLE=$(echo "$ISSUES" | jq -r --arg k "$ikey" '.issues[] | select(.identifier==$k) | .title' | head -1)
      AGENTS_OUT=$(echo "$AGENTS_OUT" | jq -c --arg aid "$aid" --arg k "$ikey" --arg t "$TITLE" '
        [.[] | if .agent_id==$aid then . + {state:"working", issue:$k, issue_title:($t|.[0:60])} else . end]')
    done < "$ACTIVE_FILE.run"
    rm -f "$ACTIVE_FILE.run"
  fi
  rm -f "$ACTIVE_FILE"
  AGENTS_OUT=$(echo "$AGENTS_OUT" | jq -c '[.[] | del(.agent_id, .platform_status)]')

  # issue 统计与最新动态
  COUNTS=$(echo "$ISSUES" | jq -c '{todo:([.issues[]|select(.status=="backlog" or .status=="todo" or .status=="unstarted")]|length),
    in_progress:([.issues[]|select(.status=="in_progress")]|length),
    in_review:([.issues[]|select(.status=="in_review")]|length),
    done:([.issues[]|select(.status=="done" or .status=="completed")]|length)}')
  LATEST=$(echo "$ISSUES" | jq -c '[.issues | sort_by(.updated_at) | reverse | .[0:5][] | {key:.identifier, title:(.title|.[0:50]), status, updated_at}]')

  # 进度：loop-collab 日报里最新「总进度：NN%」
  PROG=""
  if [ -d "$LOOP_COLLAB/daily/$daily" ]; then
    LATEST_MD=$(ls "$LOOP_COLLAB/daily/$daily"/2*.md 2>/dev/null | sort | tail -1)
    [ -n "$LATEST_MD" ] && PROG=$(grep -oE '总进度[：:][^0-9]{0,3}[0-9]+' "$LATEST_MD" | grep -oE '[0-9]+' | head -1)
  fi
  PROG=${PROG:-0}

  jq -n --arg id "$tid" --arg title "$tname" --arg ws "$ws" --arg machine "$machine" \
        --argjson online "$ONLINE" --argjson meeting "$MEETING" --arg meeting_title "$MEETING_TITLE" \
        --argjson progress "$PROG" --argjson agents "$AGENTS_OUT" \
        --argjson counts "$COUNTS" --argjson latest "$LATEST" \
        '{id:$id,title:$title,workspace:$ws,machine:$machine,machine_online:$online,
          meeting_active:$meeting,meeting_title:$meeting_title,progress:$progress,
          agents:$agents,issue_counts:$counts,latest_issues:$latest}' \
    >> /tmp/dashboard-tasks.jsonl
done

rm -f /tmp/dashboard-tasks-combined.json
jq -s --arg now "$NOW" '{generated_at:$now, tasks:.}' /tmp/dashboard-tasks.jsonl > data/status.json.tmp \
  && mv data/status.json.tmp data/status.json
rm -f /tmp/dashboard-tasks.jsonl

# 保护：采集失败（agent 全空）时回滚，不推送坏数据
AGENT_TOTAL=$(jq '[.tasks[].agents | length] | add // 0' data/status.json)
if [ "$AGENT_TOTAL" -eq 0 ]; then
  echo "[$NOW] ERROR: 采集为空（multica 不可用？），丢弃本次数据，保留上一版"
  git checkout -- data/status.json 2>/dev/null || true
  exit 1
fi

# 语义内容有变化才提交（忽略 generated_at 时间戳）
OLD=$(git show HEAD:data/status.json 2>/dev/null | jq -S 'del(.generated_at)' 2>/dev/null)
NEW=$(jq -S 'del(.generated_at)' data/status.json)
if [ "$OLD" != "$NEW" ] || [ -n "$(git status --porcelain data/status.json scripts 2>/dev/null)" ]; then
  git add data/status.json
  git commit --quiet -m "status: $NOW"
  git push --quiet 2>/dev/null || git push
  echo "[$NOW] pushed"
else
  echo "[$NOW] no change"
fi
