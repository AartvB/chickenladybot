import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';
import { context, reddit } from '@devvit/web/server';
import { Post } from '@devvit/web/server';

export async function botExplainer(): Promise<string> { return `\n\n^(This piece of content has been created automatically by a bot. If you think it made a mistake, [contact the mods](https://www.reddit.com/message/compose/?to=/r/${context.subredditName}) via modmail. The code for this bot is fully open source, and can be found [here](https://github.com/AartvB/chickenladybot).)`; }
export async function isPostDeleted(post: Post): Promise<boolean> { return post.authorName == '[deleted]' || post.removed; }
export async function isPostDeletedEarly(postId: T3): Promise<boolean> {
  const dbVersion = await DBVersion();
  const isInEarlyQueue = await redis.zScore(`early-deleted-post-queue-v${dbVersion}`, postId) != undefined;
  const earlyDeleted = await redis.zScore(`early-deleted-posts-v${dbVersion}`, postId) != undefined;
  return isInEarlyQueue || earlyDeleted;
}
export async function DBVersion(): Promise<string> { return await redis.get('database-version') ?? '1'; }
export async function DBkey(key: string): Promise<string> { const dbVersion = await DBVersion(); return `${key}-v${dbVersion}`; }
export async function isInSoftShutdown(): Promise<boolean> { const shutdownState = await redis.get(`shutdown-lock-v${await DBVersion()}`); return shutdownState === 'soft' || shutdownState === 'hard'; }
export async function isInHardShutdown(): Promise<boolean> { return await redis.get(`shutdown-lock-v${await DBVersion()}`) === 'hard'; }

export async function addToEndOfQueue(queueName: string, text: string): Promise<number> {
  const maxValue = (await redis.zRange(queueName, -1, -1))[0];
  const maxScore = maxValue?.score ?? 0;
  await redis.zAdd(queueName, { member: text, score: maxScore+1 });
  return maxScore+1;
}

export async function updateTargetPost() {
  // Update the post that tells the user what the correct next number is.
  const dbVersion = await DBVersion();
  const targetPostId = await redis.get(`current-count-post-id-v${dbVersion}`);
  if (targetPostId == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
  const targetPost = await reddit.getPostById(targetPostId as T3);

  if (await isInSoftShutdown()) {
    const text = `The bot is currently under maintenance. Our apologies for the inconvenience. Please [sort by new](https://www.reddit.com/r/${targetPost.subredditName}/new/) to see what the next number in the sequence should be, and use this number as the title for your new post.` + await botExplainer();
    await targetPost.edit({ text: text });
    return { status: 'ok', message: `Successfully processed new posts`, number: 200 };
  }

  const currentCountString = await redis.get(`current-count-v${dbVersion}`);
  const currentCount = parseInt(currentCountString || '0');

  const text = `The next number should be: [${currentCount + 1}](https://www.reddit.com/r/${targetPost.subredditName}/submit?title=${currentCount + 1})` + await botExplainer();
  await targetPost.edit({ text: text });

  return { status: 'ok', message: `Successfully processed new posts`, number: 200 }
}

export function getDateTime() {
  return new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' });
}

export type TaskSchedulerOptions = {
  timeToStop?: number;
  maxTime?: number;
  multiplier?: number;
  startTime?: number;
  stopAtSoftShutdown?: boolean;
  stopAtHardShutdown?: boolean;
};

export class TaskScheduler {
  private startTime: number;
  private timeToStop: number;
  private maxTime: number;
  private multiplier: number;
  private startTimeTask: number;
  private stopAtSoftShutdown: boolean;
  private stopAtHardShutdown: boolean;

  constructor({ timeToStop = 10000, maxTime = 30000, multiplier = 1.5, startTime = Date.now(), stopAtSoftShutdown = false, stopAtHardShutdown = true }: TaskSchedulerOptions) { 
    this.startTime = startTime;
    this.startTimeTask = startTime;
    this.timeToStop = timeToStop;
    this.maxTime = maxTime;
    this.multiplier = multiplier;
    this.stopAtSoftShutdown = stopAtSoftShutdown;
    this.stopAtHardShutdown = stopAtHardShutdown;
  }
  async startNextTask() { 
    const result = !(await this.endTask());
    this.startTimeTask = Date.now();
    return result;
  }
  async endTask(): Promise<boolean> { 
    if (this.stopAtSoftShutdown && await isInSoftShutdown()) { return true; }
    if (this.stopAtHardShutdown && await isInHardShutdown()) { return true; }
    const processingTime = Date.now() - this.startTimeTask;
    const totalProcessingTime = Date.now() - this.startTime;
    const timeLeft = this.maxTime - totalProcessingTime;
    return timeLeft < processingTime * this.multiplier || timeLeft < this.timeToStop;
  }
}