import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSocialLink } from '@cliporbit/contracts';

test('Social Intelligence - YouTube links detection', () => {
  // Watch video
  const ytVideo = detectSocialLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(ytVideo);
  assert.equal(ytVideo.isSocial, true);
  assert.equal(ytVideo.platform, 'YouTube');
  assert.equal(ytVideo.category, 'Video Sharing & Streaming Platform');
  assert.equal(ytVideo.contentType, 'Video');
  assert.ok(ytVideo.description.includes('YouTube'));

  // Shorts
  const ytShort = detectSocialLink('https://youtube.com/shorts/abcd1234efg');
  assert.ok(ytShort);
  assert.equal(ytShort.platform, 'YouTube');
  assert.equal(ytShort.contentType, 'Short');

  // Channel
  const ytChannel = detectSocialLink('https://youtube.com/@veritasium');
  assert.ok(ytChannel);
  assert.equal(ytChannel.platform, 'YouTube');
  assert.equal(ytChannel.contentType, 'Channel Profile');

  // youtu.be short URL
  const ytShortLink = detectSocialLink('https://youtu.be/dQw4w9WgXcQ');
  assert.ok(ytShortLink);
  assert.equal(ytShortLink.platform, 'YouTube');
  assert.equal(ytShortLink.contentType, 'Video');
});

test('Social Intelligence - X / Twitter links detection', () => {
  // Tweet / Post
  const xPost = detectSocialLink('https://x.com/satyanadella/status/178901234567890');
  assert.ok(xPost);
  assert.equal(xPost.isSocial, true);
  assert.equal(xPost.platform, 'X (formerly Twitter)');
  assert.equal(xPost.category, 'Microblogging & Social Networking Service');
  assert.equal(xPost.contentType, 'Post');
  assert.ok(xPost.description.includes('Post by @satyanadella'));

  // Profile
  const xProfile = detectSocialLink('https://twitter.com/github');
  assert.ok(xProfile);
  assert.equal(xProfile.platform, 'X (formerly Twitter)');
  assert.equal(xProfile.contentType, 'Profile');
});

test('Social Intelligence - Instagram links detection', () => {
  // Reel
  const igReel = detectSocialLink('https://www.instagram.com/reel/C7xyz12345/');
  assert.ok(igReel);
  assert.equal(igReel.isSocial, true);
  assert.equal(igReel.platform, 'Instagram');
  assert.equal(igReel.category, 'Photo & Video Sharing Social Network');
  assert.equal(igReel.contentType, 'Reel');

  // Post
  const igPost = detectSocialLink('https://instagram.com/p/B1234567/');
  assert.ok(igPost);
  assert.equal(igPost.contentType, 'Post');

  // Profile
  const igProfile = detectSocialLink('https://instagram.com/nasa');
  assert.ok(igProfile);
  assert.equal(igProfile.contentType, 'Profile');
});

test('Social Intelligence - GitHub links detection', () => {
  // Repository
  const ghRepo = detectSocialLink('https://github.com/facebook/react');
  assert.ok(ghRepo);
  assert.equal(ghRepo.isSocial, true);
  assert.equal(ghRepo.platform, 'GitHub');
  assert.equal(ghRepo.category, 'Code Hosting & Developer Platform');
  assert.equal(ghRepo.contentType, 'Repository');
  assert.equal(ghRepo.pathSummary, 'facebook/react');

  // Pull Request
  const ghPR = detectSocialLink('https://github.com/vercel/next.js/pull/65000');
  assert.ok(ghPR);
  assert.equal(ghPR.contentType, 'Pull Request');
  assert.ok(ghPR.description.includes('Pull Request #65000'));

  // Issue
  const ghIssue = detectSocialLink('https://github.com/nodejs/node/issues/52000');
  assert.ok(ghIssue);
  assert.equal(ghIssue.contentType, 'Issue');

  // Gist
  const ghGist = detectSocialLink('https://gist.github.com/user/123456789abcdef');
  assert.ok(ghGist);
  assert.equal(ghGist.contentType, 'Gist');
});

test('Social Intelligence - LinkedIn links detection', () => {
  // Member Profile
  const liProfile = detectSocialLink('https://www.linkedin.com/in/reidhoffman/');
  assert.ok(liProfile);
  assert.equal(liProfile.isSocial, true);
  assert.equal(liProfile.platform, 'LinkedIn');
  assert.equal(liProfile.category, 'Professional Networking & Career Platform');
  assert.equal(liProfile.contentType, 'Member Profile');

  // Company Page
  const liCompany = detectSocialLink('https://linkedin.com/company/apple');
  assert.ok(liCompany);
  assert.equal(liCompany.contentType, 'Company Page');
});

