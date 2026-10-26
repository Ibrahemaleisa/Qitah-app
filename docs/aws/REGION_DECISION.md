# AWS region and data-residency decision — Qitah (قطعة)

*Status: proposed · Researched 2026-10-26 · Owner: platform · Revisit by: 2027-01-31 or when the AWS Saudi Arabia region reaches GA*

> **Not legal advice.** This document lists regulatory facts and open questions. Have qualified Saudi counsel
> confirm them before launch, and before the move into the Kingdom described below.

## Recommendation

1. **Production: `eu-central-1` (Frankfurt) as the interim launch region.** It is the nearest healthy AWS
   region that runs every service Qitah uses (RDS PostgreSQL 16, ECS Fargate, Cognito, Amplify Hosting, SQS,
   KMS, Secrets Manager, AWS Backup). Before launch, document a PDPL cross-border transfer basis (safeguards
   plus a risk assessment).
2. **Staging: `eu-central-1`** as well, in a separate AWS account, so that staging uses the same services and
   quotas as production.
3. **Plan to move production into the AWS Saudi Arabia region** once all of these are true:
   - the region is GA;
   - the services listed in the matrix below are confirmed there;
   - SDAIA's draft in-Kingdom storage rule is final.

   The move is a config change plus a data migration (see [Migration path](#migration-path-to-the-saudi-region)).
   Do not use `me-central-1` or `me-south-1` for new workloads while AWS is advising customers to leave them.

The region is a config value: `region` in `infra/config/staging.ts` / `production.ts`. You can override it per
deploy with `-c stagingRegion=` / `-c productionRegion=`, or set it through the `AWS_REGION` GitHub environment
variable used by the deploy workflows.

## 1. Is an AWS Saudi Arabia region available today?

**No. As of 2026-10-26 it is announced but not generally available.**

- AWS first announced a Saudi Arabia region in March 2024, with a planned investment of more than USD 5.3 bn.
  The region is being built with HUMAIN, a PIF-owned company. ([About Amazon][aa], [SPA][spa])
- At its most recent update (reported 1–2 Sep 2026), AWS said the region is **"on track to launch in
  December 2026"**. ([SPA][spa], [Asharq Al-Awsat][aawsat], [TechAfrica News][techafrica], [Channel Insider][ci])
- Independent trackers dated July and October 2026 still list it as *announced, not launched*.
  ([Vision2030.ai][v2030], [Alventara][alventara])
- **Region code:** AWS has not published one. Some third-party sites use `me-central-2` and even claim a
  January 2026 go-live, but that contradicts AWS's own December 2026 timeline. Treat `me-central-2` as
  **unconfirmed**. ([dcpulse][dcpulse], [a9it][a9it])
- Service list: unknown until launch. New AWS regions usually open with core compute, storage and database
  services, and add others over the following months. **Do not assume Cognito or Amplify Hosting on day one.**

## 2. State of the existing Middle East regions (material in 2026)

| Region | Status (Oct 2026) | Source |
| --- | --- | --- |
| `me-central-1` (UAE) | Drone strikes on 1 Mar 2026 damaged facilities. AZ `mec1-az2` was hit; `mec1-az3` was impaired by a power problem. AWS's 15 Sep update says it is **unable to restore access to resources and data hosted only in `mec1-az2`**. EC2 launches are throttled, and AWS **strongly recommends migrating accessible resources to other regions**. | [DCD][dcd1], [DCD][dcd2], [Capacity][capacity], [webhosting.today][wht], [CloudNews][cloudnews] |
| `me-south-1` (Bahrain) | A facility was damaged on 1–2 Mar 2026. Reported to be in a worse state than UAE, and largely unavailable since April (secondary source). | [Cybersecurity News][csn], [DC Knowledge][dck], [CloudNews][cloudnews] |

Workloads that ran across several AZs were reportedly unaffected by the initial strike ([DC Knowledge][dck]).
However, the regions' ability to run customer applications reliably is currently impaired. A marketplace that
holds payments and orders cannot accept that risk at launch.

## 3. Service availability matrix

| Service (as used by Qitah) | `eu-central-1` Frankfurt | `me-central-1` UAE | `me-south-1` Bahrain | AWS Saudi region |
| --- | --- | --- | --- | --- |
| RDS for PostgreSQL 16 (Multi-AZ, PI) | Yes | Yes (region impaired) | Yes (region impaired) | TBC at GA |
| ECS on Fargate | Yes | Yes (impaired, EC2 throttled) | Yes (impaired) | TBC at GA |
| Amazon Cognito user pools | Yes | Yes, added 2024 ([GR][cognito-gr], [tracker][cognito-tr]). An unverified report says same-region SES email is not selectable ([re:Post][cognito-ses]) | Yes | **Likely later than GA** |
| Amplify Hosting (WEB_COMPUTE / SSR) | Yes | **No.** Not in the 20 Amplify Hosting regions ([AWS, May 2025][amplify-regions]; [re:Post][amplify-repost]) | Yes (listed) | **Likely later than GA** |
| SQS, KMS, Secrets Manager, CloudWatch, AWS Backup | Yes | Yes | Yes | TBC (core services, usually at GA) |
| CloudFront + WAF | Global. The WAF web ACL for CloudFront lives in `us-east-1` | Same | Same | Same |
| CloudFront standard logs to an S3 bucket in-region | Yes | **No** (opt-in region) | **No** | TBC |
| AWS Budgets | Global (billing) | Same | Same | Same |
| SNS SMS to Saudi numbers (Cognito OTP) | Yes, with sender-ID registration | Yes | Yes | TBC |

*Verification note:* The AWS documentation and regional-services pages could not be fetched directly from this
build environment. The table is based on the AWS announcements and community sources cited above. **Before the
first production deploy, confirm each row on the AWS Regional Services List and on each service's
"endpoints and quotas" page.**

## 4. Saudi regulatory considerations (facts to confirm with counsel)

### 4.1 Personal Data Protection Law (PDPL) and transfers outside the Kingdom

- The PDPL applies to processing personal data of people in the Kingdom. Qitah processes customer names, phone
  numbers, addresses, order history, merchant KYC documents and payout details, so it is a controller under the
  PDPL. ([Securiti overview][securiti-pdpl])
- **Transfer Regulation (revised 1 Sep 2024).** Transfers outside KSA are allowed:
  - to countries or sectors that SDAIA assesses as adequate; or
  - with appropriate safeguards (standard contractual clauses, binding common rules, or accreditation
    certificates).

  A transfer risk assessment is required:
  - before transfers that rely on safeguards; and
  - for continuous or large-scale transfers of sensitive data.

  As of early 2025 SDAIA had not published an adequacy list. SDAIA issued a Risk Assessment Guideline in
  Feb 2025. ([Dentons][dentons], [Securiti — transfer regulation][securiti-transfer], [Clyde & Co][clyde-2025])
- **Pending change (material to this decision).** SDAIA opened a public consultation on draft amendments to the
  PDPL Implementing Regulations. It runs from **6 Oct to 5 Nov 2026**.
  - Draft Article 23(2) adds an **express requirement for controllers to store personal data within the
    Kingdom**.
  - It still allows transfers and disclosures abroad "in accordance with the Law".
  - Commentators call the wording ambiguous, and it may change before adoption.

  ([Clyde & Co][clyde-2026], [Reed Smith][reedsmith], [Al Tamimi][tamimi])

  **Implication:** hosting outside KSA is defensible today with safeguards and a risk assessment, but may need to
  change if the draft is adopted. That is why the plan above includes the move to the Saudi region.

Before launch, Qitah should complete these PDPL actions:

- Record the transfer basis. Use the AWS Data Processing Addendum, and confirm with counsel which SDAIA safeguard
  applies.
- Complete and file the transfer risk assessment.
- Register in SDAIA's National Register of Controllers if required.
- Publish a privacy policy that discloses processing outside KSA.
- Set up breach-notification runbooks.

### 4.2 NCA Essential Cybersecurity Controls (ECC-2:2024) and Cloud Cybersecurity Controls (CCC-2:2024)

- **Scope.** The ECC applies to government entities, to Critical National Infrastructure operators, and to their
  providers. The CCC extends the ECC for cloud service providers and tenants in scope. A private B2C marketplace
  is **likely out of mandatory scope** unless it serves government or CNI customers. Even so, the ECC is a
  sensible control baseline. ([Netskope][netskope], [bishernp][bishernp])
- **Localisation.** According to several secondary sources, CCC-2:2024 **removed** the earlier sub-controls that
  required cloud services to be delivered from inside the Kingdom (2-3-P-1-10 / 2-3-P-1-11). Localisation now
  sits with SDAIA's National Data Management Office (NDMO). ([alskyline][alskyline], [governancedocs][govdocs],
  [grcvantage][grcvantage])
- **What this design already covers in ECC/CCC terms:**
  - encryption at rest with customer-managed KMS keys;
  - TLS in transit, including `rds.force_ssl=1`;
  - least-privilege IAM;
  - centralised logging with retention, VPC flow logs and WAF;
  - backups, with a restore runbook;
  - MFA for staff;
  - no long-lived credentials.

### 4.3 SAMA (payments)

- SAMA's Cloud Computing Regulatory Framework applies to **SAMA-regulated entities**: banks, insurers, finance
  companies, payment service providers and fintechs. Secondary sources say it requires highly sensitive data,
  payment processing environments and BCP backups to stay **in-Kingdom**. ([Kiteworks][kiteworks-sama],
  [MomentumX][momentumx]; vendor sources, so verify against SAMA's own text)
- **Qitah's position.** Qitah plans to use licensed payment providers (mada, Apple Pay, cards, STC Pay, Tabby,
  Tamara) and never stores card data. As long as the licensed PSP handles collection and settlement, Qitah itself
  should not be SAMA-regulated.
- **Open question for counsel:** a marketplace that collects money from customers and pays it out to merchants may
  count as payment activity. If Qitah holds funds or itself becomes a PSP or payment facilitator, SAMA's in-Kingdom
  hosting expectations would apply to the payment environment. In that case, move to the Saudi region before
  taking that role.
- PCI DSS scope stays with the PSP. Use hosted fields or redirect flows only.

## 5. Options compared

| Option | Latency to KSA users (estimate, measure before launch) | Service coverage | Resilience in 2026 | Regulatory fit |
| --- | --- | --- | --- | --- |
| `me-central-1` UAE | Lowest (~20–40 ms) | Good, but no Amplify Hosting | **Impaired. AWS advises leaving** | Cross-border (GCC) |
| `me-south-1` Bahrain | Lowest (~15–30 ms) | Good (Amplify yes) | **Severely impaired** | Cross-border (GCC) |
| **`eu-central-1` Frankfurt** | ~80–110 ms | **Complete** | Mature, 3 AZs | Cross-border. The EU GDPR regime is close to the PDPL model (safeguards are still required) |
| `ap-south-1` Mumbai | ~50–70 ms | Complete | Mature | Cross-border. Different legal regime (India DPDP) |
| AWS Saudi region | Best | **Unknown until GA** (Dec 2026 target) | New region | **Best (in-Kingdom)** |

The API is not latency-critical: catalogue and checkout calls are a few hundred ms end to end. CloudFront
`PriceClass_200` includes Middle East edge locations, so TLS terminates close to users.

## 6. Migration path to the Saudi region

The infrastructure has no hard-coded region. AZ names are derived from the region, and the CloudFront prefix list
is looked up at deploy time. The move is:

1. **Check service coverage.** Confirm the matrix in §3 for the new region code. Run
   `npx cdk synth -c productionRegion=<code>` and bootstrap CDK in the new region.
2. **Deploy the new stack set** with `-c productionRegion=<code>`. Use a new stage, or a new account if preferred.
3. **Move the data:**
   - **RDS:** copy an encrypted snapshot cross-region (use a KMS key in the target region), then restore it. For
     a near-zero-downtime cutover, use AWS DMS or logical replication instead.
   - **S3:** use S3 Batch Replication, or `aws s3 sync`, from the uploads bucket.
   - **Cognito:** user pools are regional and **passwords cannot be exported**.
     - Customers sign in with SMS OTP, so re-create them by phone number. They simply receive a code on next
       sign-in.
     - For staff and merchants, use a *user migration Lambda trigger* or a forced password reset.
4. **Cut over:**
   - point `EXPO_PUBLIC_API_BASE_URL` (EAS) and the custom domain at the new CloudFront distribution;
   - freeze writes during the final sync;
   - decommission the old region after the retention period.
5. **If Amplify Hosting or Cognito is missing at GA:**
   - Host the Next.js portals as containers on the same ECS cluster behind CloudFront. The portals already run
     server-side, so this is simple.
   - Keep Cognito in the interim region temporarily, and record it as a disclosed transfer: phone numbers and
     emails are personal data.

## Sources

[aa]: https://www.aboutamazon.com/news/aws/aws-cloud-region-saudi-arabia
[spa]: https://www.spa.gov.sa/en/w2665748
[aawsat]: https://english.aawsat.com/technology/5313287-aws-launch-first-cloud-infrastructure-region-saudi-arabia-december
[techafrica]: https://techafricanews.com/2026/09/01/aws-first-saudi-arabia-cloud-region-december-2026/
[ci]: https://www.channelinsider.com/infrastructure/news-aws-cloud-region-launch-emea-saudi-arabia/
[v2030]: https://vision2030.ai/sectors/technology/saudi-arabia-cloud-regions/
[alventara]: https://alventara.io/en/insights/aws-migration-saudi-arabia
[dcpulse]: https://dcpulse.com/project/aws-saudi-arabia-region-launch-jan
[a9it]: https://a9it.com/aws-me-central-2-saudi-arabia-region/
[dcd1]: https://www.datacenterdynamics.com/en/news/aws-uae-outage-after-objects-struck-the-data-center-cause-fire-amid-iran-attacks/
[dcd2]: https://www.datacenterdynamics.com/en/news/aws-unable-to-restore-access-to-data-centers-hit-by-iran-strikes/
[capacity]: https://capacityglobal.com/news/aws-cannot-restore-access-to-data-centre-and-data-zone/
[wht]: https://webhosting.today/2026/09/17/aws-cannot-restore-access-to-data-kept-only-in-bahrain-or-one-uae-zone/
[cloudnews]: https://cloudnews.tech/aws-tells-gulf-customers-to-migrate-workloads-after-months-of-data-center-damage/
[csn]: https://cybersecuritynews.com/aws-middle-east-services-disrupted/
[dck]: https://www.datacenterknowledge.com/outages/aws-middle-east-outage-after-data-center-hit-by-unidentified-objects
[cognito-gr]: https://docs.aws.amazon.com/general/latest/gr/cognito.html
[cognito-tr]: https://awsfundamentals.com/regions/service/amazon-cognito
[cognito-ses]: https://repost.aws/questions/QUiDxIjPJiRayxbaGQj4AyTA/cannot-select-me-central-1-ses-for-cognito-email-configuration-despite-production-access-in-same-region
[amplify-regions]: https://aws.amazon.com/about-aws/whats-new/2025/05/aws-amplify-hosting-customizable-build-instances/
[amplify-repost]: https://repost.aws/questions/QUCA--R1TiR42oUzkByAvkhg/amplify-in-me-central-1
[securiti-pdpl]: https://securiti.ai/saudi-arabia-personal-data-protection-law/
[securiti-transfer]: https://securiti.ai/regulation-on-personal-data-transfer-outside-the-kingdom/
[dentons]: https://www.dentons.com/en/insights/alerts/2025/may/15/saudi-arabias-framework-for-cross-border-data-transfers
[clyde-2025]: https://clydeco.com/en/insights/2025/02/10-legal-updates-ksa-tech-and-data-laws
[clyde-2026]: https://www.clydeco.com/en/insights/2026/10/sdaia-publishes-draft-amendments-to-the-pdpl
[reedsmith]: https://www.reedsmith.com/our-insights/blogs/viewpoints/102o5at/sdaia-consults-on-extensive-amendments-to-the-saudi-pdpl-implementing-regulation/
[tamimi]: https://www.tamimi.com/news/sdaia-opens-public-consultation-on-proposed-amendments-to-the-pdpl-implementing-regulation/
[netskope]: https://www.netskope.com/blog/achieving-nca-ecc-2-2024-compliance-with-netskope
[bishernp]: https://bishernp.com/blog/ecc-2-vs-ncnicc-1-vs-ccc-2-which-nca-framework-applies
[alskyline]: https://alskyline.com/kb/compliance-nca-ccc-guide-2026
[govdocs]: https://governancedocs.com/cloud-cybersecurity-controls/
[grcvantage]: https://www.grcvantage.com/web/blog/nca-ccc-cloud-cybersecurity-controls
[kiteworks-sama]: https://www.kiteworks.com/regulatory-compliance/sama-data-sovereignty-hosting-compliance/
[momentumx]: https://momentumx.cloud/sama-cloud-framework-ksa-financial-institutions-2026/

- AWS Saudi region: [About Amazon][aa] · [Saudi Press Agency][spa] · [Asharq Al-Awsat][aawsat] · [TechAfrica News][techafrica] · [Channel Insider][ci] · [Vision2030.ai][v2030] · [Alventara][alventara] · [dcpulse (unverified code claim)][dcpulse] · [a9it (unverified code claim)][a9it]
- Gulf region incidents: [DCD (Mar)][dcd1] · [DCD (Sep)][dcd2] · [Capacity][capacity] · [webhosting.today][wht] · [CloudNews][cloudnews] · [Cybersecurity News][csn] · [Data Center Knowledge][dck]
- Service availability: [Cognito endpoints][cognito-gr] · [Cognito region tracker][cognito-tr] · [Cognito/SES re:Post][cognito-ses] · [Amplify Hosting regions][amplify-regions] · [Amplify me-central-1 re:Post][amplify-repost]
- PDPL: [Securiti overview][securiti-pdpl] · [Securiti transfer regulation][securiti-transfer] · [Dentons][dentons] · [Clyde & Co 2025][clyde-2025] · [Clyde & Co Oct 2026][clyde-2026] · [Reed Smith][reedsmith] · [Al Tamimi][tamimi]
- NCA: [Netskope][netskope] · [bishernp][bishernp] · [alskyline][alskyline] · [governancedocs][govdocs] · [grcvantage][grcvantage]
- SAMA: [Kiteworks][kiteworks-sama] · [MomentumX][momentumx]
- SMS to Saudi numbers: [AWS End User Messaging — Saudi Arabia sender ID registration](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-saudi-arabia.html) · [Registration times](https://docs.aws.amazon.com/sms-voice/latest/userguide/registration-eta.html)
