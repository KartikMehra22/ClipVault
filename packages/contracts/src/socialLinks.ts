/**
 * ClipOrbit — Social Media & Web Link Intelligence Engine
 *
 * Automatically inspects copied URLs to identify:
 * 1. Where it belongs (Platform / Service brand)
 * 2. What kind of app or website it is (Category / Kind description)
 * 3. Short context-aware description of the resource (Video, Profile, Reel, Post, Repo, etc.)
 */

export type SocialPlatformId =
  | 'youtube'
  | 'twitter'
  | 'instagram'
  | 'github'
  | 'linkedin'
  | 'reddit'
  | 'tiktok'
  | 'discord'
  | 'spotify'
  | 'twitch'
  | 'threads'
  | 'bluesky'
  | 'pinterest'
  | 'telegram'
  | 'facebook'
  | 'medium'
  | 'substack'
  | 'figma'
  | 'dribbble'
  | 'behance'
  | 'stackoverflow'
  | 'wikipedia'
  | 'hackernews'
  | 'generic';

export interface SocialLinkTheme {
  primary: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  iconName: string;
}

export interface SocialLinkInfo {
  /** True if the text is a valid web URL */
  isLink: boolean;
  /** True if the URL belongs to a recognized social, developer, or creator platform */
  isSocial: boolean;
  /** Canonical platform identifier */
  platformId: SocialPlatformId;
  /** "Where it belongs": Human-friendly platform brand name (e.g., "YouTube", "Instagram", "GitHub") */
  platform: string;
  /** "What kind off app or website it is": High-level category (e.g. "Video Sharing & Streaming Platform") */
  category: string;
  /** Specific resource type (e.g. "Video", "Short", "Reel", "Post", "Repository", "Subreddit", "Profile") */
  contentType: string;
  /** "A short description": Clear, context-aware explanation of what this link contains */
  description: string;
  /** Normalized URL string */
  url: string;
  /** Clean hostname / domain (e.g., "youtube.com") */
  domain: string;
  /** Meaningful extracted entity or path (e.g., "@username", "facebook/react", "r/programming") */
  pathSummary?: string;
  /** Visual branding colors for UI rendering */
  theme: SocialLinkTheme;
}

/**
 * Normalizes hostnames by stripping leading "www." or mobile subdomains "m."
 */
function cleanHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^(?:www\.|m\.|mobile\.)/i, '');
}

/**
 * Extracts and cleans path segments, filtering out empty segments.
 */
function getPathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Capitalizes a string nicely.
 */
function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Deterministically inspects a string to detect whether it is a social media or web link,
 * and extracts comprehensive platform, app kind, and contextual description metadata.
 *
 * @param text The input plaintext string to evaluate.
 * @returns SocialLinkInfo if the text is a valid HTTP/HTTPS URL, or null otherwise.
 */
