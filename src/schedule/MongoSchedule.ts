import { Schedule } from './Schedule';
import { connect, disconnect, MomoConnectionOptions } from '../connect';

export class MongoSchedule extends Schedule {
  private constructor() {
    super();
  }

  /**
   * Creates a MongoSchedule that is connected to the MongoDB with the provided url.
   *
   * @param connectionOptions for the MongoDB connection to establish
   */
  public static async connect(connectionOptions: MomoConnectionOptions): Promise<MongoSchedule> {
    const mongoSchedule = new MongoSchedule();
    await connect(connectionOptions, mongoSchedule.logger);
    return mongoSchedule;
  }

  /**
   * Cancels all jobs on the schedule and disconnects the database.
   */
  public async disconnect(): Promise<void> {
    await this.cancel();
    await disconnect();
  }
}
