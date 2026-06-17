import { context, reddit } from '@devvit/web/server';
import { isPostDeleted, addToEndOfQueue } from './helpers';
import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';

async function calculateStreakForTimezone(earlier_timestamps: number[], other_streak_sources: any, timestamp: number, timeZone: string): Promise<{ streak: number, COAD_streak: number}> {
  // TODO: Stop loop if it is clear that it won't get better. For example, the last post was more than 48 hours ago.
  // TODO: Handle LOCAL saved streaks

  // Sort timestamps from latest to earliest
  earlier_timestamps.sort((a, b) => b - a);

  // Transform all timestamps to dates
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'});
  let today_datetime = new Date(timestamp);
  let today = dateFormatter.format(today_datetime);
  let yesterday_datetime = new Date(timestamp);
  yesterday_datetime.setDate(yesterday_datetime.getDate() - 1);
  let yesterday = dateFormatter.format(yesterday_datetime);

  // Find all possible COAD streaks
  let COAD_dates = [];
  if (other_streak_sources != undefined) {
    for (const streak of other_streak_sources) {
      if (streak.source === 'COAD') {
        COAD_dates.push([dateFormatter.format(new Date(streak.timestamp)), streak.streak]);
      }
    }
  }

  let streak = 0;
  let COAD_streak = 0;
  let last_timestamp: number|null = null;
  for (const post_timestamp of earlier_timestamps) {
    const post_date = dateFormatter.format(post_timestamp);
    if (last_timestamp == null && (post_date == today || post_date == yesterday)) { // This was the first post, and it was today or yesterday
      streak = 1;
      last_timestamp = post_timestamp;
    }
    else if (last_timestamp != null) { // This was not the first post
      let previous_day_datetime = new Date(last_timestamp);
      previous_day_datetime.setDate(previous_day_datetime.getDate() - 1);
      if (post_date == dateFormatter.format(previous_day_datetime)) { // The previous post was one day apart
        for (const [date, streak_value] of COAD_dates) {
          if (date === post_date) {
            COAD_streak = Math.max(COAD_streak, streak_value + streak);
          }
        }
        streak++;
        last_timestamp = post_timestamp;
      }
      else { break; }
    }
    else { streak = 0; break; } // Previous post was earlier than today or yesterday

    if (last_timestamp != null) {
      let previous_day_datetime = new Date(last_timestamp);
      previous_day_datetime.setDate(previous_day_datetime.getDate() - 1);
      for (const [date, streak_value] of COAD_dates) {
        if (date === dateFormatter.format(previous_day_datetime)) {
          COAD_streak = Math.max(COAD_streak, streak_value + streak);
        }
      }
    }
  }

  return {streak: streak, COAD_streak: COAD_streak};
}

async function calculateStreak(username: string, timestamp?: number): Promise<{ streak: number, COAD_streak: number}> {
  // Note that the streak is not recorded in the database! Use record_streak for that!

  if (timestamp == undefined) { timestamp = Date.now(); }

  let earlier_posts = await redis.zRange(`posts-of-${username}`, 0, -1);
  let earlier_timestamps = [];
  for (const postInfo of earlier_posts) {
    const earlier_timestamp = postInfo['score'];
    if (earlier_timestamp > timestamp) { continue; } // Only handle timestamps before the current timestamp
    // TODO: Possibly stop the loop instead of continue if the timestamps are sorted and we have reached a timestamp that is before the current timestamp, to avoid unnecessary loops
    earlier_timestamps.push(earlier_timestamp);
  }

  let other_streak_sources = await redis.get(`other-streaks-of-${username}`);
  if (other_streak_sources != undefined) { other_streak_sources = JSON.parse(other_streak_sources); }

  let max_streak = 0;
  let max_COAD_streak = 0;
  for (const timeZone of Intl.supportedValuesOf('timeZone')) { // TODO: Stop when the max streak is found (nPosts + local streak == streak) and (nPosts + COAD streak == COAD streak)
    const { streak, COAD_streak } = await calculateStreakForTimezone(earlier_timestamps, other_streak_sources, timestamp, timeZone);
    max_streak = Math.max(max_streak, streak);
    max_COAD_streak = Math.max(max_COAD_streak, COAD_streak);
  }
  return { streak: max_streak, COAD_streak: max_COAD_streak };
}

