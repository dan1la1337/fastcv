#!/usr/bin/env bash
# Ревью раунда: scripts/design-eval/review.sh <раунд> [claude|codex|both] [суффикс повтора, например -2]
# Команды заданы постановкой. Каждый запуск — новый процесс из папки пакета.
set -u
round="$1"; who="${2:-both}"; suffix="${3:-}"
work="$(cd "$(dirname "$0")/../.." && pwd)/../fastcv-ui-climb/round-$round"
cd "$work/pack" || exit 1
mkdir -p ../scores

run_claude() {
  claude -p "$(cat brief.md)" --model claude-opus-5-5 --effort xhigh --tools Read --permission-mode dontAsk --setting-sources "" --strict-mcp-config --no-session-persistence --output-format text < /dev/null > "../scores/claude$suffix.md" 2> "../scores/claude$suffix.err"
  echo "claude$suffix exit $?"
}
run_codex() {
  codex exec --sandbox read-only --skip-git-repo-check --ephemeral -c model_reasoning_effort=xhigh --color never --image "$(find . -name '*.png' | paste -sd, -)" -o "../scores/codex$suffix.md" < brief.md > "../scores/codex$suffix.log" 2>&1
  echo "codex$suffix exit $?"
}

[ "$who" != codex ] && run_claude &
[ "$who" != claude ] && run_codex &
wait
