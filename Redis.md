# Redis structure

This file explains the structure of the Redis database for this app

Every key has the addition of '-vx' at the end, with x being a number (so -v1, -v2 etc.). In case something happens with the database, this makes sure restoring the old database doesn't overwrite the new database that is being made. The database version is stored in the key 'db-version', the only key that does not have the '-vx' suffix.

## Sorted sets
- **users**: Contains all usernames of users that have posted to the sub. Sorted based on time of first post. Score is an integer, counting up.
- **posts**: Contains all ids of posts that have been approved. Does not contain deleted posts. Score is the timestamp of posting.
- **early-deleted-posts**: Contains all ids of posts that were approved, but have been deleted within 10 minutes of posting. The score is the timestamp of posting. Data is removed after 21 days.
- **new-post-queue**: Contains all ids of posts that were posted, but not yet approved.
- **early-deleted-post-queue**: Contains all ids of posts that were deleted within 10 minutes, but not yet removed from the database.
- **late-deleted-post-queue**: Contains all ids of posts that were deleted after 10 minutes, but not yet removed from the database. Score is the timestamp of deletion.
- **streak-queue**: Contains all ids of posts for which the streak must be calculated.
- **current-streaks**: Contains all user ids. The score is their streak.
- **current-COAD-streaks**: Conatins all user ids. The score is their COAD-streak.
- **start-next-post-timeframe**: Contains all user ids. The score is the earliest timestamp that users can make their next post on to keep their streak going.
- **end-next-post-timeframe**: Contains all user ids. The score is the latest timestamp that users can make their next post on to keep their streak going.
- **subscriptions**: Contains all usernames of users that are subscribed to notifications about their streak. Score is an integer, counting up.
- **first-notifications-list**: Contains all usernames of users that are subscribed to notifications about their streak, and who still need to receive the first notification (when the post window opens). Score is the timestamp when the notification must be sent.
- **second-notifications-list**: Contains all usernames of users that are subscribed to notifications about their streak, and who still need to receive the second notification (5 hours before the post window closes). Score is the timestamp when the notification must be sent.
- **untimed-notifications-list**: Contains all usernames of users that are subscribed to notifications about their streak, and who still need to receive the untimed notification (this happens when the notification window cannot be determined correctly). Score is the timestamp when the notification must be sent.
- **view-post-window-queue**: Contains all user ids or comment ids for which the post window must be calculated and sent to the user.
- **post-streaks**: Contains all post ids. The score is their streak at the point in time of posting that post.
- **post-COAD-streaks**: Contains all post ids. The score is their COAD-streak at the point in time of posting that post.
- **top-streaks**: Contains all user ids. The score is the highest streak they ever had.
- **top-COAD-streaks**: Contains all user ids. The score is the highest COAD-streak they ever had.
- **post-upvotes**: Contains all post ids. The score is the number of upvotes. Tracked until 21 days after posting.
- **post-comments**: Contains all post ids. The score is the number of comments. Tracked until 21 days after posting.
- **posts-per-user**: Contains all usernames of users that have posted to the sub. The score is the number of posts per user.
- **identical-digits-posts**: Contains the post ids of the posts that are have identical digits. The score is the title of the post.
- **identical-digits-users**: Contains the user ids of users that posted posts with identical digits. The score is the number of posts they have in this format.
- **palindrome-posts**: Contains the post ids of the posts that are a palindrome. The score is the title of the post.
- **palindrome-users**: Contains the user ids of users that posted palindrome posts. The score is the number of posts they have in this format.

## Single values
- **timestamp-streak-fix**: The timestamp of the time where the streak bug was fixed.
- **new-post-handler-lock**: Either 'open' or the timestamp when it was locked. Makes sure only a single post handler is active at the same time.
- **streak-handler-lock**: Either 'open' or the timestamp when it was locked. Makes sure only a single streak handler is active at the same time.
- **deleted-post-handler-lock**: Either 'open' or the timestamp when it was locked. Makes sure only a single deleted post handler is active at the same time.
- **background-task-handler-lock**: Either 'open' or the timestamp when it was locked. Makes sure only a single background task handler is active at the same time.
- **discord-handler-lock**: Either 'open' or the timestamp when it was locked. Makes sure only a single discord handler is active at the same time.
- **shutdown-lock**: Either 'open', 'soft' or 'hard'. Shuts some or all of the bot functionality down.
- **current-background-task**: Which background process is currently running. Either 'setup', 'flair', 'leaderboard', 'cleanup' or 'discord-nsfw-check'.
- **background-task-tracker**: Which part of the background task must be executed next.
- **current-count**: The current count of the subreddit.
- **current-count-post-id**: The id of the post that shows what the current count is.
- **new-post-limit**: The number of posts to process at once when checking for new posts.
- **latest-bot-post**: The id of the latest bot post from #daily-bot-post on discord.
- **latest-bot-post-discord-message**: The id of the latest bot post that was pointed to by the bot in #daily-bot-post on discord.
- **latest-bot-discord-message**: The id of the latest discord message of the bot in #daily-bot-post.
- **latest-chosen-discord-message-id**: The id of the latest discord message that was chosen to be posted by the bot.
- **multiple-posts-per-day-removal-reason-id**: The id of the removal reason for posting more than once per day.
- **wrong-title-removal-reason-id**: The id of the removal reason for posting with the wrong title.
- **selfie-removal-reason-id**: The id of the removal reason for breaking the selfie rule.
- **selfie-flair-id**: The id of the selfie flair.
- **political-flair-id**: The id of the political post flair.
- **last-notification-time-missing-setting**: The timestamp of the last notification for missing one or more settings.

## Group of sorted sets
- **posts-of-\[username\]**: Each of these sorted lists contains the post ids of this user. Score is the timestamp of posting.
- **whole-count-\[number\]-posts**: Each of these sorted lists contains the post ids of the posts that end in 0, 00, 000, 0000 etc. The score is the title of the post. \[number\] = 10/100/1000/10000 etc.
- **whole-count-\[number\]-users**: Each of these sorted lists contains the user ids of users that posted posts that end in 0, 00, 000, 0000 etc. The score is the number of posts they have in this format.

## Group of single values
- **post-info-\[postId\]**: Each of these values contains a stringified JSON overview containing post info, namely 'authorName', 'postNumber', 'date' (UTC), 'discordMessageId' and 'isNSFW'. These last two keys are optional.
- **other-streaks-of-\[username\]**: Each of these values contains a stringified JSON overview containing a list of other streaks, namely 'streak', 'source', 'timestamp' (either 'COAD' or 'local'). Example: [{'streak': 5, 'source':'COAD', 'timestamp':12345},{'streak': 9, 'source':'local', 'timestamp':23456}].
- **bot-post-info-\[postId\]-version-\[versionNumber\]**: Each of these values contains a string with information about that version of the post.
- **bot-comment-info-\[commentId\]-version-\[versionNumber\]**: Each of these values contains a string with information about that version of the comment.