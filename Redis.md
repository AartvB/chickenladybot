# Redis structure

This file explains the structure of the Redis database for this app

Every key has the addition of '-vx' at the end, with x being a number (so -v1, -v2 etc.). In case something happens with the database, this makes sure restoring the old database doesn't overwrite the new database that is being made.

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
- **new-post-handler-lock**: Either 'open' or the timestamp when it was locked. Makes sure only a single post handler is active at the same time.
- **streak-handler-lock**: Either 'open' or the timestamp when it was locked. Makes sure only a single streak handler is active at the same time.
- **deleted-post-handler-lock**: Either 'open' or the timestamp when it was locked. Makes sure only a single deleted post handler is active at the same time.
- **shutdown-lock**: Either 'open', 'soft' or 'hard'. Shuts some or all of the bot functionality down.
- **current-background-task**: Which background process is currently running. Either 'setup', 'flair', 'leaderboard' and 'cleanup'.
- **background-task-tracker**: Which part of the background task must be executed next.
- **current-count**: The current count of the subreddit.
- **current-count-post-id**: The id of the post that shows what the current count is.
- **new-post-limit**: The number of posts to process at once when checking for new posts.

## Group of sorted sets
- **posts-of-\[username\]**: Each of these sorted lists contains the post ids of this user. Score is the timestamp of posting.
- **whole-count-\[number\]-posts**: Each of these sorted lists contains the post ids of the posts that end in 0, 00, 000, 0000 etc. The score is the title of the post. \[number\] = 10/100/1000/10000 etc.
- **whole-count-\[number\]-users**: Each of these sorted lists contains the user ids of users that posted posts that end in 0, 00, 000, 0000 etc. The score is the number of posts they have in this format.

## Group of single values
- **post-info-\[postId\]**: Each of these values contains a stringified JSON overview containing post info, namely 'authorName', 'postNumber', 'date' (UTC).
- **other-streaks-of-\[username\]**: Each of these values contains a stringified JSON overview containing a list of other streaks, namely 'streak', 'source', 'timestamp' (either 'COAD' or 'local'). Example: [{'streak': 5, 'source':'COAD', 'timestamp':12345},{'streak': 9, 'source':'LOCAL', 'timestamp':23456}].