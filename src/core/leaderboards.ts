import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';
import { context, reddit } from '@devvit/web/server';
import { DBVersion, getDateTime, TaskScheduler } from './helpers';

async function updateCountLeaderboard() {
	// The leaderboard on the wiki that shows which users have counted the most, and how many times they have counted.
	let postCounts = await redis.zRange(`posts-per-user-v${await DBVersion()}`, -1000, -1);
	postCounts = postCounts.reverse();

	let wikiText = "#All counters of our beautiful sub!\n\nThis shows the top 1000 posters of our sub!\n\n|Rank|Username|Counts|\n|-:|:-|-:|\n";
	let previousCount = 0;
	let previousRank = 0;
	let rowNumber = 1;
	for (const postCount of postCounts) {
		previousRank = postCount.score == previousCount ? previousRank : rowNumber;
		previousCount = postCount.score;
		rowNumber += 1;
		wikiText += '|' + previousRank.toString() + '|' + postCount.member + '|' + previousCount.toString() + '|\n';
	}
	await reddit.updateWikiPage({content: wikiText, subredditName: context.subredditName, page: 'counts' });
}

async function updateWholeCountsLeaderboards() {
	// The leaderboards on the wiki that shows the people who counted to a multiple of 10, 100, 1000 etc.
	const dbVersion = await DBVersion();
	let nZeroes = 1;
	while (true) {
		const zeroesString = '0'.repeat(nZeroes);
		const postCounts = await redis.zRange(`whole-count-1${zeroesString}-users-v${dbVersion}`, -1000, -1);
		if (postCounts.length == 0) { break; }
		postCounts.reverse();
	
		let wikiText = `#1${zeroesString} counts\n\nThis page shows which users have counted to a number divisible by 1${zeroesString}, and how many times!\n\n|Rank|Username|Number of 1${zeroesString}'s|\n|-:|:-|-:|\n`;
		let previousCount = 0;
		let previousRank = 0;
		let rowNumber = 1;
		for (const postCount of postCounts) {
			previousRank = postCount.score == previousCount ? previousRank : rowNumber;
			previousCount = postCount.score;
			rowNumber += 1;
			wikiText += '|' + previousRank.toString() + '|' + postCount.member + '|' + previousCount.toString() + '|\n';
		}
		wikiText += `\n##Most recent 1${zeroesString} posts\n|Username|Count|Date (UTC)|\n|-:|:-|-:|\n`;

		const recentPosts = await redis.zRange(`whole-count-1${zeroesString}-posts-v${dbVersion}`, -1000, -1);
		recentPosts.reverse();
		previousCount = 0;
		previousRank = 0;
		rowNumber = 1;
		for (const post of recentPosts) {
			previousRank = post.score == previousCount ? previousRank : rowNumber;
			previousCount = post.score;
			rowNumber += 1;
			const postId = post.member;
			const postInfo = await redis.get(`post-info-${postId}-v${dbVersion}`);
			if (postInfo == undefined) { continue; }
			const authorName = JSON.parse(postInfo).authorName;
			const date = JSON.parse(postInfo).date;
			wikiText += '|' + authorName + '|[' + post.score + '](https://www.reddit.com/r/' + context.subredditName + '/comments/' + postId + ')|' + date + '|\n';
		}

		await reddit.updateWikiPage({content: wikiText, subredditName: context.subredditName, page: `1${zeroesString}s` });

		nZeroes += 1;
	}
}
async function updateMostCommentsLeaderboard() {
	// The leaderboard on the wiki that shows the posts with the most comments
	const dbVersion = await DBVersion();
	const topCommentsPosts = await redis.zRange(`post-comments-v${dbVersion}`, -100, -1);
	topCommentsPosts.reverse();
	let topCommentsUsers: Record<string, number> = {};

	let textPosts = "";

	let previousCount = 0;
	let previousRank = 0;
	let rowNumber = 1;
	for (const post of topCommentsPosts) {
		previousRank = post.score == previousCount ? previousRank : rowNumber;
		previousCount = post.score;
		rowNumber += 1;
		const postId = post.member;
		const postInfo = await redis.get(`post-info-${postId}-v${dbVersion}`);
		if (postInfo == undefined) { continue; }
		const authorName = String(JSON.parse(postInfo).authorName);
		topCommentsUsers[authorName] = (topCommentsUsers[authorName] ?? 0) + 1;
		const date = JSON.parse(postInfo).date;
		const postNumber = JSON.parse(postInfo).postNumber;
		textPosts += '|' + previousRank.toString() + '|' + post.score + '|' + authorName + '|[' + postNumber + '](https://www.reddit.com/r/' + context.subredditName + '/comments/' + postId + ')|' + date + '|\n';
	}

	let wikiText = "#Most comments\n\nThis page shows the posts with the most comments of this sub!\n\nNote: Comment count is stored locally, and will only be updated up to 21 days after the post is posted. [Contact the mods](https://www.reddit.com/message/compose/?to=/r/countwithchickenlady) via mod mail if the comment count of a specific post has increase significantly since then, so we can update the comment count manually.\n\n##Leaderboard\n|Rank|Username|Number of appearences in top 100|\n|-:|:-|-:|\n";

	previousCount = 0;
	previousRank = 0;
	rowNumber = 1;
	topCommentsUsers = Object.fromEntries(Object.entries(topCommentsUsers).sort(([, a], [, b]) => b - a)); // Sort the users by number of appearences in top 100
	for (const [user, count] of Object.entries(topCommentsUsers)) {
		previousRank = count == previousCount ? previousRank : rowNumber;
		previousCount = count;
		rowNumber += 1;
		wikiText += '|' + previousRank.toString() + '|' + user + '|' + count.toString() + '|\n';
	}

	wikiText += "\n\n##Comments\n|Rank|Comments|Username|Count|Date (UTC)|\n|-:|-:|:-|:-|:-|\n" + textPosts;

	await reddit.updateWikiPage({content: wikiText, subredditName: context.subredditName, page: 'most_comments' });
}
async function updateMostUpvotesLeaderboard() {
	// The leaderboard on the wiki that shows the posts with the most upvotes
	const dbVersion = await DBVersion();
	const topUpvotesPosts = await redis.zRange(`post-upvotes-v${dbVersion}`, -100, -1);
	topUpvotesPosts.reverse();
	let topUpvotesUsers: Record<string, number> = {};

	let textPosts = "";

	let previousCount = 0;
	let previousRank = 0;
	let rowNumber = 1;
	for (const post of topUpvotesPosts) {
		previousRank = post.score == previousCount ? previousRank : rowNumber;
		previousCount = post.score;
		rowNumber += 1;
		const postId = post.member;
		const postInfo = await redis.get(`post-info-${postId}-v${dbVersion}`);
		if (postInfo == undefined) { continue; }
		const authorName = String(JSON.parse(postInfo).authorName);
		topUpvotesUsers[authorName] = (topUpvotesUsers[authorName] ?? 0) + 1;
		const date = JSON.parse(postInfo).date;
		const postNumber = JSON.parse(postInfo).postNumber;
		textPosts += '|' + previousRank.toString() + '|' + post.score + '|' + authorName + '|[' + postNumber + '](https://www.reddit.com/r/' + context.subredditName + '/comments/' + postId + ')|' + date + '|\n';
	}

	let wikiText = "#Most upvotes\n\nThis page shows the posts with the most upvotes of this sub!\n\nNote: Upvote count is stored locally, and will only be updated up to 21 days after the post is posted. [Contact the mods](https://www.reddit.com/message/compose/?to=/r/countwithchickenlady) via mod mail if the upvote count of a specific post has increase significantly since then, so we can update the upvote count manually.\n\n##Leaderboard\n|Rank|Username|Number of appearences in top 100|\n|-:|:-|-:|\n";

	previousCount = 0;
	previousRank = 0;
	rowNumber = 1;
	topUpvotesUsers = Object.fromEntries(Object.entries(topUpvotesUsers).sort(([, a], [, b]) => b - a)); // Sort the users by number of appearences in top 100
	for (const [user, count] of Object.entries(topUpvotesUsers)) {
		previousRank = count == previousCount ? previousRank : rowNumber;
		previousCount = count;
		rowNumber += 1;
		wikiText += '|' + previousRank.toString() + '|' + user + '|' + count.toString() + '|\n';
	}

	wikiText += "\n\n##Upvotes\n|Rank|Upvotes|Username|Count|Date (UTC)|\n|-:|-:|:-|:-|:-|\n" + textPosts;

	await reddit.updateWikiPage({content: wikiText, subredditName: context.subredditName, page: 'most_upvotes' });
}
async function updateIdenticalDigitsLeaderboard() {
	// The leaderboard on the wiki that shows the posts that are made up of identical digits, like 11, 222, 3333, etc. and the users that posted them.
	const dbVersion = await DBVersion();
	const postCounts = await redis.zRange(`identical-digits-users-v${dbVersion}`, -1000, -1);
	postCounts.reverse();
	if (postCounts.length == 0) { return; }

	let wikiText = "#Identical digits\n\nThis page shows which users have counted to a number that has only identical digits, and how many times!\n\n|Rank|Username|Number of appearences|\n|-:|:-|-:|\n";
	let previousCount = 0;
	let previousRank = 0;
	let rowNumber = 1;
	for (const postCount of postCounts) {
		previousRank = postCount.score == previousCount ? previousRank : rowNumber;
		previousCount = postCount.score;
		rowNumber += 1;
		wikiText += '|' + previousRank.toString() + '|' + postCount.member + '|' + previousCount.toString() + '|\n';
	}
	wikiText += '\n##Most recent identical digits posts\n|Username|Count|Date (UTC)|\n|-:|:-|-:|\n';

	const recentPosts = await redis.zRange(`identical-digits-posts-v${dbVersion}`, -1000, -1);
	recentPosts.reverse();
	previousCount = 0;
	previousRank = 0;
	rowNumber = 1;
	for (const post of recentPosts) {
		previousRank = post.score == previousCount ? previousRank : rowNumber;
		previousCount = post.score;
		rowNumber += 1;
		const postId = post.member;
		const postInfo = await redis.get(`post-info-${postId}-v${dbVersion}`);
		if (postInfo == undefined) { continue; }
		const authorName = JSON.parse(postInfo).authorName;
		const date = JSON.parse(postInfo).date;
		wikiText += '|' + authorName + '|[' + post.score + '](https://www.reddit.com/r/' + context.subredditName + '/comments/' + postId + ')|' + date + '|\n';
	}

	await reddit.updateWikiPage({content: wikiText, subredditName: context.subredditName, page: 'identical_digits' });
}
async function updatePalindromeLeaderboard() {
	// The leaderboard on the wiki that shows the posts that are made up of palindromes, like 131, 26262, 3333, etc. and the users that posted them.
	const dbVersion = await DBVersion();
	const postCounts = await redis.zRange(`palindrome-users-v${dbVersion}`, -1000, -1);
	postCounts.reverse();
	if (postCounts.length == 0) { return; }

	let wikiText = "#Palindromes\n\nThis page shows which users have counted to palindrome numbers (numbers that are the same backwards as forwards), and how many times!\n\n|Rank|Username|Number of appearences|\n|-:|:-|-:|\n";
	let previousCount = 0;
	let previousRank = 0;
	let rowNumber = 1;
	for (const postCount of postCounts) {
		previousRank = postCount.score == previousCount ? previousRank : rowNumber;
		previousCount = postCount.score;
		rowNumber += 1;
		wikiText += '|' + previousRank.toString() + '|' + postCount.member + '|' + previousCount.toString() + '|\n';
	}
	wikiText += '\n##Most recent palindromic posts\n|Username|Count|Date (UTC)|\n|-:|:-|-:|\n';

	const recentPosts = await redis.zRange(`palindrome-posts-v${dbVersion}`, -1000, -1);
	recentPosts.reverse();
	previousCount = 0;
	previousRank = 0;
	rowNumber = 1;
	for (const post of recentPosts) {
		previousRank = post.score == previousCount ? previousRank : rowNumber;
		previousCount = post.score;
		rowNumber += 1;
		const postId = post.member;
		const postInfo = await redis.get(`post-info-${postId}-v${dbVersion}`);
		if (postInfo == undefined) { continue; }
		const authorName = JSON.parse(postInfo).authorName;
		const date = JSON.parse(postInfo).date;
		wikiText += '|' + authorName + '|[' + post.score + '](https://www.reddit.com/r/' + context.subredditName + '/comments/' + postId + ')|' + date + '|\n';
	}

	await reddit.updateWikiPage({content: wikiText, subredditName: context.subredditName, page: 'palindromes' });
}
async function updateStreakLeaderboard() {
	// The leaderboard on the wiki that shows the top streaks.
	const dbVersion = await DBVersion();
	const currentStreaks = await redis.zRange(`current-streaks-v${dbVersion}`, -100, -1);
	currentStreaks.reverse();
	const topStreaks = await redis.zRange(`top-streaks-v${dbVersion}`, -100, -1);
	topStreaks.reverse();
	const currentCOADStreaks = await redis.zRange(`current-COAD-streaks-v${dbVersion}`, -100, -1);
	currentCOADStreaks.reverse();
	const topCOADStreaks = await redis.zRange(`top-COAD-streaks-v${dbVersion}`, -100, -1);
	topCOADStreaks.reverse();
	if (currentStreaks.length + topStreaks.length + currentCOADStreaks.length + topCOADStreaks.length == 0) { return; }

	let wikiText = "#Top streaks\n\nThis page shows the top streaks of users of our sub!\n\n##This sub only\n\nThis shows the top streaks built up in this sub only.\n\n###Currently running streaks\n\n|Rank|Username|Streak|\n|-:|:-|-:|\n";
	let previousStreak = 0;
	let previousRank = 0;
	let rowNumber = 1;
	for (const streak of currentStreaks) {
		previousRank = streak.score == previousStreak ? previousRank : rowNumber;
		previousStreak = streak.score;
		if (previousStreak == 0) { break; }
		rowNumber += 1;
		wikiText += '|' + previousRank.toString() + '|' + streak.member + '|' + previousStreak.toString() + '|\n';
	}
	wikiText += "\n\n###Top streaks ever\n\n|Rank|Username|Streak|\n|-:|:-|-:|\n";

	previousStreak = 0;
	previousRank = 0;
	rowNumber = 1;
	for (const streak of topStreaks) {
		previousRank = streak.score == previousStreak ? previousRank : rowNumber;
		previousStreak = streak.score;
		if (previousStreak == 0) { break; }
		rowNumber += 1;
		wikiText += '|' + previousRank.toString() + '|' + streak.member + '|' + previousStreak.toString() + '|\n';
	}
	wikiText += "\n\n##This sub and r/CountOnceADay\n\nThis shows the top streaks built up in this sub and possibly carried over from r/CountOnceADay.\n\n###Currently running streaks\n\n|Rank|Username|Streak|\n|-:|:-|-:|\n"
	
	previousStreak = 0;
	previousRank = 0;
	rowNumber = 1;
	for (const streak of currentCOADStreaks) {
		previousRank = streak.score == previousStreak ? previousRank : rowNumber;
		previousStreak = streak.score;
		if (previousStreak == 0) { break; }
		rowNumber += 1;
		wikiText += '|' + previousRank.toString() + '|' + streak.member + '|' + previousStreak.toString() + '|\n';
	}
	wikiText += "\n\n###Top streaks ever\n\n|Rank|Username|Streak|\n|-:|:-|-:|\n";	
	previousStreak = 0;
	previousRank = 0;
	rowNumber = 1;
	for (const streak of topCOADStreaks) {
		previousRank = streak.score == previousStreak ? previousRank : rowNumber;
		previousStreak = streak.score;
		if (previousStreak == 0) { break; }
		rowNumber += 1;
		wikiText += '|' + previousRank.toString() + '|' + streak.member + '|' + previousStreak.toString() + '|\n';
	}

	await reddit.updateWikiPage({content: wikiText, subredditName: context.subredditName, page: 'top_streaks' });
}

