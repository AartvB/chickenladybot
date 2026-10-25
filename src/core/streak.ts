import { context, reddit, settings } from '@devvit/web/server';
import { isPostDeletedEarly, DBVersion, TaskScheduler, getDateTime, addSubscription, removeSubscription } from './helpers';
import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';

async function calculateStreakForTimezone(earlierTimestamps: number[], otherStreakSources: undefined | {streak: number, source: string, timestamp: number}[], timestamp: number, timeZone: string): Promise<{ streak: number, CoadStreak: number, minTimestampNextPost: number | undefined, maxTimestampNextPost: number | undefined }> {
  // TODO: Stop loop if it is clear that it won't get better. For example, the last post was more than 48 hours ago.

  // Sort timestamps from latest to earliest
  const sortedTimestamps = [...earlierTimestamps].sort((a, b) => b - a);

  // Transform all timestamps to dates
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'});
  const getDate = (timestamp: number): string => { return dateFormatter.format(new Date(timestamp)); };
  const getPreviousDate = (date: string): string => {
    const [year, month, day] = date.split("-").map(Number);
    if (year == undefined || month == undefined || day == undefined) { throw new Error(`Invalid date format: ${date}`);}
    const dateUtc = new Date(Date.UTC(year, month - 1, day - 1, 12));
    const yyyy = dateUtc.getUTCFullYear();
    const mm = String(dateUtc.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dateUtc.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const getNextDate = (date: string): string => {
    const [year, month, day] = date.split("-").map(Number);
    if (year == undefined || month == undefined || day == undefined) { throw new Error(`Invalid date format: ${date}`);}
    const dateUtc = new Date(Date.UTC(year, month - 1, day + 1, 12));
    const yyyy = dateUtc.getUTCFullYear();
    const mm = String(dateUtc.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dateUtc.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const getTimestamp = (date: string, hour: number, minute: number, second: number): number | undefined => {
    const [year, month, day] = date.split("-").map(Number);
    if (year == undefined || month == undefined || day == undefined) { throw new Error(`Invalid date format: ${date}`);}
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    let timestamp = target;

    const formatter = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});

    for (let i = 0; i < 10; i++) {
      const parts = formatter.formatToParts(new Date(timestamp));
      const values: Record<string, number> = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
      if (values.year == undefined || values.month == undefined || values.day == undefined || values.hour == undefined || values.minute == undefined || values.second == undefined) { return undefined; }
      const representedAsUTC = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);

      const offset = representedAsUTC - timestamp;
      const next = target - offset;

      if (next === timestamp) {return timestamp; }
      timestamp = next;
    }
    return undefined;
  }

  const today = getDate(timestamp);
  const yesterday = getPreviousDate(today);

  // Find all possible COAD streaks
  const CoadDates: [string, number][] = [];
  if (otherStreakSources != undefined) {
    for (const streak of otherStreakSources) {
      if (streak.source === 'COAD') {
        CoadDates.push([dateFormatter.format(new Date(streak.timestamp)), streak.streak]);
      }
    }
  }
  const LocalDates: [string, number][] = [];
  if (otherStreakSources != undefined) {
    for (const streak of otherStreakSources) {
      if (streak.source === 'local') {
        LocalDates.push([dateFormatter.format(new Date(streak.timestamp)), streak.streak]);
      }
    }
  }

  let streak = 0;
  let editedStreak = 0;
  let CoadStreak = 0;
  let lastTimestamp: number|null = null;
  let minTimestampNextPost: number | undefined = undefined;
  let maxTimestampNextPost: number | undefined = undefined;
  for (const postTimestamp of sortedTimestamps) {
    const postDate = dateFormatter.format(postTimestamp);
    if (lastTimestamp == null && (postDate == today || postDate == yesterday)) { // This was the first post, and it was today or yesterday
      streak = 1;
      lastTimestamp = postTimestamp;
      const nextDay = getNextDate(postDate);
      minTimestampNextPost = getTimestamp(nextDay, 0, 0, 0);
      maxTimestampNextPost = getTimestamp(nextDay, 23, 59, 59);
    }
    else if (lastTimestamp != null) { // This was not the first post
      const previousDay = getPreviousDate(getDate(lastTimestamp));
      if (postDate == previousDay) { // The previous post was one day apart
        for (const [date, streakValue] of CoadDates) {
          if (date === postDate) {
            CoadStreak = Math.max(CoadStreak, streakValue + streak);
          }
        }
        for (const [date, streakValue] of LocalDates) {
          if (date === postDate) {
            editedStreak = Math.max(editedStreak, streakValue + streak);
          }
        }
        streak++;
        lastTimestamp = postTimestamp;
      }
      else { break; }
    }
    else { streak = 0; break; } // Previous post was earlier than today or yesterday

    if (lastTimestamp != null) {
      const previousDay = getPreviousDate(getDate(lastTimestamp));
      for (const [date, streakValue] of CoadDates) {
        if (date === previousDay) {
          CoadStreak = Math.max(CoadStreak, streakValue + streak);
        }
      }
      for (const [date, streakValue] of LocalDates) {
        if (date === previousDay) {
          editedStreak = Math.max(editedStreak, streakValue + streak - 1);
        }
      }
    }
  }

  return {streak: Math.max(streak, editedStreak), CoadStreak: CoadStreak, minTimestampNextPost: minTimestampNextPost, maxTimestampNextPost: maxTimestampNextPost};
}

async function calculateStreak(username: string, timestamp?: number): Promise<{ streak: number, CoadStreak: number, minTimestampNextPost: number | undefined, maxTimestampNextPost: number | undefined }> {
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
  let minTimestampNextPost: number | undefined = Infinity;
  let maxTimestampNextPost: number | undefined = -Infinity;
  for (const timeZone of Intl.supportedValuesOf('timeZone')) { // TODO: Stop when the max streak is found (nPosts + local streak == streak) and (nPosts + COAD streak == COAD streak)
    const { streak, CoadStreak, minTimestampNextPost: minTimestamp, maxTimestampNextPost: maxTimestamp } = await calculateStreakForTimezone(earlierTimestamps, otherStreakSources, timestamp, timeZone);
    if (minTimestamp == undefined || maxTimestamp == undefined) { minTimestampNextPost = undefined; maxTimestampNextPost = undefined; }
    else if (minTimestampNextPost != undefined && maxTimestampNextPost != undefined) {
      if (streak > maxStreak) { minTimestampNextPost = minTimestamp; maxTimestampNextPost = maxTimestamp; }
      else if (streak == maxStreak && streak > 0) {
        minTimestampNextPost = Math.min(minTimestampNextPost, minTimestamp);
        maxTimestampNextPost = Math.max(maxTimestampNextPost, maxTimestamp);
      }
    }
    maxStreak = Math.max(maxStreak, streak);
    maxCoadStreak = Math.max(maxCoadStreak, CoadStreak);
  }
  if (minTimestampNextPost == Infinity) { minTimestampNextPost = undefined; }
  if (maxTimestampNextPost == -Infinity) { maxTimestampNextPost = undefined; }
  return { streak: maxStreak, CoadStreak: maxCoadStreak, minTimestampNextPost: minTimestampNextPost, maxTimestampNextPost: maxTimestampNextPost };
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

		if (username === "chickenbotonceaday") { userFlair = "Streak: 3.1415926535"; }

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
    const isSubscribed = await redis.zScore(`subscriptions-v${dbVersion}`, username);
    if (streak.minTimestampNextPost != undefined && streak.maxTimestampNextPost != undefined) {
      await redis.zAdd(`start-next-post-timeframe-v${dbVersion}`, { member: username, score: streak.minTimestampNextPost });
      await redis.zAdd(`end-next-post-timeframe-v${dbVersion}`, { member: username, score: streak.maxTimestampNextPost });
      if (isSubscribed) {
        if (streak.minTimestampNextPost > Date.now()) { await redis.zAdd(`first-notifications-list-v${dbVersion}`, { member: username, score: streak.minTimestampNextPost }); }
        if (streak.maxTimestampNextPost - 5 * 60 * 60 * 1000 > Date.now()) { await redis.zAdd(`second-notifications-list-v${dbVersion}`, { member: username, score: streak.maxTimestampNextPost }); }
      }
    }
    else {
      await redis.zRem(`start-next-post-timeframe-v${dbVersion}`, [username]);
      await redis.zRem(`end-next-post-timeframe-v${dbVersion}`, [username]);
      if (isSubscribed && timestamp + 12 * 60 * 60 * 1000 > Date.now()) {
        await redis.zAdd(`untimed-notifications-list-v${dbVersion}`, { member: username, score: timestamp + 12 * 60 * 60 * 1000 });
      }
    }
		await updateUserFlair(username, Math.max(streak.streak, streak.CoadStreak));

		if (await isPostDeletedEarly(postId as T3)) { await redis.zRem(`streak-queue-v${dbVersion}`, [postId]); }
		else {
			await redis.zAdd(`post-streaks-v${dbVersion}`, { member: postId, score: streak.streak });
			await redis.zAdd(`post-COAD-streaks-v${dbVersion}`, { member: postId, score: streak.CoadStreak });

			const currentQueueScore = await redis.zScore(`streak-queue-v${dbVersion}`, postId);
			if (currentQueueScore == postInfo['score']) { await redis.zRem(`streak-queue-v${dbVersion}`, [postId]); } // Only remove the post from the queue if it has not been added again with a new score. That's because it gets added to the queue again if a post before it was deleted, which might have influence on the streak
		}
	}
  const messagesListing = await reddit.getMessages({type: 'unread'});
  const messages = (await messagesListing.all());
  console.log(`${getDateTime()}: Finished calculating streaks for all posts in the streak queue. Now checking the ${messages.length} incoming messages.`);

  for (const message of messages) {
    if (!await taskScheduler.startNextTask()) { break; }
    const user = message.from.id;
    if (user != undefined) {
      if (user.startsWith("t5_")) {
        const subredditName = (await reddit.getSubredditInfoById(user as `t5_${string}`)).name;
        if (subredditName != undefined) { 
          console.log(`${getDateTime()}: Received message from r/${subredditName}`);
          await reddit.sendPrivateMessage({to: 'Aartvb', subject: `[Chickenbot Message] from r/${subredditName}`, text: `The chickenbot received a message from the subreddit r/${subredditName} on ${message.created.toISOString()}. The message was:\n\n${message.body}`});
        }
      }
      else {
        const username = (await reddit.getUserById(user as `t2_${string}`))?.username;
        if (username != undefined) { 
          console.log(`${getDateTime()}: Received message from u/${username}`);
          reddit.sendPrivateMessage({to: 'Aartvb', subject: `[Chickenbot Message] from u/${username}`, text: `The chickenbot received a message from the user u/${username} on ${message.created.toISOString()}. The message was:\n\n${message.body}`});
          if (message.body.toLowerCase().includes('!unsubscribe')) { 
            await removeSubscription(username);
            await reddit.sendPrivateMessage({to: username, subject: `🐔 Unsubscribed from r/${context.subredditName} streak notifications 🐔`, text: `You have been unsubscribed from streak notifications for r/${context.subredditName}. You will no longer receive notifications about your streak. If you want to subscribe again, respond with "!subscribe" in this conversation.`});
          }
          if (message.body.toLowerCase().includes('!subscribe')) {
            await addSubscription(username);
            await reddit.sendPrivateMessage({to: username, subject: `🐔 Subscribed to r/${context.subredditName} streak notifications 🐔`, text: `You have been subscribed to streak notifications for r/${context.subredditName}. You will receive notifications about your streak. If you want to unsubscribe, respond with "!unsubscribe" in this conversation.`});
          }
        }
      }
    }
    await message.markAsRead();
  }
  
  console.log(`${getDateTime()}: Finished processing incoming messages. Now sending notification messages to users.`);
  const now = Date.now();
  while (true) {
    if (!await taskScheduler.startNextTask()) { break; }
    const userToRemind = (await redis.zRange(`first-notifications-list-v${dbVersion}`, 0, now, { by: 'score' }))[0];
    if (userToRemind == undefined) { break; }
    const currentStreak = await redis.zScore(`current-streaks-v${dbVersion}`, userToRemind.member);
    reddit.sendPrivateMessage({to: userToRemind.member, subject: `🐔 Post to r/${context.subredditName} to maintain your streak! 🐔`, text: `Hey! Just a little reminder to visit r/${context.subredditName} and keep your ${currentStreak == undefined ? '' : `${currentStreak}-day ` }streak going! We'd love to see you there. Stay fabulous, stay counting, and remember: you are egg-straordinary! To unsubscribe from these notifications, respond with "!unsubscribe" in this conversation.`});
    await redis.zRem(`first-notifications-list-v${dbVersion}`, [userToRemind.member]);
  }
  while (true) {
    if (!await taskScheduler.startNextTask()) { break; }
    const userToRemind = (await redis.zRange(`second-notifications-list-v${dbVersion}`, 0, now, { by: 'score' }))[0];
    if (userToRemind == undefined) { break; }
    const currentStreak = await redis.zScore(`current-streaks-v${dbVersion}`, userToRemind.member);
    reddit.sendPrivateMessage({to: userToRemind.member, subject: `🐔 Post to r/${context.subredditName} to maintain your streak! 🐔`, text: `Hey! Just a little reminder to visit r/${context.subredditName} and keep your ${currentStreak == undefined ? '' : `${currentStreak}-day ` }streak going! You have 5 hours to post before your streak is broken. We'd love to see you there. Stay fabulous, stay counting, and remember: you are egg-straordinary! To unsubscribe from these notifications, respond with "!unsubscribe" in this conversation.`});
    await redis.zRem(`second-notifications-list-v${dbVersion}`, [userToRemind.member]);
  }
  while (true) {
    if (!await taskScheduler.startNextTask()) { break; }
    const userToRemind = (await redis.zRange(`untimed-notifications-list-v${dbVersion}`, 0, now, { by: 'score' }))[0];
    if (userToRemind == undefined) { break; }
    const currentStreak = await redis.zScore(`current-streaks-v${dbVersion}`, userToRemind.member);
    reddit.sendPrivateMessage({to: userToRemind.member, subject: `🐔 Post to r/${context.subredditName} to maintain your streak! 🐔`, text: `Hey! Just a little reminder to visit r/${context.subredditName} and keep your ${currentStreak == undefined ? '' : `${currentStreak}-day ` }streak going! We'd love to see you there. Stay fabulous, stay counting, and remember: you are egg-straordinary! To unsubscribe from these notifications, respond with "!unsubscribe" in this conversation.`});
    await redis.zRem(`untimed-notifications-list-v${dbVersion}`, [userToRemind.member]);
  }

	return { status: 'success', message: `Streaks calculated`, number: 200 };
}