async function getTextFromFlair(text: string): Promise<string> {
	if (/^Streak: \d+$/.test(text)) { return ''; }
	const match = text.match(/^(.*) - Streak: \d+$/);
	return match?.[1] || text;
}

async function updateUserFlair(username: string, streak: number) {
	const user = await reddit.getUserByUsername(username);
	if (user) {
		let flairGenerator = await user.getUserFlairBySubreddit(context.subredditName);
		let currentFlair = '';
		if (flairGenerator != undefined) { currentFlair = flairGenerator.flairText? flairGenerator.flairText : ''; }

		const flairText = await getTextFromFlair(currentFlair);

		let userFlair = "";
		if (flairText.length > 0) { userFlair = flairText + " - "; }

		userFlair += "Streak: " + streak;
		if (username === "chickenladybot") { userFlair = "Streak: 3.1415926535"; }

		if (currentFlair != userFlair) { await reddit.setUserFlair({ username: username, subredditName: context.subredditName, text: userFlair }); }
	}
}

export async function handleStreak(): Promise<{ status: string; message: string; number: number }> {
	// Only removes from the beginning of the queue
  const startTime = Date.now();
	
  while (await redis.zCard('streak-queue') > 0) {
    const startTimeCurrentPost = Date.now();
    const postInfo = (await redis.zRange('streak-queue', 0, 0))[0];
    if (postInfo == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
    const postId = postInfo['member'];

    const post = await reddit.getPostById(postId as T3);

		const username = post.authorName;
		const timestamp = post.createdAt.getTime();
    const streak = await calculateStreak(username, timestamp); // FIXME: Test COAD streaks

		await redis.zAdd('current-streaks', { member: username, score: streak.streak });
		await redis.zAdd('current-COAD-streaks', { member: username, score: streak.COAD_streak });
		await updateUserFlair(username, Math.max(streak.streak, streak.COAD_streak));

		if (await isPostDeleted(post)) {
			await addToEndOfQueue('deleted-post-queue', postId);
			await redis.zRem('streak-queue', [postId]);
		}
		else {
			await redis.zAdd('post-streaks', { member: postId, score: streak.streak });
			await redis.zAdd('post-COAD-streaks', { member: postId, score: streak.COAD_streak });

			const current_queue_score = await redis.zScore('streak-queue', postId);
			if (current_queue_score == postInfo['score']) { await redis.zRem('streak-queue', [postId]); } // Only remove the post from the queue if it has not been added again with a new score. That's because it gets added to the queue again if a post before it was deleted, which might have influence on the streak
		}

		const processingTime = Date.now() - startTimeCurrentPost;
    const timeLeft = 30000 - (Date.now() - startTime);
    if (timeLeft < processingTime * 1.5 || timeLeft < 10000) {
      break; // Stop processing more posts if we are running out of time, to ensure we finish before the time-out of 30 seconds.
    }
	}
	return { status: 'success', message: `Streaks calculated`, number: 200 };
}

export async function handleBackgroundStreak() {
	let current_user_score = parseInt(await redis.get('background-task-tracker') || '0');
	while (true) {
		const current_user = (await redis.zRange('users', current_user_score, '+inf', { by: 'score' }))[0];
		if (current_user == undefined) { return; }

		const streaks = await calculateStreak(current_user.member);

		await redis.zAdd('current-streaks', { member: current_user.member, score: streaks.streak });
		await redis.zAdd('current-COAD-streaks', { member: current_user.member, score: streaks.COAD_streak });
		await updateUserFlair(current_user.member, Math.max(streaks.streak, streaks.COAD_streak));

		current_user_score = current_user.score + 1;
		await redis.set('background-task-tracker', current_user_score.toString());
	}
}