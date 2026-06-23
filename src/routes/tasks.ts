import { Hono } from 'hono';
import { handleBackgroundStreak, handleStreak } from '../core/streak';
import { handleNewPosts, detectNewPosts } from '../core/counting';
import { handleDeletedPosts } from '../core/deletion';
import { handleLeaderboards } from '../core/leaderboards';
import { redis, type TaskResponse } from '@devvit/web/server';
import { ContentfulStatusCode } from 'hono/utils/http-status';

export const tasks = new Hono();

tasks.post('/new-post-handler', async (c) => {
  // Only do this if this action is not currently being executed in parralel
  const lockKey = 'new-post-handler-lock';
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
  if (await redis.zCard('new-post-queue') > 0) { result = await handleNewPosts(); } // Handle the posts in the queue
  else { result = await detectNewPosts(); } // Check for new posts and add them to the queue
  await redis.set(lockKey, 'open');
  return c.json<TaskResponse>({ status: result['status'], message: result['message']}, result['number'] as ContentfulStatusCode);
});

tasks.post('/streak-handler', async (c) => {
  const lockKey = 'streak-handler-lock';
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
  const lockKey = 'deleted-post-handler-lock';
  const now = Date.now();
  const lockStatus = await redis.get(lockKey);
  if (lockStatus != 'open') {
    const lockTime = parseInt(lockStatus || '0');
    if (lockTime >= now - 35 * 1000) { // If the lock has been active for more than 35 seconds, release it and continue processing
      return c.json<TaskResponse>({ status: 'locked' }, 200);
    }
  }
  await redis.set(lockKey, now.toString());
  const result = await handleDeletedPosts();
  await redis.set(lockKey, 'open');
  return c.json<TaskResponse>({ status: result['status'], message: result['message']}, result['number'] as ContentfulStatusCode);
});

tasks.post('background-task-handler', async (c) => {
  // Handles tasks that are not time-sensitive. It performs 3 tasks: 'flair', 'leaderboard' and 'cleanup'.
  // Flair: Check flair of all users if it is still accurate. If a user has not posted for too long, their streak should be reset to 0.
  // Leaderboard: Update the leaderboard statistics and update the leaderboard.
  // Cleanup: Remove posts that have been deleted more than 21 days ago from the database, for privacy reasons.
  // It takes many calls to finish a task, and when it finishes a task, it continues with the next task.

  const currentTask = await redis.get('current-background-task');
  console.log(`Current background task: ${currentTask}`);
  if (currentTask == 'flair') {
    await handleBackgroundStreak();
    await redis.set('current-background-task', 'leaderboard');
  }
  else if (currentTask == 'leaderboard') {
    await handleLeaderboards();
    await redis.set('current-background-task', 'cleanup');
  }
  else if (currentTask == 'cleanup') {
    // FIXME: Implement cleanup logic here
    await redis.set('current-background-task', 'flair');
  }
  await redis.del('background-task-tracker');
  return c.json<TaskResponse>({ status: 'success', message: `Background task ${currentTask} completed`, number: 200 });
});