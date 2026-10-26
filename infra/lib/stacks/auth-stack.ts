import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { acknowledge } from '../nag';

export interface AuthStackProps extends StackProps {
  config: QitahConfig;
}

/**
 * Two Cognito user pools:
 *  - customers: phone-number sign-in (SMS OTP via Amazon SNS; Saudi sender-ID registration is an external blocker)
 *  - staff:     email sign-in for merchants and Qitah operations, strong password policy, TOTP MFA
 */
export class AuthStack extends Stack {
  readonly customerPool: cognito.UserPool;
  readonly staffPool: cognito.UserPool;
  readonly mobileClient: cognito.UserPoolClient;
  readonly merchantPortalClient: cognito.UserPoolClient;
  readonly opsPortalClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    const a = config.auth;
    const removal = a.removable ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

    this.customerPool = new cognito.UserPool(this, 'CustomerPool', {
      userPoolName: `qitah-${config.envName}-customers`,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      signInAliases: { phone: true },
      signInCaseSensitive: false,
      autoVerify: { phone: true },
      standardAttributes: {
        phoneNumber: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      // Passwordless SMS one-time code as the first factor (choice-based USER_AUTH flow).
      signInPolicy: { allowedFirstAuthFactors: { password: true, smsOtp: true } },
      passwordPolicy: { minLength: 10, requireDigits: true, requireLowercase: true, requireUppercase: false, requireSymbols: false },
      mfa: cognito.Mfa.OFF,
      accountRecovery: cognito.AccountRecovery.PHONE_ONLY_WITHOUT_MFA,
      smsRoleExternalId: `qitah-${config.envName}-customers-sms`,
      userVerification: {
        smsMessage: 'رمز التحقق من قطعة: {####} — Qitah code: {####}',
      },
      deletionProtection: !a.removable,
      removalPolicy: removal,
    });

    this.staffPool = new cognito.UserPool(this, 'StaffPool', {
      userPoolName: `qitah-${config.envName}-staff`,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: a.merchantSelfSignUp,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true }, fullname: { required: false, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
        passwordHistorySize: 5,
      },
      mfa: a.staffMfa === 'REQUIRED' ? cognito.Mfa.REQUIRED : cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: !a.removable,
      removalPolicy: removal,
    });
    // Informational groups. Authorisation is enforced by the API from its own role tables
    // (PlatformRoleAssignment / MerchantMember), and the ops portal must additionally check `ops`.
    for (const [name, description] of [
      ['merchant', 'Merchant staff (portals/merchant)'],
      ['ops', 'Qitah operations staff (portals/ops)'],
      ['ops-admin', 'Qitah operations administrators'],
      ['finance', 'Qitah finance'],
    ] as const) {
      new cognito.CfnUserPoolGroup(this, `Group-${name}`, { userPoolId: this.staffPool.userPoolId, groupName: name, description });
    }

    const common = {
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      disableOAuth: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
    } satisfies Partial<cognito.UserPoolClientOptions>;

    this.mobileClient = this.customerPool.addClient('MobileClient', {
      ...common,
      userPoolClientName: 'mobile-app',
      authFlows: { user: true, userSrp: true },
      refreshTokenValidity: Duration.days(30),
    });
    this.merchantPortalClient = this.staffPool.addClient('MerchantPortalClient', {
      ...common,
      userPoolClientName: 'merchant-portal',
      authFlows: { userPassword: true, userSrp: true },
      refreshTokenValidity: Duration.days(7),
    });
    this.opsPortalClient = this.staffPool.addClient('OpsPortalClient', {
      ...common,
      userPoolClientName: 'ops-portal',
      authFlows: { userPassword: true, userSrp: true },
      accessTokenValidity: Duration.minutes(30),
      idTokenValidity: Duration.minutes(30),
      refreshTokenValidity: Duration.hours(12),
    });

    new CfnOutput(this, 'CustomerPoolId', { value: this.customerPool.userPoolId });
    new CfnOutput(this, 'StaffPoolId', { value: this.staffPool.userPoolId });
    new CfnOutput(this, 'MobileClientId', { value: this.mobileClient.userPoolClientId });
    new CfnOutput(this, 'MerchantPortalClientId', { value: this.merchantPortalClient.userPoolClientId });
    new CfnOutput(this, 'OpsPortalClientId', { value: this.opsPortalClient.userPoolClientId });

    acknowledge(this.customerPool, [
      {
        id: 'AwsSolutions-COG2',
        reason: 'Customers authenticate with a phone one-time code (possession factor); TOTP MFA would block the mobile journey.',
      },
      {
        id: 'AwsSolutions-COG3',
        reason: 'Threat protection needs the Cognito Plus feature plan (per-MAU cost). Revisit before launch (production-readiness gate).',
      },
      { id: 'AwsSolutions-COG1', reason: 'Customer passwords are secondary to SMS OTP; 10+ chars with digits and lowercase.' },
      {
        id: 'AwsSolutions-COG8',
        reason: 'Plus feature plan (threat protection) has per-MAU cost; Essentials is used until launch traffic justifies it.',
      },
      { id: 'AwsSolutions-IAM5[Resource::*]', reason: 'Cognito SMS role: sns:Publish to phone numbers has no resource ARN (CDK-generated role).' },
    ]);
    acknowledge(this.staffPool, [
      {
        id: 'AwsSolutions-COG3',
        reason: 'Threat protection needs the Cognito Plus feature plan (per-MAU cost). Staff pool enforces TOTP MFA in production.',
      },
      {
        id: 'AwsSolutions-COG8',
        reason: 'Plus feature plan has per-MAU cost; staff pool relies on strong passwords + TOTP MFA. Revisit at the production-readiness gate.',
      },
      ...(a.staffMfa === 'REQUIRED'
        ? []
        : [{ id: 'AwsSolutions-COG2', reason: 'Staging keeps MFA optional for test accounts; production requires TOTP.' }]),
    ]);
  }
}