export function detectSocialLink(text: string): SocialLinkInfo | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.includes('\n') || trimmed.includes('\r') || trimmed.includes(' ')) {
    return null;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }

  const host = cleanHostname(parsed.hostname);
  const segments = getPathSegments(parsed.pathname);
  const pathname = parsed.pathname;

  // 1. YouTube
  if (host === 'youtube.com' || host === 'youtu.be') {
    let contentType = 'Video';
    let description = 'Watch video playback, chapters, and community discussion on YouTube.';
    let pathSummary: string | undefined;

    if (host === 'youtu.be') {
      contentType = 'Video';
      description = 'Direct short link to YouTube video playback.';
      if (segments[0]) pathSummary = `Video ID: ${segments[0]}`;
    } else if (segments[0] === 'shorts') {
      contentType = 'Short';
      description = 'Short-form vertical video playback on YouTube.';
      if (segments[1]) pathSummary = `Short ID: ${segments[1]}`;
    } else if (segments[0] === 'playlist' || parsed.searchParams.has('list')) {
      contentType = 'Playlist';
      description = 'Curated video collection and playlist playback on YouTube.';
      const listId = parsed.searchParams.get('list');
      if (listId) pathSummary = `Playlist: ${listId.slice(0, 16)}...`;
    } else if (segments[0]?.startsWith('@') || segments[0] === 'c' || segments[0] === 'channel' || segments[0] === 'user') {
      contentType = 'Channel Profile';
      description = 'Creator profile, playlists, community posts, and video uploads.';
      const name = segments[0]?.startsWith('@') ? segments[0] : segments[1] || segments[0];
      pathSummary = `Channel: ${name}`;
    } else if (parsed.searchParams.has('v')) {
      contentType = 'Video';
      description = 'Watch video playback, chapters, and community discussion on YouTube.';
      pathSummary = `Video: ${parsed.searchParams.get('v')}`;
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'youtube',
      platform: 'YouTube',
      category: 'Video Sharing & Streaming Platform',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#FF0000',
        badgeBg: 'rgba(255, 0, 0, 0.12)',
        badgeBorder: 'rgba(255, 0, 0, 0.28)',
        badgeText: '#FF4D4D',
        iconName: 'youtube',
      },
    };
  }

  // 2. Twitter / X
  if (host === 'twitter.com' || host === 'x.com' || host === 't.co') {
    let contentType = 'Post';
    let description = 'Post, thread, or conversation shared on X (formerly Twitter).';
    let pathSummary: string | undefined;

    if (segments.length >= 3 && segments[1] === 'status') {
      contentType = 'Post';
      description = `Post by @${segments[0]} shared on X microblogging network.`;
      pathSummary = `@${segments[0]}/status/${segments[2]}`;
    } else if (segments.length === 1 && !['home', 'explore', 'notifications', 'messages'].includes(segments[0])) {
      contentType = 'Profile';
      description = `User profile, bio, and timeline of @${segments[0]} on X.`;
      pathSummary = `@${segments[0]}`;
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'twitter',
      platform: 'X (formerly Twitter)',
      category: 'Microblogging & Social Networking Service',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#1D9BF0',
        badgeBg: 'rgba(29, 155, 240, 0.12)',
        badgeBorder: 'rgba(29, 155, 240, 0.28)',
        badgeText: '#38BDF8',
        iconName: 'twitter',
      },
    };
  }

  // 3. Instagram
  if (host === 'instagram.com' || host === 'instagr.am') {
    let contentType = 'Post';
    let description = 'Photo publication, carousel, or media post on Instagram.';
    let pathSummary: string | undefined;

    if (segments[0] === 'reel' || segments[0] === 'reels') {
      contentType = 'Reel';
      description = 'Short-form vertical video reel on Instagram with audio and effects.';
      if (segments[1]) pathSummary = `Reel: ${segments[1]}`;
    } else if (segments[0] === 'p') {
      contentType = 'Post';
      description = 'Photo, video, or carousel publication on Instagram.';
      if (segments[1]) pathSummary = `Post: ${segments[1]}`;
    } else if (segments[0] === 'stories') {
      contentType = 'Story';
      description = 'Ephemeral story update or highlight on Instagram.';
      if (segments[1]) pathSummary = `Story: @${segments[1]}`;
    } else if (segments[0] && !['explore', 'direct', 'accounts'].includes(segments[0])) {
      contentType = 'Profile';
      description = `Creator profile, grid feed, and stories of @${segments[0]} on Instagram.`;
      pathSummary = `@${segments[0]}`;
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'instagram',
      platform: 'Instagram',
      category: 'Photo & Video Sharing Social Network',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#E1306C',
        badgeBg: 'rgba(225, 48, 108, 0.12)',
        badgeBorder: 'rgba(225, 48, 108, 0.28)',
        badgeText: '#F472B6',
        iconName: 'instagram',
      },
    };
  }

  // 4. GitHub
  if (host === 'github.com' || host === 'gist.github.com') {
    let contentType = 'Repository';
    let description = 'Open-source software repository and code collaboration on GitHub.';
    let pathSummary: string | undefined;

    if (host === 'gist.github.com') {
      contentType = 'Gist';
      description = 'Shared code snippet, paste, or configuration file on GitHub Gist.';
      pathSummary = segments.join('/');
    } else if (segments.length >= 4 && segments[2] === 'pull') {
      contentType = 'Pull Request';
      description = `Pull Request #${segments[3]} in ${segments[0]}/${segments[1]} with code diffs and review discussions.`;
      pathSummary = `${segments[0]}/${segments[1]}#${segments[3]}`;
    } else if (segments.length >= 4 && segments[2] === 'issues') {
      contentType = 'Issue';
      description = `Issue #${segments[3]} in ${segments[0]}/${segments[1]} tracking bug reports or feature proposals.`;
      pathSummary = `${segments[0]}/${segments[1]}#${segments[3]}`;
    } else if (segments.length >= 4 && segments[2] === 'commit') {
      contentType = 'Commit';
      description = `Code changeset commit in repository ${segments[0]}/${segments[1]}.`;
      pathSummary = `${segments[0]}/${segments[1]}@${segments[3].slice(0, 7)}`;
    } else if (segments.length === 2) {
      contentType = 'Repository';
      description = `Git repository ${segments[0]}/${segments[1]} with source tree, releases, and documentation.`;
      pathSummary = `${segments[0]}/${segments[1]}`;
    } else if (segments.length === 1 && !['features', 'pricing', 'explore', 'topics'].includes(segments[0])) {
      contentType = 'Developer Profile';
      description = `Developer profile, repositories, and activity overview for @${segments[0]}.`;
      pathSummary = `@${segments[0]}`;
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'github',
      platform: 'GitHub',
      category: 'Code Hosting & Developer Platform',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#8957E5',
        badgeBg: 'rgba(137, 87, 229, 0.12)',
        badgeBorder: 'rgba(137, 87, 229, 0.28)',
        badgeText: '#A78BFA',
        iconName: 'github',
      },
    };
  }

  // 5. LinkedIn
  if (host === 'linkedin.com' || host === 'lnkd.in') {
    let contentType = 'Post';
    let description = 'Professional commentary, industry article, or business update on LinkedIn.';
    let pathSummary: string | undefined;

    if (segments[0] === 'in' && segments[1]) {
      contentType = 'Member Profile';
      description = `Professional profile, career history, and network connections for ${segments[1]}.`;
      pathSummary = `Profile: ${segments[1]}`;
    } else if (segments[0] === 'company' && segments[1]) {
      contentType = 'Company Page';
      description = `Corporate organization, employee updates, and job vacancies for ${segments[1]}.`;
      pathSummary = `Company: ${segments[1]}`;
    } else if (segments[0] === 'jobs') {
      contentType = 'Job Listing';
      description = 'Employment opportunity, job specifications, and application details on LinkedIn.';
    } else if (segments[0] === 'posts' || pathname.includes('/feed/update/')) {
      contentType = 'Post';
      description = 'Professional post, article, or announcement shared with industry network.';
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'linkedin',
      platform: 'LinkedIn',
      category: 'Professional Networking & Career Platform',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#0A66C2',
        badgeBg: 'rgba(10, 102, 194, 0.12)',
        badgeBorder: 'rgba(10, 102, 194, 0.28)',
        badgeText: '#60A5FA',
        iconName: 'linkedin',
      },
    };
  }

  // 6. Reddit
  if (host === 'reddit.com' || host === 'redd.it' || host === 'old.reddit.com') {
    let contentType = 'Community';
    let description = 'Community discussion forum, user submissions, and commentary on Reddit.';
    let pathSummary: string | undefined;

    if (segments[0] === 'r' && segments[1]) {
      if (segments[2] === 'comments') {
        contentType = 'Discussion Post';
        description = `Threaded discussion, upvotes, and comments in r/${segments[1]}.`;
        pathSummary = `r/${segments[1]}`;
      } else {
        contentType = 'Subreddit Community';
        description = `Thematic community forum and submissions in r/${segments[1]}.`;
        pathSummary = `r/${segments[1]}`;
      }
    } else if ((segments[0] === 'user' || segments[0] === 'u') && segments[1]) {
      contentType = 'User Profile';
      description = `Redditor profile, submitted posts, and comment history for u/${segments[1]}.`;
      pathSummary = `u/${segments[1]}`;
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'reddit',
      platform: 'Reddit',
      category: 'Community Discussion Forum & News Aggregator',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#FF4500',
        badgeBg: 'rgba(255, 69, 0, 0.12)',
        badgeBorder: 'rgba(255, 69, 0, 0.28)',
        badgeText: '#FB923C',
        iconName: 'reddit',
      },
    };
  }

  // 7. TikTok
  if (host === 'tiktok.com' || host === 'vt.tiktok.com') {
    let contentType = 'Video';
    let description = 'Short-form viral video with audio track, effects, and creator caption.';
    let pathSummary: string | undefined;

    if (segments[0]?.startsWith('@')) {
      if (segments[1] === 'video') {
        contentType = 'Video';
        description = `TikTok video clip by ${segments[0]}.`;
        pathSummary = `${segments[0]}/video/${segments[2] || ''}`;
      } else {
        contentType = 'Creator Profile';
        description = `TikTok creator profile, video catalog, and follower showcase for ${segments[0]}.`;
        pathSummary = segments[0];
      }
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'tiktok',
      platform: 'TikTok',
      category: 'Short-Form Mobile Video Platform',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#00F2FE',
        badgeBg: 'rgba(0, 242, 254, 0.12)',
        badgeBorder: 'rgba(0, 242, 254, 0.28)',
        badgeText: '#22D3EE',
        iconName: 'tiktok',
      },
    };
  }

  // 8. Discord
  if (host === 'discord.com' || host === 'discord.gg' || host === 'discordapp.com') {
    let contentType = 'Community';
    let description = 'Voice, video, and text communication server on Discord.';
    let pathSummary: string | undefined;

    if (host === 'discord.gg' || segments[0] === 'invite') {
      contentType = 'Server Invite';
      description = 'Direct invitation link to join an interactive Discord chat and voice community.';
      pathSummary = `Invite: ${segments[segments.length - 1]}`;
    } else if (segments[0] === 'channels') {
      contentType = 'Channel Link';
      description = 'Direct channel reference in a Discord guild.';
      pathSummary = `Guild: ${segments[1] || ''}`;
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'discord',
      platform: 'Discord',
      category: 'Instant Messaging, Voice & Community Chat Platform',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#5865F2',
        badgeBg: 'rgba(88, 101, 242, 0.12)',
        badgeBorder: 'rgba(88, 101, 242, 0.28)',
        badgeText: '#818CF8',
        iconName: 'discord',
      },
    };
  }

  // 9. Spotify
  if (host === 'spotify.com' || host === 'open.spotify.com') {
    let contentType = 'Track';
    let description = 'Streamable music track, album, or podcast episode on Spotify.';
    let pathSummary: string | undefined;

    if (segments[0] === 'track') {
      contentType = 'Track';
      description = 'Streamable song, artist recording, and music playback on Spotify.';
      if (segments[1]) pathSummary = `Track ID: ${segments[1]}`;
    } else if (segments[0] === 'album') {
      contentType = 'Album';
      description = 'Complete musical release, track list, and credits on Spotify.';
      if (segments[1]) pathSummary = `Album ID: ${segments[1]}`;
    } else if (segments[0] === 'playlist') {
      contentType = 'Playlist';
      description = 'Curated music compilation and custom playlist on Spotify.';
      if (segments[1]) pathSummary = `Playlist ID: ${segments[1]}`;
    } else if (segments[0] === 'show' || segments[0] === 'episode') {
      contentType = 'Podcast';
      description = 'Podcast show, series episode, or audio interview on Spotify.';
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'spotify',
      platform: 'Spotify',
      category: 'Audio & Music Streaming Service',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#1DB954',
        badgeBg: 'rgba(29, 185, 84, 0.12)',
        badgeBorder: 'rgba(29, 185, 84, 0.28)',
        badgeText: '#4ADE80',
        iconName: 'spotify',
      },
    };
  }

  // 10. Twitch
  if (host === 'twitch.tv') {
    let contentType = 'Live Stream';
    let description = 'Live video broadcast, interactive chat, and stream on Twitch.';
    let pathSummary: string | undefined;

    if (segments[0] === 'clip' || segments[1] === 'clip') {
      contentType = 'Video Clip';
      description = 'Highlighted gameplay moment or broadcast video clip on Twitch.';
    } else if (segments[0]) {
      contentType = 'Live Stream';
      description = `Live stream channel and interactive broadcast community of ${segments[0]}.`;
      pathSummary = `@${segments[0]}`;
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'twitch',
      platform: 'Twitch',
      category: 'Live Video Streaming & Gaming Broadcast Platform',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#9146FF',
        badgeBg: 'rgba(145, 70, 255, 0.12)',
        badgeBorder: 'rgba(145, 70, 255, 0.28)',
        badgeText: '#C084FC',
        iconName: 'twitch',
      },
    };
  }

  // 11. Threads
  if (host === 'threads.net') {
    let contentType = 'Post';
    let description = 'Conversational text post and replies on Threads by Meta.';
    let pathSummary: string | undefined;

    if (segments[0]?.startsWith('@')) {
      if (segments[1] === 'post') {
        contentType = 'Thread Post';
        description = `Public post by ${segments[0]} on Threads conversation network.`;
        pathSummary = `${segments[0]}/post/${segments[2] || ''}`;
      } else {
        contentType = 'Profile';
        description = `User profile and public conversations of ${segments[0]} on Threads.`;
        pathSummary = segments[0];
      }
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'threads',
      platform: 'Threads',
      category: 'Text-Based Social Conversation Platform',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#E0E0E0',
        badgeBg: 'rgba(255, 255, 255, 0.1)',
        badgeBorder: 'rgba(255, 255, 255, 0.25)',
        badgeText: '#F3F4F6',
        iconName: 'threads',
      },
    };
  }

  // 12. Bluesky
  if (host === 'bsky.app') {
    let contentType = 'Post';
    let description = 'Post or skeet on the open decentralized AT Protocol social network.';
    let pathSummary: string | undefined;

    if (segments[0] === 'profile' && segments[1]) {
      if (segments[2] === 'post') {
        contentType = 'Post';
        description = `Decentralized public post by @${segments[1]} on Bluesky.`;
        pathSummary = `@${segments[1]}`;
      } else {
        contentType = 'Profile';
        description = `Decentralized user profile and open social feed of @${segments[1]}.`;
        pathSummary = `@${segments[1]}`;
      }
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'bluesky',
      platform: 'Bluesky',
      category: 'Decentralized Social Network (AT Protocol)',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#0085FF',
        badgeBg: 'rgba(0, 133, 255, 0.12)',
        badgeBorder: 'rgba(0, 133, 255, 0.28)',
        badgeText: '#60A5FA',
        iconName: 'bluesky',
      },
    };
  }

  // 13. Pinterest
  if (host === 'pinterest.com' || host === 'pin.it') {
    let contentType = 'Pin';
    let description = 'Visual idea bookmark, photo inspiration, or creative design on Pinterest.';
    let pathSummary: string | undefined;

    if (segments[0] === 'pin') {
      contentType = 'Pin';
      description = 'Bookmarked visual idea, recipe, or design pin on Pinterest.';
      if (segments[1]) pathSummary = `Pin ID: ${segments[1]}`;
    } else if (segments.length >= 2) {
      contentType = 'Board';
      description = `Curated visual moodboard and collection: ${segments[1]} on Pinterest.`;
      pathSummary = `${segments[0]}/${segments[1]}`;
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'pinterest',
      platform: 'Pinterest',
      category: 'Visual Discovery & Idea Bookmarking Platform',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#E60023',
        badgeBg: 'rgba(230, 0, 35, 0.12)',
        badgeBorder: 'rgba(230, 0, 35, 0.28)',
        badgeText: '#F87171',
        iconName: 'pinterest',
      },
    };
  }

  // 14. Telegram
  if (host === 't.me' || host === 'telegram.me') {
    let contentType = 'Channel / Group';
    let description = 'Public broadcast channel, community group, or message on Telegram.';
    let pathSummary: string | undefined;

    if (segments[0]) {
      pathSummary = `@${segments[0]}`;
      description = `Public channel or chat community: @${segments[0]} on Telegram messaging network.`;
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'telegram',
      platform: 'Telegram',
      category: 'Cloud-Based Instant Messaging & Broadcast Platform',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      pathSummary,
      theme: {
        primary: '#24A1DE',
        badgeBg: 'rgba(36, 161, 222, 0.12)',
        badgeBorder: 'rgba(36, 161, 222, 0.28)',
        badgeText: '#38BDF8',
        iconName: 'telegram',
      },
    };
  }

  // 15. Facebook
  if (host === 'facebook.com' || host === 'fb.com' || host === 'fb.watch') {
    let contentType = 'Post';
    let description = 'Public social publication, media post, or status update on Facebook.';

    if (host === 'fb.watch' || segments[0] === 'watch') {
      contentType = 'Video';
      description = 'Video broadcast or watch playback on Facebook.';
    } else if (segments[0] === 'groups') {
      contentType = 'Group';
      description = 'Community group discussion, events, and member feed on Facebook.';
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'facebook',
      platform: 'Facebook',
      category: 'Social Networking Service',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      theme: {
        primary: '#1877F2',
        badgeBg: 'rgba(24, 119, 242, 0.12)',
        badgeBorder: 'rgba(24, 119, 242, 0.28)',
        badgeText: '#60A5FA',
        iconName: 'facebook',
      },
    };
  }

  // 16. Figma
  if (host === 'figma.com') {
    let contentType = 'Design File';
    let description = 'Collaborative interface design file with components and vector canvas.';
    if (segments[0] === 'proto') {
      contentType = 'Prototype';
      description = 'Interactive clickable UI prototype preview on Figma.';
    }

    return {
      isLink: true,
      isSocial: true,
      platformId: 'figma',
      platform: 'Figma',
      category: 'Collaborative Interface Design & Prototyping Tool',
      contentType,
      description,
      url: trimmed,
      domain: parsed.hostname,
      theme: {
        primary: '#F24E1E',
        badgeBg: 'rgba(242, 78, 30, 0.12)',
        badgeBorder: 'rgba(242, 78, 30, 0.28)',
        badgeText: '#FB923C',
        iconName: 'figma',
      },
    };
  }

  // 17. Medium & Substack
  if (host === 'medium.com' || host.endsWith('.substack.com') || host === 'substack.com') {
    const isMedium = host === 'medium.com';
    return {
      isLink: true,
      isSocial: true,
      platformId: isMedium ? 'medium' : 'substack',
      platform: isMedium ? 'Medium' : 'Substack',
      category: isMedium ? 'Online Publishing & Blogging Platform' : 'Independent Newsletter & Publication Platform',
      contentType: 'Article',
      description: isMedium
        ? 'Thought leadership article, essay, or publication on Medium.'
        : 'Independent newsletter publication, commentary, and subscriber issue.',
      url: trimmed,
      domain: parsed.hostname,
      theme: {
        primary: isMedium ? '#FFFFFF' : '#FF6719',
        badgeBg: 'rgba(255, 103, 25, 0.12)',
        badgeBorder: 'rgba(255, 103, 25, 0.28)',
        badgeText: '#FB923C',
        iconName: isMedium ? 'medium' : 'substack',
      },
    };
  }

  // 18. Developer & Technical Hubs
  if (host === 'stackoverflow.com') {
    return {
      isLink: true,
      isSocial: true,
      platformId: 'stackoverflow',
      platform: 'Stack Overflow',
      category: 'Developer Q&A & Technical Knowledge Base',
      contentType: 'Question / Answer',
      description: 'Programming question, verified answers, and developer code troubleshooting.',
      url: trimmed,
      domain: parsed.hostname,
      theme: {
        primary: '#F48024',
        badgeBg: 'rgba(244, 128, 36, 0.12)',
        badgeBorder: 'rgba(244, 128, 36, 0.28)',
        badgeText: '#FB923C',
        iconName: 'stackoverflow',
      },
    };
  }

  if (host === 'news.ycombinator.com') {
    return {
      isLink: true,
      isSocial: true,
      platformId: 'hackernews',
      platform: 'Hacker News',
      category: 'Technology News & Startup Community',
      contentType: 'Discussion Thread',
      description: 'Technology discussion, startup news, and comments curated on Y Combinator Hacker News.',
      url: trimmed,
      domain: parsed.hostname,
      theme: {
        primary: '#FF6600',
        badgeBg: 'rgba(255, 102, 0, 0.12)',
        badgeBorder: 'rgba(255, 102, 0, 0.28)',
        badgeText: '#FB923C',
        iconName: 'hackernews',
      },
    };
  }

  if (host.includes('wikipedia.org')) {
    return {
      isLink: true,
      isSocial: true,
      platformId: 'wikipedia',
      platform: 'Wikipedia',
      category: 'Free Online Encyclopedia & Knowledge Repository',
      contentType: 'Encyclopedia Article',
      description: 'Collaborative encyclopedia entry, citations, and reference overview.',
      url: trimmed,
      domain: parsed.hostname,
      theme: {
        primary: '#E0E0E0',
        badgeBg: 'rgba(255, 255, 255, 0.1)',
        badgeBorder: 'rgba(255, 255, 255, 0.25)',
        badgeText: '#E2E8F0',
        iconName: 'wikipedia',
      },
    };
  }

  // 19. Generic Web Link Fallback (Smart detection for any other website)
  const parts = host.split('.');
  const baseName = parts.length >= 2 ? parts[parts.length - 2] : host;
  const brandName = capitalize(baseName);
  const pathLabel = segments.length > 0 ? `/${segments.slice(0, 2).join('/')}` : '/';

  return {
    isLink: true,
    isSocial: false,
    platformId: 'generic',
    platform: brandName || parsed.hostname,
    category: 'Web Page & Online Resource',
    contentType: 'Web Link',
    description: `Online webpage or web service hosted at ${parsed.hostname}${pathLabel !== '/' ? ` (${pathLabel})` : ''}.`,
    url: trimmed,
    domain: parsed.hostname,
    pathSummary: pathLabel !== '/' ? pathLabel : undefined,
    theme: {
      primary: '#6366F1',
      badgeBg: 'rgba(99, 102, 241, 0.12)',
      badgeBorder: 'rgba(99, 102, 241, 0.28)',
      badgeText: '#818CF8',
      iconName: 'link',
    },
  };
}
