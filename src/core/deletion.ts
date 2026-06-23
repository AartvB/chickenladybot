import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';
import { reddit } from '@devvit/web/server';
import { updateTargetPost, isPostDeleted, botExplainer, addToEndOfQueue, DBVersion } from './helpers';

async function removePost(postId: T3) {
	const dbVersion = await DBVersion();
	const alreadyDeleted = await redis.zScore(`deleted-posts-v${dbVersion}`, postId) != undefined;
	if (alreadyDeleted) { await redis.zRem(`deleted-post-queue-v${dbVersion}`, [postId]); return; }

	const postData = await redis.get(`post-info-${postId}-v${dbVersion}`);
	if (postData == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
	const authorName = JSON.parse(postData).authorName;
	const title = JSON.parse(postData).postNumber;
	const timestamp = await redis.zScore(`posts-v${dbVersion}`, postId);
	if (timestamp == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }

	await redis.zRem(`posts-v${dbVersion}`, [postId]);
	await redis.zRem(`deleted-post-queue-v${dbVersion}`, [postId]);
	await redis.zRem(`post-streaks-v${dbVersion}`, [postId]);
	await redis.zRem(`post-COAD-streaks-v${dbVersion}`, [postId]);
	await redis.zRem(`posts-of-${authorName}-v${dbVersion}`, [postId]);

	// Calculate streak again
	await addToEndOfQueue(`streak-queue-v${dbVersion}`, postId);
	const postsAfter = await redis.zRange(`posts-v${dbVersion}`, timestamp, '+inf', {by: 'score'});
	for (const postInfo of postsAfter) { await addToEndOfQueue(`streak-queue-v${dbVersion}`, postInfo['member']); }

	const currentPostsPerUser = await redis.zScore(`posts-per-user-v${dbVersion}`, authorName) ?? 0;
	await redis.zAdd(`posts-per-user-v${dbVersion}`, { member: authorName, score: currentPostsPerUser - 1 });

	let nZeroes = 1;
	while (true) {
		const zeroesString = '0'.repeat(nZeroes);
		if (title.toString().endsWith(zeroesString)) {
			await redis.zRem(`whole-count-1${zeroesString}-posts-v${dbVersion}`, [postId]);
			const currentUserCount = await redis.zScore(`whole-count-1${zeroesString}-users-v${dbVersion}`, authorName) ?? 0;
			await redis.zAdd(`whole-count-1${zeroesString}-users-v${dbVersion}`, { member: authorName, score: currentUserCount - 1 });
		}
		else { break; }
		nZeroes += 1;
	}

  if (/^(\d)\1+$/.test(title.toString())) {
    await redis.zRem(`identical-digits-posts-v${dbVersion}`, [postId]);
    const currentUserCount = await redis.zScore(`identical-digits-users-v${dbVersion}`, authorName) ?? 0;
    await redis.zAdd(`identical-digits-users-v${dbVersion}`, { member: authorName, score: currentUserCount - 1 });
  }

  if (title.toString() == title.toString().split('').reverse().join('')) {
    await redis.zRem(`palindrome-posts-v${dbVersion}`, [postId]);
    const currentUserCount = await redis.zScore(`palindrome-users-v${dbVersion}`, authorName) ?? 0;
    await redis.zAdd(`palindrome-users-v${dbVersion}`, { member: authorName, score: currentUserCount - 1 });
  }

	await redis.zAdd(`deleted-posts-v${dbVersion}`, { member: postId, score: Date.now() });

	let message = `This post has been removed by you or a moderator within 10 minutes of posting. Therefore this post does not count as your post for this day and does not contribute to your streak, feel free to post again.` // TODO: Remove magic number 10
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

export async function handleDeletedPosts() {
	// Only removes from the beginning of the queue
  const startTime = Date.now();
	const dbVersion = await DBVersion();
  while (await redis.zCard(`deleted-post-queue-v${dbVersion}`) > 0) {
    const startTimeCurrentPost = Date.now();
    const postInfo = (await redis.zRange(`deleted-post-queue-v${dbVersion}`, 0, 0))[0];
    if (postInfo == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
		const postId = postInfo['member'];

		await removePost(postId as T3);

		await redis.zRem(`deleted-post-queue-v${dbVersion}`, [postId]);

		const processingTime = Date.now() - startTimeCurrentPost;
		const timeLeft = 30000 - (Date.now() - startTime);

		if (timeLeft < processingTime * 1.5 || timeLeft < 10000) {
			return { status: 'warning', message: 'Processing time is approaching the limit, stopping to avoid timeout. Remaining posts will be handled in the next run.', number: 200 };
		}
	}

	let latestPosts = await redis.zRange(`posts-v${dbVersion}`, Date.now() - 10 * 60 * 1000, '+inf', {by: 'score'});  // TODO: Remove magic number 10
	for (const postInfo of latestPosts) {
		const postId = postInfo['member'];
		const post = await reddit.getPostById(postId as T3);
		if (await isPostDeleted(post)) { await removePost(postId as T3); }
	}

	return { status: 'ok', message: 'Successfully processed deleted posts', number: 200 };
}