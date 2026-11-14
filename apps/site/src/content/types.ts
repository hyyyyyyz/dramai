import type { ProviderKindId } from './facts.ts'

export type Locale = 'zh' | 'en'

export type IconName =
  | 'shield'
  | 'tasks'
  | 'link'
  | 'users'
  | 'film'
  | 'export'
  | 'terminal'
  | 'monitor'
  | 'sun'
  | 'git'
  | 'down'
  | 'copy'
  | 'alert'
  | 'play'

export type ShotName = 'storyboard' | 'overview' | 'assets' | 'confirm' | 'compose' | 'tasks'

export interface Stage {
  title: string
  text: string
  out: string
}

export interface Feature {
  icon: IconName
  title: string
  text: string
  /** Optional small label next to the title, e.g. that the item is only in the source. */
  tag?: string
}

export interface Screen {
  shot: ShotName
  alt: string
  title: string
  text: string
}

export interface EditionRow {
  label: string
  desktop: string
  webui: string
}

export interface CostPoint {
  title: string
  text: string
}

export interface PlatformRow {
  name: string
  detail: string
  /** File name pattern with {version} replaced at build time. */
  files: string[]
  tested: boolean
}

export interface FaqItem {
  q: string
  /** Paragraphs. Inline `code` is written with backticks and rendered as <code>. */
  a: string[]
}

export interface StatusColumn {
  title: string
  items: string[]
}

/** All visible text of one language. Both languages must have the same shape (and the same sections). */
export interface Content {
  locale: Locale
  htmlLang: string
  name: string
  meta: { title: string; description: string; ogAlt: string }
  skip: string
  header: {
    nav: { id: string; label: string }[]
    navLabel: string
    themeLabel: string
    github: string
    download: string
    homeLabel: string
    languageLabel: string
    otherLanguage: string
  }
  hero: {
    title: string[]
    lead: string
    primary: string
    secondary: string
    statusPrefix: string
    status: string
    statusLink: string
    shotAlt: string
    shotCaption: string
  }
  pipeline: { title: string; lead: string; stageLabel: string; stages: Stage[] }
  features: {
    title: string
    lead: string
    items: Feature[]
    locales: string
    providers: {
      /** Small label for things that are in the source but not in the published installers. */
      sourceTag: string
      title: string
      lead: string
      testedLabel: string
      untestedLabel: string
      kinds: Record<ProviderKindId, { name: string; testedChips: string[] }>
      kindsNote: string
      accountTitle: string
      accountLead: string
      account: { name: string; text: string }[]
      optionsTitle: string
      options: { title: string; text: string }[]
    }
    screensTitle: string
    screensNote: string
    screens: Screen[]
    stylesTitle: string
    stylesLead: string
    styleGroups: { name: string; presets: string[] }[]
  }
  editions: {
    title: string
    lead: string
    desktop: { name: string; blurb: string }
    webui: { name: string; blurb: string }
    rows: EditionRow[]
  }
  cost: {
    title: string
    lead: string
    headline: string
    headlineText: string
    paysTitle: string
    pays: string[]
    freeTitle: string
    free: string[]
    guardTitle: string
    guards: CostPoint[]
    shotAlt: string
    shotCaption: string
    fine: string
  }
  install: {
    title: string
    lead: string
    desktop: {
      name: string
      blurb: string
      platforms: PlatformRow[]
      testedLabel: string
      untestedLabel: string
      releases: string
      releasesTag: string
      note: string
      snapshotTitle: string
      snapshot: string
      unsignedTitle: string
      unsigned: string[]
      sizeNote: string
    }
    webui: {
      name: string
      blurb: string
      prerequisites: string
      commands: { comment: string; command: string }[]
      options: string
      network: string
      copy: string
      copied: string
      notYet: string
    }
    ffmpeg: { title: string; text: string; commands: { os: string; command: string }[] }
    status: {
      title: string
      lead: string
      works: StatusColumn
      unverified: StatusColumn
      notReleased: StatusColumn
    }
    legacy: { title: string; text: string; link: string }
  }
  faq: { title: string; items: FaqItem[] }
  footer: {
    tagline: string
    project: string
    participate: string
    language: string
    links: {
      project: { label: string; href: string }[]
      participate: { label: string; href: string }[]
    }
    legal: string
  }
  notFound: {
    title: string
    description: string
    heading: string
    text: string
    legacyHeading: string
    legacyText: string
    home: string
    legacy: string
  }
}
