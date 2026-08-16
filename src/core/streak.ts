import { context, reddit } from '@devvit/web/server';
import { isPostDeletedEarly, DBVersion, TaskScheduler, getDateTime } from './helpers';
import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';

async function calculateStreakForTimezone(earlierTimestamps: number[], otherStreakSources: undefined | {streak: number, source: string, timestamp: number}[], timestamp: number, timeZone: string): Promise<{ streak: number, CoadStreak: number}> {
  // TODO: Stop loop if it is clear that it won't get better. For example, the last post was more than 48 hours ago.
  // TODO: Handle LOCAL saved streaks

  // Sort timestamps from latest to earliest
  earlierTimestamps.sort((a, b) => b - a);

  // Transform all timestamps to dates
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'});
  const todayDatetime = new Date(timestamp);
  const today = dateFormatter.format(todayDatetime);
  const yesterdayDatetime = new Date(timestamp);
  yesterdayDatetime.setDate(yesterdayDatetime.getDate() - 1);
  const yesterday = dateFormatter.format(yesterdayDatetime);

  // Find all possible COAD streaks
  const CoadDates = [];
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
      const previousDayDatetime = new Date(lastTimestamp);
      previousDayDatetime.setDate(previousDayDatetime.getDate() - 1);
      if (postDate == dateFormatter.format(previousDayDatetime)) { // The previous post was one day apart
        for (const [date, streakValue] of CoadDates) {
          if (date === postDate) {
            if (typeof streakValue != 'number') { throw new Error(`Invalid streak value: ${streakValue}`); }
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
      const previousDayDatetime = new Date(lastTimestamp);
      previousDayDatetime.setDate(previousDayDatetime.getDate() - 1);
      for (const [date, streakValue] of CoadDates) {
        if (date === dateFormatter.format(previousDayDatetime)) {
          if (typeof streakValue != 'number') { throw new Error(`Invalid streak value: ${streakValue}`); }
          CoadStreak = Math.max(CoadStreak, streakValue + streak);
        }
      }
    }
  }

  return {streak: streak, CoadStreak: CoadStreak};
}

async function calculateStreak(username: string, timestamp?: number): Promise<{ streak: number, CoadStreak: number}> {
  // Note that the streak is not recorded in the database!
  const dbVersion = await DBVersion();
  if (timestamp == undefined) { timestamp = Date.now(); }
  const earlierPosts = await redis.zRange(`posts-of-${username}-v${dbVersion}`, 0, -1);
  const earlierTimestamps = [];
  for (const postInfo of earlierPosts) {
    const earlierTimestamp = postInfo['score'];
    if (earlierTimestamp > timestamp) { continue; } // Only handle timestamps before the current timestamp
    // TODO: Possibly stop the loop instead of continue if the timestamps are sorted and we have reached a timestamp that is before the current timestamp, to avoid unnecessary loops
    earlierTimestamps.push(earlierTimestamp);
  }

  const otherStreakSourcesStr = await redis.get(`other-streaks-of-${username}-v${dbVersion}`);
  let otherStreakSources = undefined;
  if (otherStreakSourcesStr != undefined) {
    otherStreakSources = JSON.parse(otherStreakSourcesStr);
  }

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
		const flairGenerator = await user.getUserFlairBySubreddit(context.subredditName);
		let currentFlair = '';
		if (flairGenerator != undefined) { currentFlair = flairGenerator.flairText? flairGenerator.flairText : ''; }

		const flairText = await getTextFromFlair(currentFlair);

		let userFlair = "";
		if (flairText.length > 0) { userFlair = flairText + " - "; }

    if (streak > 0) { userFlair += "Streak: " + streak; }
    else { userFlair = flairText; }

		if (username === "chickenladybot") { userFlair = "Streak: 3.1415926535"; }

		if (currentFlair != userFlair) {
      console.log(`${getDateTime()}: Updating flair for user ${username} to streak ${streak} (current flair: '${currentFlair}', flair text: '${flairText}', new flair: '${userFlair}')`);
      try { await reddit.setUserFlair({ username: username, subredditName: context.subredditName, text: userFlair }); }
      catch (error) { console.error(`${getDateTime()}: Error updating flair for user ${username} to streak ${streak} (current flair: '${currentFlair}', flair text: '${flairText}', new flair: '${userFlair}'):`, error); }
    }
	}
}

export async function handleStreak(): Promise<{ status: string; message: string; number: number }> {
	// Only removes from the beginning of the queue
  const dbVersion = await DBVersion();
  const taskScheduler = new TaskScheduler({ stopAtSoftShutdown: true });
	
  while (await redis.zCard(`streak-queue-v${dbVersion}`) > 0 && await taskScheduler.startNextTask()) {
    const postInfo = (await redis.zRange(`streak-queue-v${dbVersion}`, 0, 0))[0];
    if (postInfo == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
    const postId = postInfo['member'];

    const post = await reddit.getPostById(postId as T3);

		const username = post.authorName;
		const timestamp = post.createdAt.getTime();

    console.log(`${getDateTime()}: Calculating streak for user ${username} based on post ${postId} (timestamp: ${timestamp})`);
    const streak = await calculateStreak(username, timestamp);

		await redis.zAdd(`current-streaks-v${dbVersion}`, { member: username, score: streak.streak });
		await redis.zAdd(`current-COAD-streaks-v${dbVersion}`, { member: username, score: streak.CoadStreak });
		await updateUserFlair(username, Math.max(streak.streak, streak.CoadStreak));

		if (await isPostDeletedEarly(postId as T3)) { await redis.zRem(`streak-queue-v${dbVersion}`, [postId]); }
		else {
			await redis.zAdd(`post-streaks-v${dbVersion}`, { member: postId, score: streak.streak });
			await redis.zAdd(`post-COAD-streaks-v${dbVersion}`, { member: postId, score: streak.CoadStreak });

			const currentQueueScore = await redis.zScore(`streak-queue-v${dbVersion}`, postId);
			if (currentQueueScore == postInfo['score']) { await redis.zRem(`streak-queue-v${dbVersion}`, [postId]); } // Only remove the post from the queue if it has not been added again with a new score. That's because it gets added to the queue again if a post before it was deleted, which might have influence on the streak
		}
	}
	return { status: 'success', message: `Streaks calculated`, number: 200 };
}

export async function handleBackgroundStreak() {
  const taskScheduler = new TaskScheduler({ stopAtSoftShutdown: true });
  if (await taskScheduler.endTask()) { return false; }
  const dbVersion = await DBVersion();
	let currentUserScore = parseInt(await redis.get(`background-task-tracker-v${dbVersion}`) ?? '0');
  const nUsers = await redis.zCard(`users-v${dbVersion}`);
  console.log(`${getDateTime()}: Starting streak background update from user score ${currentUserScore} out of ${nUsers} users`);
	while (await taskScheduler.startNextTask()) {
		const currentUser = (await redis.zRange(`users-v${dbVersion}`, currentUserScore, '+inf', { by: 'score' }))[0];
		if (currentUser == undefined) {
			return true;
		}

		const streaks = await calculateStreak(currentUser.member);

		await redis.zAdd(`current-streaks-v${dbVersion}`, { member: currentUser.member, score: streaks.streak });
		await redis.zAdd(`current-COAD-streaks-v${dbVersion}`, { member: currentUser.member, score: streaks.CoadStreak });
		await updateUserFlair(currentUser.member, Math.max(streaks.streak, streaks.CoadStreak));

		currentUserScore = currentUser.score + 1;
		await redis.set(`background-task-tracker-v${dbVersion}`, currentUserScore.toString());
	}
  return false;
}