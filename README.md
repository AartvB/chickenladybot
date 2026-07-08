# ChickenLadyBot
ChickenLadyBot is a reddit bot, used to moderate the subreddit r/countwithchickenlady.

This code is shared to give people insight in how this bot works. You are free to use (parts of) this code to create a reddit bot of your own!

## Usage for moderators
### Subreddit usecases
- Toggle shutdown: When the bot is having large problems, you can activate a shutdown. For most use-cases, a soft shutdown is enough. This will shut down all bot activity that removes posts. However, if the bot fully needs to stop, such as in the case of a database update, a hard shutdown can be activated.

### Post usecases
- Add post to streak database. If for some reason a post is not recorded in the streak database, the post can be manually added using this button.
- Remove post from streak database. If you want to remove a post from the streak database, the post can be manually removed using this button.
- Add manual streak. This button can be used to add a streak of a user which is carried over from r/CountOnceADay. The Post ID must be the Post ID of the post at r/CountOnceADay. This button can also be used to set the streak of a user for a r/countwithchickenlady post to a specific value. For example, if the bot didn't allow them to post for a day due to a mistake, their streak will be lost. The streak of the new post can be set to the correct value with this button.
- View streak development. This button can be used to view the development of a users streak over time.

## Functionalities
The bot does the following things:
- Check if the post is titled correctly. It should be a whole number, exactly 1 higher than the post before it. If it is not titled correctly, it is automatically removed.
- Check if the user does not post more than once per calendar day. It removes any latest post of a user if in the last 2 days, 3 or more posts have been on the same calendar day. We decided to not make it stricter (for example, max. 8 posts in the last 7 calendar days), since that could be confusing to most people. As long as there exists a timezone for which this is not the case, it is okay.
- The posts is not deleted if it is manually approved by a moderator, or if it has been added to the database manually or automatically.
- Update the user streaks. The streak of a user is the number of days the user has posted exactly 1 times per calendar day, until today. If someone hasn't posted for a full day, their post is reset to 0. The bot checks the streak for every possible timezone, and pick the longest streak.
- The user streak is included in the user flair. If the user did not put in a custom flair, the user flair is set to ```Streak: x```, with x the current streak. If the user did put in a custom flair, the user flair is set to ```Custom flair - Streak: x```.
- Update the post that tells user what the correct next number is.
- Update the leaderboards on the wiki, that show interesting statistics of users and posts.
- If a user (or a moderator) removes a post within 10 minutes of it being posted, it is removed from the streak database. If it is removed after 10 minutes, it will not be removed from the streak database, so it will still be used when calculating the streak, and still counts for the 'post once per day' rule. This is done, because otherwise someone might lose their streak if their posts gets deleted after a few hours. However, due to privacy reasons, 21 days later it will be removed from the streak database anyways. Only the timestamp of the post is saved to be able to accurately calculate the user streak.
- It stores information on all posts ever posted on this subreddit, unless the posts are deleted.
- There are additional functionalities of this bot, which are for now handled by the code on [this](https://github.com/AartvB/ChickenDiscord) github repository.

## TODO
- Write code to allow a database update
- Work through all 'TODO's in the code (none of them are critical at this point, they are all there for additional features)

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