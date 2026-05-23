import type { SubtitleTrackInfo } from './pipeline/types.js';

const ISO_639_LEGACY_ALIASES: Record<string, string> = {
  alb: 'sq',
  arm: 'hy',
  baq: 'eu',
  bur: 'my',
  chi: 'zh',
  cze: 'cs',
  dut: 'nl',
  fre: 'fr',
  geo: 'ka',
  ger: 'de',
  gre: 'el',
  ice: 'is',
  mac: 'mk',
  mao: 'mi',
  may: 'ms',
  per: 'fa',
  rum: 'ro',
  slo: 'sk',
  tib: 'bo',
  wel: 'cy',
};

const ISO_639_2_TO_1: Record<string, string> = {
  eng: 'en',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
  ita: 'it',
  por: 'pt',
  rus: 'ru',
  jpn: 'ja',
  kor: 'ko',
  zho: 'zh',
  ara: 'ar',
  hin: 'hi',
  nld: 'nl',
  swe: 'sv',
  pol: 'pl',
  tur: 'tr',
  vie: 'vi',
  tha: 'th',
};

const LANGUAGE_NAME_FALLBACKS: Record<string, string> = {
  ar: 'Arabic',
  bg: 'Bulgarian',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  et: 'Estonian',
  fi: 'Finnish',
  fr: 'French',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  lt: 'Lithuanian',
  lv: 'Latvian',
  ms: 'Malay',
  nl: 'Dutch',
  no: 'Norwegian',
  pl: 'Polish',
  pt: 'Portuguese',
  ru: 'Russian',
  sk: 'Slovak',
  sl: 'Slovenian',
  sv: 'Swedish',
  ta: 'Tamil',
  te: 'Telugu',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  zh: 'Chinese',
};

let englishLanguageNames: Intl.DisplayNames | null | undefined;

export function normalizeSubtitleLanguageCode(code: string | null | undefined): string {
  const normalized = code?.trim().toLowerCase();
  if (!normalized || normalized === 'und') return '';

  const base = normalized.split('-')[0];
  const canonicalBase = ISO_639_LEGACY_ALIASES[base] ?? ISO_639_2_TO_1[base] ?? base;

  if (normalized === base) {
    return canonicalBase;
  }
  return [canonicalBase, ...normalized.split('-').slice(1)].join('-');
}

export function formatSubtitleTrackLabel(
  info: SubtitleTrackInfo | undefined,
  fallbackTrackIndex: number,
): string {
  const title = info?.name?.trim();
  const language = subtitleLanguageLabel(info?.language);
  const flags = subtitleFlagLabels(info);

  if (title) {
    const titleWithFlags = appendMissingFlags(title, flags);
    if (!language || titleMentionsLanguage(titleWithFlags, language)) {
      return titleWithFlags;
    }
    if (isShortSubtitleDescriptor(titleWithFlags)) {
      return `${language} (${titleWithFlags})`;
    }
    return `${titleWithFlags} - ${language}`;
  }

  if (language) {
    if (flags.length === 0) {
      return language;
    }
    return `${language} (${flags.join(', ')})`;
  }

  return `Track ${fallbackTrackIndex + 1}`;
}

export function subtitleLanguageLabel(code: string | null | undefined): string {
  const normalized = normalizeSubtitleLanguageCode(code);
  if (!normalized) return '';

  const fallback = LANGUAGE_NAME_FALLBACKS[normalized] ?? LANGUAGE_NAME_FALLBACKS[code ?? ''];
  const displayName = getEnglishLanguageNames()?.of(normalized);
  if (displayName && displayName !== 'root' && displayName !== normalized) {
    return titleCaseLanguage(displayName);
  }

  return fallback ?? normalized.toUpperCase();
}

function getEnglishLanguageNames(): Intl.DisplayNames | null {
  if (englishLanguageNames !== undefined) {
    return englishLanguageNames;
  }
  if (typeof Intl.DisplayNames !== 'function') {
    englishLanguageNames = null;
    return englishLanguageNames;
  }

  try {
    englishLanguageNames = new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    englishLanguageNames = null;
  }
  return englishLanguageNames;
}

function subtitleFlagLabels(info: SubtitleTrackInfo | undefined): string[] {
  if (!info) return [];

  const labels: string[] = [];
  if (info.disposition.forced) {
    labels.push('Forced');
  }
  if (info.disposition.hearingImpaired) {
    labels.push('SDH');
  }
  return labels;
}

function appendMissingFlags(title: string, flags: string[]): string {
  const missing = flags.filter((flag) => !titleMentionsFlag(title, flag));
  if (missing.length === 0) {
    return title;
  }
  return `${title} (${missing.join(', ')})`;
}

function titleMentionsFlag(title: string, flag: string): boolean {
  const normalizedTitle = title.toLowerCase();
  const normalizedFlag = flag.toLowerCase();
  if (normalizedFlag === 'sdh') {
    return (
      /\bsdh\b/i.test(title) ||
      normalizedTitle.includes('hearing impaired') ||
      normalizedTitle.includes('hearing-impaired')
    );
  }
  return normalizedTitle.includes(normalizedFlag);
}

function titleMentionsLanguage(title: string, language: string): boolean {
  return title.toLocaleLowerCase('en').includes(language.toLocaleLowerCase('en'));
}

function isShortSubtitleDescriptor(title: string): boolean {
  return !/[([]/.test(title) && title.length <= 18;
}

function titleCaseLanguage(value: string): string {
  return value.replace(/\p{L}+/gu, (word) => {
    const lower = word.toLocaleLowerCase('en');
    return lower.charAt(0).toLocaleUpperCase('en') + lower.slice(1);
  });
}
