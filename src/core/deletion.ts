import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';
import { reddit } from '@devvit/web/server';
import { updateTargetPost, isPostDeleted, botExplainer, addToEndOfQueue } from './helpers';

async function removePost(postId: T3) {
	const alreadyDeleted = await redis.zScore('deleted-posts', postId) != undefined;
	if (alreadyDeleted) { await redis.zRem('deleted-post-queue', [postId]); return; }

	const postData = await redis.get(`post-info-${postId}`);
	if (postData == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
	const authorName = JSON.parse(postData).authorName;
	const timestamp = await redis.zScore('posts', postId);
	if (timestamp == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }

	await redis.zRem('posts', [postId]);
	await redis.zRem('deleted-post-queue', [postId]);
	await redis.zRem('post-streaks', [postId]);
	await redis.zRem('post-COAD-streaks', [postId]);
	await redis.zRem(`posts-of-${authorName}`, [postId]);

	// Calculate streak again
	await addToEndOfQueue('streak-queue', postId);
	const postsAfter = await redis.zRange('posts', timestamp, '+inf', {by: 'score'});
	for (const postInfo of postsAfter) { await addToEndOfQueue('streak-queue', postInfo['member']); }

	await redis.zAdd('deleted-posts', { member: postId, score: Date.now() });

	let message = `This post has been removed by you or a moderator within 10 minutes of posting. Therefore this post does not count as your post for this day and does not contribute to your streak, feel free to post again.` // TODO: Remove magic number 10
	message += await botExplainer();
  await reddit.submitComment({id: postId, text: message, runAs: 'APP'});

	const txn = await redis.watch('current-count');
	const currentCount = await redis.get('current-count');
	if (currentCount == undefined) { await txn.unwatch(); return { status: 'error', message: 'Database error', number: 404 }; }
	if (currentCount == JSON.parse(postData).postNumber) {
		const latestPostId = (await redis.zRange('posts', -1, -1))[0];
		if (latestPostId == undefined) { await txn.unwatch(); return { status: 'error', message: 'Database error', number: 404 }; }
		const latestPostInfo = await redis.get(`post-info-${latestPostId['member']}`);
		if (latestPostInfo == undefined) { await txn.unwatch(); return { status: 'error', message: 'Database error', number: 404 }; }

		await txn.multi()
		await txn.set('current-count', JSON.parse(latestPostInfo).postNumber);
		if (await txn.exec()) { await updateTargetPost(); }
	}
	txn.unwatch();
}

export async function handleDeletedPosts() {
	// Only removes from the beginning of the queue
  const startTime = Date.now();
  while (await redis.zCard('deleted-post-queue') > 0) {
    const startTimeCurrentPost = Date.now();
    const postInfo = (await redis.zRange('deleted-post-queue', 0, 0))[0];
    if (postInfo == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
		const postId = postInfo['member'];

		await removePost(postId as T3);

		await redis.zRem('deleted-post-queue', [postId]);

		const processingTime = Date.now() - startTimeCurrentPost;
		const timeLeft = 30000 - (Date.now() - startTime);

		if (timeLeft < processingTime * 1.5 || timeLeft < 10000) {
			return { status: 'warning', message: 'Processing time is approaching the limit, stopping to avoid timeout. Remaining posts will be handled in the next run.', number: 200 };
		}
	}

	let latestPosts = await redis.zRange('posts', Date.now() - 10 * 60 * 1000, '+inf', {by: 'score'});  // TODO: Remove magic number 10
	for (const postInfo of latestPosts) {
		const postId = postInfo['member'];
		const post = await reddit.getPostById(postId as T3);
		if (await isPostDeleted(post)) { await removePost(postId as T3); }
	}

	return { status: 'ok', message: 'Successfully processed deleted posts', number: 200 };
}