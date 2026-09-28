#!/bin/bash
# poll_status.sh — 采集 MultiCA 四个 workspace 的 Agent/Issue/Run 实时状态，
# 生成 data/status.json，有变化则 commit + push（供 GitHub Pages 看板消费）。
# 依赖：multica CLI（已登录）、jq、git。
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.."
# 先同步远端（别人推过 main 时，本机提交不会再被拒；数据文件由本脚本重算，冲突时以远端为准后重算）
git pull -q --rebase --autostash 2>/dev/null || git rebase --abort 2>/dev/null || true
LOOP_COLLAB="${LOOP_COLLAB:-/Users/jordanzt/Work/HuaweiWork/A2H/Suvey/loop-collab}"
# 日报里的「总进度」来自 loop-collab：读之前先快进到最新（只快进、不改本地提交，失败不影响采集）
[ -d "$LOOP_COLLAB/.git" ] && git -C "$LOOP_COLLAB" pull -q --ff-only 2>/dev/null || true
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NOW_EPOCH=$(date -u +%s)

# workspace|task_id|任务名|机器hostname|机器显示名|daily目录
WS_LIST="ws-survey-loop|task1-survey|任务1 · 应用迁移综述|(Mac)|张涛 MacBook|task1-survey
ws-benchmark-loop|task2-benchmark|任务2 · 评测集与双端用例|oneplusndeMac-Studio.local|张涛 Mac Studio|task2-benchmark
ws-dw-migration-loop|task3-dw-migration|任务3 · DW 代码迁移|Snowball-in-Ca.local|奕棣 MacBook|task3-dw-migration
ws-ipd-eazo-loop|task4-ipd-eazo|任务4 · IPD Eazo 平台|admins-Mac-mini.local|贾博 Mac Mini|task4-ipd-eazo"

# 机器在线状态（runtime 表）
RUNTIMES=$(multica runtime list 2>/dev/null)
machine_online() { # $1=hostname 关键字；runtime 按工作区注册，除全局列表外再查当前工作区的列表（只会把误判的离线纠正为在线）
  printf '%s\n%s\n' "$RUNTIMES" "${WS_RUNTIMES:-}" | grep -F "$1" | grep -q online && echo true || echo false
}