export async function handleLeaderboards() {
	const taskScheduler = new TaskScheduler({ stopAtSoftShutdown: true });
	if (await taskScheduler.endTask()) { return false; }
	const dbVersion = await DBVersion();
	let currentTask = await redis.get(`background-task-tracker-v${dbVersion}`) ?? 'posts-0';
	if (/^posts-(\d+)$/.test(currentTask)) {
		const score = currentTask.split('-')[1] ?? '0'
		console.log(`${getDateTime()}: Starting leaderboard background update (checking upvotes and comment count) from post score ${score} (${new Date(parseInt(score)).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })})`);
		let currentPostScore = parseInt(currentTask.split('-')[1] ?? '0');
		const now = Date.now();
		if (currentPostScore == 0) {
			currentPostScore = now - 21 * 24 * 60 * 60 * 1000; // Start from 21 days ago
		}
		while (true) {
			if (!await taskScheduler.startNextTask()) { return false; }
			const currentPost = (await redis.zRange(`posts-v${dbVersion}`, currentPostScore, '+inf', { by: 'score' }))[0];
			if (currentPost == undefined) { 
				currentTask = 'users-0';
				await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
				break;
			}

			const postId = currentPost.member;
			const post = await reddit.getPostById(postId as T3);
			const upvotes = post.score;
			const comments = post.numberOfComments

			await redis.zAdd(`post-upvotes-v${dbVersion}`, { member: postId, score: upvotes });
			await redis.zAdd(`post-comments-v${dbVersion}`, { member: postId, score: comments });

			currentPostScore = currentPost.score + 1;
			await redis.set(`background-task-tracker-v${dbVersion}`, `posts-${currentPostScore}`);
		}
	}
	if (/^users-(\d+)$/.test(currentTask)) {
		console.log(`${getDateTime()}: Starting leaderboard background update (streaks) from user score ${currentTask.split('-')[1] ?? '0'} (total users: ${await redis.zCard(`users-v${dbVersion}`)})`);
		let currentUserScore = parseInt(currentTask.split('-')[1] ?? '0');
		while (true) {
			if (!await taskScheduler.startNextTask()) { return false; }
			const currentUser = (await redis.zRange(`users-v${dbVersion}`, currentUserScore, '+inf', { by: 'score' }))[0];
			if (currentUser == undefined) { 
				currentTask = 'count';
				await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
				break;
			}

			const postsOfUser = await redis.zRange(`posts-of-${currentUser.member}-v${dbVersion}`, 0, -1);
			let maxStreak = 0;
			let maxCoadStreak = 0;
			for (const post of postsOfUser) {
				maxStreak = Math.max(maxStreak, await redis.zScore(`post-streaks-v${dbVersion}`, post.member)??0);
				maxCoadStreak = Math.max(maxCoadStreak, await redis.zScore(`post-COAD-streaks-v${dbVersion}`, post.member)??0, maxStreak);
			}
			
			await redis.zAdd(`top-streaks-v${dbVersion}`, { member: currentUser.member, score: maxStreak });
			await redis.zAdd(`top-COAD-streaks-v${dbVersion}`, { member: currentUser.member, score: maxCoadStreak });

			currentUserScore = currentUser.score + 1;
			await redis.set(`background-task-tracker-v${dbVersion}`, `users-${currentUserScore}`);
			if (!await taskScheduler.startNextTask()) { return false; }
		}
	}
	if (currentTask == 'count') {
		if (!await taskScheduler.startNextTask()) { return false; }
		console.log(`${getDateTime()}: Starting leaderboard background update (count leaderboard)`);
		await updateCountLeaderboard();
		currentTask = 'wholeCounts';
		await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
	}
	if (currentTask == 'wholeCounts') {
		if (!await taskScheduler.startNextTask()) { return false; }
		console.log(`${getDateTime()}: Starting leaderboard background update (whole counts leaderboards)`);
		await updateWholeCountsLeaderboards();
		currentTask = 'mostComments';
		await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
	}
	if (currentTask == 'mostComments') {
		if (!await taskScheduler.startNextTask()) { return false; }
		console.log(`${getDateTime()}: Starting leaderboard background update (most comments leaderboard)`);
		await updateMostCommentsLeaderboard();
		currentTask = 'mostUpvotes';
		await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
	}
	if (currentTask == 'mostUpvotes') {
		if (!await taskScheduler.startNextTask()) { return false; }
		console.log(`${getDateTime()}: Starting leaderboard background update (most upvotes leaderboard)`);
		await updateMostUpvotesLeaderboard();
		currentTask = 'identicalDigits';
		await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
	}
	if (currentTask == 'identicalDigits') {
		if (!await taskScheduler.startNextTask()) { return false; }
		console.log(`${getDateTime()}: Starting leaderboard background update (identical digits leaderboard)`);
		await updateIdenticalDigitsLeaderboard();
		currentTask = 'palindrome';
		await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
	}
	if (currentTask == 'palindrome') {
		if (!await taskScheduler.startNextTask()) { return false; }
		console.log(`${getDateTime()}: Starting leaderboard background update (palindrome leaderboard)`);
		await updatePalindromeLeaderboard();
		currentTask = 'streak';
		await redis.set(`background-task-tracker-v${dbVersion}`, currentTask);
	}
	if (currentTask == 'streak') {
		if (!await taskScheduler.startNextTask()) { return false; }
		console.log(`${getDateTime()}: Starting leaderboard background update (streak leaderboard)`);
		await updateStreakLeaderboard();
	}
	return true;
}