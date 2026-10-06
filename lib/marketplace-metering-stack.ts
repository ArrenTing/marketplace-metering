import * as cdk from 'aws-cdk-lib/core';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { USAGE_EVENT_SOURCE } from '../src/usage-events';

export class MarketplaceMeteringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'UsageTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const bus = new events.EventBus(this, 'UsageBus');
    const publishEvents = new NodejsFunction(this, 'PublishEvents', {
      entry: 'src/publish-events.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      environment: { EVENT_BUS_NAME: bus.eventBusName },
      logGroup: new logs.LogGroup(this, 'PublishEventsLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    publishEvents.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: StartingPosition.LATEST,
        bisectBatchOnError: true,
        retryAttempts: 3,
        reportBatchItemFailures: true,
      }),
    );
    bus.grantPutEventsTo(publishEvents);

    const debugLogGroup = new logs.LogGroup(this, 'UsageBusDebugLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new events.Rule(this, 'LogAllUsageEvents', {
      eventBus: bus,
      eventPattern: { source: events.Match.prefix('') },
      targets: [new targets.CloudWatchLogGroup(debugLogGroup)],
    });

    // UsageRecorded -> SQS -> report-usage. The queue buffers bursts and gives
    // retries plus a dead-letter queue, which a direct Lambda target would not.
    const reportDlq = new sqs.Queue(this, 'ReportUsageDlq', {
      retentionPeriod: cdk.Duration.days(14),
    });
    const reportQueue = new sqs.Queue(this, 'ReportUsageQueue', {
      // At least 6x the consumer timeout, per the Lambda + SQS guidance.
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: { queue: reportDlq, maxReceiveCount: 3 },
    });
    new events.Rule(this, 'RouteUsageRecorded', {
      eventBus: bus,
      eventPattern: {
        source: [USAGE_EVENT_SOURCE],
        detailType: ['UsageRecorded'],
      },
      targets: [new targets.SqsQueue(reportQueue)],
    });

    const reportUsage = new NodejsFunction(this, 'ReportUsage', {
      entry: 'src/report-usage.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(5),
      environment: {
        TABLE_NAME: table.tableName,
        REPORT_FAILURE_RATE: String(
          this.node.tryGetContext('reportFailureRate') ?? '0.2',
        ),
      },
      logGroup: new logs.LogGroup(this, 'ReportUsageLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    reportUsage.addEventSource(
      new SqsEventSource(reportQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
    table.grantWriteData(reportUsage);

    new cloudwatch.Alarm(this, 'ReportUsageDlqAlarm', {
      alarmDescription: 'Usage records failed to report after all retries',
      metric: reportDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const recentEvents = new NodejsFunction(this, 'RecentEvents', {
      entry: 'src/recent-events.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      environment: { EVENT_LOG_GROUP_NAME: debugLogGroup.logGroupName },
      logGroup: new logs.LogGroup(this, 'RecentEventsLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    debugLogGroup.grantRead(recentEvents);

    const health = new NodejsFunction(this, 'Health', {
      entry: 'src/health.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      environment: {
        TABLE_NAME: table.tableName,
        DLQ_URL: reportDlq.queueUrl,
      },
      logGroup: new logs.LogGroup(this, 'HealthLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadData(health);
    reportDlq.grant(health, 'sqs:GetQueueAttributes');

    const usageApi = new NodejsFunction(this, 'UsageApi', {
      entry: 'src/handler.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      environment: { TABLE_NAME: table.tableName },
      logGroup: new logs.LogGroup(this, 'UsageApiLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    table.grantReadWriteData(usageApi);

    const api = new apigateway.RestApi(this, 'UsageRestApi', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['http://localhost:5173'],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'x-api-key'],
      },
    });
    const integration = new apigateway.LambdaIntegration(usageApi);
    const requiresKey = { apiKeyRequired: true };

    api.root.addResource('usage').addMethod('POST', integration, requiresKey);
    api.root
      .addResource('customers')
      .addResource('{customerId}')
      .addResource('usage')
      .addMethod('GET', integration, requiresKey);
    api.root
      .addResource('events')
      .addMethod('GET', new apigateway.LambdaIntegration(recentEvents), requiresKey);
    api.root
      .addResource('health')
      .addMethod('GET', new apigateway.LambdaIntegration(health), requiresKey);

    const plan = api.addUsagePlan('ConsoleUsagePlan', {
      throttle: { rateLimit: 5, burstLimit: 10 },
      quota: { limit: 10_000, period: apigateway.Period.DAY },
    });
    plan.addApiStage({ stage: api.deploymentStage });

    const apiKey = api.addApiKey('ConsoleApiKey');
    plan.addApiKey(apiKey);

    new cdk.CfnOutput(this, 'UsageApiUrl', {
      value: api.url,
    });
    new cdk.CfnOutput(this, 'UsageApiKeyId', {
      value: apiKey.keyId,
    });
    new cdk.CfnOutput(this, 'UsageBusDebugLogGroupName', {
      value: debugLogGroup.logGroupName,
    });
    new cdk.CfnOutput(this, 'ReportUsageQueueUrl', {
      value: reportQueue.queueUrl,
    });
    new cdk.CfnOutput(this, 'ReportUsageDlqUrl', {
      value: reportDlq.queueUrl,
    });
  }
}
