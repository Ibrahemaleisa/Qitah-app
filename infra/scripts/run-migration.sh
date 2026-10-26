#!/usr/bin/env bash
# Runs the Prisma migration task (one-off ECS Fargate task) and fails unless it exits 0.
#
# Usage: infra/scripts/run-migration.sh <cdk-outputs.json> <migrations-stack-name>
# Needs: aws CLI, jq; permissions ecs:RunTask (migration family), ecs:DescribeTasks,
#        iam:PassRole (migration roles), logs:GetLogEvents (migration log group).
set -euo pipefail

OUTPUTS="$1"
STACK="$2"
out() { jq -er --arg s "$STACK" --arg k "$1" '.[$s][$k]' "$OUTPUTS"; }

CLUSTER="$(out ClusterName)"
TASK_DEF="$(out MigrationTaskDefinitionArn)"
SUBNETS="$(out MigrationSubnets)"
SG="$(out MigrationSecurityGroup)"
LOG_GROUP="$(out MigrationLogGroup)"

echo "Running migrations: $TASK_DEF on $CLUSTER"
TASK_ARN="$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEF" \
  --launch-type FARGATE \
  --count 1 \
  --started-by "gh-${GITHUB_RUN_ID:-manual}" \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SG}],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)"

if [[ -z "$TASK_ARN" || "$TASK_ARN" == "None" ]]; then
  echo "::error::run-task did not start a task"
  exit 1
fi
echo "Task: $TASK_ARN"

# Waiter polls every 6s up to 100 times (10 minutes); retry once for long migrations.
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN" || aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"

DESC="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --output json)"
EXIT_CODE="$(jq -r '.tasks[0].containers[] | select(.name=="migrate") | .exitCode // "null"' <<<"$DESC")"
REASON="$(jq -r '.tasks[0].stoppedReason // ""' <<<"$DESC")"

TASK_ID="${TASK_ARN##*/}"
echo "---- migration log (${LOG_GROUP} migrate/migrate/${TASK_ID}) ----"
aws logs get-log-events --log-group-name "$LOG_GROUP" --log-stream-name "migrate/migrate/${TASK_ID}" \
  --start-from-head --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' || echo "(no log stream)"
echo "-----------------------------------------------------------------"

if [[ "$EXIT_CODE" != "0" ]]; then
  echo "::error::Migration task failed (exit=${EXIT_CODE}, reason=${REASON}). Services were NOT rolled."
  exit 1
fi
echo "Migrations applied successfully."
