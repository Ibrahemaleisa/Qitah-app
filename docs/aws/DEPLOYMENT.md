# Qitah on AWS: deployment and operations runbook

This runbook covers infrastructure-as-code in [`infra/`](../../infra) (AWS CDK v2, TypeScript), the API image
([`services/api/Dockerfile`](../../services/api/Dockerfile)) and CI/CD in
[`.github/workflows/`](../../.github/workflows).

For why the default region is `eu-central-1`, and the plan to move into the Saudi region, see
[REGION_DECISION.md](REGION_DECISION.md).

> **State:** validated by `cdk synth`, 81 assertion tests and cdk-nag. **It has not yet been deployed to a real
> account.** Read the [production-readiness gate](#11-production-readiness-gate) before onboarding real customers.

---

## 1. Architecture

```
                 Customers (Expo app)   Merchants / Ops (browsers)
                         |                         |
                         v                         v
  CloudFront (*.cloudfront.net TLS, WAF in prod)   Amplify Hosting (Next.js SSR: portals/merchant, portals/ops)
                         |  + secret header X-Qitah-Origin-Verify       |  server-side calls to API_BASE_URL
                         v                                              |
  ALB (public subnets; SG = CloudFront origin-facing prefix list only; default 403)
                         |
                         v
  ECS Fargate (private subnets):  api (node dist/main.js, /ready health)   worker (node dist/worker.js)
          |            |               |                                          |
          |            |               +---> SQS jobs queue (+DLQ, KMS) <---------+
          |            +---> S3 uploads bucket (SSE-KMS, presigned PUT/GET, merchants/*, shipping-labels/*)
          v
  RDS PostgreSQL 16 (isolated subnets, KMS, force_ssl, Multi-AZ prod, PITR + AWS Backup)

  Cognito: customers pool (phone + SMS OTP) · staff pool (email, TOTP MFA)
  Secrets Manager: qitah/<env>/db (RDS-generated), qitah/<env>/app (webhook secrets), qitah/<env>/origin-verify
```

### Stacks per environment

CLI ids are `Qitah-<env>/<Stack>`; CloudFormation stack names are `Qitah-<env>-<Stack>`.

| Stack | Contents | Deployed by |
| --- | --- | --- |
| `GithubOidc` | GitHub OIDC provider and the least-privilege deploy role `qitah-<env>-github-deploy` | **Admin, once** (see §3) |
| `Network` | VPC: 2 AZs; public, app (private-with-egress) and data (isolated) subnets. NAT gateways (1 in staging, 1 per AZ in production). S3 gateway endpoint; interface endpoints in production. Flow logs. **All** security groups | CI |
| `Data` | KMS key, RDS, uploads and logs buckets, SQS + DLQ, app secret, AWS Backup plan | CI |
| `Auth` | Cognito pools, groups, app clients | CI |
| `Platform` | ECR repository (scan on push, immutable tags), ECS cluster (Container Insights) | CI (first step) |
| `Migrations` | Task definition `qitah-<env>-migrate` running `npx prisma migrate deploy` | CI |
| `Edge` (us-east-1) | WAF web ACL for CloudFront; optional portal IP allow-list ACL | CI. Only created when WAF or the allow-list is enabled |
| `Api` | ALB, CloudFront, API and worker services, autoscaling, log groups | CI |
| `Monitoring` | SNS alarm topic, alarms, dashboard, log metric filters, AWS Budgets | CI |
| `Hosting` | Amplify apps and branches for both portals | CI, only when `DEPLOY_HOSTING=true` |

**Deploy order inside CI:**

1. `Platform`
2. build and push the image
3. `Migrations`
4. **run the migration task**
5. `Api` + `Monitoring` (+ `Hosting`)

Migrations therefore run **before** the services roll to new code (expand/contract, see §9).

---

## 2. Environment isolation

**Recommended setup: two AWS accounts** (for example `qitah-staging` and `qitah-production` under AWS
Organizations, with IAM Identity Center for people).

| Concern | How it is isolated |
| --- | --- |
| Blast radius / IAM | Separate accounts. Each has its own GitHub OIDC provider and deploy role. The staging role cannot touch production. |
| GitHub | Two GitHub environments. `production` needs required reviewers and accepts only the `environment:production` OIDC subject. |
| Network | Separate VPCs (`10.20.0.0/16` staging, `10.30.0.0/16` production), so peering stays possible later. |
| Data | Separate KMS keys, RDS instances, buckets, queues and Cognito pools. Never copy production personal data into staging. |
| Images | Built once in staging, then **promoted** (copied by digest) into the production ECR. Production never builds images. |
| Cost | Separate budgets. In separate accounts the bill is naturally split. |

**Same-account option** (cheaper, weaker isolation). Every resource name already includes the environment.
Make these changes:

1. In `config/production.ts`, set `github.existingOidcProviderArn` to the provider created by staging, because an
   account can hold only one GitHub OIDC provider.
2. Set `budget.filterByEnvironmentTag: true` in both configs, and activate the `Environment` cost-allocation tag.
3. In `config/production.ts`, set `compute.promoteFromRepositoryArn` to the staging repository in the same account.

---

## 3. One-time bootstrap (per AWS account)

Do this as an administrator through IAM Identity Center, with short-lived credentials. **Do not create IAM users
or access keys.**

### 3.1 CDK bootstrap with a scoped CloudFormation execution policy

By default, `cdk bootstrap` gives the CloudFormation execution role **AdministratorAccess**. Replace it with
[`infra/bootstrap/cfn-execution-policy.json`](../../infra/bootstrap/cfn-execution-policy.json). That policy:

- limits IAM to `Qitah-*` / `qitah-*` roles;
- denies any change to the GitHub deploy role and the OIDC provider, so the pipeline cannot widen its own rights;
- denies IAM users and access keys.

```bash
export ACCOUNT=<12-digit id> REGION=eu-central-1
cd infra && npm ci

aws iam create-policy --policy-name QitahCdkCfnExecution \
  --policy-document file://bootstrap/cfn-execution-policy.json

# us-east-1 is needed for the WAF web ACL used by CloudFront (production, or staging with WAF on).
npx cdk bootstrap "aws://$ACCOUNT/$REGION" "aws://$ACCOUNT/us-east-1" \
  --cloudformation-execution-policies "arn:aws:iam::$ACCOUNT:policy/QitahCdkCfnExecution" \
  --termination-protection
```

**Trust policy:** the bootstrap roles (`cdk-hnb659fds-{deploy,file-publishing,image-publishing,lookup}-role-*`)
trust the same account by default. That is all this design needs: the GitHub deploy role lives in the same account
and is allowed to assume them. Add `--trust <tooling-account-id>` only if you later deploy from a separate tooling
account.

If you change the qualifier, set `cdkQualifier` in both configs.

### 3.2 GitHub OIDC deploy role (admin, plain CloudFormation)

The execution policy deliberately blocks CDK from modifying the deploy role. Deploy this one stack directly with
your admin session:

```bash
cd infra
npx cdk synth -c env=staging -c stagingAccount=$ACCOUNT --quiet
aws cloudformation deploy --region $REGION \
  --stack-name Qitah-staging-GithubOidc \
  --template-file cdk.out/assembly-Qitah-staging/QitahstagingGithubOidc*.template.json \
  --capabilities CAPABILITY_NAMED_IAM
aws cloudformation describe-stacks --region $REGION --stack-name Qitah-staging-GithubOidc \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text
```

Repeat with `env=production` / `productionAccount=` in the production account.

- If the account already has `token.actions.githubusercontent.com` registered, set
  `github.existingOidcProviderArn` in that environment's config first.
- **Repository casing matters.** The trust policy uses `StringEquals` on
  `repo:Ibrahemaleisa/Qitah-app:<subject>`. GitHub puts the repository's canonical owner/name in the token
  exactly as shown on github.com. If the casing differs, edit `github.repository` in `infra/config/*.ts`.
  Subjects:
  - staging: `ref:refs/heads/main`, `environment:staging`
  - production: `environment:production` only

What the deploy role can do (and nothing else):

| Permission | Scope |
| --- | --- |
| `sts:AssumeRole`, `sts:TagSession` | `cdk-<qualifier>-{deploy,file-publishing,image-publishing,lookup}-role-<account>-*` |
| ECR push/pull | `repository/qitah/<env>/api`. `ecr:GetAuthorizationToken` must use `*` because it has no resource-level support |
| ECR pull for promotion (production) | `compute.promoteFromRepositoryArn` (the staging repository) |
| `ecs:RunTask` | `task-definition/qitah-<env>-migrate:*`, with the condition `ecs:cluster = qitah-<env>` |
| `ecs:DescribeTasks`, `ecs:StopTask` | `task/qitah-<env>/*` |
| `iam:PassRole` | `qitah-<env>-migrate-task` and `-migrate-exec`, with the condition `iam:PassedToService = ecs-tasks.amazonaws.com` |
| `ecs:UpdateService`, `ecs:DescribeServices` | `service/qitah-<env>/qitah-<env>-{api,worker}` |
| `logs:GetLogEvents`, `logs:FilterLogEvents` | `/qitah/<env>/migrate` |
| `cloudformation:DescribeStacks` | `stack/Qitah-<env>-*` |

### 3.3 Cross-account image promotion (two-account setup)

1. In `infra/config/staging.ts`, set `compute.ecrPullAccountIds: ['<production account id>']`. Staging's next
   deploy adds the repository policy.
2. In `infra/config/production.ts`, set
   `compute.promoteFromRepositoryArn: 'arn:aws:ecr:<region>:<staging account>:repository/qitah/staging/api'`.
3. Redeploy the production `GithubOidc` stack (§3.2) so the role gets the pull permission.

### 3.4 GitHub configuration

Configure under *Settings → Environments*. Everything here is an id or ARN. **No secrets are needed**, because
OIDC replaces keys.

| Environment | Protection | Variables |
| --- | --- | --- |
| `staging` | Deployment branches: `main` | `AWS_ACCOUNT_ID`, `AWS_REGION` (e.g. `eu-central-1`), `AWS_DEPLOY_ROLE_ARN` (output of §3.2). Optional: `ALARM_EMAIL`, `DEPLOY_HOSTING` (`true` once the Amplify token exists), `FAIL_ON_CRITICAL_CVES` (default `true`) |
| `production` | **Required reviewers** (at least 1, not the person who triggered the run). Prevent self-review. Deployment branches: `main` | Same as staging, plus `PROMOTE_FROM_REPOSITORY_URI` (e.g. `<staging account>.dkr.ecr.eu-central-1.amazonaws.com/qitah/staging/api`) |

Also recommended:

- branch protection on `main` that requires the `CI` checks;
- restricting *Actions → General* to "allow actions by GitHub and verified creators", plus the SHA-pinned actions
  used here.

---

## 4. Secrets setup

Secrets never appear in plain environment variables or in templates. ECS injects them from Secrets Manager, and
Amplify and CloudFront read them through CloudFormation dynamic references.

| Secret | Created by | What you must do |
| --- | --- | --- |
| `qitah/<env>/db` | RDS (generated) | Nothing. It holds `username`, `password`, `host`, `port` (plus `engine`, `dbInstanceIdentifier`). Optional rotation: §8.4 |
| `qitah/<env>/app` | `Data` stack | `PAYMENT_WEBHOOK_SECRET` is generated. **`CARRIER_WEBHOOK_SECRET` starts empty on purpose**, and the API refuses to boot until it is set (fail-closed). Set both to the providers' real values before go-live |
| `qitah/<env>/origin-verify` | `Api` stack | Nothing. To rotate: put a new value, then redeploy the `Api` stack (CloudFront and the ALB rule update together) |
| `qitah/<env>/amplify-github-token` | **You** | GitHub token for Amplify (external blocker) |
| `qitah/staging/amplify-basic-auth` | **You** (staging) | `{"username":"…","password":"…"}` used to password-protect staging portals |

```bash
# After the Data stack exists (first deploy, §5), set the webhook secrets.
# For staging/sandbox, random values are fine:
aws secretsmanager put-secret-value --secret-id qitah/staging/app --secret-string \
  "{\"PAYMENT_WEBHOOK_SECRET\":\"$(openssl rand -hex 32)\",\"CARRIER_WEBHOOK_SECRET\":\"$(openssl rand -hex 32)\"}"

# Amplify GitHub access (classic PAT scopes: repo, admin:repo_hook; or a fine-grained token with
# Contents: read, Webhooks: read/write on this repo). Prefer a bot account.
aws secretsmanager create-secret --name qitah/staging/amplify-github-token --secret-string '<token>'
aws secretsmanager create-secret --name qitah/staging/amplify-basic-auth \
  --secret-string '{"username":"qitah","password":"<long random>"}'
```

After the apps exist, you can switch Amplify from the token to the Amplify GitHub App in the Amplify console.

---

## 5. First deploy (per environment)

1. Complete §3 (bootstrap, deploy role, GitHub environment variables).
2. **Create the data layer and set the webhook secrets.** The API will not start with an empty
   `CARRIER_WEBHOOK_SECRET`. As an admin:
   ```bash
   cd infra && npx cdk deploy Qitah-staging/Data -c env=staging -c stagingAccount=$ACCOUNT
   aws secretsmanager put-secret-value --secret-id qitah/staging/app --secret-string '…'   # see §4
   ```
3. Trigger **Deploy staging**, either by merging to `main` or through *Actions → Deploy staging → Run workflow*.
   It deploys Platform, pushes the image, deploys Migrations, migrates, deploys Api and Monitoring, waits for the
   services to be stable, then runs the smoke test.
4. **Confirm the SNS email subscription** (link in the alarm email). Until you do, alarms go nowhere.
5. Activate the cost-allocation tags `Project`, `Environment`, `CostCenter` and `Owner` under
   *Billing → Cost allocation tags*. They appear about 24 h after the first tagged resource exists.
6. Set up SMS for Cognito (external blocker, see §5.1).
7. **Portals:** create the Amplify token secret (§4), set `DEPLOY_HOSTING=true`, then rerun the workflow. The
   portals need `portals/merchant` and `portals/ops` on the tracked branch:
   - staging tracks `main`;
   - production tracks `production` (create it, protect it, and fast-forward it to promote).
8. **EAS (customer app):** set the API URL per EAS environment. Staging uses `preview`, production uses
   `production`:
   ```bash
   eas env:create --environment preview    --name EXPO_PUBLIC_API_BASE_URL --value https://<staging-domain> --visibility plaintext
   eas env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://<prod-domain>    --visibility plaintext
   eas build --profile staging    # or: --profile production
   ```
   `<…-domain>` is the `ApiBaseUrl` output of `Qitah-<env>-Api` (a `d…cloudfront.net` name until a custom domain
   exists).
9. **Production:** repeat steps 1–7 in the production account. Then dispatch **Deploy production** with a SHA that
   is green in staging. A required reviewer must approve before AWS is touched.
   - Production starts with `ALLOW_SANDBOX_IN_PRODUCTION=false`. The API will **refuse to boot** while the payment
     and carrier providers are sandbox-only. That is intended (see §11).

### 5.1 SMS for Saudi phone numbers (Cognito customer pool), an external blocker

Cognito sends OTPs through Amazon SNS / AWS End User Messaging SMS in the pool's region. Before real customers can
sign in:

1. **Leave the SMS sandbox.** In the sandbox, SMS only reaches verified destination numbers. Request production
   access in the console under *AWS End User Messaging SMS* (or SNS → Text messaging) for the account and region.
2. **Register a Saudi sender ID** (*Registrations → Create registration → Saudi Arabia*):
   - 3–11 alphanumeric characters (e.g. `QITAH`);
   - **transactional only** (no promotional content);
   - a **letter of authorization/NOC for Vodafone**;
   - proof of brand rights if the name is not obviously yours.

   AWS lists about **45 days** for processing. Sender IDs are one-way, and Saudi long codes cannot send. See the
   [AWS registration guide](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-saudi-arabia.html).
3. **Raise the account's monthly SMS spend limit.** The default is very low.
4. Set the default sender ID and message type (Transactional) for the account and region. Monitor delivery with
   CloudWatch SMS metrics.
5. Until all of this is done, staging can use verified sandbox numbers only.

---

## 6. Day-to-day deploys

- **Staging:** every push to `main`. The image tag is the git SHA, and tags are immutable.
- **Production:** *Actions → Deploy production → Run workflow* with `image_tag = <40-char SHA on main>`. The
  workflow then:
  - checks out that same commit, so the infra and migrations match the code;
  - copies the image from staging ECR by digest;
  - shows `cdk diff`;
  - waits for reviewer approval (environment protection), then migrates, deploys, waits for stability and runs
    the smoke test.
- **Manual local commands** (admin session, optional):
  ```bash
  cd infra
  npx cdk synth -c env=staging -c stagingAccount=$ACCOUNT -c imageTag=<sha>        # no credentials needed
  npx cdk diff  'Qitah-staging/*' -c env=staging -c stagingAccount=$ACCOUNT -c imageTag=<sha>
  ```
  Never deploy a synth made without `-c imageTag` (it warns and uses `image-tag-not-set`).

---

## 7. Cost estimate (rough, monthly, USD, eu-central-1 on-demand)

**Assumptions:**

- low pre-launch traffic: under 1 M API requests per month and under 50 GB egress;
- 730 h per month;
- no Savings Plans or Reserved Instances;
- SMS and Amplify build minutes depend on usage and are excluded.

Verify with the AWS Pricing Calculator. Prices change and differ by region.

| Item | Staging | Production |
| --- | --- | --- |
| NAT gateways (1 / 2) + data | ~40 | ~80 |
| Interface endpoints (0 / 5 × 2 AZ) | 0 | ~90 |
| ALB | ~22 | ~30 |
| Fargate: API (0.5 vCPU/1 GB × 1 / 1 vCPU/2 GB × 2) + worker | ~31 | ~105 |
| RDS: t4g.micro single-AZ, 20 GB / t4g.medium **Multi-AZ**, 50 GB | ~18 | ~135 |
| Backups beyond the free allowance (PITR + AWS Backup) | ~2 | ~15 |
| CloudWatch (logs, Container Insights, alarms, dashboard, flow logs) | ~18 | ~40 |
| CloudFront + S3 + SQS + KMS + Secrets Manager | ~8 | ~25 |
| WAF (ACL + 4 rules + requests + logs) | 0 (off) | ~15 |
| Amplify Hosting (2 SSR apps, light traffic) | ~5 | ~15 |
| Cognito (Essentials: first 10k MAU free) | ~0 | ~0–50 |
| **Total (approx.)** | **~145–190** | **~550–620** |

The default budgets are USD 250 (staging) and USD 900 (production). Alerts go to the alarm topic at 50 %, 80 %
and 100 % of actual **and** forecast spend.

**Levers:**

- Graviton (`compute.cpuArchitecture: 'ARM64'`) is about 20 % cheaper on Fargate. Build the image for
  `linux/arm64`.
- A Compute Savings Plan and RDS Reserved Instances save about 30–40 % once traffic is steady.
- Drop the production interface endpoints if NAT data stays small.
- Scale staging to zero outside working hours (set the desired count to 0).

---

## 8. Backup and restore

**What exists:**

- RDS automated backups with point-in-time recovery (PITR): 7 days in staging, 30 days in production;
- an AWS Backup daily plan: 14 days in staging, 35 days in production, with optional cross-region copy
  (`backup.crossRegionCopyVaultArn`);
- S3 versioning on the uploads bucket;
- snapshot-on-delete and deletion protection in production.

**Targets to agree with the business:** RPO ≤ 5 min (PITR) and RTO ≤ 1 h for production.
**Run a restore drill every quarter and before launch.**

### 8.1 Point-in-time restore of RDS to a new instance

1. **Declare the incident and freeze writes if possible:** scale the API to 0 or put up a maintenance message.
   **Also freeze CI deploys of the `Data` stack** (see the warning in step 6).
2. Pick the restore time (UTC), just before the bad event. Then restore into the **same subnet group, security
   group and parameter group**:
   ```bash
   SRC=$(aws cloudformation describe-stacks --stack-name Qitah-production-Data \
         --query "Stacks[0].Outputs[?OutputKey=='DbInstanceId'].OutputValue" --output text)
   aws rds describe-db-instances --db-instance-identifier "$SRC" \
     --query 'DBInstances[0].[DBSubnetGroup.DBSubnetGroupName,VpcSecurityGroups[0].VpcSecurityGroupId,DBParameterGroups[0].DBParameterGroupName]'
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier "$SRC" \
     --target-db-instance-identifier qitah-production-restore-$(date +%Y%m%d%H%M) \
     --restore-time 2026-11-02T10:41:00Z \
     --db-subnet-group-name <subnet group> --vpc-security-group-ids <db sg> \
     --db-parameter-group-name <parameter group> \
     --multi-az --no-publicly-accessible --copy-tags-to-snapshot --deletion-protection \
     --enable-performance-insights
   aws rds wait db-instance-available --db-instance-identifier qitah-production-restore-…
   ```
   The restored instance keeps the KMS key and the master credentials of the source at that point in time.
3. **Verify the data before cut-over:** see the checklist in §8.3.
4. **Cut over by updating the secret, then redeploying:**
   ```bash
   NEW_HOST=$(aws rds describe-db-instances --db-instance-identifier qitah-production-restore-… \
              --query 'DBInstances[0].Endpoint.Address' --output text)
   aws secretsmanager get-secret-value --secret-id qitah/production/db --query SecretString --output text \
     | jq --arg h "$NEW_HOST" '.host = $h' > /tmp/db.json
   aws secretsmanager put-secret-value --secret-id qitah/production/db --secret-string file:///tmp/db.json && rm /tmp/db.json
   for s in qitah-production-api qitah-production-worker; do
     aws ecs update-service --cluster qitah-production --service $s --force-new-deployment
   done
   aws ecs wait services-stable --cluster qitah-production --services qitah-production-api qitah-production-worker
   ```
   ECS reads secrets only at task start, which is why the forced deployment is needed. If the password differs
   (rotation happened after the restore point), also update `password`.
5. Smoke-test (`infra/scripts/smoke-test.sh https://<api>`), lift the maintenance mode, and watch the alarms.
6. **Reconcile the IaC before the next `Data` deploy.** CloudFormation still manages the *old* instance. Its
   secret attachment would rewrite `host` back to the old endpoint on the next `Data` deployment. Choose one:
   - **(a)** Snapshot the restored instance, then make a planned change to restore it as the CDK-managed instance:
     a code change to `rds.DatabaseInstanceFromSnapshot` in a maintenance window.
   - **(b)** If the old instance is healthy and the restore was only for data recovery, copy the recovered rows
     back into it (`pg_dump --data-only` for the affected tables) and delete the restored instance.

   Keep the old instance (deletion protection on) until reconciliation is done.

### 8.2 Restore from AWS Backup

*AWS Backup → Backup vaults → `qitah-<env>-vault` → recovery point → Restore.* Set:

- DB instance identifier: a new name;
- the subnet group, security group and parameter group from §8.1;
- Multi-AZ on, public access off.

Then continue at §8.1 step 3. For **S3 objects**, restore earlier versions:

```bash
aws s3api list-object-versions --bucket <uploads bucket> --prefix merchants/<id>/
aws s3api copy-object --copy-source '<bucket>/<key>?versionId=<id>' --bucket <bucket> --key <key>
```

### 8.3 Verification checklist (fill in during every drill and every real restore)

- [ ] `prisma migrate status` on the restored DB shows no pending or failed migrations. Run the migration task with
      a command override: `aws ecs run-task … --overrides '{"containerOverrides":[{"name":"migrate","command":["npx","prisma","migrate","status"]}]}'`.
      Do this after the secret switch in a drill environment, or against the restored host in staging.
- [ ] Row counts and latest timestamps for orders, payments, ledger entries, shipments and users match expectations
      for the restore time.
- [ ] The ledger balances: sums per account / suspense equal zero, as the API's finance checks expect.
- [ ] `/ready` returns 200 through CloudFront, and the worker log shows `qitah worker started` with no `job loop error`.
- [ ] Sign-in works for customers and staff (Cognito is not affected by an RDS restore).
- [ ] A sandbox checkout completes, and webhooks are accepted (the signature secrets are unchanged).
- [ ] Alarms are green for 30 minutes. Record the RPO/RTO you achieved and any lessons in the incident record.

### 8.4 Optional credential rotation

Set `database.rotationDays` to add a Secrets Manager single-user rotation Lambda. After each rotation, run tasks
still hold the old password in memory and new connections would fail. **Force a new deployment of the api and
worker right after each rotation:** schedule both together, or add an EventBridge rule on
`RotationSucceeded → ecs:UpdateService`. Until that automation exists, rotation is off by default.

---

## 9. Rollback

### Application

1. **Automatic:** both services use the ECS deployment circuit breaker with rollback. If new tasks fail to reach a
   healthy state (ALB `/ready` for the API, process exit for the worker), ECS returns to the previous task
   definition and CloudFormation marks the deploy as failed.
2. **Manual, production:** dispatch **Deploy production** with the **previous good SHA**. The image is already in
   ECR (immutable tags, the lifecycle keeps the last 100), so the redeploy takes minutes.
3. **Manual, staging:** `git revert` the bad commit on `main`, which redeploys automatically.
4. **Emergency** (pipeline down): with an admin session, run `aws ecs update-service --cluster qitah-<env>
   --service qitah-<env>-api --task-definition <previous revision>`, and the same for the worker. Afterwards
   re-align CloudFormation by deploying the previous SHA.

### Database (Prisma) migration strategy

Prisma migrations are **forward-only**: there is no automatic down migration. Rolling the code back is safe only if
the schema is still compatible with the old code. Therefore:

- **Expand/contract:**
  1. **Expand:** additive changes only, such as new nullable columns or new tables, deployed with code that
     tolerates both shapes.
  2. Backfill.
  3. Switch reads and writes.
  4. **Contract:** drop old columns in a **later** release, once no deployed version uses them.
- **No destructive migrations without a written plan.** This covers `DROP COLUMN`/`TABLE`, renames, type narrowing,
  and `NOT NULL` without a default. The plan needs a backup point (§8), a reviewer, the expected lock time, and a
  forward fix.
- Watch for locks on large tables. Set `SET lock_timeout = '5s'` in risky migrations, and prefer
  `CREATE INDEX CONCURRENTLY` in a dedicated migration.
- **A failed migration stops the deploy before the services roll** (the CI step exits non-zero). To recover:
  1. Fix the migration forward in a new commit.
  2. If Prisma recorded the migration as failed, mark it with
     `npx prisma migrate resolve --rolled-back <name>`. Run it as a one-off migration task with a command override,
     after confirming the DB state.
  3. Redeploy.
- If data was damaged, restore with PITR (§8.1) rather than writing ad-hoc down-SQL.

### Infrastructure

CloudFormation rolls a failed stack update back automatically. To revert a bad infrastructure change, deploy the
previous commit. Production `Data` resources are `RETAIN` or `SNAPSHOT`, and the stack has termination
protection, so an accidental delete does not destroy data.

---

## 10. Monitoring and alert response

- **Dashboard:** `qitah-<env>-overview`.
- **Alarms** go to SNS `qitah-<env>-alarms` (email). Each alarm also sends an OK notification when it clears.
- **Logs:** CloudWatch `/qitah/<env>/{api,worker,migrate}`. Retention is 30 days in staging and 90 days in
  production. The API logs pino JSON; `level` 50 means error and 60 means fatal.

| Alarm | Meaning | First actions |
| --- | --- | --- |
| `alb-5xx-rate`, `target-5xx` | The API returns 5xx (ALB-level 5xx means no healthy targets or a timeout) | Check `api-error-logs`, the recent deploy and RDS health. Roll back (§9) if it started with a deploy |
| `unhealthy-hosts` | Tasks failing `/ready`, which checks the DB | Check RDS connectivity and connection count, and the secrets. Look at stopped-task reasons in ECS |
| `p95-latency` | Slow responses | RDS CPU, slow-query log (`log_min_duration_statement=1000`), Performance Insights top SQL, autoscaling at max? |
| `api-cpu` / `api-memory` | Saturation | Autoscaling should react. Raise `maxTasks` or the task size, and look for hot endpoints |
| `worker-not-running` | No worker task: outbox relay, reservations and jobs stall | Look at stopped-task reasons, usually a bad config or secret. Redeploy |
| `worker-error-logs` / `api-error-logs` | Error-level log lines | Logs Insights: `fields @timestamp, msg, err.message \| filter level >= 50 \| sort @timestamp desc` |
| `rds-cpu`, `rds-freeable-memory` | DB pressure | Performance Insights. Consider a larger instance class (config change plus deploy, which causes a Multi-AZ failover blip) |
| `rds-free-storage` | Storage low despite autoscaling | Raise `maxAllocatedStorageGiB`. Check for table bloat |
| `rds-connections` | Too many connections | Prisma's pool is `num_cpus*2+1` per process by default. Set `DB_CONNECTION_LIMIT` and cap task counts |
| `jobs-dlq-messages` | Jobs failed `maxReceiveCount` times | Inspect the messages (`aws sqs receive-message`), fix the cause, then redrive with `start-message-move-task` |
| `jobs-oldest-message` | Backlog | Is the worker running? Is a consumer erroring? |
| Budget 50/80/100 % | Spend trend | Use Cost Explorer grouped by the `Environment` / `CostCenter` tags. Look at NAT data and log volume first |

---

## 11. Production-readiness gate

Do not open production to real customers until every item is checked and signed off.

- [ ] **Cognito wired end to end.**
  - The API verifies tokens from **both** pools. *Today the API checks a single issuer* (`COGNITO_USER_POOL_ID`,
    set from `auth.apiPrimaryPool`), so a small API change is needed to accept the ids in
    `COGNITO_USER_POOL_IDS`.
  - The mobile app uses the customer pool (USER_AUTH + SMS OTP).
  - The portals use the staff pool, and the ops portal checks the `ops` group.
- [ ] **Real payment provider** integrated (PSP contract, webhooks verified, refunds, settlement), and sandbox
      disabled: `ALLOW_SANDBOX_IN_PRODUCTION=false` with `PAYMENT_PROVIDER` set to the real provider.
- [ ] **Carrier contracts** signed and the real carrier adapter integrated, with production
      `CARRIER_WEBHOOK_SECRET` values in `qitah/production/app`.
- [ ] **SMS:** out of the sandbox, Saudi sender ID approved, spend limit raised (§5.1).
- [ ] **Domain:** `api.<domain>` with an ACM certificate in us-east-1 (`edge.customDomain`). Optionally
      `edge.originTls` for TLS on the CloudFront → ALB hop. Portal custom domains set in Amplify, and CORS origins
      updated in `storage.uploadCorsOrigins` / `app.corsOrigins`.
- [ ] **WAF on** (`edge.wafEnabled`, the production default), and rate limits tuned against real traffic.
- [ ] **Alarms subscribed:** the SNS email is confirmed, an on-call rotation exists, and a pager or chat
      integration is added.
- [ ] **Backup restore tested:** a §8 drill completed and RPO/RTO recorded.
- [ ] **Penetration test** of the API, portals and app by a third party; findings fixed.
- [ ] **PDPL review:**
  - transfer basis and risk assessment documented;
  - privacy policy published;
  - registration in the National Register of Controllers if required;
  - retention schedule;
  - breach runbook;
  - region decision re-confirmed ([REGION_DECISION.md](REGION_DECISION.md)).
- [ ] **Least-privilege DB user** for the app: today the app uses the RDS master user. Create an app role with DML
      only, and keep DDL for migrations.
- [ ] Consider strict TLS verification to RDS: set `DB_SSL_ROOT_CERT` to the RDS CA bundle baked into the image,
      after testing it with Prisma.
- [ ] **Cognito Plus** (threat protection) decision recorded.
- [ ] Cost-allocation tags activated; budgets reviewed.

---

## 12. Local development

See the root [README](../../README.md#backend-api-local-docker): `docker compose up --build` starts Postgres 16,
runs the migrations, then starts the API on <http://localhost:4000> and the worker, all with sandbox providers and
local auth.
