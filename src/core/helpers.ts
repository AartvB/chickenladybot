import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';
import { context, reddit } from '@devvit/web/server';
import { Post } from '@devvit/web/server';
import originalDatabase from '../core/original_database.json';

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
    const text = `The bot is currently under maintenance. Our apologies for the inconvenience. Please [sort by new](https://www.reddit.com/r/${targetPost.subredditName}/new/) to see what the next number in the sequence should be, and use this number as the title for your new post. If someone posts with the wrong number, it will be removed by the bot when it gets back online. Ignore the wrong post, and use the correct number for your post.` + await botExplainer();
    await targetPost.edit({ text: text });
    return { status: 'ok', message: `Successfully processed new posts, but the process was stopped due to a shutdown`, number: 200 };
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

async function updateBackgroundTaskTracker(taskName: string): Promise<string> {
  const dbVersion = await DBVersion();
  await redis.set(`background-task-tracker-v${dbVersion}`, taskName);
  return taskName;
}

export async function restoreDatabaseBackup(removeExistingData: boolean = true): Promise<boolean> {
  // Restore backup from the database of the original chickenbot that used PRAW and SQLLite

  console.log(`${getDateTime()}: Starting database backup restoration for version ${await DBVersion()}.`);

  const taskScheduler = new TaskScheduler({ stopAtSoftShutdown: false, stopAtHardShutdown: false, timeToStop: 1000, maxTime: 30000 });
	const dbVersion = await DBVersion();
	let currentTask = await redis.get(`background-task-tracker-v${dbVersion}`) ?? 'remove-users';
	
  if (removeExistingData) {
    console.log(`${getDateTime()}: Removing existing data from database.`);
    if (currentTask == 'remove-users') {
      console.log(`${getDateTime()}: Removing users from database.`);
      await redis.del(`users-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-posts');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-posts') {
      console.log(`${getDateTime()}: Removing posts from database.`);
      await redis.del(`posts-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-early-deleted-posts');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-early-deleted-posts') {
      console.log(`${getDateTime()}: Removing early deleted posts from database.`);
      await redis.del(`early-deleted-posts-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-streaks');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-streaks') {
      console.log(`${getDateTime()}: Removing streaks from database.`);
      await redis.del(`current-streaks-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-current-COAD-streaks');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-current-COAD-streaks') {
      console.log(`${getDateTime()}: Removing COAD streaks from database.`);
      await redis.del(`current-COAD-streaks-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-post-streaks');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-post-streaks') {
      console.log(`${getDateTime()}: Removing post streaks from database.`);
      await redis.del(`post-streaks-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-post-COAD-streaks');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-post-COAD-streaks') {
      console.log(`${getDateTime()}: Removing post COAD streaks from database.`);
      await redis.del(`post-COAD-streaks-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-top-COAD-streaks');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-top-COAD-streaks') {
      console.log(`${getDateTime()}: Removing top COAD streaks from database.`);
      await redis.del(`top-COAD-streaks-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-top-streaks');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-top-streaks') {
      console.log(`${getDateTime()}: Removing top streaks from database.`);
      await redis.del(`top-streaks-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-post-upvotes');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-post-upvotes') {
      console.log(`${getDateTime()}: Removing post upvotes from database.`);
      await redis.del(`post-upvotes-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-post-comments');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-post-comments') {
      console.log(`${getDateTime()}: Removing post comments from database.`);
      await redis.del(`post-comments-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-posts-per-user');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-posts-per-user') {
      console.log(`${getDateTime()}: Removing posts per user from database.`);
      await redis.del(`posts-per-user-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-identical-digits-posts');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-identical-digits-posts') {
      console.log(`${getDateTime()}: Removing identical digits posts from database.`);
      await redis.del(`identical-digits-posts-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-identical-digits-users');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-identical-digits-users') {
      console.log(`${getDateTime()}: Removing identical digits users from database.`);
      await redis.del(`identical-digits-users-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-palindrome-posts');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-palindrome-posts') {
      console.log(`${getDateTime()}: Removing palindrome posts from database.`);
      await redis.del(`palindrome-posts-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-palindrome-users');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-palindrome-users') {
      console.log(`${getDateTime()}: Removing palindrome users from database.`);
      await redis.del(`palindrome-users-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker('remove-current-count');
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask == 'remove-current-count') {
      console.log(`${getDateTime()}: Removing current count from database.`);
      await redis.del(`current-count-v${dbVersion}`);
      currentTask = await updateBackgroundTaskTracker(`remove-posts-of-${Object.keys(originalDatabase.posts_of)[0]}`);
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    if (currentTask.startsWith('remove-posts-of-')) {
      console.log(`${getDateTime()}: Removing posts of users from database.`);
      let current_username = currentTask.replace('remove-posts-of-', '');
      let i = 0;
      for (const [username, _] of Object.entries(originalDatabase.posts_of)) {
        i++;
        if (username != current_username) { continue; }
        await redis.del(`posts-of-${username}-v${dbVersion}`);
        current_username = Object.keys(originalDatabase.posts_of)[i] ?? '';
        await updateBackgroundTaskTracker(`remove-posts-of-${current_username}`);
        if (!await taskScheduler.startNextTask()) { return false; }
      }
      currentTask = await updateBackgroundTaskTracker(`remove-whole-count-posts-${Object.keys(originalDatabase.whole_count_posts)[0]}`);
    }
    if (currentTask.startsWith('remove-whole-count-posts-')) {
      console.log(`${getDateTime()}: Removing whole count posts from database.`);
      let current_number = currentTask.replace('remove-whole-count-posts-', '');
      let i = 0;
      for (const [number, _] of Object.entries(originalDatabase.whole_count_posts)) {
        i++;
        if (number != current_number) { continue; }
        await redis.del(`whole-count-${number}-posts-v${dbVersion}`);
        current_number = Object.keys(originalDatabase.whole_count_posts)[i] ?? '';
        await updateBackgroundTaskTracker(`remove-whole-count-posts-${current_number}`);
        if (!await taskScheduler.startNextTask()) { return false; }
      }
      currentTask = await updateBackgroundTaskTracker(`remove-whole-count-users-${Object.keys(originalDatabase.whole_count_users)[0]}`);        
    }
    if (currentTask.startsWith('remove-whole-count-users-')) {
      console.log(`${getDateTime()}: Removing whole count users from database.`);
      let current_number = currentTask.replace('remove-whole-count-users-', '');
      let i = 0;
      for (const [number, _] of Object.entries(originalDatabase.whole_count_users)) {
        i++;
        if (number != current_number) { continue; }
        await redis.del(`whole-count-${number}-users-v${dbVersion}`);
        current_number = Object.keys(originalDatabase.whole_count_users)[i] ?? '';
        await updateBackgroundTaskTracker(`remove-whole-count-users-${current_number}`);
        if (!await taskScheduler.startNextTask()) { return false; }
      }
      currentTask = await updateBackgroundTaskTracker(`remove-post-info-${Object.keys(originalDatabase.post_info)[0]}`);
    }
    if (currentTask.startsWith('remove-post-info-')) {
      console.log(`${getDateTime()}: Removing post info from database.`);
      let current_postId = currentTask.replace('remove-post-info-', '');
      let i = 0;
      const nPosts = Object.keys(originalDatabase.post_info).length;
      for (const [postId, _] of Object.entries(originalDatabase.post_info)) {
        i++;
        if (postId != current_postId) { continue; }
        if (i % 1000 == 0) { console.log(`${getDateTime()}: Deleting post info for ${i}/${nPosts} posts (${(i / nPosts * 100).toFixed(1)}%).`); }
        await redis.del(`post-info-${postId}-v${dbVersion}`);
        current_postId = Object.keys(originalDatabase.post_info)[i] ?? '';
        await updateBackgroundTaskTracker(`remove-post-info-${current_postId}`);
        if (!await taskScheduler.startNextTask()) { return false; }
      }
      currentTask = await updateBackgroundTaskTracker(`remove-other-streaks-of-${Object.keys(originalDatabase.other_streaks_of)[0]}`);
    }
    if (currentTask.startsWith('remove-other-streaks-of-')) {
      console.log(`${getDateTime()}: Removing other streaks of users from database.`);
      let current_username = currentTask.replace('remove-other-streaks-of-', '');
      let i = 0;
      for (const [username, _] of Object.entries(originalDatabase.other_streaks_of)) {
        i++;
        if (username != current_username) { continue; }
        await redis.del(`other-streaks-of-${username}-v${dbVersion}`);
        current_username = Object.keys(originalDatabase.other_streaks_of)[i] ?? '';
        await updateBackgroundTaskTracker(`remove-other-streaks-of-${current_username}`);
        if (!await taskScheduler.startNextTask()) { return false; }
      }
      currentTask = await updateBackgroundTaskTracker('users');
    }
    console.log(`${getDateTime()}: Database emptied successfully for version ${dbVersion}.`);
  }
  else if (currentTask == 'remove-users') {
    console.log(`${getDateTime()}: Skipping removal of existing data from database.`);
    currentTask = 'users';
    await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
  }

  if (currentTask == 'users') {
    console.log(`${getDateTime()}: Restoring users from backup.`);
    if (originalDatabase.users.length > 0) {
      await redis.zAdd(`users-v${dbVersion}`, ...originalDatabase.users.map((user: { member: string; score: number }) => ({member: user.member, score: user.score, })));
    }
    currentTask = await updateBackgroundTaskTracker('posts');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'posts') {
    console.log(`${getDateTime()}: Restoring posts from backup.`);
    if (originalDatabase.posts.length > 0) {
      await redis.zAdd(`posts-v${dbVersion}`, ...originalDatabase.posts.map((post: { member: string; score: number }) => ({member: post.member, score: post.score, })));
    }
    currentTask = await updateBackgroundTaskTracker('early-deleted-posts');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'early-deleted-posts') {
    console.log(`${getDateTime()}: Restoring early-deleted posts from backup.`);
    if (originalDatabase.early_deleted_posts.length > 0) {
      await redis.zAdd(`early-deleted-posts-v${dbVersion}`, ...originalDatabase.early_deleted_posts.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
    }
    currentTask = await updateBackgroundTaskTracker('current-streaks');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'current-streaks') {
    console.log(`${getDateTime()}: Restoring current streaks from backup.`);
    if (originalDatabase.current_streaks.length > 0) {
      await redis.zAdd(`current-streaks-v${dbVersion}`, ...originalDatabase.current_streaks.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
    }
    currentTask = await updateBackgroundTaskTracker('current-COAD-streaks');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'current-COAD-streaks') {
    console.log(`${getDateTime()}: Restoring current COAD streaks from backup.`);
    if (originalDatabase.current_COAD_streaks.length > 0) {
      await redis.zAdd(`current-COAD-streaks-v${dbVersion}`, ...originalDatabase.current_COAD_streaks.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
    }
    currentTask = await updateBackgroundTaskTracker('post-streaks');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'post-streaks') {
    console.log(`${getDateTime()}: Restoring post streaks from backup.`);
    if (originalDatabase.post_streaks.length > 0) {
      await redis.zAdd(`post-streaks-v${dbVersion}`, ...originalDatabase.post_streaks.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
    }
    currentTask = await updateBackgroundTaskTracker('post-COAD-streaks');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'post-COAD-streaks') {
    console.log(`${getDateTime()}: Restoring post COAD streaks from backup.`);
    if (originalDatabase.post_COAD_streaks.length > 0) {
      await redis.zAdd(`post-COAD-streaks-v${dbVersion}`, ...originalDatabase.post_COAD_streaks.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
    }
    currentTask = await updateBackgroundTaskTracker('top-COAD-streaks');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'top-COAD-streaks') {
    console.log(`${getDateTime()}: Restoring top COAD streaks from backup.`);
    if (originalDatabase.top_COAD_streaks.length > 0) {
      await redis.zAdd(`top-COAD-streaks-v${dbVersion}`, ...originalDatabase.top_COAD_streaks.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
    }
    currentTask = await updateBackgroundTaskTracker('top-streaks');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'top-streaks') {
    console.log(`${getDateTime()}: Restoring top streaks from backup.`);
    if (originalDatabase.top_streaks.length > 0) {
      await redis.zAdd(`top-streaks-v${dbVersion}`, ...originalDatabase.top_streaks.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
    }
    currentTask = await updateBackgroundTaskTracker('post-upvotes');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'post-upvotes') {
    console.log(`${getDateTime()}: Restoring post upvotes from backup.`);
    if (originalDatabase.post_upvotes.length > 0) {
      await redis.zAdd(`post-upvotes-v${dbVersion}`, ...originalDatabase.post_upvotes.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
    }
    currentTask = await updateBackgroundTaskTracker('post-comments');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'post-comments') {
    console.log(`${getDateTime()}: Restoring post comments from backup.`);
    if (originalDatabase.post_comments.length > 0) {
      await redis.zAdd(`post-comments-v${dbVersion}`, ...originalDatabase.post_comments.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
    }
    currentTask = await updateBackgroundTaskTracker('posts-per-user');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'posts-per-user') {
    console.log(`${getDateTime()}: Restoring posts per user from backup.`);
    if (originalDatabase.posts_per_user.length > 0) {
      await redis.zAdd(`posts-per-user-v${dbVersion}`, ...originalDatabase.posts_per_user.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
    }
    currentTask = await updateBackgroundTaskTracker('identical-digits-posts');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'identical-digits-posts') {
    console.log(`${getDateTime()}: Restoring identical digits posts from backup.`);
    if (originalDatabase.identical_digits_posts.length > 0) {
      await redis.zAdd(`identical-digits-posts-v${dbVersion}`, ...originalDatabase.identical_digits_posts.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
    }
    currentTask = await updateBackgroundTaskTracker('identical-digits-users');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'identical-digits-users') {
    console.log(`${getDateTime()}: Restoring identical digits users from backup.`);
    if (originalDatabase.identical_digits_users.length > 0) {
      await redis.zAdd(`identical-digits-users-v${dbVersion}`, ...originalDatabase.identical_digits_users.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
    }
    currentTask = await updateBackgroundTaskTracker('palindrome-posts');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'palindrome-posts') {
    console.log(`${getDateTime()}: Restoring palindrome posts from backup.`);
    if (originalDatabase.palindrome_posts.length > 0) {
      await redis.zAdd(`palindrome-posts-v${dbVersion}`, ...originalDatabase.palindrome_posts.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
    }
    currentTask = await updateBackgroundTaskTracker('palindrome-users');
    if (!await taskScheduler.startNextTask()) { return false; }
  }
  if (currentTask == 'palindrome-users') {
    console.log(`${getDateTime()}: Restoring palindrome users from backup.`);
    if (originalDatabase.palindrome_users.length > 0) {
      await redis.zAdd(`palindrome-users-v${dbVersion}`, ...originalDatabase.palindrome_users.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
    }
    currentTask = await updateBackgroundTaskTracker('current-count');
    if (!await taskScheduler.startNextTask()) { return false; }
  }

  // Single values
  if (currentTask == 'current-count') {
    console.log(`${getDateTime()}: Restoring current count from backup.`);
    if (originalDatabase.current_count !== undefined) {
      await redis.set(`current-count-v${dbVersion}`, originalDatabase.current_count.toString());
    }
    currentTask = await updateBackgroundTaskTracker(`posts-of-${Object.keys(originalDatabase.posts_of)[0]}`);
    if (!await taskScheduler.startNextTask()) { return false; }
  }

  // Group of sorted sets
  if (currentTask.startsWith('posts-of-')) {
    console.log(`${getDateTime()}: Restoring posts of users from backup.`);
    let current_username = currentTask.replace('posts-of-', '');
    let i = 0;
    const nUsers = Object.keys(originalDatabase.posts_of).length;
    for (const [username, posts] of Object.entries(originalDatabase.posts_of) as [string, { member: string; score: number }[]][]) {
      i++;
      if (username != current_username) { continue; }
      if (i % 100 == 0) { console.log(`${getDateTime()}: Restoring posts of ${i}/${nUsers} users (${(i / nUsers * 100).toFixed(1)}%).`); }
      await redis.zAdd(`posts-of-${username}-v${dbVersion}`, ...posts.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
      current_username = Object.keys(originalDatabase.posts_of)[i] ?? '';
      await updateBackgroundTaskTracker(`posts-of-${current_username}`);
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    currentTask = await updateBackgroundTaskTracker(`whole-count-posts-${Object.keys(originalDatabase.whole_count_posts)[0]}`);
  }
  
  if (currentTask.startsWith('whole-count-posts-')) {
    console.log(`${getDateTime()}: Restoring whole count posts from backup.`);
    let current_number = currentTask.replace('whole-count-posts-', '');
    let i = 0;
    const nNumbers = Object.keys(originalDatabase.whole_count_posts).length;
    for (const [number, posts] of Object.entries(originalDatabase.whole_count_posts) as [string, { member: string; score: number }[]][]) {
      i++;
      if (number != current_number) { continue; }
      if (i % 100 == 0) { console.log(`${getDateTime()}: Restoring whole count posts for ${i}/${nNumbers} numbers (${(i / nNumbers * 100).toFixed(1)}%).`); }
      await redis.zAdd(`whole-count-${number}-posts-v${dbVersion}`, ...posts.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
      current_number = Object.keys(originalDatabase.whole_count_posts)[i] ?? '';
      await updateBackgroundTaskTracker(`whole-count-posts-${current_number}`);
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    currentTask = await updateBackgroundTaskTracker(`whole-count-users-${Object.keys(originalDatabase.whole_count_users)[0]}`);
  }

  if (currentTask.startsWith('whole-count-users-')) {
    console.log(`${getDateTime()}: Restoring whole count users from backup.`);
    let current_number = currentTask.replace('whole-count-users-', '');
    let i = 0;
    const nNumbers = Object.keys(originalDatabase.whole_count_users).length;
    for (const [number, users] of Object.entries(originalDatabase.whole_count_users) as [string, { member: string; score: number }[]][]) {
      i++;
      if (number != current_number) { continue; }
      if (i % 100 == 0) { console.log(`${getDateTime()}: Restoring whole count users for ${i}/${nNumbers} numbers (${(i / nNumbers * 100).toFixed(1)}%).`); }
      await redis.zAdd(`whole-count-${number}-users-v${dbVersion}`, ...users.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
      current_number = Object.keys(originalDatabase.whole_count_users)[i] ?? '';
      await updateBackgroundTaskTracker(`whole-count-users-${current_number}`);
      if (!await taskScheduler.startNextTask()) { return false; }
    }
    currentTask = await updateBackgroundTaskTracker(`post-info-${Object.keys(originalDatabase.post_info)[0]}`);
  }

  // Group of single values
  if (currentTask.startsWith('post-info-')) {
    let current_postId = currentTask.replace('post-info-', '');
    console.log(`${getDateTime()}: Restoring post info from backup.`);
    const nPosts = await redis.zCard(`posts-v${dbVersion}`);
    let i = 0;
    for (const [postId, postInfo] of Object.entries(originalDatabase.post_info)) {
      i++;
      if (postId != current_postId) { continue; }
      const postInfoStr = String(postInfo);
      await redis.set(`post-info-${postId}-v${dbVersion}`, postInfoStr);
      current_postId = Object.keys(originalDatabase.post_info)[i] ?? '';
      await updateBackgroundTaskTracker(`post-info-${current_postId}`);
      if (i % 100 == 0) { console.log(`${getDateTime()}: Restoring post info for ${i}/${nPosts} posts (${(i / nPosts * 100).toFixed(1)}%).`); }
      if (!await taskScheduler.startNextTask()) {  return false; }
    }
    currentTask = await updateBackgroundTaskTracker(`other-streaks-of-${Object.keys(originalDatabase.other_streaks_of)[0]}`);
  }

  if (currentTask.startsWith('other-streaks-of-')) {
    console.log(`${getDateTime()}: Restoring other streaks of users from backup.`);
    let current_username = currentTask.replace('other-streaks-of-', '');
    let i = 0;
    for (const [username, otherStreaks] of Object.entries(originalDatabase.other_streaks_of)) {
      i++;
      if (username != current_username) { continue; }
      const otherStreaksStr = String(otherStreaks);
      await redis.set(`other-streaks-of-${username}-v${dbVersion}`, otherStreaksStr);
      current_username = Object.keys(originalDatabase.other_streaks_of)[i] ?? '';
      await updateBackgroundTaskTracker(`other-streaks-of-${current_username}`);
      if (!await taskScheduler.startNextTask()) { return false; }
    }
  }

  console.log(`${getDateTime()}: Database backup restored successfully for version ${dbVersion}.`);
  return true;
}