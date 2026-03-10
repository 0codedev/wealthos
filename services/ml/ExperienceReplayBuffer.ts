import { db, RLExperience } from '../../database';
import { logger } from '../Logger';

export class ExperienceReplayBuffer {
  private static instance: ExperienceReplayBuffer;
  private maxSize = 500;

  private constructor() {}

  static getInstance(): ExperienceReplayBuffer {
    if (!ExperienceReplayBuffer.instance) {
      ExperienceReplayBuffer.instance = new ExperienceReplayBuffer();
    }
    return ExperienceReplayBuffer.instance;
  }

  /**
   * Adds a new experience to the buffer. If the buffer exceeds maxSize,
   * evicts the oldest experiences based on timestamp.
   */
  async addExperience(experience: Omit<RLExperience, 'timestamp'>): Promise<void> {
    try {
      const entry: RLExperience = {
        ...experience,
        timestamp: Date.now()
      };

      await db.rl_experiences.add(entry);

      // Check buffer size and enforce maxSize limit
      const count = await db.rl_experiences.count();
      if (count > this.maxSize) {
        const excess = count - this.maxSize;
        // Find the oldest excess entries
        const oldestEntries = await db.rl_experiences
          .orderBy('timestamp')
          .limit(excess)
          .toArray();

        const idsToDelete = oldestEntries.map((e: RLExperience) => e.id).filter((id): id is number => id !== undefined);
        if (idsToDelete.length > 0) {
          await db.rl_experiences.bulkDelete(idsToDelete);
          logger.info(`[ExperienceReplayBuffer] Evicted ${idsToDelete.length} old experiences from RL buffer.`);
        }
      }
    } catch (error) {
      logger.error('[ExperienceReplayBuffer] Failed to add experience to replay buffer', error);
    }
  }

  /**
   * Retrieves a random batch of experiences from the buffer.
   */
  async sample(batchSize: number): Promise<RLExperience[]> {
    try {
      const all = await db.rl_experiences.toArray();
      if (all.length === 0) return [];
      
      const shuffled = [...all].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, Math.min(batchSize, shuffled.length));
    } catch (error) {
      logger.error('[ExperienceReplayBuffer] Failed to sample experiences', error);
      return [];
    }
  }

  /**
   * Returns the current size of the buffer.
   */
  async getSize(): Promise<number> {
    try {
      return await db.rl_experiences.count();
    } catch (error) {
      logger.error('[ExperienceReplayBuffer] Failed to get buffer size', error);
      return 0;
    }
  }

  /**
   * Clears all stored experiences.
   */
  async clear(): Promise<void> {
    try {
      await db.rl_experiences.clear();
      logger.info('[ExperienceReplayBuffer] Cleared all RL experiences.');
    } catch (error) {
      logger.error('[ExperienceReplayBuffer] Failed to clear buffer', error);
    }
  }
}

export const experienceReplayBuffer = ExperienceReplayBuffer.getInstance();