test('Social Intelligence - Reddit links detection', () => {
  // Subreddit
  const sub = detectSocialLink('https://www.reddit.com/r/typescript');
  assert.ok(sub);
  assert.equal(sub.isSocial, true);
  assert.equal(sub.platform, 'Reddit');
  assert.equal(sub.category, 'Community Discussion Forum & News Aggregator');
  assert.equal(sub.contentType, 'Subreddit Community');

  // Discussion Post
  const post = detectSocialLink('https://reddit.com/r/technology/comments/1a2b3c/interesting_tech_news/');
  assert.ok(post);
  assert.equal(post.contentType, 'Discussion Post');
});

test('Social Intelligence - TikTok, Discord, Spotify, and Twitch', () => {
  // TikTok Video
  const ttVideo = detectSocialLink('https://www.tiktok.com/@khaby.lame/video/7123456789012345678');
  assert.ok(ttVideo);
  assert.equal(ttVideo.platform, 'TikTok');
  assert.equal(ttVideo.contentType, 'Video');

  // Discord Invite
  const dcInvite = detectSocialLink('https://discord.gg/reactiflux');
  assert.ok(dcInvite);
  assert.equal(dcInvite.platform, 'Discord');
  assert.equal(dcInvite.contentType, 'Server Invite');

  // Spotify Track
  const spTrack = detectSocialLink('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.ok(spTrack);
  assert.equal(spTrack.platform, 'Spotify');
  assert.equal(spTrack.category, 'Audio & Music Streaming Service');
  assert.equal(spTrack.contentType, 'Track');

  // Twitch Stream
  const twStream = detectSocialLink('https://twitch.tv/shroud');
  assert.ok(twStream);
  assert.equal(twStream.platform, 'Twitch');
  assert.equal(twStream.contentType, 'Live Stream');
});

test('Social Intelligence - Threads, Bluesky, Pinterest, and Telegram', () => {
  // Threads Post
  const thPost = detectSocialLink('https://www.threads.net/@zuck/post/C9xyz');
  assert.ok(thPost);
  assert.equal(thPost.platform, 'Threads');
  assert.equal(thPost.contentType, 'Thread Post');

  // Bluesky Post
  const bskyPost = detectSocialLink('https://bsky.app/profile/jay.bsky.team/post/3kabcde');
  assert.ok(bskyPost);
  assert.equal(bskyPost.platform, 'Bluesky');
  assert.equal(bskyPost.contentType, 'Post');

  // Pinterest Pin
  const pin = detectSocialLink('https://www.pinterest.com/pin/1234567890/');
  assert.ok(pin);
  assert.equal(pin.platform, 'Pinterest');
  assert.equal(pin.contentType, 'Pin');

  // Telegram Channel
  const tg = detectSocialLink('https://t.me/durov');
  assert.ok(tg);
  assert.equal(tg.platform, 'Telegram');
  assert.equal(tg.contentType, 'Channel / Group');
});

test('Social Intelligence - Generic Web Links and Technical Hubs', () => {
  // Stack Overflow
  const so = detectSocialLink('https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster');
  assert.ok(so);
  assert.equal(so.platform, 'Stack Overflow');
  assert.equal(so.category, 'Developer Q&A & Technical Knowledge Base');

  // Hacker News
  const hn = detectSocialLink('https://news.ycombinator.com/item?id=39000000');
  assert.ok(hn);
  assert.equal(hn.platform, 'Hacker News');

  // Wikipedia
  const wiki = detectSocialLink('https://en.wikipedia.org/wiki/Clipboard_(software)');
  assert.ok(wiki);
  assert.equal(wiki.platform, 'Wikipedia');

  // Generic website fallback
  const generic = detectSocialLink('https://stripe.com/docs/payments');
  assert.ok(generic);
  assert.equal(generic.isSocial, false);
  assert.equal(generic.platform, 'Stripe');
  assert.equal(generic.category, 'Web Page & Online Resource');
  assert.equal(generic.contentType, 'Web Link');
  assert.ok(generic.description.includes('stripe.com'));
});

test('Social Intelligence - Non-link inputs return null', () => {
  assert.equal(detectSocialLink(''), null);
  assert.equal(detectSocialLink('Hello world this is not a link'), null);
  assert.equal(detectSocialLink('user@example.com'), null);
  assert.equal(detectSocialLink('ftp://files.example.com'), null);
  assert.equal(detectSocialLink('https://not a valid url.com'), null);
  assert.equal(detectSocialLink('const x = "https://example.com";'), null);
});