TASKS_JSON="[]"
rm -f /tmp/dashboard-tasks.jsonl   # 防上次中断残留导致重复/陈旧任务混入
echo "$WS_LIST" | while IFS='|' read ws tid tname hostkey machine daily; do
  multica workspace switch "$ws" >/dev/null 2>&1
  WS_RUNTIMES=$(multica runtime list 2>/dev/null)
  AGENTS=$(multica agent list --output json 2>/dev/null || echo '[]')
  # issue 取「最新创建的 100 条」+「全部进行中」：默认按看板位置排序只取 30 条会漏掉新单（例如刚派的执行单）；老版本 CLI 不认排序参数时退到不排序的 100 条，再退到原取法
  ISSUES_NEW=$(multica issue list --limit 100 --sort created_at --direction desc --output json 2>/dev/null) \
    || ISSUES_NEW=$(multica issue list --limit 100 --output json 2>/dev/null) \
    || ISSUES_NEW=$(multica issue list --limit 30 --output json 2>/dev/null) || ISSUES_NEW='{"issues":[]}'
  ISSUES_RUN=$(multica issue list --status in_progress --limit 50 --output json 2>/dev/null) || ISSUES_RUN='{"issues":[]}'
  ISSUES=$(printf '%s\n%s\n' "$ISSUES_NEW" "$ISSUES_RUN" | jq -s '{issues: ([.[] | if type=="array" then .[] else (.issues // [])[] end] | unique_by(.id))}' 2>/dev/null) || ISSUES='{"issues":[]}'

  ONLINE=$(machine_online "$hostkey")

  # 会议检测：标题含 会/纪要 且 status=in_progress
  MEETING=$(echo "$ISSUES" | jq --argjson now "$NOW_EPOCH" '[.issues[] | select(.status=="in_progress") | select(.title | test("早会|午会|晚会|会议|纪要")) | select((((.last_activity_at // "") | sub("\\.[0-9]+Z$";"Z") | fromdateiso8601? ) // 0) > ($now - 4500))] | length > 0')
  MEETING_TITLE=$(echo "$ISSUES" | jq -r --argjson now "$NOW_EPOCH" '[.issues[] | select(.status=="in_progress") | select(.title | test("早会|午会|晚会|会议|纪要")) | select((((.last_activity_at // "") | sub("\\.[0-9]+Z$";"Z") | fromdateiso8601? ) // 0) > ($now - 4500))][0].title // ""')

  # 正在执行的 run → issue。优先按 agent 查（只查非空闲的，便宜且准确，也覆盖不在「进行中」的 issue）；
  # 老版本 CLI 的 agent tasks 不认 --limit 时去掉再取；没有 agent tasks 时回落到按进行中 issue 扫 runs（同一 issue 上多个 agent 并行时都要算上）
  ACTIVE=""
  if multica agent tasks --help 2>&1 | grep -q "agent tasks <"; then
    for aid in $(echo "$AGENTS" | jq -r '.[] | select(.status != "idle") | .id'); do
      R=$({ multica agent tasks "$aid" --limit 5 --output json 2>/dev/null || multica agent tasks "$aid" --output json 2>/dev/null; } | jq -r --arg a "$aid" '(if type=="array" then . else (.tasks // []) end) | [.[] | select(.completed_at==null and .started_at!=null)] | .[0] | if . then "\($a)|\(.issue_id)|\(.started_at)" else empty end' 2>/dev/null)
      [ -n "$R" ] && ACTIVE="$ACTIVE$R"$'\n'
    done
  else
    for key in $(echo "$ISSUES" | jq -r '.issues[] | select(.status=="in_progress") | .identifier' | head -8); do
      R=$(multica issue runs "$key" --output json 2>/dev/null | jq -r --arg k "$key" '.[] | select(.completed_at==null) | "\(.agent_id)|\($k)|\(.started_at // "")"' 2>/dev/null)
      [ -n "$R" ] && ACTIVE="$ACTIVE$R"$'\n'
    done
  fi

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
  # 用活跃 run 覆盖为 working 并附 issue（优先于 meeting；机器离线时保持离线）。since=本次 run 开始时间
  while IFS='|' read aid ref since; do
    [ -n "$aid" ] || continue
    IT=$(echo "$ISSUES" | jq -c --arg r "$ref" '[.issues[] | select(.id==$r or .identifier==$r)][0] // empty')
    [ -z "$IT" ] && [ -n "$ref" ] && IT=$(multica issue get "$ref" --output json 2>/dev/null | jq -c '(.issue // .) | {identifier, title}' 2>/dev/null)
    [ -n "$IT" ] || IT='{}'
    IKEY=$(echo "$IT" | jq -r '.identifier // ""'); TITLE=$(echo "$IT" | jq -r '.title // ""')
    AGENTS_OUT=$(echo "$AGENTS_OUT" | jq -c --arg aid "$aid" --arg k "$IKEY" --arg t "$TITLE" --arg s "$since" '
      [.[] | if .agent_id==$aid and .state!="offline" then . + {state:"working", issue:$k, issue_title:($t|.[0:60])} + (if $s!="" then {since:$s} else {} end) else . end]')
  done <<< "$ACTIVE"
  AGENTS_OUT=$(echo "$AGENTS_OUT" | jq -c '[.[] | del(.platform_status)]')

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

# 保护：采集失败（agent 全空 / 任务缺失 / id 重复）时回滚，不推送坏数据
AGENT_TOTAL=$(jq '[.tasks[].agents | length] | add // 0' data/status.json)
TASKS_N=$(jq '.tasks | length' data/status.json)
TASKS_UNIQ=$(jq '[.tasks[].id] | unique | length' data/status.json)
if [ "$AGENT_TOTAL" -eq 0 ] || [ "$TASKS_N" -ne 4 ] || [ "$TASKS_UNIQ" -ne 4 ]; then
  echo "[$NOW] ERROR: 采集不完整（agents=$AGENT_TOTAL tasks=$TASKS_N uniq=$TASKS_UNIQ），丢弃本次数据，保留上一版"
  git checkout -- data/status.json 2>/dev/null || true
  exit 1
fi

# 语义内容有变化才提交（忽略 generated_at 时间戳；不查 porcelain，因为 generated_at 必然让文件变脏）
OLD=$(git show HEAD:data/status.json 2>/dev/null | jq -S 'del(.generated_at)' 2>/dev/null)
NEW=$(jq -S 'del(.generated_at)' data/status.json)
if [ "$OLD" != "$NEW" ]; then
  git add data/status.json
  git commit --quiet -m "status: $NOW"
  if git push --quiet 2>/dev/null || { git pull -q --rebase --autostash 2>/dev/null && git push --quiet 2>&1; }; then echo "[$NOW] pushed"; else echo "[$NOW] PUSH FAILED（本地已 commit，下轮会带上去）" >&2; fi
else
  echo "[$NOW] no change"
fi
