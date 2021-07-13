import humanInterval from 'human-interval';
import { min } from 'lodash';

import { Job } from '../job/Job';
import { JobExecutor } from '../executor/JobExecutor';
import { setIntervalWithDelay, TimeoutHandle } from './setIntervalWithDelay';
import { calculateDelay } from './calculateDelay';
import { MomoError } from '../logging/error/MomoError';
import { MomoErrorType } from '../logging/error/MomoErrorType';
import { getJobRepository } from '../repository/getJobRepository';
import { Logger } from '../logging/Logger';
import { ExecutionStatus, JobResult } from '../job/ExecutionInfo';
import { DateTime } from 'luxon';
import { jobDescriptionFromEntity, MomoJobDescription } from '../job/MomoJobDescription';

export class JobScheduler {
  private jobHandle?: TimeoutHandle;
  private unexpectedErrorCount = 0;
  private interval?: string;
  private pendingExecutions: Promise<any>[] = [];

  constructor(
    private readonly jobName: string,
    private readonly immediate: boolean,
    private readonly jobExecutor: JobExecutor,
    private readonly logger: Logger
  ) {}

  static forJob(job: Job, logger: Logger): JobScheduler {
    const executor = new JobExecutor(job.handler, logger);
    return new JobScheduler(job.name, job.immediate, executor, logger);
  }

  public getUnexpectedErrorCount(): number {
    return this.unexpectedErrorCount;
  }

  public isStarted(): boolean {
    return this.jobHandle !== undefined;
  }

  public async getJobDescription(): Promise<MomoJobDescription | undefined> {
    const jobEntity = await getJobRepository().findOne({ name: this.jobName });
    if (!jobEntity) {
      this.logger.error(
        'get job description - job not found',
        MomoErrorType.scheduleJob,
        { name: this.jobName },
        MomoError.jobNotFound
      );
      return;
    }
    const schedulerStatus =
      this.interval !== undefined ? { interval: this.interval, running: jobEntity.running } : undefined;
    return { ...jobDescriptionFromEntity(jobEntity), schedulerStatus };
  }

  public async start(): Promise<void> {
    await this.stop();

    const jobEntity = await getJobRepository().findOne({ name: this.jobName });
    if (!jobEntity) {
      this.logger.error(
        'cannot schedule job',
        MomoErrorType.scheduleJob,
        { name: this.jobName },
        MomoError.jobNotFound
      );
      return;
    }

    const interval = humanInterval(jobEntity.interval);
    if (!interval || isNaN(interval)) {
      throw MomoError.nonParsableInterval;
    }

    this.interval = jobEntity.interval;

    const delay = calculateDelay(interval, this.immediate, jobEntity);
    this.jobHandle = setIntervalWithDelay(this.executeConcurrently.bind(this), interval, delay);

    this.logger.debug(`scheduled job to run at ${DateTime.now().plus({ milliseconds: delay }).toISO()}`, {
      name: this.jobName,
      interval,
      delay,
    });
  }

  public async stop(): Promise<void> {
    if (this.jobHandle) {
      clearInterval(this.jobHandle.get());
      this.jobHandle = undefined;
      this.interval = undefined;
    }
    if (this.pendingExecutions.length > 0) {
      this.logger.debug('wait for pending executions to finish', {
        name: this.jobName,
        pending: this.pendingExecutions.length,
      });
      await Promise.all(this.pendingExecutions);
    }
  }

  async executeOnce(): Promise<JobResult> {
    try {
      const jobEntity = await getJobRepository().findOne({ name: this.jobName });
      if (!jobEntity) {
        this.logger.error(
          'job not found, skip execution',
          MomoErrorType.executeJob,
          { name: this.jobName },
          MomoError.jobNotFound
        );
        return {
          status: ExecutionStatus.notFound,
        };
      }

      return this.jobExecutor.execute(jobEntity);
    } catch (e) {
      this.handleUnexpectedError(e);
      return {
        status: ExecutionStatus.failed,
      };
    }
  }

  async executeConcurrently(): Promise<void> {
    try {
      const jobEntity = await getJobRepository().findOne({ name: this.jobName });
      if (!jobEntity) {
        this.logger.error(
          'job not found, skip execution',
          MomoErrorType.executeJob,
          { name: this.jobName },
          MomoError.jobNotFound
        );
        return;
      }

      const numToExecute =
        jobEntity.maxRunning > 0
          ? min([jobEntity.concurrency, jobEntity.maxRunning - (jobEntity.running ?? 0)]) ?? jobEntity.concurrency
          : jobEntity.concurrency;
      this.logger.debug('execute job', { name: this.jobName, times: numToExecute });

      for (let i = 0; i < numToExecute; i++) {
        const pendingExecution = this.jobExecutor
          .execute(jobEntity)
          .catch((e) => {
            this.handleUnexpectedError(e);
          })
          .finally(() => {
            const index = this.pendingExecutions.indexOf(pendingExecution);
            if (index > -1) {
              this.pendingExecutions.splice(index, 1);
            }
          });
        this.pendingExecutions?.push(pendingExecution);
      }
    } catch (e) {
      this.handleUnexpectedError(e);
    }
  }

  private handleUnexpectedError(error: Error): void {
    this.unexpectedErrorCount++;
    this.logger.error(
      'an unexpected error occurred while running job',
      MomoErrorType.executeJob,
      { name: this.jobName },
      error
    );
  }
}
