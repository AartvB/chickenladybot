import { context, reddit } from '@devvit/web/server';
import { isPostDeleted, addToEndOfQueue } from './helpers';
import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';

async function calculateStreakForTimezone(earlierTimestamps: number[], otherStreakSources: any, timestamp: number, timeZone: string): Promise<{ streak: number, CoadStreak: number}> {
  // TODO: Stop loop if it is clear that it won't get better. For example, the last post was more than 48 hours ago.
  // TODO: Handle LOCAL saved streaks

  // Sort timestamps from latest to earliest
  earlierTimestamps.sort((a, b) => b - a);

  // Transform all timestamps to dates
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'});
  let todayDatetime = new Date(timestamp);
  let today = dateFormatter.format(todayDatetime);
  let yesterdayDatetime = new Date(timestamp);
  yesterdayDatetime.setDate(yesterdayDatetime.getDate() - 1);
  let yesterday = dateFormatter.format(yesterdayDatetime);

  // Find all possible COAD streaks
  let CoadDates = [];
  if (otherStreakSources != undefined) {
    for (const streak of otherStreakSources) {
      if (streak.source === 'COAD') {
        CoadDates.push([dateFormatter.format(new Date(streak.timestamp)), streak.streak]);
      }
    }
  }

  let streak = 0;
  let CoadStreak = 0;
  let lastTimestamp: number|null = null;
  for (const postTimestamp of earlierTimestamps) {
    const postDate = dateFormatter.format(postTimestamp);
    if (lastTimestamp == null && (postDate == today || postDate == yesterday)) { // This was the first post, and it was today or yesterday
      streak = 1;
      lastTimestamp = postTimestamp;
    }
    else if (lastTimestamp != null) { // This was not the first post
      let previousDayDatetime = new Date(lastTimestamp);
      previousDayDatetime.setDate(previousDayDatetime.getDate() - 1);
      if (postDate == dateFormatter.format(previousDayDatetime)) { // The previous post was one day apart
        for (const [date, streakValue] of CoadDates) {
          if (date === postDate) {
            CoadStreak = Math.max(CoadStreak, streakValue + streak);
          }
        }
        streak++;
        lastTimestamp = postTimestamp;
      }
      else { break; }
    }
    else { streak = 0; break; } // Previous post was earlier than today or yesterday

    if (lastTimestamp != null) {
      let previousDayDatetime = new Date(lastTimestamp);
      previousDayDatetime.setDate(previousDayDatetime.getDate() - 1);
      for (const [date, streakValue] of CoadDates) {
        if (date === dateFormatter.format(previousDayDatetime)) {
          CoadStreak = Math.max(CoadStreak, streakValue + streak);
        }
      }
    }
  }

  return {streak: streak, CoadStreak: CoadStreak};
}

async function calculateStreak(username: string, timestamp?: number): Promise<{ streak: number, CoadStreak: number}> {
  // Note that the streak is not recorded in the database!

  if (timestamp == undefined) { timestamp = Date.now(); }

  let earlierPosts = await redis.zRange(`posts-of-${username}`, 0, -1);
  let earlierTimestamps = [];
  for (const postInfo of earlierPosts) {
    const earlierTimestamp = postInfo['score'];
    if (earlierTimestamp > timestamp) { continue; } // Only handle timestamps before the current timestamp
    // TODO: Possibly stop the loop instead of continue if the timestamps are sorted and we have reached a timestamp that is before the current timestamp, to avoid unnecessary loops
    earlierTimestamps.push(earlierTimestamp);
  }

  let otherStreakSources = await redis.get(`other-streaks-of-${username}`);
  if (otherStreakSources != undefined) { otherStreakSources = JSON.parse(otherStreakSources); }

  let maxStreak = 0;
  let maxCoadStreak = 0;
  for (const timeZone of Intl.supportedValuesOf('timeZone')) { // TODO: Stop when the max streak is found (nPosts + local streak == streak) and (nPosts + COAD streak == COAD streak)
    const { streak, CoadStreak } = await calculateStreakForTimezone(earlierTimestamps, otherStreakSources, timestamp, timeZone);
    maxStreak = Math.max(maxStreak, streak);
    maxCoadStreak = Math.max(maxCoadStreak, CoadStreak);
  }
  return { streak: maxStreak, CoadStreak: maxCoadStreak };
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
		await redis.zAdd('current-COAD-streaks', { member: username, score: streak.CoadStreak });
		await updateUserFlair(username, Math.max(streak.streak, streak.CoadStreak));

		if (await isPostDeleted(post)) {
			await addToEndOfQueue('deleted-post-queue', postId);
			await redis.zRem('streak-queue', [postId]);
		}
		else {
			await redis.zAdd('post-streaks', { member: postId, score: streak.streak });
			await redis.zAdd('post-COAD-streaks', { member: postId, score: streak.CoadStreak });

			const currentQueueScore = await redis.zScore('streak-queue', postId);
			if (currentQueueScore == postInfo['score']) { await redis.zRem('streak-queue', [postId]); } // Only remove the post from the queue if it has not been added again with a new score. That's because it gets added to the queue again if a post before it was deleted, which might have influence on the streak
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
	let currentUserScore = parseInt(await redis.get('background-task-tracker') || '0');
	while (true) {
		const currentUser = (await redis.zRange('users', currentUserScore, '+inf', { by: 'score' }))[0];
		if (currentUser == undefined) {
			await redis.set('background-task-tracker', '0');
			return;
		}

		const streaks = await calculateStreak(currentUser.member);

		await redis.zAdd('current-streaks', { member: currentUser.member, score: streaks.streak });
		await redis.zAdd('current-COAD-streaks', { member: currentUser.member, score: streaks.CoadStreak });
		await updateUserFlair(currentUser.member, Math.max(streaks.streak, streaks.CoadStreak));

		currentUserScore = currentUser.score + 1;
		await redis.set('background-task-tracker', currentUserScore.toString());
	}
}