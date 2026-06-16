import { Hono } from 'hono';
import { handleStreak } from '../core/streak';
import { handleNewPosts, detectNewPosts } from '../core/counting';
import { handleDeletedPosts } from '../core/deletion';
import { redis, type TaskResponse } from '@devvit/web/server';
import { ContentfulStatusCode } from 'hono/utils/http-status';

export const tasks = new Hono();

tasks.post('/new-post-handler', async (c) => {
  // Only do this if this action is not currently being executed in parralel
  const lock_key = 'new-post-handler-lock';
  const now = Date.now();
  const lockStatus = await redis.get(lock_key);
  if (lockStatus != 'open') {
    const lockTime = parseInt(lockStatus || '0');
    if (lockTime >= now - 35 * 1000) { // If the lock has been active for more than 35 seconds, release it and continue processing
      return c.json<TaskResponse>({ status: 'locked' }, 200);
    }
  }
  await redis.set(lock_key, now.toString());
  let result;
  if (await redis.zCard('new_post_queue') > 0) { result = await handleNewPosts(); } // Handle the posts in the queue
  else { result = await detectNewPosts(); } // Check for new posts and add them to the queue
  await redis.set(lock_key, 'open');
  return c.json<TaskResponse>({ status: result['status'], message: result['message']}, result['number'] as ContentfulStatusCode);
});

tasks.post('/streak-handler', async (c) => {
  const lock_key = 'streak-handler-lock';
  const now = Date.now();
  const lockStatus = await redis.get(lock_key);
  if (lockStatus != 'open') {
    const lockTime = parseInt(lockStatus || '0');
    if (lockTime >= now - 35 * 1000) { // If the lock has been active for more than 35 seconds, release it and continue processing
      return c.json<TaskResponse>({ status: 'locked' }, 200);
    }
  }
  await redis.set(lock_key, now.toString());
  const result = await handleStreak();
  await redis.set(lock_key, 'open');
  return c.json<TaskResponse>({ status: result['status'], message: result['message']}, result['number'] as ContentfulStatusCode);
});

tasks.post('/deleted-post-handler', async (c) => {
  const lock_key = 'deleted-post-handler-lock';
  const now = Date.now();
  const lockStatus = await redis.get(lock_key);
  if (lockStatus != 'open') {
    const lockTime = parseInt(lockStatus || '0');
    if (lockTime >= now - 35 * 1000) { // If the lock has been active for more than 35 seconds, release it and continue processing
      return c.json<TaskResponse>({ status: 'locked' }, 200);
    }
  }
  await redis.set(lock_key, now.toString());
  const result = await handleDeletedPosts();
  await redis.set(lock_key, 'open');
  return c.json<TaskResponse>({ status: result['status'], message: result['message']}, result['number'] as ContentfulStatusCode);
});