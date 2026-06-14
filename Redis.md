# Redis structure

This file explains the structure of the Redis database for this app

## Sorted sets
- **users**: Contains all usernames of users that have posted to the sub. Not sorted. # FIXME: NOT IMPLEMENTED YET
- **posts**: Contains all ids of posts that have been approved. Does not contain deleted posts. Sorted based on time. If two posts are posted simultaneously, the post that reached us through the API first is first. Score is an integer.
- **deleted-posts**: Contains all ids of posts that were approved, but have been deleted within 10 minutes of posting. Not sorted. # FIXME: NOT IMPLEMENTED YET
- **new-post-queue**: Contains all ids of posts that were posted, but not yet approved
- **streak-queue**: Contains all ids of posts for which the streak must be calculated
- **current-streaks**: Contains all user_ids. The score is their streak.
- **current-COAD-streaks**: Conatins all user_ids. The score is their COAD-streak.
- **post-streaks**: Contains all post_ids. The score is their streak at the point in time of posting that post.
- **post-COAD-streaks**: Contains all post_ids. The score is their COAD-streak at the point in time of posting that post.

## Single values
- **new-post-handler-lock**: Either 'open' or 'closed'. Makes sure only a single post handler is active at the same time.
- **streak-handler-lock**: Either 'open' or 'closed'. Makes sure only a single streak handler is active at the same time.
- **current-count**: The current count of the subreddit.
- **current-count-link**: The link of the post that shows what the current count is (TODO: REMOVE THIS IN THE FUTURE, WE ALREADY HAVE CURRENT-COUNT-POST-ID)
- **current-count-post-id**: The id of the post that shows what the current count is
- **subredditname**: The name of the subreddit # TODO: REMOVE, IT'S NOT NEEDED DUE TO THE EXISTENCE OF context.subredditName
- **new-post-limit**: The number of posts to process at once when checking for new posts

## Group of sorted sets
- **posts-of-\[username\]**: Each of these sorted lists contains the post ids of this user. Sorted based on time. Score is an integer.

## Group of single values
- **post-info-\[post_id\]**: Each of these values contains a stringified JSON overview containing post info, namely 'authorName', 'timestamp' (in seconds)
- **other-streaks-of-\[username\]**: Each of these values contains a stringified JSON overview containing a list of other streaks, namely 'streak', 'source', 'timestamp' (either 'COAD' or 'local'). Example: [{'streak': 5, 'source':'COAD', 'timestamp':'12345'},{'streak': 9, 'source':'LOCAL', 'timestamp':'23456'}]

