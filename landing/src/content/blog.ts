export const blogContent = {
  locale: 'en',
  navLabel: 'Blog',
  title: 'Blog · Pacto',
  description: 'News and ideas from Pacto: private communication, community governance and the people shaping the project.',
  heading: 'The Pacto blog',
  introduction: 'Updates, ideas and invitations to help shape Pacto.',
  readArticle: 'Read the announcement',
  backToBlog: 'All posts',
  featuredLabel: 'Featured article',
  bannerLead: 'New on the blog:',
  bannerAction: 'Read Blog',
  elsewhereHeading: 'More from Pacto',
  externalArticle: {
    title: 'Building the Network-State Substrate',
    href: 'https://dpunk1.substack.com/p/building-the-network-state-substrate',
    description: 'The ideas behind Pacto: connecting private communication with community governance.',
    action: 'Read on Substack',
  },
} as const;

export const logoContestPost = {
  path: 'blog/introducing-the-logo-contest/',
  title: 'Help shape Pacto’s next identity: introducing the logo contest',
  description: 'A community logo contest is coming soon. Explore the design brief for Pacto’s next identity, with voluntary participation and no cash prize. Entries are not open yet.',
  category: 'Community · Design',
  introduction: 'A community should have a symbol it can make its own. We’re preparing a volunteer logo contest to help shape Pacto’s next identity—and inviting designers and community members to explore the brief before entries open.',
  sections: [
    {
      heading: 'A mark for private collective action',
      paragraphs: [
        'Pacto brings private conversations, community governance and shared resources together. It is built for people who want to organize without handing their personal data to a centralized platform or passing KYC.',
        'The next logo should express that purpose: privacy, trust, collective action and community ownership. We’re looking for a simple, distinctive symbol—not a miniature diagram of the technology underneath. The current logo is context, not a template to copy; a handshake is not required.',
      ],
    },
    {
      heading: 'One symbol, from favicon to desktop',
      paragraphs: [
        'The selected design is intended to become Pacto’s website logo, desktop app icon and in-app identity. It needs to stay recognizable at 16px and 32px, work in monochrome, and hold up on both light and dark backgrounds.',
        'The planned brief asks for original, entrant-created artwork: editable SVGs in color and one-color versions, a 1024×1024 PNG preview, and a short explanation of the idea. Up to three concepts per entrant are planned. The contest page contains the full file requirements and rules, including the restriction on AI-generated final logo artwork.',
      ],
    },
    {
      heading: 'Volunteer participation, with clear expectations',
      paragraphs: [
        'This is not a paid commission. Participation is voluntary and free, and there is no cash prize. The intended reward is adoption of the selected design and public creator credit, subject to completing the disclosed rights agreement and final assets.',
        'Entrants keep their copyrights. The planned submission permission covers evaluation and limited public display of previews with chosen credit; it does not let Pacto adopt non-winning artwork as its brand. Only the selected logo requires a separate written rights agreement before adoption. Final terms and the named organizer will be published before entries open.',
      ],
    },
    {
      heading: 'A contest inside the community',
      paragraphs: [
        'Submissions are planned for the Pacto Design Squad’s #logo-contest channel. When joining is available, participants will need a Pacto account and approved Squad membership. Pseudonyms are welcome, and nobody should share a recovery phrase or private key to take part.',
        'The planned process gives entrants 30 days after opening, followed by screening and a shortlist, seven days of advisory community feedback, and a final ranked selection by maintainers within the next seven days. No calendar dates have been announced. The Squad and channel are still being prepared, so this post is not an invitation to submit today.',
      ],
    },
  ],
  closingHeading: 'Start with the brief',
  closing: 'Read the contest page for the complete brief, planned rules and submission steps. That page is the source for confirmed dates, organizer contact and joining details when they are ready. For now, explore the direction, share the announcement, and check back before submitting any work.',
  contestAction: 'Visit the logo contest page',
  rulesAction: 'Read the planned rules',
} as const;
