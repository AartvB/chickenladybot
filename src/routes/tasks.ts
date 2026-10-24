import { Hono } from 'hono';
import { handleBackgroundStreak, handleStreak } from '../core/streak';
import { handleNewPosts, detectNewPosts } from '../core/counting';
import { handleCleanup, handleDeletedPosts } from '../core/deletion';
import { handleLeaderboards } from '../core/leaderboards';
import { DBVersion } from '../core/helpers';
import { addRecentPostsToDatabase } from '../core/counting';
import { redis, type TaskResponse } from '@devvit/web/server';
import { ContentfulStatusCode } from 'hono/utils/http-status';
import { handleDiscord, handleDiscordNSFWCheck } from '../core/discord';

export const tasks = new Hono();

tasks.post('/new-post-handler', async (c) => {
  // Check for new posts or add new posts to the database

  // Only do this if this action is not currently being executed in parralel
  const lockKey = `new-post-handler-lock-v${await DBVersion()}`;
  const now = Date.now();
  const lockStatus = await redis.get(lockKey);
  if (lockStatus != 'open') {
    const lockTime = parseInt(lockStatus || '0');
    if (lockTime >= now - 35 * 1000) { // If the lock has been active for more than 35 seconds, release it and continue processing
      return c.json<TaskResponse>({ status: 'locked' }, 200);
    }
  }
  await redis.set(lockKey, now.toString());
  let result;
  if (await redis.zCard(`new-post-queue-v${await DBVersion()}`) > 0) { result = await handleNewPosts(); } // Handle the posts in the queue
  else { result = await detectNewPosts(); } // Check for new posts and add them to the queue
  await redis.set(lockKey, 'open');
  return c.json<TaskResponse>({ status: result['status'], message: result['message']}, result['number'] as ContentfulStatusCode);
});

tasks.post('/streak-handler', async (c) => {
  // Calculate streaks that have been added to the streak queue
  const lockKey = `streak-handler-lock-v${await DBVersion()}`;
  const now = Date.now();
  const lockStatus = await redis.get(lockKey);
  if (lockStatus != 'open') {
    const lockTime = parseInt(lockStatus || '0');
    if (lockTime >= now - 35 * 1000) { // If the lock has been active for more than 35 seconds, release it and continue processing
      return c.json<TaskResponse>({ status: 'locked' }, 200);
    }
  }
  await redis.set(lockKey, now.toString());
  const result = await handleStreak();
  await redis.set(lockKey, 'open');
  return c.json<TaskResponse>({ status: result['status'], message: result['message']}, result['number'] as ContentfulStatusCode);
});

tasks.post('/deleted-post-handler', async (c) => {
  // Handle the early deleted post queue
  const lockKey = `deleted-post-handler-lock-v${await DBVersion()}`;
  const now = Date.now();
  const lockStatus = await redis.get(lockKey);
  if (lockStatus != 'open') {
    const lockTime = parseInt(lockStatus || '0');
    if (lockTime >= now - 35 * 1000) { // If the lock has been active for more than 35 seconds, release it and continue processing
      return c.json<TaskResponse>({ status: 'locked' }, 200);
    }
  }
  await redis.set(lockKey, now.toString());
  await handleDeletedPosts();
  await redis.set(lockKey, 'open');
  return c.json<TaskResponse>({ status: 'success', message: `Worked on deleted posts`, number: 200 });
});

tasks.post('/discord-handler', async (c) => {
  // Handle the early deleted post queue
  const lockKey = `discord-handler-lock-v${await DBVersion()}`;
  const now = Date.now();
  const lockStatus = await redis.get(lockKey);
  if (lockStatus != 'open') {
    const lockTime = parseInt(lockStatus || '0');
    if (lockTime >= now - 35 * 1000) { // If the lock has been active for more than 35 seconds, release it and continue processing
      return c.json<TaskResponse>({ status: 'locked' }, 200);
    }
  }
  await redis.set(lockKey, now.toString());
  await handleDiscord();
  await redis.set(lockKey, 'open');
  return c.json<TaskResponse>({ status: 'success', message: `Worked on discord link`, number: 200 });
});

tasks.post('/background-task-handler', async (c) => {
  // Handles tasks that are not time-sensitive. It performs 5 tasks: 'setup', 'flair', 'leaderboard', 'cleanup' and 'discord-nsfw-check'.
  // Setup: Setup the database for the first time, when the bot is installed.
  // Flair: Check flair of all users if it is still accurate. If a user has not posted for too long, their streak should be reset to 0.
  // Leaderboard: Update the leaderboard statistics and update the leaderboard.
  // Cleanup: Remove posts that have been deleted more than 21 days ago from the database, for privacy reasons.
  // Discord NSFW check: Check if the posts that have been sent to discord within the last 21 days have been changed to NSFW, and if they were, change the discord message to reflect this. This is to prevent NSFW content from being sent to discord uncensored.
  // It takes many calls to finish a task, and when it finishes a task, it continues with the next task.

  const lockKey = `background-task-handler-lock-v${await DBVersion()}`;
  const now = Date.now();
  const lockStatus = await redis.get(lockKey);
  if (lockStatus != 'open') {
    const lockTime = parseInt(lockStatus || '0');
    if (lockTime >= now - 35 * 1000) { // If the lock has been active for more than 35 seconds, release it and continue processing
      return c.json<TaskResponse>({ status: 'locked' }, 200);
    }
  }
  await redis.set(lockKey, now.toString());

  const currentTask = await redis.get(`current-background-task-v${await DBVersion()}`);
  if (currentTask == 'flair') {
    if (await handleBackgroundStreak()) {
      await redis.set(`current-background-task-v${await DBVersion()}`, 'leaderboard');
      await redis.del(`background-task-tracker-v${await DBVersion()}`);
    }
  }
  else if (currentTask == 'leaderboard') {
    if (await handleLeaderboards()) {
      await redis.set(`current-background-task-v${await DBVersion()}`, 'cleanup');
      await redis.del(`background-task-tracker-v${await DBVersion()}`);
    }
  }
  else if (currentTask == 'cleanup') {
    if (await handleCleanup()) {
      await redis.set(`current-background-task-v${await DBVersion()}`, 'discord-nsfw-check');
      await redis.del(`background-task-tracker-v${await DBVersion()}`);
    }
  }
  else if (currentTask == 'discord-nsfw-check') {
    if (await handleDiscordNSFWCheck()) {
      await redis.set(`current-background-task-v${await DBVersion()}`, 'flair');
      await redis.del(`background-task-tracker-v${await DBVersion()}`);
    }
  }
  else if (currentTask == 'setup') {
//    if (await restoreDatabaseBackup(false)) {
    if (await addRecentPostsToDatabase()) {
      await redis.set(`current-background-task-v${await DBVersion()}`, 'flair');
      await redis.del(`background-task-tracker-v${await DBVersion()}`);
    }
  }

  await redis.set(lockKey, 'open');
  return c.json<TaskResponse>({ status: 'success', message: `Worked on background task ${currentTask}`, number: 200 });
});