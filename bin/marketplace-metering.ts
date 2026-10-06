#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { MarketplaceMeteringStack } from '../lib/marketplace-metering-stack';

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;

new MarketplaceMeteringStack(app, 'MarketplaceMeteringStack', {
  env: account ? { account, region: 'ca-central-1' } : undefined,
});
