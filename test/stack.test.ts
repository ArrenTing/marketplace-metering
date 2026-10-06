import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MarketplaceMeteringStack } from '../lib/marketplace-metering-stack';

// Bundling every NodejsFunction with esbuild makes synth slow; stub it.
jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => {
  const lambda = jest.requireActual('aws-cdk-lib/aws-lambda');
  class NodejsFunction extends lambda.Function {
    constructor(scope: unknown, id: string, props: Record<string, unknown>) {
      super(scope, id, {
        ...props,
        code: lambda.Code.fromInline('exports.handler = async () => {}'),
        handler: 'index.handler',
      });
    }
  }
  return { NodejsFunction };
});

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  template = Template.fromStack(new MarketplaceMeteringStack(app, 'TestStack'));
});

describe('MarketplaceMeteringStack', () => {
  test('routes only UsageRecorded from the bus into the report queue', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['marketplace.metering'],
        'detail-type': ['UsageRecorded'],
      },
      Targets: [Match.objectLike({ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('ReportUsageQueue'), 'Arn'] } })],
    });
  });

  test('report queue retries three times before the dead-letter queue', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 30,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
  });

  test('report-usage consumes the queue with partial batch failures', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('ReportUsageQueue'), 'Arn'] },
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });

  test('stream consumer bisects and reports partial failures', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('UsageTable'), 'StreamArn'] },
      BisectBatchOnFunctionError: true,
      MaximumRetryAttempts: 3,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });

  test('alarms when anything lands in the dead-letter queue', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });

  test('every API method requires the API key', () => {
    const methods = template.findResources('AWS::ApiGateway::Method', {
      Properties: { HttpMethod: Match.anyValue() },
    });
    const nonOptions = Object.values(methods).filter(
      (method) => method.Properties.HttpMethod !== 'OPTIONS',
    );
    expect(nonOptions).toHaveLength(4);
    for (const method of nonOptions) {
      expect(method.Properties.ApiKeyRequired).toBe(true);
    }
  });
});
