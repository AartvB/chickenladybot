import { Hono } from 'hono';
import type { OnAppInstallRequest, OnAppUpgradeRequest, OnPostDeleteRequest, T3, TriggerResponse } from '@devvit/web/shared';
import { reddit, redis } from '@devvit/web/server';
import { addToEndOfQueue, botExplainer, DBVersion, getDateTime, isPostDeletedEarly } from '../core/helpers';
import originalDatabase from '../core/original_database.json';
  
export const triggers = new Hono();

async function restoreDatabaseBackup(removeExistingData: boolean = true) {
  // Restore backup from the database of the original chickenbot that used PRAW and SQLLite
  const dbVersion = await DBVersion();
  await redis.set('new-post-handler-lock-v' + dbVersion, 'open');
  await redis.set('streak-handler-lock-v' + dbVersion, 'open');
  await redis.set('deleted-post-handler-lock-v' + dbVersion, 'open');
  await redis.set('shutdown-lock-v' + dbVersion, 'hard');
  await redis.set('current-background-task-v' + dbVersion, 'flair');
  await redis.set('background-task-tracker-v' + dbVersion, '0');
  await redis.set('new-post-limit-v' + dbVersion, '10');
  await redis.set('current-count-post-id-v' + dbVersion, '1iulihu');

  if (removeExistingData) {
    console.log(`${getDateTime()}: Removing existing data from database.`);
    await redis.del(`users-v${dbVersion}`);
    await redis.del(`posts-v${dbVersion}`);
    await redis.del(`early-deleted-posts-v${dbVersion}`);
    await redis.del(`current-streaks-v${dbVersion}`);
    await redis.del(`current-COAD-streaks-v${dbVersion}`);
    await redis.del(`post-streaks-v${dbVersion}`);
    await redis.del(`post-COAD-streaks-v${dbVersion}`);
    await redis.del(`top-COAD-streaks-v${dbVersion}`);
    await redis.del(`top-streaks-v${dbVersion}`);
    await redis.del(`post-upvotes-v${dbVersion}`);
    await redis.del(`post-comments-v${dbVersion}`);
    await redis.del(`posts-per-user-v${dbVersion}`);
    await redis.del(`identical-digits-posts-v${dbVersion}`);
    await redis.del(`identical-digits-users-v${dbVersion}`);
    await redis.del(`palindrome-posts-v${dbVersion}`);
    await redis.del(`palindrome-users-v${dbVersion}`);
    await redis.del(`current-count-v${dbVersion}`);
    for (const [username, _] of Object.entries(originalDatabase.posts_of)) {
      await redis.del(`posts-of-${username}-v${dbVersion}`);
    }
    for (const [number, _] of Object.entries(originalDatabase.whole_count_posts)) {
      await redis.del(`whole-count-${number}-posts-v${dbVersion}`);
    }
    for (const [number, _] of Object.entries(originalDatabase.whole_count_users)) {
      await redis.del(`whole-count-${number}-users-v${dbVersion}`);
    }
    let i = 0;
    const nPosts = Object.keys(originalDatabase.post_info).length;
    for (const [postId, _] of Object.entries(originalDatabase.post_info)) {
      if (i % 1000 == 0) { console.log(`${getDateTime()}: Deleting post info for ${i}/${nPosts} posts (${(i / nPosts * 100).toFixed(1)}%).`); }
      await redis.del(`post-info-${postId}-v${dbVersion}`);
      i++;
    }
    for (const [username, _] of Object.entries(originalDatabase.other_streaks_of)) {
      await redis.del(`other-streaks-of-${username}-v${dbVersion}`);
    }

    console.log(`${getDateTime()}: Database emptied successfully for version ${dbVersion}.`);
  }

  console.log(`${getDateTime()}: Restoring users from backup.`);
  await redis.zAdd(`users-v${dbVersion}`, ...originalDatabase.users.map((user) => ({member: user.member, score: user.score, })));
  console.log(`${getDateTime()}: Restoring posts from backup.`);
  await redis.zAdd(`posts-v${dbVersion}`, ...originalDatabase.posts.map((post) => ({member: post.member, score: post.score, })));
  console.log(`${getDateTime()}: Restoring early-deleted posts from backup.`);
  await redis.zAdd(`early-deleted-posts-v${dbVersion}`, ...originalDatabase.early_deleted_posts.map((post) => ({ member: post.member, score: post.score })));
  console.log(`${getDateTime()}: Restoring current streaks from backup.`);
  await redis.zAdd(`current-streaks-v${dbVersion}`, ...originalDatabase.current_streaks.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
  console.log(`${getDateTime()}: Restoring current COAD streaks from backup.`);
  await redis.zAdd(`current-COAD-streaks-v${dbVersion}`, ...originalDatabase.current_COAD_streaks.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
  console.log(`${getDateTime()}: Restoring post streaks from backup.`);
  await redis.zAdd(`post-streaks-v${dbVersion}`, ...originalDatabase.post_streaks.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
  console.log(`${getDateTime()}: Restoring post COAD streaks from backup.`);
  await redis.zAdd(`post-COAD-streaks-v${dbVersion}`, ...originalDatabase.post_COAD_streaks.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
  console.log(`${getDateTime()}: Restoring top streaks from backup.`);
  await redis.zAdd(`top-COAD-streaks-v${dbVersion}`, ...originalDatabase.top_COAD_streaks.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
  console.log(`${getDateTime()}: Restoring top COAD streaks from backup.`);
  await redis.zAdd(`top-streaks-v${dbVersion}`, ...originalDatabase.top_streaks.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
  console.log(`${getDateTime()}: Restoring post upvotes from backup.`);
  await redis.zAdd(`post-upvotes-v${dbVersion}`, ...originalDatabase.post_upvotes.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
  console.log(`${getDateTime()}: Restoring post comments from backup.`);
  await redis.zAdd(`post-comments-v${dbVersion}`, ...originalDatabase.post_comments.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
  console.log(`${getDateTime()}: Restoring posts per user from backup.`);
  await redis.zAdd(`posts-per-user-v${dbVersion}`, ...originalDatabase.posts_per_user.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
  console.log(`${getDateTime()}: Restoring identical digits posts from backup.`);
  await redis.zAdd(`identical-digits-posts-v${dbVersion}`, ...originalDatabase.identical_digits_posts.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
  console.log(`${getDateTime()}: Restoring identical digits users from backup.`);
  await redis.zAdd(`identical-digits-users-v${dbVersion}`, ...originalDatabase.identical_digits_users.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));
  console.log(`${getDateTime()}: Restoring palindrome posts from backup.`);
  await redis.zAdd(`palindrome-posts-v${dbVersion}`, ...originalDatabase.palindrome_posts.map((post: { member: string; score: number }) => ({ member: post.member, score: post.score })));
  console.log(`${getDateTime()}: Restoring palindrome users from backup.`);
  await redis.zAdd(`palindrome-users-v${dbVersion}`, ...originalDatabase.palindrome_users.map((user: { member: string; score: number }) => ({ member: user.member, score: user.score })));

  // Single values
  console.log(`${getDateTime()}: Restoring current count from backup.`);
  await redis.set(`current-count-v${dbVersion}`, originalDatabase.current_count.toString());

  // Group of sorted sets
  console.log(`${getDateTime()}: Restoring posts of users from backup.`);
  for (const [username, posts] of Object.entries(originalDatabase.posts_of)) {
    await redis.zAdd(`posts-of-${username}-v${dbVersion}`, ...posts.map((post) => ({ member: post.member, score: post.score })));
  }

  console.log(`${getDateTime()}: Restoring whole count posts from backup.`);
  for (const [number, posts] of Object.entries(originalDatabase.whole_count_posts)) {
    await redis.zAdd(`whole-count-${number}-posts-v${dbVersion}`, ...posts.map((post) => ({ member: post.member, score: post.score })));
  }

  console.log(`${getDateTime()}: Restoring whole count users from backup.`);
  for (const [number, users] of Object.entries(originalDatabase.whole_count_users)) {
    await redis.zAdd(`whole-count-${number}-users-v${dbVersion}`, ...users.map((user) => ({ member: user.member, score: user.score })));
  }

  // Group of single values
  console.log(`${getDateTime()}: Restoring post info from backup.`);
  const nPosts = await redis.zCard(`posts-v${dbVersion}`);
  let i = 0;
  for (const [postId, postInfo] of Object.entries(originalDatabase.post_info)) {
    if (i % 1000 == 0) { console.log(`${getDateTime()}: Restoring post info for ${i}/${nPosts} posts (${(i / nPosts * 100).toFixed(1)}%).`); }
    const postInfoStr = String(postInfo);
    await redis.set(`post-info-${postId}-v${dbVersion}`, postInfoStr);
     i++;
  }

  console.log(`${getDateTime()}: Restoring other streaks of users from backup.`);
  for (const [username, otherStreaks] of Object.entries(originalDatabase.other_streaks_of)) {
    const otherStreaksStr = String(otherStreaks);
    await redis.set(`other-streaks-of-${username}-v${dbVersion}`, otherStreaksStr);
  }

  console.log(`${getDateTime()}: Database backup restored successfully for version ${dbVersion}.`);
}

// TODO: Write code to update redis database when the database has been restored after accidentally removing the bot from the subreddit.

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  const dbVersion = '1';
  await redis.set('database-version', dbVersion);
  await restoreDatabaseBackup(false);

  return c.json<TriggerResponse>({status: 'success',},200);
});

triggers.post('/on-app-upgrade', async (c) => {
  const input = await c.req.json<OnAppUpgradeRequest>();
  console.log('App upgraded in subreddit: r/' + input.subreddit?.name);

  return c.json<TriggerResponse>({status: 'success',},200);
});

triggers.post('/on-post-delete', async (c) => {
  // When a post gets deleted, add it to the early (within 10 minutes) or late (after 10 minutes) queue.
  const input = await c.req.json<OnPostDeleteRequest>();
  const dbVersion = await DBVersion();
  const postId = input.postId;
  const timestamp_str = input.createdAt;
  let timestamp: number;
  if (timestamp_str) { timestamp = new Date(timestamp_str).getTime(); }
  else { timestamp = await redis.zScore(`posts-v${dbVersion}`, postId) || Date.now(); }

  if (timestamp > Date.now() - 10 * 60000) { await addToEndOfQueue(`early-deleted-post-queue-v${dbVersion}`, postId); } // TODO: Remove magic number 10
  else if (!(await isPostDeletedEarly(postId as T3))) { 
    await redis.zAdd(`late-deleted-post-queue-v${dbVersion}`, {member: postId, score: Date.now()});
    let message = `This post has been removed by you or a moderator after 10 minutes of posting it. Therefore this post will still count as your post for this day and keeps contributing to your streak. You may post again at the next calendar day.` // TODO: Remove magic number 10
    message += await botExplainer();
    await reddit.submitComment({id: postId as T3, text: message, runAs: 'APP'});
  }

  return c.json<TriggerResponse>({status: 'success',}, 200);
});