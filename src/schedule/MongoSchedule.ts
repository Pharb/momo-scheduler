import { v4 as uuid } from 'uuid';
import { Schedule } from './Schedule';
import { SchedulePing } from './SchedulePing';
import { connect, disconnect, MomoConnectionOptions } from '../connect';
import { getExecutionsRepository } from '../repository/getRepository';

export class MongoSchedule extends Schedule {
  private readonly schedulePing: SchedulePing;

  constructor(scheduleId: string) {
    super(scheduleId);
    this.schedulePing = new SchedulePing(scheduleId, this.logger);
  }

  /**
   * Creates a MongoSchedule that is connected to the MongoDB with the provided url.
   *
   * @param connectionOptions for the MongoDB connection to establish
   */
  public static async connect(connectionOptions: MomoConnectionOptions): Promise<MongoSchedule> {
    const scheduleId = uuid();
    const mongoSchedule = new MongoSchedule(scheduleId);
    await connect(connectionOptions, mongoSchedule.logger);
    await getExecutionsRepository().addSchedule(scheduleId);
    mongoSchedule.schedulePing.start();
    return mongoSchedule;
  }

  /**
   * Cancels all jobs on the schedule and disconnects the database.
   */
  public async disconnect(): Promise<void> {
    await this.cancel();
    await this.schedulePing.stop();
    await disconnect();
  }
}
