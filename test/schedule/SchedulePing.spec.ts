import { deepEqual, instance, mock, verify, when } from 'ts-mockito';

import { SchedulesRepository } from '../../src/repository/SchedulesRepository';
import { SchedulePing } from '../../src/schedule/SchedulePing';
import { sleep } from '../utils/sleep';

describe('SchedulePing', () => {
  const scheduleId = '123';
  const scheduleName = 'schedule';
  const interval = 1000;
  let error: jest.Mock;

  let schedulesRepository: SchedulesRepository;
  let schedulePing: SchedulePing;
  const startAllJobs = jest.fn();

  beforeEach(() => {
    schedulesRepository = mock(SchedulesRepository);
    error = jest.fn();
    schedulePing = new SchedulePing(
      scheduleId,
      scheduleName,
      instance(schedulesRepository),
      { debug: jest.fn(), error },
      interval,
      startAllJobs
    );
  });

  afterEach(async () => schedulePing.stop());

  it('starts, pings, cleans and stops', async () => {
    when(schedulesRepository.isActiveSchedule(scheduleName)).thenResolve(true);
    await schedulePing.start();

    expect(startAllJobs).toHaveBeenCalledTimes(1);
    verify(schedulesRepository.ping(scheduleId)).once();

    await sleep(1.1 * interval);
    expect(startAllJobs).toHaveBeenCalledTimes(1);
    verify(schedulesRepository.ping(scheduleId)).twice();

    await schedulePing.stop();
    await sleep(interval);

    verify(schedulesRepository.ping(scheduleId)).twice();
    verify(schedulesRepository.deleteOne(deepEqual({ scheduleId }))).once();
  });

  it('handles mongo errors', async () => {
    when(schedulesRepository.isActiveSchedule(scheduleName)).thenResolve(true);
    const message = 'I am an error that should be caught';
    when(schedulesRepository.ping(scheduleId)).thenReject({
      message,
    } as Error);

    await schedulePing.start();

    verify(schedulesRepository.ping(scheduleId)).once();
    expect(error).toHaveBeenCalledWith(
      'Pinging or cleaning the Schedules repository failed',
      'an internal error occurred',
      {},
      { message }
    );
  });
});
