# Redis structure

This file explains the structure of the Redis database for this app

## Sorted sets
- **users**: Contains all usernames of users that have posted to the sub. Not sorted.
- **posts**: Contains all ids of posts that have been approved. Does not contain deleted posts. Sorted based on time. If two posts are posted simultaneously, the post that reached us through the API first is first. Score is an integer.
- **deleted-posts**: Contains all ids of posts that were approved, but have been deleted within 10 minutes of posting. Not sorted.
- **new-post-queue**: Contains all ids of posts that were posted, but not yet approved

## Single values
- **new-post-handler-lock**: Either 'open' or 'closed'. Makes sure only a single post handler is active at the same time.
- **current-count**: The current count of the subreddit.

## Groep of sorted sets
- **posts-of-\[username\]**: Each of these sorted lists contains the post ids of this user. Sorted based on time. Score is an integer.




