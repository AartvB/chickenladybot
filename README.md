# ChickenBotOnceADay
ChickenBotOnceADay is a reddit bot, used to moderate the subreddit r/countwithchickenlady.

This code is shared to give people insight in how this bot works. You are free to use (parts of) this code to create a reddit bot of your own!

## Usage for moderators
### Subreddit usecases
- Toggle shutdown: When the bot is having large problems, you can activate a shutdown. For most use-cases, a soft shutdown is enough. This will shut down all bot activity that removes posts. However, if the bot fully needs to stop, such as in the case of a database update, a hard shutdown can be activated.
- Post as bot: A moderator can make a post using the bot account.
- Change settings: A moderator can edit bot settings.

### Post usecases
- Fix streak. If there is a problem with the streak of a user, the moderator can use this feature to get a report of the streak development of that user, and can use it to fix the problem. It can also be used to add a streak of a user which is carried over from r/CountOnceADay. The Post ID must be the Post ID of the post at r/CountOnceADay.
- Edit bot post: If a moderator posted using the bot account, the post can be edited by a moderator.
- View bot post info: Allows moderator to see which moderators created and edited the bot posts, and what edits they made.
- Comment as bot: Allows moderators to comment to a post using the bot account.
- Apply rule: Allows moderators to check certain rules and automatically fix or remove the posts, as well as adding a moderator note to the user.

### Comment usecases
- Edit bot comment: If a moderator commented using the bot account, the comment can be edited by a moderator.
- View bot comment info: Allows moderator to see which moderators created and edited the bot comments, and what edits they made.
- Comment as bot: Allows moderators to comment to a comment using the bot account.

## Usage for users
### Subreddit usecases
- View post window: A user can see when they should post again to maintain their streak. Users can also subscribe to streak notifications here.

## Functionalities
The bot does the following things:
- Check if the post is titled correctly. It should be a whole number, exactly 1 higher than the post before it. If it is not titled correctly, it is automatically removed with a comment explaining the deletion reason.
- Check if the user does not post more than once per calendar day. It removes any latest post of a user if in the last 2 days, 3 or more posts have been on the same calendar day. We decided to not make it stricter (for example, max. 8 posts in the last 7 calendar days), since that could be confusing to most people. As long as there exists a timezone for which this is not the case, it is okay.
- The post will not be deleted if it is manually approved by a moderator, or if it has been added to the database manually or automatically.
- Update the user streaks. The streak of a user is the number of days the user has posted exactly 1 times per calendar day, until today. If someone hasn't posted for a full day, their post is reset to 0. The bot checks the streak for every possible timezone, and picks the longest streak.
- The user streak is included in the user flair. If the user did not put in a custom flair, the user flair is set to ```Streak: x```, with x the current streak. If the user did put in a custom flair, the user flair is set to ```Custom flair - Streak: x```.
- Update the post that tells the user what the correct next number is.
- Update the leaderboards on the wiki, that show interesting statistics of users and posts.
- If a user (or a moderator) removes a post within 10 minutes of it being posted, it is removed from the streak database. If it is removed after 10 minutes, it will not be removed from the streak database, so it will still be used when calculating the streak, and still counts for the 'post once per day' rule. This is done, because otherwise someone might lose their streak if their posts gets deleted after a few hours. However, due to privacy reasons, 21 days later it will be removed from the streak database anyways. Only the timestamp of the post is saved to be able to accurately calculate the user streak.
- It stores information on all posts ever posted on this subreddit, unless the posts are deleted, in which case the data will be removed after 21 days.
- 5 minutes after a post has been posted on the r/countwithchickenlady subreddit, the post is linked to in the discord server. The 5 minutes delay is to allow people to remove their posts without it automatically appearing in the discord server.
- If a posts gets an NSFW tag within 21 days after posting, the contents of the posts are obscured in the discord channel, to avoid having NSFW content in the SFW section of the discord server.
- Once per day, the bot checks all images in the daily-bot-post channel, and posts the image with the highest number of checkmarks to reddit using the ChickenBotOnceADay account. Ties are won by the earlier comment.
- Users can subscribe to notifications about their streak. The bot will send a notification when the post window opens, and another notification 5 hours before the post window closes. If the post window cannot be determined correctly, an untimed notification will be sent instead, 12 hours after their last post. Subscribing and unsubscribing can be done by commenting !subscribe or !unsubscribe on the sub, by using the menu, or by sending a direct message to the bot with the same commands. The bot also responds to !viewpostwindow, which will show the user when they can post again to maintain their streak.

## Source
The source code of the bot can be found here: https://github.com/AartvB/chickenladybot.

## License
MIT License

Copyright (c) 2026 AartvB

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.