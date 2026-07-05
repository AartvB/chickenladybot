import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';
import { reddit } from '@devvit/web/server';
import { updateTargetPost, botExplainer, addToEndOfQueue, DBVersion, isPostDeleted, TaskScheduler, isPostDeletedEarly } from './helpers';

export async function removePostFromDatabase(postId: T3, early_removal: boolean) {
	const dbVersion = await DBVersion();

	const alreadyDeletedEarly = await redis.zScore(`early-deleted-posts-v${dbVersion}`, postId) != undefined;
	if (alreadyDeletedEarly) { await redis.zRem(`early-deleted-post-queue-v${dbVersion}`, [postId]); await redis.zRem(`late-deleted-post-queue-v${dbVersion}`, [postId]); return; }

	const postData = await redis.get(`post-info-${postId}-v${dbVersion}`) || '{"authorName": "[deleted]", "postNumber": 0}';
	const authorName = JSON.parse(postData).authorName;
	const timestamp = await redis.zScore(`posts-v${dbVersion}`, postId);
	if (timestamp != undefined) {
		if (early_removal) {
			await addToEndOfQueue(`streak-queue-v${dbVersion}`, postId);
			const postsAfter = await redis.zRange(`posts-of-${authorName}-v${dbVersion}`, timestamp, '+inf', {by: 'score'});
			for (const postInfo of postsAfter) { await addToEndOfQueue(`streak-queue-v${dbVersion}`, postInfo['member']); }
		}
		else {
			const postStreak = await redis.zScore(`post-streaks-v${dbVersion}`, postId) ?? 0;
			const postCOADStreak = await redis.zScore(`post-COAD-streaks-v${dbVersion}`, postId) ?? 0;
			const otherStreaksOfUserstr = await redis.get(`other-streaks-of-${authorName}-v${dbVersion}`);
			let otherStreaksOfUser: { streak: number; source: string; timestamp: string }[] = [];
			if (otherStreaksOfUserstr != undefined) { otherStreaksOfUser = JSON.parse(otherStreaksOfUserstr); }
			otherStreaksOfUser.push({ streak: postStreak, source: 'local', timestamp: timestamp.toString() });
			otherStreaksOfUser.push({ streak: postCOADStreak, source: 'COAD', timestamp: timestamp.toString() });
			await redis.set(`other-streaks-of-${authorName}-v${dbVersion}`, JSON.stringify(otherStreaksOfUser));
		}
	}

	const currentPostsPerUser = await redis.zScore(`posts-per-user-v${dbVersion}`, authorName) ?? 0;
	await redis.zAdd(`posts-per-user-v${dbVersion}`, { member: authorName, score: currentPostsPerUser - 1 });

	let nZeroes = 1;
  while (true) {
		const zeroesString = '0'.repeat(nZeroes);
		const keyExists = await redis.exists(`whole-count-1${zeroesString}-posts-v${dbVersion}`);
		if (!keyExists) { break; }
		const currentPostCount = await redis.zScore(`whole-count-1${zeroesString}-users-v${dbVersion}`, authorName) ?? 1;
		await redis.zAdd(`whole-count-1${zeroesString}-users-v${dbVersion}`, { member: authorName, score: currentPostCount - 1 });
		await redis.zRem(`whole-count-1${zeroesString}-posts-v${dbVersion}`, [postId]);
		nZeroes += 1;
  }

	const isIdenticalDigits = await redis.zScore(`identical-digits-posts-v${dbVersion}`, postId) != undefined;
	if (isIdenticalDigits) {
		const currentIdenticalDigitsScore = await redis.zScore(`identical-digits-users-v${dbVersion}`, authorName) ?? 1;
		await redis.zAdd(`identical-digits-users-v${dbVersion}`, { member: authorName, score: currentIdenticalDigitsScore - 1 });
	}
	await redis.zRem(`identical-digits-posts-v${dbVersion}`, [postId]);

	const isPalindrome = await redis.zScore(`palindrome-posts-v${dbVersion}`, postId) != undefined;
	if (isPalindrome) {
		const currentPalindromeScore = await redis.zScore(`palindrome-users-v${dbVersion}`, authorName) ?? 1;
		await redis.zAdd(`palindrome-users-v${dbVersion}`, { member: authorName, score: currentPalindromeScore - 1 });
	}
	await redis.zRem(`palindrome-posts-v${dbVersion}`, [postId]);
    
	await redis.zRem(`posts-v${dbVersion}`, [postId]);
	await redis.zRem(`post-streaks-v${dbVersion}`, [postId]);
	await redis.zRem(`post-COAD-streaks-v${dbVersion}`, [postId]);
	await redis.zRem(`post-upvotes-v${dbVersion}`, [postId]);
	await redis.zRem(`post-comments-v${dbVersion}`, [postId]);
	await redis.zRem(`posts-of-${authorName}-v${dbVersion}`, [postId]);
  await redis.zAdd(`posts-per-user-v${dbVersion}`, { member: authorName, score: await redis.zCard(`posts-of-${authorName}-v${dbVersion}`) });

	if (early_removal) {
		await redis.zAdd(`early-deleted-posts-v${dbVersion}`, { member: postId, score: Date.now() });
		await redis.zRem(`early-deleted-post-queue-v${dbVersion}`, [postId]);

		let message = `This post has been removed by you or a moderator within 10 minutes of posting, or it has been flagged for special deletion because you contacted us through mod mail. Therefore this post does not count as your post for this day and does not contribute to your streak. Feel free to post again.` // TODO: Remove magic number 10
		message += await botExplainer();
		await reddit.submitComment({id: postId, text: message, runAs: 'APP'});

		const txn = await redis.watch(`current-count-v${dbVersion}`);
		const currentCount = await redis.get(`current-count-v${dbVersion}`);
		if (currentCount == undefined) { await txn.unwatch(); return { status: 'error', message: 'Database error', number: 404 }; }
		if (currentCount == JSON.parse(postData).postNumber) {
			const latestPostId = (await redis.zRange(`posts-v${dbVersion}`, -1, -1))[0];
			if (latestPostId == undefined) { await txn.unwatch(); return { status: 'error', message: 'Database error', number: 404 }; }
			const latestPostInfo = await redis.get(`post-info-${latestPostId['member']}-v${dbVersion}`);
			if (latestPostInfo == undefined) { await txn.unwatch(); return { status: 'error', message: 'Database error', number: 404 }; }

			await txn.multi()
			await txn.set(`current-count-v${dbVersion}`, JSON.parse(latestPostInfo).postNumber);
			if (await txn.exec()) { await updateTargetPost(); }
		}
		txn.unwatch();
	}
	else { await redis.del(`post-info-${postId}-v${dbVersion}`); }
}
export async function handleDeletedPosts() {
// Handles posts that have been deleted within 10 minutes of posting
// Only removes from the beginning of the queue
	let taskScheduler = new TaskScheduler({});
	if (await taskScheduler.endTask()) { return false; }
	const dbVersion = await DBVersion();

	const tenMinutesAgo = Date.now() - 10 * 60 * 1000; // Remove magic number 10
	const recentPosts = await redis.zRange(`posts-v${dbVersion}`, tenMinutesAgo, '+inf', { by: 'score' });	
	for (const postInfo of recentPosts) {
		const postId = postInfo['member'];
		const post = await reddit.getPostById(postId as T3);
		if (await isPostDeleted(post) && !(await isPostDeletedEarly(postId as T3))) { 
			await addToEndOfQueue(`early-deleted-post-queue-v${dbVersion}`, postId);
		}
	}

  while (await redis.zCard(`early-deleted-post-queue-v${dbVersion}`) > 0) {
    if (!await taskScheduler.startNextTask()) { return false; }
    const postInfo = (await redis.zRange(`early-deleted-post-queue-v${dbVersion}`, 0, 0))[0];
    if (postInfo == undefined) { return false; }
		const postId = postInfo['member'];

		await removePostFromDatabase(postId as T3, true);

		await redis.zAdd(`early-deleted-posts-v${dbVersion}`, { member: postId, score: Date.now() });
		await redis.zRem(`early-deleted-post-queue-v${dbVersion}`, [postId]);

		if (await taskScheduler.endTask()) {
			return false;
		}
	}

	return true
}
async function removeUserInfo(username: string) {
	const dbVersion = await DBVersion();
	await redis.zRem(`users-v${dbVersion}`, [username]);
	await redis.zRem(`current-streaks-v${dbVersion}`, [username]);
	await redis.zRem(`current-COAD-streaks-v${dbVersion}`, [username]);
	await redis.zRem(`top-streaks-v${dbVersion}`, [username]);
	await redis.zRem(`top-COAD-streaks-v${dbVersion}`, [username]);
	await redis.zRem(`posts-per-user-v${dbVersion}`, [username]);
	await redis.zRem(`identical-digits-users-v${dbVersion}`, [username]);
	await redis.zRem(`palindrome-users-v${dbVersion}`, [username]);
	await redis.del(`posts-of-${username}-v${dbVersion}`);
	await redis.del(`other-streaks-of-${username}-v${dbVersion}`);

	let nZeroes = 1;
  while (true) {
		const zeroesString = '0'.repeat(nZeroes);
		const keyExists = await redis.exists(`whole-count-1${zeroesString}-users-v${dbVersion}`);
		if (!keyExists) { break; }
		await redis.zRem(`whole-count-1${zeroesString}-users-v${dbVersion}`, [username]);
		nZeroes += 1;
  }
}
export async function handleCleanup(): Promise<boolean> {
// Remove post data from the database if the post has been deleted for more than 21 days, to protect user privacy. Also remove data from accounts that have no posts left on the subreddit.
	let taskScheduler = new TaskScheduler( { stopAtSoftShutdown: true });
	if (await taskScheduler.endTask()) { return false; }

	const dbVersion = await DBVersion();
	let currentTask = await redis.get(`background-task-tracker-v${dbVersion}`) ?? 'late-posts-0';
	if (/^late-posts-(\d+)$/.test(currentTask)) {
		const currentPostScore = parseInt(currentTask.split('late-posts-')[1] ?? '0');
		const now = Date.now();
		const endPostScore = now - 21 * 24 * 60 * 60 * 1000; // End 21 days ago

		while (true) {
			if (!await taskScheduler.startNextTask()) { return false; }
			const postToDelete = (await redis.zRange(`late-deleted-posts-v${dbVersion}`, currentPostScore, endPostScore, { by: 'score' }))[0];
			if (postToDelete == undefined) {
				currentTask = 'early-posts-0';
				await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
				break;
			}

			const postId = postToDelete['member'];

			if (!isPostDeleted(await reddit.getPostById(postId as T3))) {
				await redis.zRem(`late-deleted-posts-v${dbVersion}`, [postId]);
				continue;
			}

			const postData = await redis.get(`post-info-${postId}-v${dbVersion}`);
			if (postData == undefined) { await redis.zRem(`late-deleted-posts-v${dbVersion}`, [postId]); continue; }
			const authorName = JSON.parse(postData).authorName;
			const nPostsByUser = await redis.zCard(`posts-of-${authorName}-v${dbVersion}`);
			const postInPosts = await redis.zScore(`posts-of-${authorName}-v${dbVersion}`, postId) != undefined;

			await removePostFromDatabase(postId as T3, false);

			if (nPostsByUser == 0 || (nPostsByUser == 1 && postInPosts)) { await removeUserInfo(authorName); }

			await redis.zRem(`late-deleted-posts-v${dbVersion}`, [postId]);
			await redis.set(`background-task-tracker-v${dbVersion}`, `late-posts-${postToDelete['score']}`);
		}
	}
	if (/^early-posts-(\d+)$/.test(currentTask)) {
		const currentPostScore = parseInt(currentTask.split('early-posts-')[1] ?? '0');
		const now = Date.now();
		const endPostScore = now - 21 * 24 * 60 * 60 * 1000; // End 21 days ago

		while (true) {
			if (!await taskScheduler.startNextTask()) { return false; }
			const postToDelete = (await redis.zRange(`early-deleted-posts-v${dbVersion}`, currentPostScore, endPostScore, { by: 'score' }))[0];
			if (postToDelete == undefined) { break; }
			const postId = postToDelete['member'];
			await redis.del(`post-info-${postId}-v${dbVersion}`);
			await redis.zRem(`early-deleted-posts-v${dbVersion}`, [postId]);
			await redis.zRem(`early-deleted-post-queue-v${dbVersion}`, [postId]);
			await redis.set(`background-task-tracker-v${dbVersion}`, `early-posts-${postToDelete['score']}`);
		}
	}

	// TODO: Look at all historical data older than 21 days and add any deleted posts that are not yet in the early or late deleted posts queue to the late deleted posts queue
	return true
}