export async function handleBackgroundStreak() {
  const taskScheduler = new TaskScheduler({ stopAtSoftShutdown: true });
  if (await taskScheduler.endTask()) { return false; }
  const dbVersion = await DBVersion();
	let currentUserScore = parseInt(await redis.get(`background-task-tracker-v${dbVersion}`) ?? '0');
  if (isNaN(currentUserScore)) { currentUserScore = 0; }
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

export async function reportStreakDevelopment(username: string, timezone: string) {
  console.log(`${getDateTime()}: Received request to report streak development.`);
  const dbVersion = await DBVersion();
  const recentPosts = await redis.zRange(`posts-of-${username}-v${dbVersion}`, 0, -1, );
  const otherStreakSourcesStr = await redis.get(`other-streaks-of-${username}-v${dbVersion}`);
  let otherStreakSources = undefined;
  if (otherStreakSourcesStr != undefined) { otherStreakSources = JSON.parse(otherStreakSourcesStr); }

  let nMinutesUntilPostCounts = await settings.get('nMinutesUntilPostCounts');
  if (nMinutesUntilPostCounts == undefined || typeof nMinutesUntilPostCounts != 'number') { nMinutesUntilPostCounts = 10; }

  let events: { timestamp: number, event: string }[] = [];
  for (const postInfo of recentPosts) {
    const postId = postInfo['member'];
    const streakLength = await redis.zScore(`post-streaks-v${dbVersion}`, postId);
    const timestamp = postInfo['score'];
    const dateStr = timestamp ? new Date(timestamp).toLocaleString('en-US', { timeZone: timezone }) : 'Unknown date';
    let eventText;
    let postTitle = 'title unknown';
    try {
      const post = await reddit.getPostById(postId as T3);
      postTitle = post.title;
    }
    catch (error) { console.error(`${getDateTime()}: Error fetching post ${postId} for streak development report:`, error); }

    const isLateDeleted = await redis.zScore(`late-deleted-post-queue-v${dbVersion}`, postId) != undefined;
  
    if (streakLength != undefined) { eventText = `${dateStr}: post: [${postTitle}](https://www.reddit.com/r/${context.subredditName}/comments/${postId.slice(3)}). Streak: ${streakLength}.${isLateDeleted ? ` (deleted after more than ${nMinutesUntilPostCounts} minutes)` : ''}\n\n`; }
    else { eventText = `${dateStr}: post: [${postTitle}](https://www.reddit.com/r/${context.subredditName}/comments/${postId.slice(3)}). Streak: Unknown.${isLateDeleted ? ` (deleted after more than ${nMinutesUntilPostCounts} minutes)` : ''}\n\n`; }
    events.push({ timestamp: timestamp, event: eventText });
  }
  for (const streakSource of otherStreakSources ?? []) {
    const timestamp = streakSource.timestamp;
    const dateStr = timestamp ? new Date(timestamp).toLocaleString('en-US', { timeZone: timezone }) : 'Unknown date';
    events.push({ timestamp: timestamp, event: `${dateStr}: Manually added a ${streakSource.source} streak or a post was removed so the post data has been deleted for privacy reasons. Streak: ${streakSource.streak}\n\n` });
  }
  events.sort((a, b) => b.timestamp - a.timestamp);

  let report = `A moderator requested a streak development report for user u/${username}.\n\n`;
  report += 'If the user has deleted a post, and made a new post close to the time of the deleted post, the streak is reset. In this case go to the deleted post and choose to remove the post from the streak database.\n\n';
  report += 'If there is a post that is not in the database, and it should be, you can add it to the streak database by going to the post and choosing to add it to the streak database.\n\n';
  report += 'If there was a special event (such as a user unrightfully being banned, a reddit bug etc.) that caused the streak to be reset, you can add a manual streak to the database by going to the post and choosing to add a manual streak to the streak database.\n\n\n\n';
  report += '# Streak Development\n\n';
  report += 'Below you can find the streak development of the user. If you want to see the streak development in a different timezone, please submit a new request with the desired timezone.\n\n';
  let modMailConversationId: string | undefined = undefined;
  for (const event of events) {
    let newReport = report + event.event;
    if (newReport.length > 10000) {
      if (modMailConversationId == undefined) {
        const modMailConversation = await reddit.modMail.createConversation({body: report, subject: `Streak development for ${username}`, subredditName: context.subredditName});
        modMailConversationId = modMailConversation.conversation.id;
        if (modMailConversationId == undefined) { console.error(`${getDateTime()}: Error creating mod mail conversation for streak development report for user ${username}.`); return false; }
      }
      else { await reddit.modMail.reply({conversationId: modMailConversationId, body: report}); }
      report = event.event;
    }
    else { report = newReport; }
  }

  if (modMailConversationId == undefined) { await reddit.modMail.createConversation({body: report, subject: `Streak development for ${username}`, subredditName: context.subredditName}); }
  else { await reddit.modMail.reply({conversationId: modMailConversationId, body: report}); }

  return true;
}